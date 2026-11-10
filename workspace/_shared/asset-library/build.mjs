#!/usr/bin/env node
// The asset library (Acervo) of a Workspace card. Reads <card>/assets.json,
// checks every file it names and writes <card>/assets.html, a page with
// filters, version history, a side-by-side comparison and, in the desktop app,
// "Send to chat" and "Ask for a variation" (src/desktop/assetBridge.ts).
//
// Usage: node workspace/_shared/asset-library/build.mjs <card-folder> [--check]
//   --check  validates only and writes nothing
//
// The page's style and script are inlined from this folder, so a card loads
// nothing from workspace/_shared beyond report.css and report.js. The format is
// described in docs/asset-library.md.
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = 'assets.json';
export const PAGE = 'assets.html';
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_ITEMS = 2000;
export const OPEN_FAMILIES_UP_TO = 30;

export const CATEGORIES = [
  { id: 'characters', name: 'Characters' },
  { id: 'environment', name: 'Environment' },
  { id: 'props', name: 'Props and buildings' },
  { id: 'interface', name: 'Interface' },
  { id: 'audio', name: 'Audio' },
  { id: 'key-art', name: 'Key art' },
];
export const STATUS = { current: 'Current', review: 'In review', discarded: 'Discarded' };

// What each kind of file may be, and how large. The card keeps previews; the
// original stays in the game's repository, at the path recorded in `original`.
export const FILES = {
  image: { extensions: ['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif'], max: 1024 * 1024 },
  audio: { extensions: ['ogg', 'mp3', 'wav', 'm4a'], max: 16 * 1024 * 1024 },
  model: { extensions: ['glb'], max: 25 * 1024 * 1024 },
  prompt: { extensions: ['md', 'txt'], max: 256 * 1024 },
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_KEYS = new Set(['id', 'name', 'category', 'family', 'status', 'version', 'thumbnail', 'thumbnailLabel', 'views', 'audio', 'model', 'original', 'prompt', 'promptFile', 'note', 'generation', 'history']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const href = file => file.split('/').map(encodeURIComponent).join('/');
const pad = number => String(number).padStart(2, '0');
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * A file path the page may load: relative to the card folder, written with "/",
 * without "..", hidden segments, a scheme, a query or a fragment.
 */
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return false;
  if (/[\\:*?"<>|#%]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32) || value.startsWith('/')) return false;
  return value.split('/').every(part => part && part !== '..' && !part.startsWith('.'));
}

/** Audio is a path or a list of { label, file }. */
const tracks = audio => typeof audio === 'string' ? [{ label: '', file: audio }] : Array.isArray(audio) ? audio.map(track => ({ label: track?.label ?? '', file: track?.file })) : [];

/** Categories of this library: the common ones, then the extras of assets.json. */
export function categoriesOf(data) {
  const extra = (Array.isArray(data?.categories) ? data.categories : []).filter(item => isObject(item) && SLUG.test(item.id ?? '') && isText(item.name, 80));
  return [...CATEGORIES, ...extra.filter(item => !CATEGORIES.some(common => common.id === item.id)).map(({ id, name }) => ({ id, name }))];
}

/** Every file an item names, with its kind: [{ file, kind, where }]. */
export function filesOf(item) {
  const list = [];
  const add = (file, kind, where) => { if (file !== undefined && file !== null) list.push({ file, kind, where }); };
  add(item.thumbnail, 'image', 'thumbnail');
  (Array.isArray(item.views) ? item.views : []).forEach((view, index) => add(view?.file, 'image', `view ${index + 1}`));
  tracks(item.audio).forEach((track, index) => add(track.file, 'audio', `audio ${index + 1}`));
  add(item.model, 'model', 'model');
  add(item.promptFile, 'prompt', 'promptFile');
  (Array.isArray(item.history) ? item.history : []).forEach((entry, index) => {
    add(entry?.thumbnail, 'image', `history ${index + 1} thumbnail`);
    tracks(entry?.audio).forEach((track, number) => add(track.file, 'audio', `history ${index + 1} audio ${number + 1}`));
  });
  return list;
}

// The file exists inside the card folder, after links are followed, and fits its limit.
function checkFile(folder, base, { file, kind }) {
  const rule = FILES[kind];
  if (!safeRelative(file)) return 'use a path relative to the card folder, with "/", without ".." or hidden folders';
  const extension = file.split('.').pop().toLowerCase();
  if (!rule.extensions.includes(extension)) return `must be ${rule.extensions.map(item => `.${item}`).join(', ')}`;
  if (!folder) return null;
  const full = join(base, ...file.split('/'));
  if (!existsSync(full)) return 'file not found';
  const real = realpathSync(full), inside = relative(base, real);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return 'points outside the card folder';
  const info = statSync(real);
  if (!info.isFile()) return 'is not a file';
  if (info.size > rule.max) return `is ${Math.ceil(info.size / 1024)} KB, over the ${Math.round(rule.max / 1024)} KB limit for ${kind} files`;
  return null;
}

/**
 * Checks assets.json. With `folder`, also checks that every file exists inside
 * it and fits its limit. Returns { errors, warnings }.
 */
export function validate(data, { folder } = {}) {
  const errors = [], warnings = [];
  if (!isObject(data)) return { errors: ['assets.json must be an object with "items"'], warnings };
  if (!Array.isArray(data.items)) return { errors: ['assets.json needs "items" (a list)'], warnings };
  if (data.items.length > MAX_ITEMS) errors.push(`"items" has ${data.items.length} entries; the limit is ${MAX_ITEMS}`);
  if (data.title !== undefined && !isText(data.title, 120)) errors.push('"title" must be text of up to 120 characters');
  if (data.categories !== undefined) {
    if (!Array.isArray(data.categories)) errors.push('"categories" must be a list of { id, name }');
    else data.categories.forEach((item, index) => {
      if (!isObject(item) || !SLUG.test(item.id ?? '') || !isText(item.name, 80)) errors.push(`categories ${index + 1}: needs "id" (lowercase letters, digits and hyphens) and "name"`);
    });
  }
  const categories = categoriesOf(data).map(item => item.id);
  if (data.families !== undefined && (!isObject(data.families) || !Object.values(data.families).every(name => isText(name, 80)))) errors.push('"families" must map "category/family" to a name');
  const base = folder ? realpathSync(folder) : null;
  const ids = new Set();
  data.items.forEach((item, index) => {
    if (!isObject(item)) { errors.push(`item ${index + 1} must be an object`); return; }
    const where = `item ${typeof item.id === 'string' ? `"${item.id.slice(0, 80)}"` : index + 1}`;
    const fail = message => errors.push(`${where}: ${message}`);
    if (typeof item.id !== 'string' || item.id.length > 80 || !SLUG.test(item.id)) fail('"id" must be lowercase letters, digits and hyphens, up to 80 characters');
    else if (ids.has(item.id)) fail('"id" is used by another item');
    else ids.add(item.id);
    if (!isText(item.name, 200)) fail('"name" must be text of up to 200 characters');
    if (!categories.includes(item.category)) fail(`"category" must be one of ${categories.join(', ')} (add others in "categories")`);
    if (typeof item.family !== 'string' || item.family.length > 80 || !SLUG.test(item.family)) fail('"family" must be lowercase letters, digits and hyphens');
    if (!STATUS[item.status]) fail(`"status" must be one of ${Object.keys(STATUS).join(', ')}`);
    if (!Number.isInteger(item.version) || item.version < 1 || item.version > 999) fail('"version" must be a whole number from 1 to 999');
    if (item.thumbnail === undefined && item.audio === undefined) fail('needs "thumbnail"; only an audio item may go without one');
    if (item.thumbnailLabel !== undefined && !isText(item.thumbnailLabel, 80)) fail('"thumbnailLabel" must be short text');
    if (item.views !== undefined && (!Array.isArray(item.views) || item.views.length > 24 || !item.views.every(view => isObject(view) && isText(view.label, 80) && typeof view.file === 'string'))) fail('"views" must be a list of up to 24 { label, file }');
    if (item.audio !== undefined) {
      const list = tracks(item.audio);
      const valid = typeof item.audio === 'string' || (Array.isArray(item.audio) && item.audio.length && item.audio.length <= 24 && item.audio.every(track => isObject(track) && typeof track.file === 'string' && (track.label === undefined || isText(track.label, 80))));
      if (!valid || !list.length) fail('"audio" must be a path or a list of up to 24 { label, file }');
    }
    for (const [key, max] of [['original', 1000], ['prompt', 4000], ['note', 600]]) if (item[key] !== undefined && !isText(item[key], max)) fail(`"${key}" must be text of up to ${max} characters`);
    const generation = item.generation;
    if (generation !== undefined) {
      if (!isObject(generation) || !isText(generation.provider, 60) || !isText(generation.job, 200)) fail('"generation" needs "provider" and "job"');
      else {
        if (generation.model !== undefined && !isText(generation.model, 120)) fail('"generation.model" must be text');
        if (generation.date !== undefined && !(typeof generation.date === 'string' && DATE.test(generation.date))) fail('"generation.date" must be YYYY-MM-DD');
        if (generation.cost !== undefined && !(typeof generation.cost === 'number' && Number.isFinite(generation.cost) && generation.cost >= 0) && !isText(generation.cost, 60)) fail('"generation.cost" must be a number of credits or short text');
        const extra = Object.keys(generation).filter(key => !['provider', 'job', 'model', 'date', 'cost'].includes(key));
        if (extra.length) fail(`"generation" keeps only provider, job, model, date and cost (not ${extra.join(', ')})`);
      }
    }
    if (item.history !== undefined) {
      if (!Array.isArray(item.history) || item.history.length > 50) fail('"history" must be a list of up to 50 earlier versions');
      else {
        const versions = new Set();
        item.history.forEach((entry, number) => {
          const at = `history ${number + 1}`;
          if (!isObject(entry)) { fail(`${at} must be an object`); return; }
          if (!Number.isInteger(entry.version) || entry.version < 1 || (Number.isInteger(item.version) && entry.version >= item.version)) fail(`${at}: "version" must be a whole number below the current version`);
          else if (versions.has(entry.version)) fail(`${at}: v${pad(entry.version)} is listed twice`);
          else versions.add(entry.version);
          if (entry.status !== undefined && !STATUS[entry.status]) fail(`${at}: "status" must be one of ${Object.keys(STATUS).join(', ')}`);
          if (entry.note !== undefined && !isText(entry.note, 600)) fail(`${at}: "note" must be text of up to 600 characters`);
          if (entry.thumbnail === undefined && entry.audio === undefined) fail(`${at}: needs "thumbnail" or "audio"`);
        });
      }
    }
    const unknown = Object.keys(item).filter(key => !ITEM_KEYS.has(key));
    if (unknown.length) warnings.push(`${where}: ignored ${unknown.join(', ')}`);
    for (const entry of filesOf(item)) {
      const problem = checkFile(folder, base, entry);
      if (problem) fail(`${entry.where} "${String(entry.file).slice(0, 300)}" ${problem}`);
    }
  });
  if (!data.items.length) warnings.push('"items" is empty; the page shows an empty library');
  return { errors, warnings };
}

const inline = name => {
  const text = readFileSync(join(HERE, name), 'utf8');
  // Inlined into the page: a closing tag inside would end the element early.
  if (/<\/(script|style)/i.test(text)) throw new Error(`${name} must not contain a closing script or style tag`);
  return text;
};

/** The page's HTML. `shared` is the relative path from the card folder to workspace/_shared. */
export function render(data, { shared = '../_shared' } = {}) {
  const categories = categoriesOf(data);
  const items = data.items;
  const families = isObject(data.families) ? data.families : {};
  const familyName = (category, family) => families[`${category}/${family}`] ?? family.replace(/-/g, ' ').replace(/^./, char => char.toUpperCase());
  const counts = Object.fromEntries(Object.keys(STATUS).map(status => [status, items.filter(item => item.status === status).length]));
  const title = data.title ?? 'Assets';
  // A small library opens every family; a large one starts collapsed.
  const open = items.length <= OPEN_FAMILIES_UP_TO;
  const image = (file, alt, attributes = '') => `<img src="${escape(href(file))}" alt="${escape(alt)}" loading="lazy" decoding="async"${attributes}>`;
  const chip = status => `<span class="al-chip al-${escape(status)}">${escape(STATUS[status] ?? status)}</span>`;
  const audio = (list, label) => list.length ? `<ul class="al-tracks">${list.map(track => `<li>${track.label ? `<span>${escape(track.label)}</span>` : ''}<audio controls preload="none" src="${escape(href(track.file))}" aria-label="${escape(track.label ? `${label}, ${track.label}` : label)}"></audio></li>`).join('')}</ul>` : '';

  const card = item => {
    const pictures = [
      ...(item.thumbnail ? [{ file: item.thumbnail, label: item.thumbnailLabel ?? 'Main' }] : []),
      ...(item.views ?? []).map(view => ({ file: view.file, label: view.label })),
    ];
    const category = categories.find(entry => entry.id === item.category);
    const search = fold([item.name, item.id, category?.name, familyName(item.category, item.family), item.note, item.original, ...pictures.map(picture => picture.label)].filter(Boolean).join(' '));
    const media = pictures.length
      ? `<div class="al-media">${image(pictures[0].file, item.thumbnailLabel ? `${item.name}, ${item.thumbnailLabel}` : item.name, ` data-al-view data-label="${escape(pictures[0].label)}"`)}</div>`
      : '<div class="al-media al-sound" aria-hidden="true">♪</div>';
    const views = pictures.length > 1 ? `<ul class="al-views" aria-label="Views of ${escape(item.name)}">${pictures.slice(1).map(view => `<li><figure>${image(view.file, `${item.name}, ${view.label}`, ` data-al-view data-label="${escape(view.label)}"`)}<figcaption>${escape(view.label)}</figcaption></figure></li>`).join('')}</ul>` : '';
    const generation = item.generation;
    const facts = [
      item.note ? `<p class="al-note">${escape(item.note)}</p>` : '',
      item.original ? `<p class="al-fact"><b>Original:</b> <code>${escape(item.original)}</code></p>` : '',
      item.prompt || item.promptFile ? `<p class="al-fact"><b>Prompt:</b> ${item.prompt ? escape(item.prompt) : ''}${item.promptFile ? ` <a href="${escape(href(item.promptFile))}" download>Prompt file</a>` : ''}</p>` : '',
      generation
        ? `<p class="al-fact"><b>Generation:</b> ${[escape(generation.provider), `job <code>${escape(generation.job)}</code>`, generation.model && escape(generation.model), generation.date && escape(generation.date), generation.cost !== undefined && (typeof generation.cost === 'number' ? `${generation.cost} credits` : escape(generation.cost))].filter(Boolean).join(' · ')}</p>`
        : '<p class="al-fact al-none">No generation record</p>',
    ].join('');
    const buttons = [
      '<button type="button" data-al-send="send">Send to chat</button>',
      '<button type="button" data-al-send="variation">Ask for a variation</button>',
      pictures.length > 1 ? '<button type="button" data-al-compare aria-expanded="false">Compare</button>' : '',
      item.model ? `<a class="al-link" href="${escape(href(item.model))}" download>Download GLB</a>` : '',
    ].join('');
    const history = [...(item.history ?? [])].sort((a, b) => b.version - a.version);
    const earlier = history.length ? `<details class="al-history"><summary>Earlier versions (${history.length})</summary><ul>${history.map(entry => {
      const name = `v${pad(entry.version)}`;
      return `<li>${entry.thumbnail ? image(entry.thumbnail, `${item.name}, ${name}`) : '<span class="al-sound" aria-hidden="true">♪</span>'}<div><span>${chip(entry.status ?? 'discarded')} <span class="al-id">${name}</span></span>${entry.note ? `<span>${escape(entry.note)}</span>` : ''}</div>${audio(tracks(entry.audio), `${item.name}, ${name}`)}</li>`;
    }).join('')}</ul></details>` : '';
    return `<article class="al-item" id="item-${escape(item.id)}" data-id="${escape(item.id)}" data-category="${escape(item.category)}" data-status="${escape(item.status)}" data-search="${escape(search)}">
${media}
<div class="al-body">
<h3>${escape(item.name)}</h3>
<p class="al-meta">${chip(item.status)}<span class="al-id">v${pad(item.version)}</span>${item.model ? '<span class="al-id">3D</span>' : ''}</p>${views}${audio(tracks(item.audio), item.name)}${facts}
<p class="al-actions">${buttons}</p>
<p class="al-notice" data-al-notice role="status" hidden></p>${earlier}
</div>
</article>`;
  };

  const sections = categories.map(category => {
    const inCategory = items.filter(item => item.category === category.id);
    if (!inCategory.length) return '';
    const order = [...new Set(inCategory.map(item => item.family))];
    return `<details class="al-category" open data-category="${escape(category.id)}">
<summary><h2>${escape(category.name)}</h2><span class="al-count" data-al-count>${plural(inCategory.length, 'item', 'items')}</span></summary>
${order.map(family => {
      const list = inCategory.filter(item => item.family === family);
      return `<details class="al-family"${open ? ' open' : ''} data-family="${escape(family)}">
<summary><span class="al-family-name">${escape(familyName(category.id, family))}</span><span class="al-count" data-al-count>${plural(list.length, 'item', 'items')}</span></summary>
<div class="al-grid">
${list.map(card).join('\n')}
</div>
</details>`;
    }).join('\n')}
</details>`;
  }).filter(Boolean);

  const filter = (kind, value, label, count) => `<button type="button" data-al-filter="${kind}" data-value="${escape(value)}" aria-pressed="${value === '' ? 'true' : 'false'}">${escape(label)} <small data-al-n>${count}</small></button>`;
  const used = categories.filter(category => items.some(item => item.category === category.id));
  const summary = [plural(items.length, 'item', 'items'), `${counts.current} current`, `${counts.review} in review`, `${counts.discarded} discarded`].join(' · ');
  return `<!doctype html>
<html lang="en" data-mak-report="document">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Generated from ${SOURCE} by workspace/_shared/asset-library/build.mjs. Edit ${SOURCE} and run it again. -->
<title>${escape(title)}</title>
<link rel="stylesheet" href="${shared}/report.css">
<script defer src="${shared}/report.js"></script>
<style>
${inline('page.css')}</style>
</head>
<body>
<main class="container al" data-al>
<header class="al-head"><h1>${escape(title)}</h1><p class="sub">${escape(summary)}</p></header>
<section class="al-bar" aria-label="Filters">
<div class="al-group" role="group" aria-label="Category">${filter('category', '', 'All', items.length)}${used.map(category => filter('category', category.id, category.name, items.filter(item => item.category === category.id).length)).join('')}</div>
<div class="al-group" role="group" aria-label="Status">${filter('status', '', 'Any status', items.length)}${Object.entries(STATUS).map(([status, name]) => filter('status', status, name, counts[status])).join('')}</div>
<div class="al-row"><input type="search" data-al-search placeholder="Search names, notes and originals" aria-label="Search the asset library" autocomplete="off"><p class="al-total" data-al-total role="status" aria-live="polite">${plural(items.length, 'item', 'items')}</p></div>
</section>
<p class="al-empty" data-al-empty hidden>No items match these filters.</p>
${sections.length ? sections.join('\n') : '<p class="al-empty">This library has no items yet.</p>'}
<p class="al-legend">Select an image to enlarge and download it. Each item records where its original file lives.</p>
</main>
<script>
${inline('page.js')}</script>
</body>
</html>
`;
}

/** Reads, checks and (unless `check`) writes one card's library. Returns { errors, warnings, written }. */
export function build(folder, { check = false } = {}) {
  const card = resolve(folder), source = join(card, SOURCE);
  if (!existsSync(source)) return { errors: [`${SOURCE} not found in ${card}`], warnings: [], written: false };
  if (statSync(source).size > MAX_SOURCE_BYTES) return { errors: [`${SOURCE} is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`], warnings: [], written: false };
  let data;
  try { data = JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, '')); } catch (error) { return { errors: [`${SOURCE}: ${error.message}`], warnings: [], written: false }; }
  const result = validate(data, { folder: card });
  if (result.errors.length || check) return { ...result, written: false };
  // A card inside this workspace links to its _shared folder; any other card is taken to sit directly inside a workspace folder.
  const workspace = dirname(dirname(HERE)), inside = relative(workspace, card);
  const shared = inside && !inside.startsWith('..') && !isAbsolute(inside) ? relative(card, dirname(HERE)).split(sep).join('/') : '../_shared';
  const html = render(data, { shared });
  const target = join(card, PAGE);
  const written = !existsSync(target) || readFileSync(target, 'utf8') !== html;
  if (written) writeFileSync(target, html);
  return { ...result, written };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), folder = args.find(arg => !arg.startsWith('--'));
  if (!folder || args.some(arg => arg.startsWith('--') && arg !== '--check')) {
    console.log('Usage: node workspace/_shared/asset-library/build.mjs <card-folder> [--check]');
    process.exitCode = 1;
  } else {
    const { errors, warnings, written } = build(folder, { check: args.includes('--check') });
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    for (const error of errors) console.error(`error: ${error}`);
    if (errors.length) { console.error(`${plural(errors.length, 'error', 'errors')}; nothing was written.`); process.exitCode = 1; }
    else console.log(args.includes('--check') ? `${SOURCE} is valid.` : `${PAGE} ${written ? 'written' : 'unchanged'}.`);
  }
}
