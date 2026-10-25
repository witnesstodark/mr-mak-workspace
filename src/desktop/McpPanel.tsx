import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './client'
import { AgentLogo, Icon } from './Icons'
import type { AgentId } from './types'
import './mcp.css'
import { fileManager } from './platform'

type Check = { status: 'available' | 'agent-auth' | 'timeout' | 'unavailable'; toolCount: number | null; moreTools?: boolean; checkedAt: string; stale?: boolean }
type Server = {
  id: string; name: string; client: 'codex' | 'claude' | 'antigravity' | 'kimi' | 'cursor' | 'pi'; scope: string; enabled: boolean
  readiness: string; transport: string; endpoint: string; executable: string | null; plugin: string | null; synced?: boolean
  sources: { scope: string; path: string; effective: boolean }[]; missingEnv: string[]; credentialNames: string[]; canCheck: boolean; connection: Check | null
}
type Inventory = { scannedAt: string; servers: Server[]; sources: { client: string; scope: string; path: string }[]; problems: { path: string; message: string }[] }
const clients = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity', kimi: 'Kimi', cursor: 'Cursor', pi: 'Pi' }
const scopes: Record<string, string> = { project: 'Project', local: 'Project · this PC', global: 'Global', plugin: 'Plugin', managed: 'Managed' }
const stateLabel: Record<string, string> = { configured: 'Enabled', disabled: 'Disabled', managed: 'Host managed', 'missing-env': 'Needs setup', 'missing-command': 'Not installed', approval: 'Needs approval' }
const checkLabel: Record<string, string> = { available: 'Available', 'agent-auth': 'Check login in agent', timeout: 'Timed out', unavailable: 'Not reachable' }

