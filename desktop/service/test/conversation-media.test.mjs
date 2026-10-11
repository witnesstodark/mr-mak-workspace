import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationMedia, imageReferences } from '../conversation-media.mjs';
import { transcriptMessages } from '../mobile-transcript.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII=', 'base64');
const inline = `data:image/png;base64,${png.toString('base64')}`;

test('Claude and Codex retain image-only records while hiding tool text and reasoning', () => {
  const content = [{ type: 'tool_result', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }, { type: 'text', text: 'private tool output' }] }];
  const claude = transcriptMessages([{ type: 'user', message: { content } }, { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }] } }], 'claude');
  assert.equal(claude.length, 1); assert.equal(claude[0].role, 'assistant'); assert.equal(claude[0].text, ''); assert.deepEqual(claude[0].imageRefs, [inline]);
  const codex = transcriptMessages([{ type: 'event_msg', payload: { type: 'agent_message', message: 'Result' } }, { type: 'response_item', payload: { type: 'function_call_output', output: JSON.stringify({ content: [{ type: 'image', image_url: inline }] }) } }], 'codex');
  assert.equal(codex.length, 2); assert.deepEqual(codex[1].imageRefs, [inline]);
  assert.deepEqual(imageReferences([], '![Preview](<C:/Project with spaces/preview.png>)'), ['C:/Project with spaces/preview.png']);
});

test('exact image grants isolate devices/sessions, expire, validate bytes and reject network paths', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mak-media-'));
  try {
    const file = path.join(folder, 'picture.png'); await writeFile(file, png);
    await writeFile(path.join(folder, 'fake.png'), '<html>not an image</html>');
    const media = new ConversationMedia(), session = { id: 'chat', cwd: folder };
    const shown = await media.present({ supported: true, messages: [{ id: 'one', text: 'Picture', imageRefs: [file, inline, 'fake.png', 'https://example.com/picture.png', '//server/picture.png'] }] }, session, 'phone');
    assert.equal(shown.messages[0].imageRefs, undefined);
    assert.equal(shown.messages[0].images.length, 5);
    assert.equal(shown.messages[0].images[2].unavailable, true);
    assert.equal(shown.messages[0].images[3].unavailable, true);
    assert.equal(shown.messages[0].images[4].unavailable, true);
    const token = shown.messages[0].images[0].url.split('/').pop();
    const serve = async (chat = 'chat', phone = 'phone', download = false) => {
      let status, headers, body;
      await media.serve({ method: 'GET' }, { writeHead: (code, h) => { status = code; headers = h; }, end: value => { body = value; } }, chat, token, phone, download);
      return { status, headers, body };
    };
    const good = await serve(); assert.equal(good.status, 200); assert.deepEqual(good.body, png);
    assert.equal(good.headers['Content-Type'], 'image/png'); assert.equal(good.headers['Cache-Control'], 'no-store');
    assert.match((await serve('chat', 'phone', true)).headers['Content-Disposition'], /^attachment;/);
    assert.equal((await serve('other-chat')).status, 404); assert.equal((await serve('chat', 'other-phone')).status, 404);
    await writeFile(file, '<html>replaced</html>'); assert.equal((await serve()).status, 404);
    await writeFile(file, png); media.grants.get(token).expires = 0; assert.equal((await serve()).status, 404);
    await media.present({ messages: [{ imageRefs: [inline] }] }, session, 'phone'); media.revoke('phone'); assert.equal(media.grants.size, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
