/**
 * Game UI Studio - Main Application Controller
 * Canvas-first editor: tool strip, layers, screen tabs, sectioned properties, Flow board,
 * local guideline checks, aspect-ratio previews, and the AI Copilot drawer.
 */

import {
  TYPES,
  ANCHORS,
  STATES,
  SCREEN_ROLES,
  TEMPLATES,
  BACK_PREVIOUS,
  createDefaultDocument,
  createTemplateScreen,
  defaultStates,
  generateId,
  newNode,
  findNode,
  findScreen,
  flattenNodes,
  reorderNode,
  duplicateNode,
  removeNode,
  updateLocalFromWorld,
  setAnchorKeepingBox,
  naturalAnchor,
  previewResolutions,
  screenRole,
  isInteractive,
  focusOrder,
  defaultFocusId,
  layoutFlow,
  generateHandoff,
  parseDocument
} from './model.mjs';

import { render, hitTest, stateStyle, pinCenter, onImageLoad } from './render.mjs';
import { CATEGORIES, loadKitFor, loadKitFonts, instantiate, skinProps, assetNode, fetchJson } from './kit.mjs';
import { runChecks, summarize } from './checks.mjs';
import { createAgentLink } from './agent-link.mjs';
import { createCopilot } from './copilot.mjs';
import './theme.mjs';

