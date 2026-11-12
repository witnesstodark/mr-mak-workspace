/**
 * Game UI Studio - Core Data Model & Hierarchy Engine
 * Pure ES module for node transforms, engine anchors, navigation, templates and agent handoffs.
 */

// Offsets follow screen axes from the anchor point: positive x moves right and
// positive y moves down, so right/bottom anchors use negative offsets to sit inside.
export const ANCHORS = [
  { id: 'top-left', label: 'Top Left', originX: 0, originY: 0 },
  { id: 'top-center', label: 'Top Center', originX: 0.5, originY: 0 },
  { id: 'top-right', label: 'Top Right', originX: 1, originY: 0 },
  { id: 'center-left', label: 'Center Left', originX: 0, originY: 0.5 },
  { id: 'center', label: 'Center', originX: 0.5, originY: 0.5 },
  { id: 'center-right', label: 'Center Right', originX: 1, originY: 0.5 },
  { id: 'bottom-left', label: 'Bottom Left', originX: 0, originY: 1 },
  { id: 'bottom-center', label: 'Bottom Center', originX: 0.5, originY: 1 },
  { id: 'bottom-right', label: 'Bottom Right', originX: 1, originY: 1 },
  { id: 'full-stretch', label: 'Full Stretch', stretchX: true, stretchY: true },
  { id: 'horizontal-stretch', label: 'Horizontal Stretch', stretchX: true, stretchY: false },
  { id: 'vertical-stretch', label: 'Vertical Stretch', stretchX: false, stretchY: true },
  { id: 'top-stretch', label: 'Top Stretch', stretchX: true, stretchY: false, originY: 0 },
  { id: 'bottom-stretch', label: 'Bottom Stretch', stretchX: true, stretchY: false, originY: 1 },
  { id: 'left-stretch', label: 'Left Stretch', stretchX: false, stretchY: true, originX: 0 },
  { id: 'right-stretch', label: 'Right Stretch', stretchX: false, stretchY: true, originX: 1 }
];

export const TYPES = [
  { id: 'panel', label: 'Panel / Box', icon: '◫', key: 'P' },
  { id: 'button', label: 'Button', icon: '▢', key: 'B' },
  { id: 'label', label: 'Text Label', icon: 'T', key: 'T' },
  { id: 'slider', label: 'Slider / Gauge', icon: '▰', key: 'S' },
  { id: 'image', label: 'Image / Icon', icon: '🖼', key: 'I' },
  { id: 'input', label: 'Text Input', icon: '✎', key: 'N' },
  { id: 'checkbox', label: 'Toggle / Checkbox', icon: '☑', key: 'C' },
  { id: 'group', label: 'Group Node', icon: '🗂', key: 'G' }
];

// The five visual states required by the Game UI Guidelines.
export const STATES = ['normal', 'hover', 'pressed', 'focused', 'disabled'];

export const SCREEN_ROLES = [
  { id: 'menu', label: 'Main menu', hint: 'Top-level menu; Esc is optional.' },
  { id: 'submenu', label: 'Submenu', hint: 'Options, pause or any screen opened from another one.' },
  { id: 'modal', label: 'Modal dialog', hint: 'Confirmation or popup over another screen.' },
  { id: 'hud', label: 'HUD', hint: 'In-game overlay anchored to safe-zone corners.' }
];

// Navigation target meaning "close this screen and return to the previous one".
export const BACK_PREVIOUS = '@previous';

let idCounter = 1;
export function generateId(prefix = 'node') {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

export function defaultProps(type) {
  const base = {
    opacity: 1.0,
    visible: true,
    locked: false,
    comment: ''
  };

  switch (type) {
    case 'panel':
      return {
        ...base,
        bgColor: '#1a1f2c',
        borderColor: '#334155',
        borderWidth: 1,
        borderRadius: 6,
        padding: 12
      };
    case 'button':
      return {
        ...base,
        text: 'Action Button',
        fontSize: 16,
        fontColor: '#ffffff',
        bgColor: '#2563eb',
        borderColor: '#38bdf8',
        borderWidth: 1,
        borderRadius: 6,
        textAlign: 'center',
        states: defaultStates({ bgColor: '#2563eb', borderColor: '#38bdf8' })
      };
    case 'label':
      return {
        ...base,
        text: 'Label Text',
        fontSize: 18,
        fontColor: '#f1f5f9',
        fontWeight: 'normal',
        textAlign: 'left'
      };
    case 'slider':
      return {
        ...base,
        min: 0,
        max: 100,
        value: 75,
        trackColor: '#1e293b',
        fillColor: '#10b981',
        showValue: true,
        label: 'Health'
      };
    case 'image':
      return {
        ...base,
        src: '',
        tintColor: '#ffffff',
        crop: null, // { x, y, w, h } for spritesheet region
        fit: 'contain'
      };
    case 'input':
      return {
        ...base,
        placeholder: 'Enter text…',
        value: '',
        fontSize: 15,
        fontColor: '#ffffff',
        bgColor: '#0f172a',
        borderColor: '#475569',
        borderWidth: 1,
        borderRadius: 4
      };
    case 'checkbox':
      return {
        ...base,
        checked: true,
        label: 'Enable Feature',
        fontSize: 15,
        fontColor: '#f8fafc',
        checkColor: '#38bdf8'
      };
    case 'group':
    default:
      return {
        ...base
      };
  }
}

/**
 * Default hover / pressed / focused / disabled styles derived from a base look.
 */
export function defaultStates(base = {}) {
  const bg = base.bgColor || '#2563eb';
  return {
    hover: { bgColor: shadeColor(bg, 0.12), borderColor: '#60a5fa' },
    pressed: { bgColor: shadeColor(bg, -0.22), borderColor: '#93c5fd' },
    focused: { bgColor: bg, borderColor: '#ffffff', ringColor: '#f0a0b0' },
    disabled: { bgColor: '#334155', borderColor: '#475569', fontColor: '#94a3b8', opacity: 0.5 }
  };
}

function shadeColor(color, amount) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const channel = shift => {
    const c = (n >> shift) & 255;
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next))).toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

