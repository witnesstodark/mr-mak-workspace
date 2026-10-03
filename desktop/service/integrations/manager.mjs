import { EventEmitter } from 'node:events';
import { readJson, saveJson } from '../util.mjs';

export class IntegrationManager extends EventEmitter {
  constructor(stateDir, providers = []) {
    super(); this.stateDir = stateDir; this.providers = providers; this.bindings = [];
  }
  async init() { this.bindings = await readJson(`${this.stateDir}/integration-bindings.json`, []); return this; }
  list() { return this.providers.map(({ id, label }) => ({ id, label })); }
  async bind(binding) {
    if (!binding?.providerId || !binding.externalId) throw new Error('An external provider and work-item ID are required.');
    this.bindings = [...this.bindings.filter(item => !(item.providerId === binding.providerId && item.externalId === binding.externalId)), { ...binding, boundAt: new Date().toISOString() }];
    await saveJson(`${this.stateDir}/integration-bindings.json`, this.bindings);
    return binding;
  }
  async publish(kind, value) {
    this.emit(kind, value);
    for (const provider of this.providers) {
      const method = provider[`publish${kind[0].toUpperCase()}${kind.slice(1)}`];
      if (typeof method !== 'function') continue;
      for (const binding of this.bindings.filter(item => item.providerId === provider.id)) {
        try { await method.call(provider, binding, value); } catch (error) { this.emit('error-detail', { providerId: provider.id, kind, error: String(error.message || error) }); }
      }
    }
  }
}
