import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../server.mjs';
import { StudioState, STUDIO_CODE } from '../ui-studio-state.mjs';

async function emptyRepo(name) {
  // A repository without any of the template's folders: only the Workspace registry.
  const repo = await realpath(await mkdtemp(path.join(os.tmpdir(), name)));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  return repo;
}

function client(service) {
  return async (route, data) => {
    const response = await fetch(service.origin + '/api' + route, data === undefined
      ? { headers: { Authorization: `Bearer ${service.token}` } }
      : { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, value: await response.json() };
  };
}

test('the UI Studio state is validated, saved atomically in the repository and survives a restart', async () => {
  const repo = await emptyRepo('mrmak-ui-studio-state-');
  let service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
  let call = client(service);
  const file = path.join(repo, '.mrmak/ui-studio/state.json');
  try {
    assert.deepEqual((await call('/ui-studio/state')).value, { projects: null, draft: null, prefs: null });
    const doc = JSON.stringify({ projectName: '', screens: [{ id: 's1', name: 'Main', elements: [] }], image: 'x'.repeat(2 * 1024 * 1024) });
    const saved = await call('/ui-studio/state', {
      projects: { roots: ['projects', ' D:/Games ', 'D:/Games', 7, ''], hidden: ['projects/old', 'x'.repeat(1001)] },
      draft: { doc, at: 200 }, prefs: { value: { grid: 8 }, at: 100 },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.value, { projects: { roots: ['projects', 'D:/Games'], hidden: ['projects/old'] }, draftAt: 200, prefsAt: 100 });
    // The file on disk is complete JSON, and no temporary file is left behind.
    assert.equal(JSON.parse(await readFile(file, 'utf8')).draft.doc, doc);
    assert.deepEqual((await readdir(path.dirname(file))).filter(name => name.endsWith('.tmp')), []);

    // An older copy from another tab, a draft that is not a studio document and
    // parts of the wrong shape change nothing.
    for (const patch of [
      { draft: { doc: JSON.stringify({ screens: [] }), at: 150 } },
      { draft: { doc: '{"no":"screens"}', at: 900 } },
      { draft: { doc: 'not json', at: 900 } },
      { prefs: { value: [1], at: 300 } },
      { prefs: { value: { big: 'x'.repeat(70 * 1024) }, at: 300 } },
      { projects: 'bogus' }, { projects: { roots: 'projects', hidden: [] } },
    ]) assert.equal((await call('/ui-studio/state', patch)).status, 200);
    assert.equal((await call('/ui-studio/state', ['not', 'an', 'object'])).status, 400);
    // The request itself is limited in size.
    assert.equal((await call('/ui-studio/state', { draft: { doc: 'x'.repeat(13 * 1024 * 1024), at: 999 } })).status, 413);

    await service.close();
    service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
    call = client(service);
    const state = (await call('/ui-studio/state')).value;
    assert.equal(state.draft.doc, doc);
    assert.equal(state.draft.at, 200);
    assert.deepEqual(state.prefs, { value: { grid: 8 }, at: 100 });
    assert.deepEqual(state.projects, saved.value.projects);
    // The skill scripts find the studio's code and data folder through studio.json.
    const pointer = JSON.parse(await readFile(path.join(repo, '.mrmak/ui-studio/studio.json'), 'utf8'));
    assert.equal(pointer.code, STUDIO_CODE);
    assert.equal(pointer.guidelines, path.join(STUDIO_CODE, 'guidelines.md'));
    await readFile(pointer.guidelines, 'utf8');
    assert.equal(pointer.assets, path.join(repo, '.mrmak/ui-studio/assets'));
  } finally { await service.close(); }
});

test('a damaged state file starts the studio empty instead of failing', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mrmak-ui-studio-damaged-')));
  await mkdir(path.join(dir, 'ui-studio'));
  await writeFile(path.join(dir, 'ui-studio/state.json'), '{"draft": {"doc": "{\\"screens\\":[]}", "at"');
  const state = await new StudioState(dir).init();
  assert.deepEqual(state.get(), { projects: null, draft: null, prefs: null });
  await writeFile(path.join(dir, 'ui-studio/state.json'), JSON.stringify({ projects: { roots: ['a'], hidden: [] }, draft: { doc: '[]', at: 5 }, prefs: { value: {}, at: -1 } }));
  // Only the valid parts of a saved file are restored.
  assert.deepEqual((await new StudioState(dir).init()).get(), { projects: { roots: ['a'], hidden: [] }, draft: null, prefs: null });
});

test('the bundled studio opens on its own origin with its data folder, and pages resolve to their final origin', async () => {
  const repo = await emptyRepo('mrmak-ui-studio-site-');
  await mkdir(path.join(repo, 'workspace/card'));
  await writeFile(path.join(repo, 'workspace/card/report.html'), '<!doctype html><html><head></head><body>Report</body></html>');
  await writeFile(path.join(repo, 'workspace/card/data.json'), '{}');
  const assets = path.join(repo, '.mrmak/ui-studio/assets');
  await mkdir(path.join(assets, 'game'), { recursive: true });
  await writeFile(path.join(assets, 'kits.json'), '{"kits":[]}');
  await writeFile(path.join(assets, 'game/page.html'), '<html><script>parent.postMessage(1, "*")</script></html>');
  const service = await createService({ repo, mcpOptions: { home: repo, env: {} } });
  const call = client(service), { files } = service;
  try {
    // A report page resolves to the port its shared-port address redirects to.
    const page = files.url(path.join(repo, 'workspace/card/report.html')) + '?mrmak-theme=light';
    const redirect = new URL((await fetch(page, { redirect: 'manual' })).headers.get('location'));
    const resolved = (await call('/content/resolve', { url: page })).value;
    assert.deepEqual(resolved, { url: redirect.href, origin: redirect.origin });
    assert.notEqual(resolved.origin, files.origin);
    assert.notEqual(resolved.origin, service.origin);
    // The final address resolves to itself; data files, other services and bad input do not resolve.
    assert.deepEqual((await call('/content/resolve', { url: resolved.url })).value, resolved);
    assert.equal((await call('/content/resolve', { url: files.url(path.join(repo, 'workspace/card/data.json')) })).status, 400);
    assert.equal((await call('/content/resolve', { url: `${service.origin}/index.html` })).status, 400);
    assert.equal((await call('/content/resolve', { url: 'not a url' })).status, 400);
    assert.equal((await call('/content/resolve', { url: `${files.origin}/view/unknown/report.html` })).status, 404);
    // Without the service token nothing resolves.
    assert.equal((await fetch(service.origin + '/api/content/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: page }) })).status, 401);

    // The studio is served from the app, not from this repository, on an origin of its own.
    const studio = (await call('/ui-studio/open', {})).value;
    assert.match(studio.url, /\/editor\.html$/);
    assert.equal(new URL(studio.url).origin, studio.origin);
    assert.ok(![files.origin, service.origin, resolved.origin].includes(studio.origin));
    assert.deepEqual((await call('/ui-studio/open', {})).value, studio, 'reopening keeps the same origin');
    const editor = await fetch(studio.url);
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /Game UI Studio/);
    const policy = editor.headers.get('content-security-policy'), own = studio.url.replace(/editor\.html$/, '');
    assert.ok(policy.includes(`connect-src ${own};`));
    assert.ok(policy.endsWith(`frame-ancestors ${files.uiOrigin} ${studio.origin}`));
    assert.equal((await fetch(own + 'editor.mjs')).status, 200);
    // assets/ is the repository's studio data folder; it serves data, never pages.
    assert.equal(await (await fetch(own + 'assets/kits.json')).text(), '{"kits":[]}');
    assert.equal((await fetch(own + 'assets/game/page.html')).status, 403);
    assert.equal((await fetch(own + 'assets/../../state.json')).status, 404);
    assert.equal((await fetch(own + 'assets/..%2F..%2Fstate.json')).status, 403);
    // The studio's origin serves the studio only: no repository file, no report.
    assert.equal((await fetch(`${studio.origin}/view/${files.repoGrant}/workspace/card/report.html`)).status, 404);
    assert.equal((await fetch(`${studio.origin}/view/${new URL(resolved.url).pathname.split('/')[2]}/workspace/card/report.html`)).status, 404);
  } finally { await service.close(); }
});
