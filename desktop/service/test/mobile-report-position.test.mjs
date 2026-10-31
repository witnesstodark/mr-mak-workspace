import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), key: index => [...saved.keys()][index] ?? null, get length() { return saved.size; } };
globalThis.location = { origin: 'https://phone.example' };
const { reportPosition, saveReportPosition } = await import('../../../src/mobile/app-state.ts');
const url = (page, grant = 'private-grant') => `/mobile/view/${grant}/workspace/review/${page}.html`;
const position = (page, top = 0) => ({ path: `workspace/review/${page}.html`, top, left: 0 });
beforeEach(() => saved.clear());

test('inserting Editor does not restore the page formerly occupying its index', () => {
  saveReportPosition('card', 2, position('entregas', 450));
  assert.deepEqual(reportPosition('card', 2, url('editor')), { top: 0, left: 0 });
});

test('legacy entry-page positions follow their document after a tab insertion', () => {
  saveReportPosition('card', 2, position('entregas', 450));
  saveReportPosition('card', 3, position('arquivo', 800));
  assert.equal(reportPosition('card', 3, url('entregas')).top, 450);
  assert.equal(reportPosition('card', 4, url('arquivo')).top, 800);
});

test('nested pages and anchors stay with their tab through reorder and grant renewal', () => {
  saveReportPosition('card', 2, { ...position('chapter', 500), hash: '#timing' }, url('editor'));
  saveReportPosition('card', 3, position('arquivo', 700), url('arquivo'));
  const restored = reportPosition('card', 4, url('editor', 'renewed-grant'));
  assert.equal(restored.path, 'workspace/review/chapter.html');
  assert.equal(restored.hash, '#timing');
  assert.equal(restored.top, 500);
  assert.equal(reportPosition('card', 2, url('arquivo')).top, 700);
  assert.ok(!JSON.stringify([...saved]).includes('private-grant'));
  assert.ok(!JSON.stringify([...saved]).includes('renewed-grant'));
});

test('unowned legacy inner routes cannot redirect a newly inserted tab', () => {
  saveReportPosition('card', 2, position('chapter', 400));
  assert.deepEqual(reportPosition('card', 2, url('editor')), { top: 0, left: 0 });
});
