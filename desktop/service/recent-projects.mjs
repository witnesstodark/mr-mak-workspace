import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson } from './util.mjs';
import { codexProjects } from './codex-history.mjs';

const MAX_PROJECTS = 60;

export const projectKey = folder => process.platform === 'win32' ? path.resolve(folder).toLowerCase() : path.resolve(folder);

// The CLIs also record git worktrees, desktop-app scratch folders and the Codex
// app's dated folders. They are short-lived, not places to start a new chat.
const transient = folder => folder.split(/[\\/]/).some((part, index, parts) => ['.claude', '.codex', 'scratch-workspaces'].includes(part) || (parts[index - 1] === 'Codex' && /^\d{4}-\d{2}-\d{2}$/.test(part)));

// Read only the folder names Claude Code has opened. Its config also holds
// account data; none of it leaves this function.
async function claudeProjects() {
  const home = process.env.CLAUDE_CONFIG_DIR;
  const config = await readJson(home ? path.join(home, '.claude.json') : path.join(os.homedir(), '.claude.json'), {});
  const projects = config?.projects && typeof config.projects === 'object' && !Array.isArray(config.projects) ? Object.keys(config.projects) : [];
  const transcripts = path.join(home || path.join(os.homedir(), '.claude'), 'projects');
  const folders = new Map((await readdir(transcripts).catch(() => [])).map(name => [name.toLowerCase(), name]));
  return Promise.all(projects.map(async folder => {
    // Same folder naming as claudeTranscript(); a new conversation updates its date.
    const name = folders.get(folder.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase());
    const info = name ? await stat(path.join(transcripts, name)).catch(() => null) : null;
    return { path: folder, source: 'claude', at: info?.mtime.toISOString() || null };
  }));
}

export async function recentProjects({ repo, sessions = [], pinned = [] }) {
  // The first spelling of a folder is shown. The CLIs record their own working
  // directory, so they come before folders typed into New chat.
  const [claude, codex] = await Promise.all([claudeProjects(), codexProjects().catch(() => [])]);
  const candidates = [
    { path: repo, source: 'workspace', at: null },
    ...claude, ...codex,
    ...sessions.map(item => ({ path: item.cwd, source: 'mrmak', at: item.updatedAt || item.createdAt || null })),
    ...pinned.map(folder => ({ path: folder, source: 'pinned', at: null })),
  ];
  const projects = new Map();
  for (const item of candidates) {
    if (typeof item.path !== 'string' || !path.isAbsolute(item.path) || /[\x00-\x1f]/.test(item.path) || transient(item.path)) continue;
    const key = projectKey(item.path);
    const project = projects.get(key) || { path: path.resolve(item.path), name: path.basename(path.resolve(item.path)) || path.resolve(item.path), sources: [], pinned: false, lastUsedAt: null };
    if (item.source === 'pinned') project.pinned = true;
    else if (!project.sources.includes(item.source)) project.sources.push(item.source);
    if (item.at && (!project.lastUsedAt || item.at > project.lastUsedAt)) project.lastUsedAt = item.at;
    projects.set(key, project);
  }
  const existing = await Promise.all([...projects.values()].map(async item => (await stat(item.path).catch(() => null))?.isDirectory() ? item : null));
  // The Workspace stays first: it was the only default before this list existed.
  // Pinned favorites follow, then the most recently used folders.
  return existing.filter(Boolean).sort((a, b) => Number(b.sources.includes('workspace')) - Number(a.sources.includes('workspace')) || Number(b.pinned) - Number(a.pinned) || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')) || a.name.localeCompare(b.name)).slice(0, MAX_PROJECTS);
}