// DOM Utilities
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'mrmak.game-ui-studio.draft.v1';
const STORAGE_UI_KEY = 'mrmak.game-ui-studio.ui.v1';
const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const GRID_STEPS = [0, 8, 16, 32];
const RESOLUTIONS = [
  [1920, 1080, '16:9'], [1280, 720, '16:9'], [2560, 1440, '16:9'],
  [2560, 1080, '21:9'], [3440, 1440, '21:9'], [1920, 1200, '16:10'], [800, 600, '4:3']
];
const WEIGHTS = [['normal', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['bold', 'Bold']];

// App State
let doc = createDefaultDocument('Bleeding Stars', 'projects/Bleeding Stars');
let selectedId = null;
let hoveredId = null;
let undoStack = [];
let redoStack = [];
let worldBoxes = new Map();
let isResizingChat = false;
let link = null;
let copilot = null;
let pinHits = [];
let proposalTagKey = '';

// Filled by boot once Mr. Mak's copy is known (Remembering).
const prefs = {};
let chatWidth = 360;
let gridSize = 16;
let showSafe = true;
let showPins = true;
let showOverlay = true;
let mode = 'screen';
let activeTool = 'select';
let previewState = 'normal';
let aspectId = 'design';
let zoomMode = 'fit';
let currentZoom = 1;
let issues = [];
let checksScope = 'screen';
let highlightId = null;
let highlightTimer = 0;
let inspectorFrame = 0;
let liveSnapshot = null;
let nudgeSession = null;
let layerFilter = '';
let openPop = null;
let revealPending = false;
let kit = null; // The connected game's kit (kit.mjs), or null
let kitState = 'idle'; // idle | loading | none | ready | error
let kitError = '';
let kitCat = '';
let kitQuery = '';
let kitRedraw = 0;
let kitPath = null; // The project folder the kit was read for
let sideTab = 'layers';
const collapsed = new Set();

// Drag / Transform State on Canvas
let dragOperation = null; // { mode: 'move' | 'resize', handle, startX, startY, origWorldBox, parentBox, nodeId, snapshot, moved }
let placement = null; // { start, current }

// Re-render whenever the Mr. Mak theme changes (rulers and canvas read theme tokens)
window.addEventListener('mrmak-theme-changed', () => {
  if (typeof drawStage === 'function') drawStage();
});

// Initialize
async function boot() {
  try {
    initTools();
    link = createAgentLink({ token: getApiToken() });
    await restoreFromMrMak();
    Object.assign(prefs, loadPrefs());
    chatWidth = prefs.chatWidth;
    gridSize = prefs.grid;
    showSafe = prefs.safe;
    showPins = prefs.pins !== false;
    copilot = createCopilot(copilotHost());
    initEventListeners();
    initKit();
    copilot.init();
    loadSavedDraft();
    applyPrefsToUI();
    refreshAll();
    scanAllProjects().catch(err => console.warn('Could not scan projects:', err));
  } catch (err) {
    console.error('UI Studio boot error:', err);
  }
}

// ================= Preferences (per viewer, not part of the document) =================
function loadPrefs() {
  const base = { chatOpen: false, chatWidth: 360, grid: 16, safe: true, pins: true, sections: {} };
  try {
    const raw = remotePrefs || JSON.parse(localStorage.getItem(STORAGE_UI_KEY) || '{}');
    return { ...base, ...raw, sections: { ...(raw.sections || {}) } };
  } catch {
    return base;
  }
}

function savePrefs() {
  const value = { ...prefs, chatWidth, grid: gridSize, safe: showSafe, pins: showPins };
  const at = Date.now();
  try {
    localStorage.setItem(STORAGE_UI_KEY, JSON.stringify(value));
    localStorage.setItem(STORAGE_UI_KEY + '.at', String(at));
  } catch (e) {}
  queueSave({ prefs: { value, at } });
}

function applyPrefsToUI() {
  $('studio').style.setProperty('--chat-w', `${chatWidth}px`);
  if (prefs.chatOpen) openChat(false);
  $('chat-project-badge').textContent = doc.projectName || 'Standalone';
}

// What the Copilot drawer may read and do in the editor.
function copilotHost() {
  return {
    link,
    prefs,
    savePrefs,
    getDoc: () => doc,
    activeScreenId: () => getActiveScreen().id,
    selectedId: () => selectedId,
    issues: () => issues,
    commit: (next, message) => commit(next, message),
    undo: () => undo(),
    redraw: () => drawStage(),
    showScreen: id => {
      if (mode !== 'screen') setMode('screen');
      if (id && id !== getActiveScreen().id) switchScreen(id);
    },
    setStatus,
    kitSrc: () => kit?.src || null,
    reloadKit: () => loadKit(),
    openChat: () => openChat(),
    isChatOpen: () => !$('chat-panel').classList.contains('collapsed')
  };
}

// ================= Tool strip =================
function initTools() {
  const tools = $('tools');
  const button = (tool, icon, title, key) => `
    <button class="tool${tool === 'select' ? ' on always' : ''}" data-tool="${tool}" title="${title}${key ? ` (${key})` : ''}" aria-label="${title}">
      <svg class="ic"><use href="#i-${icon}"/></svg>${key ? `<kbd>${key}</kbd>` : ''}
    </button>`;
  tools.innerHTML = [
    button('select', 'cursor', 'Select and move', 'V'),
    '<hr>',
    ...TYPES.map(t => button(t.id, t.id, `${t.label}: click or drag on the canvas`, t.key)),
    '<hr>',
    `<button class="tool" id="btn-insert-template" title="Insert a template into this screen" aria-label="Insert template" aria-haspopup="menu"><svg class="ic"><use href="#i-template"/></svg></button>`
  ].join('');
  tools.addEventListener('click', e => {
    const btn = e.target.closest('[data-tool]');
    if (btn) setTool(btn.dataset.tool);
  });
  $('btn-insert-template').onclick = e => openTemplateMenu('insert', e.currentTarget);
}

function setTool(tool) {
  activeTool = tool;
  placement = null;
  $('studio').dataset.tool = tool;
  document.querySelectorAll('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  if (tool !== 'select') {
    const def = TYPES.find(t => t.id === tool);
    setStatus(`${def.label}: click on the canvas to place it, or drag to size it. Enter places it in the middle; Esc cancels.`);
  }
  drawCanvas();
}

// ================= Remembering =================
// Mr. Mak keeps the project list, the draft and the view preferences
// (desktop/service/ui-studio-state.mjs), because this frame's origin, and so
// its storage, changes with every launch. The local copies serve the studio
// offline; whichever draft or preferences copy is newer wins.
const STORAGE_ROOTS_KEY = 'mrmak.game-ui-studio.project-roots.v1';
const STORAGE_HIDDEN_KEY = 'mrmak.game-ui-studio.hidden-projects.v1';
const SAVE_DELAY_MS = 700;
let projectPrefs = { roots: ['projects'], hidden: [] };
let remoteDraft = null; // Mr. Mak's copies, when this browser cannot store them
let remotePrefs = null;
let pendingSave = null;
let saveTimer = 0;

function readLocal(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
const localStamp = key => Number(localStorage.getItem(key + '.at')) || 0;
const linked = () => !!link && (link.mode === 'bridge' || link.mode === 'direct');

function normalizeProjectPrefs(value) {
  const list = items => Array.isArray(items) ? items.filter(item => typeof item === 'string' && item) : [];
  const roots = list(value?.roots);
  return { roots: roots.includes('projects') ? roots : ['projects', ...roots], hidden: list(value?.hidden) };
}

async function restoreFromMrMak() {
  projectPrefs = normalizeProjectPrefs({ roots: readLocal(STORAGE_ROOTS_KEY, []), hidden: readLocal(STORAGE_HIDDEN_KEY, []) });
  if ((await link.ready) === 'offline') return;
  let state;
  try { state = await link.call('state'); } catch (err) { console.warn('Could not read the studio state from Mr. Mak:', err); return; }
  const upload = {};
  // The first time, Mr. Mak takes what this browser had kept.
  if (state.projects) storeProjectsLocally(normalizeProjectPrefs(state.projects));
  else upload.projects = projectPrefs;
  try {
    const draftAt = localStamp(STORAGE_KEY), prefsAt = localStamp(STORAGE_UI_KEY);
    if (state.draft && state.draft.at >= draftAt) {
      localStorage.setItem(STORAGE_KEY, state.draft.doc);
      localStorage.setItem(STORAGE_KEY + '.at', String(state.draft.at));
    } else if (localStorage.getItem(STORAGE_KEY)) upload.draft = { doc: localStorage.getItem(STORAGE_KEY), at: draftAt || Date.now() };
    if (state.prefs && state.prefs.at >= prefsAt) {
      localStorage.setItem(STORAGE_UI_KEY, JSON.stringify(state.prefs.value));
      localStorage.setItem(STORAGE_UI_KEY + '.at', String(state.prefs.at));
    } else if (localStorage.getItem(STORAGE_UI_KEY)) upload.prefs = { value: readLocal(STORAGE_UI_KEY, {}), at: prefsAt || Date.now() };
  } catch {
    // This browser cannot store the copies (full or blocked): use Mr. Mak's directly.
    remoteDraft = state.draft?.doc || null;
    remotePrefs = state.prefs?.value || null;
  }
  if (Object.keys(upload).length) queueSave(upload);
}

function storeProjectsLocally(next) {
  projectPrefs = next;
  try {
    localStorage.setItem(STORAGE_ROOTS_KEY, JSON.stringify(next.roots));
    localStorage.setItem(STORAGE_HIDDEN_KEY, JSON.stringify(next.hidden));
  } catch {}
}

// Edits come in bursts: send the latest of each part after a short pause.
function queueSave(part) {
  pendingSave = { ...pendingSave, ...part };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
}

async function flushSave() {
  clearTimeout(saveTimer);
  const part = pendingSave;
  pendingSave = null;
  if (!part || !linked()) return;
  try {
    await link.call('save-state', part);
  } catch (err) {
    setStatus(`Mr. Mak could not save the studio: ${err.message}`);
  }
}
window.addEventListener('pagehide', () => { flushSave(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

async function saveProjectPrefs(next) {
  storeProjectsLocally(normalizeProjectPrefs(next));
  queueSave({ projects: projectPrefs });
  await flushSave();
}

const getProjectRoots = () => [...projectPrefs.roots];
const projectKey = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isHiddenProject = path => projectPrefs.hidden.some(item => projectKey(item) === projectKey(path));

async function scanAllProjects() {
  const select = $('project-select');
  const roots = getProjectRoots();
  const currentVal = doc.projectPath || select.value;

  select.innerHTML = '<option value="">(Standalone / No Project)</option>';
  let foundAny = false;
  // Folders are listed through Mr. Mak; offline the fallback list below applies.
  const linked = (await link.ready) !== 'offline';

  for (const root of linked ? roots : []) {
    try {
      const data = await link.call('list', { path: root });
      for (const d of Array.isArray(data.entries) ? data.entries : []) {
        foundAny = true;
        if (isHiddenProject(d.path)) continue;
        const opt = document.createElement('option');
        opt.value = d.path;
        opt.textContent = root === 'projects' ? d.name : `${d.name} (${root})`;
        if (d.path === currentVal || d.name === doc.projectName) opt.selected = true;
        select.appendChild(opt);
      }
    } catch (err) {
      console.warn(`Could not scan root "${root}":`, err);
    }
  }

  // Fallbacks if standalone/offline
  if (!foundAny && roots.includes('projects')) {
    const defaults = [
      { name: 'Bleeding Stars (Unreal)', path: 'projects/Bleeding Stars' },
      { name: 'highseas (Minecraft NeoForge)', path: 'projects/highseas' },
      { name: 'wildhorizons', path: 'projects/wildhorizons' },
      { name: 'horizonqol', path: 'projects/horizonqol' },
      { name: 'izztudio', path: 'projects/izztudio' }
    ];
    for (const d of defaults.filter(item => !isHiddenProject(item.path))) {
      const opt = document.createElement('option');
      opt.value = d.path;
      opt.textContent = d.name;
      if (d.path === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
  }
  updateRemoveProjectButton();
}

function updateRemoveProjectButton() {
  const select = $('project-select');
  const option = select.options[select.selectedIndex];
  $('btn-remove-project').disabled = !select.value;
  $('btn-remove-project').title = select.value ? `Remove ${option.text} from the project list` : 'Choose a project to remove it from the list';
}

// Removing hides the project from the picker; its folder is left untouched.
async function removeProjectFromList() {
  const select = $('project-select');
  const path = select.value;
  if (!path) return;
  const name = select.options[select.selectedIndex].text;
  if (!isHiddenProject(path)) await saveProjectPrefs({ ...projectPrefs, hidden: [...projectPrefs.hidden, path] });
  select.value = '';
  select.dispatchEvent(new Event('change'));
  await scanAllProjects();
  setStatus(`${name} was removed from the project list. Project folders… brings it back.`);
}

async function restoreProject(path) {
  await saveProjectPrefs({ ...projectPrefs, hidden: projectPrefs.hidden.filter(item => projectKey(item) !== projectKey(path)) });
  renderFoldersList();
  await scanAllProjects();
  setStatus(`${path} is back in the project list.`);
}

function renderFoldersList() {
  const container = $('folders-list');
  const roots = getProjectRoots();
  container.innerHTML = '';

  for (let i = 0; i < roots.length; i++) {
    const r = roots[i];
    const row = document.createElement('div');
    row.className = 'folder-item';

    const pathSpan = document.createElement('div');
    pathSpan.className = 'folder-item-path';
    pathSpan.innerHTML = `<span class="folder-item-tag">${r === 'projects' ? 'Workspace' : 'Custom'}</span> <span>${escapeHtml(r)}</span>`;
    row.appendChild(pathSpan);

    if (r !== 'projects') {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn icon sm';
      delBtn.innerHTML = '<svg class="ic sm"><use href="#i-x"/></svg>';
      delBtn.title = 'Remove search directory';
      delBtn.style.color = 'var(--danger)';
      delBtn.onclick = async () => {
        await saveProjectPrefs({ ...projectPrefs, roots: roots.filter((_, idx) => idx !== i) });
        renderFoldersList();
        await scanAllProjects();
      };
      row.appendChild(delBtn);
    } else {
      const lockSpan = document.createElement('small');
      lockSpan.textContent = 'Default';
      row.appendChild(lockSpan);
    }

    container.appendChild(row);
  }

  const hidden = $('hidden-projects-list');
  hidden.innerHTML = '';
  $('hidden-projects-cap').hidden = !projectPrefs.hidden.length;
  for (const path of projectPrefs.hidden) {
    const row = document.createElement('div');
    row.className = 'folder-item';
    const pathSpan = document.createElement('div');
    pathSpan.className = 'folder-item-path';
    pathSpan.textContent = path;
    const restore = document.createElement('button');
    restore.className = 'btn sm';
    restore.textContent = 'Restore';
    restore.title = 'Show this project in the picker again';
    restore.onclick = () => restoreProject(path);
    row.append(pathSpan, restore);
    hidden.appendChild(row);
  }
}

// ================= Draft & History =================
function loadSavedDraft() {
  try {
    const saved = remoteDraft || localStorage.getItem(STORAGE_KEY);
    if (saved) {
      doc = parseDocument(saved);
      setStatus('Previous draft restored.');
    }
  } catch (e) {
    console.warn('Could not restore draft:', e);
  }
}

function saveDraft() {
  const text = JSON.stringify(doc);
  const at = Date.now();
  queueSave({ draft: { doc: text, at } });
  try {
    localStorage.setItem(STORAGE_KEY, text);
    localStorage.setItem(STORAGE_KEY + '.at', String(at));
    return true;
  } catch (e) {
    // A draft too big for this browser is still kept by Mr. Mak.
    return linked();
  }
}

function pushUndo(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
}

function commit(nextDoc, message = 'Changed.') {
  pushUndo(JSON.stringify(doc));
  doc = nextDoc;
  saveDraft();
  refreshAll();
  setStatus(message);
}

// The document was already changed in place (drag, inspector edit); record the state before it.
function commitFromSnapshot(snapshot, message = 'Changed.') {
  if (snapshot === JSON.stringify(doc)) {
    refreshAll();
    return;
  }
  pushUndo(snapshot);
  saveDraft();
  refreshAll();
  setStatus(message);
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(doc));
  doc = JSON.parse(undoStack.pop());
  if (selectedId && !findNode(doc, selectedId)) selectedId = null;
  saveDraft();
  refreshAll();
  setStatus('Undo.');
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(doc));
  doc = JSON.parse(redoStack.pop());
  if (selectedId && !findNode(doc, selectedId)) selectedId = null;
  saveDraft();
  refreshAll();
  setStatus('Redo.');
}

// ================= Active screen & preview resolution =================
function getActiveScreen() {
  return doc.screens.find(s => s.id === doc.activeScreen) || doc.screens[0];
}

function previewList(screen = getActiveScreen()) {
  return previewResolutions(screen.resolution);
}

function viewResolution() {
  const list = previewList();
  const p = list.find(r => r.id === aspectId) || list[0];
  return { width: p.width, height: p.height };
}

// The active screen at the previewed resolution. Anchors recompute; pixel sizes stay.
function viewScreen() {
  const screen = getActiveScreen();
  const res = viewResolution();
  if (res.width === screen.resolution.width && res.height === screen.resolution.height) return screen;
  return { ...screen, resolution: res };
}

function switchScreen(id) {
  if (!findScreen(doc, id)) return;
  doc.activeScreen = id;
  selectedId = null;
  hoveredId = null;
  saveDraft();
  refreshAll();
}

// ================= Refresh =================
function refreshAll() {
  // Opening a draft or file, undo and the project picker can all change the project.
  if (kitPath !== (doc.projectPath || '')) loadKit();
  updateChecks();
  copilot?.refresh();
  updateTopBar();
  renderTabs();
  renderTree();
  scheduleInspector();
  drawStage();
  updateStatusBar();
}

function drawStage() {
  if (mode === 'flow') drawFlow();
  else drawCanvas();
  updateProposalTag();
}

function updateTopBar() {
  $('btn-undo').disabled = undoStack.length === 0;
  $('btn-redo').disabled = redoStack.length === 0;

  const screen = getActiveScreen();
  const resSel = $('resolution-select');
  const resVal = `${screen.resolution.width}x${screen.resolution.height}`;
  const list = [...RESOLUTIONS];
  if (!list.some(([w, h]) => `${w}x${h}` === resVal)) list.unshift([screen.resolution.width, screen.resolution.height, 'custom']);
  resSel.innerHTML = list.map(([w, h, r]) => `<option value="${w}x${h}">${w} × ${h} · ${r}</option>`).join('');
  resSel.value = resVal;

  const aspSel = $('aspect-select');
  const previews = previewList(screen);
  if (!previews.some(p => p.id === aspectId)) aspectId = 'design';
  aspSel.innerHTML = previews.map(p => `<option value="${p.id}">${p.id === 'design' ? 'Design' : p.label} · ${p.width}×${p.height}</option>`).join('');
  aspSel.value = aspectId;
  aspSel.closest('.vt-select').classList.toggle('active', aspectId !== 'design');

  const tag = $('preview-tag');
  if (aspectId !== 'design' && mode === 'screen') {
    const p = previews.find(r => r.id === aspectId);
    tag.hidden = false;
    tag.innerHTML = `<div><b>Preview ${p.label}</b> ${p.width}×${p.height} · anchors recomputed, pixel sizes unchanged <button class="btn sm" data-action="aspect-design">Back to design</button></div>`;
  } else {
    tag.hidden = true;
  }
  $('stage').classList.toggle('aspect-on', !tag.hidden);

  const notes = flattenNodes(screen.elements).filter(e => String(e.node.props.comment || '').trim()).length;
  const pinsBtn = $('btn-pins');
  pinsBtn.classList.toggle('on', showPins);
  pinsBtn.setAttribute('aria-pressed', String(showPins));
  pinsBtn.title = `${showPins ? 'Hide' : 'Show'} intent pins · ${notes} note${notes === 1 ? '' : 's'} on this screen`;

  $('btn-grid').classList.toggle('on', gridSize > 0);
  $('grid-label').textContent = gridSize > 0 ? String(gridSize) : 'Off';
  $('btn-safe').classList.toggle('on', showSafe);
  const overlayBtn = $('btn-overlay');
  overlayBtn.classList.toggle('on', !!screen.bgImage && showOverlay);
  overlayBtn.title = screen.bgImage
    ? `${showOverlay ? 'Hide' : 'Show'} the reference screenshot (opacity in Screen properties)`
    : 'Upload a reference screenshot to trace over';

  document.querySelectorAll('#state-seg button').forEach(b => b.classList.toggle('on', b.dataset.state === previewState));
  $('mock-state-select').value = previewState;
}

function updateStatusBar() {
  const screen = getActiveScreen();
  const res = viewResolution();
  const preview = aspectId !== 'design' ? ` · <b>preview ${aspectId}</b>` : '';
  $('status-screen').innerHTML = `<b>${escapeHtml(screen.name)}</b> · ${res.width} × ${res.height}${preview}`;
  $('status-snap').textContent = gridSize > 0 ? `Snap ${gridSize} px` : 'Snap off';
  $('status-history').textContent = `Undo ${undoStack.length} · Redo ${redoStack.length}`;
  updateSelectionInfo();
}

function updateSelectionInfo() {
  const el = $('canvas-sel-info');
  if (selectedId && worldBoxes.has(selectedId)) {
    const { node, box } = worldBoxes.get(selectedId);
    el.innerHTML = `<code>${escapeHtml(node.name)}</code> · x ${Math.round(box.x)} · y ${Math.round(box.y)} · ${Math.round(box.w)} × ${Math.round(box.h)}`;
  } else {
    el.textContent = 'No selection';
  }
}

function setStatus(text, isError = false) {
  const bar = $('status-bar');
  bar.textContent = text;
  bar.className = `status-text ${isError ? 'error' : ''}`;
}

// ================= Canvas =================
function computeZoom(res) {
  if (zoomMode !== 'fit') return zoomMode;
  const vp = $('canvas-viewport');
  const availW = vp.clientWidth - 52 - 18 - 4;
  const availH = vp.clientHeight - 92 - 18 - 4;
  const z = Math.min(availW / res.width, availH / res.height);
  return Math.max(0.05, Math.min(4, z));
}

function drawCanvas() {
  if (mode !== 'screen') return;
  const canvas = $('canvas');
  const screen = viewScreen();
  if (!screen) return;
  const { width, height } = screen.resolution;

  currentZoom = computeZoom(screen.resolution);
  const cssW = Math.max(1, Math.round(width * currentZoom));
  const cssH = Math.max(1, Math.round(height * currentZoom));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  // Render at display resolution so text and lines stay crisp at any zoom.
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  canvas.getContext('2d').setTransform(bw / width, 0, 0, bh / height, 0, 0);

  const pins = showPins ? intentPins(screen) : [];
  worldBoxes = render(canvas, screen, {
    selection: selectedId,
    hovered: hoveredId,
    grid: gridSize,
    showSafeZones: showSafe,
    previewMode: false,
    mockState: previewState,
    focus: {
      order: focusOrder(screen),
      defaultId: defaultFocusId(screen),
      activeId: focusOrder(screen).includes(selectedId) ? selectedId : null
    },
    uiScale: 1 / currentZoom,
    highlight: highlightId,
    ghost: placementGhost(),
    hideOverlay: !showOverlay,
    pins,
    proposal: copilot?.overlay() || null
  });
  pinHits = pins.map(pin => {
    const item = worldBoxes.get(pin.id);
    return item ? { ...pin, ...pinCenter(item.box, screen.resolution, 1 / currentZoom) } : null;
  }).filter(Boolean);
  updateProposalTag();

  drawRulers(cssW, cssH, screen.resolution);
  updateSelectionInfo();
  $('zoom-label').textContent = `${zoomMode === 'fit' ? 'Fit ' : ''}${Math.round(currentZoom * 100)}%`;
}

// Elements with an intent note, numbered in layer order; hidden ones keep their number.
function intentPins(screen = getActiveScreen()) {
  const pins = [];
  let n = 0;
  const walk = (nodes, hidden) => {
    for (const node of nodes) {
      const off = hidden || node.props.visible === false;
      if (String(node.props.comment || '').trim()) {
        n++;
        if (!off) pins.push({ id: node.id, n, comment: node.props.comment });
      }
      if (node.children?.length) walk(node.children, off);
    }
  };
  walk(screen.elements || [], false);
  return pins;
}

function pinNumber(nodeId, screen = getActiveScreen()) {
  let n = 0;
  for (const { node } of flattenNodes(screen.elements || [])) {
    if (String(node.props.comment || '').trim()) {
      n++;
      if (node.id === nodeId) return n;
    }
  }
  return 0;
}

// The selected element's pin sits on its top-right resize handle; the handle wins.
function pinAt(pos) {
  for (let i = pinHits.length - 1; i >= 0; i--) {
    const p = pinHits[i];
    if (p.id === selectedId) continue;
    if (Math.hypot(pos.x - p.x, pos.y - p.y) <= p.r * 1.25) return p;
  }
  return null;
}

// The pill over the canvas while a Copilot proposal is previewed.
function updateProposalTag() {
  const info = mode === 'screen' ? copilot?.previewInfo() : null;
  const key = info ? `${info.id}|${info.count}|${info.rejected}` : '';
  if (key === proposalTagKey) return;
  proposalTagKey = key;
  const tag = $('proposal-tag');
  tag.hidden = !info;
  if (!info) return;
  tag.dataset.card = info.id;
  tag.innerHTML = `<div><span class="pdot"></span><b>${info.count} proposed change${info.count === 1 ? '' : 's'}</b>${info.rejected ? `<span class="rej">${info.rejected} rejected</span>` : ''}
    <button class="btn primary sm" data-action="apply" title="Apply as one undo step">Apply</button>
    <button class="btn sm" data-action="discard">Discard</button>
    <button class="btn icon sm" data-action="hide" title="Hide the preview (Esc)" aria-label="Hide the preview"><svg class="ic sm"><use href="#i-x"/></svg></button></div>`;
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function drawRulers(cssW, cssH, res) {
  const dpr = window.devicePixelRatio || 1;
  const muted = cssVar('--text-muted', '#a5a5b1');
  const line = cssVar('--border-medium', 'rgba(255,255,255,.13)');
  const accent = cssVar('--accent', '#f0a0b0');
  const z = currentZoom;
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find(s => s * z >= 56) || 2000;
  const minor = step * z / 5 >= 6 ? step / 5 : step / 2;
  const sel = selectedId && worldBoxes.has(selectedId) ? worldBoxes.get(selectedId).box : null;

  const prep = (canvas, w, h) => {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    return ctx;
  };

  const rx = prep($('ruler-x'), cssW, 18);
  if (sel) {
    rx.fillStyle = accent;
    rx.globalAlpha = 0.18;
    rx.fillRect(sel.x * z, 0, sel.w * z, 18);
    rx.globalAlpha = 1;
    rx.fillRect(sel.x * z, 15, sel.w * z, 3);
  }
  rx.strokeStyle = line;
  rx.fillStyle = muted;
  rx.beginPath();
  for (let v = 0; v <= res.width; v += minor) {
    const x = Math.round(v * z) + 0.5;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    rx.moveTo(x, major ? 4 : 12);
    rx.lineTo(x, 18);
    if (major) rx.fillText(String(Math.round(v)), x + 3, 2);
  }
  rx.stroke();

  const ry = prep($('ruler-y'), 18, cssH);
  if (sel) {
    ry.fillStyle = accent;
    ry.globalAlpha = 0.18;
    ry.fillRect(0, sel.y * z, 18, sel.h * z);
    ry.globalAlpha = 1;
    ry.fillRect(15, sel.y * z, 3, sel.h * z);
  }
  ry.strokeStyle = line;
  ry.fillStyle = muted;
  ry.beginPath();
  for (let v = 0; v <= res.height; v += minor) {
    const y = Math.round(v * z) + 0.5;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ry.moveTo(major ? 4 : 12, y);
    ry.lineTo(18, y);
    if (major) {
      ry.save();
      ry.translate(2, y + 3);
      ry.rotate(Math.PI / 2);
      ry.fillText(String(Math.round(v)), 0, -9);
      ry.restore();
    }
  }
  ry.stroke();
}

function setZoom(next) {
  zoomMode = next === 'fit' ? 'fit' : Math.max(0.05, Math.min(4, next));
  drawCanvas();
}

function zoomStep(dir) {
  const z = currentZoom;
  const next = dir > 0 ? ZOOM_STEPS.find(s => s > z + 0.001) : [...ZOOM_STEPS].reverse().find(s => s < z - 0.001);
  setZoom(next ?? (dir > 0 ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : ZOOM_STEPS[0]));
}

function placementGhost() {
  if (!placement) return null;
  const { start, current } = placement;
  return { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y) };
}

// ================= Screen tabs =================
function screenStatus(screenId) {
  const mine = issues.filter(i => i.screenId === screenId);
  if (mine.some(i => i.severity === 'error')) return 'err';
  return mine.length ? 'warn' : '';
}

function renderTabs() {
  const el = $('screen-tabs');
  el.innerHTML = '';
  for (const s of doc.screens) {
    const btn = document.createElement('button');
    const count = issues.filter(i => i.screenId === s.id).length;
    btn.className = `tab${s.id === doc.activeScreen ? ' on' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(s.id === doc.activeScreen));
    btn.dataset.screen = s.id;
    btn.title = `${s.name} · ${roleLabel(screenRole(s))}${count ? ` · ${count} check${count > 1 ? 's' : ''} to review` : ''}. Double-click to rename.`;
    btn.innerHTML = `<span class="st ${screenStatus(s.id)}"></span><span class="tn">${escapeHtml(s.name)}</span>`;
    btn.onclick = () => { if (s.id !== doc.activeScreen) switchScreen(s.id); };
    btn.ondblclick = () => startRenameTab(s.id, btn);
    el.appendChild(btn);
  }
  // Keep the active tab in view without scrolling any other container.
  const on = el.querySelector('.tab.on');
  if (on) {
    const box = el.getBoundingClientRect();
    const tab = on.getBoundingClientRect();
    if (tab.left < box.left) el.scrollLeft -= box.left - tab.left + 8;
    else if (tab.right > box.right) el.scrollLeft += tab.right - box.right + 8;
  }
}

function startRenameTab(screenId, btn) {
  const screen = findScreen(doc, screenId);
  const input = document.createElement('input');
  input.value = screen.name;
  input.setAttribute('aria-label', 'Screen name');
  const label = btn.querySelector('.tn');
  label.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== screen.name) {
      const snapshot = JSON.stringify(doc);
      screen.name = name;
      commitFromSnapshot(snapshot, `Renamed screen to "${name}".`);
    } else {
      renderTabs();
    }
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  };
  input.onblur = () => finish(true);
  input.onclick = e => e.stopPropagation();
}

function uniqueScreenName(name) {
  const names = new Set(doc.screens.map(s => s.name));
  if (!names.has(name)) return name;
  let i = 2;
  while (names.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

function createScreenFrom(key) {
  const res = { ...getActiveScreen().resolution };
  const screen = key === 'blank'
    ? { id: generateId('screen'), name: 'New Screen', resolution: res, notes: '', bgImage: null, bgOpacity: 0.35, elements: [] }
    : createTemplateScreen(key, res);
  screen.name = uniqueScreenName(screen.name);
  const next = structuredClone(doc);
  next.screens.push(screen);
  next.activeScreen = screen.id;
  selectedId = null;
  commit(next, `Added screen "${screen.name}". Double-click its tab to rename it.`);
}

function insertTemplate(key) {
  const templateScreen = createTemplateScreen(key, getActiveScreen().resolution);
  const next = structuredClone(doc);
  const screen = next.screens.find(s => s.id === doc.activeScreen);
  for (const el of templateScreen.elements) screen.elements.push(el);
  selectedId = null;
  commit(next, `Inserted the ${TEMPLATES.find(t => t.id === key)?.label || key} template into ${screen.name}.`);
}

function duplicateScreen(screenId) {
  const source = findScreen(doc, screenId);
  if (!source) return;
  const copy = structuredClone(source);
  const map = new Map();
  for (const { node } of flattenNodes(copy.elements)) {
    const id = generateId(node.type);
    map.set(node.id, id);
    node.id = id;
  }
  copy.id = generateId('screen');
  copy.name = uniqueScreenName(`${source.name} copy`);
  if (copy.focus) {
    copy.focus.default = map.get(copy.focus.default) || null;
    copy.focus.order = (copy.focus.order || []).map(id => map.get(id)).filter(Boolean);
  }
  const next = structuredClone(doc);
  next.screens.splice(next.screens.findIndex(s => s.id === screenId) + 1, 0, copy);
  next.activeScreen = copy.id;
  selectedId = null;
  commit(next, `Duplicated ${source.name}.`);
}

function deleteScreen(screenId) {
  if (doc.screens.length <= 1) {
    setStatus('A document needs at least one screen.', true);
    return;
  }
  const screen = findScreen(doc, screenId);
  if (!confirm(`Delete screen "${screen.name}"? Links to it will show as missing targets.`)) return;
  const next = structuredClone(doc);
  const index = next.screens.findIndex(s => s.id === screenId);
  next.screens.splice(index, 1);
  next.activeScreen = next.screens[Math.max(0, index - 1)].id;
  selectedId = null;
  commit(next, `Deleted screen "${screen.name}".`);
}

// ================= Layers =================
function nodeIssues(nodeId, screenId = doc.activeScreen) {
  return issues.filter(i => i.nodeId === nodeId && i.screenId === screenId);
}

function renderTree() {
  const container = $('tree-container');
  container.innerHTML = '';
  const screen = getActiveScreen();
  if (!screen) return;
  $('layers-ctx').textContent = screen.name;

  const all = flattenNodes(screen.elements);
  const notes = all.filter(e => e.node.props.comment).length;
  $('layers-count').textContent = `${all.length} layer${all.length === 1 ? '' : 's'} · ${notes} note${notes === 1 ? '' : 's'}`;

  const filter = layerFilter.trim().toLowerCase();
  const matches = new Set();
  if (filter) {
    const walk = (nodes, trail) => {
      for (const n of nodes) {
        if (n.name.toLowerCase().includes(filter) || String(n.props.text || n.props.label || '').toLowerCase().includes(filter)) {
          matches.add(n.id);
          trail.forEach(id => matches.add(id));
        }
        if (n.children?.length) walk(n.children, [...trail, n.id]);
      }
    };
    walk(screen.elements, []);
  }

  const def = defaultFocusId(screen);

  function renderNodes(nodes, depth = 0) {
    for (const node of nodes) {
      if (filter && !matches.has(node.id)) continue;
      const hasKids = node.children && node.children.length > 0;
      const isCollapsed = !filter && collapsed.has(node.id);
      const visible = node.props.visible !== false;
      const locked = !!node.props.locked;
      const mine = nodeIssues(node.id);
      const anchor = ANCHORS.find(a => a.id === node.anchor);

      const row = document.createElement('div');
      row.className = `row${node.id === selectedId ? ' sel' : ''}${visible ? '' : ' hid'}${isCollapsed ? ' collapsed' : ''}`;
      row.dataset.id = node.id;
      row.style.setProperty('--d', depth);
      row.draggable = true;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(node.id === selectedId));
      if (hasKids) row.setAttribute('aria-expanded', String(!isCollapsed));

      const marks = [];
      if (node.props.comment) marks.push(`<svg class="ic sm mark" aria-label="Has intent note"><title>${escapeHtml(node.props.comment)}</title><use href="#i-note"/></svg>`);
      if (node.nav?.onConfirm) marks.push(`<svg class="ic sm mark link" aria-label="Opens a screen"><title>Opens ${escapeHtml(targetName(node.nav.onConfirm))}</title><use href="#i-link"/></svg>`);
      if (node.id === def) marks.push('<svg class="ic sm mark" aria-label="Default focus"><title>Default focus</title><use href="#i-star"/></svg>');
      const tag = anchor?.stretchX || anchor?.stretchY ? '<span class="tag">stretch</span>' : '';
      const dot = mine.length ? `<span class="issue-dot${mine.some(i => i.severity === 'error') ? ' err' : ''}" title="${escapeHtml(mine.map(i => i.message).join('\n'))}"></span>` : '';

      row.innerHTML = `
        <span class="tw">${hasKids ? '<svg class="ic xs"><use href="#i-chev-d"/></svg>' : ''}</span>
        <svg class="ic sm ty"><use href="#i-${node.type}"/></svg>
        <span class="nm">${escapeHtml(node.name)}</span>
        ${marks.join('')}${tag}${dot}
        <span class="acts">
          <button data-act="vis" class="${visible ? '' : 'pinned'}" title="${visible ? 'Hide' : 'Show'}"><svg class="ic sm"><use href="#i-${visible ? 'eye' : 'eye-off'}"/></svg></button>
          <button data-act="lock" class="${locked ? 'pinned' : ''}" title="${locked ? 'Unlock' : 'Lock'}"><svg class="ic sm"><use href="#i-${locked ? 'lock' : 'unlock'}"/></svg></button>
        </span>`;
      if (!visible || locked) row.querySelector('.acts').style.display = 'flex';

      row.onclick = e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'vis') { toggleProperty(node.id, 'visible', !visible); return; }
        if (act === 'lock') { toggleProperty(node.id, 'locked', !locked); return; }
        if (e.target.closest('.tw') && hasKids) {
          if (collapsed.has(node.id)) collapsed.delete(node.id); else collapsed.add(node.id);
          renderTree();
          return;
        }
        selectNode(node.id);
      };
      row.querySelector('.nm').ondblclick = e => { e.stopPropagation(); startRenameNode(node.id, row); };
      row.ondragstart = e => {
        e.dataTransfer.setData('text/plain', node.id);
        e.dataTransfer.effectAllowed = 'move';
      };
      row.ondragover = e => {
        e.preventDefault();
        e.stopPropagation();
        const rect = row.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        row.classList.remove('drop-before', 'drop-after', 'drop-inside');
        const container = ['panel', 'group'].includes(node.type);
        if (relY < 0.3 || (!container && relY < 0.5)) row.classList.add('drop-before');
        else if (relY > 0.7 || !container) row.classList.add('drop-after');
        else row.classList.add('drop-inside');
      };
      row.ondragleave = () => row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      row.ondrop = e => {
        e.preventDefault();
        e.stopPropagation();
        $('tree-container').classList.remove('drop-root');
        const srcId = e.dataTransfer.getData('text/plain');
        let dropMode = 'after';
        if (row.classList.contains('drop-before')) dropMode = 'before';
        else if (row.classList.contains('drop-inside')) dropMode = 'inside';
        row.classList.remove('drop-before', 'drop-after', 'drop-inside');
        if (!srcId || srcId === node.id) return;
        try {
          const next = reorderNode(doc, srcId, node.id, dropMode);
          if (dropMode === 'inside') collapsed.delete(node.id);
          commit(next, dropMode === 'inside' ? `Moved into ${node.name}.` : 'Reordered layers.');
        } catch (err) {
          setStatus(err.message, true);
        }
      };

      container.appendChild(row);
      if (hasKids && !isCollapsed) renderNodes(node.children, depth + 1);
    }
  }

  renderNodes(screen.elements);
  if (!container.children.length) {
    container.innerHTML = filter
      ? '<div class="tree-empty">No layer matches this filter.</div>'
      : '<div class="tree-empty">This screen is empty.<br>Pick a widget tool on the left (P, B, T…) and click on the canvas, or insert a template.</div>';
  }
  const sel = revealPending && container.querySelector('.row.sel');
  revealPending = false;
  if (sel) {
    const box = container.getBoundingClientRect();
    const row = sel.getBoundingClientRect();
    if (row.top < box.top) container.scrollTop -= box.top - row.top + 6;
    else if (row.bottom > box.bottom) container.scrollTop += row.bottom - box.bottom + 6;
  }
}

function startRenameNode(nodeId, row) {
  const found = findNode(doc, nodeId);
  if (!found) return;
  const holder = row.querySelector('.nm');
  const input = document.createElement('input');
  input.value = found.node.name;
  input.setAttribute('aria-label', 'Layer name');
  holder.innerHTML = '';
  holder.appendChild(input);
  row.draggable = false;
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== found.node.name) {
      const snapshot = JSON.stringify(doc);
      findNode(doc, nodeId).node.name = name;
      commitFromSnapshot(snapshot, `Renamed to ${name}.`);
    } else {
      renderTree();
    }
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  };
  input.onblur = () => finish(true);
  input.onclick = e => e.stopPropagation();
}

function revealInTree(nodeId) {
  const found = findNode(doc, nodeId);
  if (!found) return;
  const screen = found.screen;
  const parents = [];
  const walk = (nodes, trail) => {
    for (const n of nodes) {
      if (n.id === nodeId) { parents.push(...trail); return true; }
      if (n.children?.length && walk(n.children, [...trail, n.id])) return true;
    }
    return false;
  };
  walk(screen.elements, []);
  parents.forEach(id => collapsed.delete(id));
}

// ================= Inspector =================
function scheduleInspector() {
  if (inspectorFrame) return;
  inspectorFrame = requestAnimationFrame(() => {
    inspectorFrame = 0;
    renderInspector();
  });
}

function renderInspector() {
  if (inspectorFrame) {
    cancelAnimationFrame(inspectorFrame);
    inspectorFrame = 0;
  }
  const container = $('inspector-content');
  const panel = $('inspector');
  const active = document.activeElement;
  const focusId = active && container.contains(active) ? active.id : null;
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = panel.scrollTop;

  const found = selectedId ? findNode(doc, selectedId) : null;
  if (selectedId && !found) selectedId = null;
  container.innerHTML = found ? elementInspector(found) : screenInspector(getActiveScreen());
  updateKitHint();

  panel.scrollTop = scroll;
  if (focusId) {
    const el = $(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      try { if (selection) el.setSelectionRange(selection[0], selection[1]); } catch (e) {}
    }
  }
}

// Field builders. Inputs carry data-path (and data-scope="screen" for screen fields).
const fid = (path, suffix = '') => `f-${path.replace(/[^a-z0-9]+/gi, '-')}${suffix}`;

function sec(id, title, body, { open = false, meta = '', icon = '' } = {}) {
  const isOpen = prefs.sections[id] ?? open;
  return `<section class="sec${isOpen ? '' : ' closed'}" data-sec="${id}">
    <button class="sec-head" data-action="toggle-sec" data-sec="${id}" aria-expanded="${isOpen}">
      <svg class="ic xs chev"><use href="#i-chev-d"/></svg>${icon}<span>${title}</span>${meta ? `<em>${meta}</em>` : ''}
    </button>
    <div class="sec-body">${body}</div>
  </section>`;
}

function numField(label, path, value, attrs = '', scope = '') {
  return `<label class="fld" title="${label}"><i>${label}</i><input type="number" id="${fid(path)}" data-path="${path}" ${scope} value="${value ?? ''}" ${attrs}></label>`;
}

function textField(path, value, placeholder = '', scope = '', label = '') {
  return `<label class="fld txt">${label ? `<i>${label}</i>` : ''}<input type="text" id="${fid(path)}" data-path="${path}" ${scope} value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" spellcheck="false"></label>`;
}

function colorField(label, path, value, fallback, { inherit = false } = {}) {
  const shown = value || fallback || '#000000';
  return `<label class="fld${inherit && !value ? ' inherit' : ''}" title="${label}">
    <i>${label}</i>
    <input type="color" id="${fid(path, '-c')}" data-path="${path}" data-live value="${toHex(shown)}" list="kit-colors">
    <input type="text" id="${fid(path, '-t')}" data-path="${path}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(fallback || '')}" spellcheck="false">
  </label>`;
}

// The game's fonts from the kit, then the system font.
function fontField(value) {
  const options = [['', 'System font'], ...(kit?.fonts || []).map(f => [f.name, f.name])];
  if (value && !options.some(([v]) => v === value)) options.push([value, `${value} (not in the kit)`]);
  return options.length > 1 ? selectField('Font', 'props.fontFamily', options, value || '') : '';
}

function selectField(label, path, options, value, scope = '') {
  return `<label class="fld" title="${label}">${label ? `<i>${label}</i>` : ''}<select id="${fid(path)}" data-path="${path}" ${scope}>${options.map(([v, l]) => `<option value="${escapeHtml(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>`;
}

function segField(path, options, value) {
  return `<div class="seg">${options.map(([v, l]) => `<button data-action="set" data-path="${path}" data-value="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function checkField(label, path, checked, hint = '', scope = '') {
  return `<label class="check-row"><input type="checkbox" id="${fid(path)}" data-path="${path}" ${scope} ${checked ? 'checked' : ''}>${label}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function issuesBlock(list) {
  if (!list.length) return '';
  return `<div class="sec-body" style="padding-top: 10px"><div class="mini-issues">${list.map(i => `
    <div class="mini-issue${i.severity === 'error' ? ' err' : ''}">
      <svg class="ic sm"><use href="#i-${i.severity === 'error' ? 'error' : 'warn'}"/></svg>
      <span>${escapeHtml(i.message)}</span>
      ${i.fix ? `<button class="fix" data-action="fix" data-key="${escapeHtml(i.key)}" title="Apply the safe fix (undoable)">${escapeHtml(i.fix.label)}</button>` : ''}
    </div>`).join('')}</div></div>`;
}

function targetName(id) {
  if (id === BACK_PREVIOUS) return 'previous screen';
  return findScreen(doc, id)?.name || 'missing screen';
}

function roleLabel(role) {
  return SCREEN_ROLES.find(r => r.id === role)?.label || 'Submenu';
}

function anchorGrid(active) {
  const cells = [
    ['top-left', 25, 25], ['top-center', 50, 25], ['top-right', 75, 25], ['top-stretch', 50, 25, 's'],
    ['center-left', 25, 50], ['center', 50, 50], ['center-right', 75, 50], ['horizontal-stretch', 50, 50, 's'],
    ['bottom-left', 25, 75], ['bottom-center', 50, 75], ['bottom-right', 75, 75], ['bottom-stretch', 50, 75, 's'],
    ['left-stretch', 25, 50, 'sv'], ['vertical-stretch', 50, 50, 'sv'], ['right-stretch', 75, 50, 'sv'], ['full-stretch', 50, 50, 'sf']
  ];
  return cells.map(([id, x, y, kind = '']) => {
    const label = ANCHORS.find(a => a.id === id)?.label || id;
    return `<button class="${kind}${id === active ? ' on' : ''}" style="--x: ${x}%; --y: ${y}%" data-action="anchor" data-anchor="${id}" title="${label}" aria-label="Anchor ${label}" aria-pressed="${id === active}"></button>`;
  }).join('');
}

function anchorInfo(anchor) {
  if (!anchor) return '';
  if (anchor.stretchX && anchor.stretchY) return 'Fills the parent.<br>Margins on all four sides.';
  if (anchor.stretchX) return 'Stretches across the parent.<br>Left / Right are margins.';
  if (anchor.stretchY) return 'Stretches top to bottom.<br>Top / Bottom are margins.';
  return `Pivot ${anchor.originX}, ${anchor.originY}.<br>X / Y offset from that point.`;
}

function elementInspector(found) {
  const { node, parent, screen } = found;
  const p = node.props;
  const t = node.type;
  const visible = p.visible !== false;
  const locked = !!p.locked;
  const anchor = ANCHORS.find(a => a.id === node.anchor);
  const parentName = parent ? parent.name : 'Screen';
  const role = screenRole(screen);
  const notesCount = flattenNodes(screen.elements).filter(e => e.node.props.comment).length;

  const head = `<div class="ihead">
    <div class="l1">
      <input class="name" id="prop-name" data-path="name" value="${escapeHtml(node.name)}" aria-label="Name" spellcheck="false">
      <span class="type-badge">${t}</span>
      <button class="btn icon sm" data-action="toggle-prop" data-prop="visible" title="${visible ? 'Hide' : 'Show'}"><svg class="ic sm"><use href="#i-${visible ? 'eye' : 'eye-off'}"/></svg></button>
      <button class="btn icon sm${locked ? ' on' : ''}" data-action="toggle-prop" data-prop="locked" title="${locked ? 'Unlock' : 'Lock (keeps it from moving on the canvas)'}"><svg class="ic sm"><use href="#i-${locked ? 'lock' : 'unlock'}"/></svg></button>
      <button class="btn icon sm" data-action="node-menu" title="Duplicate or delete" aria-haspopup="menu"><svg class="ic sm"><use href="#i-more"/></svg></button>
    </div>
    <div class="path">in <b>${escapeHtml(parentName)}</b> · ${escapeHtml(screen.name)}</div>
  </div>`;

  // Layout
  const sx = anchor?.stretchX, sy = anchor?.stretchY;
  const layout = `
    <div class="anchor">
      <div class="agrid" role="group" aria-label="Anchor presets">${anchorGrid(node.anchor)}</div>
      <div class="ainfo"><b>${escapeHtml(anchor?.label || node.anchor)}</b>${anchorInfo(anchor)}</div>
    </div>
    <div class="f2">
      ${numField(sx ? 'Left' : 'X', 'rect.x', node.rect.x)}
      ${numField(sy ? 'Top' : 'Y', 'rect.y', node.rect.y)}
      ${numField(sx ? 'Right' : 'W', 'rect.w', node.rect.w, sx ? '' : 'min="1"')}
      ${numField(sy ? 'Bottom' : 'H', 'rect.h', node.rect.h, sy ? '' : 'min="1"')}
    </div>`;

  // Content (type specific)
  let content = '';
  if (t === 'button' || t === 'label') {
    content = `
      ${textField('props.text', p.text, 'Label text')}
      <div class="f2">
        ${numField('Size', 'props.fontSize', p.fontSize ?? (t === 'label' ? 18 : 16), 'min="6"')}
        ${selectField('', 'props.fontWeight', WEIGHTS, p.fontWeight || 'normal')}
      </div>
      ${fontField(p.fontFamily)}
      <div class="f2">
        ${colorField('Text', 'props.fontColor', p.fontColor, t === 'label' ? '#f8fafc' : '#ffffff')}
        ${segField('props.textAlign', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], p.textAlign || (t === 'button' ? 'center' : 'left'))}
      </div>`;
  } else if (t === 'slider') {
    content = `
      ${textField('props.label', p.label, 'Label', '', 'Label')}
      <div class="f3">
        ${numField('Val', 'props.value', p.value ?? 50)}
        ${numField('Min', 'props.min', p.min ?? 0)}
        ${numField('Max', 'props.max', p.max ?? 100)}
      </div>
      <div class="f2">
        ${colorField('Fill', 'props.fillColor', p.fillColor, '#10b981')}
        ${colorField('Track', 'props.trackColor', p.trackColor, '#1e293b')}
      </div>
      ${checkField('Show the value as a number', 'props.showValue', p.showValue !== false, '85 / 100')}`;
  } else if (t === 'checkbox') {
    content = `
      ${textField('props.label', p.label, 'Label', '', 'Label')}
      ${checkField('Checked', 'props.checked', !!p.checked)}
      <div class="f2">
        ${colorField('Check', 'props.checkColor', p.checkColor, '#38bdf8')}
        ${colorField('Text', 'props.fontColor', p.fontColor, '#f8fafc')}
      </div>
      ${fontField(p.fontFamily)}`;
  } else if (t === 'input') {
    content = `
      ${textField('props.placeholder', p.placeholder, 'Placeholder', '', 'Hint')}
      ${textField('props.value', p.value, 'Value', '', 'Value')}
      <div class="f2">
        ${numField('Size', 'props.fontSize', p.fontSize ?? 15, 'min="6"')}
        ${colorField('Text', 'props.fontColor', p.fontColor, '#ffffff')}
      </div>
      ${fontField(p.fontFamily)}`;
  } else if (t === 'image') {
    content = `${textField('props.src', p.src, 'assets/ui/icon.png', '', 'Src')}
      <div class="f2">
        ${selectField('', 'props.fit', [['contain', 'Contain'], ['cover', 'Cover'], ['fill', 'Stretch']], p.fit || 'contain')}
        <button class="btn box sm" data-action="pick-kit" data-cat="icon" title="Pick an image from the game kit">From the kit</button>
      </div>`;
  }

  // Appearance
  const opacity = Math.round((p.opacity ?? 1) * 100);
  let appearance = '';
  if (['panel', 'button', 'input'].includes(t)) {
    appearance += `
      <div class="f2">
        ${colorField('Fill', 'props.bgColor', p.bgColor, '#1e293b')}
        ${colorField('Border', 'props.borderColor', p.borderColor, '#334155')}
      </div>
      <div class="f2">
        ${numField('Border', 'props.borderWidth', p.borderWidth ?? 1, 'min="0"')}
        ${numField('Radius', 'props.borderRadius', p.borderRadius ?? 6, 'min="0"')}
      </div>
      <div class="cap"><span>Skin image</span>${p.skin ? '<button data-action="clear-skin">Clear</button>' : ''}</div>
      ${textField('props.skin', p.skin, 'Drawn instead of fill and border', '', 'Image')}
      <div class="f2">
        ${textField('props.skinSlice', (p.skinSlice || []).join(', '), 'L, T, R, B', '', '9-slice')}
        <button class="btn box sm" data-action="pick-kit" data-cat="${t === 'panel' ? 'panel' : 'button'}" title="Pick a skin from the game kit">From the kit</button>
      </div>`;
  }
  appearance += `<label class="fld" title="Opacity"><i>Opacity</i><input type="range" id="f-opacity" data-path="props.opacity" data-live data-scale="0.01" min="0" max="100" step="5" value="${opacity}"><span class="unit" id="opacity-out">${opacity}%</span></label>`;

  // States
  let states = '';
  if (t === 'button' || t === 'input') {
    const chips = STATES.map(st => {
      const s = stateStyle({ ...p, bgColor: p.bgColor || '#2563eb', borderColor: p.borderColor || '#38bdf8' }, st);
      const missing = st !== 'normal' && !p.states?.[st];
      const style = `background: ${s.bgColor}; border-color: ${s.borderColor};${st === 'focused' ? ` box-shadow: 0 0 0 2px ${s.ring};` : ''}${st === 'disabled' ? ` opacity: ${s.opacity};` : ''}${st === 'pressed' ? ' transform: translateY(1px);' : ''}`;
      return `<button class="st-chip${st === previewState ? ' on' : ''}${missing ? ' missing' : ''}" data-action="edit-state" data-state="${st}" title="${capitalize(st)}${missing ? ' (not defined yet)' : ''}"><i style="${style}"></i>${capitalize(st)}</button>`;
    }).join('');
    let detail = '';
    const st = previewState;
    if (st === 'normal') {
      detail = '<div class="hint">Normal uses the Appearance colours. Pick a state to edit it; the canvas previews the state you pick.</div>';
    } else if (!p.states?.[st]) {
      detail = `<button class="btn box sm" data-action="add-state" data-state="${st}"><svg class="ic sm"><use href="#i-plus"/></svg>Add a ${capitalize(st)} state</button>`;
    } else {
      const base = `props.states.${st}`;
      const s = p.states[st];
      detail = `
        <div class="cap"><span>${capitalize(st)} overrides</span><button data-action="reset-state" data-state="${st}">Reset</button></div>
        <div class="f2">
          ${colorField('Fill', `${base}.bgColor`, s.bgColor, p.bgColor, { inherit: true })}
          ${colorField('Border', `${base}.borderColor`, s.borderColor, p.borderColor, { inherit: true })}
        </div>
        ${p.skin || s.skin ? textField(`${base}.skin`, s.skin, p.skin || '', '', 'Skin') : ''}
        <div class="f2">
          ${colorField('Text', `${base}.fontColor`, s.fontColor, p.fontColor || '#ffffff', { inherit: true })}
          ${st === 'focused' ? colorField('Ring', `${base}.ringColor`, s.ringColor, '#f0a0b0', { inherit: true }) : ''}
          ${st === 'disabled' ? numField('Opacity', `${base}.opacity`, Math.round((s.opacity ?? 0.5) * 100), 'data-scale="0.01" min="0" max="100" step="5"') : ''}
        </div>`;
    }
    const defined = STATES.filter(k => k === 'normal' || p.states?.[k]).length;
    states = sec('states', 'States', `<div class="states">${chips}</div>${detail}`, { meta: `${defined} of 5` });
  }

  // Navigation & focus
  let nav = '';
  if (isInteractive(node, role)) {
    const order = focusOrder(screen);
    const pos = order.indexOf(node.id);
    const isDefault = defaultFocusId(screen) === node.id;
    const targets = [['', 'Nothing (handled in code)'], [BACK_PREVIOUS, 'Back: close this screen'], ...doc.screens.filter(s => s.id !== screen.id).map(s => [s.id, s.name])];
    if (node.nav?.onConfirm && !targets.some(([v]) => v === node.nav.onConfirm)) targets.push([node.nav.onConfirm, 'Missing screen']);
    nav = sec(mode === 'flow' ? 'nav-flow' : 'nav', 'Navigation & focus', `
      <div class="cap"><span>On confirm opens</span></div>
      ${selectField('', 'nav.onConfirm', targets, node.nav?.onConfirm || '')}
      <label class="check-row"><input type="checkbox" id="f-default-focus" data-action="default-focus" ${isDefault ? 'checked' : ''}>Default focus when the screen opens</label>
      ${pos >= 0 ? `<div class="focus-item"><span class="n">${pos + 1}</span><span class="nm">Focus order: ${pos + 1} of ${order.length}</span>
        <button data-action="focus-move" data-id="${node.id}" data-dir="-1" title="Earlier" ${pos === 0 ? 'disabled' : ''}><svg class="ic sm"><use href="#i-chev-u"/></svg></button>
        <button data-action="focus-move" data-id="${node.id}" data-dir="1" title="Later" ${pos === order.length - 1 ? 'disabled' : ''}><svg class="ic sm"><use href="#i-chev-d"/></svg></button></div>` : '<div class="hint">Hidden elements are left out of the focus order.</div>'}
      <div class="hint">Preview <b>Focused</b> to see the focus ring and the order on the canvas.</div>`,
      { open: mode === 'flow', meta: node.nav?.onConfirm ? `→ ${escapeHtml(targetName(node.nav.onConfirm))}` : '' });
  }

  // Intent
  const pin = p.comment ? pinNumber(node.id, screen) : 0;
  const intent = sec('intent', 'Intent for agent', `
    <textarea class="area note-area" id="f-comment" data-path="props.comment" rows="3" placeholder="Behaviour, signals, transitions or logic for this element…">${escapeHtml(p.comment || '')}</textarea>
    <div class="note-meta"><span><b>Included in handoff</b> · ${notesCount} note${notesCount === 1 ? '' : 's'} on this screen</span></div>`,
    { open: true, meta: pin ? `pin ${pin}` : '', icon: '<svg class="ic sm note-ic"><use href="#i-note"/></svg>' });

  // Advanced
  let advanced = `
    ${checkField('Locked', 'props.locked', locked, 'cannot move on the canvas')}
    ${checkField('Visible', 'props.visible', visible)}`;
  if (t === 'panel') advanced += `<div class="f2">${numField('Padding', 'props.padding', p.padding ?? 12, 'min="0"')}</div>`;
  if (t === 'image') {
    const c = p.crop || {};
    advanced += `
      <div class="cap"><span>Spritesheet crop</span>${p.crop ? '<button data-action="clear-crop">Clear</button>' : ''}</div>
      <div class="f2">
        ${numField('X', 'props.crop.x', c.x ?? '', 'min="0"')}
        ${numField('Y', 'props.crop.y', c.y ?? '', 'min="0"')}
        ${numField('W', 'props.crop.w', c.w ?? '', 'min="0"')}
        ${numField('H', 'props.crop.h', c.h ?? '', 'min="0"')}
      </div>`;
  }
  advanced += `<div class="hint">ID <code>${escapeHtml(node.id)}</code></div>`;

  return head
    + issuesBlock(nodeIssues(node.id, screen.id))
    + sec('layout', 'Layout', layout, { open: true, meta: `relative to ${escapeHtml(parentName)}` })
    + (content ? sec('content', t === 'button' || t === 'label' ? 'Text' : 'Content', content, { open: true }) : '')
    + sec('appearance', 'Appearance', appearance, { meta: opacity < 100 ? `${opacity}%` : '' })
    + states
    + nav
    + intent
    + sec('advanced', 'Advanced', advanced, { meta: [locked && 'locked', !visible && 'hidden'].filter(Boolean).join(' · ') || 'lock · crop · id' });
}

function screenInspector(screen) {
  const role = screenRole(screen);
  const scope = 'data-scope="screen"';
  const count = flattenNodes(screen.elements).length;
  const order = focusOrder(screen);
  const def = defaultFocusId(screen);
  const byId = new Map(flattenNodes(screen.elements).map(e => [e.node.id, e.node]));

  const head = `<div class="ihead">
    <div class="l1">
      <input class="name" id="screen-name" data-path="name" ${scope} value="${escapeHtml(screen.name)}" aria-label="Screen name" spellcheck="false">
      <span class="type-badge">screen</span>
      <button class="btn icon sm" data-action="screen-menu" title="Duplicate or delete this screen" aria-haspopup="menu"><svg class="ic sm"><use href="#i-more"/></svg></button>
    </div>
    <div class="path"><b>${screen.resolution.width} × ${screen.resolution.height}</b> · ${count} element${count === 1 ? '' : 's'} · ${escapeHtml(roleLabel(role))}</div>
  </div>`;

  const roles = [['', `Auto (${roleLabel(screenRole({ name: screen.name, id: screen.id }))})`], ...SCREEN_ROLES.map(r => [r.id, r.label])];
  const general = `
    ${selectField('Type', 'role', roles, screen.role || '', scope)}
    <div class="hint">${escapeHtml(SCREEN_ROLES.find(r => r.id === role)?.hint || '')} The type decides which checks apply.</div>
    <div class="cap"><span>Screen notes</span></div>
    <textarea class="area" id="screen-notes" data-path="notes" ${scope} rows="3" placeholder="What this screen is for, when it opens, what pauses…">${escapeHtml(screen.notes || '')}</textarea>`;

  const backTargets = [['', 'Not handled'], [BACK_PREVIOUS, 'Return to the previous screen'], ...doc.screens.filter(s => s.id !== screen.id).map(s => [s.id, `Open ${s.name}`])];
  if (screen.nav?.onBack && !backTargets.some(([v]) => v === screen.nav.onBack)) backTargets.push([screen.nav.onBack, 'Missing screen']);
  const focusItems = order.map((id, i) => {
    const n = byId.get(id);
    return `<div class="focus-item${id === def ? ' def' : ''}">
      <span class="n">${i + 1}</span><span class="nm" title="${escapeHtml(n.name)}">${escapeHtml(n.props.text || n.props.label || n.name)}</span>
      <button class="${id === def ? 'on' : ''}" data-action="set-default" data-id="${id}" title="${id === def ? 'Default focus' : 'Make default focus'}"><svg class="ic sm"><use href="#i-star"/></svg></button>
      <button data-action="focus-move" data-id="${id}" data-dir="-1" title="Earlier" ${i === 0 ? 'disabled' : ''}><svg class="ic sm"><use href="#i-chev-u"/></svg></button>
      <button data-action="focus-move" data-id="${id}" data-dir="1" title="Later" ${i === order.length - 1 ? 'disabled' : ''}><svg class="ic sm"><use href="#i-chev-d"/></svg></button>
    </div>`;
  }).join('');
  const buttons = flattenNodes(screen.elements).map(e => e.node).filter(n => n.type === 'button' && n.props.visible !== false);
  const linkTargets = [['', '—'], [BACK_PREVIOUS, 'Back (close)'], ...doc.screens.filter(s => s.id !== screen.id).map(s => [s.id, s.name])];
  const links = buttons.map(n => `<label class="fld" title="${escapeHtml(n.name)}"><i>${escapeHtml((n.props.text || n.name).slice(0, 16))}</i><select data-action="link" data-id="${n.id}" aria-label="${escapeHtml(n.name)} opens">${linkTargets.map(([v, l]) => `<option value="${escapeHtml(v)}"${(n.nav?.onConfirm || '') === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}${n.nav?.onConfirm && !linkTargets.some(([v]) => v === n.nav.onConfirm) ? '<option selected>Missing screen</option>' : ''}</select></label>`).join('');
  const navigation = `
    <div class="cap"><span>Esc / B (gamepad)</span></div>
    ${selectField('', 'nav.onBack', backTargets, screen.nav?.onBack || '', scope)}
    <div class="cap"><span>Focus order</span><span>★ default</span></div>
    ${order.length ? `<div class="focus-list">${focusItems}</div>` : '<div class="hint">No interactive elements yet.</div>'}
    ${buttons.length ? `<div class="cap"><span>Buttons open</span></div>${links}` : ''}`;

  const overlay = screen.bgImage
    ? `<div class="f2">
        <button class="btn box sm" data-action="bg-upload"><svg class="ic sm"><use href="#i-upload"/></svg>Replace</button>
        <button class="btn box sm" data-action="bg-remove"><svg class="ic sm"><use href="#i-trash"/></svg>Remove</button>
      </div>
      <label class="fld" title="Overlay opacity"><i>Opacity</i><input type="range" id="screen-bg-opacity" data-path="bgOpacity" ${scope} data-live min="0" max="1" step="0.05" value="${screen.bgOpacity ?? 0.35}"></label>`
    : `<button class="btn box sm" data-action="bg-upload"><svg class="ic sm"><use href="#i-upload"/></svg>Upload a game screenshot</button>
      <div class="hint">Trace HUD elements over real gameplay. The image stays in your local draft and the exported file.</div>`;

  const screenIssues = issues.filter(i => i.screenId === screen.id && !i.nodeId);

  return head
    + issuesBlock(screenIssues)
    + sec('screen', 'Screen', general, { open: true })
    + sec(mode === 'flow' ? 'screen-nav-flow' : 'screen-nav', 'Navigation & focus', navigation, {
      open: mode === 'flow',
      meta: screen.nav?.onBack ? `Esc → ${escapeHtml(targetName(screen.nav.onBack))}` : 'Esc not set'
    })
    + sec('overlay', 'Reference overlay', overlay, { meta: screen.bgImage ? 'image loaded' : '' })
    + `<div class="empty-state">
        <div class="hint">Select an element on the canvas or in Layers to edit it.</div>
        <div class="keys">
          <kbd>P B T S I N C G</kbd><span>Pick a widget, then click or drag on the canvas</span>
          <kbd>V</kbd><span>Select and move</span>
          <kbd>Ctrl Z</kbd><span>Undo</span>
          <kbd>Ctrl K</kbd><span>Ask Copilot</span>
        </div>
      </div>`;
}

function inspectedTarget(scope) {
  if (scope === 'screen') return getActiveScreen();
  return selectedId ? findNode(doc, selectedId)?.node : null;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === undefined || value === null || value === '') delete cur[last];
  else cur[last] = value;
  // Drop optional containers left empty (nav, focus, crop, state overrides stay explicit).
  if (keys.length === 2 && ['nav'].includes(keys[0]) && obj[keys[0]] && !Object.keys(obj[keys[0]]).length) delete obj[keys[0]];
}

function readField(el) {
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number' || el.type === 'range') {
    value = value === '' ? null : Number(value);
    if (value !== null && el.dataset.scale) value = Math.round(value * Number(el.dataset.scale) * 1000) / 1000;
  }
  return value;
}

function applyField(el, live = false) {
  const path = el.dataset.path;
  const scope = el.dataset.scope || 'node';
  const target = inspectedTarget(scope);
  if (!target || !path) return;
  let value = readField(el);
  if (path === 'name' && !String(value).trim()) { el.value = target.name; return; }
  if (path.startsWith('rect.') && value === null) value = 0;
  if (path.startsWith('props.crop.') && value === null) value = undefined;
  if (path === 'props.skinSlice') {
    const parts = String(value || '').split(/[\s,;]+/).filter(Boolean).map(Number);
    if (parts.length === 1 && Number.isFinite(parts[0]) && parts[0] >= 0) value = [parts[0], parts[0], parts[0], parts[0]];
    else if (parts.length === 4 && parts.every(n => Number.isFinite(n) && n >= 0)) value = parts;
    else if (!parts.length) value = null;
    else { setStatus('9-slice takes one number or four (left, top, right, bottom).', true); scheduleInspector(); return; }
  }

  if (live) {
    if (!liveSnapshot) liveSnapshot = JSON.stringify(doc);
    setPath(target, path, value);
    if (el.id === 'f-opacity') $('opacity-out').textContent = `${el.value}%`;
    drawCanvas();
    return;
  }
  const snapshot = liveSnapshot || JSON.stringify(doc);
  liveSnapshot = null;
  setPath(target, path, value);
  if (path.startsWith('props.crop.') && target.props?.crop && !Object.keys(target.props.crop).length) target.props.crop = null;
  commitFromSnapshot(snapshot, path === 'name' ? `Renamed to ${value}.` : 'Property updated.');
}

function handleInspectorAction(btn) {
  const action = btn.dataset.action;
  const screen = getActiveScreen();
  const found = selectedId ? findNode(doc, selectedId) : null;

  if (action === 'pick-kit') {
    setSideTab('kit', btn.dataset.cat);
    return;
  }
  if (action === 'clear-skin' && found) {
    const next = structuredClone(doc);
    const node = findNode(next, found.node.id).node;
    delete node.props.skin;
    delete node.props.skinSlice;
    for (const st of Object.values(node.props.states || {})) delete st.skin;
    commit(next, `Removed the skin of ${node.name}.`);
    return;
  }
  if (action === 'toggle-sec') {
    const sectionEl = btn.closest('.sec');
    const open = sectionEl.classList.toggle('closed') === false;
    btn.setAttribute('aria-expanded', String(open));
    prefs.sections[btn.dataset.sec] = open;
    savePrefs();
    return;
  }
  if (action === 'fix') return applyFix(btn.dataset.key);
  if (action === 'screen-menu') return openActionMenu(btn, [
    ['copy', 'Duplicate screen', () => duplicateScreen(screen.id)],
    ['trash', 'Delete screen…', () => deleteScreen(screen.id)]
  ]);
  if (action === 'bg-upload') return $('bg-file').click();
  if (action === 'bg-remove') {
    const next = structuredClone(doc);
    next.screens.find(s => s.id === screen.id).bgImage = null;
    return commit(next, 'Removed the reference overlay.');
  }
  if (action === 'set-default' || action === 'focus-move' || action === 'default-focus') {
    const next = structuredClone(doc);
    const s = next.screens.find(x => x.id === screen.id);
    s.focus = { default: s.focus?.default || null, order: focusOrder(s) };
    if (action === 'set-default') {
      s.focus.default = btn.dataset.id;
      return commit(next, 'Default focus set.');
    }
    if (action === 'default-focus') {
      s.focus.default = btn.checked ? selectedId : null;
      return commit(next, btn.checked ? 'Default focus set.' : 'Default focus cleared.');
    }
    const order = s.focus.order;
    const i = order.indexOf(btn.dataset.id);
    const j = i + Number(btn.dataset.dir);
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    return commit(next, 'Focus order changed.');
  }

  if (!found) return;
  const node = found.node;
  if (action === 'node-menu') return openActionMenu(btn, [
    ['copy', 'Duplicate  Ctrl+D', () => commit(duplicateNode(doc, node.id), `Duplicated ${node.name}.`)],
    ['trash', 'Delete  Del', () => deleteNode(node.id)]
  ]);
  if (action === 'toggle-prop') return toggleProperty(node.id, btn.dataset.prop, btn.dataset.prop === 'visible' ? node.props.visible === false : !node.props.locked);
  if (action === 'anchor') {
    const next = structuredClone(doc);
    const target = findNode(next, node.id).node;
    const parentBox = found.parent ? worldBoxes.get(found.parent.id)?.box || null : null;
    setAnchorKeepingBox(target, btn.dataset.anchor, parentBox, viewResolution());
    return commit(next, `Anchored ${ANCHORS.find(a => a.id === btn.dataset.anchor)?.label.toLowerCase()}; position kept.`);
  }
  if (action === 'set') {
    const snapshot = JSON.stringify(doc);
    setPath(node, btn.dataset.path, btn.dataset.value);
    return commitFromSnapshot(snapshot, 'Property updated.');
  }
  if (action === 'edit-state') return setPreviewState(btn.dataset.state);
  if (action === 'add-state' || action === 'reset-state') {
    const next = structuredClone(doc);
    const target = findNode(next, node.id).node;
    target.props.states = { ...(target.props.states || {}), [btn.dataset.state]: defaultStates(target.props)[btn.dataset.state] };
    return commit(next, `${capitalize(btn.dataset.state)} state ${action === 'add-state' ? 'added' : 'reset'}.`);
  }
  if (action === 'clear-crop') {
    const next = structuredClone(doc);
    findNode(next, node.id).node.props.crop = null;
    return commit(next, 'Crop cleared.');
  }
}

function syncRectFields(node) {
  for (const key of ['x', 'y', 'w', 'h']) {
    const el = $(fid(`rect.${key}`));
    if (el) el.value = node.rect[key];
  }
}

function setPreviewState(state) {
  previewState = STATES.includes(state) ? state : 'normal';
  updateTopBar();
  renderInspector();
  drawCanvas();
  if (previewState === 'focused') setStatus('Focused preview: the default (or selected) element shows its focus ring; numbers show the focus order.');
}

// ================= Canvas User Interaction =================
function initEventListeners() {
  const canvas = $('canvas');

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    canvas.focus({ preventScroll: true });
    closePopover();
    const pos = getCanvasPos(e);

    if (activeTool !== 'select') {
      placement = { start: pos, current: pos };
      drawCanvas();
      return;
    }

    const pin = pinAt(pos);
    if (pin) {
      prefs.sections.intent = true;
      selectNode(pin.id);
      setStatus(`Intent ${pin.n}: ${truncate(pin.comment, 140)}`);
      return;
    }

    const hit = hitTest(worldBoxes, pos.x, pos.y, selectedId, { handleSize: 10 / currentZoom });
    if (hit) {
      if (hit.node.id !== selectedId) selectNode(hit.node.id);
      dragOperation = {
        mode: hit.handle === 'body' ? 'move' : 'resize',
        handle: hit.handle,
        startX: pos.x,
        startY: pos.y,
        clientX: e.clientX,
        clientY: e.clientY,
        origWorldBox: { ...hit.box },
        parentBox: hit.parentBox,
        nodeId: hit.node.id,
        snapshot: JSON.stringify(doc),
        moved: false
      };
    } else if (selectedId) {
      selectNode(null);
    }
  });

  canvas.addEventListener('dblclick', e => {
    const pos = getCanvasPos(e);
    const hit = hitTest(worldBoxes, pos.x, pos.y, null);
    if (!hit) return;
    const path = ['button', 'label'].includes(hit.node.type) ? 'props.text' : ['slider', 'checkbox'].includes(hit.node.type) ? 'props.label' : null;
    if (!path) return;
    prefs.sections.content = true;
    renderInspector();
    $(fid(path))?.select();
  });

  window.addEventListener('mousemove', e => {
    if (isResizingChat) return;
    const pos = getCanvasPos(e);

    if (placement) {
      placement.current = pos;
      drawCanvas();
      return;
    }

    if (dragOperation) {
      if (!dragOperation.moved && Math.hypot(e.clientX - dragOperation.clientX, e.clientY - dragOperation.clientY) < 3) return;
      const found = findNode(doc, dragOperation.nodeId);
      if (!found) return;
      dragOperation.moved = true;
      const dx = pos.x - dragOperation.startX;
      const dy = pos.y - dragOperation.startY;
      const snap = gridSize || 1;
      const o = dragOperation.origWorldBox;
      const res = viewResolution();

      if (dragOperation.mode === 'move') {
        const targetWorldBox = {
          x: Math.round((o.x + dx) / snap) * snap,
          y: Math.round((o.y + dy) / snap) * snap,
          w: o.w,
          h: o.h
        };
        updateLocalFromWorld(found.node, targetWorldBox, dragOperation.parentBox, res);
      } else {
        const h = dragOperation.handle;
        const right = o.x + o.w, bottom = o.y + o.h;
        const wb = { ...o };
        if (h.includes('e')) wb.w = Math.max(10, Math.round((right + dx) / snap) * snap - o.x);
        if (h.includes('s')) wb.h = Math.max(10, Math.round((bottom + dy) / snap) * snap - o.y);
        if (h.includes('w')) {
          const nx = Math.min(right - 10, Math.round((o.x + dx) / snap) * snap);
          wb.x = nx;
          wb.w = right - nx;
        }
        if (h.includes('n')) {
          const ny = Math.min(bottom - 10, Math.round((o.y + dy) / snap) * snap);
          wb.y = ny;
          wb.h = bottom - ny;
        }
        updateLocalFromWorld(found.node, wb, dragOperation.parentBox, res);
      }
      drawCanvas();
      syncRectFields(found.node);
      return;
    }

    if (e.target !== canvas || mode !== 'screen') {
      if (hoveredId !== null) {
        hoveredId = null;
        drawCanvas();
      }
      return;
    }
    // Hover detection
    if (activeTool !== 'select') return;
    const pin = pinAt(pos);
    const tip = pin ? `Intent ${pin.n}: ${pin.comment}` : '';
    if (canvas.title !== tip) canvas.title = tip;
    const hit = pin ? null : hitTest(worldBoxes, pos.x, pos.y, selectedId, { handleSize: 10 / currentZoom });
    canvas.style.cursor = pin ? 'pointer' : hit ? (hit.cursor || 'pointer') : 'default';
    const next = hit ? hit.node.id : null;
    if (hoveredId !== next) {
      hoveredId = next;
      drawCanvas();
    }
  });

  window.addEventListener('mouseup', e => {
    if (placement) {
      const ghost = placementGhost();
      const point = placement.start;
      placement = null;
      const min = 6 / currentZoom;
      placeWidget(activeTool, ghost.w >= min && ghost.h >= min ? ghost : null, point);
      return;
    }
    if (dragOperation) {
      const op = dragOperation;
      dragOperation = null;
      // A click without a drag only selects; it never adds an undo step.
      if (!op.moved) return;
      const name = findNode(doc, op.nodeId)?.node.name || 'element';
      commitFromSnapshot(op.snapshot, op.mode === 'move' ? `Moved ${name}.` : `Resized ${name}.`);
    }
  });

  $('canvas-viewport').addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomStep(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  const resizeObserver = new ResizeObserver(() => drawStage());
  resizeObserver.observe($('canvas-viewport'));
  resizeObserver.observe($('flow-board'));

  // Keyboard Shortcuts
  window.addEventListener('keydown', handleKeydown);

  // Top Bar
  $('project-select').onchange = (e) => {
    const path = e.target.value;
    const name = e.target.options[e.target.selectedIndex].text;
    const next = structuredClone(doc);
    next.projectPath = path;
    next.projectName = name;
    commit(next, path ? `Connected to ${name}.` : 'No project connected.');
    copilot.onProjectChange();
    updateRemoveProjectButton();
  };
  $('btn-remove-project').onclick = () => removeProjectFromList();

  $('btn-file-menu').onclick = e => togglePopover($('file-menu'), e.currentTarget);
  $('file-menu').addEventListener('click', () => closePopover());
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;
  $('mode-screen').onclick = () => setMode('screen');
  $('mode-flow').onclick = () => setMode('flow');
  $('btn-checks').onclick = e => toggleChecks(e.currentTarget);
  $('btn-close-checks').onclick = () => closePopover();
  $('checks-scope').addEventListener('click', e => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    checksScope = b.dataset.scope;
    renderChecksList();
  });
  $('checks-list').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const item = issues.find(i => i.key === b.dataset.key);
    if (!item) return;
    if (b.dataset.action === 'locate') locateIssue(item);
    if (b.dataset.action === 'fix') applyFix(item.key);
  });
  $('btn-checks-ask').onclick = () => {
    closePopover();
    $('chip-validate-v2').click();
  };

  // Stage head
  $('btn-add-screen').onclick = e => openTemplateMenu('new', e.currentTarget);
  $('resolution-select').onchange = (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    const next = structuredClone(doc);
    const screen = next.screens.find(s => s.id === doc.activeScreen);
    if (screen) {
      screen.resolution = { width: w, height: h };
      aspectId = 'design';
      commit(next, `Design resolution set to ${w}×${h}.`);
    }
  };
  $('btn-flow-open').onclick = () => setMode('screen');
  $('preview-tag').addEventListener('click', e => {
    if (e.target.closest('[data-action="aspect-design"]')) setAspect('design');
  });

  // View toolbar
  $('btn-zoom-in').onclick = () => zoomStep(1);
  $('btn-zoom-out').onclick = () => zoomStep(-1);
  $('zoom-label').onclick = () => setZoom('fit');
  $('btn-grid').onclick = () => {
    gridSize = GRID_STEPS[(GRID_STEPS.indexOf(gridSize) + 1) % GRID_STEPS.length];
    savePrefs();
    updateTopBar();
    updateStatusBar();
    drawCanvas();
  };
  $('btn-safe').onclick = () => {
    showSafe = !showSafe;
    savePrefs();
    updateTopBar();
    drawCanvas();
  };
  $('btn-pins').onclick = () => {
    showPins = !showPins;
    savePrefs();
    updateTopBar();
    drawCanvas();
    setStatus(showPins ? 'Intent pins shown: click a pin to select its element.' : 'Intent pins hidden.');
  };
  $('proposal-tag').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    const id = $('proposal-tag').dataset.card;
    if (!b || !id) return;
    if (b.dataset.action === 'apply') copilot.apply(id);
    else if (b.dataset.action === 'discard') copilot.discard(id);
    else copilot.stopPreview();
  });
  $('btn-overlay').onclick = () => {
    if (!getActiveScreen().bgImage) {
      $('bg-file').click();
      return;
    }
    showOverlay = !showOverlay;
    updateTopBar();
    drawCanvas();
  };
  $('aspect-select').onchange = e => setAspect(e.target.value);
  $('state-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-state]');
    if (b) setPreviewState(b.dataset.state);
  });
  $('mock-state-select').onchange = e => setPreviewState(e.target.value);

  // Layers
  $('layer-filter').oninput = e => {
    layerFilter = e.target.value;
    renderTree();
  };
  $('btn-collapse-tree').onclick = () => {
    const containers = flattenNodes(getActiveScreen().elements).filter(e => e.node.children?.length).map(e => e.node.id);
    const allCollapsed = containers.every(id => collapsed.has(id));
    containers.forEach(id => allCollapsed ? collapsed.delete(id) : collapsed.add(id));
    renderTree();
  };
  const tree = $('tree-container');
  tree.ondragover = e => {
    e.preventDefault();
    tree.classList.add('drop-root');
  };
  tree.ondragleave = e => { if (e.target === tree) tree.classList.remove('drop-root'); };
  tree.ondrop = e => {
    e.preventDefault();
    tree.classList.remove('drop-root');
    const srcId = e.dataTransfer.getData('text/plain');
    if (!srcId) return;
    const next = structuredClone(doc);
    const found = findNode(next, srcId);
    if (!found || !found.parent) return; // already root
    found.parent.children.splice(found.index, 1);
    found.screen.elements.push(found.node);
    commit(next, 'Moved to the screen root.');
  };

  // Inspector (event delegation)
  const insp = $('inspector-content');
  insp.addEventListener('input', e => {
    if (e.target.dataset.live !== undefined && e.target.dataset.path) applyField(e.target, true);
  });
  insp.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.action === 'default-focus') return handleInspectorAction(el);
    if (el.dataset.action === 'link') {
      const next = structuredClone(doc);
      const target = findNode(next, el.dataset.id).node;
      if (el.value) target.nav = { ...(target.nav || {}), onConfirm: el.value };
      else delete target.nav;
      return commit(next, el.value ? `${target.name} opens ${targetName(el.value)}.` : `${target.name} link removed.`);
    }
    if (el.dataset.path) applyField(el);
  });
  insp.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (btn) handleInspectorAction(btn);
  });
  insp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
  });

  // Background Reference Upload
  $('bg-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const next = structuredClone(doc);
      const screen = next.screens.find(s => s.id === doc.activeScreen);
      screen.bgImage = ev.target.result;
      showOverlay = true;
      commit(next, 'Reference screenshot loaded. Set its opacity in Screen properties.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Project Folders Management Dialog
  $('btn-manage-folders').onclick = () => {
    renderFoldersList();
    $('folders-dialog').showModal();
  };
  $('btn-close-folders').onclick = () => $('folders-dialog').close();
  $('btn-add-folder-path').onclick = () => {
    const input = $('new-folder-path');
    const val = input.value.trim();
    if (!val) return;
    const roots = getProjectRoots();
    if (!roots.includes(val)) {
      saveProjectPrefs({ ...projectPrefs, roots: [...roots, val] }).then(renderFoldersList);
      input.value = '';
      setStatus(`Added search directory: ${val}`);
    }
  };
  $('btn-scan-folders').onclick = async () => {
    $('folders-dialog').close();
    setStatus('Scanning project directories…');
    await scanAllProjects();
    setStatus('Project directories scanned.');
  };

  // Export / Import
  $('btn-export-json').onclick = exportJson;
  $('btn-import-json').onclick = () => $('import-file').click();
  $('import-file').onchange = importJson;
  $('btn-export-png').onclick = exportPng;

  // Agent Handoff Dialog
  $('btn-handoff').onclick = () => {
    const md = generateHandoff(doc, doc.activeScreen);
    $('handoff-markdown').value = md;
    $('handoff-dialog').showModal();
  };
  $('btn-close-handoff').onclick = () => $('handoff-dialog').close();
  $('btn-copy-handoff').onclick = () => {
    navigator.clipboard.writeText($('handoff-markdown').value);
    setStatus('Copied handoff specification to clipboard.');
  };
  $('btn-send-handoff-to-chat').onclick = () => {
    $('handoff-dialog').close();
    copilot.sendHandoff();
  };

  // Chat Panel Toggle & Resizer
  $('btn-toggle-chat').onclick = toggleChat;
  $('btn-close-chat').onclick = closeChat;
  initChatResizer();

  // Popovers close on outside click
  document.addEventListener('mousedown', e => {
    if (openPop && !openPop.el.contains(e.target) && !openPop.anchor.contains(e.target)) closePopover();
  });
  window.addEventListener('resize', () => closePopover());
}

function isTyping(target) {
  return target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
}

function handleKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'k') {
    e.preventDefault();
    openChat();
    $('chat-input').focus();
    return;
  }

  if (isTyping(e.target)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (document.querySelector('dialog[open]')) return;

  if (e.key === 'Escape') {
    if (openPop) return closePopover();
    if (copilot.previewInfo()) return copilot.stopPreview();
    if (activeTool !== 'select') return setTool('select');
    if (selectedId) return selectNode(null);
    return;
  }

  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && key === 'd') {
    e.preventDefault();
    if (selectedId) commit(duplicateNode(doc, selectedId), 'Duplicated element.');
  } else if (mod && (key === '=' || key === '+')) {
    e.preventDefault();
    zoomStep(1);
  } else if (mod && key === '-') {
    e.preventDefault();
    zoomStep(-1);
  } else if (e.shiftKey && e.code === 'Digit1') {
    setZoom('fit');
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedId) {
      e.preventDefault();
      deleteNode(selectedId);
    }
  } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (selectedId && mode === 'screen') {
      e.preventDefault();
      nudgeSelected(e.key, e.shiftKey ? 10 : 1);
    }
  } else if (e.key === 'Enter' && activeTool !== 'select') {
    e.preventDefault();
    placeWidget(activeTool, null, null);
  } else if (!mod && !e.altKey && mode === 'screen') {
    if (key === 'v') return setTool('select');
    const tool = TYPES.find(t => t.key.toLowerCase() === key);
    if (tool) setTool(tool.id);
  }
}

