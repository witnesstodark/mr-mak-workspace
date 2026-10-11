import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { MobileDictation, AUDIO_LIMIT } from '../mobile-dictation.mjs';

const audio = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]);
const request = (id = randomUUID(), bytes = audio, extra = {}) => Object.assign(Readable.from([bytes]), { headers: { 'content-type': 'audio/webm;codecs=opus', 'x-transcription-id': id, ...extra } });
async function fixture(t, options = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-dictation-'));
  const calls = [];
  const dictation = new MobileDictation(repo, { env: { OPENROUTER_API_KEY: 'test-key', MRMAK_TRANSCRIBE_PROVIDER: 'openrouter' }, fetcher: async (url, options) => { calls.push({ url, options }); return Response.json({ text: ' A spoken thought. ' }); }, ...options });
  t.after(() => dictation.close()); return { dictation, calls, repo };
}

test('dictation uses the desktop key, supported multipart audio and returns only text', async t => {
  const { dictation, calls } = await fixture(t);
  assert.equal((await dictation.status()).provider, 'openrouter');
  assert.deepEqual(await dictation.transcribe(request(), 'phone'), { text: 'A spoken thought.' });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/audio/transcriptions');
  const form = calls[0].options.body;
  assert.equal(form.get('model'), 'openai/gpt-4o-transcribe');
  assert.equal(form.get('file').name, 'recording.webm');
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), audio);
  assert.match(form.get('prompt'), /Do not translate/);
  assert.equal(form.has('language'), false);
  assert.ok(!JSON.stringify(await dictation.status()).includes('test-key'));
});

test('explicit provider, legacy key aliases and changes to .env work without exposing credentials', async t => {
  const { dictation, repo, calls } = await fixture(t, { env: { MRMAK_TRANSCRIBE_PROVIDER: 'openai' } });
  assert.equal((await dictation.status()).available, false);
  await assert.rejects(dictation.transcribe(request(), 'phone'), /needs OPENROUTER_API_KEY/);
  await writeFile(path.join(repo, '.env'), 'OPENAI_KEY=private-key\nOPENROUTER_KEY=router-key\nMRMAK_TRANSCRIBE_PROVIDER=openai\n');
  await dictation.transcribe(request(), 'phone');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].options.body.get('model'), 'gpt-4o-transcribe');
  await writeFile(path.join(repo, '.env'), 'OPENAI_KEY=private-key\nMRMAK_TRANSCRIBE_PROVIDER=off\n');
  assert.equal((await dictation.status()).available, false);
});

test('lost replies and concurrent retries reuse transcription; mismatched audio cannot reuse an ID', async t => {
  const { dictation, calls } = await fixture(t), id = randomUUID();
  const results = await Promise.all([dictation.transcribe(request(id), 'phone'), dictation.transcribe(request(id), 'phone')]);
  assert.deepEqual(results[0], results[1]); assert.equal(calls.length, 1);
  await dictation.transcribe(request(id), 'phone'); assert.equal(calls.length, 1);
  await assert.rejects(dictation.transcribe(request(id, Buffer.concat([audio, Buffer.from('different')])), 'phone'), error => error.status === 409);
});

test('invalid, oversized and revoked uploads never reach the provider', async t => {
  const { dictation, calls } = await fixture(t);
  await assert.rejects(dictation.transcribe(request(), 'phone', () => false), error => error.status === 401);
  await assert.rejects(dictation.transcribe(request('invalid'), 'phone'), /recording ID/);
  await assert.rejects(dictation.transcribe(request(randomUUID(), audio, { 'content-type': 'text/html' }), 'phone'), error => error.status === 415);
  await assert.rejects(dictation.transcribe(request(randomUUID(), Buffer.from('not audio')), 'phone'), error => error.status === 415);
  await assert.rejects(dictation.transcribe(request(randomUUID(), audio, { 'content-length': AUDIO_LIMIT + 1 }), 'phone'), error => error.status === 413);
  assert.equal(calls.length, 0);
});

test('provider errors are redacted, failed recordings can retry, and requests are rate limited', async t => {
  let fail = true;
  const { dictation } = await fixture(t, { fetcher: async () => { if (fail) throw new Error('secret-key or private provider content'); return Response.json({ text: 'Ready' }); } });
  const id = randomUUID();
  await assert.rejects(dictation.transcribe(request(id), 'phone'), error => !/secret-key|private provider/.test(error.message) && error.status === 502);
  fail = false;
  assert.equal((await dictation.transcribe(request(id), 'phone')).text, 'Ready');
  for (let i = 0; i < 4; i++) await dictation.transcribe(request(), 'phone');
  await assert.rejects(dictation.transcribe(request(), 'phone'), error => error.status === 429);
});

test('revoking a device aborts its paid request and clears cached text', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { dictation } = await fixture(t, { fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); entered(); }) });
  const pending = dictation.transcribe(request(), 'phone');
  const rejected = assert.rejects(pending);
  await started; dictation.revoke('phone'); await rejected;
  assert.equal(dictation.jobs.size, 0); assert.equal(dictation.controllers.size, 0);
});


test('local default ignores cloud keys and retries failures without any cloud call', async t => {
  let attempts = 0;
  const { dictation, calls } = await fixture(t, { env: { OPENAI_API_KEY: 'unused-key' }, localStatus: async () => true,
    localRunner: async () => { attempts++; if (attempts === 1) throw new Error('Local failure'); return { text: ' Local draft. ' }; } });
  assert.equal((await dictation.status()).provider, 'local');
  const id = randomUUID();
  await assert.rejects(dictation.transcribe(request(id), 'desktop'));
  assert.deepEqual(await dictation.transcribe(request(id), 'desktop'), { text: 'Local draft.' });
  assert.deepEqual(await dictation.transcribe(request(id), 'desktop'), { text: 'Local draft.' });
  assert.equal(attempts, 2); assert.equal(calls.length, 0);
});

test('uninstalled local engine and silence never fall back to cloud', async t => {
  const { dictation, calls } = await fixture(t, { env: { OPENAI_API_KEY: 'unused-key' }, localStatus: async () => false });
  await assert.rejects(dictation.transcribe(request(), 'phone'), error => error.status === 503);
  assert.equal(calls.length, 0);
  dictation.localStatus = async () => true; dictation.localRunner = async () => ({ text: '' });
  await assert.rejects(dictation.transcribe(request(), 'phone'), error => error.status === 422);
  assert.equal(calls.length, 0);
});
