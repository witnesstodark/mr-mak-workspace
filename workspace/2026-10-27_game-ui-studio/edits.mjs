/**
 * Game UI Studio - Copilot context and structured edits
 * Every message to the agent carries the active screen as compact JSON plus the
 * edit protocol. The agent answers with a fenced `gameui-edit` block; each op is
 * validated against model.mjs before the studio previews or applies it.
 * Pure module: no DOM, so `node --test` covers it (test/edits.test.mjs).
 */
import {
  TYPES,
  ANCHORS,
  SCREEN_ROLES,
  BACK_PREVIOUS,
  defaultProps,
  defaultStates,
  newNode,
  findScreen,
  flattenNodes,
  computeLayout,
  setAnchorKeepingBox,
  screenRole,
  isInteractive,
  focusOrder,
  defaultFocusId
} from './model.mjs';

export const EDIT_TAG = 'gameui-edit';
export const EDIT_OPS = ['add', 'update', 'remove', 'screen', 'link'];
export const MAX_OPS = 40;
const MAX_NEW_NODES = 120;
const MAX_DEPTH = 6;
const LIMIT = 20000;
const OP_ALIASES = { insert: 'add', create: 'add', modify: 'update', edit: 'update', set: 'update', delete: 'remove' };

const TYPE_IDS = TYPES.map(t => t.id);
const ANCHOR_IDS = ANCHORS.map(a => a.id);
const STATE_KEYS = ['hover', 'pressed', 'focused', 'disabled'];
const BASE_PROPS = ['opacity', 'visible', 'locked', 'comment'];
const TYPE_PROPS = {
  panel: ['bgColor', 'borderColor', 'borderWidth', 'borderRadius', 'padding', 'skin', 'skinSlice'],
  button: ['text', 'fontSize', 'fontColor', 'fontWeight', 'fontFamily', 'bgColor', 'borderColor', 'borderWidth', 'borderRadius', 'textAlign', 'skin', 'skinSlice', 'states'],
  label: ['text', 'fontSize', 'fontColor', 'fontWeight', 'fontFamily', 'textAlign'],
  slider: ['label', 'value', 'min', 'max', 'trackColor', 'fillColor', 'showValue', 'states'],
  image: ['src', 'tintColor', 'crop', 'fit'],
  input: ['placeholder', 'value', 'fontSize', 'fontColor', 'fontFamily', 'bgColor', 'borderColor', 'borderWidth', 'borderRadius', 'skin', 'skinSlice', 'states'],
  checkbox: ['label', 'checked', 'fontSize', 'fontColor', 'fontFamily', 'checkColor', 'states'],
  group: []
};
const WEIGHT_ALIASES = { normal: 'normal', regular: 'normal', 400: 'normal', 500: '500', medium: '500', 600: '600', semibold: '600', bold: 'bold', 700: 'bold' };
const COLOR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\)|transparent|[a-z]{3,20})$/i;

export const EDIT_PROTOCOL = `Edit protocol: answer in plain text. To change the layout, also add ONE fenced block tagged ${EDIT_TAG} that holds JSON. The studio checks every op, previews the result on the canvas and lets the user apply or discard it, so do not write .gameui.json files for layout changes.
\`\`\`${EDIT_TAG}
{"summary": "One short sentence", "screen": "<screen id>", "ops": []}
\`\`\`
Ops, applied in order:
- {"op": "add", "parent": "<element id> or null for the screen root", "index": 0, "node": {"id": "optional_new_id", "type": "button", "name": "BtnBack", "anchor": "bottom-left", "rect": [x, y, w, h], "props": {"text": "Back"}, "opens": "<screen id>", "children": []}}
- {"op": "update", "id": "<element id>", "set": {"name": "…", "anchor": "…", "rect": [x, y, w, h] or {"y": 120}, "props": {"fontSize": 18, "comment": null}, "opens": "<screen id>|@previous|null"}}. Props merge and null removes one; an anchor without a rect keeps the element where it is.
- {"op": "remove", "id": "<element id>"}
- {"op": "screen", "set": {"name": "…", "role": "menu|submenu|modal|hud", "notes": "…", "resolution": [1920, 1080], "onBack": "<screen id>|@previous|null", "focusDefault": "<element id>|null", "focusOrder": ["<element id>"]}}
- {"op": "link", "from": "<button id>", "to": "<screen id>|@previous|null"}
Types: ${TYPE_IDS.join(', ')}. Anchors: ${ANCHOR_IDS.join(', ')}. Offsets follow screen axes from the anchor point inside the parent, so right and bottom anchors use negative x / y. A stretched axis uses x / y as the left / top margin and w / h as the right / bottom margin.
Props: text, label, fontSize, fontWeight (normal|500|600|bold), fontColor, textAlign (left|center|right), bgColor, borderColor, borderWidth, borderRadius, padding, opacity (0-1), visible, comment (the intent note), value, min, max, showValue, fillColor, trackColor, checked, checkColor, placeholder, src, fit (contain|cover|fill), crop {x, y, w, h}, fontFamily (a font from the game kit), skin (an image src drawn as the panel, button or input background, replacing fill and border), skinSlice [left, top, right, bottom] (9-slice margins in source pixels), states {"hover"|"pressed"|"focused"|"disabled": {bgColor, borderColor, fontColor, skin, ringColor (focused), opacity (disabled)}}. Colours are hex or rgba(). Use the element and screen ids from the context; new ids must be unique.`;

