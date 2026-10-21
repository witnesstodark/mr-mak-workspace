import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { recentProjects } from '../recent-projects.mjs';
import { answerPrompt, readPrompt, terminalPrompt } from '../terminal-prompt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);

async function claudeHome(t, projects) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const home = await mkdtemp(path.join(root, '.cache', 'claude-home-'));
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'private@example.com' }, projects: Object.fromEntries(projects.map(folder => [folder.replaceAll('\\', '/'), { allowedTools: [] }])) }));
  const prior = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME };
  process.env.CLAUDE_CONFIG_DIR = home; process.env.CODEX_HOME = path.join(home, 'codex');
  t.after(() => { for (const [name, value] of Object.entries(prior)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  return home;
}

test('recent projects merge Claude Code folders with chat folders and skip transient or missing ones', async t => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const base = await mkdtemp(path.join(root, '.cache', 'projects-'));
  const [repo, game, tool, script, worktree, codexScratch] = ['workspace', 'Game', 'Tool', 'Script', path.join('Game', '.claude', 'worktrees', 'quick-fix'), path.join('Codex', '2026-10-08', 'chat')].map(name => path.join(base, name));
  for (const folder of [repo, game, tool, script, worktree, codexScratch]) await mkdir(folder, { recursive: true });
  const home = await claudeHome(t, [game, worktree, path.join(base, 'Deleted')]);
  await mkdir(path.join(home, 'projects', game.replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true });
  const day = path.join(home, 'codex', 'sessions', '2026', '10', '15'); await mkdir(day, { recursive: true });
  for (const [index, cwd] of [script, codexScratch].entries()) await writeFile(path.join(day, `rollout-2026-10-15T0${index}-00-00-${randomUUID()}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id: randomUUID(), cwd, source: 'cli' } }) + '\n');
  const sessions = [{ cwd: tool, updatedAt: '2020-01-01T00:00:00.000Z' }, { cwd: process.platform === 'win32' ? game.toUpperCase() : game, updatedAt: '2019-01-01T00:00:00.000Z' }];
  const projects = await recentProjects({ repo, sessions });
  assert.deepEqual(projects.map(item => item.name), ['workspace', 'Game', 'Script', 'Tool']);
  assert.deepEqual(projects.find(item => item.name === 'Game').sources.sort(), ['claude', 'mrmak']);
  assert.deepEqual(projects.find(item => item.name === 'Script').sources, ['codex']);
  const pinned = await recentProjects({ repo, sessions, pinned: [tool] });
  assert.deepEqual(pinned.map(item => [item.name, item.pinned]), [['workspace', false], ['Tool', true], ['Game', false], ['Script', false]]);
  assert.equal(JSON.stringify(projects).includes('private@example.com'), false);
});

test('desktop conversation view reads the native transcript, grants its media and validates sends', { timeout: 30000 }, async t => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'conversation-'));
  await mkdir(path.join(repo, 'ui')); await writeFile(path.join(repo, 'ui', 'index.html'), '<html></html>');
  await mkdir(path.join(repo, 'workspace')); await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');
  await writeFile(path.join(repo, 'render.png'), png);
  const home = await claudeHome(t, [repo]);
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  t.after(() => service.close());
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });

  const nativeId = randomUUID(), cwd = await realpath(repo);
  const folder = path.join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${nativeId}.jsonl`), [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-15T10:00:00.000Z', message: { content: 'Render the hero' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-10-15T10:01:00.000Z', message: { id: 'm1', content: [{ type: 'text', text: 'Done: ![hero](render.png)' }] } },
  ].map(item => JSON.stringify(item)).join('\n') + '\n');

  const session = await (await request('/history/import', { agent: 'claude', nativeId, name: 'Hero render', cwd })).json();
  assert.ok((await request('/recent-projects').then(response => response.json())).some(item => item.path === cwd));
  assert.equal((await fetch(`${service.origin}/api/sessions/${session.id}/messages`)).status, 401);
  const transcript = await (await request(`/sessions/${session.id}/messages`)).json();
  assert.deepEqual(transcript.messages.map(item => [item.role, item.text]), [['user', 'Render the hero'], ['assistant', 'Done: ![hero](render.png)']]);
  const image = transcript.messages[1].images[0];
  assert.match(image.url, new RegExp(`^/media/${session.id}/[A-Za-z0-9_-]{43}$`));
  const media = await fetch(service.origin + image.url);
  assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${service.origin}/media/${session.id}/${'x'.repeat(43)}`)).status, 404);
  assert.equal((await fetch(`${service.origin}/media/${randomUUID()}/${image.url.split('/').pop()}`)).status, 404);

  const empty = await request(`/sessions/${session.id}/send`, { text: '  ', paths: [] });
  assert.equal(empty.status, 400); assert.match((await empty.json()).error, /Write a message/);
  assert.equal((await request(`/sessions/${session.id}/send`, { text: 'Hi', paths: ['relative.txt'] })).status, 400);
  const stopped = await request(`/sessions/${session.id}/send`, { text: 'Hi' });
  assert.equal(stopped.status, 400); assert.match((await stopped.json()).error, /stopped/);
  assert.equal(transcript.prompt, null);

  const shown = await (await request('/preview/show', { path: 'render.png', sessionId: session.id })).json();
  assert.deepEqual(shown, { shown: 'preview', path: path.join(cwd, 'render.png') });
  assert.equal((await (await request('/preview/show', { path: '.', sessionId: session.id })).json()).shown, 'folder');
  assert.equal((await request('/preview/show', { path: 'missing.txt', sessionId: session.id })).status, 400);

  const speak = await request(`/sessions/${session.id}/speak`, { voice: 'am_michael', text: 'Hello' });
  assert.equal(speak.status, 503); assert.match((await speak.json()).error, /Set up local Read aloud/);

  const game = path.join(cwd, 'Game'); await mkdir(game);
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ projects: { [cwd]: {}, [game]: {} } }));
  assert.equal((await request('/recent-projects/pin', { path: path.join(cwd, 'elsewhere'), pinned: true })).status, 400);
  const pinned = await (await request('/recent-projects/pin', { path: game, pinned: true })).json();
  assert.deepEqual(pinned.filter(item => item.pinned).map(item => item.path), [game]);
  assert.deepEqual((await service.coordinator.execute('list_projects', { query: 'game' })).map(item => item.path), [game]);

  assert.deepEqual(await (await request(`/sessions/${session.id}/stats`)).json(), { supported: true, userMessages: 1, truncated: false, model: null, handoff: null });
  const handoff = await request(`/sessions/${session.id}/handoff`, {});
  assert.equal(handoff.status, 400); assert.match((await handoff.json()).error, /Reconnect this chat/);
  assert.equal((await (await request('/settings', { handoffAfter: 5 })).json()).handoffAfter, 40);
  const settings = await (await request('/settings', { handoffAfter: 0 })).json();
  assert.equal(settings.handoffAfter, 0);
});

const claudeScreen = [
  '● I will run the test suite.',
  '╭──────────────────────────────────────────────╮',
  '│ Bash command                                 │',
  '│                                              │',
  '│   npm test                                   │',
  '│   Run the service tests                      │',
  '│                                              │',
  '│ Do you want to proceed?                      │',
  '│ ❯ 1. Yes                                     │',
  "│   2. Yes, and don't ask again for npm test   │",
  '│      commands in this folder                 │',
  '│   3. No, and tell Claude what to do          │',
  '│      differently (esc)                       │',
  '╰──────────────────────────────────────────────╯',
  '',
].join('\n');

test('terminal permission menus are read from the bottom of the screen only', () => {
  const prompt = terminalPrompt(claudeScreen);
  assert.equal(prompt.question, 'Do you want to proceed?');
  assert.deepEqual(prompt.options, ['Yes', "Yes, and don't ask again for npm test", 'No, and tell Claude what to do']);
  assert.equal(prompt.selected, 0);
  assert.deepEqual(prompt.detail, ['Bash command', 'npm test', 'Run the service tests']);
  assert.deepEqual(prompt.notes, ['', 'commands in this folder', 'differently (esc)']);
  const codex = terminalPrompt(['▌ Allow command?', '▌ $ cargo build', '', '  › 1. Yes, proceed (y)', "    2. Yes, and don't ask again for this command (a)", '    3. No, and tell Codex what to do differently (esc)', '', '  Press enter to confirm or esc to cancel'].join('\n'));
  assert.equal(codex.question, 'Allow command?'); assert.equal(codex.options.length, 3); assert.equal(codex.selected, 0);
  // An ordinary numbered answer has no selected marker; an old menu is no longer at the bottom.
  assert.equal(terminalPrompt('Steps:\n1. Build\n2. Test\n3. Ship\n'), null);
  assert.equal(terminalPrompt(claudeScreen + Array.from({ length: 12 }, (_, i) => `Output line ${i}`).join('\n')), null);
  assert.equal(terminalPrompt(''), null);
});

test('an AskUserQuestion menu is read when its option descriptions wrap over several lines', () => {
  const description = ['     The infantry crosses on top and can also step down into the trench or climb out of it', '     by the walkway. Inside, the line still runs underneath. It is simple and it works, but', '     the walkway becomes an entrance too, cheaper than the opening (15 against 20 wood).', '     Live tuning can correct it by raising the cost.'];
  const prompt = terminalPrompt(['─'.repeat(60), ' ☐ Walkway', '', '│ Step 2B is ready and tested. The path grid has a single layer.', '│ How does the infantry use the walkway?', '',
    '❯ 1. Cross and step down (Recommended)', ...description, '  2. Cross, but split the line', ...description.slice(0, 2), '  3. Only for units that stay out', ...description.slice(0, 3),
    '  4. Type something.', '─'.repeat(60), '  5. Chat about this', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel', ''].join('\n'));
  assert.equal(prompt.question, 'Step 2B is ready and tested. The path grid has a single layer. How does the infantry use the walkway?');
  assert.deepEqual(prompt.detail, ['☐ Walkway']);
  assert.deepEqual(prompt.options, ['Cross and step down (Recommended)', 'Cross, but split the line', 'Only for units that stay out', 'Type something.', 'Chat about this']);
  assert.deepEqual(prompt.notes.map(note => note.split(' ').length > 1), [true, true, true, false, false]);
  assert.ok(prompt.notes[0].endsWith('Live tuning can correct it by raising the cost.'));
  assert.equal(prompt.selected, 0);
});

test('answering a prompt re-checks it and moves the selection one key at a time', async () => {
  const writes = [];
  let screen = claudeScreen;
  const sessions = { read: async () => ({ screen }), keys: (_id, data) => {
    writes.push(data);
    if (data === '\x1b[B') {
      const selected = terminalPrompt(screen).selected;
      screen = screen.replace('❯ ', '  ').replace(`  ${selected + 2}.`, `❯ ${selected + 2}.`);
    }
  } };
  const { id } = await readPrompt(sessions, 'chat');
  await assert.rejects(answerPrompt(sessions, 'chat', id, 7), /listed options/);
  assert.deepEqual(await answerPrompt(sessions, 'chat', id, 2), { delivered: true, choice: 2, option: 'No, and tell Claude what to do' });
  assert.deepEqual(writes, ['\x1b[B', '\x1b[B', '\r']);
  await assert.rejects(answerPrompt(sessions, 'chat', id, 2), error => error.status === 409);
  await assert.rejects(answerPrompt(sessions, 'chat', 'stale', 0), error => error.status === 409);
  screen = 'Done.\n'; await readPrompt(sessions, 'chat'); screen = claudeScreen;
  const next = await readPrompt(sessions, 'chat');
  writes.length = 0; await answerPrompt(sessions, 'chat', next.id, 'cancel');
  assert.deepEqual(writes, ['\x1b']);
  screen = 'Done.\n';
  await assert.rejects(answerPrompt(sessions, 'chat', id, 0), error => error.status === 409);
});

test('Claude paste wrappers are removed from the user messages shown in Conversation', async () => {
  const { transcriptMessages, unwrapPastes } = await import('../mobile-transcript.mjs');
  const wrapped = '\n\n<pasted_content id="ab8e">\nPlease fix the tabs.\n\n<mrmak_workspace_context>{}</mrmak_workspace_context>\n</pasted_content id="ab8e">';
  assert.deepEqual(transcriptMessages([{ type: 'user', message: { content: wrapped } }], 'claude').map(item => item.text), ['Please fix the tabs.\n\n<mrmak_workspace_context>{}</mrmak_workspace_context>']);
  assert.equal(unwrapPastes('Typed first <pasted_content id="x1">\npasted\n</pasted_content id="x1"> and after'), 'Typed first pasted and after');
  assert.equal(unwrapPastes('<pasted_content id="a">mismatched</pasted_content id="b">'), '<pasted_content id="a">mismatched</pasted_content id="b">');
});