// Consecutive nudges within a moment share one undo step.
function nudgeSelected(arrow, step) {
  const item = worldBoxes.get(selectedId);
  const found = findNode(doc, selectedId);
  if (!item || !found || found.node.props.locked) return;
  const now = Date.now();
  const continuing = nudgeSession && nudgeSession.id === selectedId && now - nudgeSession.time < 700;
  if (!continuing) nudgeSession = { id: selectedId, snapshot: JSON.stringify(doc) };
  nudgeSession.time = now;
  const box = { ...item.box };
  if (arrow === 'ArrowUp') box.y -= step;
  if (arrow === 'ArrowDown') box.y += step;
  if (arrow === 'ArrowLeft') box.x -= step;
  if (arrow === 'ArrowRight') box.x += step;
  updateLocalFromWorld(found.node, box, item.parentBox, viewResolution());
  if (continuing) {
    saveDraft();
    refreshAll();
  } else {
    commitFromSnapshot(nudgeSession.snapshot, 'Nudged position.');
  }
}

function getCanvasPos(e) {
  const canvas = $('canvas');
  const rect = canvas.getBoundingClientRect();
  const res = viewResolution();
  return {
    x: (e.clientX - rect.left) * res.width / (rect.width || 1),
    y: (e.clientY - rect.top) * res.height / (rect.height || 1)
  };
}

