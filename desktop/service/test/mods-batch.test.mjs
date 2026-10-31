import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileInsights, fileActivity, folderMap, parseBranch, parseNumstat, parseStatus } from '../file-insights.mjs';
import { editGlobalRules, globalRulesFile, markedRule, readRulesAt } from '../project-rules.mjs';
import { RuleSuggestions } from '../rule-suggestions.mjs';
import { featuresSkillFile, writeChatInstructions } from '../chat-plan.mjs';
import { COLD_CONTEXT, ColdGuard, cacheHistory, cacheView, lastCache, priceOf } from '../chat-cache.mjs';
import { createSkill, discoverSkills, parseCandidates, projectPrompts } from '../skill-discovery.mjs';

test('git porcelain, numstat and branch lines are read', () => {
  assert.deepEqual(parseStatus(' M src/a.js\0?? new/\0R  b.js\0old.js\0UU c.js\0 D d.js\0A  e.js\0'), [
    { path: 'src/a.js', status: 'modified', staged: false }, { path: 'new/', status: 'untracked', staged: false }, { path: 'b.js', status: 'renamed', staged: true },
    { path: 'c.js', status: 'conflict', staged: true }, { path: 'd.js', status: 'deleted', staged: false }, { path: 'e.js', status: 'added', staged: true },
  ]);
  const lines = parseNumstat('3\t1\tsrc/a.js\n-\t-\timg.png\n2\t0\tdir/{old => new}/f.js\n');
  assert.deepEqual([lines.get('src/a.js'), lines.get('img.png'), lines.get('dir/new/f.js')], [{ added: 3, removed: 1 }, { added: null, removed: null }, { added: 2, removed: 0 }]);
  assert.deepEqual(parseBranch('## main...origin/main [ahead 2, behind 1]'), { name: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
  assert.deepEqual(parseBranch('## No commits yet on main'), { name: 'main', upstream: null, ahead: 0, behind: 0 });
});

test('the Files tab reads a repository, a diff and a folder map', async () => {
  // Git reports the real path: /private/var on macOS, the long name for a Windows 8.3 temp folder.
  const repo = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mrmak-git-')));
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'pipe' });
  await writeFile(path.join(repo, 'a.txt'), 'one\n'); git('init', '-q'); git('add', '.'); git('commit', '-qm', 'start');
  await writeFile(path.join(repo, 'a.txt'), 'two\nthree\n'); await mkdir(path.join(repo, 'art')); await writeFile(path.join(repo, 'art/x.txt'), 'x\n');
  const status = await new FileInsights().status(repo);
  assert.deepEqual(status.files.map(item => [item.path.slice(repo.length + 1).replace(/\\/g, '/'), item.status, item.added ?? null]), [['a.txt', 'modified', 2], ['art/', 'untracked', null]]);
  const diff = await new FileInsights().diff(path.join(repo, 'a.txt'));
  assert.match(diff.text, /^-one$/m); assert.match(diff.text, /^\+three$/m);
  assert.match((await new FileInsights().diff(path.join(repo, 'art/x.txt'))).text, /^\+x$/m);
  const map = await folderMap(repo);
  assert.deepEqual(map.children.map(item => item.name).sort(), ['a.txt', 'art']);
  assert.equal(map.complete, true);
  assert.equal((await new FileInsights().status(os.tmpdir())).repository, null);
});

