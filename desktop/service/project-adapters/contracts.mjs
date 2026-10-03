export const PROJECT_CAPABILITIES = Object.freeze(['files', 'commands', 'launch', 'artifacts', 'viewer', 'context', 'tools']);

export function projectRef({ adapterId, root, name, metadata = {} }) {
  return { adapterId, root, name: name || root.split(/[\\/]/).filter(Boolean).at(-1) || root, metadata };
}

export function projectMatch({ adapterId, root, confidence = 0, reason = '', name, metadata = {} }) {
  return { adapterId, root, confidence, reason, name: name || root.split(/[\\/]/).filter(Boolean).at(-1) || root, metadata };
}

export function capability(adapter, name) {
  return adapter?.capabilities?.[name] || null;
}
