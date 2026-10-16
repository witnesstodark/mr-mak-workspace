import test from 'node:test';
import assert from 'node:assert/strict';
import { anySignal } from '../../../src/lib/abort.ts';
import { deferredClipboardWrite } from '../../../src/desktop/terminalClipboard.ts';

test('anySignal combines signals without AbortSignal.any (WebKit < 17.4)', async () => {
  const native = AbortSignal.any;
  try {
    AbortSignal.any = undefined;
    const first = new AbortController(), second = new AbortController();
    const combined = anySignal([first.signal, second.signal]);
    assert.equal(combined.aborted, false);
    second.abort(new Error('stop'));
    assert.equal(combined.aborted, true);
    assert.equal(combined.reason.message, 'stop');
    first.abort('later'); assert.equal(combined.reason.message, 'stop', 'first abort wins');
    const done = new AbortController(); done.abort('already');
    assert.equal(anySignal([new AbortController().signal, done.signal]).reason, 'already');
    const timed = anySignal([new AbortController().signal, AbortSignal.timeout(10)]);
    // AbortSignal.timeout does not keep the event loop alive, so hold it open.
    const keepAlive = setTimeout(() => {}, 5000);
    try { await new Promise(resolve => timed.addEventListener('abort', resolve, { once: true })); }
    finally { clearTimeout(keepAlive); }
    assert.equal(timed.reason.name, 'TimeoutError');
  } finally { AbortSignal.any = native; }
  const native2 = anySignal([AbortSignal.abort('x')]);
  assert.equal(native2.reason, 'x');
});

test('deferred clipboard write starts at arm time and is filled or cancelled later', async () => {
  globalThis.ClipboardItem = class { constructor(items) { this.items = items; } getType(type) { return this.items[type]; } };
  try {
    assert.equal(deferredClipboardWrite(undefined, () => {}), null);
    assert.equal(deferredClipboardWrite({ writeText() {} }, () => {}), null, 'stubbed clipboard without write falls back');
    const writes = [], errors = [];
    const clipboard = { write: items => { writes.push(items[0]); return items[0].getType('text/plain').then(() => {}) } };
    const pending = deferredClipboardWrite(clipboard, error => errors.push(error));
    assert.equal(writes.length, 1, 'write starts immediately, inside the gesture');
    pending.fill('Selected ✓');
    assert.equal(await (await writes[0].getType('text/plain')).text(), 'Selected ✓');
    const cancelled = deferredClipboardWrite(clipboard, error => errors.push(error));
    cancelled.cancel();
    await assert.rejects(writes[1].getType('text/plain'));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(errors, [], 'an expired copy never reports an error');
    const failing = deferredClipboardWrite({ write: () => Promise.reject(new Error('denied')) }, error => errors.push(error));
    failing.fill('x'); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(errors[0].message, 'denied', 'a filled copy that fails is reported');
  } finally { delete globalThis.ClipboardItem; }
});
