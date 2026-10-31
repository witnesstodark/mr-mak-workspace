#!/usr/bin/env node
// Builds a Game UI Studio game kit (kit.json) from the UI art copied into the
// studio's assets folder, and lists it in assets/kits.json so the studio opens
// it for the project. Images are measured, sorted into categories and paired
// into button state sets; the spec adds what files cannot say (9-slice margins,
// colours, fonts, components, the game's screens).
//
//   node build-kit.mjs <assets/<project>> --project "<name>" --project-path "<folder>" [--spec <kit.spec.json>] [--studio <folder>]
//
// The spec format is in ../references/game-kit.md. The game's files are never read
// or changed; only the copies under the studio are.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const [, value] = args.splice(i, 2); return value; };
const studio = path.resolve(flag('--studio') || path.join(here, '../../../../workspace/2026-10-27_game-ui-studio'));
const project = flag('--project');
const projectPath = flag('--project-path');
const specPath = flag('--spec');
const [assetsArg] = args;
if (!assetsArg || !project || !projectPath) {
  console.error('Usage: node build-kit.mjs <assets/<project>> --project "<name>" --project-path "<folder>" [--spec <kit.spec.json>] [--studio <folder>]');
  process.exit(2);
}
const root = path.resolve(studio, assetsArg);
const rel = file => path.relative(studio, file).split(path.sep).join('/');
if (rel(root).startsWith('..') || !rel(root).startsWith('assets/')) {
  console.error(`The kit folder must be inside ${path.join(studio, 'assets')}.`);
  process.exit(2);
}
const spec = specPath ? JSON.parse(await readFile(specPath, 'utf8')) : {};

const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp']);
const FONTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const SKIP_DIRS = new Set(['source', 'sources', 'reference', 'references', 'raw', 'backup', 'backups', 'old', 'psd', ...(spec.skipDirs || []).map(d => String(d).toLowerCase())]);
const exclude = (spec.exclude || []).map(s => String(s).toLowerCase());
// Review boards and previews show the art; they are not pieces of the UI.
const BOARD = /(preview|previa|prévia|comparison|comparativo|comparacao|comparação|catalog|catalogo|catálogo|contact.?sheet|board|prancha|mockup|contexto|aplicacao|aplicação|diagnostico|diagnóstico)/i;

// Words in a file's path that name its role, in English and Portuguese.
const RULES = [
  ['cursor', /cursor|ponteiro/],
  ['portrait', /portrait|retrato|avatar|face/],
  ['button', /button|btn|botao|botão|tecla|key(cap)?\b/],
  ['bar', /bar(ra)?_|_bar|progress|vida|health|hp_|mana|stamina|gauge|medidor/],
  ['divider', /divider|divisor|separator|separador|line_|linha/],
  ['frame', /frame|moldura|border|borda|minimap|minimapa/],
  ['panel', /panel|painel|window|janela|tooltip|card|cartao|cartão|dialog|box|caixa|contador|slot/],
  ['background', /background|backdrop|fundo|bg_|_bg|wallpaper|splash|tela_/],
  ['icon', /icon|icone|ícone|symbol|simbolo|símbolo|glyph|marker|marcador|badge|emblem|comando|command/]
];
const STATE_WORDS = { normal: /(normal|idle|default|padrao|padrão)$/, hover: /(hover|over|highlight(ed)?|destaque)$/, pressed: /(pressed|press|down|active|pressionado|clicado)$/, focused: /(focus(ed)?|foco|selected|selecionado)$/, disabled: /(disabled|off|inactive|desativado|desabilitado)$/ };

function categoryOf(file) {
  const lower = rel(file).toLowerCase();
  for (const [pattern, category] of Object.entries(spec.categories || {})) if (lower.includes(pattern.toLowerCase())) return category;
  const name = path.basename(lower);
  for (const [category, re] of RULES) if (re.test(name)) return category;
  for (const [category, re] of RULES) if (re.test(lower)) return category;
  return 'other';
}

function imageSize(buf, ext) {
  if (ext === '.png' && buf.length > 24) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (ext === '.gif' && buf.length > 10) return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
  if (ext === '.bmp' && buf.length > 26) return [buf.readInt32LE(18), Math.abs(buf.readInt32LE(22))];
  if (ext === '.webp' && buf.length > 30) {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
    if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (ext === '.svg') {
    const text = buf.toString('utf8', 0, 4000);
    const w = /\bwidth="([\d.]+)/.exec(text), h = /\bheight="([\d.]+)/.exec(text), box = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(text);
    if (w && h) return [Math.round(+w[1]), Math.round(+h[1])];
    if (box) return [Math.round(+box[1]), Math.round(+box[2])];
  }
  return [0, 0];
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name.toLowerCase())) await walk(full, out);
    } else out.push(full);
  }
  return out;
}

