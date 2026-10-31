import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { activeRules, editRules, readRules, RULES_PATH } from '../project-rules.mjs';
import { ClaudePlans, applyRecord, emptyPlan, planView } from '../claude-plan.mjs';
import { PLAN_TOOL_NAME, chatPlan, parsePlan, planFile, planKey, planServer, savePlan, validPlanKey, writeChatInstructions } from '../chat-plan.mjs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ENGINES, engineServers, engineStatus } from '../engines.mjs';
import { terminalCommand } from '../agents.mjs';
import { opencodeEnvironment } from '../opencode.mjs';
import { CPU_PRIORITIES, setCpuPriority } from '../platform.mjs';

// On Windows a CLI shim runs through PowerShell with its arguments encoded.
const argv = command => { const index = command.args.indexOf('-EncodedCommand'); return index < 0 ? command.args.join(' ') : Buffer.from(command.args[index + 1], 'base64').toString('utf16le'); };
// Empty stand-ins for the CLIs, so a launch command can be built where none is installed.
async function withAgents(run) {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agents-'));
  for (const name of ['claude', 'codex']) await writeFile(path.join(bin, process.platform === 'win32' ? `${name}.exe` : name), '', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try { return await run(); } finally { process.env.PATH = previous; }
}
const lines = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';

test('project rules are added, edited and removed without touching other lines', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-rules-'));
  assert.deepEqual((await readRules(folder)).rules, []);
  assert.equal(await activeRules(folder), null);
  let value = await editRules(folder, { action: 'add', text: 'Keep UI text in English.' });
  value = await editRules(folder, { action: 'add', text: '- Never push to main.' });
  assert.deepEqual(value.rules.map(rule => rule.text), ['Keep UI text in English.', 'Never push to main.']);
  assert.equal(await activeRules(folder), path.join(folder, RULES_PATH));
  const file = path.join(folder, RULES_PATH);
  await writeFile(file, (await readFile(file, 'utf8')) + '\nNotes an agent wrote.\n');
  const [first, second] = value.rules;
  value = await editRules(folder, { action: 'update', line: first.line, expected: first.text, text: 'Keep every UI text in English.' });
  await assert.rejects(editRules(folder, { action: 'remove', line: second.line, expected: 'Something else' }), /changed since/);
  value = await editRules(folder, { action: 'remove', line: second.line, expected: second.text });
  assert.deepEqual(value.rules.map(rule => rule.text), ['Keep every UI text in English.']);
  const text = await readFile(file, 'utf8');
  assert.match(text, /^# Project rules/);
  assert.match(text, /Notes an agent wrote\./);
  await assert.rejects(editRules(folder, { action: 'add', text: 'two\nlines' }), /one line/);
});

test('chat instructions reach Claude, Codex and OpenCode at launch', () => withAgents(() => {
  const instructions = path.resolve('/state/chat-instructions/chat.md');
  const claude = argv(terminalCommand('claude', { instructions, readDir: path.resolve('/other') }));
  assert.ok(claude.includes(`--append-system-prompt-file`));
  // --add-dir takes every argument after it.
  assert.ok(claude.indexOf('--append-system-prompt-file') < claude.indexOf('--add-dir'));
  const codex = argv(terminalCommand('codex', { instructions }));
  assert.match(codex, /developer_instructions=Mr\. Mak instructions for this chat are in /);
  assert.ok(claude.includes(instructions) && codex.includes(instructions));
  assert.throws(() => terminalCommand('claude', { instructions: 'relative.md' }), /instructions file/);
  const env = opencodeEnvironment({ OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: ['AGENTS.md'] }) }, { stateDir: os.tmpdir(), session: { id: 'chat' }, major: 1, instructions });
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT).instructions, ['AGENTS.md', instructions]);
  assert.equal(JSON.parse(opencodeEnvironment({}, { stateDir: os.tmpdir(), session: { id: 'chat' }, major: 1 }).OPENCODE_CONFIG_CONTENT).instructions, undefined);
}));

