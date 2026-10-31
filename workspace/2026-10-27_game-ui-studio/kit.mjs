/**
 * Game UI Studio - Game kit
 * The look of a connected game, made usable in the studio: its UI images by
 * category (with 9-slice margins), colours, fonts, ready-made components in the
 * game's style and the game's own screens. A kit is a kit.json in the studio's
 * ignored assets folder, written by the game-ui-studio skill's build-kit script;
 * assets/kits.json lists the kits and the project folder each one belongs to.
 */
import { TYPES, ANCHORS, defaultProps, generateId } from './model.mjs';

export const KIT_INDEX = 'assets/kits.json';
export const CATEGORIES = [
  { id: 'button', label: 'Buttons' },
  { id: 'panel', label: 'Panels' },
  { id: 'background', label: 'Backgrounds' },
  { id: 'frame', label: 'Frames' },
  { id: 'bar', label: 'Bars' },
  { id: 'divider', label: 'Dividers' },
  { id: 'icon', label: 'Icons' },
  { id: 'portrait', label: 'Portraits' },
  { id: 'cursor', label: 'Cursors' },
  { id: 'other', label: 'Other' }
];
const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id));
const TYPE_IDS = new Set(TYPES.map(t => t.id));
const ANCHOR_IDS = new Set(ANCHORS.map(a => a.id));
const STATE_KEYS = ['normal', 'hover', 'pressed', 'focused', 'disabled'];

const str = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const slice = value => Array.isArray(value) && value.length === 4 ? value.map(v => Math.max(0, num(v))) : null;
// Only paths the studio can load: relative, no parent folders, no scheme.
const safeSrc = value => {
  const src = str(value, 2000).replace(/\\/g, '/');
  return src && !/^[a-z]+:|^\/|(^|\/)\.\.(\/|$)/i.test(src) ? src : '';
};

/** Normalises a parsed kit.json; unknown fields are dropped. */
export function normalizeKit(raw, src = '') {
  if (!raw || typeof raw !== 'object') throw new Error('The kit is not a JSON object.');
  const assets = (Array.isArray(raw.assets) ? raw.assets : []).map((a, i) => ({
    id: str(a?.id, 120) || `asset-${i + 1}`,
    name: str(a?.name, 120) || str(a?.src).split('/').pop() || `Asset ${i + 1}`,
    src: safeSrc(a?.src),
    path: str(a?.path, 400),
    w: num(a?.w), h: num(a?.h),
    category: CATEGORY_IDS.has(a?.category) ? a.category : 'other',
    slice: slice(a?.slice),
    crop: a?.crop && typeof a.crop === 'object' ? { x: num(a.crop.x), y: num(a.crop.y), w: num(a.crop.w), h: num(a.crop.h) } : null,
    // A button skin set: the state images that belong with this one.
    states: a?.states && typeof a.states === 'object'
      ? Object.fromEntries(STATE_KEYS.filter(k => safeSrc(a.states[k])).map(k => [k, safeSrc(a.states[k])]))
      : null
  })).filter(a => a.src);
  const colors = (Array.isArray(raw.colors) ? raw.colors : [])
    .map(c => ({ name: str(c?.name, 60), value: str(c?.value, 40), use: str(c?.use, 120) }))
    .filter(c => c.value);
  const fonts = (Array.isArray(raw.fonts) ? raw.fonts : [])
    .map(f => ({ name: str(f?.name, 80), src: safeSrc(f?.src), use: str(f?.use, 120), path: str(f?.path, 400) }))
    .filter(f => f.name);
  const components = (Array.isArray(raw.components) ? raw.components : [])
    .map((c, i) => ({ name: str(c?.name, 80) || `Component ${i + 1}`, category: str(c?.category, 40) || 'other', node: c?.node }))
    .filter(c => c.node && TYPE_IDS.has(c.node.type));
  return {
    src,
    base: src.includes('/') ? src.slice(0, src.lastIndexOf('/') + 1) : '',
    project: str(raw.project, 120),
    projectPath: str(raw.projectPath, 400),
    engine: str(raw.engine, 40),
    resolution: Array.isArray(raw.resolution) ? raw.resolution.map(num) : null,
    notes: str(raw.notes, 2000),
    screens: safeSrc(raw.screens),
    assets, colors, fonts, components
  };
}