export function newNode(type, name = '', options = {}) {
  const typeDef = TYPES.find(t => t.id === type) || TYPES[0];
  const autoName = name || `${typeDef.label.split(' ')[0]}_${idCounter}`;

  let w = 200, h = 50;
  if (type === 'panel') { w = 320; h = 240; }
  else if (type === 'label') { w = 180; h = 32; }
  else if (type === 'slider') { w = 240; h = 28; }
  else if (type === 'image') { w = 64; h = 64; }
  else if (type === 'checkbox') { w = 180; h = 28; }
  else if (type === 'group') { w = 200; h = 200; }

  const node = {
    id: options.id || generateId(type),
    name: autoName,
    type,
    anchor: options.anchor || 'top-left',
    rect: {
      x: options.x ?? 0,
      y: options.y ?? 0,
      w: options.w ?? w,
      h: options.h ?? h
    },
    props: {
      ...defaultProps(type),
      ...(options.props || {})
    },
    children: options.children || []
  };
  if (options.nav) node.nav = { ...options.nav };
  return node;
}

/**
 * Calculates absolute world bounding box on canvas.
 */
export function computeWorldRect(node, parentRect, screenRes) {
  const pBox = parentRect || { x: 0, y: 0, w: screenRes.width, h: screenRes.height };
  const r = node.rect;
  const a = ANCHORS.find(item => item.id === node.anchor) || ANCHORS[0];

  if (a.stretchX && a.stretchY) {
    // margins: x=left, y=top, w=margin-right, h=margin-bottom
    return {
      x: pBox.x + r.x,
      y: pBox.y + r.y,
      w: Math.max(10, pBox.w - r.x - r.w),
      h: Math.max(10, pBox.h - r.y - r.h)
    };
  }
  if (a.stretchX) {
    // margins: x=left, w=margin-right; y offsets from the anchored edge
    const originY = pBox.y + (a.originY ?? 0.5) * pBox.h;
    const pivotY = a.originY === undefined ? 0 : a.originY;
    return {
      x: pBox.x + r.x,
      y: originY + r.y - pivotY * r.h,
      w: Math.max(10, pBox.w - r.x - r.w),
      h: r.h
    };
  }
  if (a.stretchY) {
    // margins: y=top, h=margin-bottom; x offsets from the anchored edge
    const originX = pBox.x + (a.originX ?? 0.5) * pBox.w;
    const pivotX = a.originX === undefined ? 0 : a.originX;
    return {
      x: originX + r.x - pivotX * r.w,
      y: pBox.y + r.y,
      w: r.w,
      h: Math.max(10, pBox.h - r.y - r.h)
    };
  }

  const ox = pBox.x + (a.originX ?? 0) * pBox.w;
  const oy = pBox.y + (a.originY ?? 0) * pBox.h;

  let finalX = ox + r.x;
  let finalY = oy + r.y;

  // When anchor is centered or right-aligned, offset according to pivot
  if (a.originX === 0.5) finalX -= r.w / 2;
  else if (a.originX === 1) finalX -= r.w;

  if (a.originY === 0.5) finalY -= r.h / 2;
  else if (a.originY === 1) finalY -= r.h;

  return {
    x: finalX,
    y: finalY,
    w: r.w,
    h: r.h
  };
}

/**
 * Updates node.rect relative to its anchor given desired world coordinates.
 * Exact inverse of computeWorldRect for every anchor preset.
 */
export function updateLocalFromWorld(node, worldRect, parentRect, screenRes) {
  const pBox = parentRect || { x: 0, y: 0, w: screenRes.width, h: screenRes.height };
  const a = ANCHORS.find(item => item.id === node.anchor) || ANCHORS[0];

  const w = Math.max(10, Math.round(worldRect.w));
  const h = Math.max(10, Math.round(worldRect.h));
  const left = Math.round(worldRect.x - pBox.x);
  const top = Math.round(worldRect.y - pBox.y);

  if (a.stretchX && a.stretchY) {
    node.rect = {
      x: left,
      y: top,
      w: Math.max(0, Math.round(pBox.w - (worldRect.x - pBox.x + w))),
      h: Math.max(0, Math.round(pBox.h - (worldRect.y - pBox.y + h)))
    };
    return;
  }

  if (a.stretchX) {
    const originY = pBox.y + (a.originY ?? 0.5) * pBox.h;
    const pivotY = a.originY === undefined ? 0 : a.originY;
    node.rect = {
      x: left,
      y: Math.round(worldRect.y - originY + pivotY * h),
      w: Math.max(0, Math.round(pBox.w - (worldRect.x - pBox.x + w))),
      h
    };
    return;
  }

  if (a.stretchY) {
    const originX = pBox.x + (a.originX ?? 0.5) * pBox.w;
    const pivotX = a.originX === undefined ? 0 : a.originX;
    node.rect = {
      x: Math.round(worldRect.x - originX + pivotX * w),
      y: top,
      w,
      h: Math.max(0, Math.round(pBox.h - (worldRect.y - pBox.y + h)))
    };
    return;
  }

  const ox = pBox.x + (a.originX ?? 0) * pBox.w;
  const oy = pBox.y + (a.originY ?? 0) * pBox.h;

  let localX = worldRect.x - ox;
  let localY = worldRect.y - oy;

  if (a.originX === 0.5) localX += w / 2;
  else if (a.originX === 1) localX += w;

  if (a.originY === 0.5) localY += h / 2;
  else if (a.originY === 1) localY += h;

  node.rect = {
    x: Math.round(localX),
    y: Math.round(localY),
    w,
    h
  };
}