test('the plan follows tasks, todo lists and schedules', () => {
  const plan = emptyPlan();
  const use = (id, name, input) => ({ type: 'assistant', timestamp: '2026-10-29T10:00:00.000Z', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  for (const record of [
    use('a', 'TaskCreate', { subject: 'Build menu', activeForm: 'Building menu' }), result('a', 'Task #1 created successfully: Build menu'),
    use('b', 'TaskCreate', { subject: 'Add sound' }), result('b', [{ type: 'text', text: 'Task #2 created successfully' }]),
    use('c', 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
    use('d', 'TaskUpdate', { taskId: '2', status: 'deleted' }),
    { ...use('e', 'TaskCreate', { subject: 'Subagent task' }), isSidechain: true },
    use('f', 'ScheduleWakeup', { delaySeconds: 600, prompt: 'Check the build' }),
  ]) applyRecord(plan, record);
  let view = planView(plan, Date.parse('2026-10-29T10:05:00.000Z'));
  assert.deepEqual(view.tasks.map(item => [item.id, item.status]), [['1', 'in_progress']]);
  assert.equal(view.schedules[0].kind, 'wakeup');
  assert.equal(view.schedules[0].at, '2026-10-29T10:10:00.000Z');
  assert.equal(planView(plan, Date.parse('2026-10-29T11:00:00.000Z')).schedules.length, 0);
  const todos = emptyPlan();
  applyRecord(todos, use('g', 'TodoWrite', { todos: [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'pending' }] }));
  view = planView(todos);
  assert.deepEqual(view.tasks.map(item => item.subject), ['One', 'Two']);
});

test('the plan is read incrementally as the transcript grows', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-plan-'));
  const file = path.join(folder, 'chat.jsonl');
  const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  await writeFile(file, lines([use('a', 'TaskCreate', { subject: 'First' }), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'Task #1 created successfully' }] } }]));
  const plans = new ClaudePlans();
  assert.deepEqual((await plans.read(file)).tasks.map(item => item.status), ['pending']);
  await writeFile(file, lines([use('b', 'TaskUpdate', { taskId: '1', status: 'completed' })]), { flag: 'a' });
  assert.deepEqual((await plans.read(file)).tasks.map(item => item.status), ['completed']);
  assert.deepEqual((await plans.read(path.join(folder, 'missing.jsonl'))).tasks, []);
});

test('a chat keeps its plan in an ignored file the panel reads', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'mrmak-chat-plan-')), state = await mkdtemp(path.join(os.tmpdir(), 'mrmak-state-'));
  const session = { id: 'chat-1', agent: 'codex', cwd };
  await editRules(cwd, { action: 'add', text: 'Keep UI text in English.' });
  const file = await writeChatInstructions(state, session, path.join(cwd, RULES_PATH));
  const text = await readFile(file, 'utf8');
  assert.ok(text.includes(planFile(cwd, 'chat-1')));
  assert.match(text, /Project rules for this folder are in .*\n\n# Project rules[\s\S]*- Keep UI text in English\./);
  assert.equal(await readFile(path.join(cwd, '.agents', 'plans', '.gitignore'), 'utf8'), '*\n');
  assert.equal((await chatPlan(session, null)).source, 'none');
  await writeFile(planFile(cwd, 'chat-1'), ['# Plan', 'Request: Add a pause menu', '**Status:** Needs review', '- [x] Draw the menu', '- [>] Wire the buttons', '- [ ] Test with a gamepad', 'Next: test with a gamepad'].join('\r\n'));
  const plan = await chatPlan(session, null);
  assert.equal(plan.source, 'file');
  assert.deepEqual([plan.request, plan.status, plan.next], ['Add a pause menu', 'needs review', 'test with a gamepad']);
  assert.deepEqual(plan.tasks.map(item => item.status), ['completed', 'in_progress', 'pending']);
  assert.equal(parsePlan('Status: thinking').status, 'working');
  assert.throws(() => planFile(cwd, '../x'), /no plan file/);
  // A Claude chat without a plan file shows its own task list and schedules.
  const claude = { plan: async () => ({ tasks: [{ id: '1', subject: 'Native', activeForm: '', status: 'pending' }], schedules: [{ kind: 'cron', prompt: 'Nightly' }], updatedAt: null }) };
  const native = await chatPlan({ ...session, id: 'chat-2', agent: 'claude' }, claude);
  assert.deepEqual([native.source, native.tasks[0].subject, native.schedules.length], ['agent', 'Native', 1]);
});

