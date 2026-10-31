import path from 'node:path';
import { readJson, saveJson } from './util.mjs';

// What the Game UI Studio must remember between launches: its project list,
// its draft and its view preferences. The studio frame's origin changes with
// every launch, so its own storage cannot keep them. A draft or preferences
// copy older than the stored one is ignored, so a stale tab cannot overwrite it.
export const STUDIO_STATE_LIMIT = 12 * 1024 * 1024;
const DRAFT_LIMIT = 10 * 1024 * 1024;
const PREFS_LIMIT = 64 * 1024;

const paths = (value, limit) => Array.isArray(value)
  ? [...new Set(value.filter(item => typeof item === 'string' && item.trim() && item.length <= 1000).map(item => item.trim()))].slice(0, limit)
  : [];
const stamp = value => Number.isFinite(value) && value > 0 ? value : 0;

export class StudioState {
  constructor(stateDir) {
    this.file = path.join(stateDir, 'ui-studio.json');
    this.state = { projects: null, draft: null, prefs: null };
    this.saving = Promise.resolve();
  }

  async init() {
    const saved = await readJson(this.file, null);
    if (saved && typeof saved === 'object') this.state = { ...this.state, ...saved };
    return this;
  }

  get() { return this.state; }

  async update(data = {}) {
    const next = { ...this.state };
    if (data.projects && typeof data.projects === 'object') {
      next.projects = { roots: paths(data.projects.roots, 50), hidden: paths(data.projects.hidden, 500) };
    }
    const draft = data.draft;
    if (draft && typeof draft.doc === 'string' && draft.doc.length <= DRAFT_LIMIT && stamp(draft.at) >= (next.draft?.at || 0)) {
      next.draft = { doc: draft.doc, at: stamp(draft.at) };
    }
    const prefs = data.prefs;
    if (prefs && prefs.value && typeof prefs.value === 'object' && !Array.isArray(prefs.value)
      && JSON.stringify(prefs.value).length <= PREFS_LIMIT && stamp(prefs.at) >= (next.prefs?.at || 0)) {
      next.prefs = { value: prefs.value, at: stamp(prefs.at) };
    }
    this.state = next;
    this.saving = this.saving.catch(() => {}).then(() => saveJson(this.file, this.state));
    await this.saving;
    return { projects: next.projects, draftAt: next.draft?.at || 0, prefsAt: next.prefs?.at || 0 };
  }
}