// ================= Context sent with every message =================

function compactProps(node, full = false) {
  const defaults = defaultProps(node.type);
  const out = {};
  for (const [key, value] of Object.entries(node.props || {})) {
    if (value === undefined) continue;
    if (key === 'states') {
      if (full) out.states = value;
      else if (value && typeof value === 'object' && Object.keys(value).length) out.statesDefined = Object.keys(value);
      continue;
    }
    if (!full && JSON.stringify(value) === JSON.stringify(defaults[key])) continue;
    out[key] = key === 'src' && typeof value === 'string' && value.startsWith('data:') ? '(embedded image)' : value;
  }
  return out;
}

const rectArray = r => [r.x, r.y, r.w, r.h].map(v => Math.round(v));

/**
 * The active screen as compact JSON: ids, anchors, rects as [x, y, w, h], props
 * that differ from the type defaults, links, the selection with all its props,
 * and the names of the local check failures.
 */
export function screenContext(doc, screenId, selectedId = null, { selection = true, issues = [], lean = false, kit = null } = {}) {
  const screen = findScreen(doc, screenId) || doc.screens[0];
  const node = n => {
    const item = { id: n.id, type: n.type, name: n.name, anchor: n.anchor, rect: rectArray(n.rect) };
    const props = lean ? {} : compactProps(n);
    if (lean && (n.props.text || n.props.label)) props.text = n.props.text || n.props.label;
    if (Object.keys(props).length) item.props = props;
    if (n.nav?.onConfirm) item.opens = n.nav.onConfirm;
    if (n.children?.length) item.children = n.children.map(node);
    return item;
  };
  const info = { id: screen.id, name: screen.name, role: screenRole(screen), resolution: [screen.resolution.width, screen.resolution.height] };
  if (screen.notes) info.notes = screen.notes;
  if (screen.nav?.onBack) info.onBack = screen.nav.onBack;
  const def = defaultFocusId(screen);
  if (def) info.focusDefault = def;
  if (screen.focus?.order?.length) info.focusOrder = focusOrder(screen);
  if (screen.bgImage) info.referenceImage = true;

  const context = {
    project: doc.projectName || null,
    screen: info,
    otherScreens: doc.screens.filter(s => s.id !== screen.id).map(s => ({ id: s.id, name: s.name })),
    elements: (screen.elements || []).map(node)
  };
  // The game kit file: its srcs, slices, colours, fonts and components.
  if (kit) context.kit = kit;
  if (lean) context.note = 'Props omitted: this screen is large. Ask for an element to see its props.';
  if (selection && selectedId) {
    const entry = computeLayout(screen).get(selectedId);
    if (entry) {
      context.selection = {
        id: entry.node.id,
        name: entry.node.name,
        type: entry.node.type,
        parent: entry.parent?.id || null,
        world: rectArray(entry.box),
        props: compactProps(entry.node, true)
      };
    }
  }
  const mine = issues.filter(i => i.screenId === screen.id).slice(0, 12);
  if (mine.length) context.checks = mine.map(i => `${i.title}${i.nodeName ? ` (${i.nodeName})` : ''}`);
  return context;
}