/**
 * Changes a node's anchor while keeping its current on-screen box.
 */
export function setAnchorKeepingBox(node, anchor, parentRect, screenRes) {
  const box = computeWorldRect(node, parentRect, screenRes);
  node.anchor = anchor;
  updateLocalFromWorld(node, box, parentRect, screenRes);
}

/**
 * Anchor nearest to where a box sits inside its parent (thirds of the parent).
 */
export function naturalAnchor(box, parentRect) {
  const cx = (box.x + box.w / 2 - parentRect.x) / parentRect.w;
  const cy = (box.y + box.h / 2 - parentRect.y) / parentRect.h;
  const col = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
  const row = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'center';
  if (row === 'center' && col === 'center') return 'center';
  return `${row}-${col}`;
}

/**
 * World boxes for every node of a screen, optionally at another resolution.
 */
export function computeLayout(screen, resolution = screen.resolution) {
  const boxes = new Map();
  function walk(nodes, parentBox, parent) {
    for (const node of nodes) {
      const box = computeWorldRect(node, parentBox, resolution);
      boxes.set(node.id, { node, box, parentBox, parent });
      if (node.children && node.children.length > 0) walk(node.children, box, node);
    }
  }
  walk(screen.elements || [], null, null);
  return boxes;
}

/**
 * The design resolution plus the aspect ratios that anchoring must survive.
 */
export function previewResolutions(design = { width: 1920, height: 1080 }) {
  const { width, height } = design;
  const is1080p = width === 1920 && height === 1080;
  return [
    { id: 'design', label: 'Design', short: 'Design', width, height },
    { id: '16:9', label: '16:9', short: '16:9', width: is1080p ? 1280 : Math.round(width * 2 / 3), height: is1080p ? 720 : Math.round(height * 2 / 3) },
    { id: '21:9', label: '21:9', short: '21:9', width: Math.round(height * 64 / 27), height },
    { id: '16:10', label: '16:10', short: '16:10', width, height: Math.round(width * 10 / 16) }
  ];
}

/**
 * 90% action-safe frame. Margins are 5% of the 16:9 area inside the screen, so
 * ultrawide and 16:10 screens keep the same corner margins as 16:9.
 */
export function safeArea(resolution) {
  const mx = Math.round(Math.min(resolution.width, resolution.height * 16 / 9) * 0.05);
  const my = Math.round(Math.min(resolution.height, resolution.width * 9 / 16) * 0.05);
  return { x: mx, y: my, w: resolution.width - mx * 2, h: resolution.height - my * 2 };
}

/**
 * Greedy word wrap shared by the renderer and the text-fit checks.
 */
