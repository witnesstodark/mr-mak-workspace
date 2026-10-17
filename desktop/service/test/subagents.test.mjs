import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { backgroundCommands, ConversationTranscripts, subagentStep, taskStops } from '../mobile-transcript.mjs';

const toolUse = (name, input, at = 't2') => ({ type: 'assistant', timestamp: at, message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name, input }] } });
const reply = at => ({ type: 'assistant', timestamp: at, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } });
const notification = (id, at) => ({ type: 'user', timestamp: at, origin: { kind: 'task-notification' }, message: { content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "Map" finished</summary>\n</task-notification>` } });

test('a subagent works until its reply ends the turn', () => {
  const prompt = { type: 'user', timestamp: 't1', message: { content: 'Map the code' } };
  assert.deepEqual(subagentStep([prompt]), { working: true, at: 't1', step: 'Thinking' });
  assert.deepEqual(subagentStep([prompt, toolUse('Bash', { command: 'npm test', description: 'Run the tests' }), { type: 'attachment' }]), { working: true, at: 't2', step: 'Bash · Run the tests' });
  assert.equal(subagentStep([prompt, toolUse('Read', { file_path: 'E:\\game\\src\\Hud.cs' })]).step, 'Read · Hud.cs');
  assert.equal(subagentStep([prompt, toolUse('mcp__mixar__render_viewport', {})]).step, 'render_viewport');
  // A streamed reply is recorded in parts before it stops.
  assert.equal(subagentStep([prompt, { type: 'assistant', timestamp: 't3', message: { stop_reason: null, content: [{ type: 'thinking', thinking: '' }] } }]).step, 'Thinking');
  assert.deepEqual(subagentStep([prompt, reply('t3'), { type: 'api-request' }]), { working: false, at: 't3' });
  assert.equal(subagentStep([{ type: 'api-request' }]), null);
});

test('task notifications mark when a background task stopped', () => {
  const stops = taskStops([notification('a1', '2026-10-16T10:00:00Z'), { type: 'user', message: { content: 'Plain message' } }, notification('a1', '2026-10-16T11:00:00Z')]);
  assert.deepEqual([...stops], [['a1', Date.parse('2026-10-16T11:00:00Z')]]);
});

const launch = (id, toolId, input, at) => [
  { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: toolId, name: 'PowerShell', input }] } },
  { type: 'user', timestamp: at, toolUseResult: { backgroundTaskId: id }, message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: `Command running in background with ID: ${id}.` }] } },
];

test('background commands run until notified, wherever the notification arrives', () => {
  const records = [
    ...launch('b1', 't1', { command: 'npm test', description: 'Run the tests' }, 'a1'),
    ...launch('b2', 't2', { command: 'git fetch\ngit status' }, 'a2'),
    ...launch('b3', 't3', { command: 'sleep 9' }, 'a3'),
    ...launch('b4', 't4', { command: 'unity -batchmode' }, 'a4'),
    ...launch('b5', 't5', { command: 'npm run build' }, 'a5'),
    // A subagent gets the notice after a preamble; mid-turn it is a queued command.
    { type: 'user', origin: { kind: 'task-notification' }, message: { content: '[SYSTEM NOTIFICATION - NOT USER INPUT]\n\n<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>' } },
    { type: 'attachment', attachment: { type: 'queued_command', prompt: '<task-notification>\n<task-id>b3</task-id>\n</task-notification>' } },
    { type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>b5</task-id>\n</task-notification>' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't6', name: 'TaskStop', input: { task_id: 'b4' } }] } },
    // Quoting a notification in a message stops nothing.
    { type: 'user', message: { content: 'Why did this fail? <task-notification>\n<task-id>b2</task-id>' } },
  ];
  assert.deepEqual(backgroundCommands(records), [{ id: 'b2', name: 'PowerShell', title: 'git fetch', startedAt: 'a2' }]);
});

test('the conversation lists subagents and background commands still working', async () => {
  const config = await mkdtemp(path.join(os.tmpdir(), 'mrmak-claude-')), cwd = path.resolve('agents-project'), nativeId = 'session-1';
  const project = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-')), folder = path.join(project, nativeId, 'subagents');
  await mkdir(folder, { recursive: true });
  const lines = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
  const at = new Date(Date.now() - 1000).toISOString(), later = new Date().toISOString();
  await writeFile(path.join(project, `${nativeId}.jsonl`), lines([{ type: 'user', uuid: 'u1', timestamp: at, message: { content: 'Start the bots' } }, ...launch('chat-build', 'c1', { description: 'Build the app' }, at), notification('killed', later), notification('reported-to-chat', later)]));
  await writeFile(path.join(folder, 'agent-busy.jsonl'), lines([{ type: 'user', timestamp: at, message: { content: 'Fix it' } }, toolUse('Edit', { file_path: 'E:/game/Hud.cs' }, at)]));
  await writeFile(path.join(folder, 'agent-busy.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Bot Coder: task 8' }));
  // A finished subagent's command keeps running; another one reported to the chat after it ended.
  await writeFile(path.join(folder, 'agent-done.jsonl'), lines([{ type: 'user', timestamp: at, message: { content: 'Review' } }, ...launch('agent-tests', 'd1', { description: 'Run the sim suite' }, at), ...launch('reported-to-chat', 'd2', { description: 'Wait for CI' }, at), reply(at)]));
  await writeFile(path.join(folder, 'agent-done.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Bot Revisor' }));
  // Its last tool call never returned: the chat's notification says it was stopped.
  await writeFile(path.join(folder, 'agent-killed.jsonl'), lines([toolUse('Bash', { description: 'Long run' }, at)]));

  const prior = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    const reader = new ConversationTranscripts(), session = { id: 'chat', agent: 'claude', cwd, nativeId, process: {}, startedAt: Date.now() - 60000 };
    const { agents, commands } = await reader.read(session);
    assert.deepEqual(agents.map(({ id, name, type, step }) => ({ id, name, type, step })), [{ id: 'busy', name: 'Bot Coder: task 8', type: 'general-purpose', step: 'Edit · Hud.cs' }]);
    assert.ok(Date.parse(agents[0].startedAt) && Date.parse(agents[0].updatedAt));
    assert.deepEqual(commands.map(({ id, title, agent }) => ({ id, title, agent })), [{ id: 'chat-build', title: 'Build the app', agent: undefined }, { id: 'agent-tests', title: 'Run the sim suite', agent: 'Bot Revisor' }]);
    // Work recorded before this terminal started belongs to a CLI that has exited.
    assert.deepEqual(await reader.read({ ...session, startedAt: Date.now() + 60000 }).then(value => [value.agents, value.commands]), [[], []]);
    assert.deepEqual(await reader.read({ ...session, process: null }).then(value => [value.agents, value.commands]), [[], []]);
  } finally { if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prior; }
});
