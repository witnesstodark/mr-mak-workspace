/**
 * Game UI Studio - Local Guideline Checks
 * Measurable rules from knowledge/game-ui-guidelines.md, run on every change without an agent.
 * Each issue can be located on the canvas; fixes are offered only where they are safe and undoable.
 */

import {
  ANCHORS,
  BACK_PREVIOUS,
  computeLayout,
  computeWorldRect,
  defaultStates,
  findNode,
  findScreen,
  flattenNodes,
  focusOrder,
  defaultFocusId,
  naturalAnchor,
  previewResolutions,
  safeArea,
  screenRole,
  setAnchorKeepingBox,
  updateLocalFromWorld,
  wrapText
} from './model.mjs';

export const RULES = {
  'off-screen': { group: 'Layout', title: 'Off screen' },
  'spill': { group: 'Layout', title: 'Outside its parent' },
  'safe-zone': { group: 'Layout', title: 'Outside the action-safe area' },
  'anchor-drift': { group: 'Layout', title: 'Anchor drifts across aspect ratios' },
  'overlap': { group: 'Layout', title: 'Overlapping widgets' },
  'text-fit': { group: 'Text', title: 'Text does not fit' },
  'font-consistency': { group: 'Text', title: 'Inconsistent sibling font sizes' },
  'states': { group: 'Feedback', title: 'Missing visual states' },
  'dual-readout': { group: 'Feedback', title: 'Gauge without a numeric value' },
  'default-focus': { group: 'Navigation', title: 'No default focus' },
  'modal-focus': { group: 'Navigation', title: 'Unsafe default focus' },
  'back-nav': { group: 'Navigation', title: 'Esc / B does nothing' },
  'back-button': { group: 'Navigation', title: 'No on-screen Back button' },
  'confirm-destructive': { group: 'Navigation', title: 'Destructive action without confirmation' },
  'missing-target': { group: 'Navigation', title: 'Link to a missing screen' }
};

const BACK_WORDS = /\b(back|cancel|close|resume|return|discard|done|exit menu)\b/i;
const DESTRUCTIVE_WORDS = /\b(quit|exit|restart|reload|delete|reset|restore defaults|main menu|abandon|surrender|forfeit)\b/i;
const STATE_KEYS = ['hover', 'pressed', 'focused', 'disabled'];

export function estimateTextWidth(text, fontSize = 16, fontWeight = 'normal') {
  const bold = /bold|[6-9]00/.test(String(fontWeight));
  return String(text ?? '').length * fontSize * (bold ? 0.6 : 0.55);
}

const ratioName = r => `${r.label} · ${r.width}×${r.height}`;
const anchorLabel = id => (ANCHORS.find(a => a.id === id)?.label || id).toLowerCase();
const nodeText = n => n.props?.text || n.props?.label || '';

/**
 * Runs every rule on the given screens (all screens by default).
 */
export function runChecks(doc, { measureText = estimateTextWidth, screenIds = null } = {}) {
  const issues = [];
  for (const screen of doc.screens) {
    if (screenIds && !screenIds.includes(screen.id)) continue;
    checkScreen(doc, screen, issues, measureText);
  }
  const rank = { error: 0, warning: 1 };
  const order = new Map(doc.screens.map((s, i) => [s.id, i]));
  return issues.sort((a, b) => (order.get(a.screenId) - order.get(b.screenId)) || (rank[a.severity] - rank[b.severity]));
}

export function summarize(issues) {
  const errors = issues.filter(i => i.severity === 'error').length;
  return { errors, warnings: issues.length - errors, total: issues.length };
}

function issue(list, rule, severity, screen, node, message, extra = {}) {
  list.push({
    key: `${rule}:${screen.id}:${node?.id || ''}`,
    rule,
    group: RULES[rule].group,
    title: RULES[rule].title,
    severity,
    screenId: screen.id,
    nodeId: node?.id || null,
    nodeName: node?.name || null,
    message,
    ratio: extra.ratio || null,
    fix: extra.fix || null
  });
}

