import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { requestDate } from '../quick-actions.mjs';
import { taskEffort } from '../effort.mjs';
import { terminalCommand, inventory } from '../agents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'quick-actions-test-'));
  await mkdir(path.join(repo, 'workspace', 'test-card'), { recursive: true }); await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Test</html>');
  await writeFile(path.join(repo, 'workspace', 'test-card', 'report.html'), '<html><style>hidden styles</style><h1>Test report</h1><p>The animation was exported.</p><script>not report content</script></html>');
  const entities = [{ id: 'test-card', title: 'Animation Review', description: 'Reviewing the animation export.', folder: 'test-card', created: '2026-09-10', updated: '2026-09-12', status: 'active', steps: [{ name: 'Review', path: 'report.html' }], extra: 'preserve me' }, { id: 'another-card', title: 'Another Review', description: 'A separate task.', status: 'done', created: '2026-09-09', steps: [] }];
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities, extraRoot: true }, null, 2));
  const events = [];
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), native: event => events.push(event) });
  service.coordinator.ask = async () => { throw new Error('A direct action must not use an LLM.'); };
  const request = async (id, text, extra = {}) => {
    const response = await fetch(service.origin + '/api/coordinator', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text, ...extra }) });
    assert.equal(response.status, 200); return response.json();
  };
  return { repo, service, events, request };
}

test('direct card actions and date lookups bypass the model and never open worker chats', async () => {
  const { repo, service, request, events } = await fixture();
  try {
    const open = await request('open', 'Открой карточку Animation Review'); assert.equal(open.route, 'direct'); assert.equal(open.status, 'completed');
    assert.ok(events.some(event => event.type === 'window' && event.window === 'workspace'));
    const archive = await request('archive', 'Архивируй эту карточку'); assert.equal(archive.status, 'completed');
    let registry = JSON.parse(await readFile(path.join(repo, 'workspace', 'workspace.json'), 'utf8'));
    assert.equal(registry.entities[0].status, 'archived'); assert.equal(registry.entities[0].extra, 'preserve me'); assert.equal(registry.extraRoot, true); assert.equal(registry.entities[1].status, 'done');
    await request('restore', 'Верни из архива эту карточку');
    await request('done', 'Отметь эту карточку готовой');
    registry = JSON.parse(await readFile(path.join(repo, 'workspace', 'workspace.json'), 'utf8')); assert.equal(registry.entities[0].status, 'done');
    const read = await request('read', 'Прочитай эту карточку'); assert.match(read.result, /animation was exported/); assert.doesNotMatch(read.result, /hidden styles|not report content/);
    const day = await request('date', 'Что делали 10 сентября 2026?'); assert.match(day.result, /Animation Review/);
    service.quick.context = () => ({ chats: [{ id: 'unrelated-chat', name: 'Animation Review' }], route: '#/test-card' });
    const current = await request('current-card', 'Открой эту карточку', { selectedId: 'unrelated-chat' }); assert.equal(current.status, 'completed'); assert.match(current.result, /card/);
    await request('pin-card', 'Закрепи эту карточку', { selectedId: 'unrelated-chat' }); assert.equal((await service.workspace.registry()).entities[0].pinned, true);
    assert.equal(await service.quick.ask({ id: 'ambiguous-surface', text: 'Открой Animation Review' }), null);
    assert.equal(await service.quick.ask({ id: 'compound', text: 'Что делали вчера и архивируй Animation Review' }), null);
    assert.equal(service.sessions.list().length, 0); assert.equal(service.coordinator.child, null);
    assert.deepEqual(await request('archive', 'Архивируй эту карточку'), archive);
    assert.equal((await service.workspace.registry()).entities[0].status, 'done');
    assert.equal(await service.quick.ask({ id: 'ambiguous', text: 'Архивируй Review' }), null);
    assert.equal(await service.quick.ask({ id: 'research', text: 'Исследуй лучшие способы анимации и сделай карточку' }), null);
  } finally { await service.close(); }
});

test('reasoning is medium or above, research uses xhigh, and max needs an explicit request', () => {
  assert.equal(taskEffort('Fix a typo'), 'medium');
  assert.equal(taskEffort('Implement the project integration'), 'high');
  assert.equal(taskEffort('Сделай research карточку'), 'xhigh');
  assert.equal(taskEffort('Research animation', 'max'), 'xhigh');
  assert.equal(taskEffort('Use max effort for the research', 'medium'), 'max');
  assert.equal(taskEffort('Do not use max effort', 'max'), 'xhigh');
  assert.equal(taskEffort('Не используй max effort', 'max'), 'xhigh');
  assert.equal(taskEffort('Implement a 3ds Max export'), 'high');
  assert.equal(taskEffort('Use maximum effort for the research'), 'max');
  assert.equal(requestDate('31.02.2026'), null);
  assert.equal(requestDate('Что делали вчера?', new Date(2026, 8, 12)), '2026-09-11');
  assert.equal(requestDate('10 сентября 2026'), '2026-09-10');
  assert.equal(requestDate('10.09.2026'), '2026-09-10');
  for (const agent of ['codex', 'claude']) {
    if (!inventory().find(item => item.id === agent)?.available) continue;
    const command = terminalCommand(agent, { effort: 'xhigh', bypass: false });
    // A native .exe (Claude's own installer) is launched directly, not through PowerShell.
    const script = command.args.includes('-EncodedCommand') ? Buffer.from(command.args.at(-1), 'base64').toString('utf16le') : command.args.join(' ');
    assert.match(script, agent === 'codex' ? /model_reasoning_effort="xhigh"/ : /--effort[' ]+xhigh/);
  }
});
