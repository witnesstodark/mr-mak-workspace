// node --test workspace/2026-10-27_game-ui-studio/test/
// The game kit: the skill's build-kit script, the studio's reading of kit.json
// and the skin, slice and font props the kit puts on elements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultDocument, flattenNodes } from '../model.mjs';
import { planEdit } from '../edits.mjs';
import { normalizeKit, kitFor, skinProps, instantiate, assetNode } from '../kit.mjs';

const builder = fileURLToPath(new URL('../../../.agents/skills/game-ui-studio/scripts/build-kit.mjs', import.meta.url));

// A PNG header is enough for the size reader.
function png(w, h, seed = 0) {
  const buf = Buffer.alloc(33 + seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

test('build-kit measures, sorts and pairs the art and lists the kit for its project', async () => {
  const studio = await mkdtemp(path.join(os.tmpdir(), 'gameui-kit-'));
  const ui = path.join(studio, 'assets/game/ui');
  await mkdir(path.join(ui, 'icons'), { recursive: true });
  await mkdir(path.join(studio, 'assets/game/delivery'), { recursive: true });
  await mkdir(path.join(studio, 'assets/game/Source'), { recursive: true });
  await writeFile(path.join(ui, 'btn_normal.png'), png(200, 64, 1));
  await writeFile(path.join(ui, 'btn_hover.png'), png(200, 64, 2));
  await writeFile(path.join(ui, 'btn_pressed.png'), png(200, 64, 3));
  await writeFile(path.join(ui, 'painel_principal.png'), png(320, 160, 4));
  await writeFile(path.join(ui, 'icons/attack.png'), png(64, 64, 5));
  await writeFile(path.join(studio, 'assets/game/delivery/attack.png'), png(64, 64, 5)); // the same bytes
  await writeFile(path.join(studio, 'assets/game/delivery/Comparativo_v01.png'), png(900, 600, 6));
  await writeFile(path.join(studio, 'assets/game/Source/layers.png'), png(900, 600, 7));
  await writeFile(path.join(ui, 'Garamond.ttf'), 'font');
  const spec = path.join(studio, 'spec.json');
  await writeFile(spec, JSON.stringify({ prefer: ['/ui/'], slices: { btn_: 16, painel: [15, 15, 15, 15] }, fonts: [{ file: 'garamond', name: 'EB Garamond', use: 'All text' }], colors: [{ name: 'Gold', value: '#e2c46a' }],
    components: [{ name: 'Game button', node: { type: 'button', name: 'BtnGame', rect: [0, 0, 260, 64], props: { skin: 'assets/game/ui/btn_normal.png' } } }] }));
  const out = execFileSync(process.execPath, [builder, 'assets/game', '--project', 'Game', '--project-path', 'D:\\Games\\Game', '--spec', spec, '--studio', studio], { encoding: 'utf8' });
  assert.match(out, /Button state sets: btn \(hover\/normal\/pressed\)/);

  const kit = normalizeKit(JSON.parse(await readFile(path.join(studio, 'assets/game/kit.json'), 'utf8')), 'assets/game/kit.json');
  const bySrc = src => kit.assets.find(a => a.src === src);
  assert.equal(kit.assets.length, 5, 'review boards, Source folders and duplicates are left out');
  assert.ok(bySrc('assets/game/ui/icons/attack.png'), 'a duplicate keeps the preferred path');
  const button = kit.assets[0];
  assert.equal(button.src, 'assets/game/ui/btn_normal.png', 'the state set comes first');
  assert.deepEqual(button.states, { hover: 'assets/game/ui/btn_hover.png', normal: 'assets/game/ui/btn_normal.png', pressed: 'assets/game/ui/btn_pressed.png' });
  assert.deepEqual(button.slice, [16, 16, 16, 16]);
  assert.equal(button.category, 'button');
  assert.deepEqual([bySrc('assets/game/ui/painel_principal.png').category, bySrc('assets/game/ui/painel_principal.png').w], ['panel', 320]);
  assert.equal(bySrc('assets/game/ui/icons/attack.png').category, 'icon');
  assert.equal(bySrc('assets/game/ui/icons/attack.png').path, 'ui/icons/attack.png', 'path is the file inside the project');
  assert.deepEqual(kit.fonts, [{ name: 'EB Garamond', src: 'assets/game/ui/Garamond.ttf', use: 'All text', path: 'ui/Garamond.ttf' }]);

  const index = JSON.parse(await readFile(path.join(studio, 'assets/kits.json'), 'utf8'));
  assert.equal(kitFor(index, 'd:/games/game/'), 'assets/game/kit.json', 'project folders match across slashes and case');
  assert.equal(kitFor(index, 'D:\\Games\\Other'), null);
});

test('a kit dresses elements: state skins on buttons, slices on panels, images at native size', () => {
  const kit = normalizeKit({
    assets: [
      { src: 'assets/g/btn_normal.png', w: 200, h: 64, category: 'button', slice: [16, 16, 16, 16], states: { normal: 'assets/g/btn_normal.png', hover: 'assets/g/btn_hover.png', disabled: 'assets/g/btn_off.png' } },
      { src: 'assets/g/icon.png', name: 'attack_icon.png', w: 64, h: 48, category: 'icon', path: 'ui/attack_icon.png' },
      { src: '../outside.png' }, { src: 'https://example.com/x.png' }
    ],
    components: [{ name: 'Panel', node: { type: 'panel', props: { skin: 'assets/g/panel.png' }, children: [{ type: 'label', props: { text: 'Hi' } }] } }, { name: 'Bad', node: { type: 'window' } }]
  });
  assert.equal(kit.assets.length, 2, 'paths outside the studio are dropped');
  assert.equal(kit.components.length, 1);
  assert.deepEqual(skinProps('button', kit.assets[0]), { skin: 'assets/g/btn_normal.png', skinSlice: [16, 16, 16, 16], states: { hover: { skin: 'assets/g/btn_hover.png' }, disabled: { skin: 'assets/g/btn_off.png' } } });
  assert.deepEqual(skinProps('panel', kit.assets[0]), { skin: 'assets/g/btn_normal.png', skinSlice: [16, 16, 16, 16] });
  assert.equal(skinProps('label', kit.assets[0]), null);
  const image = assetNode(kit.assets[1]);
  assert.deepEqual([image.name, image.rect.w, image.rect.h, image.props.comment], ['AttackIcon', 64, 48, 'Asset: ui/attack_icon.png']);
  const a = instantiate(kit.components[0].node), b = instantiate(kit.components[0].node);
  assert.notEqual(a.id, b.id, 'every insert gets fresh ids');
  assert.equal(a.children[0].props.text, 'Hi');
  assert.equal(a.props.borderWidth, 1, 'type defaults fill the props the component leaves out');
});

test('the edit protocol accepts skins, 9-slice margins and the game font', () => {
  const doc = createDefaultDocument('Game', 'projects/Game');
  const btn = flattenNodes(doc.screens[0].elements).find(e => e.node.name === 'BtnQuit').node;
  const plan = planEdit(doc, { ops: [{ op: 'update', id: btn.id, set: { props: { skin: 'assets/g/btn.png', skinSlice: [16, 16, 16, 16], fontFamily: 'EB Garamond', states: { hover: { skin: 'assets/g/btn_hover.png' } } } } }] });
  assert.deepEqual(plan.errors, []);
  const after = flattenNodes(plan.doc.screens[0].elements).find(e => e.node.id === btn.id).node.props;
  assert.deepEqual([after.skin, after.skinSlice, after.fontFamily, after.states.hover.skin], ['assets/g/btn.png', [16, 16, 16, 16], 'EB Garamond', 'assets/g/btn_hover.png']);
  const bad = planEdit(doc, { ops: [{ op: 'update', id: btn.id, set: { props: { skinSlice: [16, 16] } } }] });
  assert.match(bad.results[0].error || bad.errors.join(' '), /skinSlice/);
});