function selectNode(id) {
  selectedId = id;
  if (id) {
    revealInTree(id);
    revealPending = true;
  }
  refreshAll();
}

function deleteNode(id) {
  const found = findNode(doc, id);
  const next = removeNode(doc, id);
  selectedId = null;
  commit(next, `Deleted ${found?.node.name || 'element'}.`);
}

/**
 * Places a new widget from the armed tool. Inside a panel or group under the
 * point it becomes a child; on the screen root it takes the nearest anchor.
 */
// ================= Game kit =================
function initKit() {
  onImageLoad(() => { if (!kitRedraw) kitRedraw = requestAnimationFrame(() => { kitRedraw = 0; drawStage(); }); });
  $('side-tab-layers').onclick = () => setSideTab('layers');
  $('side-tab-kit').onclick = () => setSideTab('kit');
  $('kit-filter').oninput = e => { kitQuery = e.target.value.trim().toLowerCase(); renderKit(); };
  $('btn-kit-reload').onclick = () => loadKit(true);
  $('kit-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (b) { kitCat = b.dataset.cat === kitCat ? '' : b.dataset.cat; renderKit(); }
  });
  $('kit-body').addEventListener('click', e => {
    const b = e.target.closest('[data-kit]');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.kit === 'asset') useKitAsset(kit.assets[i]);
    else if (b.dataset.kit === 'component') insertKitComponent(kit.components[i]);
    else if (b.dataset.kit === 'color') useKitColor(kit.colors[i]);
    else if (b.dataset.kit === 'font') useKitFont(kit.fonts[i]);
    else if (b.dataset.kit === 'screens') openGameScreens();
    else if (b.dataset.kit === 'find') $('chip-import-art').click();
  });
}