export default function McpPanel({ onClose }: { onClose: () => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [client, setClient] = useState('all')
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try { const result = await api<Inventory>('/mcp'); if (request === generation.current) { setInventory(result); setError('') } }
    catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : String(error)) }
  }, [])
  useEffect(() => {
    void Promise.resolve().then(refresh); const onFocus = () => { void refresh() }; window.addEventListener('focus', onFocus)
    const timer = window.setInterval(onFocus, 30000)
    return () => { invalidate(); window.removeEventListener('focus', onFocus); clearInterval(timer) }
  }, [refresh, invalidate])
  const check = async (server: Server) => {
    setBusy(value => new Set([...value, server.id])); setError('')
    try { await api('/mcp/check', { id: server.id }); await refresh() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(value => { const next = new Set(value); next.delete(server.id); return next }) }
  }
  const visible = (inventory?.servers || []).filter(server => (client === 'all' || server.client === client)
    && (scope === 'all' || (scope === 'project' ? ['project', 'local'].includes(server.scope) : server.scope === scope))
    && `${server.name} ${server.endpoint} ${server.plugin || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="files-panel mcp-panel"><header><h2>MCP</h2><div>
    <button className="desk-icon" onClick={() => void refresh()} title="Refresh MCP configurations" aria-label="Refresh MCP configurations"><Icon name="refresh" size={15} /></button>
    <button className="desk-icon" onClick={onClose} aria-label="Close MCP"><Icon name="close" size={17} /></button>
  </div></header>
    <div className="mcp-summary"><strong>{inventory ? `${inventory.servers.filter(server => server.enabled).length} enabled connections` : 'Reading configurations…'}</strong><p>Tools available to your agents. Check a server to see whether it responds now.</p></div>
    <div className="mcp-filters"><label>Agent<select aria-label="Filter MCP by agent" value={client} onChange={event => setClient(event.target.value)}><option value="all">All agents</option>{Object.entries(clients).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Stored in<select aria-label="Filter MCP by scope" value={scope} onChange={event => setScope(event.target.value)}><option value="all">All locations</option><option value="project">This project</option><option value="global">Global</option><option value="plugin">Plugins</option></select></label></div>
    <div className="file-filter"><Icon name="search" size={14} /><input aria-label="Find MCP" placeholder="Find a server…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="mcp-scroll">
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
      {inventory?.problems.map(problem => <p key={problem.path} className="mcp-problem">{problem.message}<small>{problem.path}</small></p>)}
      {visible.map(server => <article className="mcp-server" key={server.id} data-mcp-id={server.id}>
        <div className="mcp-server-title"><span className="mcp-provider">{server.client === 'cursor' ? <Icon name="terminal" size={16} /> : <AgentLogo agent={server.client as AgentId} size={16} />}</span><h3>{server.name}</h3><span className={`mcp-state ${server.readiness}`}>{stateLabel[server.readiness] || server.readiness}</span></div>
        <p className="mcp-subtitle">{clients[server.client]}<span>·</span>{scopes[server.scope] || server.scope}<span>·</span>{server.transport === 'stdio' ? 'Local process' : server.transport.toUpperCase()}</p>
        <p className="mcp-endpoint" title={server.endpoint || server.executable || ''}>{server.endpoint || server.executable}</p>
        {server.missingEnv.length > 0 && <p className="mcp-note">Add to .env: {server.missingEnv.join(', ')}</p>}
        {server.readiness === 'missing-command' && <p className="mcp-note">Install this server on this computer.</p>}
        {server.readiness === 'approval' && <p className="mcp-note">Approve this project server in Claude.</p>}
        {server.plugin && <p className="mcp-note">{server.synced ? `Provided by ${server.plugin.replace(/@synced$/, '')}, synced from your claude.ai account.` : `Provided by ${server.plugin}.`}</p>}
        <div className="mcp-check"><span className={server.connection?.status === 'available' && !server.connection.stale ? 'available' : ''}>{busy.has(server.id) ? 'Checking…' : server.connection ? `${server.connection.stale ? 'Last check: ' : ''}${checkLabel[server.connection.status]}` : 'Connection not checked'}{!busy.has(server.id) && server.connection?.toolCount != null && <small>{server.connection.toolCount}{server.connection.moreTools ? '+' : ''} tools</small>}</span>
          {server.canCheck && <button onClick={() => void check(server)} disabled={busy.has(server.id) || busy.size >= 2} aria-label={`Check ${server.name} for ${clients[server.client]}`}>Check</button>}
        </div>
        {server.connection && <p className="mcp-check-time">Checked {new Date(server.connection.checkedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
        {server.connection?.status === 'agent-auth' && <p className="mcp-note">This check cannot reuse the agent’s private login. Use /mcp in that agent to see its authenticated connection.</p>}
        {server.connection?.status === 'unavailable' && <p className="mcp-note">The server did not complete the MCP handshake. A local companion app may need to be running.</p>}
        <details className="mcp-sources"><summary>Configuration{server.sources.length > 1 ? ` · ${server.sources.length} locations` : ''}</summary>{server.sources.map(source => <div key={source.path}><span>{scopes[source.scope] || source.scope}{source.effective ? ' · effective source' : ' · lower priority'}</span><code>{source.path}</code><button onClick={() => api('/reveal', { path: source.path }).catch(error => setError(String(error.message || error)))}>Show in {fileManager} <Icon name="external" size={12} /></button></div>)}{server.credentialNames.length > 0 && <p>Credentials are hidden.</p>}</details>
      </article>)}
      {inventory && !visible.length && <p className="mcp-empty">No MCP servers match these filters.</p>}
      {inventory && (client === 'all' || client === 'claude') && (scope === 'all' || scope === 'global') && <p className="mcp-note mcp-connectors">Claude Code can also load claude.ai connectors (such as Gmail or Notion) from a signed-in Claude account. They are not stored on this computer, so they are not listed here; run /mcp in a Claude chat to see them.</p>}
    </div>
    <footer className="mcp-footer"><p>Enabled means configured. A check opens its own temporary connection; each chat keeps its own MCP session. Desktop app connectors are managed by their host.</p><button onClick={() => { navigator.clipboard.writeText('/mcp').then(() => setCopied(true)).catch(error => setError(String(error.message || error))) }}>{copied ? 'Copied /mcp' : 'Copy /mcp for chat status'}</button></footer>
  </div>
}
