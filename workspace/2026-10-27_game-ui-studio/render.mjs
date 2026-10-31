/**
 * Game UI Studio - Canvas Renderer & Hit-Testing Engine
 * Handles engine anchors, safe zones, 9-slice simulation, responsive scaling, visual states,
 * focus order, selection outlines and handles.
 */

import { computeWorldRect, computeLayout, ANCHORS, safeArea, wrapText } from './model.mjs';

const imageCache = new Map();
const imageListeners = new Set();
const FONT_STACK = 'system-ui, -apple-system, sans-serif';

export function getImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  const img = new Image();
  img.src = src;
  img.onload = () => imageListeners.forEach(fn => fn(src));
  imageCache.set(src, img);
  return img;
}

/** Calls fn when an image the canvas asked for finishes loading, so it can redraw. */
export function onImageLoad(fn) {
  imageListeners.add(fn);
  return () => imageListeners.delete(fn);
}

const ready = img => img && img.complete && img.naturalWidth > 0;

/** A game font from the kit first, the system stack as the fallback. */
export function fontStack(family) {
  return family ? `"${String(family).replace(/["\\]/g, '')}", ${FONT_STACK}` : FONT_STACK;
}

/**
 * Draws a skin image over the box. slice [left, top, right, bottom] in source
 * pixels keeps the corners at their size and stretches the edges and centre
 * (9-slice), as the engines do. Returns false while the image is loading.
 */
export function drawSkin(ctx, src, slice, box) {
  const img = getImage(src);
  if (!ready(img)) return false;
  const W = img.naturalWidth, H = img.naturalHeight;
  const [l, t, r, b] = Array.isArray(slice) && slice.length === 4 ? slice.map(v => Math.max(0, Number(v) || 0)) : [0, 0, 0, 0];
  if (!(l || t || r || b) || l + r >= W || t + b >= H) {
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
    return true;
  }
  // Corners shrink together when the box is smaller than they are.
  const k = Math.min(1, box.w / (l + r || 1), box.h / (t + b || 1));
  const dl = l * k, dr = r * k, dt = t * k, db = b * k;
  const sx = [0, l, W - r, W], sy = [0, t, H - b, H];
  const dx = [box.x, box.x + dl, box.x + box.w - dr, box.x + box.w];
  const dy = [box.y, box.y + dt, box.y + box.h - db, box.y + box.h];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const sw = sx[col + 1] - sx[col], sh = sy[row + 1] - sy[row];
      const dw = dx[col + 1] - dx[col], dh = dy[row + 1] - dy[row];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(img, sx[col], sy[row], sw, sh, dx[col], dy[row], dw, dh);
    }
  }
  return true;
}

/**
 * Options:
 *  selection, hovered    node ids
 *  grid, showSafeZones   editor guides
 *  previewMode           true for thumbnails and exports (no guides or hidden nodes)
 *  mockState             'normal' | 'hover' | 'pressed' | 'focused' | 'disabled'
 *  focus                 { order: [ids], defaultId, activeId } for the Focused preview
 *  uiScale               canvas pixels per screen pixel, keeps handles a constant size
 *  highlight             node id outlined after Locate
 *  ghost                 { x, y, w, h } placement preview
 *  hideOverlay           skip the reference screenshot
 *  pins                  [{ id, n }] numbered intent-note pins
 *  proposal              { screen, added, updated, removed } Copilot edit shown as ghosts
 */