async function loadKit(announce = false) {
  const path = doc.projectPath || '';
  kitPath = path;
  kitState = 'loading';
  renderKit();
  let found = null;
  try {
    found = await loadKitFor(path);
    if ((doc.projectPath || '') !== path) return; // The project changed meanwhile.
    if (found) await loadKitFonts(found);
    kitState = found ? 'ready' : 'none';
    if (announce) setStatus(found ? `Game kit loaded: ${found.assets.length} images, ${found.components.length} components.` : 'This project has no game kit yet.');
  } catch (err) {
    kitState = 'error';
    kitError = err.message;
  }
  kit = found;
  $('kit-colors').innerHTML = (kit?.colors || []).map(c => `<option value="${escapeHtml(toHex(c.value))}">${escapeHtml(c.name)}</option>`).join('');
  renderKit();
  scheduleInspector();
  drawStage();
}

function setSideTab(tab, cat) {
  sideTab = tab;
  if (cat !== undefined && kit?.assets.some(a => a.category === cat)) kitCat = cat;
  for (const [id, name] of [['side-tab-layers', 'layers'], ['side-tab-kit', 'kit']]) {
    $(id).classList.toggle('on', tab === name);
    $(id).setAttribute('aria-selected', String(tab === name));
  }
  $('layers-pane').hidden = tab !== 'layers';
  $('kit-pane').hidden = tab !== 'kit';
  $('btn-collapse-tree').hidden = tab !== 'layers';
  $('layers-ctx').hidden = tab !== 'layers';
  if (tab === 'kit') renderKit();
}

