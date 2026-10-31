import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../server.mjs';

test('the UI Studio project list, draft and preferences are cleaned and survive a service restart', async () => {
  await mkdir('.cache', { recursive: true });
  const repo = await mkdtemp(path.resolve('.cache/ui-studio-state-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  let service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
  const call = async patch => {
    const response = await fetch(service.origin + '/api/ui-studio/state', patch ? { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) } : { headers: { Authorization: `Bearer ${service.token}` } });
    assert.ok(response.ok);
    return response.json();
  };
  try {
    assert.deepEqual(await call(), { projects: null, draft: null, prefs: null });
    const big = 'x'.repeat(2 * 1024 * 1024); // A draft with an embedded image.
    const saved = await call({
      projects: { roots: ['projects', ' E:/Games ', 'E:/Games', 7, ''], hidden: ['projects/izztudio', 'x'.repeat(1001)] },
      draft: { doc: big, at: 200 }, prefs: { value: { grid: 8 }, at: 100 },
    });
    assert.deepEqual(saved, { projects: { roots: ['projects', 'E:/Games'], hidden: ['projects/izztudio'] }, draftAt: 200, prefsAt: 100 });
    // An older copy from another tab is ignored; invalid parts change nothing.
    await call({ draft: { doc: 'old', at: 150 }, prefs: { value: [1], at: 300 }, projects: 'bogus' });
    await service.close();
    service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
    const state = await call();
    assert.equal(state.draft.doc, big);
    assert.deepEqual(state.prefs, { value: { grid: 8 }, at: 100 });
    assert.deepEqual(state.projects, saved.projects);
  } finally { await service.close(); }
});