const samePath = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() === b.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

/** The kit listed for this project folder, or null. */
export function kitFor(index, projectPath) {
  const list = Array.isArray(index?.kits) ? index.kits : [];
  return list.find(k => samePath(k.projectPath, projectPath))?.kit || null;
}

export async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/** Finds and loads the kit of a project folder. Resolves null when it has none. */
export async function loadKitFor(projectPath, explicit = '') {
  let src = safeSrc(explicit);
  if (!src) {
    const index = await fetchJson(KIT_INDEX).catch(() => null);
    src = safeSrc(kitFor(index, projectPath));
  }
  if (!src) return null;
  return normalizeKit(await fetchJson(src), src);
}

/** Registers the kit's fonts with the page so the canvas can draw them. */
export async function loadKitFonts(kit) {
  if (typeof FontFace === 'undefined' || !kit) return [];
  const loaded = [];
  for (const font of kit.fonts) {
    if (!font.src || [...document.fonts].some(f => f.family.replace(/"/g, '') === font.name)) continue;
    try {
      const face = new FontFace(font.name, `url("${encodeURI(font.src)}")`);
      document.fonts.add(await face.load());
      loaded.push(font.name);
    } catch { /* A font the browser cannot read stays a name in the handoff. */ }
  }
  return loaded;
}

function rectOf(value, fallback) {
  if (Array.isArray(value) && value.length === 4) return { x: num(value[0]), y: num(value[1]), w: num(value[2]), h: num(value[3]) };
  if (value && typeof value === 'object') return { x: num(value.x), y: num(value.y), w: num(value.w), h: num(value.h) };
  return fallback;
}

/** A component's node with fresh ids and the type defaults under its props. */
export function instantiate(spec, depth = 0) {
  if (!spec || !TYPE_IDS.has(spec.type) || depth > 6) return null;
  const props = { ...defaultProps(spec.type), ...(spec.props && typeof spec.props === 'object' ? spec.props : {}) };
  return {
    id: generateId(spec.type),
    type: spec.type,
    name: str(spec.name, 80) || spec.type,
    anchor: ANCHOR_IDS.has(spec.anchor) ? spec.anchor : 'top-left',
    rect: rectOf(spec.rect, { x: 0, y: 0, w: 200, h: 60 }),
    props,
    children: (Array.isArray(spec.children) ? spec.children : []).map(c => instantiate(c, depth + 1)).filter(Boolean)
  };
}

/** Props that dress an element of this type with a kit image. */
export function skinProps(type, asset) {
  if (type === 'image') {
    return { src: asset.src, ...(asset.crop ? { crop: asset.crop } : { crop: null }) };
  }
  if (!['panel', 'button', 'input'].includes(type)) return null;
  const props = { skin: asset.src, skinSlice: asset.slice || null };
  if (type !== 'panel' && asset.states) {
    props.states = {};
    for (const [state, src] of Object.entries(asset.states)) {
      if (state === 'normal') props.skin = src;
      else props.states[state] = { skin: src };
    }
  }
  return props;
}

/** A new image element showing a kit asset at its native size. */
export function assetNode(asset) {
  const w = asset.crop?.w || asset.w || 128, h = asset.crop?.h || asset.h || 128;
  return {
    id: generateId('image'),
    type: 'image',
    name: asset.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^./, c => c.toUpperCase()) || 'Image',
    anchor: 'top-left',
    rect: { x: 0, y: 0, w: Math.round(w), h: Math.round(h) },
    props: { ...defaultProps('image'), src: asset.src, crop: asset.crop || null, fit: asset.slice ? 'fill' : 'contain', comment: asset.path ? `Asset: ${asset.path}` : '' },
    children: []
  };
}
