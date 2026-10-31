#!/usr/bin/env node
// Builds a Game UI Studio document (.gameui.json) from screens read out of a
// game: every element is given as its box in screen pixels at the design
// resolution, and the studio's own modules convert it to anchors and check it.
//
//   node build-gameui.mjs <spec.json> <out.gameui.json> [--studio <folder>] [--force]
//
// The spec format is in ../references/game-ui-import.md. Nothing is written when
// the studio rejects an element; the guideline checks are reported, not enforced.
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const [, value] = args.splice(i, 2); return value; };
const force = args.includes('--force') ? (args.splice(args.indexOf('--force'), 1), true) : false;
const studio = path.resolve(flag('--studio') || path.join(here, '../../../../workspace/2026-10-27_game-ui-studio'));
const [specPath, outPath] = args;
if (!specPath || !outPath) {
  console.error('Usage: node build-gameui.mjs <spec.json> <out.gameui.json> [--studio <folder>] [--force]');
  process.exit(2);
}
if (!force && await stat(outPath).then(() => true, () => false)) {
  console.error(`${outPath} exists. Choose another name, or pass --force to replace it.`);
  process.exit(2);
}

const load = file => import(pathToFileURL(path.join(studio, file)).href);
const model = await load('model.mjs');
const { planEdit, MAX_OPS } = await load('edits.mjs');
const { runChecks, RULES } = await load('checks.mjs');

const spec = JSON.parse((await readFile(specPath, 'utf8')).replace(/^﻿/, ''));
const problems = [];
if (!Array.isArray(spec.screens) || !spec.screens.length) throw new Error('The spec needs a "screens" list.');

// Screens first, so buttons can open screens that come later in the list.
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'screen';
const used = new Set();
const screens = spec.screens.map((s, index) => {
  if (!s.name) problems.push(`screen ${index + 1}: missing "name"`);
  let id = s.id || `screen_${slug(s.name || index + 1)}`;
  while (used.has(id)) id += '_2';
  used.add(id);
  const [width, height] = Array.isArray(s.resolution) ? s.resolution : [1920, 1080];
  return {
    id, name: String(s.name || id), resolution: { width, height }, notes: s.notes || '',
    bgImage: s.background || null, bgOpacity: typeof s.backgroundOpacity === 'number' ? s.backgroundOpacity : 0.3, elements: [],
  };
});
const screenRef = value => {
  if (value === undefined || value === null || value === model.BACK_PREVIOUS) return value;
  const found = screens.find(s => s.id === value) || screens.find(s => s.name === value);
  return found ? found.id : value; // An unknown screen is reported by the studio check.
};

const isBox = box => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite);
function toNode(el, parentBox, resolution, where) {
  if (!isBox(el.box)) { problems.push(`${where}: "box" must be [x, y, w, h] in screen pixels`); return null; }
  const [x, y, w, h] = el.box, world = { x, y, w, h };
  const anchor = el.anchor || model.naturalAnchor(world, parentBox || { x: 0, y: 0, w: resolution.width, h: resolution.height });
  const node = { anchor, rect: {} };
  model.updateLocalFromWorld(node, world, parentBox, resolution);
  const children = (el.children || []).map((child, i) => toNode(child, world, resolution, `${where} > ${child.name || child.id || i + 1}`)).filter(Boolean);
  return {
    ...(el.id ? { id: el.id } : {}), type: el.type, name: el.name || el.id, anchor,
    rect: [node.rect.x, node.rect.y, node.rect.w, node.rect.h], props: el.props || {},
    ...(el.opens !== undefined ? { opens: screenRef(el.opens) } : {}), ...(children.length ? { children } : {}),
  };
}

let doc = { version: '1.0.0', id: model.generateId('doc'), projectName: spec.projectName || '', projectPath: spec.projectPath || '', activeScreen: screens[0].id, screens };
spec.screens.forEach((s, index) => {
  const screen = screens[index];
  const ops = (s.elements || []).map((el, i) => toNode(el, null, screen.resolution, `${screen.name} > ${el.name || el.id || i + 1}`)).filter(Boolean).map(node => ({ op: 'add', parent: null, node }));
  const set = {
    ...(s.role ? { role: s.role } : {}),
    ...(s.onBack !== undefined ? { onBack: screenRef(s.onBack) } : {}),
    ...(s.focusDefault !== undefined ? { focusDefault: s.focusDefault } : {}),
    ...(s.focusOrder ? { focusOrder: s.focusOrder } : {}),
  };
  if (Object.keys(set).length) ops.push({ op: 'screen', set });
  for (let start = 0; start < ops.length; start += MAX_OPS) {
    const plan = planEdit(doc, { summary: `Import ${screen.name}`, screen: screen.id, ops: ops.slice(start, start + MAX_OPS) });
    problems.push(...plan.errors.map(error => `${screen.name}: ${error}`));
    for (const r of plan.results.filter(item => !item.ok)) problems.push(`${screen.name}: ${r.kind}${r.name ? ` ${r.name}` : ''}: ${r.error}`);
    if (plan.doc) doc = plan.doc;
  }
});

if (problems.length) {
  console.error(`Not written. The studio rejected ${problems.length} item(s):\n${problems.map(p => `- ${p}`).join('\n')}`);
  process.exit(1);
}
doc = model.normalizeDocument(doc);
await writeFile(outPath, JSON.stringify(doc, null, 2) + '\n');

const issues = runChecks(doc);
const count = list => list.reduce((n, s) => n + model.flattenNodes(s.elements).length, 0);
console.log(`Wrote ${outPath}: ${doc.screens.length} screen(s), ${count(doc.screens)} element(s).`);
for (const screen of doc.screens) {
  const own = issues.filter(i => i.screenId === screen.id);
  console.log(`${screen.name} (${screen.id}): ${own.length ? `${own.length} guideline issue(s)` : 'no guideline issues'}`);
  for (const i of own) console.log(`  - [${i.severity}] ${RULES[i.rule]?.title || i.rule}${i.nodeName ? ` (${i.nodeName})` : ''}: ${i.message}`);
}
