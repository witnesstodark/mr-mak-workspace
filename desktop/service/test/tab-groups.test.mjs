import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedChats, projectKey } from '../../../src/desktop/chatOrder.ts';

test('grouped tabs keep each project at its first tab and their own order within it', () => {
  const tab = (id, cwd, tabOrder, extra = {}) => ({ id, cwd, tabOrder, open: true, pinned: false, ...extra });
  const sessions = [tab('a', 'E:\\Game', 0), tab('b', 'E:\\Tools', 1), tab('c', 'e:\\game\\', 2), tab('d', '/home/me/Site', 3), tab('e', '/home/me/site', 4), tab('f', 'E:\\Tools', 5, { open: false }), tab('g', 'E:\\Tools', 6, { pinned: true })];
  assert.deepEqual(orderedChats(sessions).map(item => item.id), ['g', 'a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(orderedChats(sessions, true).map(item => item.id), ['g', 'b', 'a', 'c', 'd', 'e']);
  assert.equal(projectKey('E:\\Game\\'), projectKey('e:\\game'));
  assert.notEqual(projectKey('/home/me/Site'), projectKey('/home/me/site'));
});
