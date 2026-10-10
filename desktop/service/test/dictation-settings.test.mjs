import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../server.mjs';
import { MobileDictation } from '../mobile-dictation.mjs';

test('paired phone and desktop share persisted dictation choice, reject untrusted changes and expose no keys', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-dictation-settings-'));
  await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const options = () => ({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} }, mobileOptions: {
    dictation: new MobileDictation(repo, { env: { OPENAI_API_KEY: 'private-test-key', OPENROUTER_API_KEY: 'private-router-key' }, localStatus: async () => true }),
    transport: { probe: async () => ({ ready: true }), enable: async origin => ({ origin }), disable: async () => {} },
  } });
  let service = await createService(options());
  const desktop = (provider) => fetch(service.origin + '/api/dictation', { method: provider ? 'POST' : 'GET', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: provider ? JSON.stringify({ provider }) : undefined });
  try {
    assert.equal((await (await desktop()).json()).provider, 'local');
    assert.equal((await desktop('invalid')).status, 400);
    await desktop('openai');
    const info = await (await desktop()).json();
    assert.equal(info.provider, 'openai'); assert.equal(info.providers.length, 4);
    assert.ok(!JSON.stringify(info).includes('private-test-key'));
    await service.mobile.enable();
    const qr = await service.mobile.newPairing();
    const pending = service.mobile.claim({ token: new URL(qr.url).hash.slice(6), name: 'Test phone' });
    await service.mobile.approve(pending.id);
    const finish = await fetch(service.mobile.origin + '/mobile/api/pair/finish', { method: 'POST', headers: { Origin: service.mobile.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
    const cookie = finish.headers.get('set-cookie').split(';')[0];
    const phone = (provider, extra = {}) => fetch(service.mobile.origin + '/mobile/api/dictation', { method: provider ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: service.mobile.origin, 'Content-Type': 'application/json', ...extra }, body: provider ? JSON.stringify({ provider }) : undefined });
    assert.equal((await (await phone()).json()).provider, 'openai');
    assert.equal((await phone('local', { Cookie: '' })).status, 401);
    assert.equal((await phone('local', { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await phone('invalid')).status, 400);
    await phone('openrouter'); assert.equal((await (await desktop()).json()).provider, 'openrouter');
    await phone('off'); assert.equal((await (await desktop()).json()).available, false);
    await service.close(); service = await createService(options());
    assert.equal((await (await desktop()).json()).provider, 'off');
    await desktop('local'); assert.equal((await (await desktop()).json()).available, true);
  } finally { await service.close(); }
});
