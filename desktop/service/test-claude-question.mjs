// Opt-in integration test: the real Claude Code TUI, an isolated config and home,
// and a loopback Messages API fixture that asks one AskUserQuestion per prompt.
// It checks that a phone answer and a terminal answer both reach Claude.
// No account, credentials, paid model calls, user chats or global config are used.
//   node desktop/service/test-claude-question.mjs --binary C:\path\to\claude.exe
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './server.mjs';

const binary = process.argv[process.argv.indexOf('--binary') + 1];
if (!process.argv.includes('--binary') || !path.isAbsolute(binary)) throw new Error('Pass --binary with an absolute path to the Claude Code executable. This test never installs a CLI.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/claude-question-'));
for (const folder of ['config', 'home', 'ui', 'workspace']) await mkdir(path.join(repo, folder));
await writeFile(path.join(repo, 'ui/index.html'), '<html>Question check</html>');
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');

const QUESTIONS = [
  { question: 'Which colour should the banner use?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'A warm red.' }, { label: 'Blue', description: 'A calm blue.' }] },
  { question: 'Which extras do you want?', header: 'Extras', multiSelect: true, options: [{ label: 'Shadow', description: 'A soft drop shadow.' }, { label: 'Border', description: 'A thin border.' }, { label: 'Glow', description: 'An outer glow.' }] },
];
const results = [];
let asked = 0;
const server = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const data = raw ? JSON.parse(raw) : {};
  if (!request.url.split('?')[0].endsWith('/v1/messages')) { response.writeHead(404, { 'Content-Type': 'application/json' }); response.end('{"type":"error","error":{"type":"not_found_error","message":"fixture"}}'); return; }
  const last = [...(data.messages || [])].reverse().find(message => message.role === 'user');
  const parts = Array.isArray(last?.content) ? last.content : [];
  const result = parts.find(part => part.type === 'tool_result');
  let content;
  if (result) { results.push(result); content = [{ type: 'text', text: 'Thanks, noted.' }]; }
  else if ((data.tools || []).some(tool => tool.name === 'AskUserQuestion') && /ASKME/.test(JSON.stringify(last))) content = [{ type: 'tool_use', id: `toolu_fixture${++asked}`, name: 'AskUserQuestion', input: { questions: QUESTIONS } }];
  else content = [{ type: 'text', text: 'Ready.' }];
  const stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
  const message = { id: `msg_fixture${Date.now()}`, type: 'message', role: 'assistant', model: data.model || 'fixture', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!data.stream) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(message)); return; }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  event('message_start', { message: { ...message, content: [], stop_reason: null } });
  content.forEach((block, index) => {
    event('content_block_start', { index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
    event('content_block_delta', { index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    event('content_block_stop', { index });
  });
  event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {}); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

// Only this process and the CLI it starts see the isolated configuration.
// A placeholder the loopback fixture accepts; it is not an Anthropic key.
const key = 'iaar-fixture-placeholder-not-a-key-0000000000000000000000';
for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) delete process.env[name];
Object.assign(process.env, {
  PATH: `${path.dirname(binary)}${path.delimiter}${process.env.PATH}`,
  CLAUDE_CONFIG_DIR: path.join(repo, 'config'), HOME: path.join(repo, 'home'), USERPROFILE: path.join(repo, 'home'),
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: key,
  DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
});
await writeFile(path.join(repo, 'config', '.claude.json'), JSON.stringify({
  hasCompletedOnboarding: true, theme: 'dark', autoUpdates: false, customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
  projects: { [repo.replaceAll('\\', '/')]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } },
}));
const version = execFileSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();

const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (label, check, timeout = 45000) => {
  const end = Date.now() + timeout;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error(`Timed out: ${label}\n${(await service.sessions.read(chat.id)).screen}`); await sleep(250); }
};
let chat;
try {
  await service.mobile.enable();
  const phone = async (route, data, cookie) => {
    const response = await fetch(`${service.mobile.origin}/mobile/api${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: service.mobile.origin, 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const qr = await service.mobile.newPairing(), claim = (await phone('/pair', { token: new URL(qr.url).hash.slice(6), name: 'Fixture phone' })).data;
  await service.mobile.approve(claim.id);
  const { cookie } = await phone('/pair/finish', claim);

  chat = await service.sessions.create({ agent: 'claude', name: 'Question Check', cwd: repo });
  const screen = async () => (await service.sessions.read(chat.id, 60)).screen;
  const type = async text => { for (const character of text) { service.sessions.input(chat.id, character); await sleep(20); } await sleep(300); service.sessions.input(chat.id, '\r'); };
  await until('Claude prompt', async () => /for shortcuts|mode on/.test(await screen()), 60000);
  await sleep(1000);

  // 1. The phone answers while the terminal dialog is open.
  await type('ASKME from the phone');
  const pending = await until('answerable question on the phone', async () => (await phone(`/sessions/${chat.id}/messages`, undefined, cookie)).data.questions?.find(item => item.answerable));
  assert.match(await screen(), /Enter to select/, 'The terminal dialog is shown at the same time');
  assert.equal(service.sessions.get(chat.id).waiting, 'question');
  const reply = await phone(`/sessions/${chat.id}/answer`, { id: pending.id, answers: { [QUESTIONS[0].question]: 'Teal, with a gold edge', [QUESTIONS[1].question]: ['Shadow', 'Glow'] } }, cookie);
  assert.equal(reply.data.status, 'delivered', JSON.stringify(reply.data));
  await until('phone answer reaches Claude', () => results.length === 1);
  assert.match(results[0].content, /"Which colour should the banner use\?"="Teal, with a gold edge"/);
  assert.match(results[0].content, /"Which extras do you want\?"="Shadow, Glow"/);
  await until('terminal shows the answer', async () => /Teal, with a gold edge/.test(await screen()));

  // 2. The terminal answers first; the waiting hook is released without output.
  await type('ASKME from the terminal');
  await until('second question', async () => /Enter to select/.test(await screen()) && service.sessions.questions.pending(chat.id).length);
  for (const key of ['\r', '\r', '\t', '\r']) { service.sessions.input(chat.id, key); await sleep(700); }
  await until('terminal answer reaches Claude', () => results.length === 2);
  assert.match(results[1].content, /="Red"/); assert.match(results[1].content, /="Shadow"/);
  await until('hook released', () => !service.sessions.questions.pending(chat.id).length, 10000);
  await until('no question left on the phone', async () => !(await phone(`/sessions/${chat.id}/messages`, undefined, cookie)).data.questions?.length, 10000);
  console.log(JSON.stringify({ claude: version, phoneAnswer: results[0].content, terminalAnswer: results[1].content, passed: true }, null, 2));
} finally {
  await service.close();
  server.closeAllConnections(); server.close();
}
