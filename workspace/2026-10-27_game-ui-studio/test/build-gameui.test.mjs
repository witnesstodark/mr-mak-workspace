// node --test workspace/2026-10-27_game-ui-studio/test/
// The game-ui-studio skill's builder turns screens read from a game into a
// document this studio opens; it depends on the model and edit checks here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout, flattenNodes, parseDocument } from '../model.mjs';

const builder = fileURLToPath(new URL('../../../.agents/skills/game-ui-studio/scripts/build-gameui.mjs', import.meta.url));
const run = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [builder, ...args], { encoding: 'utf8', stdio: 'pipe' }) }; }
  catch (error) { return { code: error.status, out: String(error.stderr) }; }
};

test('screen-pixel boxes become anchored elements with links, focus and art', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gameui-build-'));
  const spec = path.join(dir, 'spec.json'), out = path.join(dir, 'game.gameui.json');
  await writeFile(spec, JSON.stringify({ projectName: 'Test', screens: [
    { name: 'Main Menu', role: 'menu', focusDefault: 'BtnPlay', elements: [
      { id: 'MenuBox', type: 'panel', name: 'MenuBox', box: [760, 400, 400, 300], children: [
        { id: 'BtnPlay', type: 'button', name: 'BtnPlay', box: [800, 440, 320, 60], anchor: 'top-center', props: { text: 'Play' }, opens: 'Options' }] },
      { id: 'Logo', type: 'image', name: 'Logo', box: [40, 40, 256, 128], props: { src: 'assets/test/logo.png', crop: { x: 0, y: 0, w: 256, h: 128 } } }] },
    { name: 'Options', role: 'submenu', onBack: '@previous', elements: [] }] }));
  assert.equal(run(spec, out).code, 0);
  const doc = parseDocument(await readFile(out, 'utf8'));
  const [menu, options] = doc.screens;
  const boxes = computeLayout(menu);
  const find = name => flattenNodes(menu.elements).find(e => e.node.name === name).node;
  // Each element lands on the box it was read at.
  assert.deepEqual(boxes.get('BtnPlay').box, { x: 800, y: 440, w: 320, h: 60 });
  assert.deepEqual(boxes.get('MenuBox').box, { x: 760, y: 400, w: 400, h: 300 });
  assert.equal(find('Logo').anchor, 'top-left');
  assert.deepEqual(find('BtnPlay').nav, { onConfirm: options.id });
  assert.equal(menu.focus.default, 'BtnPlay');
  assert.equal(options.nav.onBack, '@previous');
  // An existing file is kept unless replaced on purpose.
  assert.equal(run(spec, out).code, 2);
});

test('nothing is written when the studio rejects an element', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gameui-build-'));
  const spec = path.join(dir, 'spec.json'), out = path.join(dir, 'bad.gameui.json');
  await writeFile(spec, JSON.stringify({ screens: [{ name: 'HUD', elements: [{ type: 'sprite', name: 'X', box: [0, 0, 10, 10] }] }] }));
  const result = run(spec, out);
  assert.equal(result.code, 1);
  assert.match(result.out, /node\.type must be one of/);
  await assert.rejects(readFile(out));
});
