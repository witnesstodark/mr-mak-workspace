import { realpath, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectMatch, projectRef } from './contracts.mjs';
import { resolveCommand } from '../platform.mjs';

const MAX_ANCESTORS = 12;
const configValue = (text, section, key) => {
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { current = header[1]; continue; }
    if (current !== section) continue;
    const match = new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*=\\s*(.+)$`).exec(line);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};
const projectName = (root, text) => configValue(text, 'application', 'config/name') || path.basename(root) || root;
const projectConfig = root => path.join(root, 'project.godot');

async function findRoot(start) {
  let current = await realpath(path.resolve(start));
  for (let depth = 0; depth <= MAX_ANCESTORS; depth++) {
    if ((await stat(projectConfig(current)).catch(() => null))?.isFile()) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function config(root) {
  const file = projectConfig(root);
  const text = await readFile(file, 'utf8');
  return { text, name: projectName(root, text), mainScene: configValue(text, 'application', 'run/main_scene'), features: configValue(text, 'application', 'config/features'), icon: configValue(text, 'application', 'config/icon') };
}

async function executable() {
  for (const name of ['godot', 'godot4']) {
    const found = resolveCommand(name);
    if (found) return found;
  }
  return null;
}

export const godotProjectAdapter = {
  id: 'godot',
  label: 'Godot project',
  async detect({ start }) {
    const root = await findRoot(start);
    if (!root) return null;
    const details = await config(root);
    return projectMatch({ adapterId: 'godot', root, confidence: 1, reason: 'Found project.godot.', name: details.name, metadata: { mainScene: details.mainScene, features: details.features } });
  },
  async describe(project) {
    const details = await config(project.root);
    return projectRef({ adapterId: 'godot', root: project.root, name: details.name, metadata: { mainScene: details.mainScene, features: details.features, icon: details.icon } });
  },
  capabilities: {
    files: { async relevantFiles(project) {
      const result = [];
      const visit = async (folder, depth = 0) => {
        if (depth > 2) return;
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          if (entry.name === '.git' || entry.name === '.godot' || entry.name === 'node_modules') continue;
          const full = path.join(folder, entry.name);
          if (entry.isDirectory()) await visit(full, depth + 1);
          else if (/\.(godot|tscn|scn|gd|gdshader|tres|res|png|jpg|jpeg|webp|glb|gltf)$/i.test(entry.name) || entry.name === 'README.md') result.push({ path: full, kind: path.extname(entry.name).slice(1) || 'file', label: path.relative(project.root, full).split(path.sep).join('/') });
        }
      };
      await visit(project.root);
      return result.slice(0, 2000);
    } },
    commands: { async commands(project) {
      const godot = await executable();
      if (!godot) return [];
      const details = await config(project.root);
      const base = { executable: godot, cwd: project.root };
      return [
        { id: 'godot-editor', label: 'Open Godot editor', ...base, args: ['--editor', '--path', project.root], safety: 'open' },
        { id: 'godot-run', label: 'Run Godot project', ...base, args: ['--path', project.root], safety: 'run', metadata: { mainScene: details.mainScene } },
      ];
    } },
    artifacts: { async artifacts(project) {
      const candidates = ['project.godot', 'README.md', '.godot/editor/project_metadata.cfg'];
      return (await Promise.all(candidates.map(async relative => {
        const file = path.join(project.root, relative);
        return (await stat(file).catch(() => null))?.isFile() ? { path: file, kind: path.extname(file).slice(1) || 'file', label: relative } : null;
      }))).filter(Boolean);
    } },
    context: { async context(project) {
      const details = await config(project.root);
      return [{ ref: 'project.godot', path: projectConfig(project.root), title: details.name, kind: 'project-config' }];
    } },
  },
};