const kitMatch = (...texts) => !kitQuery || texts.some(t => String(t || '').toLowerCase().includes(kitQuery));

function renderKit() {
  $('kit-count').textContent = kit ? String(kit.assets.length + kit.components.length) : '';
  if (sideTab !== 'kit') return;
  const body = $('kit-body');
  const cats = $('kit-cats');
  if (!kit) {
    cats.innerHTML = '';
    const project = escapeHtml(doc.projectName || 'This project');
    body.innerHTML = kitState === 'loading'
      ? '<div class="kit-empty">Reading the game kit…</div>'
      : `<div class="kit-empty"><span>${kitState === 'error' ? `The kit could not be read: ${escapeHtml(kitError)}` : `${project} has no game kit yet.`} A kit brings the game's button and panel skins, backgrounds, icons, colours, fonts, components in its style and its screens.</span>
        <button class="btn box sm" data-kit="find"><svg class="ic sm"><use href="#i-palette"/></svg>Ask Copilot to build it</button></div>`;
    updateKitHint();
    return;
  }
  const sections = [
    ['components', 'Components', kit.components.length],
    ...CATEGORIES.map(c => [c.id, c.label, kit.assets.filter(a => a.category === c.id).length]),
    ['style', 'Colours & fonts', kit.colors.length + kit.fonts.length]
  ].filter(([, , n]) => n);
  if (kitCat && !sections.some(([id]) => id === kitCat)) kitCat = '';
  cats.innerHTML = sections.map(([id, label, n]) => `<button data-cat="${id}" class="${kitCat === id ? 'on' : ''}">${label}<i>${n}</i></button>`).join('');
  const show = id => !kitCat || kitCat === id;
  let html = '';
  if (kit.screens && !kitCat) html += `<button class="kit-row primary" data-kit="screens" title="Replaces the open document; Ctrl+Z returns to it"><svg class="ic sm"><use href="#i-overlay"/></svg><span>Open the game's screens</span><em>replaces the document</em></button>`;
  if (show('components')) {
    const rows = kit.components.map((c, i) => kitMatch(c.name, c.category) ? `<button class="kit-row" data-kit="component" data-i="${i}" title="Insert ${escapeHtml(c.name)}"><span>${escapeHtml(c.name)}</span><em>${escapeHtml(c.node.type)}</em></button>` : '').join('');
    if (rows) html += `<section class="kit-sec"><h3>Components</h3>${rows}</section>`;
  }
  for (const c of CATEGORIES) {
    if (!show(c.id)) continue;
    const tiles = kit.assets.map((a, i) => a.category === c.id && kitMatch(a.name, a.path, a.src) ? `<button class="kit-tile" data-kit="asset" data-i="${i}" title="${escapeHtml(`${a.name} · ${a.w}×${a.h}${a.slice ? ` · 9-slice ${a.slice.join(', ')}` : ''}\n${a.path || a.src}`)}">
        <div class="th"><img loading="lazy" src="${escapeHtml(a.src)}" alt=""></div><span>${escapeHtml(a.name)}</span><em>${a.w}×${a.h}${a.states ? ' · states' : ''}</em></button>` : '').join('');
    if (tiles) html += `<section class="kit-sec"><h3>${c.label}</h3><div class="kit-grid">${tiles}</div></section>`;
  }
  if (show('style')) {
    const colors = kit.colors.map((c, i) => kitMatch(c.name, c.value, c.use) ? `<button class="kit-row" data-kit="color" data-i="${i}" title="${escapeHtml(c.use || c.value)}"><i class="kit-sw" style="background:${escapeHtml(c.value)}"></i><span>${escapeHtml(c.name || c.value)}</span><em>${escapeHtml(c.value)}</em></button>` : '').join('');
    const fonts = kit.fonts.map((f, i) => kitMatch(f.name, f.use) ? `<button class="kit-row" data-kit="font" data-i="${i}" title="${escapeHtml(f.use || f.path || '')}"><span style="font-family:'${escapeHtml(f.name)}'">${escapeHtml(f.name)}</span><em>${escapeHtml(f.use || 'font')}</em></button>` : '').join('');
    if (colors) html += `<section class="kit-sec"><h3>Colours</h3>${colors}</section>`;
    if (fonts) html += `<section class="kit-sec"><h3>Fonts</h3>${fonts}</section>`;
  }
  body.innerHTML = html || '<div class="kit-empty">Nothing matches the filter.</div>';
  updateKitHint();
}

