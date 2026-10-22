import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../server.mjs';

async function fixture(sessions) {
  await mkdir('.cache', { recursive: true });
  const repo = await mkdtemp(path.resolve('.cache/project-groups-'));
  await mkdir(path.join(repo, 'workspace'));
  await mkdir(path.join(repo, '.mrmak'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(sessions));
  return repo;
}
const tab = (id, cwd, tabOrder, extra = {}) => ({ id, cwd, tabOrder, name: id, agent: 'shell', open: true, pinned: false, status: 'stopped', createdAt: '2026-10-20T12:00:00Z', ...extra });

test('the project button groups open tabs by folder, ungroups them, and restores the same names', async () => {
  const a = path.resolve('.cache/A/Game'), b = path.resolve('.cache/B/Game');
  const repo = await fixture([tab('One', a, 0), tab('Two', b, 1), tab('Three', a, 2), tab('Pinned', b, 3, { pinned: true }), tab('History', path.resolve('.cache/C/Game'), 4, { open: false, group: 'Archive' })]);
  const app = await createService({ repo, mcpOptions: { home: repo, env: {} } });
  try {
    const request = headers => fetch(app.origin + '/api/groups/by-project', { method: 'POST', headers });
    assert.equal((await request({})).status, 401);
    const headers = { Authorization: `Bearer ${app.token}` };
    assert.equal((await request(headers)).status, 200);
    // Same-named folders get separate groups; a project's tabs sit together; pinned tabs stay first.
    const ids = app.sessions.active().map(item => item.id);
    assert.deepEqual(ids, ['Pinned', 'One', 'Three', 'Two']);
    const first = app.sessions.get('One').group, second = app.sessions.get('Two').group;
    assert.ok(first && second); assert.notEqual(first, second);
    assert.equal(app.sessions.get('Three').group, first);
    assert.equal(app.sessions.get('Pinned').group, second);
    assert.equal(app.sessions.projectGrouped(), true);
    assert.equal(app.sessions.get('History').group, 'Archive');
    assert.equal(app.sessions.get('History').tabOrder, 4);
    // Pressed again, it ungroups the open tabs in place; the closed chat keeps its group.
    await request(headers);
    assert.deepEqual(app.sessions.active().map(item => item.id), ids);
    assert.deepEqual(app.sessions.active().map(item => item.group), [null, null, null, null]);
    assert.equal(app.sessions.get('History').group, 'Archive');
    await request(headers);
    assert.deepEqual(app.sessions.active().map(item => item.id), ids);
    assert.equal(app.sessions.get('One').group, first); assert.equal(app.sessions.get('Two').group, second);
  } finally { await app.close(); }
});