test('the Plan tool reaches each agent only when it is on, and writes the chat plan', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'mrmak-plan-tool-')), state = await mkdtemp(path.join(os.tmpdir(), 'mrmak-state-'));
  const session = { id: 'chat-9', agent: 'claude', cwd };
  const server = await planServer(state, session, { url: 'http://127.0.0.1:1/chat-plan/tool', secret: 's' });
  assert.deepEqual(JSON.parse(await readFile(server.configFile, 'utf8')).mcpServers['mrmak-plan'].env.MRMAK_PLAN_KEY, planKey('s', 'chat-9'));
  assert.ok(validPlanKey('s', 'chat-9', planKey('s', 'chat-9')) && !validPlanKey('s', 'chat-8', planKey('s', 'chat-9')));
  await withAgents(() => {
    const claude = argv(terminalCommand('claude', { planServer: server, readDir: path.resolve('/other') }));
    assert.ok(claude.includes(PLAN_TOOL_NAME) && claude.indexOf('--mcp-config') < claude.indexOf('--add-dir'));
    assert.ok(!argv(terminalCommand('claude', {})).includes('--mcp-config'));
    assert.match(argv(terminalCommand('codex', { planServer: server })), /mcp_servers\.mrmak-plan\.env=\{ MRMAK_PLAN_URL = '/);
  });
  const env = opencodeEnvironment({}, { stateDir: state, session: { id: 'chat' }, major: 1, planServer: server });
  assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).mcp['mrmak-plan'].type, 'local');
  assert.match(await readFile(await writeChatInstructions(state, session, null, true), 'utf8'), /report_plan tool/);
  assert.equal(await savePlan(cwd, 'chat-9', { request: 'Ship it', status: 'working', steps: [{ text: 'Build', status: 'completed' }, { text: 'Test', status: 'in_progress' }] }), 'ok: 1/2 steps, working');
  assert.deepEqual((await chatPlan(session, { plan: async () => ({ tasks: [], schedules: [], updatedAt: null }) })).tasks.map(item => item.status), ['completed', 'in_progress']);
  await assert.rejects(savePlan(cwd, 'chat-9', { steps: 'none' }), /steps/);

  // The bridge answers MCP and forwards a call with the chat's key.
  const calls = [];
  const service = http.createServer((request, response) => { let data = ''; request.on('data', chunk => { data += chunk; }); request.on('end', () => { calls.push({ key: request.headers['x-mrmak-plan'], body: JSON.parse(data) }); response.end(JSON.stringify({ text: 'ok: 0/1 steps, working' })); }); });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../chat-plan-mcp.mjs', import.meta.url))], { env: { ...process.env, ...server.env, MRMAK_PLAN_URL: `http://127.0.0.1:${service.address().port}/chat-plan/tool` }, stdio: ['pipe', 'pipe', 'inherit'] });
  const answers = [];
  child.stdout.on('data', chunk => answers.push(...String(chunk).trim().split('\n').map(item => JSON.parse(item))));
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  send({ id: 1, method: 'tools/list' });
  send({ id: 2, method: 'tools/call', params: { name: 'report_plan', arguments: { steps: [{ text: 'One', status: 'pending' }] } } });
  const until = Date.now() + 5000;
  while (answers.length < 2 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
  child.kill(); service.close();
  assert.deepEqual(answers.find(item => item.id === 1).result.tools.map(item => item.name), ['report_plan']);
  assert.equal(answers.find(item => item.id === 2).result.content[0].text, 'ok: 0/1 steps, working');
  assert.deepEqual([calls[0].key, calls[0].body.chat], [planKey('s', 'chat-9'), 'chat-9']);
});

test('engines group MCP servers by name and report open editors', async () => {
  const servers = [{ id: 'claude:unity-anklebreaker', name: 'unity-anklebreaker' }, { id: 'codex:godot-ai', name: 'godot-ai' }, { id: 'claude:plugin:blender@x:mcp', name: 'mcp', plugin: 'blender@x' }, { id: 'claude:fal', name: 'fal' }];
  const unity = ENGINES.find(engine => engine.id === 'unity');
  assert.deepEqual(engineServers(unity, servers), ['claude:unity-anklebreaker']);
  const status = await engineStatus(servers, new Set(['Unity.exe', 'Godot_v4.3-stable_win64.exe', 'UnrealEditor.exe']));
  assert.deepEqual(status.map(item => [item.id, item.running, item.servers.length]), [['unity', true, 1], ['godot', true, 1], ['blender', false, 1], ['unreal', true, 0]]);
});

test('agent CPU priority accepts only the listed levels', () => {
  assert.deepEqual(Object.keys(CPU_PRIORITIES), ['normal', 'below-normal', 'low']);
  assert.equal(setCpuPriority(process.pid, 'turbo'), false);
  assert.equal(setCpuPriority(-1, 'low'), false);
  assert.equal(setCpuPriority(process.pid, 'normal'), true);
});
