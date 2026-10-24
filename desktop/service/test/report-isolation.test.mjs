import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createService } from '../server.mjs';

test('script-capable documents get an opaque origin and an expiring grant for their own folder', async () => {
  // macOS /var and Windows runner short paths can alias the canonical temp folder.
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mrmak-report-isolation-')));
  const repo = path.join(base, 'repo'), outside = path.join(base, 'downloads');
  for (const folder of ['workspace/card/assets', 'workspace/other', 'workspace/_shared', 'context', 'ui']) await mkdir(path.join(repo, folder), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(repo, 'ui/index.html'), '<html>Fixture</html>');
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  await writeFile(path.join(repo, 'workspace/card/report.html'), '<!doctype html><html><head></head><body>Report</body></html>');
  await writeFile(path.join(repo, 'workspace/card/assets/data.json'), 'own-data');
  await writeFile(path.join(repo, 'workspace/card/picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
  await writeFile(path.join(repo, 'workspace/other/report.html'), '<html>Other</html>');
  await writeFile(path.join(repo, 'workspace/other/data.json'), 'other-data');
  await writeFile(path.join(repo, 'workspace/top.html'), '<html>Top</html>');
  await writeFile(path.join(repo, 'workspace/_shared/report.css'), 'body{}');
  await writeFile(path.join(repo, 'workspace/_shared/private.json'), 'shared-private');
  await writeFile(path.join(repo, 'context/goals.md'), 'private-context');
  await writeFile(path.join(repo, 'root.html'), '<html>Root</html>');
  await writeFile(path.join(repo, '.env'), 'OPENAI_API_KEY=not-a-real-key\n');
  await writeFile(path.join(outside, 'page.html'), '<html>Downloaded</html>');
  await writeFile(path.join(outside, 'page.css'), 'body{}');
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  try {
    const { files } = service, repoToken = files.repoGrant;
    const open = async file => {
      const first = await fetch(files.url(file) + '?mrmak-theme=light', { redirect: 'manual' });
      assert.equal(first.status, 302);
      const location = new URL(first.headers.get('location'), files.origin);
      return { location, token: location.pathname.split('/')[2], response: await fetch(location) };
    };
    const status = async (token, relative) => (await fetch(`${files.origin}/view/${token}/${relative}`)).status;

    // The document's own address never carries the repository-wide token.
    const report = await open(path.join(repo, 'workspace/card/report.html'));
    assert.notEqual(report.token, repoToken); assert.equal(report.location.pathname.endsWith('/workspace/card/report.html'), true);
    assert.equal(report.location.searchParams.get('mrmak-theme'), 'light');
    assert.equal(report.response.status, 200); assert.match(await report.response.text(), /data-mrmak-links/);
    const policy = report.response.headers.get('content-security-policy'), own = `${files.origin}/view/${report.token}/workspace/card/`;
    assert.match(policy, /^sandbox allow-scripts allow-forms allow-popups allow-downloads;/);
    assert.ok(!policy.includes('allow-same-origin')); assert.ok(!policy.includes('allow-popups-to-escape-sandbox'));
    assert.ok(policy.includes(`connect-src ${own};`)); assert.ok(policy.includes("default-src 'none'")); assert.ok(policy.includes("form-action 'none'"));
    assert.ok(!policy.includes(repoToken));

    // The scoped grant serves the report folder and the shared report assets only.
    assert.equal(await status(report.token, 'workspace/card/assets/data.json'), 200);
    assert.equal(await status(report.token, 'workspace/_shared/report.css'), 200);
    await symlink(path.join(repo, 'context'), path.join(repo, 'workspace/card/linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await status(report.token, 'workspace/card/linked/goals.md'), 403);
    for (const relative of ['workspace/other/data.json', 'workspace/other/report.html', 'context/goals.md', 'workspace/workspace.json', 'workspace/_shared/private.json', 'root.html', '.env', 'workspace/card/../other/data.json', 'workspace/card/%2e%2e/other/data.json', 'workspace/card%2f..%2fother/data.json']) {
      assert.equal(await status(report.token, relative), 403, relative);
    }
    // Reopening reuses the folder's grant. The trusted UI keeps its own access to media.
    assert.equal((await open(path.join(repo, 'workspace/card/report.html'))).token, report.token);
    assert.notEqual((await open(path.join(repo, 'workspace/other/report.html'))).token, report.token);
    assert.equal(await status(repoToken, 'workspace/card/assets/data.json'), 200);

    // SVG is script-capable too, also when opened directly in a browser.
    const svg = await open(path.join(repo, 'workspace/card/picture.svg'));
    assert.equal(svg.token, report.token); assert.match(svg.response.headers.get('content-security-policy'), /^sandbox allow-scripts/);

    // A document at the top of the repository or of workspace/ gets itself only.
    for (const relative of ['root.html', 'workspace/top.html']) {
      const top = await open(path.join(repo, relative));
      assert.equal(top.response.status, 200);
      assert.equal(await status(top.token, 'workspace/card/assets/data.json'), 403); assert.equal(await status(top.token, 'context/goals.md'), 403);
      await writeFile(path.join(repo, relative + '-private'), 'sibling');
      assert.equal(await status(top.token, relative + '-private'), 403);
    }

    // A previewed file outside the repository gets its folder, through an expiring grant.
    const page = await open(path.join(outside, 'page.html'));
    assert.equal(page.response.status, 200); assert.equal(await status(page.token, 'page.css'), 200);
    assert.ok(!page.response.headers.get('content-security-policy').includes('workspace/_shared'));

    files.scoped.get(report.token).expires = Date.now() - 1;
    assert.equal(await status(report.token, 'workspace/card/assets/data.json'), 404);
    assert.equal(files.scoped.has(report.token), false);
  } finally { await service.close(); }
});