const files = (await walk(root)).filter(f => !exclude.some(x => rel(f).toLowerCase().includes(x)) && (spec.keepBoards || !BOARD.test(path.basename(f)) && !/(^|\/)pranchas?\//i.test(rel(f))));
const seen = new Map();
const assets = [];
const fonts = [];
const titleOf = file => path.basename(file).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const projectRel = file => path.relative(root, file).split(path.sep).join('/');
// Paths the spec prefers (the game's runtime copy over a delivery folder) come
// first, so a duplicate keeps the path the engine loads.
const prefer = (spec.prefer || []).map(p => String(p).toLowerCase());
const rank = file => { const i = prefer.findIndex(p => rel(file).toLowerCase().includes(p)); return i < 0 ? prefer.length : i; };
for (const file of files.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))) {
  const ext = path.extname(file).toLowerCase();
  if (FONTS.has(ext)) {
    fonts.push({ name: titleOf(file), src: rel(file), path: projectRel(file) });
    continue;
  }
  if (!IMAGES.has(ext)) continue;
  const buf = await readFile(file);
  // The same image copied in two places appears once.
  const hash = createHash('sha1').update(buf).digest('hex');
  if (seen.has(hash)) continue;
  seen.set(hash, file);
  const [w, h] = imageSize(buf, ext);
  if (w > 8192 || h > 8192) continue;
  assets.push({ id: `a${assets.length + 1}`, name: titleOf(file), src: rel(file), path: projectRel(file), w, h, category: categoryOf(file) });
}

// 9-slice margins from the spec: the first pattern a path contains wins.
for (const asset of assets) {
  const lower = asset.src.toLowerCase();
  const match = Object.entries(spec.slices || {}).find(([pattern]) => lower.includes(pattern.toLowerCase()));
  if (match) asset.slice = Array.isArray(match[1]) ? match[1] : [match[1], match[1], match[1], match[1]];
}

// Button state sets: files in one folder whose names differ only by a state word.
const groups = new Map();
for (const asset of assets) {
  const base = asset.name.toLowerCase();
  for (const [state, re] of Object.entries(STATE_WORDS)) {
    if (!re.test(base)) continue;
    const key = `${path.posix.dirname(asset.src)}|${base.replace(re, '').trim()}`;
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[state] = asset;
  }
}
for (const set of groups.values()) {
  const normal = set.normal;
  if (!normal || Object.keys(set).length < 2) continue;
  normal.states = Object.fromEntries(Object.entries(set).map(([state, a]) => [state, a.src]));
  normal.name = normal.name.replace(STATE_WORDS.normal, '').trim() || normal.name;
  for (const a of Object.values(set)) if (a.category === 'other' || a.category === 'icon') a.category = 'button';
}

// A full state set comes first in its category: one click skins every state.
assets.sort((a, b) => (b.states ? Object.keys(b.states).length : 0) - (a.states ? Object.keys(a.states).length : 0));

const fontInfo = new Map((spec.fonts || []).map(f => [String(f.file || f.name || '').toLowerCase(), f]));
for (const font of fonts) {
  const info = [...fontInfo.entries()].find(([key]) => key && font.src.toLowerCase().includes(key))?.[1];
  if (info?.name) font.name = info.name;
  if (info?.use) font.use = info.use;
}

const kit = {
  version: 1,
  project,
  projectPath,
  engine: spec.engine || '',
  resolution: spec.resolution || null,
  notes: spec.notes || '',
  screens: spec.screens || '',
  colors: spec.colors || [],
  fonts,
  assets,
  components: spec.components || []
};
const out = path.join(root, 'kit.json');
await writeFile(out, JSON.stringify(kit, null, 1));

const indexFile = path.join(studio, 'assets', 'kits.json');
const index = await readFile(indexFile, 'utf8').then(JSON.parse, () => ({ kits: [] }));
const same = p => String(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === projectPath.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
index.kits = [...(index.kits || []).filter(k => !same(k.projectPath)), { project, projectPath, kit: rel(out) }];
await writeFile(indexFile, JSON.stringify(index, null, 2));

const counts = {};
for (const a of assets) counts[a.category] = (counts[a.category] || 0) + 1;
const missing = (kit.components || []).flatMap(c => JSON.stringify(c.node || {}).match(/"(?:src|skin)":"([^"]+)"/g) || [])
  .map(m => m.split('":"')[1].slice(0, -1)).filter(src => !assets.some(a => a.src === src) && !(spec.allowMissing));
const exists = await Promise.all(missing.map(src => stat(path.join(studio, src)).then(() => null, () => src)));
console.log(`Wrote ${rel(out)}: ${assets.length} images (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), ${fonts.length} fonts, ${kit.colors.length} colours, ${kit.components.length} components.`);
console.log(`Button state sets: ${assets.filter(a => a.states).map(a => `${a.name} (${Object.keys(a.states).join('/')})`).join('; ') || 'none'}.`);
const broken = exists.filter(Boolean);
if (broken.length) { console.error(`Components point at images that do not exist: ${broken.join(', ')}`); process.exit(1); }