// How far a box leaves its bounds, and on which side.
function overflow(box, bounds) {
  const sides = [
    ['left', bounds.x - box.x],
    ['right', box.x + box.w - (bounds.x + bounds.w)],
    ['top', bounds.y - box.y],
    ['bottom', box.y + box.h - (bounds.y + bounds.h)]
  ];
  return sides.reduce((best, s) => (s[1] > best[1] ? s : best), ['', 0]);
}

function inside(box, bounds, tolerance = 1) {
  return box.x >= bounds.x - tolerance && box.y >= bounds.y - tolerance &&
    box.x + box.w <= bounds.x + bounds.w + tolerance && box.y + box.h <= bounds.y + bounds.h + tolerance;
}

function clampBox(box, bounds) {
  return {
    x: Math.min(Math.max(box.x, bounds.x), bounds.x + bounds.w - box.w),
    y: Math.min(Math.max(box.y, bounds.y), bounds.y + bounds.h - box.h),
    w: box.w,
    h: box.h
  };
}

function boundsOf(parentBox, resolution) {
  return parentBox || { x: 0, y: 0, w: resolution.width, h: resolution.height };
}

function isStretch(node) {
  const a = ANCHORS.find(item => item.id === node.anchor);
  return !!(a && (a.stretchX || a.stretchY));
}

// Fix helpers mutate a cloned document passed in by the editor.
function withNode(screenId, nodeId, fn) {
  return d => {
    const screen = findScreen(d, screenId);
    const found = screen && findNode(d, nodeId, screenId);
    if (!found) return;
    const parentBox = found.parent ? computeLayout(screen).get(found.parent.id)?.box : null;
    fn(found.node, parentBox || null, screen, d);
  };
}

/**
 * Root widgets drawn after a root panel and fully inside it (an icon or gauge
 * layered on a frame) belong to it visually and move with it.
 */
function ridersOf(roots, boxes) {
  const map = new Map();
  roots.forEach(({ node }, i) => {
    if (isStretch(node)) return;
    const A = boxes.get(node.id).box;
    const riders = roots.slice(i + 1)
      .filter(e => !isStretch(e.node) && inside(boxes.get(e.node.id).box, A, 0))
      .map(e => e.node.id);
    if (riders.length) map.set(node.id, riders);
  });
  return map;
}

function moveRiders(d, screenId, riderIds, dx, dy) {
  if (!dx && !dy) return;
  const screen = findScreen(d, screenId);
  for (const id of riderIds) {
    const found = findNode(d, id, screenId);
    if (!found) continue;
    const box = computeWorldRect(found.node, null, screen.resolution);
    updateLocalFromWorld(found.node, { ...box, x: box.x + dx, y: box.y + dy }, null, screen.resolution);
  }
}

function moveGroup(screenId, nodeId, riderIds, place) {
  return withNode(screenId, nodeId, (target, parentBox, s, d) => {
    const before = computeWorldRect(target, parentBox, s.resolution);
    place(target, parentBox, s.resolution);
    const after = computeWorldRect(target, parentBox, s.resolution);
    if (!parentBox) moveRiders(d, screenId, riderIds, after.x - before.x, after.y - before.y);
  });
}

/**
 * Plans the safest move that brings a box back inside its bounds at the design
 * resolution: mirror a right/bottom offset that points outward, else clamp.
 */
function planMoveInside(node, parentBox, resolution, bounds) {
  const a = ANCHORS.find(item => item.id === node.anchor) || ANCHORS[0];
  if (isStretch(node)) return null;
  const box = computeWorldRect(node, parentBox, resolution);
  if (box.w > bounds.w + 1 || box.h > bounds.h + 1) return null;
  const mirrored = { ...node, rect: { ...node.rect } };
  if (a.originX === 1 && node.rect.x > 0) mirrored.rect.x = -node.rect.x;
  if (a.originY === 1 && node.rect.y > 0) mirrored.rect.y = -node.rect.y;
  if ((mirrored.rect.x !== node.rect.x || mirrored.rect.y !== node.rect.y) && inside(computeWorldRect(mirrored, parentBox, resolution), bounds)) {
    return { label: 'Move inside', rect: mirrored.rect };
  }
  const target = clampBox(box, bounds);
  const moved = { ...node, rect: { ...node.rect } };
  updateLocalFromWorld(moved, target, parentBox, resolution);
  return { label: 'Move inside', rect: moved.rect };
}