// What a click in the kit does depends on the selection.
function updateKitHint() {
  const el = $('kit-hint');
  const node = selectedId ? findNode(doc, selectedId)?.node : null;
  el.textContent = node?.type === 'image' ? `Images replace ${node.name}`
    : ['panel', 'button', 'input'].includes(node?.type) ? `Images skin ${node.name}`
    : node ? `Colours and fonts style ${node.name}` : 'Click to add to the screen';
}

function useKitAsset(asset) {
  const node = selectedId ? findNode(doc, selectedId)?.node : null;
  const props = node ? skinProps(node.type, asset) : null;
  if (!props) return placeWidget('image', null, null, assetNode(asset));
  const next = structuredClone(doc);
  const target = findNode(next, node.id).node;
  const { states, ...rest } = props;
  Object.assign(target.props, rest);
  if (rest.skinSlice === null) delete target.props.skinSlice;
  if (states) {
    target.props.states = target.props.states || {};
    for (const [st, value] of Object.entries(states)) target.props.states[st] = { ...(target.props.states[st] || {}), ...value };
  }
  if (asset.path && !String(target.props.comment || '').includes(asset.path)) {
    target.props.comment = [target.props.comment, `${node.type === 'image' ? 'Asset' : 'Skin'}: ${asset.path}`].filter(Boolean).join('\n');
  }
  commit(next, `${node.type === 'image' ? 'Image' : 'Skin'} of ${target.name}: ${asset.name}${states ? ` with ${Object.keys(states).length} state images` : ''}.`);
}

function insertKitComponent(component) {
  const item = instantiate(component.node);
  if (!item) return setStatus(`${component.name} is not a valid component.`, true);
  placeWidget(item.type, null, null, item);
}

function useKitColor(color) {
  const node = selectedId ? findNode(doc, selectedId)?.node : null;
  if (!node) {
    navigator.clipboard?.writeText(color.value).catch(() => {});
    return setStatus(`Copied ${color.value}. Select an element to paint it with ${color.name || 'this colour'}.`);
  }
  const key = { label: 'fontColor', slider: 'fillColor', checkbox: 'checkColor', image: 'tintColor', group: null }[node.type] ?? 'bgColor';
  if (!key) return setStatus('A group has no colour; select an element inside it.');
  const next = structuredClone(doc);
  findNode(next, node.id).node.props[key] = color.value;
  commit(next, `${node.name}: ${key} is ${color.name || color.value}.`);
}

function useKitFont(font) {
  const node = selectedId ? findNode(doc, selectedId)?.node : null;
  if (!node || !['button', 'label', 'input', 'checkbox'].includes(node.type)) return setStatus(`Select a text element to set it in ${font.name}.`);
  const next = structuredClone(doc);
  findNode(next, node.id).node.props.fontFamily = font.name;
  commit(next, `${node.name} is set in ${font.name}.`);
}

async function openGameScreens() {
  try {
    const parsed = parseDocument(await fetchJson(kit.screens));
    parsed.projectPath = doc.projectPath;
    parsed.projectName = doc.projectName;
    selectedId = null;
    aspectId = 'design';
    commit(parsed, `Opened the game's ${parsed.screens.length} screens. Ctrl+Z returns to the previous document.`);
    setSideTab('layers');
  } catch (err) {
    setStatus(`Could not open the game's screens: ${err.message}`, true);
  }
}

