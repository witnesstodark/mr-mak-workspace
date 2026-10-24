import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('native credentials only reach the main app document and can be consumed once per load', async () => {
  const script = (await readFile(new URL('../../../src-tauri/src/desktop-auth.js', import.meta.url), 'utf8'))
    .replace('__MRMAK_SERVICE_ORIGIN__', JSON.stringify('http://127.0.0.1:1234'))
    .replace('__MRMAK_SERVICE_TOKEN__', JSON.stringify('fixture-only'));
  for (const [origin, pathname, child, allowed] of [
    ['http://127.0.0.1:1234', '/', false, true],
    ['http://127.0.0.1:1234', '/', true, false],
    ['http://127.0.0.1:1234', '/view/report', false, false],
    ['http://127.0.0.1:4321', '/', false, false],
    ['https://unrelated.example', '/', false, false],
  ]) {
    const window = {}; window.top = child ? {} : window;
    const context = { window, location: { origin, pathname } };
    vm.runInNewContext(script, context);
    assert.equal(window.__MRMAK_BOOTSTRAP_TOKEN__, allowed ? 'fixture-only' : undefined);
    delete window.__MRMAK_BOOTSTRAP_TOKEN__;
    assert.equal(window.__MRMAK_BOOTSTRAP_TOKEN__, undefined);
  }
});