/** The user's text followed by the screen context and the edit protocol. */
export function buildPrompt(text, context) {
  const body = String(text || '').trim();
  if (!context) return body;
  return `${body}

---
Game UI Studio context, attached automatically: the active screen as compact JSON. rect is [x, y, w, h]; props left out use the type defaults.
\`\`\`json
${JSON.stringify(context)}
\`\`\`

${EDIT_PROTOCOL}`;
}

/** Context for a prompt that stays well inside the CLI paste limit. */
export function promptContext(doc, screenId, selectedId, options = {}) {
  const full = screenContext(doc, screenId, selectedId, options);
  return JSON.stringify(full).length > 40000 ? screenContext(doc, screenId, selectedId, { ...options, lean: true }) : full;
}

export const estimateTokens = text => Math.ceil(String(text || '').length / 4);

// ================= Reading the reply =================

const FENCE = /^[ \t]*```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;

/**
 * Splits a reply into prose and edit blocks. A `gameui-edit` fence is an edit;
 * so is a json (or untagged) fence whose object has an "ops" list.
 */
export function extractEdits(text) {
  const source = String(text || '');
  const blocks = [];
  let prose = '';
  let last = 0;
  for (const match of source.matchAll(FENCE)) {
    const tag = match[1].toLowerCase();
    let isEdit = tag === EDIT_TAG;
    let value = null;
    let error = null;
    if (isEdit || tag === 'json' || tag === '') {
      try {
        value = JSON.parse(match[2]);
      } catch (err) {
        if (isEdit) error = `The ${EDIT_TAG} block is not valid JSON (${err.message}).`;
      }
      if (!isEdit && value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.ops)) isEdit = true;
    }
    if (!isEdit) continue;
    prose += source.slice(last, match.index);
    last = match.index + match[0].length;
    blocks.push(error ? { error, raw: match[2] } : { edit: value, raw: match[2] });
  }
  prose += source.slice(last);
  const open = prose.search(new RegExp('```[ \\t]*' + EDIT_TAG, 'i'));
  if (open >= 0) {
    blocks.push({ error: `The ${EDIT_TAG} block is not closed, so the reply may have been cut off.`, raw: prose.slice(open) });
    prose = prose.slice(0, open);
  }
  return { prose: prose.replace(/\n{3,}/g, '\n\n').trim(), blocks };
}

// ================= Validation =================

class EditError extends Error {}
const fail = message => { throw new EditError(message); };
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const quote = v => JSON.stringify(v);

function allowKeys(obj, keys, what) {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) fail(`Unknown field "${key}" in ${what}. Use ${keys.join(', ')}.`);
  }
}

function text(value, what, max, { empty = true } = {}) {
  if (typeof value !== 'string') fail(`${what} must be text.`);
  if (value.length > max) fail(`${what} is longer than ${max} characters.`);
  if (!empty && !value.trim()) fail(`${what} cannot be empty.`);
  return empty ? value : value.trim();
}

function number(value, what, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} must be a number, not ${quote(value)}.`);
  if (value < min || value > max) fail(`${what} must be between ${min} and ${max}.`);
  return value;
}

function bool(value, what) {
  if (typeof value !== 'boolean') fail(`${what} must be true or false.`);
  return value;
}

function color(value, what) {
  if (typeof value !== 'string' || value.length > 64 || !COLOR.test(value.trim())) fail(`${what} must be a colour such as #1e293b or rgba(0, 0, 0, 0.5), not ${quote(value)}.`);
  return value.trim();
}

function oneOf(value, list, what) {
  if (!list.includes(value)) fail(`${what} must be one of ${list.join(', ')}, not ${quote(value)}.`);
  return value;
}

function newId(value, state) {
  if (typeof value !== 'string' || !/^[A-Za-z][\w.:-]{0,79}$/.test(value)) fail(`New id ${quote(value)} must start with a letter and use letters, digits, _ - . or :.`);
  if (state.ids.has(value)) fail(`Id "${value}" is already used; give the new element another id or leave it out.`);
  return value;
}

function checkState(key, value, allowNull) {
  if (!isObject(value)) fail(`props.states.${key} must be an object.`);
  const keys = ['bgColor', 'borderColor', 'fontColor', 'skin', ...(key === 'focused' ? ['ringColor'] : []), ...(key === 'disabled' ? ['opacity'] : [])];
  allowKeys(value, keys, `props.states.${key}`);
  const out = {};
  for (const [field, v] of Object.entries(value)) {
    if (v === null) { if (allowNull) out[field] = null; continue; }
    out[field] = field === 'opacity' ? number(v, `props.states.${key}.opacity`, 0, 1)
      : field === 'skin' ? text(v, `props.states.${key}.skin`, 2000)
      : color(v, `props.states.${key}.${field}`);
  }
  return out;
}

