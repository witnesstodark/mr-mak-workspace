import test from 'node:test';
import assert from 'node:assert/strict';
import { cardCover, cardPhase, cardProgress } from '../../../src/lib/card-meta.ts';
import { cardPhase as servicePhase, cardProgress as serviceProgress } from '../workspace.mjs';

// The desktop card and the phone list must accept and reject the same values.
const progressCases = [
  [{ done: 3, total: 8, label: ' M1 ' }, { done: 3, total: 8, label: 'M1' }],
  [{ done: 0, total: 5 }, { done: 0, total: 5 }],
  [{ done: 8, total: 8, label: '' }, { done: 8, total: 8 }],
  [{ done: 9, total: 8 }, null], [{ done: 1, total: 0 }, null], [{ done: 0, total: -2 }, null], [{ done: -1, total: 4 }, null],
  [{ done: '3', total: 8 }, null], [{ done: 3 }, null], [{ done: NaN, total: 4 }, null], [{ done: 1, total: Infinity }, null],
  [[], null], ['3/8', null], [7, null], [null, null], [undefined, null],
];

test('progress shows only a bar that can be drawn, identically on the desktop and the phone', () => {
  for (const [input, expected] of progressCases) {
    const desktop = cardProgress({ progress: input }), phone = serviceProgress(input);
    assert.deepEqual(phone ?? null, expected, JSON.stringify(input));
    assert.deepEqual(desktop && { done: desktop.done, total: desktop.total, ...(desktop.label ? { label: desktop.label } : {}) }, expected, JSON.stringify(input));
  }
  assert.equal(cardProgress({ progress: { done: 1, total: 3 } }).percent, 33.3);
  assert.equal(cardProgress({ progress: { done: 8, total: 8 } }).percent, 100);
});

test('cover and phase must be non-empty text', () => {
  assert.equal(cardCover({ cover: 'media/cover.webp' }), 'media/cover.webp');
  assert.equal(cardPhase({ phase: '  Alpha  ' }), 'Alpha'); assert.equal(servicePhase('  Alpha  '), 'Alpha');
  for (const value of [undefined, null, '', '   ', 7, {}, []]) {
    assert.equal(cardCover({ cover: value }), null); assert.equal(cardPhase({ phase: value }), null); assert.equal(servicePhase(value), undefined);
  }
});