export function render(canvas, screen, options = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = screen.resolution;
  const {
    selection = null,
    hovered = null,
    grid = 0,
    showSafeZones = true,
    previewMode = false,
    mockState = 'normal',
    focus = null,
    uiScale = 1,
    highlight = null,
    ghost = null,
    hideOverlay = false,
    pins = null,
    proposal = null
  } = options;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Draw Canvas Background
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, width, height);

  // 2. Draw Optional Screenshot Reference Overlay
  if (screen.bgImage && !hideOverlay) {
    const bg = getImage(screen.bgImage);
    if (ready(bg)) {
      ctx.save();
      ctx.globalAlpha = screen.bgOpacity ?? 0.35;
      ctx.drawImage(bg, 0, 0, width, height);
      ctx.restore();
    }
  }

  // 3. Draw Grid
  if (!previewMode && grid > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = uiScale;
    ctx.beginPath();
    for (let x = grid; x < width; x += grid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = grid; y < height; y += grid) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 4. Draw Safe Zone (90% action-safe frame)
  if (!previewMode && showSafeZones) {
    const safe = safeArea(screen.resolution);
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.setLineDash([6 * uiScale, 6 * uiScale]);
    ctx.lineWidth = uiScale;
    ctx.strokeRect(safe.x, safe.y, safe.w, safe.h);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.font = `${10 * uiScale}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText('ACTION SAFE · 90%', safe.x + 6 * uiScale, safe.y + 5 * uiScale);
    ctx.restore();
  }

  // 5. Recursive Node Rendering
  const worldBoxes = new Map();
  const focusActive = mockState === 'focused' && focus ? (focus.activeId || focus.defaultId) : null;

  function drawNode(node, parentBox, parentHidden) {
    const hidden = parentHidden || node.props.visible === false;
    if (hidden && previewMode) return;

    const box = computeWorldRect(node, parentBox, screen.resolution);
    worldBoxes.set(node.id, { node, box, parentBox });

    ctx.save();
    ctx.globalAlpha = (node.props.opacity ?? 1.0) * (hidden ? 0.35 : 1.0);

    // Focused previews one element at a time, like a real menu.
    const state = mockState === 'focused' ? (node.id === focusActive ? 'focused' : 'normal') : mockState;
    paintNode(ctx, node, box, state, uiScale, previewMode);
    ctx.restore();

    // Draw children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        drawNode(child, box, hidden);
      }
    }
  }

  for (const rootNode of screen.elements) {
    drawNode(rootNode, null, false);
  }

  const styles = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
  const accent = options.accent || styles?.getPropertyValue('--accent').trim() || '#f0a0b0';
  const onAccent = styles?.getPropertyValue('--on-accent').trim() || '#101115';
  const note = styles?.getPropertyValue('--note').trim() || '#b794f4';
  const danger = styles?.getPropertyValue('--danger').trim() || '#e87070';

  // 6. Focus order badges for keyboard / gamepad navigation
  if (!previewMode && mockState === 'focused' && focus?.order?.length) {
    focus.order.forEach((id, index) => {
      const item = worldBoxes.get(id);
      if (!item) return;
      const isDefault = id === focus.defaultId;
      const r = 9 * uiScale;
      const cx = item.box.x + r * 0.4;
      const cy = item.box.y + r * 0.4;
      ctx.save();
      ctx.fillStyle = isDefault ? accent : 'rgba(15, 18, 26, 0.92)';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5 * uiScale;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isDefault ? onAccent : '#ffffff';
      ctx.font = `bold ${10 * uiScale}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), cx, cy + 0.5 * uiScale);
      ctx.restore();
    });
  }

  // 6b. Numbered intent-note pins
  if (!previewMode && pins?.length) {
    for (const pin of pins) {
      const item = worldBoxes.get(pin.id);
      if (!item) continue;
      const { x, y, r } = pinCenter(item.box, screen.resolution, uiScale);
      ctx.save();
      ctx.fillStyle = note;
      ctx.strokeStyle = 'rgba(8, 10, 16, 0.85)';
      ctx.lineWidth = 1.5 * uiScale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#160f22';
      ctx.font = `bold ${10 * uiScale}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pin.n), x, y + 0.5 * uiScale);
      ctx.restore();
    }
  }

  // 6c. Copilot proposal: ghosts of added and changed elements, removals hatched
  if (!previewMode && proposal) {
    drawProposal(ctx, proposal, computeLayout(screen, screen.resolution), screen.resolution, mockState, uiScale, { note, danger });
  }

  // 7. Located issue
  if (!previewMode && highlight && worldBoxes.has(highlight)) {
    const { box } = worldBoxes.get(highlight);
    ctx.save();
    ctx.strokeStyle = '#eab56e';
    ctx.lineWidth = 3 * uiScale;
    ctx.setLineDash([8 * uiScale, 5 * uiScale]);
    const pad = 5 * uiScale;
    ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
    ctx.restore();
  }

  // 8. Draw Selection & Transform Handles
  if (!previewMode && selection) {
    const item = worldBoxes.get(selection);
    if (item) {
      drawSelectionOutline(ctx, item.node, item.box, item.parentBox, screen.resolution, accent, uiScale, onAccent);
    }
  }

  // 9. Draw Hover Outline
  if (!previewMode && hovered && hovered !== selection) {
    const item = worldBoxes.get(hovered);
    if (item) {
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([3 * uiScale, 3 * uiScale]);
      ctx.lineWidth = 1.5 * uiScale;
      ctx.strokeRect(item.box.x - 0.5, item.box.y - 0.5, item.box.w + 1, item.box.h + 1);
      ctx.restore();
    }
  }

  // 10. Placement preview
  if (!previewMode && ghost) {
    ctx.save();
    ctx.fillStyle = 'rgba(240, 160, 176, 0.12)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5 * uiScale;
    ctx.setLineDash([5 * uiScale, 4 * uiScale]);
    ctx.fillRect(ghost.x, ghost.y, ghost.w, ghost.h);
    ctx.strokeRect(ghost.x, ghost.y, ghost.w, ghost.h);
    ctx.restore();
  }

  ctx.restore();
  return worldBoxes;
}

function paintNode(ctx, node, box, state, uiScale, previewMode) {
  switch (node.type) {
    case 'panel':
      drawPanel(ctx, node, box);
      break;
    case 'button':
      drawButton(ctx, node, box, state);
      break;
    case 'label':
      drawLabel(ctx, node, box);
      break;
    case 'slider':
      drawSlider(ctx, node, box, state);
      break;
    case 'image':
      drawImageNode(ctx, node, box);
      break;
    case 'input':
      drawInput(ctx, node, box, state);
      break;
    case 'checkbox':
      drawCheckbox(ctx, node, box, state);
      break;
    case 'group':
      if (!previewMode) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = uiScale;
        ctx.setLineDash([4 * uiScale, 4 * uiScale]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
      break;
  }
  if (state === 'focused' && node.type !== 'button') {
    drawFocusRing(ctx, box, node.props.states?.focused?.ringColor, uiScale);
  }
}

/** Centre and radius of an intent pin: the element's top-right corner, kept on screen. */
export function pinCenter(box, resolution, uiScale = 1) {
  const r = 9 * uiScale;
  return {
    x: Math.max(r, Math.min(resolution.width - r, box.x + box.w)),
    y: Math.max(r, Math.min(resolution.height - r, box.y)),
    r
  };
}

function hasMarkedAncestor(entry, layout, marked) {
  for (let p = entry.parent; p; p = layout.get(p.id)?.parent) {
    if (marked(p.id)) return true;
  }
  return false;
}

function drawTag(ctx, box, label, fill, ink, resolution, uiScale) {
  ctx.save();
  ctx.font = `bold ${10.5 * uiScale}px ui-monospace, Consolas, monospace`;
  const w = ctx.measureText(label).width + 10 * uiScale;
  const h = 17 * uiScale;
  let x = box.x + box.w + 7 * uiScale;
  let y = box.y;
  if (x + w > resolution.width) {
    x = Math.max(0, box.x + box.w - w);
    y = box.y - h - 5 * uiScale >= 0 ? box.y - h - 5 * uiScale : box.y + 3 * uiScale;
  }
  ctx.fillStyle = fill;
  drawRoundedRect(ctx, x, y, w, h, 4 * uiScale);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 5 * uiScale, y + h / 2 + 0.5 * uiScale);
  ctx.restore();
}

// Proposed changes from a Copilot edit, drawn over the current screen. The
// proposal screen is laid out at the previewed resolution, like the screen itself.
function drawProposal(ctx, proposal, current, resolution, mockState, uiScale, colors) {
  const after = computeLayout(proposal.screen, resolution);
  const added = new Set(proposal.added || []);
  const updated = new Set(proposal.updated || []);
  const removed = new Set(proposal.removed || []);
  const pad = 3 * uiScale;
  const state = mockState === 'focused' ? 'normal' : mockState;
  const tags = [];

  // Removed elements: hatched in place, outermost only.
  for (const id of removed) {
    const item = current.get(id);
    if (!item || (item.parent && removed.has(item.parent.id))) continue;
    const b = item.box;
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.fillStyle = 'rgba(9, 13, 22, 0.45)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = colors.danger;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5 * uiScale;
    ctx.beginPath();
    const step = 10 * uiScale;
    for (let t = -b.h; t < b.w; t += step) {
      ctx.moveTo(b.x + t, b.y + b.h);
      ctx.lineTo(b.x + t + b.h, b.y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = colors.danger;
    ctx.lineWidth = 2 * uiScale;
    ctx.setLineDash([7 * uiScale, 5 * uiScale]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.restore();
    tags.push({ box: b, label: '− remove', fill: colors.danger, ink: '#2a0d0d' });
  }

  // Added and changed elements: their new look at their new place.
  const marked = id => added.has(id) || updated.has(id);
  const roots = [];
  for (const [id, entry] of after) {
    if (added.has(id) && !(entry.parent && added.has(entry.parent.id))) roots.push({ entry, kind: 'add' });
    else if (updated.has(id)) roots.push({ entry, kind: 'update' });
  }
  const drawTree = node => {
    const entry = after.get(node.id);
    if (!entry || node.props.visible === false) return;
    ctx.save();
    ctx.globalAlpha = (node.props.opacity ?? 1) * 0.86;
    paintNode(ctx, node, entry.box, state, uiScale, false);
    ctx.restore();
    for (const child of node.children || []) drawTree(child);
  };
  for (const { entry } of roots) {
    if (!hasMarkedAncestor(entry, after, marked)) drawTree(entry.node);
  }

  for (const { entry, kind } of roots) {
    const b = entry.box;
    let label = '+ new';
    if (kind === 'update') {
      const was = current.get(entry.node.id)?.box;
      const dx = was ? Math.round(b.x - was.x) : 0;
      const dy = was ? Math.round(b.y - was.y) : 0;
      const resized = was && (Math.round(b.w) !== Math.round(was.w) || Math.round(b.h) !== Math.round(was.h));
      if (resized) label = 'resized';
      else if (dx || dy) label = `moved${dy ? ` ${dy > 0 ? '↓' : '↑'} ${Math.abs(dy)}` : ''}${dx ? ` ${dx > 0 ? '→' : '←'} ${Math.abs(dx)}` : ''}`;
      else label = '~ changed';
      if (was && (dx || dy || resized)) {
        ctx.save();
        ctx.strokeStyle = colors.note;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.25 * uiScale;
        ctx.setLineDash([3 * uiScale, 4 * uiScale]);
        ctx.strokeRect(was.x, was.y, was.w, was.h);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.strokeStyle = colors.note;
    ctx.lineWidth = 2 * uiScale;
    ctx.setLineDash([7 * uiScale, 5 * uiScale]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.restore();
    tags.push({ box: b, label, fill: colors.note, ink: '#160f22' });
  }

  for (const t of tags) drawTag(ctx, t.box, t.label, t.fill, t.ink, resolution, uiScale);
}

// Resolves base props overridden by the previewed state.
export function stateStyle(props, state) {
  const base = {
    bgColor: props.bgColor,
    borderColor: props.borderColor,
    fontColor: props.fontColor,
    skin: props.skin || '',
    opacity: 1,
    offset: 0,
    ring: null
  };
  if (!state || state === 'normal') return base;
  const s = props.states?.[state] || {};
  const style = {
    ...base,
    bgColor: s.bgColor || base.bgColor,
    borderColor: s.borderColor || base.borderColor,
    fontColor: s.fontColor || base.fontColor,
    skin: s.skin || base.skin
  };
  if (state === 'pressed') style.offset = 1;
  if (state === 'focused') style.ring = s.ringColor || '#f0a0b0';
  if (state === 'disabled') {
    style.bgColor = s.bgColor || '#334155';
    style.borderColor = s.borderColor || '#475569';
    style.fontColor = s.fontColor || '#94a3b8';
    style.opacity = s.opacity ?? 0.5;
  }
  return style;
}

function drawFocusRing(ctx, box, color, uiScale) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color || '#f0a0b0';
  ctx.lineWidth = Math.max(2, 2.5 * uiScale);
  const pad = Math.max(3, 3 * uiScale);
  drawRoundedRect(ctx, box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, 6 + pad);
  ctx.stroke();
  ctx.restore();
}

function drawPanel(ctx, node, box) {
  const p = node.props;
  ctx.save();
  if (p.skin && drawSkin(ctx, p.skin, p.skinSlice, box)) { ctx.restore(); return; }
  ctx.fillStyle = p.bgColor || '#1e293b';
  drawRoundedRect(ctx, box.x, box.y, box.w, box.h, p.borderRadius ?? 6);
  ctx.fill();

  if (p.borderWidth > 0 && p.borderColor) {
    ctx.lineWidth = p.borderWidth;
    ctx.strokeStyle = p.borderColor;
    ctx.stroke();
  }
  ctx.restore();
}

function drawButton(ctx, node, box, mockState) {
  const p = node.props;
  const style = stateStyle({ ...p, bgColor: p.bgColor || '#2563eb', borderColor: p.borderColor || '#38bdf8', fontColor: p.fontColor || '#ffffff' }, mockState);

  ctx.save();
  ctx.globalAlpha *= style.opacity;
  const y = box.y + style.offset * 2;
  // A skinned state draws its image; a state without one falls back to the colours.
  if (!(style.skin && drawSkin(ctx, style.skin, p.skinSlice, { ...box, y }))) {
    ctx.fillStyle = style.bgColor;
    drawRoundedRect(ctx, box.x, y, box.w, box.h, p.borderRadius ?? 6);
    ctx.fill();
    if (p.borderWidth > 0 || style.ring) {
      ctx.lineWidth = Math.max(p.borderWidth || 0, style.ring ? 2 : 0);
      ctx.strokeStyle = style.borderColor;
      ctx.stroke();
    }
  }

  // Button text
  if (p.text) {
    ctx.fillStyle = style.fontColor;
    ctx.font = `${p.fontWeight || 'normal'} ${p.fontSize ?? 16}px ${fontStack(p.fontFamily)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, box.x + box.w / 2, y + box.h / 2);
  }
  ctx.restore();

  if (style.ring) {
    const pad = 4;
    ctx.save();
    ctx.strokeStyle = style.ring;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, box.x - pad, y - pad, box.w + pad * 2, box.h + pad * 2, (p.borderRadius ?? 6) + pad);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLabel(ctx, node, box) {
  const p = node.props;
  const size = p.fontSize ?? 18;
  ctx.save();
  ctx.fillStyle = p.fontColor || '#f8fafc';
  const weight = p.fontWeight || 'normal';
  ctx.font = `${weight} ${size}px ${fontStack(p.fontFamily)}`;
  ctx.textBaseline = 'middle';

  let textX = box.x;
  if (p.textAlign === 'center') {
    ctx.textAlign = 'center';
    textX = box.x + box.w / 2;
  } else if (p.textAlign === 'right') {
    ctx.textAlign = 'right';
    textX = box.x + box.w;
  } else {
    ctx.textAlign = 'left';
  }

  // Long text wraps inside the label box; the block stays vertically centered.
  const lines = wrapText(t => ctx.measureText(t).width, p.text || '', box.w);
  const lineH = size * 1.25;
  const top = box.y + box.h / 2 - (lines.length - 1) * lineH / 2;
  lines.forEach((line, i) => ctx.fillText(line, textX, top + i * lineH));
  ctx.restore();
}

function drawSlider(ctx, node, box, mockState) {
  const p = node.props;
  const min = p.min ?? 0;
  const max = p.max ?? 100;
  const val = Math.max(min, Math.min(max, p.value ?? 50));
  const pct = (val - min) / (max - min || 1);
  const disabled = mockState === 'disabled';

  ctx.save();
  if (disabled) ctx.globalAlpha *= p.states?.disabled?.opacity ?? 0.5;
  // Track
  ctx.fillStyle = p.trackColor || '#1e293b';
  drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 4);
  ctx.fill();

  // Fill
  const fillW = Math.max(0, box.w * pct);
  ctx.fillStyle = disabled ? '#475569' : (p.fillColor || '#10b981');
  drawRoundedRect(ctx, box.x, box.y, fillW, box.h, 4);
  ctx.fill();

  // Label / Readout
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px monospace';
  ctx.textBaseline = 'middle';

  if (p.label) {
    ctx.textAlign = 'left';
    ctx.fillText(p.label, box.x + 8, box.y + box.h / 2);
  }

  if (p.showValue !== false) {
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(val)} / ${max}`, box.x + box.w - 8, box.y + box.h / 2);
  }
  ctx.restore();
}

function drawImageNode(ctx, node, box) {
  const p = node.props;
  ctx.save();
  if (p.src) {
    const img = getImage(p.src);
    if (ready(img)) {
      const c = p.crop && p.crop.w > 0 && p.crop.h > 0 ? p.crop : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      // contain fits inside the box, cover fills it and clips, fill stretches.
      let d = box;
      if (p.fit === 'contain' || p.fit === 'cover') {
        const k = (p.fit === 'cover' ? Math.max : Math.min)(box.w / c.w, box.h / c.h);
        d = { x: box.x + (box.w - c.w * k) / 2, y: box.y + (box.h - c.h * k) / 2, w: c.w * k, h: c.h * k };
        if (p.fit === 'cover') { ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); }
      }
      ctx.drawImage(img, c.x, c.y, c.w, c.h, d.x, d.y, d.w, d.h);
    } else {
      drawImagePlaceholder(ctx, box, 'Loading…');
    }
  } else {
    drawImagePlaceholder(ctx, box, '');
  }
  ctx.restore();
}

function drawImagePlaceholder(ctx, box, caption) {
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  // Mountain-and-sun glyph instead of an emoji.
  const s = Math.min(box.w, box.h) * 0.5;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = Math.max(1, s / 14);
  ctx.beginPath();
  ctx.moveTo(cx - s / 2, cy + s / 3);
  ctx.lineTo(cx - s / 8, cy - s / 8);
  ctx.lineTo(cx + s / 8, cy + s / 8);
  ctx.lineTo(cx + s / 4, cy);
  ctx.lineTo(cx + s / 2, cy + s / 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + s / 4, cy - s / 4, s / 10, 0, Math.PI * 2);
  ctx.stroke();
  if (caption) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(caption, cx, cy + s / 2);
  }
}

function drawInput(ctx, node, box, mockState) {
  const p = node.props;
  const style = stateStyle({ ...p, bgColor: p.bgColor || '#0f172a', borderColor: p.borderColor || '#475569', fontColor: p.fontColor || '#ffffff' }, mockState);
  ctx.save();
  ctx.globalAlpha *= style.opacity;
  if (!(style.skin && drawSkin(ctx, style.skin, p.skinSlice, box))) {
    ctx.fillStyle = style.bgColor;
    drawRoundedRect(ctx, box.x, box.y, box.w, box.h, p.borderRadius ?? 4);
    ctx.fill();
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = p.borderWidth ?? 1;
    ctx.stroke();
  }

  ctx.font = `${p.fontSize ?? 14}px ${fontStack(p.fontFamily)}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (p.value) {
    ctx.fillStyle = style.fontColor;
    ctx.fillText(p.value, box.x + 10, box.y + box.h / 2);
  } else {
    ctx.fillStyle = '#64748b';
    ctx.fillText(p.placeholder || 'Enter text…', box.x + 10, box.y + box.h / 2);
  }
  ctx.restore();
}

