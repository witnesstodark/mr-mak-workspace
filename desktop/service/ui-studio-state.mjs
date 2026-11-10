import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { saveJson } from './util.mjs';

// The Game UI Studio ships with the service (./ui-studio). What it keeps for a
// repository lives in that repository's state folder, `.mrmak/ui-studio/`:
//   state.json  the project list, the draft and the view preferences
//   assets/     game kits and the UI art copied from projects (served to the studio)
//   studio.json where the studio's code is, for the game-ui-studio skill scripts
// The studio frame's origin, and so its own storage, changes with every launch,
// so the service keeps these. A draft or preferences copy older than the stored
// one is ignored, so a stale tab cannot overwrite a newer one.
export const STUDIO_CODE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-studio');
export const STUDIO_STATE_LIMIT = 12 * 1024 * 1024;
const DRAFT_LIMIT = 10 * 1024 * 1024;
const PREFS_LIMIT = 64 * 1024;
const PATH_LIMIT = 1000;
const EMPTY = Object.freeze({ projects: null, draft: null, prefs: null });

const paths = (value, limit) => Array.isArray(value)
  ? [...new Set(value.filter(item => typeof item === 'string' && item.trim() && item.length <= PATH_LIMIT && !item.includes('\0')).map(item => item.trim()))].slice(0, limit)
  : null;
const stamp = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function projectsOf(value) {
  if (!plainObject(value)) return null;
  const roots = paths(value.roots, 50), hidden = paths(value.hidden, 500);
  return roots && hidden ? { roots, hidden } : null;
}

// A draft is a studio document: a JSON object with a list of screens.
function draftOf(value) {
  if (!plainObject(value) || typeof value.doc !== 'string' || value.doc.length > DRAFT_LIMIT || !stamp(value.at)) return null;
  try {
    const parsed = JSON.parse(value.doc);
    if (!plainObject(parsed) || !Array.isArray(parsed.screens)) return null;
  } catch { return null; }
  return { doc: value.doc, at: stamp(value.at) };
}

function prefsOf(value) {
  if (!plainObject(value) || !plainObject(value.value) || !stamp(value.at)) return null;
  return JSON.stringify(value.value).length <= PREFS_LIMIT ? { value: value.value, at: stamp(value.at) } : null;
}

export class StudioState {
  constructor(stateDir, code = STUDIO_CODE) {
    this.dir = path.join(stateDir, 'ui-studio');
    this.file = path.join(this.dir, 'state.json');
    this.code = code;
    this.state = { ...EMPTY };
    this.saving = Promise.resolve();
  }

  // A damaged or oversized file is left in place and the studio starts empty.
  async init() {
    const info = await stat(this.file).catch(() => null);
    if (info?.isFile() && info.size <= STUDIO_STATE_LIMIT) {
      try {
        const saved = JSON.parse(await readFile(this.file, 'utf8'));
        if (plainObject(saved)) this.state = { projects: projectsOf(saved.projects), draft: draftOf(saved.draft), prefs: prefsOf(saved.prefs) };
      } catch { /* Not JSON: start empty and replace it on the next save. */ }
    }
    await saveJson(path.join(this.dir, 'studio.json'), { code: this.code, assets: path.join(this.dir, 'assets') }).catch(() => {});
    return this;
  }

  get() { return this.state; }

  // Each part is replaced only when it is valid; invalid parts change nothing.
  async update(data = {}) {
    if (!plainObject(data)) throw Object.assign(new Error('The studio state is not valid.'), { status: 400 });
    const next = { ...this.state };
    const projects = projectsOf(data.projects);
    if (projects) next.projects = projects;
    const draft = draftOf(data.draft);
    if (draft && draft.at >= (next.draft?.at || 0)) next.draft = draft;
    const prefs = prefsOf(data.prefs);
    if (prefs && prefs.at >= (next.prefs?.at || 0)) next.prefs = prefs;
    this.state = next;
    // Saves run one after another and each replaces the file atomically.
    this.saving = this.saving.catch(() => {}).then(() => saveJson(this.file, this.state));
    await this.saving;
    return { projects: next.projects, draftAt: next.draft?.at || 0, prefsAt: next.prefs?.at || 0 };
  }
}