function checkProp(type, key, value, allowNull) {
  const what = `props.${key}`;
  switch (key) {
    case 'text': return text(value, what, 300);
    case 'label': return text(value, what, 200);
    case 'placeholder': return text(value, what, 200);
    case 'comment': return text(value, what, 2000);
    case 'src':
    case 'skin': return text(value, what, 2000);
    case 'fontFamily': return text(value, what, 80);
    case 'skinSlice': {
      if (!Array.isArray(value) || value.length !== 4) fail('props.skinSlice must be [left, top, right, bottom] in source pixels.');
      return value.map((v, i) => number(v, `props.skinSlice[${i}]`, 0, 4096));
    }
    case 'value': return type === 'slider' ? number(value, what, -1e6, 1e6) : text(value, what, 500);
    case 'min':
    case 'max': return number(value, what, -1e6, 1e6);
    case 'fontSize': return number(value, what, 6, 300);
    case 'fontWeight': {
      const w = WEIGHT_ALIASES[String(value).toLowerCase()];
      if (!w) fail(`props.fontWeight must be normal, 500, 600 or bold, not ${quote(value)}.`);
      return w;
    }
    case 'textAlign': return oneOf(value, ['left', 'center', 'right'], what);
    case 'fit': return oneOf(value, ['contain', 'cover', 'fill'], what);
    case 'borderWidth': return number(value, what, 0, 64);
    case 'borderRadius': return number(value, what, 0, 2000);
    case 'padding': return number(value, what, 0, 1000);
    case 'opacity': return number(value, what, 0, 1);
    case 'visible':
    case 'locked':
    case 'showValue':
    case 'checked': return bool(value, what);
    case 'crop': {
      if (!isObject(value)) fail('props.crop must be {x, y, w, h} or null.');
      allowKeys(value, ['x', 'y', 'w', 'h'], 'props.crop');
      const out = {};
      for (const k of ['x', 'y', 'w', 'h']) out[k] = number(value[k], `props.crop.${k}`, 0, 16384);
      return out;
    }
    case 'states': {
      if (!isObject(value)) fail('props.states must be an object keyed by hover, pressed, focused or disabled.');
      allowKeys(value, STATE_KEYS, 'props.states');
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (v === null) { if (allowNull) out[k] = null; continue; }
        out[k] = checkState(k, v, allowNull);
      }
      return out;
    }
    default: return color(value, what);
  }
}

function checkProps(type, props, { allowNull = false } = {}) {
  if (props === undefined || props === null) return {};
  if (!isObject(props)) fail('props must be an object.');
  const allowed = [...BASE_PROPS, ...TYPE_PROPS[type]];
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key)) fail(`A ${type} has no "${key}" prop. Use ${allowed.join(', ')}.`);
    if (value === null) { if (allowNull) out[key] = null; continue; }
    out[key] = checkProp(type, key, value, allowNull);
  }
  return out;
}

function checkRect(value, anchorId, current) {
  const anchor = ANCHORS.find(a => a.id === anchorId) || ANCHORS[0];
  let r;
  if (Array.isArray(value)) {
    if (value.length !== 4) fail('rect must be [x, y, w, h].');
    r = { x: value[0], y: value[1], w: value[2], h: value[3] };
  } else if (isObject(value)) {
    allowKeys(value, ['x', 'y', 'w', 'h'], 'rect');
    r = { ...current };
    for (const k of ['x', 'y', 'w', 'h']) if (value[k] !== undefined) r[k] = value[k];
  } else {
    fail('rect must be [x, y, w, h] or an object with x, y, w or h.');
  }
  for (const k of ['x', 'y', 'w', 'h']) number(r[k], `rect.${k}`, -LIMIT, LIMIT);
  if (!anchor.stretchX && r.w < 1) fail(`rect.w must be at least 1 for a ${anchor.id} anchor.`);
  if (!anchor.stretchY && r.h < 1) fail(`rect.h must be at least 1 for a ${anchor.id} anchor.`);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function locate(screen, id) {
  if (typeof id !== 'string' || !id) return null;
  const walk = (nodes, parent) => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return { node: nodes[i], parent, siblings: nodes, index: i };
      const found = nodes[i].children?.length ? walk(nodes[i].children, nodes[i]) : null;
      if (found) return found;
    }
    return null;
  };
  return walk(screen.elements, null);
}