export function wrapText(measure, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Traversal & Node lookup
 */
export function findScreen(doc, screenId) {
  return doc.screens.find(s => s.id === screenId) || null;
}

export function findNode(doc, targetId, screenId = null) {
  const screen = screenId
    ? doc.screens.find(s => s.id === screenId)
    : doc.screens.find(s => s.id === doc.activeScreen) || doc.screens[0];

  if (!screen) return null;

  function walk(nodes, parent = null) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.id === targetId) {
        return { node: n, parent, index: i, screen };
      }
      if (n.children && n.children.length > 0) {
        const found = walk(n.children, n);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(screen.elements);
}

export function flattenNodes(elements, parent = null) {
  const result = [];
  for (const el of elements) {
    result.push({ node: el, parent });
    if (el.children && el.children.length > 0) {
      result.push(...flattenNodes(el.children, el));
    }
  }
  return result;
}

export function descendants(node) {
  const list = [];
  if (node.children) {
    for (const c of node.children) {
      list.push(c);
      list.push(...descendants(c));
    }
  }
  return list;
}

/**
 * Screen roles, interactive elements and keyboard / gamepad focus order
 */
export function screenRole(screen) {
  if (SCREEN_ROLES.some(r => r.id === screen?.role)) return screen.role;
  const text = `${screen?.name || ''} ${screen?.id || ''}`;
  if (/modal|confirm|dialog|popup|prompt/i.test(text)) return 'modal';
  if (/\bhud\b|heads.?up/i.test(text)) return 'hud';
  if (/main.?menu|title.?screen|front.?end|start.?screen/i.test(text)) return 'menu';
  return 'submenu';
}

export function isInteractive(node, role = 'submenu') {
  if (['button', 'input', 'checkbox'].includes(node.type)) return true;
  // On a HUD a slider is a read-only gauge; elsewhere it is a setting.
  return node.type === 'slider' && role !== 'hud';
}

export function interactiveNodes(screen) {
  const role = screenRole(screen);
  return flattenNodes(screen.elements || [])
    .map(entry => entry.node)
    .filter(n => isInteractive(n, role) && n.props?.visible !== false);
}

export function focusOrder(screen) {
  const ids = interactiveNodes(screen).map(n => n.id);
  const stored = (screen.focus?.order || []).filter(id => ids.includes(id));
  return [...stored, ...ids.filter(id => !stored.includes(id))];
}

export function defaultFocusId(screen) {
  const target = screen.focus?.default;
  return target && focusOrder(screen).includes(target) ? target : null;
}

/**
 * Navigation links between screens: confirm links from elements and Esc / Back per screen.
 */
export function navigationLinks(doc) {
  const links = [];
  for (const screen of doc.screens) {
    for (const { node } of flattenNodes(screen.elements || [])) {
      const to = node.nav?.onConfirm;
      if (!to) continue;
      links.push({
        kind: 'confirm',
        from: screen.id,
        to,
        nodeId: node.id,
        label: node.props?.text || node.props?.label || node.name,
        missing: to !== BACK_PREVIOUS && !findScreen(doc, to)
      });
    }
    const back = screen.nav?.onBack;
    if (back) {
      links.push({
        kind: 'back',
        from: screen.id,
        to: back,
        nodeId: null,
        label: 'Esc',
        missing: back !== BACK_PREVIOUS && !findScreen(doc, back)
      });
    }
  }
  return links;
}

/**
 * Column layout for the flow board (longest-path layering): a screen sits one
 * column right of every screen that opens it, through a confirm link or Esc from
 * a HUD. Main menus and HUDs start the first column. Rows follow their sources.
 */
export function layoutFlow(doc, { cardW = 196, cardH = 150, gapX = 96, gapY = 40, pad = 28 } = {}) {
  const links = navigationLinks(doc);
  const role = new Map(doc.screens.map(s => [s.id, screenRole(s)]));
  const opens = l => !l.missing && l.to !== BACK_PREVIOUS && l.to !== l.from &&
    (l.kind === 'confirm' || role.get(l.from) === 'hud');
  const edges = links.filter(opens);
  const isRoot = id => ['menu', 'hud'].includes(role.get(id)) || !edges.some(l => l.to === id);
  const depth = new Map(doc.screens.map(s => [s.id, 0]));
  const limit = doc.screens.length;
  for (let pass = 0; pass < limit; pass++) {
    let changed = false;
    for (const l of edges) {
      if (isRoot(l.to)) continue;
      const d = depth.get(l.from) + 1;
      if (d > depth.get(l.to) && d < limit) { depth.set(l.to, d); changed = true; }
    }
    if (!changed) break;
  }

  const columns = new Map();
  for (const s of doc.screens) {
    const d = depth.get(s.id);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(s.id);
  }
  const nodes = new Map();
  const rowOf = new Map();
  let maxRow = 0;
  for (const col of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(col);
    // Prefer the row of the highest screen that opens it, so links stay level.
    const key = id => col === 0 ? 0 : Math.min(...edges.filter(l => l.to === id && rowOf.has(l.from)).map(l => rowOf.get(l.from)), 1e6);
    ids.sort((a, b) => key(a) - key(b));
    let free = 0;
    ids.forEach(id => {
      const row = Math.max(free, Math.min(key(id), 1e6) === 1e6 ? free : key(id));
      free = row + 1;
      rowOf.set(id, row);
      nodes.set(id, { id, col, row, x: pad + col * (cardW + gapX), y: pad + row * (cardH + gapY), w: cardW, h: cardH });
      maxRow = Math.max(maxRow, row);
    });
  }
  const maxCol = Math.max(0, ...columns.keys());
  return {
    nodes,
    links,
    width: pad * 2 + (maxCol + 1) * cardW + maxCol * gapX,
    height: pad * 2 + (maxRow + 1) * cardH + maxRow * gapY,
    card: { w: cardW, h: cardH, gapX, gapY, pad }
  };
}

/**
 * Mutates document immutably via clone
 */
export function mutateDoc(doc, fn) {
  const next = structuredClone(doc);
  fn(next);
  validateDocument(next);
  return next;
}

/**
 * Reordering & Reparenting
 */
export function reorderNode(doc, nodeId, targetId, mode = 'after') {
  return mutateDoc(doc, d => {
    const source = findNode(d, nodeId);
    const target = findNode(d, targetId);
    if (!source || !target || source.node.id === target.node.id) return;

    // Prevent cycles
    const descIds = descendants(source.node).map(n => n.id);
    if (descIds.includes(target.node.id)) {
      throw new Error('Cannot move an element into its own descendants.');
    }

    // Remove source from its parent
    const sourceSiblings = source.parent ? source.parent.children : source.screen.elements;
    sourceSiblings.splice(source.index, 1);

    if (mode === 'inside') {
      if (!target.node.children) target.node.children = [];
      target.node.children.push(source.node);
    } else {
      const targetSiblings = target.parent ? target.parent.children : target.screen.elements;
      const targetIdx = targetSiblings.findIndex(n => n.id === target.node.id);
      const insertAt = mode === 'before' ? targetIdx : targetIdx + 1;
      targetSiblings.splice(insertAt, 0, source.node);
    }
  });
}

export function duplicateNode(doc, nodeId) {
  return mutateDoc(doc, d => {
    const source = findNode(d, nodeId);
    if (!source) return;

    function cloneSubtree(n) {
      const copy = structuredClone(n);
      copy.id = generateId(copy.type);
      copy.name = `${copy.name}_copy`;
      copy.rect.x += 16;
      copy.rect.y += 16;
      if (copy.children) {
        copy.children = copy.children.map(cloneSubtree);
      }
      return copy;
    }

    const dup = cloneSubtree(source.node);
    const siblings = source.parent ? source.parent.children : source.screen.elements;
    siblings.splice(source.index + 1, 0, dup);
  });
}

export function removeNode(doc, nodeId) {
  return mutateDoc(doc, d => {
    const found = findNode(d, nodeId);
    if (!found) return;
    const list = found.parent ? found.parent.children : found.screen.elements;
    list.splice(found.index, 1);
    const gone = new Set([found.node.id, ...descendants(found.node).map(n => n.id)]);
    const focus = found.screen.focus;
    if (focus) {
      if (gone.has(focus.default)) focus.default = null;
      if (Array.isArray(focus.order)) focus.order = focus.order.filter(id => !gone.has(id));
    }
  });
}

/**
 * Validation
 */
export function validateDocument(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Invalid document structure.');
  if (!Array.isArray(doc.screens) || doc.screens.length === 0) {
    throw new Error('Document must have at least one screen.');
  }
  for (const s of doc.screens) {
    if (!s.id || !s.name) throw new Error('Every screen requires an id and name.');
    if (!s.resolution || !s.resolution.width || !s.resolution.height) {
      s.resolution = { width: 1920, height: 1080 };
    }
    if (!Array.isArray(s.elements)) s.elements = [];
  }
}

/**
 * Fills fields that older .gameui.json files and drafts may lack. New fields
 * (screen role, nav, focus; node nav) stay optional and are only written when set.
 */
export function normalizeDocument(doc) {
  validateDocument(doc);
  const anchorIds = new Set(ANCHORS.map(a => a.id));
  const typeIds = new Set(TYPES.map(t => t.id));
  function fix(nodes) {
    for (const n of nodes) {
      if (!n.id) n.id = generateId(n.type || 'node');
      if (!typeIds.has(n.type)) n.type = 'panel';
      if (!n.name) n.name = n.id;
      if (!anchorIds.has(n.anchor)) n.anchor = 'top-left';
      n.rect = { x: Number(n.rect?.x) || 0, y: Number(n.rect?.y) || 0, w: Number(n.rect?.w ?? 100) || 0, h: Number(n.rect?.h ?? 40) || 0 };
      if (!n.props || typeof n.props !== 'object') n.props = {};
      if (!Array.isArray(n.children)) n.children = [];
      fix(n.children);
    }
  }
  for (const s of doc.screens) fix(s.elements);
  if (!doc.screens.some(s => s.id === doc.activeScreen)) {
    doc.activeScreen = doc.screens.some(s => s.id === doc.activeScreenId) ? doc.activeScreenId : doc.screens[0].id;
  }
  return doc;
}

export function parseDocument(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return normalizeDocument(parsed);
}

/**
 * Built-in Industry Standard Templates (V2.0 Guidelines Compliant)
 */
export function createTemplateScreen(templateKey, resolution = { width: 1920, height: 1080 }) {
  switch (templateKey) {
    case 'main_menu': {
      const cont = newNode('button', 'BtnContinue', {
        anchor: 'center',
        x: 0, y: -100, w: 280, h: 50,
        props: {
          text: 'Continue',
          opacity: 0.5,
          comment: 'Enabled only when an active save file is detected. Primary default focus.'
        }
      });
      return {
        id: generateId('screen_mainmenu'),
        name: 'Main Menu',
        role: 'menu',
        resolution,
        notes: 'Main menu with keyboard/gamepad navigation. "Continue" is disabled until save game exists.',
        bgImage: null,
        bgOpacity: 0.3,
        focus: { default: cont.id, order: [] },
        elements: [
          newNode('panel', 'BackgroundCover', {
            anchor: 'full-stretch',
            x: 0, y: 0, w: 0, h: 0,
            props: { bgColor: '#0b0f19', borderWidth: 0 }
          }),
          newNode('label', 'GameTitle', {
            anchor: 'top-center',
            x: 0, y: 130, w: 700, h: 80,
            props: { text: 'GAME TITLE', fontSize: 52, fontWeight: 'bold', textAlign: 'center', fontColor: '#38bdf8' }
          }),
          newNode('panel', 'MenuCard', {
            anchor: 'center',
            x: 0, y: 50, w: 340, h: 360,
            props: { bgColor: '#111827', borderColor: '#1f2937', borderWidth: 1, borderRadius: 8 },
            children: [
              cont,
              newNode('button', 'BtnNewGame', {
                anchor: 'center',
                x: 0, y: -35, w: 280, h: 50,
                props: { text: 'New Game', comment: 'Starts a new campaign or character.' }
              }),
              newNode('button', 'BtnOptions', {
                anchor: 'center',
                x: 0, y: 30, w: 280, h: 50,
                props: { text: 'Options', comment: 'Navigates to Options screen.' }
              }),
              newNode('button', 'BtnQuit', {
                anchor: 'center',
                x: 0, y: 95, w: 280, h: 50,
                props: {
                  text: 'Quit',
                  bgColor: '#374151',
                  borderColor: '#4b5563',
                  comment: 'Open confirmation modal before exiting to desktop.'
                }
              })
            ]
          }),
          newNode('label', 'VersionLabel', {
            anchor: 'bottom-right',
            x: -24, y: -20, w: 180, h: 24,
            props: { text: 'v0.1.0-alpha', fontSize: 13, fontColor: '#64748b', textAlign: 'right' }
          })
        ]
      };
    }

    case 'pause_menu': {
      const resume = newNode('button', 'BtnResume', {
        anchor: 'center',
        x: 0, y: -65, w: 280, h: 48,
        props: { text: 'Resume Game', comment: 'Unpauses simulation and restores input to gameplay.' }
      });
      return {
        id: generateId('screen_pause'),
        name: 'Pause Menu',
        role: 'submenu',
        resolution,
        notes: 'In-game pause menu. Freezes gameplay simulation, physical timers, and SFX.',
        bgImage: null,
        bgOpacity: 0.5,
        nav: { onBack: BACK_PREVIOUS },
        focus: { default: resume.id, order: [] },
        elements: [
          newNode('panel', 'DimmedOverlay', {
            anchor: 'full-stretch',
            x: 0, y: 0, w: 0, h: 0,
            props: { bgColor: 'rgba(5, 7, 13, 0.75)', borderWidth: 0 }
          }),
          newNode('panel', 'PauseDialog', {
            anchor: 'center',
            x: 0, y: 0, w: 360, h: 420,
            props: { bgColor: '#0f172a', borderColor: '#334155', borderWidth: 2, borderRadius: 10 },
            children: [
              newNode('label', 'PauseHeading', {
                anchor: 'top-center',
                x: 0, y: 24, w: 260, h: 40,
                props: { text: 'PAUSED', fontSize: 28, fontWeight: 'bold', textAlign: 'center', fontColor: '#f8fafc' }
              }),
              resume,
              newNode('button', 'BtnRestart', {
                anchor: 'center',
                x: 0, y: -5, w: 280, h: 48,
                props: { text: 'Restart Checkpoint', comment: 'Requires confirmation prompt.' }
              }),
              newNode('button', 'BtnOptions', {
                anchor: 'center',
                x: 0, y: 55, w: 280, h: 48,
                props: { text: 'Options', comment: 'Opens options overlay.' }
              }),
              newNode('button', 'BtnQuitToMenu', {
                anchor: 'center',
                x: 0, y: 115, w: 280, h: 48,
                props: { text: 'Main Menu', bgColor: '#991b1b', borderColor: '#ef4444', comment: 'Prompts to save uncommitted progress.' }
              })
            ]
          })
        ]
      };
    }

    case 'game_hud':
      // Corner widgets sit on the 90% action-safe frame (5% of each side).
      return {
        id: generateId('screen_hud'),
        name: 'Game HUD',
        role: 'hud',
        resolution,
        notes: 'In-game Heads-Up Display. Corner-anchored safe zones, chip-damage gauges, and action bar.',
        bgImage: null,
        bgOpacity: 0.1,
        elements: [
          // Top Left Vitals
          newNode('panel', 'VitalsPanel', {
            anchor: 'top-left',
            x: 96, y: 54, w: 320, h: 90,
            props: { bgColor: 'rgba(15, 23, 42, 0.75)', borderColor: '#334155', borderWidth: 1, borderRadius: 8 },
            children: [
              newNode('slider', 'HealthGauge', {
                anchor: 'top-left',
                x: 16, y: 16, w: 288, h: 26,
                props: { label: 'HP', value: 85, max: 100, fillColor: '#ef4444', comment: 'Dual readout (bar + 85/100 text) with chip damage animation.' }
              }),
              newNode('slider', 'ManaGauge', {
                anchor: 'top-left',
                x: 16, y: 48, w: 288, h: 22,
                props: { label: 'MP', value: 60, max: 100, fillColor: '#3b82f6', comment: 'Stamina or Mana reserve bar.' }
              })
            ]
          }),
          // Top Right Minimap
          newNode('panel', 'MinimapFrame', {
            anchor: 'top-right',
            x: -96, y: 54, w: 200, h: 200,
            props: { bgColor: 'rgba(15, 23, 42, 0.8)', borderColor: '#0ea5e9', borderWidth: 2, borderRadius: 100 },
            children: [
              newNode('label', 'MinimapCompass', {
                anchor: 'top-center',
                x: 0, y: 8, w: 60, h: 20,
                props: { text: 'N', fontSize: 13, fontWeight: 'bold', textAlign: 'center', fontColor: '#38bdf8' }
              })
            ]
          }),
          // Bottom Center Action Bar
          newNode('panel', 'ActionBar', {
            anchor: 'bottom-center',
            x: 0, y: -54, w: 420, h: 72,
            props: { bgColor: 'rgba(15, 23, 42, 0.85)', borderColor: '#475569', borderWidth: 1, borderRadius: 8 },
            children: [
              newNode('button', 'Slot1', {
                anchor: 'center-left',
                x: 18, y: 0, w: 54, h: 54,
                props: { text: 'Q', fontSize: 14, comment: 'Primary skill slot. Shows cooldown sweep.' }
              }),
              newNode('button', 'Slot2', {
                anchor: 'center-left',
                x: 82, y: 0, w: 54, h: 54,
                props: { text: 'W', fontSize: 14, comment: 'Secondary skill.' }
              }),
              newNode('button', 'Slot3', {
                anchor: 'center-left',
                x: 146, y: 0, w: 54, h: 54,
                props: { text: 'E', fontSize: 14, comment: 'Utility skill.' }
              }),
              newNode('button', 'Slot4', {
                anchor: 'center-left',
                x: 210, y: 0, w: 54, h: 54,
                props: { text: 'R', fontSize: 14, bgColor: '#b91c1c', borderColor: '#f87171', comment: 'Ultimate ability.' }
              }),
              newNode('button', 'SlotItem', {
                anchor: 'center-right',
                x: -18, y: 0, w: 54, h: 54,
                props: { text: 'F', fontSize: 14, bgColor: '#065f46', borderColor: '#34d399', comment: 'Consumable item (Potion).' }
              })
            ]
          })
        ]
      };

    case 'options_screen': {
      const tabVideo = newNode('button', 'TabVideo', {
        anchor: 'center-left',
        x: 10, y: 0, w: 140, h: 36,
        props: { text: 'Video / Display', fontSize: 14, bgColor: '#3b82f6' }
      });
      return {
        id: generateId('screen_options'),
        name: 'Options Screen',
        role: 'submenu',
        resolution,
        notes: 'Options and Settings screen with 5 standardized tabs: Video, Audio, Controls, Gameplay, Accessibility.',
        bgImage: null,
        bgOpacity: 0.3,
        nav: { onBack: BACK_PREVIOUS },
        focus: { default: tabVideo.id, order: [] },
        elements: [
          newNode('panel', 'OptionsContainer', {
            anchor: 'center',
            x: 0, y: 0, w: 1100, h: 680,
            props: { bgColor: '#0f172a', borderColor: '#334155', borderWidth: 1, borderRadius: 12 },
            children: [
              newNode('label', 'OptionsTitle', {
                anchor: 'top-left',
                x: 40, y: 30, w: 300, h: 40,
                props: { text: 'SETTINGS', fontSize: 26, fontWeight: 'bold', fontColor: '#f8fafc' }
              }),
              // Tab Header
              newNode('panel', 'TabsRow', {
                anchor: 'top-left',
                x: 40, y: 80, w: 1020, h: 46,
                props: { bgColor: '#1e293b', borderWidth: 0, borderRadius: 6 },
                children: [
                  tabVideo,
                  newNode('button', 'TabGraphics', {
                    anchor: 'center-left',
                    x: 160, y: 0, w: 130, h: 36,
                    props: { text: 'Graphics', fontSize: 14, bgColor: '#334155' }
                  }),
                  newNode('button', 'TabAudio', {
                    anchor: 'center-left',
                    x: 300, y: 0, w: 120, h: 36,
                    props: { text: 'Audio', fontSize: 14, bgColor: '#334155' }
                  }),
                  newNode('button', 'TabControls', {
                    anchor: 'center-left',
                    x: 430, y: 0, w: 130, h: 36,
                    props: { text: 'Controls', fontSize: 14, bgColor: '#334155' }
                  }),
                  newNode('button', 'TabAccessibility', {
                    anchor: 'center-left',
                    x: 570, y: 0, w: 150, h: 36,
                    props: { text: 'Accessibility', fontSize: 14, bgColor: '#334155' }
                  })
                ]
              }),
              // Options Content Panel
              newNode('panel', 'SettingsContent', {
                anchor: 'top-left',
                x: 40, y: 146, w: 1020, h: 440,
                props: { bgColor: '#111827', borderColor: '#1f2937', borderWidth: 1, borderRadius: 8 },
                children: [
                  newNode('slider', 'MasterVolume', {
                    anchor: 'top-left',
                    x: 30, y: 30, w: 420, h: 32,
                    props: { label: 'Master Volume', value: 80, max: 100 }
                  }),
                  newNode('slider', 'MusicVolume', {
                    anchor: 'top-left',
                    x: 30, y: 80, w: 420, h: 32,
                    props: { label: 'Music Volume', value: 65, max: 100 }
                  }),
                  newNode('slider', 'SfxVolume', {
                    anchor: 'top-left',
                    x: 30, y: 130, w: 420, h: 32,
                    props: { label: 'SFX Volume', value: 90, max: 100 }
                  }),
                  newNode('checkbox', 'MuteOnFocusLost', {
                    anchor: 'top-left',
                    x: 30, y: 180, w: 320, h: 28,
                    props: { label: 'Mute Audio on Focus Lost (Alt-Tab)', checked: true }
                  }),
                  newNode('checkbox', 'SubtitlesToggle', {
                    anchor: 'top-left',
                    x: 30, y: 220, w: 320, h: 28,
                    props: { label: 'Enable Subtitles & Captions', checked: true }
                  })
                ]
              }),
              // Persistent Action Bottom Bar
              newNode('button', 'BtnApply', {
                anchor: 'bottom-right',
                x: -40, y: -22, w: 150, h: 42,
                props: { text: 'Apply Changes', bgColor: '#16a34a', borderColor: '#22c55e' }
              }),
              newNode('button', 'BtnDiscard', {
                anchor: 'bottom-right',
                x: -204, y: -22, w: 130, h: 42,
                props: { text: 'Discard', bgColor: '#374151', borderColor: '#4b5563' }
              }),
              newNode('button', 'BtnDefaults', {
                anchor: 'bottom-left',
                x: 40, y: -22, w: 170, h: 42,
                props: { text: 'Restore Defaults', bgColor: '#7f1d1d', borderColor: '#991b1b', comment: 'Requires confirmation prompt.' }
              })
            ]
          })
        ]
      };
    }

    case 'confirmation_modal':
    default: {
      const cancel = newNode('button', 'BtnCancel', {
        anchor: 'bottom-left',
        x: 40, y: -24, w: 190, h: 44,
        props: { text: 'Cancel', bgColor: '#334155', borderColor: '#475569', comment: 'Safest choice. Must receive immediate focus.' },
        nav: { onConfirm: BACK_PREVIOUS }
      });
      return {
        id: generateId('screen_modal'),
        name: 'Confirmation Modal',
        role: 'modal',
        resolution,
        notes: 'Destructive action modal dialog. Blurs/dims background; default focus on Cancel.',
        bgImage: null,
        bgOpacity: 0.6,
        nav: { onBack: BACK_PREVIOUS },
        focus: { default: cancel.id, order: [] },
        elements: [
          newNode('panel', 'Backdrop', {
            anchor: 'full-stretch',
            x: 0, y: 0, w: 0, h: 0,
            props: { bgColor: 'rgba(0, 0, 0, 0.7)', borderWidth: 0 }
          }),
          newNode('panel', 'ModalBox', {
            anchor: 'center',
            x: 0, y: 0, w: 500, h: 240,
            props: { bgColor: '#181e2e', borderColor: '#ef4444', borderWidth: 2, borderRadius: 10 },
            children: [
              newNode('label', 'ModalHeader', {
                anchor: 'top-center',
                x: 0, y: 24, w: 420, h: 36,
                props: { text: 'Confirm Action', fontSize: 22, fontWeight: 'bold', textAlign: 'center', fontColor: '#f8fafc' }
              }),
              newNode('label', 'ModalMessage', {
                anchor: 'top-center',
                x: 0, y: 74, w: 420, h: 50,
                props: { text: 'Are you sure you want to discard unsaved changes? This cannot be undone.', fontSize: 15, textAlign: 'center', fontColor: '#cbd5e1' }
              }),
              cancel,
              newNode('button', 'BtnConfirm', {
                anchor: 'bottom-right',
                x: -40, y: -24, w: 190, h: 44,
                props: { text: 'Confirm', bgColor: '#dc2626', borderColor: '#ef4444', comment: 'Executes destructive action.' }
              })
            ]
          })
        ]
      };
    }
  }
}

export const TEMPLATES = [
  { id: 'main_menu', label: 'Main Menu' },
  { id: 'pause_menu', label: 'Pause Menu' },
  { id: 'game_hud', label: 'Game HUD' },
  { id: 'options_screen', label: 'Options Screen' },
  { id: 'confirmation_modal', label: 'Confirmation Modal' }
];

/**
 * Creates default initial document
 */
export function createDefaultDocument(projectName = 'Universal Game', projectPath = '') {
  const main = createTemplateScreen('main_menu');
  const pause = createTemplateScreen('pause_menu');
  const hud = createTemplateScreen('game_hud');
  const options = createTemplateScreen('options_screen');
  const confirm = createTemplateScreen('confirmation_modal');

  const link = (screen, name, to) => {
    const found = flattenNodes(screen.elements).find(e => e.node.name === name);
    if (found) found.node.nav = { onConfirm: to };
  };
  link(main, 'BtnOptions', options.id);
  link(main, 'BtnQuit', confirm.id);
  link(pause, 'BtnOptions', options.id);
  link(pause, 'BtnRestart', confirm.id);
  link(pause, 'BtnQuitToMenu', confirm.id);
  hud.nav = { onBack: pause.id };

  return {
    version: '1.0.0',
    id: generateId('doc'),
    projectName,
    projectPath,
    activeScreen: main.id,
    screens: [main, pause, hud, options, confirm]
  };
}

/**
 * Generates structured, high-signal Agent Handoff outline in Markdown
 */
export function generateHandoff(doc, screenId = null) {
  const screen = screenId
    ? doc.screens.find(s => s.id === screenId)
    : doc.screens.find(s => s.id === doc.activeScreen) || doc.screens[0];

  if (!screen) return '# No active screen found.';

  const screenName = id => id === BACK_PREVIOUS ? 'previous screen (close)' : (findScreen(doc, id)?.name || `missing screen "${id}"`);
  const nodeName = id => flattenNodes(screen.elements).find(e => e.node.id === id)?.node.name || id;

  const lines = [];
  lines.push(`# UI Handoff Specification: ${screen.name}`);
  lines.push(`- **Project:** ${doc.projectName || 'Unassigned'}`);
  lines.push(`- **Screen Type:** ${SCREEN_ROLES.find(r => r.id === screenRole(screen))?.label || 'Submenu'}`);
  lines.push(`- **Resolution / Aspect Ratio:** ${screen.resolution.width} × ${screen.resolution.height} (${(screen.resolution.width / screen.resolution.height).toFixed(2)}:1)`);
  if (screen.notes) lines.push(`- **Screen Intent:** ${screen.notes}`);
  lines.push('');
  lines.push('## Hierarchical Layout Tree');
  lines.push('```text');

  function renderTree(nodes, indent = '', isLast = true) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const last = i === nodes.length - 1;
      const marker = last ? '└── ' : '├── ';
      const pos = `anchor: ${n.anchor}, rect: [x=${n.rect.x}, y=${n.rect.y}, w=${n.rect.w}, h=${n.rect.h}]`;
      const textLabel = n.props.text ? ` "${n.props.text}"` : (n.props.label ? ` "${n.props.label}"` : '');
      const link = n.nav?.onConfirm ? ` → ${screenName(n.nav.onConfirm)}` : '';
      lines.push(`${indent}${marker}${n.name} [${n.type}] (${pos})${textLabel}${link}`);
      if (n.props.comment) {
        const subIndent = indent + (last ? '    ' : '│   ');
        lines.push(`${subIndent}→ NOTE: ${n.props.comment}`);
      }
      if (n.children && n.children.length > 0) {
        renderTree(n.children, indent + (last ? '    ' : '│   '), true);
      }
    }
  }

  renderTree(screen.elements);
  lines.push('```');
  lines.push('');
  lines.push('## Interactive Elements & Action Manifest');
  lines.push('| Element Name | Type | Key Properties | Designer Comments / Action Hook |');
  lines.push('| :--- | :--- | :--- | :--- |');

  const all = flattenNodes(screen.elements);
  for (const { node } of all) {
    const props = [];
    if (node.props.text) props.push(`text: "${node.props.text}"`);
    if (node.props.label) props.push(`label: "${node.props.label}"`);
    if (node.props.fontSize) props.push(`font: ${node.props.fontSize}px${node.props.fontWeight && node.props.fontWeight !== 'normal' ? ` ${node.props.fontWeight}` : ''}`);
    if (node.props.bgColor) props.push(`bg: ${node.props.bgColor}`);
    if (node.props.fontFamily) props.push(`font family: ${node.props.fontFamily}`);
    if (node.props.skin) props.push(`skin: ${node.props.skin}${node.props.skinSlice ? ` (9-slice ${node.props.skinSlice.join(', ')})` : ''}`);
    if (node.props.opacity !== undefined && node.props.opacity < 1) props.push(`opacity: ${node.props.opacity}`);
    if (node.props.states) props.push(`states: ${Object.keys(node.props.states).join('/')}`);
    if (node.nav?.onConfirm) props.push(`opens: ${screenName(node.nav.onConfirm)}`);
    const propStr = props.length ? props.join(', ') : '-';
    const comment = node.props.comment || '-';
    lines.push(`| **${node.name}** | \`${node.type}\` | ${propStr} | ${comment} |`);
  }

  const order = focusOrder(screen);
  const def = defaultFocusId(screen);
  lines.push('');
  lines.push('## Navigation & Focus');
  lines.push(`- **Esc / B (Back):** ${screen.nav?.onBack ? screenName(screen.nav.onBack) : 'not set'}`);
  lines.push(`- **Default focus:** ${def ? nodeName(def) : 'not set'}`);
  if (order.length) lines.push(`- **Focus order:** ${order.map(nodeName).join(' → ')}`);

  lines.push('');
  lines.push('## Implementation Instructions for Agent');
  lines.push('1. Implement this screen using the project engine\'s native UI nodes (e.g., Godot `Control` / `PanelContainer` / `Button`, Unreal UMG, or Unity `RectTransform`).');
  lines.push('2. Respect the anchor constraints so the layout scales responsively.');
  lines.push('3. Bind the designer notes above to actual game signals/actions and maintain input sink to prevent world click-through.');
  lines.push('4. Implement the Normal, Hover, Pressed, Focused and Disabled states, the Esc / Back target and the default focus listed above.');

  return lines.join('\n');
}