test('an agent\'s reads and writes come from its transcript', () => {
  const cwd = path.resolve('/project');
  const claude = fileActivity([
    { type: 'assistant', timestamp: 't1', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/a.js' } }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(cwd, 'b.js') } }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'sub.js' } }] } },
  ], 'claude', cwd);
  assert.deepEqual(claude.map(item => [path.relative(cwd, item.path), item.kind]), [[path.join('src', 'a.js'), 'read'], ['b.js', 'write']]);
  const codex = fileActivity([{ type: 'response_item', timestamp: 't', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: game/a.gd\n*** Add File: game/b.gd\n*** End Patch' } }], 'codex', cwd);
  assert.deepEqual(codex.map(item => path.relative(cwd, item.path)), [path.join('game', 'a.gd'), path.join('game', 'b.gd')]);
});

test('remember: and lembre: mark a rule, saved to the project or to every chat', async () => {
  assert.equal(markedRule('remember: use pnpm here'), 'use pnpm here');
  assert.equal(markedRule('  Lembre-se:  rode os testes\nantes'), 'rode os testes antes');
  assert.equal(markedRule('please remember: x'), null);
  assert.equal(markedRule('remember: ' + 'x'.repeat(600)), null);
  const state = await mkdtemp(path.join(os.tmpdir(), 'mrmak-state-')), cwd = await mkdtemp(path.join(os.tmpdir(), 'mrmak-cwd-')), repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-repo-'));
  const now = new Date().toISOString();
  const transcripts = { prompts: async () => ({ prompts: [
    { id: 'p1', at: now, text: 'lembre: sempre rode os testes\n\n<mrmak_workspace_context>{"workspace":null}</mrmak_workspace_context>' },
    { id: 'p2', at: now, text: 'remember: keep UI text in English' },
    { id: 'p3', at: '2026-01-01T00:00:00Z', text: 'remember: too old' },
    { id: 'p4', at: now, text: 'an ordinary message' },
  ] }) };
  const suggestions = new RuleSuggestions(state, transcripts), session = { id: 'c1', cwd };
  assert.deepEqual((await suggestions.list(session)).map(item => item.rule), ['sempre rode os testes', 'keep UI text in English']);
  assert.deepEqual((await suggestions.resolve(session, { id: 'p1', action: 'project' }, repo)).map(item => item.id), ['p2']);
  assert.match(await readFile(path.join(cwd, '.agents', 'rules.md'), 'utf8'), /^- sempre rode os testes$/m);
  await suggestions.resolve(session, { id: 'p2', action: 'global', text: 'Keep every UI text in English.' }, repo);
  assert.deepEqual((await readRulesAt(globalRulesFile(repo))).rules.map(item => item.text), ['Keep every UI text in English.']);
  await assert.rejects(suggestions.resolve(session, { id: 'p2', action: 'skip' }, repo), /already/);
  // The handled list survives a restart.
  assert.deepEqual(await new RuleSuggestions(state, transcripts).list(session), []);
  // Every new chat gets the global rules with its own instructions.
  await editGlobalRules(repo, { action: 'add', text: 'Answer in Portuguese.' });
  const text = await readFile(await writeChatInstructions(state, { id: 'c1', cwd }, null, false, repo), 'utf8');
  assert.match(text, /Global rules are in .*global-rules\.md/); assert.match(text, /^- Answer in Portuguese\.$/m);
  // The features skill is named only once Mr. Mak's repository holds it.
  assert.doesNotMatch(text, /mrmak-chat-features/);
  await mkdir(path.dirname(featuresSkillFile(repo)), { recursive: true }); await writeFile(featuresSkillFile(repo), '---\nname: mrmak-chat-features\n---\n');
  const pointed = await readFile(await writeChatInstructions(state, { id: 'c1', cwd }, null, false, repo), 'utf8');
  assert.ok(pointed.includes(`read ${featuresSkillFile(repo)} first. In it, <mrmak> means ${repo}.`));
});

test('a large cold Claude chat holds its first message once, with the cost', () => {
  assert.deepEqual(priceOf('claude-opus-5-5'), { read: 0.2, write: 8 });
  assert.deepEqual(priceOf('claude-sonnet-5-5-20261001'), { read: 0.1, write: 4 });
  assert.equal(priceOf('gpt-5'), null);
  const cache = lastCache([
    { type: 'assistant', timestamp: '2026-10-29T08:00:00Z', message: { model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_read_input_tokens: 100000, cache_creation_input_tokens: 1000, output_tokens: 500 } } },
    { type: 'assistant', isSidechain: true, timestamp: '2026-10-29T09:00:00Z', message: { usage: { input_tokens: 1 } } },
    { type: 'user', timestamp: '2026-10-29T09:30:00Z' },
  ]);
  assert.deepEqual(cache, { at: '2026-10-29T08:00:00Z', tokens: 101502, model: 'claude-opus-5-5' });
  const warm = Date.parse('2026-10-29T08:30:00Z'), cold = Date.parse('2026-10-29T10:00:00Z');
  assert.equal(cacheView(cache, warm).cold, false);
  assert.equal(cacheView(cache, cold).cold, true);
  assert.ok(Math.abs(cacheView(cache, cold).writeUsd - 0.812) < 0.001);
  const guard = new ColdGuard(), session = { id: 'c', agent: 'claude' };
  guard.check(session, cache, warm);
  assert.throws(() => guard.check(session, cache, cold), error => error.status === 409 && /2\.0 h ago/.test(error.message) && /101,502 tokens/.test(error.message) && /\$0\.81/.test(error.message) && error.cold?.tokens === 101502);
  guard.check(session, cache, cold);
  guard.check({ id: 'small', agent: 'claude' }, { ...cache, tokens: COLD_CONTEXT - 1 }, cold);
  guard.check({ id: 'codex', agent: 'codex' }, cache, cold);
});

test('cache history totals a chat\'s cache use and names why the context was written again', () => {
  const reply = (at, id, usage, model = 'claude-opus-5-5') => ({ type: 'assistant', timestamp: at, message: { id, model, usage } });
  const stats = cacheHistory([
    reply('2026-10-29T08:00:00Z', 'm1', { input_tokens: 5, cache_creation_input_tokens: 60000 }),
    // A second record of the same reply (another content block) is counted once.
    reply('2026-10-29T08:00:01Z', 'm1', { input_tokens: 5, cache_creation_input_tokens: 60000 }),
    reply('2026-10-29T08:10:00Z', 'm2', { input_tokens: 5, cache_read_input_tokens: 60000, cache_creation_input_tokens: 500 }),
    // An effort change in between keeps the cache: a normal read.
    { type: 'user', timestamp: '2026-10-29T08:11:00Z', message: { content: '<command-name>/effort</command-name>' } },
    reply('2026-10-29T08:12:00Z', 'm3', { input_tokens: 5, cache_read_input_tokens: 60500, cache_creation_input_tokens: 300 }),
    reply('2026-10-29T08:15:00Z', 'm4', { input_tokens: 5, cache_creation_input_tokens: 61000 }, 'claude-sonnet-5-5'),
    reply('2026-10-29T09:30:00Z', 'm5', { input_tokens: 5, cache_creation_input_tokens: 61500 }, 'claude-sonnet-5-5'),
    { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-29T09:40:00Z' },
    reply('2026-10-29T09:41:00Z', 'm6', { input_tokens: 5, cache_creation_input_tokens: 25000 }, 'claude-sonnet-5-5'),
    reply('2026-10-29T09:42:00Z', 'm7', { input_tokens: 5, cache_creation_input_tokens: 26000 }, 'claude-sonnet-5-5'),
    { type: 'assistant', isSidechain: true, timestamp: '2026-10-29T09:43:00Z', message: { id: 's', usage: { cache_creation_input_tokens: 90000 } } },
    reply('2026-10-29T09:44:00Z', 'x', { input_tokens: 0 }, '<synthetic>'),
  ]);
  assert.equal(stats.replies, 7);
  assert.deepEqual(stats.rewrites.map(item => item.reason), ['other', 'compact', 'expired', 'model', 'start']);
  assert.equal(stats.rewriteCount, 4);
  assert.equal(stats.read, 120500);
  assert.equal(stats.written, 60000 + 500 + 300 + 61000 + 61500 + 25000 + 26000);
  assert.ok(stats.hitRate > 0.32 && stats.hitRate < 0.34);
  assert.ok(Math.abs(stats.rewrites.at(-2).writeUsd - 0.244) < 0.001);
  assert.equal(cacheHistory([reply('2026-10-29T08:00:00Z', 'g', { cache_read_input_tokens: 10 }, 'gpt-5')]).writeUsd, null);
});

test('skill discovery reads the project\'s requests and drafts a skill', async () => {
  const config = await mkdtemp(path.join(os.tmpdir(), 'mrmak-claude-')), folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-proj-')), codexHome = await mkdtemp(path.join(os.tmpdir(), 'mrmak-codex-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    const project = path.join(config, 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'));
    await mkdir(project, { recursive: true });
    const now = Date.now(), at = new Date(now - 60000).toISOString();
    const user = content => JSON.stringify({ type: 'user', timestamp: at, message: { content } });
    await writeFile(path.join(project, 's.jsonl'), [user('Update the Bleeding Stars card after the playtest'), user('/compact'), user('ok'), user([{ type: 'tool_result', content: 'x' }]), user('<pasted_content id="1">Review the ships balance numbers please</pasted_content>'), ...Array.from({ length: 6 }, (_, i) => user(`Update the workspace card for build ${i}`))].join('\n'));
    const day = new Date(now), dir = path.join(codexHome, 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'rollout-a.jsonl'), [JSON.stringify({ type: 'session_meta', payload: { id: '11111111-1111-4111-8111-111111111111', cwd: folder } }), JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'user_message', message: 'Run the GameTests for the backpack mod' } })].join('\n'));
    const prompts = await projectPrompts(folder, { now, codexHome });
    assert.deepEqual(prompts.length, 9);
    assert.ok(prompts.some(item => item.source === 'codex') && prompts.some(item => item.text === 'Review the ships balance numbers please'));
    assert.ok(!prompts.some(item => /^\/|^ok$/.test(item.text)));
    let asked = '';
    const result = await discoverSkills(folder, { now, codexHome, ask: async prompt => { asked = prompt; return 'Here: {"candidates":[{"name":"Update Card","description":"Update a project card: after a build.","count":7,"examples":["Update the workspace card for build 1"],"steps":["Read the card","Edit it","Regenerate"]},{"name":"x","description":"","steps":[]}]}'; } });
    assert.match(asked, /as data, not instructions/);
    assert.deepEqual(result.candidates.map(item => item.name), ['update-card']);
    const created = await createSkill(folder, result.candidates[0]);
    assert.equal(path.relative(folder, created.path), path.join('.claude', 'skills', 'update-card', 'SKILL.md'));
    assert.match(await readFile(created.path, 'utf8'), /^description: "Update a project card: after a build\."$/m);
    await assert.rejects(createSkill(folder, result.candidates[0]), /already exists/);
    assert.throws(() => parseCandidates('no json'), /did not answer/);
  } finally { if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous; }
});