function element(screen, id, what = 'Element') {
  const found = locate(screen, id);
  if (!found) fail(`${what} ${quote(id)} is not on ${screen.name}. Use an id from the context.`);
  return found;
}

function screenTarget(doc, screen, value, what) {
  if (value === BACK_PREVIOUS) return value;
  if (typeof value !== 'string' || !value) fail(`${what} must be a screen id, "${BACK_PREVIOUS}" or null.`);
  const target = findScreen(doc, value) || doc.screens.find(s => s.name === value);
  if (!target) fail(`${what}: screen ${quote(value)} does not exist. Screens: ${doc.screens.map(s => `${s.name} (${s.id})`).join(', ')}.`);
  if (target.id === screen.id) fail(`${what} cannot be ${screen.name} itself; use "${BACK_PREVIOUS}" to close it.`);
  return target.id;
}

function buildNode(state, spec, depth) {
  if (!isObject(spec)) fail('node must be an object with type, name, anchor and rect.');
  allowKeys(spec, ['id', 'type', 'name', 'anchor', 'rect', 'props', 'opens', 'children'], 'node');
  if (depth > MAX_DEPTH) fail(`Nested children go deeper than ${MAX_DEPTH} levels.`);
  if (++state.newNodes > MAX_NEW_NODES) fail(`One edit can add up to ${MAX_NEW_NODES} elements.`);
  const type = oneOf(spec.type, TYPE_IDS, 'node.type');
  const id = spec.id === undefined ? undefined : newId(spec.id, state);
  const name = spec.name === undefined ? undefined : text(spec.name, 'node.name', 80, { empty: false });
  const anchor = spec.anchor === undefined ? 'top-left' : oneOf(spec.anchor, ANCHOR_IDS, 'node.anchor');
  const base = newNode(type, name, { id });
  const rect = spec.rect === undefined ? base.rect : checkRect(spec.rect, anchor, base.rect);
  const props = checkProps(type, spec.props);
  const opens = spec.opens === undefined || spec.opens === null ? null : screenTarget(state.doc, state.screen, spec.opens, 'node.opens');
  if (spec.children !== undefined && !Array.isArray(spec.children)) fail('node.children must be a list of nodes.');

  const node = newNode(type, name || base.name, { id: base.id, anchor, ...rect, props });
  // A custom fill without custom states gets hover and pressed shades of that fill.
  if (base.props.states && props.bgColor && !props.states) node.props.states = defaultStates({ bgColor: props.bgColor });
  if (props.states) node.props.states = mergeStates(base.props.states, props.states);
  if (opens) node.nav = { onConfirm: opens };
  state.ids.add(node.id);
  node.children = (spec.children || []).map(child => buildNode(state, child, depth + 1));
  return node;
}

function mergeStates(current = {}, patch) {
  const out = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) { delete out[key]; continue; }
    const next = { ...(out[key] || {}) };
    for (const [field, v] of Object.entries(value)) {
      if (v === null) delete next[field];
      else next[field] = v;
    }
    out[key] = next;
  }
  return out;
}

function forgetFocus(screen, gone) {
  if (!screen.focus) return;
  if (gone.has(screen.focus.default)) screen.focus.default = null;
  if (Array.isArray(screen.focus.order)) screen.focus.order = screen.focus.order.filter(id => !gone.has(id));
}

