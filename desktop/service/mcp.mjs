import path from 'node:path';
import os from 'node:os';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse as toml } from 'smol-toml';
import { parse as dotenv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { commandPath } from './agents.mjs';
import { terminateProcessTree } from './platform.mjs';

const key = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const merge = (base, next) => {
  const result = { ...object(base) };
  for (const [name, value] of Object.entries(object(next))) result[name] = value && typeof value === 'object' && !Array.isArray(value) ? merge(result[name], value) : value;
  return result;
};
const expand = (text, env, missing) => String(text).replace(/\$\{([A-Za-z_][A-Za-z_0-9]*)(?::-([^}]*))?\}/g, (_, name, fallback) => {
  if (env[name] != null && env[name] !== '') return env[name];
  if (fallback != null) { if (!fallback && name.startsWith('MRMAK_MCP_')) missing.add(name); return fallback; }
  missing.add(name); return '';
});
const transform = (value, env, missing) => typeof value === 'string' ? expand(value, env, missing) : Array.isArray(value) ? value.map(item => transform(item, env, missing)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v, env, missing)])) : value;

export class McpInventory {
  constructor(repo, { home = os.homedir(), env = process.env, probe = probeServer } = {}) {
    Object.assign(this, { repo, home, env, probe }); this.checks = new Map(); this.pending = new Map(); this.closed = false;
  }
  async scan() {
    const problems = [], sources = [], entries = [];
    const codexHome = this.env.CODEX_HOME || path.join(this.home, '.codex');
    const claudeHome = this.env.CLAUDE_CONFIG_DIR || path.join(this.home, '.claude');
    const read = async file => {
      try {
        if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('large');
        const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
        return file.endsWith('.toml') ? toml(text) : JSON.parse(text);
      } catch (error) {
        if (error.code !== 'ENOENT') problems.push({ path: file, message: 'Configuration could not be read. Check its format and file permissions.' });
        return {};
      }
    };
    const add = (client, scope, file, configs, priority, extras = {}) => {
      if (!Object.keys(object(configs)).length) return;
      sources.push({ client, scope, path: file });
      for (const [name, config] of Object.entries(object(configs))) {
        if (config && typeof config === 'object') entries.push({ client, scope, file, name, config, priority, ...extras });
      }
    };
    const paths = {
      codexUser: path.join(codexHome, 'config.toml'), codexProject: path.join(this.repo, '.codex/config.toml'),
      claudeUser: this.env.CLAUDE_CONFIG_DIR ? path.join(claudeHome, '.claude.json') : path.join(this.home, '.claude.json'),
      claudeProject: path.join(this.repo, '.mcp.json'), claudeSettings: path.join(claudeHome, 'settings.json'),
      claudeProjectSettings: path.join(this.repo, '.claude/settings.json'), claudeLocalSettings: path.join(this.repo, '.claude/settings.local.json'),
      kimiUser: path.join(this.home, '.kimi/mcp.json'), kimiProject: path.join(this.repo, '.kimi-code/mcp.json'),
      cursorUser: path.join(this.home, '.cursor/mcp.json'), cursorProject: path.join(this.repo, '.cursor/mcp.json'),
    };
    const values = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await read(file)])));
    const codex = merge(values.codexUser, values.codexProject);
    add('codex', 'global', paths.codexUser, values.codexUser.mcp_servers, 10);
    add('codex', 'project', paths.codexProject, values.codexProject.mcp_servers, 20);
    add('claude', 'global', paths.claudeUser, values.claudeUser.mcpServers, 10);
    add('claude', 'project', paths.claudeProject, values.claudeProject.mcpServers, 20);
    const localProject = Object.entries(object(values.claudeUser.projects)).find(([folder]) => key(folder) === key(this.repo))?.[1] || {};
    add('claude', 'local', paths.claudeUser, localProject.mcpServers, 30);
    const claudeSettings = merge(merge(values.claudeSettings, values.claudeProjectSettings), values.claudeLocalSettings);
    for (const client of ['kimi', 'cursor']) {
      add(client, 'global', paths[`${client}User`], values[`${client}User`].mcpServers, 10);
      add(client, 'project', paths[`${client}Project`], values[`${client}Project`].mcpServers, 20);
    }
    if (process.platform === 'win32') {
      const managedPath = path.join(this.env.ProgramFiles || 'C:/Program Files', 'ClaudeCode/managed-mcp.json');
      const managed = await read(managedPath);
      if (managed.mcpServers) {
        for (const entry of entries) if (entry.client === 'claude') entry.restricted = true;
        add('claude', 'managed', managedPath, managed.mcpServers, 100, { managed: true });
      }
    }
    // Inspect declared installed plugins only. A downloaded cache is not proof
    // that a plugin is enabled. Never copy or launch host-owned transports.
    for (const [pluginId, settings] of Object.entries(object(codex.plugins))) {
      const split = pluginId.lastIndexOf('@'); if (split < 1) continue;
      const plugin = pluginId.slice(0, split), marketplace = pluginId.slice(split + 1);
      if ([plugin, marketplace].some(name => /[\\/]|^\.{1,2}$/.test(name))) continue;
      const folder = path.join(codexHome, 'plugins/cache', marketplace, plugin);
      const versions = (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter(item => item.isDirectory()).map(item => item.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (!versions.length) continue;
      const root = path.join(folder, versions[0]);
      const manifest = await read(path.join(root, '.codex-plugin/plugin.json'));
      const configFile = typeof manifest.mcpServers === 'string' ? path.resolve(root, manifest.mcpServers) : path.join(root, '.mcp.json');
      if (!key(configFile).startsWith(key(root) + '/')) continue;
      const config = typeof manifest.mcpServers === 'object' ? manifest.mcpServers : await read(configFile);
      const servers = config.mcpServers || config;
      add('codex', 'plugin', configFile, Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, merge(server, settings.mcp_servers?.[name])])), 5, { plugin: pluginId, pluginRoot: root, pluginEnabled: settings.enabled === true, managed: true });
    }
    const installedPath = path.join(claudeHome, 'plugins/installed_plugins.json');
    const installed = await read(installedPath);
    for (const [pluginId, locations] of Object.entries(object(installed.plugins))) {
      const installation = (Array.isArray(locations) ? locations : []).find(item => !item.projectPath || key(item.projectPath) === key(this.repo));
      if (!installation?.installPath) continue;
      const root = installation.installPath, manifest = await read(path.join(root, '.claude-plugin/plugin.json'));
      const file = typeof manifest.mcpServers === 'string' ? path.resolve(root, manifest.mcpServers) : path.join(root, '.mcp.json');
      if (!key(file).startsWith(key(root) + '/')) continue;
      const config = typeof manifest.mcpServers === 'object' ? manifest.mcpServers : await read(file);
      add('claude', 'plugin', file, config.mcpServers || config, 5, { plugin: pluginId, pluginRoot: root, pluginEnabled: claudeSettings.enabledPlugins?.[pluginId] === true, managed: true });
    }
    const projectEnv = await readFile(path.join(this.repo, '.env'), 'utf8').then(dotenv).catch(() => ({}));
    const grouped = new Map();
    for (const entry of entries) {
      const id = `${entry.client}:${entry.plugin ? entry.plugin + ':' : ''}${entry.name}`;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(entry);
    }
    const raw = new Map(), servers = [];
    for (const [id, layers] of grouped) {
      layers.sort((a, b) => a.priority - b.priority);
      const winner = layers.at(-1);
      const config = winner.client === 'codex' ? layers.reduce((result, item) => merge(result, item.config), {}) : winner.config;
      const hostManaged = winner.managed || (winner.client === 'codex' && ['node_repl', 'cua_repl'].includes(winner.name));
      const env = { ...projectEnv, ...this.env, CLAUDE_PROJECT_DIR: this.repo, CLAUDE_PLUGIN_ROOT: winner.pluginRoot || '', CODEX_PLUGIN_ROOT: winner.pluginRoot || '' };
      const missing = new Set();
      const expanded = transform(config, env, missing);
      const headers = { ...expanded.headers, ...expanded.http_headers };
      for (const [name, variable] of Object.entries(object(config.env_http_headers))) {
        if (env[variable]) headers[name] = env[variable]; else missing.add(variable);
      }
      if (config.bearer_token_env_var) {
        if (env[config.bearer_token_env_var]) headers.Authorization = `Bearer ${env[config.bearer_token_env_var]}`; else missing.add(config.bearer_token_env_var);
      }
      const disabled = config.enabled === false || config.disabled === true || winner.restricted || (winner.plugin && !winner.pluginEnabled)
        || (winner.client === 'claude' && [...(claudeSettings.disabledMcpjsonServers || []), ...(localProject.disabledMcpjsonServers || [])].includes(winner.name));
      const approvalNeeded = winner.client === 'claude' && winner.scope === 'project' && !claudeSettings.enableAllProjectMcpServers
        && ![...(claudeSettings.enabledMcpjsonServers || []), ...(localProject.enabledMcpjsonServers || [])].includes(winner.name);
      const cwd = expanded.cwd ? path.resolve(winner.pluginRoot || this.repo, expanded.cwd) : winner.pluginRoot || this.repo;
      const executable = expanded.command ? commandPath(/^[.][\\/]/.test(expanded.command) ? path.resolve(cwd, expanded.command) : expanded.command, this.env) : null;
      let endpoint = ''; if (expanded.url) { try { endpoint = new URL(expanded.url).origin; } catch { endpoint = 'Invalid address'; } }
      const transport = config.type === 'sse' ? 'sse' : config.url ? 'http' : 'stdio';
      const readiness = disabled ? 'disabled' : hostManaged ? 'managed' : missing.size ? 'missing-env' : transport === 'stdio' && !executable ? 'missing-command' : approvalNeeded ? 'approval' : 'configured';
      const fingerprint = digest([config, [...missing], headers, expanded.env, expanded.url, cwd, executable]);
      const checked = this.checks.get(id);
      const connection = checked?.fingerprint === fingerprint ? { ...checked.result, stale: Date.now() - Date.parse(checked.result.checkedAt) > 5 * 60000 } : null;
      const data = {
        id, name: winner.name, client: winner.client, scope: winner.scope, enabled: !disabled, readiness, transport,
        endpoint, executable: config.command ? path.basename(expanded.command) : null, plugin: winner.plugin || null,
        sources: [...layers].reverse().map(item => ({ scope: item.scope, path: item.file, effective: item === winner })),
        missingEnv: [...missing], credentialNames: Object.keys(headers), connection,
        canCheck: !disabled && !hostManaged && !missing.size && (transport !== 'stdio' || !!executable) && !config.http_headers_helper,
      };
      servers.push(data);
      const childEnv = { ...getDefaultEnvironment(), ...object(expanded.env) };
      for (const variable of config.env_vars || []) { const name = typeof variable === 'string' ? variable : variable.name; if (env[name] != null) childEnv[name] = env[name]; }
      raw.set(id, { data, fingerprint, config: expanded, headers, command: executable, cwd, env: childEnv });
    }
    servers.sort((a, b) => a.name.localeCompare(b.name) || a.client.localeCompare(b.client));
    return { public: { scannedAt: new Date().toISOString(), repo: this.repo, servers, sources, problems }, raw };
  }
  async list() { return (await this.scan()).public; }
  async check(id) {
    if (this.closed) throw new Error('Mr. Mak is closing.');
    if (this.pending.has(id)) return this.pending.get(id).promise;
    if (this.pending.size >= 2) throw new Error('Two connection checks are running. Wait for one to finish.');
    const entry = (await this.scan()).raw.get(id);
    if (!entry) throw new Error('MCP configuration was not found. Refresh the list.');
    if (!entry.data.canCheck) throw new Error('This connection is disabled, managed by its host, or needs configuration.');
    if (this.pending.has(id)) return this.pending.get(id).promise;
    if (this.pending.size >= 2) throw new Error('Two connection checks are running. Wait for one to finish.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const promise = this.probe(entry, controller.signal).then(result => {
      const checked = { ...result, checkedAt: new Date().toISOString() };
      this.checks.set(id, { fingerprint: entry.fingerprint, result: checked }); return checked;
    }).finally(() => { clearTimeout(timer); this.pending.delete(id); });
    this.pending.set(id, { promise, controller }); return promise;
  }
  close() { this.closed = true; for (const item of this.pending.values()) item.controller.abort(); }
}