function placeWidget(type, box, point, item = newNode(type)) {
  if (!TYPES.some(t => t.id === type)) return;
  const res = viewResolution();
  const next = structuredClone(doc);
  const screen = next.screens.find(s => s.id === doc.activeScreen);
  const snap = gridSize || 1;

  let container = null;
  if (point) {
    container = hitTest(worldBoxes, point.x, point.y, null, {
      filter: it => ['panel', 'group'].includes(it.node.type) && it.node.anchor !== 'full-stretch' && it.node.props.visible !== false
    });
  } else if (selectedId) {
    const sel = worldBoxes.get(selectedId);
    if (sel && ['panel', 'group'].includes(sel.node.type)) container = sel;
  }

  let target = box;
  if (!target) {
    const cx = point ? point.x : container ? container.box.x + container.box.w / 2 : res.width / 2;
    const cy = point ? point.y : container ? container.box.y + container.box.h / 2 : res.height / 2;
    target = { x: cx - item.rect.w / 2, y: cy - item.rect.h / 2, w: item.rect.w, h: item.rect.h };
  }
  target = {
    x: Math.round(target.x / snap) * snap,
    y: Math.round(target.y / snap) * snap,
    w: Math.max(10, Math.round(target.w)),
    h: Math.max(10, Math.round(target.h))
  };

  let where;
  if (container) {
    const parent = findNode(next, container.node.id).node;
    item.anchor = 'top-left';
    updateLocalFromWorld(item, target, container.box, res);
    parent.children = parent.children || [];
    parent.children.push(item);
    collapsed.delete(parent.id);
    where = `inside ${parent.name}`;
  } else {
    item.anchor = naturalAnchor(target, { x: 0, y: 0, w: res.width, h: res.height });
    updateLocalFromWorld(item, target, null, res);
    screen.elements.push(item);
    where = `anchored ${ANCHORS.find(a => a.id === item.anchor).label.toLowerCase()}, where it sits`;
  }
  selectedId = item.id;
  activeTool = 'select';
  $('studio').dataset.tool = 'select';
  document.querySelectorAll('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === 'select'));
  commit(next, `Added ${item.name} ${where}.`);
}

function toggleProperty(nodeId, prop, value) {
  const next = structuredClone(doc);
  const found = findNode(next, nodeId);
  if (found) {
    found.node.props[prop] = value;
    const label = prop === 'visible' ? (value ? 'Shown' : 'Hidden') : (value ? 'Locked' : 'Unlocked');
    commit(next, `${label}: ${found.node.name}.`);
  }
}

function setAspect(id) {
  aspectId = id;
  hoveredId = null;
  updateTopBar();
  drawCanvas();
  updateStatusBar();
  if (id !== 'design') {
    const p = previewList().find(r => r.id === id);
    setStatus(`Previewing ${p.label} at ${p.width}×${p.height}: anchors recompute, pixel sizes stay. Edits still apply to the design.`);
  }
}

// ================= Modes =================
function setMode(next) {
  mode = next;
  const studio = $('studio');
  studio.classList.toggle('mode-screen', mode === 'screen');
  studio.classList.toggle('mode-flow', mode === 'flow');
  $('mode-screen').classList.toggle('on', mode === 'screen');
  $('mode-flow').classList.toggle('on', mode === 'flow');
  $('mode-screen').setAttribute('aria-selected', String(mode === 'screen'));
  $('mode-flow').setAttribute('aria-selected', String(mode === 'flow'));
  $('screen-head').hidden = mode !== 'screen';
  $('canvas-viewport').hidden = mode !== 'screen';
  $('flow-head').hidden = mode !== 'flow';
  $('flow-board').hidden = mode !== 'flow';
  if (mode === 'flow') {
    setTool('select');
    selectedId = null;
    checksScope = 'all';
  } else {
    checksScope = 'screen';
  }
  refreshAll();
}

// ================= Flow board =================
function drawFlow() {
  if (mode !== 'flow') return;
  const board = $('flow-board');
  const L = layoutFlow(doc, { cardW: 196, cardH: 168, gapX: 128, gapY: 36, pad: 30 });
  const nodes = L.nodes;
  const active = doc.activeScreen;
  const addCol = Math.max(0, ...[...nodes.values()].map(n => n.col));
  const addRow = [...nodes.values()].filter(n => n.col === addCol).length;
  const addCard = { x: L.card.pad + addCol * (L.card.w + L.card.gapX), y: L.card.pad + addRow * (L.card.h + L.card.gapY), w: L.card.w, h: 64 };
  const anyMissing = L.links.some(l => l.missing);
  const width = Math.max(L.width, addCard.x + addCard.w + L.card.pad) + (anyMissing ? 70 : 0);
  const height = Math.max(L.height, addCard.y + addCard.h + L.card.pad);

  // One edge per source, target and kind; several buttons share its label.
  const merged = new Map();
  for (const link of L.links) {
    if (link.to === BACK_PREVIOUS && !link.missing) continue;
    const key = `${link.from}>${link.missing ? '?' : link.to}>${link.kind}`;
    if (!merged.has(key)) merged.set(key, { ...link, labels: [] });
    merged.get(key).labels.push(link.label);
  }
  const arrivals = new Map();
  const paths = [];
  for (const link of merged.values()) {
    const a = nodes.get(link.from);
    if (!a) continue;
    const hot = link.from === active || link.to === active;
    const label = link.labels.length > 1 ? `${truncate(link.labels[0], 14)} +${link.labels.length - 1}` : truncate(link.labels[0], 20);
    const title = escapeHtml(link.labels.join(', '));
    if (link.missing) {
      const y = a.y + a.h * 0.5;
      paths.push(`<path class="miss" d="M${a.x + a.w} ${y} h44" marker-end="url(#arrow-miss)"><title>${title} → missing screen</title></path><text x="${a.x + a.w + 50}" y="${y + 4}" style="fill: var(--warning)">missing</text>`);
      continue;
    }
    const b = nodes.get(link.to);
    if (!b || link.to === link.from) continue;
    const k = arrivals.get(link.to) || 0;
    arrivals.set(link.to, k + 1);
    const off = (k % 4) * 9 - 9;
    let d, mid;
    if (b.col > a.col) {
      const p0 = [a.x + a.w, a.y + a.h * 0.42 + off], p3 = [b.x, b.y + b.h * 0.42 + off];
      const cx = (p3[0] - p0[0]) / 2;
      d = `M${p0[0]} ${p0[1]} C${p0[0] + cx} ${p0[1]}, ${p3[0] - cx} ${p3[1]}, ${p3[0]} ${p3[1]}`;
      mid = bezierMid(p0, [p0[0] + cx, p0[1]], [p3[0] - cx, p3[1]], p3);
    } else if (b.col === a.col) {
      const down = b.row > a.row;
      const p0 = [a.x + a.w, a.y + a.h * (down ? 0.7 : 0.3) + off], p3 = [b.x + b.w, b.y + b.h * (down ? 0.3 : 0.7) + off];
      const bend = 46 + off;
      d = `M${p0[0]} ${p0[1]} C${p0[0] + bend} ${p0[1]}, ${p3[0] + bend} ${p3[1]}, ${p3[0]} ${p3[1]}`;
      mid = bezierMid(p0, [p0[0] + bend, p0[1]], [p3[0] + bend, p3[1]], p3);
    } else {
      const p0 = [a.x, a.y + a.h * 0.75 + off], p3 = [b.x + b.w, b.y + b.h * 0.75 + off];
      const sag = 70 + off;
      d = `M${p0[0]} ${p0[1]} C${p0[0] - 40} ${p0[1] + sag}, ${p3[0] + 40} ${p3[1] + sag}, ${p3[0]} ${p3[1]}`;
      mid = bezierMid(p0, [p0[0] - 40, p0[1] + sag], [p3[0] + 40, p3[1] + sag], p3);
    }
    const cls = `${link.kind === 'back' ? 'back' : ''}${hot ? ' hot' : ''}`;
    paths.push(`<path class="${cls}" d="${d}" marker-end="url(#arrow${hot ? '-hot' : ''})"><title>${title}</title></path>`);
    paths.push(`<text class="${hot ? 'hot' : ''}" x="${mid[0]}" y="${mid[1] - 5}" text-anchor="middle"><title>${title}</title>${escapeHtml(label)}</text>`);
  }

  const cards = doc.screens.map(s => {
    const n = nodes.get(s.id);
    const mine = issues.filter(i => i.screenId === s.id);
    const errs = mine.filter(i => i.severity === 'error').length;
    const status = errs ? 'err' : mine.length ? 'warn' : '';
    const back = s.nav?.onBack;
    const pills = [];
    if (mine.length) pills.push(`<span class="pill ${status}">${mine.length} to review</span>`);
    if (back === BACK_PREVIOUS) pills.push('<span class="pill">Esc ↩ previous</span>');
    else if (back) pills.push(`<span class="pill">Esc → ${escapeHtml(truncate(targetName(back), 14))}</span>`);
    else if (['submenu', 'modal'].includes(screenRole(s))) pills.push('<span class="pill warn">Esc not set</span>');
    return `<button class="flow-card${s.id === active ? ' on' : ''}" data-screen="${s.id}" style="left: ${n.x}px; top: ${n.y}px; width: ${n.w}px; height: ${n.h}px" title="Click to select, double-click to edit on the canvas">
      <canvas data-thumb="${s.id}"></canvas>
      <span class="flow-cap"><span class="st ${status}"></span><b>${escapeHtml(s.name)}</b><small>${escapeHtml(roleLabel(screenRole(s)))}</small></span>
      <span class="flow-meta">${pills.join('')}</span>
    </button>`;
  }).join('');

  const links = L.links.filter(l => !l.missing && l.to !== BACK_PREVIOUS).length;
  $('flow-summary').textContent = `${doc.projectName || 'Project'} · ${doc.screens.length} screens · ${links} link${links === 1 ? '' : 's'}`;

  board.innerHTML = `<div class="flow-canvas" style="width: ${width}px; height: ${height}px">
    <svg class="flow-links" width="${width}" height="${height}" aria-hidden="true">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill: var(--text-muted)"/></marker>
        <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill: var(--accent)"/></marker>
        <marker id="arrow-miss" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill: var(--warning)"/></marker>
      </defs>
      ${paths.join('')}
    </svg>
    ${cards}
    <button class="flow-card add" id="flow-add" style="left: ${addCard.x}px; top: ${addCard.y}px; width: ${addCard.w}px; height: ${addCard.h}px"><svg class="ic sm"><use href="#i-plus"/></svg>New screen</button>
  </div>`;

  // Shrink a wide board to the stage instead of scrolling sideways (down to 70%).
  const fit = Math.max(0.7, Math.min(1, (board.clientWidth - 8) / width));
  board.firstElementChild.style.zoom = fit < 0.999 ? String(fit) : '';
  board.querySelectorAll('canvas[data-thumb]').forEach(c => renderThumb(c, findScreen(doc, c.dataset.thumb), 182, 104));
  board.querySelectorAll('.flow-card[data-screen]').forEach(card => {
    card.onclick = () => {
      if (card.dataset.screen !== doc.activeScreen) switchScreen(card.dataset.screen);
      else if (selectedId) selectNode(null);
    };
    card.ondblclick = () => {
      switchScreen(card.dataset.screen);
      setMode('screen');
    };
  });
  $('flow-add').onclick = e => openTemplateMenu('new', e.currentTarget);
}

function renderThumb(canvas, screen, boxW, boxH) {
  if (!screen) return;
  const { width, height } = screen.resolution;
  const scale = Math.min(boxW / width, boxH / height);
  const cssW = Math.round(width * scale);
  const cssH = Math.round(height * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.margin = `${Math.floor((boxH - cssH) / 2)}px auto`;
  canvas.getContext('2d').setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  render(canvas, screen, { previewMode: true });
}

function bezierMid(p0, p1, p2, p3) {
  return [(p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8];
}

// ================= Guideline checks =================
const measureCtx = document.createElement('canvas').getContext('2d');
const measureCache = new Map();

function measureText(text, size, weight) {
  const key = `${weight}|${size}|${text}`;
  if (measureCache.has(key)) return measureCache.get(key);
  measureCtx.font = `${weight || 'normal'} ${size}px system-ui, -apple-system, sans-serif`;
  const width = measureCtx.measureText(String(text)).width;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(key, width);
  return width;
}

function updateChecks() {
  issues = runChecks(doc, { measureText });
  const scoped = mode === 'flow' ? issues : issues.filter(i => i.screenId === doc.activeScreen);
  const { errors, warnings } = summarize(scoped);
  const badge = $('btn-checks');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let label = 'Checks pass';
  if (errors) label = warnings ? `${plural(errors, 'error')} · ${warnings}` : plural(errors, 'error');
  else if (warnings) label = plural(warnings, 'warning');
  badge.className = `checks-badge ${errors ? 'err' : warnings ? 'warn' : 'ok'}`;
  $('checks-label').textContent = label;
  $('checks-icon').innerHTML = `<use href="#i-${errors ? 'error' : warnings ? 'warn' : 'check-circle'}"/>`;
  const total = issues.length;
  badge.title = `${mode === 'flow' ? 'All screens' : 'This screen'}: ${label.toLowerCase()}. ${total} across all screens. Rules from the Game UI Guidelines, checked locally.`;
  if (openPop?.el === $('checks-popover')) renderChecksList();
}

function toggleChecks(anchor) {
  const pop = $('checks-popover');
  if (openPop?.el === pop) return closePopover();
  renderChecksList();
  openPopover(pop, anchor, { align: 'right' });
}

function renderChecksList() {
  document.querySelectorAll('#checks-scope button').forEach(b => b.classList.toggle('on', b.dataset.scope === checksScope));
  const list = checksScope === 'all' ? issues : issues.filter(i => i.screenId === doc.activeScreen);
  const el = $('checks-list');
  if (!list.length) {
    const others = issues.length;
    el.innerHTML = `<div class="checks-empty"><svg class="ic"><use href="#i-check-circle"/></svg><b>No issues ${checksScope === 'all' ? 'on any screen' : 'on this screen'}</b><span class="hint">${checksScope === 'screen' && others ? `${others} on other screens.` : 'Safe zones, anchoring, overlap, text fit, states, focus and Esc / Back are all in order.'}</span></div>`;
    return;
  }
  let html = '';
  let lastScreen = null;
  for (const i of list) {
    if (checksScope === 'all' && i.screenId !== lastScreen) {
      lastScreen = i.screenId;
      const n = list.filter(x => x.screenId === i.screenId).length;
      html += `<div class="group-cap"><span>${escapeHtml(findScreen(doc, i.screenId)?.name || '')}</span><span>${n}</span></div>`;
    }
    html += `<div class="chk${i.severity === 'error' ? ' err' : ''}">
      <div class="h"><svg class="ic sm"><use href="#i-${i.severity === 'error' ? 'error' : 'warn'}"/></svg><span>${escapeHtml(i.title)}</span><small>${escapeHtml(i.nodeName || 'Screen')}</small></div>
      <p>${escapeHtml(i.message)}</p>
      <div class="acts">
        <button class="btn box" data-action="locate" data-key="${escapeHtml(i.key)}"><svg class="ic sm"><use href="#i-locate"/></svg>Locate</button>
        ${i.fix ? `<button class="btn box" data-action="fix" data-key="${escapeHtml(i.key)}" title="Safe, undoable fix"><svg class="ic sm"><use href="#i-wand"/></svg>${escapeHtml(i.fix.label)}</button>` : ''}
      </div>
    </div>`;
  }
  el.innerHTML = html;
}

function locateIssue(item) {
  closePopover();
  if (mode !== 'screen') setMode('screen');
  if (item.screenId !== doc.activeScreen) switchScreen(item.screenId);
  aspectId = item.ratio && item.ratio !== 'design' ? item.ratio : 'design';
  if (item.nodeId) {
    clearTimeout(highlightTimer);
    highlightId = item.nodeId;
    highlightTimer = setTimeout(() => { highlightId = null; drawCanvas(); }, 2600);
    selectNode(item.nodeId);
  } else {
    prefs.sections['screen-nav'] = true;
    selectNode(null);
  }
  setStatus(`${item.title}: ${item.message}`);
}

function applyFix(key) {
  const item = issues.find(i => i.key === key);
  if (!item?.fix) return;
  const next = structuredClone(doc);
  item.fix.apply(next);
  commit(next, `Fixed: ${item.title.toLowerCase()} (${item.fix.label}). Undo with Ctrl+Z.`);
}

// ================= Menus & popovers =================
function openPopover(el, anchor, { align = 'left', side = 'below' } = {}) {
  closePopover();
  el.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left, top;
  if (side === 'right') {
    left = rect.right + 6;
    top = rect.top;
  } else {
    left = align === 'right' ? rect.right - w : rect.left;
    top = rect.bottom + 6;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  openPop = { el, anchor };
}

function closePopover() {
  if (!openPop) return;
  openPop.el.hidden = true;
  openPop.anchor.setAttribute('aria-expanded', 'false');
  openPop = null;
}

function togglePopover(el, anchor, options) {
  if (openPop?.el === el) closePopover();
  else openPopover(el, anchor, options);
}

function openTemplateMenu(kind, anchor) {
  const menu = $('template-menu');
  const items = kind === 'new'
    ? [['blank', 'Blank screen'], ...TEMPLATES.map(t => [t.id, t.label])]
    : TEMPLATES.map(t => [t.id, t.label]);
  menu.innerHTML = `<div class="menu-cap">${kind === 'new' ? 'New screen' : `Insert into ${escapeHtml(getActiveScreen().name)}`}</div>`
    + items.map(([id, label]) => `<button role="menuitem" data-template="${id}"><svg class="ic sm"><use href="#i-${id === 'blank' ? 'plus' : 'template'}"/></svg>${escapeHtml(label)}</button>`).join('');
  menu.onclick = e => {
    const b = e.target.closest('[data-template]');
    if (!b) return;
    closePopover();
    if (kind === 'new') createScreenFrom(b.dataset.template);
    else insertTemplate(b.dataset.template);
  };
  if (openPop?.el === menu && openPop.anchor === anchor) return closePopover();
  openPopover(menu, anchor, { side: kind === 'insert' ? 'right' : 'below' });
}

function openActionMenu(anchor, actions) {
  const menu = $('template-menu');
  menu.innerHTML = actions.map(([icon, label], i) => `<button role="menuitem" data-i="${i}"><svg class="ic sm"><use href="#i-${icon}"/></svg>${escapeHtml(label.split('  ')[0])}${label.includes('  ') ? `<small>${escapeHtml(label.split('  ')[1])}</small>` : ''}</button>`).join('');
  menu.onclick = e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closePopover();
    actions[Number(b.dataset.i)][2]();
  };
  openPopover(menu, anchor, { align: 'right' });
}

// ================= AI Copilot Chat Engine =================
function toggleChat() {
  const panel = $('chat-panel');
  if (panel.classList.contains('collapsed')) openChat();
  else closeChat();
}

function openChat(persist = true) {
  const panel = $('chat-panel');
  panel.classList.remove('collapsed');
  $('studio').classList.add('chat-open');
  $('studio').style.setProperty('--chat-w', `${chatWidth}px`);
  $('btn-toggle-chat').setAttribute('aria-expanded', 'true');
  $('copilot-dot').hidden = true;
  if (persist) {
    prefs.chatOpen = true;
    savePrefs();
  }
  drawStage();
}

function closeChat() {
  const panel = $('chat-panel');
  panel.classList.add('collapsed');
  $('studio').classList.remove('chat-open');
  $('btn-toggle-chat').setAttribute('aria-expanded', 'false');
  prefs.chatOpen = false;
  savePrefs();
  drawStage();
}

function initChatResizer() {
  const resizer = $('rail-resizer');

  resizer.addEventListener('mousedown', e => {
    isResizingChat = true;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!isResizingChat) return;
    const right = $('main').getBoundingClientRect().right;
    const newW = Math.round(right - e.clientX);
    if (newW >= 300 && newW <= 640) {
      chatWidth = newW;
      $('studio').style.setProperty('--chat-w', `${chatWidth}px`);
    }
  });

  window.addEventListener('mouseup', () => {
    if (isResizingChat) {
      isResizingChat = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      savePrefs();
    }
  });
}

// A token only exists when the studio is served from the API origin (tests). Inside
// Mr. Mak the report origin never sees it; the Workspace relays requests instead.
function getApiToken() {
  try {
    return new URLSearchParams(window.location.search).get('token') || sessionStorage.getItem('mrmak.token') || '';
  } catch {
    return '';
  }
}

// ================= File Operations =================
function exportJson() {
  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.projectName ? doc.projectName.replace(/\s+/g, '_').toLowerCase() : 'game'}_ui.gameui.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Exported layout JSON.');
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = parseDocument(ev.target.result);
      selectedId = null;
      aspectId = 'design';
      commit(parsed, `Opened ${file.name}. Ctrl+Z returns to the previous document.`);
    } catch (err) {
      alert(`Invalid layout file: ${err.message}`);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function exportPng() {
  // A clean render of the screen at its full resolution (no guides or selection).
  const screen = viewScreen();
  const canvas = document.createElement('canvas');
  canvas.width = screen.resolution.width;
  canvas.height = screen.resolution.height;
  render(canvas, screen, { previewMode: true, mockState: previewState === 'focused' ? 'normal' : previewState });
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${screen.name.replace(/\s+/g, '_').toLowerCase()}_${screen.resolution.width}x${screen.resolution.height}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported screen PNG.');
  });
}

// Helpers
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function truncate(text, n) {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function toHex(color) {
  if (!color || typeof color !== 'string') return '#1e293b';
  if (/^#[0-9a-f]{6}/i.test(color)) return color.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (m) return `#${[m[1], m[2], m[3]].map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
  return '#1e293b';
}

// Boot last, so every module-level binding above is initialized.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