const rectText = r => `[${r.x}, ${r.y}, ${r.w}, ${r.h}]`;
const short = (v, n = 24) => {
  const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function changeDetail(before, after) {
  const parts = [];
  if (before.anchor !== after.anchor) parts.push(`anchor ${before.anchor} → ${after.anchor}`);
  for (const k of ['x', 'y', 'w', 'h']) if (before.rect[k] !== after.rect[k]) parts.push(`${k} ${before.rect[k]} → ${after.rect[k]}`);
  if (before.name !== after.name) parts.push(`name → ${after.name}`);
  const keys = new Set([...Object.keys(before.props || {}), ...Object.keys(after.props || {})]);
  for (const k of keys) {
    const a = JSON.stringify(before.props?.[k]);
    const b = JSON.stringify(after.props?.[k]);
    if (a === b) continue;
    if (k === 'comment') parts.push(after.props.comment ? 'intent note' : 'intent note removed');
    else if (k === 'states') parts.push('states');
    else parts.push(after.props?.[k] === undefined ? `${k} removed` : `${k} ${short(after.props[k])}`);
  }
  if ((before.nav?.onConfirm || null) !== (after.nav?.onConfirm || null)) parts.push(after.nav?.onConfirm ? `opens ${after.nav.onConfirm}` : 'link removed');
  return parts.length > 4 ? `${parts.slice(0, 4).join(' · ')} · +${parts.length - 4}` : parts.join(' · ');
}

function applyOp(state, raw) {
  const { doc, screen } = state;
  if (!isObject(raw)) fail('Each op must be an object with an "op" field.');
  const kind = OP_ALIASES[raw.op] || raw.op;
  if (!EDIT_OPS.includes(kind)) fail(`Unknown op ${quote(raw.op)}. Use ${EDIT_OPS.join(', ')}.`);

  if (kind === 'add') {
    allowKeys(raw, ['op', 'parent', 'index', 'node'], 'an add op');
    let siblings = screen.elements;
    let parent = null;
    if (raw.parent !== undefined && raw.parent !== null && raw.parent !== '') {
      parent = element(screen, raw.parent, 'Parent').node;
      parent.children = parent.children || [];
      siblings = parent.children;
    }
    const index = raw.index === undefined || raw.index === null ? siblings.length : raw.index;
    if (!Number.isInteger(index) || index < 0 || index > siblings.length) fail(`index must be a whole number from 0 to ${siblings.length}.`);
    const node = buildNode(state, raw.node, 0);
    siblings.splice(index, 0, node);
    const kids = flattenNodes(node.children).length;
    return { kind, id: node.id, name: node.name, detail: `${node.type} · ${parent ? `in ${parent.name}` : 'screen root'} · ${node.anchor} ${rectText(node.rect)}${kids ? ` · +${kids} inside` : ''}` };
  }

  if (kind === 'update') {
    allowKeys(raw, ['op', 'id', 'set'], 'an update op');
    const found = element(screen, raw.id);
    const node = found.node;
    if (!isObject(raw.set) || !Object.keys(raw.set).length) fail('"set" must name at least one change.');
    const set = raw.set;
    allowKeys(set, ['name', 'anchor', 'rect', 'props', 'opens'], '"set"');
    const name = set.name === undefined ? undefined : text(set.name, 'name', 80, { empty: false });
    const anchor = set.anchor === undefined ? undefined : oneOf(set.anchor, ANCHOR_IDS, 'anchor');
    const rect = set.rect === undefined ? undefined : checkRect(set.rect, anchor || node.anchor, node.rect);
    const props = checkProps(node.type, set.props, { allowNull: true });
    const opens = set.opens === undefined ? undefined : set.opens === null ? null : screenTarget(doc, screen, set.opens, 'opens');
    if (opens !== undefined && !isInteractive(node, screenRole(screen))) fail(`${node.name} is a ${node.type}, so it cannot open a screen.`);
    const merged = { ...node.props };
    for (const [k, v] of Object.entries(props)) {
      if (v === null) delete merged[k];
      else if (k === 'states') merged.states = mergeStates(node.props.states, v);
      else merged[k] = v;
    }
    if (node.type === 'slider' && (merged.min ?? 0) >= (merged.max ?? 100)) fail('props.min must be below props.max.');

    const before = structuredClone({ ...node, children: undefined });
    if (anchor && !rect) {
      const parentBox = found.parent ? computeLayout(screen).get(found.parent.id)?.box || null : null;
      setAnchorKeepingBox(node, anchor, parentBox, screen.resolution);
    } else if (anchor) {
      node.anchor = anchor;
    }
    if (rect) node.rect = rect;
    if (name) node.name = name;
    node.props = merged;
    if (opens === null) delete node.nav;
    else if (opens) node.nav = { ...(node.nav || {}), onConfirm: opens };
    return { kind, id: node.id, name: node.name, detail: changeDetail(before, node) || 'already as proposed' };
  }

  if (kind === 'remove') {
    allowKeys(raw, ['op', 'id'], 'a remove op');
    const found = element(screen, raw.id);
    found.siblings.splice(found.index, 1);
    const gone = new Set([found.node.id, ...flattenNodes(found.node.children || []).map(e => e.node.id)]);
    forgetFocus(screen, gone);
    return { kind, id: found.node.id, name: found.node.name, detail: `${found.node.type}${gone.size > 1 ? ` and ${gone.size - 1} inside` : ''}` };
  }

  if (kind === 'link') {
    allowKeys(raw, ['op', 'from', 'to'], 'a link op');
    const node = element(screen, raw.from, 'Element').node;
    if (!isInteractive(node, screenRole(screen))) fail(`${node.name} is a ${node.type}; only buttons, inputs, toggles and (outside a HUD) sliders open screens.`);
    const to = raw.to === null || raw.to === undefined || raw.to === '' ? null : screenTarget(doc, screen, raw.to, 'to');
    if (to) node.nav = { ...(node.nav || {}), onConfirm: to };
    else delete node.nav;
    const label = to === BACK_PREVIOUS ? 'back to the previous screen' : to ? findScreen(doc, to).name : 'no link';
    return { kind, id: node.id, name: node.name, detail: `opens ${label}` };
  }

  // screen
  allowKeys(raw, ['op', 'set'], 'a screen op');
  if (!isObject(raw.set) || !Object.keys(raw.set).length) fail('"set" must name at least one screen change.');
  const set = raw.set;
  allowKeys(set, ['name', 'role', 'notes', 'resolution', 'onBack', 'focusDefault', 'focusOrder'], 'a screen "set"');
  const name = set.name === undefined ? undefined : text(set.name, 'name', 80, { empty: false });
  const role = set.role === undefined ? undefined : set.role === null || set.role === '' || set.role === 'auto' ? null : oneOf(set.role, SCREEN_ROLES.map(r => r.id), 'role');
  const notes = set.notes === undefined ? undefined : set.notes === null ? '' : text(set.notes, 'notes', 4000);
  let resolution;
  if (set.resolution !== undefined) {
    const r = Array.isArray(set.resolution) ? { width: set.resolution[0], height: set.resolution[1] } : isObject(set.resolution) ? set.resolution : null;
    if (!r || (Array.isArray(set.resolution) && set.resolution.length !== 2)) fail('resolution must be [width, height].');
    resolution = { width: Math.round(number(r.width, 'resolution width', 320, 7680)), height: Math.round(number(r.height, 'resolution height', 240, 4320)) };
  }
  const onBack = set.onBack === undefined ? undefined : set.onBack === null || set.onBack === '' ? null : screenTarget(doc, screen, set.onBack, 'onBack');
  const focusable = new Set(focusOrder(screen));
  const focusId = (id, what) => {
    const found = element(screen, id, what);
    if (!focusable.has(found.node.id)) fail(`${found.node.name} cannot take focus: it is hidden or not interactive.`);
    return found.node.id;
  };
  const focusDefault = set.focusDefault === undefined ? undefined : set.focusDefault === null ? null : focusId(set.focusDefault, 'focusDefault');
  let order;
  if (set.focusOrder !== undefined) {
    if (!Array.isArray(set.focusOrder)) fail('focusOrder must be a list of element ids.');
    order = [...new Set(set.focusOrder.map(id => focusId(id, 'focusOrder')))];
  }
  const parts = [];
  if (name) { parts.push(`name → ${name}`); screen.name = name; }
  if (role !== undefined) { parts.push(`type → ${role || 'auto'}`); if (role) screen.role = role; else delete screen.role; }
  if (notes !== undefined) { parts.push('notes'); screen.notes = notes; }
  if (resolution) { parts.push(`${resolution.width} × ${resolution.height}`); screen.resolution = resolution; }
  if (onBack !== undefined) {
    parts.push(onBack ? `Esc → ${onBack === BACK_PREVIOUS ? 'previous' : findScreen(doc, onBack).name}` : 'Esc cleared');
    if (onBack) screen.nav = { ...(screen.nav || {}), onBack };
    else if (screen.nav) { delete screen.nav.onBack; if (!Object.keys(screen.nav).length) delete screen.nav; }
  }
  if (focusDefault !== undefined || order) {
    screen.focus = { default: screen.focus?.default || null, order: screen.focus?.order || [] };
    if (focusDefault !== undefined) { parts.push(focusDefault ? 'default focus' : 'default focus cleared'); screen.focus.default = focusDefault; }
    if (order) { parts.push('focus order'); screen.focus.order = order; }
  }
  return { kind, id: screen.id, name: screen.name, detail: parts.join(' · ') };
}

function describeRaw(raw) {
  if (!isObject(raw)) return { kind: 'invalid', name: 'op' };
  const kind = OP_ALIASES[raw.op] || raw.op;
  const name = raw.id || raw.from || raw.node?.name || raw.node?.id || (kind === 'screen' ? 'screen' : '');
  return { kind: EDIT_OPS.includes(kind) ? kind : 'invalid', name: typeof name === 'string' ? name : '' };
}

function diffScreens(before, after) {
  const index = s => new Map(flattenNodes(s.elements || []).map(({ node, parent }) => [node.id, { node, parent: parent?.id || null }]));
  const a = index(before);
  const b = index(after);
  const shallow = n => JSON.stringify({ ...n, children: undefined });
  const meta = s => JSON.stringify({ ...s, elements: undefined });
  return {
    added: [...b.keys()].filter(id => !a.has(id)),
    removed: [...a.keys()].filter(id => !b.has(id)),
    updated: [...b.keys()].filter(id => a.has(id) && (shallow(a.get(id).node) !== shallow(b.get(id).node) || a.get(id).parent !== b.get(id).parent)),
    screen: meta(before) !== meta(after)
  };
}

/**
 * Validates an edit op by op against the current document and returns the
 * document with every valid op applied. A rejected op changes nothing; later
 * ops still run, so an op that depends on a rejected one is rejected as well.
 * The input document is never modified.
 */
export function planEdit(doc, edit, fallbackScreenId = doc.activeScreen) {
  const plan = { ok: false, summary: '', screenId: null, screenName: '', errors: [], results: [], count: 0, rejected: 0, doc: null, marks: { added: [], updated: [], removed: [], screen: false } };
  if (!isObject(edit)) { plan.errors.push('The edit must be a JSON object with an "ops" list.'); return plan; }
  plan.summary = typeof edit.summary === 'string' ? edit.summary.trim().slice(0, 300) : '';
  if (!Array.isArray(edit.ops) || !edit.ops.length) { plan.errors.push('The edit has no "ops" list.'); return plan; }
  if (edit.ops.length > MAX_OPS) { plan.errors.push(`The edit has ${edit.ops.length} ops; the studio takes up to ${MAX_OPS} at once.`); return plan; }

  const next = structuredClone(doc);
  const wanted = edit.screen === undefined || edit.screen === null || edit.screen === '' ? fallbackScreenId : edit.screen;
  const start = typeof wanted === 'string' ? findScreen(next, wanted) || next.screens.find(s => s.name === wanted) : null;
  if (!start) {
    plan.errors.push(`Screen ${quote(edit.screen)} does not exist. Screens: ${next.screens.map(s => `${s.name} (${s.id})`).join(', ')}.`);
    return plan;
  }
  plan.screenId = start.id;
  const position = next.screens.indexOf(start);
  const original = structuredClone(start);
  const state = {
    doc: next,
    screen: start,
    ids: new Set(next.screens.flatMap(s => flattenNodes(s.elements || []).map(e => e.node.id))),
    newNodes: 0
  };

  edit.ops.forEach((raw, index) => {
    const snapshot = JSON.stringify(state.screen);
    const ids = new Set(state.ids);
    const newNodes = state.newNodes;
    try {
      const result = applyOp(state, raw);
      const changed = JSON.stringify(state.screen) !== snapshot;
      plan.results.push({ index, ok: true, noop: !changed, ...result });
      if (changed) plan.count++;
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      // Roll the screen back so a rejected op leaves no partial change.
      state.screen = JSON.parse(snapshot);
      next.screens[position] = state.screen;
      state.ids = ids;
      state.newNodes = newNodes;
      plan.results.push({ index, ok: false, ...describeRaw(raw), error: error.message });
      plan.rejected++;
    }
  });

  plan.screenName = state.screen.name;
  plan.doc = next;
  plan.marks = diffScreens(original, state.screen);
  plan.ok = plan.count > 0;
  return plan;
}

/** A follow-up message that lists the rejected ops, for the agent to correct. */
export function rejectionMessage(plan) {
  const lines = [...plan.errors, ...plan.results.filter(r => !r.ok).map(r => `- op ${r.index + 1} (${r.kind}${r.name ? ` ${r.name}` : ''}): ${r.error}`)];
  return `The studio rejected part of your last ${EDIT_TAG} block:\n${lines.join('\n')}\nSend a corrected ${EDIT_TAG} block with only the ops that still need to change.`;
}
