import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { capability } from './contracts.mjs';
import { genericProjectAdapter } from './generic.mjs';
import { godotProjectAdapter } from './godot.mjs';

export class ProjectAdapterRegistry {
  constructor(adapters = [godotProjectAdapter, genericProjectAdapter]) { this.adapters = adapters; }
  async detect(start) {
    const root = await realpath(path.resolve(start));
    const matches = (await Promise.all(this.adapters.map(adapter => adapter.detect({ start: root }).catch(() => null)))).filter(Boolean);
    return matches.sort((a, b) => b.confidence - a.confidence || a.adapterId.localeCompare(b.adapterId));
  }
  adapter(id) { return this.adapters.find(item => item.id === id) || null; }
  async describe(match) {
    const adapter = this.adapter(match.adapterId);
    if (!adapter) throw new Error(`Unknown project adapter: ${match.adapterId}`);
    return adapter.describe(match);
  }
  async capabilities(match) {
    const adapter = this.adapter(match.adapterId);
    if (!adapter) throw new Error(`Unknown project adapter: ${match.adapterId}`);
    const project = await this.describe(match);
    const result = { adapterId: adapter.id, label: adapter.label, project };
    for (const name of ['files', 'commands', 'artifacts', 'context']) {
      const item = capability(adapter, name);
      if (!item) continue;
      if (name === 'files') result.files = await item.relevantFiles(project);
      if (name === 'commands') result.commands = await item.commands(project);
      if (name === 'artifacts') result.artifacts = await item.artifacts(project);
      if (name === 'context') result.context = await item.context(project);
    }
    return result;
  }
}