function drawCheckbox(ctx, node, box, mockState) {
  const p = node.props;
  const size = 18;
  const boxY = box.y + (box.h - size) / 2;
  const disabled = mockState === 'disabled';

  ctx.save();
  if (disabled) ctx.globalAlpha *= p.states?.disabled?.opacity ?? 0.5;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(box.x, boxY, size, size);
  ctx.strokeStyle = p.checkColor || '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(box.x, boxY, size, size);

  if (p.checked) {
    ctx.strokeStyle = p.checkColor || '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(box.x + 4, boxY + 9);
    ctx.lineTo(box.x + 8, boxY + 13);
    ctx.lineTo(box.x + 14, boxY + 5);
    ctx.stroke();
  }

  ctx.fillStyle = p.fontColor || '#f8fafc';
  ctx.font = `${p.fontSize ?? 14}px ${fontStack(p.fontFamily)}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.label || '', box.x + size + 10, box.y + box.h / 2);
  ctx.restore();
}

function drawSelectionOutline(ctx, node, box, parentBox, screenRes, accent = '#f0a0b0', uiScale = 1, onAccent = '#101115') {
  const locked = !!node.props.locked;
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2 * uiScale;
  if (locked) ctx.setLineDash([6 * uiScale, 4 * uiScale]);
  ctx.strokeRect(box.x - uiScale, box.y - uiScale, box.w + 2 * uiScale, box.h + 2 * uiScale);
  ctx.setLineDash([]);

  // Anchor connector visual
  const pBox = parentBox || { x: 0, y: 0, w: screenRes.width, h: screenRes.height };
  const a = ANCHORS.find(item => item.id === node.anchor);
  if (a && a.originX !== undefined && a.originY !== undefined && !a.stretchX && !a.stretchY) {
    const ox = pBox.x + a.originX * pBox.w;
    const oy = pBox.y + a.originY * pBox.h;

    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([4 * uiScale, 4 * uiScale]);
    ctx.lineWidth = uiScale;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(box.x + box.w / 2, box.y + box.h / 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);

    // Small anchor marker
    const m = 4 * uiScale;
    ctx.fillStyle = accent;
    ctx.fillRect(ox - m, oy - m, m * 2, m * 2);
  }

  // Draw 8 Resize Handles (none while locked)
  if (!locked) {
    const handles = getHandles(box, 8 * uiScale);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5 * uiScale;
    ctx.setLineDash([]);

    for (const h of Object.values(handles)) {
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.strokeRect(h.x, h.y, h.w, h.h);
    }
  }

  // Badge with name & dimensions
  const label = `${locked ? 'Locked · ' : ''}${node.name}  ${Math.round(box.w)}×${Math.round(box.h)}`;
  ctx.font = `bold ${11 * uiScale}px ui-monospace, monospace`;
  const textW = ctx.measureText(label).width;
  const bh = 18 * uiScale;
  const bw = textW + 10 * uiScale;
  const by = box.y - bh - 3 * uiScale >= 0 ? box.y - bh - 3 * uiScale : box.y + box.h + 3 * uiScale;
  const bx = Math.max(0, Math.min(box.x, screenRes.width - bw));
  ctx.fillStyle = accent;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = onAccent;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, bx + 5 * uiScale, by + bh / 2 + 0.5 * uiScale);

  ctx.restore();
}

export function getHandles(box, size = 8) {
  const half = size / 2;
  return {
    nw: { id: 'nw', x: box.x - half, y: box.y - half, w: size, h: size, cursor: 'nwse-resize' },
    ne: { id: 'ne', x: box.x + box.w - half, y: box.y - half, w: size, h: size, cursor: 'nesw-resize' },
    se: { id: 'se', x: box.x + box.w - half, y: box.y + box.h - half, w: size, h: size, cursor: 'nwse-resize' },
    sw: { id: 'sw', x: box.x - half, y: box.y + box.h - half, w: size, h: size, cursor: 'nesw-resize' },
    n: { id: 'n', x: box.x + box.w / 2 - half, y: box.y - half, w: size, h: size, cursor: 'ns-resize' },
    s: { id: 's', x: box.x + box.w / 2 - half, y: box.y + box.h - half, w: size, h: size, cursor: 'ns-resize' },
    w: { id: 'w', x: box.x - half, y: box.y + box.h / 2 - half, w: size, h: size, cursor: 'ew-resize' },
    e: { id: 'e', x: box.x + box.w - half, y: box.y + box.h / 2 - half, w: size, h: size, cursor: 'ew-resize' }
  };
}

/**
 * Finds the handle or element under a point. Locked elements are skipped on the
 * canvas (select them in Layers) and never expose resize handles.
 */
export function hitTest(worldBoxes, x, y, selection = null, options = {}) {
  const { handleSize = 10, filter = null } = options;
  // 1. Check handles of selected item first
  if (selection && worldBoxes.has(selection)) {
    const item = worldBoxes.get(selection);
    if (!item.node.props.locked) {
      const handles = getHandles(item.box, handleSize);
      for (const [id, h] of Object.entries(handles)) {
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
          return { ...item, handle: id, cursor: h.cursor };
        }
      }
    }
  }

  // 2. Check elements in reverse drawing order (topmost first)
  const entries = Array.from(worldBoxes.values()).reverse();
  for (const item of entries) {
    if (item.node.props.locked) continue;
    if (filter && !filter(item)) continue;
    const b = item.box;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      return { ...item, handle: 'body', cursor: 'move' };
    }
  }

  return null;
}

function drawRoundedRect(ctx, x, y, w, h, r = 0) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