function checkScreen(doc, screen, issues, measure) {
  const role = screenRole(screen);
  const design = screen.resolution;
  const ratios = previewResolutions(design);
  const layouts = ratios.map(ratio => ({ ratio, boxes: computeLayout(screen, ratio) }));
  const designBoxes = layouts[0].boxes;
  const flat = flattenNodes(screen.elements);

  const hidden = new Set();
  for (const { node, parent } of flat) {
    if (node.props?.visible === false || (parent && hidden.has(parent.id))) hidden.add(node.id);
  }
  const shown = flat.filter(e => !hidden.has(e.node.id));
  const roots = shown.filter(e => !e.parent);
  const riders = ridersOf(roots, designBoxes);
  const ridingWith = new Map();
  for (const [owner, ids] of riders) for (const id of ids) if (!ridingWith.has(id)) ridingWith.set(id, owner);
  const attached = id => (riders.get(id) || []).length;
  const withAttached = id => attached(id) ? ` The ${attached(id)} widget${attached(id) > 1 ? 's' : ''} drawn on it move${attached(id) > 1 ? '' : 's'} too.` : '';

  // ---- Anchor drift: root widgets anchored to a side they do not sit on.
  const drifting = new Map();
  for (const { node } of roots) {
    if (isStretch(node)) continue;
    const a = ANCHORS.find(item => item.id === node.anchor);
    if (!a) continue;
    const box = designBoxes.get(node.id).box;
    const nat = naturalAnchor(box, boundsOf(null, design));
    const n = ANCHORS.find(item => item.id === nat);
    let worst = { px: 0, ratio: null };
    for (const { ratio } of layouts.slice(1)) {
      const dx = Math.abs((a.originX - n.originX) * (ratio.width - design.width));
      const dy = Math.abs((a.originY - n.originY) * (ratio.height - design.height));
      const px = Math.max(dx, dy);
      if (px > worst.px) worst = { px, ratio };
    }
    if (worst.px < 24) continue;
    drifting.set(node.id, worst);
    issue(issues, 'anchor-drift', 'warning', screen, node,
      `Anchored ${anchorLabel(node.anchor)} but sits ${nat === 'center' ? 'in the center' : `at the ${anchorLabel(nat)}`}: it drifts ${Math.round(worst.px)} px from there at ${ratioName(worst.ratio)}.`,
      {
        ratio: worst.ratio.id,
        fix: {
          label: `Anchor ${anchorLabel(nat)}`,
          apply: withNode(screen.id, node.id, (target, parentBox, s) => setAnchorKeepingBox(target, nat, parentBox, s.resolution))
        }
      });
  }

  // ---- Off screen (roots) and outside the parent (children).
  const flagged = new Set();
  for (const { node, parent } of shown) {
    if (parent && flagged.has(parent.id)) { flagged.add(node.id); continue; }
    if (!parent && flagged.has(ridingWith.get(node.id))) { flagged.add(node.id); continue; }
    let fail = null;
    for (const { ratio, boxes } of layouts) {
      const item = boxes.get(node.id);
      const [side, px] = overflow(item.box, boundsOf(item.parentBox, ratio));
      if (px > 1) { fail = { ratio, side, px }; break; }
    }
    if (!fail) continue;
    flagged.add(node.id);
    const atDesign = fail.ratio.id === 'design';
    if (!atDesign && drifting.has(node.id)) continue; // the drift issue explains and fixes it
    const where = parent ? `past the ${fail.side} edge of ${parent.name}` : `past the ${fail.side} edge of the screen`;
    const plan = atDesign ? planMoveInside(node, designBoxes.get(node.id).parentBox, design, boundsOf(designBoxes.get(node.id).parentBox, design)) : null;
    issue(issues, parent ? 'spill' : 'off-screen', parent || !atDesign ? 'warning' : 'error', screen, node,
      `Extends ${Math.round(fail.px)} px ${where} at ${ratioName(fail.ratio)}.${parent ? '' : withAttached(node.id)}`,
      {
        ratio: fail.ratio.id,
        fix: plan ? { label: plan.label, apply: moveGroup(screen.id, node.id, riders.get(node.id) || [], target => { target.rect = { ...plan.rect }; }) } : null
      });
  }

  // ---- HUD safe zone: corner widgets stay inside the 90% action-safe frame.
  if (role === 'hud') {
    const movedWith = new Set();
    for (const { node } of roots) {
      if (isStretch(node) || flagged.has(node.id) || drifting.has(node.id) || movedWith.has(node.id)) continue;
      for (const { ratio, boxes } of layouts) {
        const [side, px] = overflow(boxes.get(node.id).box, safeArea(ratio));
        if (px <= 1) continue;
        const atDesign = ratio.id === 'design';
        const box = designBoxes.get(node.id).box;
        const safeDesign = safeArea(design);
        const canClamp = atDesign && box.w <= safeDesign.w && box.h <= safeDesign.h;
        (riders.get(node.id) || []).forEach(id => movedWith.add(id));
        issue(issues, 'safe-zone', 'warning', screen, node,
          `${Math.round(px)} px past the ${side} of the action-safe frame at ${ratioName(ratio)}. Corner widgets belong inside it.${withAttached(node.id)}`,
          {
            ratio: ratio.id,
            fix: canClamp ? {
              label: 'Move into safe area',
              apply: moveGroup(screen.id, node.id, riders.get(node.id) || [], (target, parentBox, r) => {
                updateLocalFromWorld(target, clampBox(computeWorldRect(target, parentBox, r), safeArea(r)), parentBox, r);
              })
            } : null
          });
        break;
      }
    }
  }

  // ---- Overlap: HUD widgets, and interactive siblings on any screen.
  const siblings = new Map();
  for (const { node, parent } of shown) {
    if (isStretch(node)) continue;
    const interactive = ['button', 'input', 'checkbox', 'slider'].includes(node.type);
    if (!(role === 'hud' && !parent) && !interactive) continue;
    const key = parent?.id || '__root';
    if (!siblings.has(key)) siblings.set(key, []);
    siblings.get(key).push(node);
  }
  const reported = new Set();
  for (const group of siblings.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let k = i + 1; k < group.length; k++) {
        const a = group[i], b = group[k];
        if (reported.has(b.id)) continue;
        for (const { ratio, boxes } of layouts) {
          const A = boxes.get(a.id).box, B = boxes.get(b.id).box;
          const ow = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          const oh = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          if (ow < 2 || oh < 2 || inside(A, B, 0) || inside(B, A, 0)) continue;
          reported.add(b.id);
          issue(issues, 'overlap', 'warning', screen, b,
            `Overlaps ${a.name} by ${Math.round(Math.min(ow, oh))} px at ${ratioName(ratio)}.`,
            { ratio: ratio.id });
          break;
        }
      }
    }
  }

  // ---- Text containment.
  for (const { node } of shown) {
    const p = node.props || {};
    const box = designBoxes.get(node.id).box;
    const size = p.fontSize ?? (node.type === 'label' ? 18 : 16);
    const weight = p.fontWeight || 'normal';
    const width = text => measure(text, size, weight);
    const resizable = !isStretch(node);
    if (node.type === 'button' && p.text) {
      const need = Math.ceil(width(p.text) + 16);
      const tall = Math.ceil(size * 1.2);
      if (need <= box.w && tall <= box.h) continue;
      const parts = [];
      if (need > box.w) parts.push(`the label needs ${need} px but the button is ${Math.round(box.w)} px wide`);
      if (tall > box.h) parts.push(`${size} px text is taller than the ${Math.round(box.h)} px button`);
      issue(issues, 'text-fit', 'warning', screen, node, `${capitalize(parts.join('; '))}.`, {
        fix: resizable ? {
          label: need > box.w ? `Widen to ${need + 16} px` : `Grow to ${tall + 8} px`,
          apply: withNode(screen.id, node.id, target => {
            if (need > box.w) target.rect.w = need + 16;
            if (tall > box.h) target.rect.h = tall + 8;
          })
        } : null
      });
    } else if (node.type === 'label' && p.text) {
      const lines = wrapText(width, p.text, box.w);
      const widest = Math.max(...lines.map(width));
      const needH = Math.ceil(lines.length === 1 ? size * 1.1 : lines.length * size * 1.25);
      if (widest <= box.w + 1 && needH <= box.h + 2) continue;
      const msg = widest > box.w + 1
        ? `"${lines.find(l => width(l) === widest)}" needs ${Math.ceil(widest)} px; the label is ${Math.round(box.w)} px wide.`
        : `The text needs ${lines.length === 1 ? 'one line' : `${lines.length} lines`} (${needH} px); the label is ${Math.round(box.h)} px tall.`;
      issue(issues, 'text-fit', 'warning', screen, node, msg, {
        fix: resizable ? {
          label: widest > box.w + 1 ? `Widen to ${Math.ceil(widest) + 4} px` : `Grow to ${needH} px`,
          apply: withNode(screen.id, node.id, target => {
            if (widest > box.w + 1) target.rect.w = Math.ceil(widest) + 4;
            else target.rect.h = needH;
          })
        } : null
      });
    } else if (node.type === 'checkbox' && p.label) {
      const need = Math.ceil(28 + measure(p.label, 14, 'normal'));
      if (need <= box.w + 1) continue;
      issue(issues, 'text-fit', 'warning', screen, node, `The label needs ${need} px; the toggle is ${Math.round(box.w)} px wide.`, {
        fix: resizable ? { label: `Widen to ${need + 4} px`, apply: withNode(screen.id, node.id, target => { target.rect.w = need + 4; }) } : null
      });
    }
  }

  // ---- Sibling buttons share one font size.
  const buttonGroups = new Map();
  for (const { node, parent } of shown) {
    if (node.type !== 'button') continue;
    const key = parent?.id || '__root';
    if (!buttonGroups.has(key)) buttonGroups.set(key, { parent, nodes: [] });
    buttonGroups.get(key).nodes.push(node);
  }
  for (const { parent, nodes } of buttonGroups.values()) {
    if (nodes.length < 2) continue;
    const counts = new Map();
    for (const n of nodes) counts.set(n.props.fontSize ?? 16, (counts.get(n.props.fontSize ?? 16) || 0) + 1);
    if (counts.size < 2) continue;
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const odd = nodes.find(n => (n.props.fontSize ?? 16) !== common);
    issue(issues, 'font-consistency', 'warning', screen, odd,
      `Buttons in ${parent ? parent.name : 'the screen root'} use ${[...counts.keys()].sort((a, b) => a - b).join(' and ')} px. Siblings should share one size.`,
      {
        fix: {
          label: `Use ${common} px for all`,
          apply: d => {
            for (const n of nodes) {
              const found = findNode(d, n.id, screen.id);
              if (found) found.node.props.fontSize = common;
            }
          }
        }
      });
  }

  // ---- Five visual states on every button.
  const missing = new Map();
  const lacking = [];
  for (const { node } of shown) {
    if (node.type !== 'button') continue;
    const absent = STATE_KEYS.filter(k => !node.props.states?.[k]);
    if (!absent.length) continue;
    lacking.push(node);
    for (const k of absent) missing.set(k, (missing.get(k) || 0) + 1);
  }
  if (lacking.length) {
    const names = [...missing.entries()].map(([k, n]) => `${capitalize(k)} (${n})`).join(', ');
    issue(issues, 'states', 'warning', screen, lacking[0],
      `${lacking.length} button${lacking.length > 1 ? 's' : ''} lack${lacking.length > 1 ? '' : 's'} states: ${names}. Every interactive element needs Normal, Hover, Pressed, Focused and Disabled.`,
      {
        fix: {
          label: 'Add missing states',
          apply: d => {
            for (const n of lacking) {
              const found = findNode(d, n.id, screen.id);
              if (!found) continue;
              const p = found.node.props;
              const defaults = defaultStates(p);
              p.states = { ...defaults, ...(p.states || {}) };
            }
          }
        }
      });
  }

  // ---- HUD gauges show bar and number.
  if (role === 'hud') {
    for (const { node } of shown) {
      if (node.type !== 'slider' || node.props.showValue !== false) continue;
      issue(issues, 'dual-readout', 'warning', screen, node, 'Critical gauges should show the bar and the exact value (e.g. 85 / 100).', {
        fix: { label: 'Show value', apply: withNode(screen.id, node.id, target => { target.props.showValue = true; }) }
      });
    }
  }

  // ---- Navigation: missing targets.
  for (const { node } of flat) {
    const to = node.nav?.onConfirm;
    if (!to || to === BACK_PREVIOUS || findScreen(doc, to)) continue;
    issue(issues, 'missing-target', 'error', screen, node, `${node.name} opens a screen that no longer exists.`, {
      fix: { label: 'Remove link', apply: withNode(screen.id, node.id, target => { delete target.nav; }) }
    });
  }
  const back = screen.nav?.onBack;
  if (back && back !== BACK_PREVIOUS && !findScreen(doc, back)) {
    issue(issues, 'missing-target', 'error', screen, null, 'Esc / B opens a screen that no longer exists.', {
      fix: { label: 'Esc returns to previous', apply: d => { findScreen(d, screen.id).nav = { ...(findScreen(d, screen.id).nav || {}), onBack: BACK_PREVIOUS }; } }
    });
  }

  if (role === 'hud') return;
  const order = focusOrder(screen);
  const byId = new Map(flat.map(e => [e.node.id, e.node]));
  const backLike = id => {
    const n = byId.get(id);
    return n && n.type === 'button' && (BACK_WORDS.test(nodeText(n)) || BACK_WORDS.test(n.name.replace(/^Btn/, '')));
  };

  // ---- Default focus for keyboard and gamepad.
  if (order.length) {
    const current = defaultFocusId(screen);
    const safest = role === 'modal' ? order.find(backLike) : null;
    if (!current) {
      const pick = safest || order[0];
      issue(issues, 'default-focus', 'warning', screen, byId.get(pick),
        'Nothing has focus when this screen opens, so keyboard and gamepad players start with no selection.',
        { fix: { label: `Focus ${byId.get(pick).name}`, apply: d => setFocus(d, screen.id, pick) } });
    } else if (safest && current !== safest && !backLike(current)) {
      issue(issues, 'modal-focus', 'warning', screen, byId.get(current),
        `Default focus is on ${byId.get(current).name}; the safest option (${byId.get(safest).name}) should be focused.`,
        { fix: { label: `Focus ${byId.get(safest).name}`, apply: d => setFocus(d, screen.id, safest) } });
    }
  }

  // ---- Esc / B and an explicit Back button on submenus and modals.
  if (role === 'submenu' || role === 'modal') {
    if (!back) {
      issue(issues, 'back-nav', 'warning', screen, null, 'Esc (keyboard) and B / Circle (gamepad) should close this screen.', {
        fix: { label: 'Esc returns to previous', apply: d => { const s = findScreen(d, screen.id); s.nav = { ...(s.nav || {}), onBack: BACK_PREVIOUS }; } }
      });
    }
    if (!shown.some(e => backLike(e.node.id))) {
      issue(issues, 'back-button', 'warning', screen, null, 'Pair Esc with a visible Back, Cancel or Close button.');
    }
  }

  // ---- Destructive actions open a confirmation modal.
  if (role !== 'modal') {
    const modals = doc.screens.filter(s => screenRole(s) === 'modal');
    for (const { node } of shown) {
      if (node.type !== 'button') continue;
      const text = `${nodeText(node)} ${node.name.replace(/^Btn/, '').replace(/([a-z])([A-Z])/g, '$1 $2')}`;
      if (!DESTRUCTIVE_WORDS.test(text)) continue;
      const target = node.nav?.onConfirm ? findScreen(doc, node.nav.onConfirm) : null;
      if (target && screenRole(target) === 'modal') continue;
      issue(issues, 'confirm-destructive', 'warning', screen, node,
        `"${nodeText(node) || node.name}" should open a confirmation dialog first.`,
        {
          fix: modals.length === 1 ? {
            label: `Link to ${modals[0].name}`,
            apply: withNode(screen.id, node.id, n => { n.nav = { ...(n.nav || {}), onConfirm: modals[0].id }; })
          } : null
        });
    }
  }
}

function setFocus(d, screenId, nodeId) {
  const s = findScreen(d, screenId);
  if (!s) return;
  s.focus = { order: [], ...(s.focus || {}), default: nodeId };
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