async function probeServer(entry, signal) {
  const client = new Client({ name: 'mrmak-connection-check', version: '0.1.0' }, { capabilities: {} });
  let closing = false;
  const options = { requestInit: { headers: entry.headers, redirect: 'error' }, fetch: (url, init) => fetch(url, { ...init, redirect: 'error', signal: closing ? AbortSignal.timeout(1500) : signal }) };
  let transport;
  try {
    transport = entry.data.transport === 'stdio'
      ? new StdioClientTransport({ command: entry.command, args: entry.config.args || [], cwd: entry.cwd, env: entry.env, stderr: 'ignore', maxBufferSize: 8 * 1024 * 1024 })
      : entry.data.transport === 'sse' ? new SSEClientTransport(new URL(entry.config.url), options) : new StreamableHTTPClientTransport(new URL(entry.config.url), options);
    const cancelled = new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Error('Check timed out')), { once: true }); });
    const inspect = async () => {
      await client.connect(transport, { timeout: 12000 });
      const tools = client.getServerCapabilities()?.tools ? await client.listTools({}, { signal, timeout: 10000 }) : null;
      return { status: 'available', toolCount: tools?.tools.length ?? null, moreTools: !!tools?.nextCursor };
    };
    return await Promise.race([inspect(), cancelled]);
  } catch (error) {
    // Remote errors can echo authorization headers, URLs or command arguments.
    // Classify internally and return only fixed messages to the UI and logs.
    const auth = /401|403|unauthoriz|authentication/i.test([error.name, error.code, error.status, error.message].join(' '));
    return { status: auth ? 'agent-auth' : signal.aborted ? 'timeout' : 'unavailable', toolCount: null };
  } finally {
    if (transport instanceof StdioClientTransport && transport.pid) {
      // Kill only the new inspector-owned process tree, never an agent's MCP.
      await terminateProcessTree(transport.pid, { force: true });
    }
    closing = true;
    if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) await transport.terminateSession().catch(() => {});
    await client.close().catch(() => {});
  }
}
