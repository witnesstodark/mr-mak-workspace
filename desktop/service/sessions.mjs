import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import pty from 'node-pty';
import headless from '@xterm/headless';
import { TerminalSnapshotAddon } from './terminal-snapshot.mjs';
import { terminalCommand, childEnvironment, nativeConversationId, codexSupportsNoDaemon } from './agents.mjs';
import { expandHome, readJson, saveJson } from './util.mjs';
import { claudeTranscript, codexTranscript, tailNativeFile } from './native-events.mjs';
import { findCodexChat, newerCodexRollout } from './codex-history.mjs';
import { englishTitle, groupLabel, restoredTitle } from './titles.mjs';
import { projectKey } from './recent-projects.mjs';
import { defaultWorkerEffort, workerEfforts } from './effort.mjs';
import { ptyOptions } from './platform.mjs';
import { opencodeVersion, opencodeEnvironment, readOpencodeState, watchOpencode } from './opencode.mjs';
import { prepareAntigravityLog, readAntigravityConversation, validAntigravityId, watchAntigravity } from './antigravity.mjs';

const { Terminal } = headless;
// Native CLIs record getcwd(): symlinks resolved (/tmp -> /private/tmp, cloud
// drive links) and, on macOS, the on-disk case and Unicode form. Store that
// spelling so their transcripts match. Windows keeps drive-letter spellings.
async function workingFolder(value) {
  const folder = path.resolve(expandHome(value));
  return process.platform === 'win32' ? folder : realpath(folder).catch(() => folder);
}
const publicSession = session => {
  const { id, name, agent, cwd, bypass, effort, status, createdAt, lastOutputAt, lastInputAt, exitCode, nativeId, attention, activity, unread, completionVersion, lastCompletedId, cols, rows, open, pinned, tabOrder, tabColor, group, updatedAt, preview, hasConversation, restoreError } = session;
  return { id, name, agent, cwd, bypass, effort, status, createdAt, lastOutputAt, lastInputAt, exitCode, nativeId, attention, activity, unread, completionVersion, lastCompletedId, cols, rows, open, pinned, tabOrder, tabColor, group, updatedAt, preview, hasConversation, restoreError };
};

// Grouped tabs sit together at the position of their earliest open member; a tab
// without a group keeps its own position. The frontend (chatOrder.ts) mirrors this.
export const groupRanks = items => {
  const ranks = new Map();
  for (const item of items) {
    if (!item.open || !item.group) continue;
    const key = `${item.pinned}:${item.group}`;
    ranks.set(key, Math.min(ranks.get(key) ?? Infinity, item.tabOrder));
  }
  return item => (item.group ? ranks.get(`${item.pinned}:${item.group}`) : undefined) ?? item.tabOrder;
};

export class Sessions extends EventEmitter {
  constructor(repo, stateDir) {
    super();
    this.repo = repo;
    this.stateDir = stateDir;
    this.items = new Map();
    this.saveChain = Promise.resolve();
    this.dirty = false;
    this.closed = false;
  }

  async init() {
    await mkdir(this.stateDir, { recursive: true });
    const saved = await readJson(path.join(this.stateDir, 'sessions.json'), []);
    for (const [index, metadata] of saved.entries()) {
      const item = this.make({ ...metadata, name: restoredTitle(metadata.name, index), open: metadata.open ?? metadata.agent !== 'kimi', pinned: !!metadata.pinned, updatedAt: metadata.updatedAt || metadata.lastInputAt || metadata.createdAt, hasConversation: metadata.hasConversation ?? (metadata.agent === 'codex' && !!metadata.nativeId), status: 'stopped', activity: 'idle', attention: !!metadata.unread });
      this.items.set(item.id, item);
      if (item.open) await this.hydrate(item);
    }
    this.timer = setInterval(() => { if (this.dirty) this.persist().catch(error => this.emit('service-error', error)); }, 3000);
    this.timer.unref();
    return this;
  }

  make(metadata) {
    return { activity: 'idle', unread: false, completionVersion: 0, tabOrder: this.items.size, tabColor: null, group: null, ...metadata, effort: ['codex', 'claude', 'antigravity'].includes(metadata.agent) ? metadata.effort || defaultWorkerEffort : undefined, terminal: null, serializer: null, process: null, sequence: 0, pendingOutput: '', outputTimer: null };
  }

  async hydrate(session) {
    if (session.hydrating) return session.hydrating;
    if (session.terminal) return;
    session.hydrating = (async () => {
      const terminal = new Terminal({ cols: session.cols || 90, rows: session.rows || 32, scrollback: 3000, allowProposedApi: true });
      const serializer = new TerminalSnapshotAddon();
      terminal.loadAddon(serializer);
      session.terminal = terminal; session.serializer = serializer;
      const screen = await readJson(path.join(this.stateDir, `screen-${session.id}.json`), null);
      if (screen?.data) await new Promise(resolve => terminal.write(screen.data, resolve));
      session.savedScreen = screen?.data;
    })();
    try { await session.hydrating; } finally { session.hydrating = null; }
  }

  list() {
    const items = [...this.items.values()].map(publicSession);
    const rank = groupRanks(items);
    return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank(a) - rank(b) || a.tabOrder - b.tabOrder);
  }
  active() { return this.list().filter(item => item.open); }
  async restore() {
    // Open windows immediately; restore their terminals in the background.
    for (const session of this.items.values()) {
      if (this.closed) return;
      if (!session.open) continue;
      try { await this.resume(session.id); }
      catch (error) { session.restoreError = error.message; session.status = 'stopped'; this.changed(session); }
    }
  }
  get(id) {
    const session = this.items.get(id);
    if (!session) throw Object.assign(new Error('Chat no longer exists'), { status: 404 });
    return session;
  }
  changed(session) {
    this.dirty = true;
    this.emit('session', publicSession(session));
  }

  async create(options) {
    if (this.closed) throw new Error('Mr. Mak is shutting down');
    if (this.active().length >= 80) throw new Error('Close a tab before opening another (80 open tab limit). Closed chats remain in History.');
    const agent = String(options.agent || 'codex');
    nativeConversationId(options.resumeId);
    if (options.effort && !workerEfforts.includes(options.effort)) throw new Error('Reasoning effort must be medium, high, xhigh or max.');
    const cwd = await workingFolder(options.cwd || this.repo);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Working folder must be a directory');
    const now = new Date().toISOString();
    const session = this.make({
      id: randomUUID(), agent, name: englishTitle(options.name, `Conversation ${this.items.size + 1}`),
      tabOrder: Math.max(-1, ...this.list().map(item => item.tabOrder)) + 1,
      cwd, bypass: options.bypass === true, createdAt: now, lastInputAt: null, lastOutputAt: null,
      effort: options.effort, group: groupLabel(options.group),
      status: 'starting', nativeId: options.resumeId || (agent === 'claude' ? randomUUID() : null),
      open: true, pinned: false, updatedAt: now, preview: '', hasConversation: !!options.resumeId || !!options.initialPrompt, restoreError: null,
      attention: false, cols: Math.min(500, Math.max(20, options.cols || 90)), rows: Math.min(200, Math.max(5, options.rows || 32)),
    });
    this.items.set(session.id, session);
    await this.hydrate(session);
    // A first message and its readable folder apply to this launch only, never to a resume.
    const first = { initialPrompt: options.initialPrompt, readDir: options.readDir };
    try { await this.launch(session, options.resumeId, await this.nativeBoundary(session, options.resumeId), first); }
    catch (error) { this.items.delete(session.id); session.terminal.dispose(); throw error; }
    await this.persist();
    return publicSession(session);
  }

  async importConversation({ agent, nativeId, name, cwd, pinned = false, bypass = false, group = null }) {
    if (!['codex', 'claude', 'antigravity', 'opencode', 'kimi'].includes(agent) || typeof nativeId !== 'string' || !nativeId.trim()) throw new Error('Choose an agent and its native conversation ID.');
    nativeId = nativeConversationId(nativeId.trim());
    if (agent === 'antigravity' && !validAntigravityId(nativeId)) throw new Error('Use the Antigravity conversation UUID from its /resume picker.');
    cwd = await workingFolder(cwd || this.repo);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Working folder must be a directory');
    const existing = [...this.items.values()].find(item => item.agent === agent && item.nativeId === nativeId);
    if (existing) { existing.name = englishTitle(name, existing.name); existing.pinned = pinned; this.changed(existing); await this.persist(); return publicSession(existing); }
    const now = new Date().toISOString();
    const session = this.make({ id: randomUUID(), agent, nativeId, name: englishTitle(name), cwd, bypass, pinned, group: groupLabel(group), open: false, status: 'stopped', createdAt: now, updatedAt: now, hasConversation: true, lastInputAt: null, lastOutputAt: null, preview: '', cols: 90, rows: 32, attention: false });
    this.items.set(session.id, session); this.changed(session); await this.persist();
    return publicSession(session);
  }

  // A CLI that is killed cannot restore the terminal it drew on. The session's
  // terminal is reused across restarts, so a fullscreen CLI's alternate screen
  // and mouse capture would otherwise outlive it and strand the next process,
  // or a renderer that changed between runs, on a screen with no scrollback
  // where wheel events arrive as mouse reports. Clear those modes before each
  // launch, in the service's terminal and in every attached renderer.
  resetTerminal(session) {
    const reset = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?1016l\x1b[?2004l\x1b[?1004l\x1b[?1049l\x1b[?47l\x1b[?25h\x1b[0m';
    session.terminal.write(reset);
    session.pendingOutput = (session.pendingOutput || '') + reset;
    if (!session.outputTimer) session.outputTimer = setTimeout(() => this.flushOutput(session), 16);
  }

  async launch(session, resumeId, nativeWatch, first = {}) {
    let env = childEnvironment(this.repo);
    let opencodeMajor;
    if (session.agent === 'opencode') {
      opencodeMajor = await opencodeVersion(env);
      // v2 explicitly accepts a new ID through --session. Assign it before
      // launch, so even a very early close retains an exact resume target.
      if (opencodeMajor === 2 && !session.nativeId) session.nativeId = `ses_${randomUUID().replaceAll('-', '')}`;
      if (opencodeMajor === 2) resumeId ||= session.nativeId;
      env = opencodeEnvironment(env, { stateDir: this.stateDir, session, major: opencodeMajor });
    }
    if (this.closed || !session.open) throw new Error('The chat was closed before its terminal started.');
    if (session.agent === 'antigravity' && resumeId && !validAntigravityId(resumeId)) throw new Error('Use the Antigravity conversation UUID from its /resume picker.');
    const antigravityLog = session.agent === 'antigravity' ? await prepareAntigravityLog(this.stateDir, session.id) : undefined;
    const noDaemon = session.agent === 'codex' && await codexSupportsNoDaemon(env);
    if (this.closed || !session.open) throw new Error('The chat was closed before its terminal started.');
    const command = terminalCommand(session.agent, { bypass: session.bypass, resumeId, nativeId: session.nativeId, effort: session.effort, opencodeMajor, antigravityLog, noDaemon, ...first });
    if (session.agent === 'codex') env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = `mrmak_chat_${session.id}`;
    if (session.terminal) this.resetTerminal(session);
    const proc = pty.spawn(command.file, command.args, ptyOptions({ cwd: session.cwd, env, cols: session.cols, rows: session.rows }));
    session.process = proc;
    session.deviceReplies?.dispose();
    // Inactive tabs still have a terminal: answer device queries without needing
    // a visible renderer. The UI suppresses its duplicate protocol replies.
    session.deviceReplies = session.terminal.onData(data => { if (session.process) session.process.write(data); });
    session.status = 'running';
    session.activity = 'idle';
    session.restoreError = null;
    session.exitCode = null;
    session.startedAt = Date.now();
    proc.onData(data => {
      session.lastOutputAt = new Date().toISOString();
      session.terminal.write(data);
      session.pendingOutput += data;
      // Batch bursts for xterm; never let one high-output terminal flood the UI.
      if (!session.outputTimer) session.outputTimer = setTimeout(() => this.flushOutput(session), 16);
      // BEL is also used by terminal protocols (for example OSC titles). It is
      // not evidence of an agent finishing, or of a prompt that needs attention.
      this.dirty = true;
    });
    proc.onExit(({ exitCode }) => {
      this.flushOutput(session);
      session.process = null;
      session.deviceReplies?.dispose();
      if (process.platform === 'win32') {
        // node-pty 1.1.0 leaves its ConPTY output worker alive after a natural exit.
        // The bundled ConPTY DLL avoids the legacy AttachConsole-on-dead-PID path.
        try { proc.kill(); } catch { /* Native console already closed. */ }
        proc._agent?._conoutSocketWorker?.dispose();
      }
      session.stopNativeWatch?.();
      session.stopNativeWatch = null;
      session.status = 'exited';
      session.activity = 'idle';
      session.exitCode = exitCode;
      this.changed(session);
      this.emit('notice', { id: randomUUID(), sessionId: session.id, name: session.name, kind: 'exit', text: `${session.name} exited (${exitCode}).`, at: new Date().toISOString() });
      if (session.agent === 'antigravity') this.recoverNative(session).catch(() => {});
      if (session.agent === 'codex' && !session.nativeId) this.read(session.id).then(({ screen }) => {
        const match = /codex resume ([a-f0-9-]{36})/i.exec(screen);
        if (match) { session.nativeId = match[1]; this.changed(session); }
      }).catch(() => {});
      if (session.agent === 'opencode') readOpencodeState(this.stateDir, session.id).then(state => {
        if (state?.launchId === env.MRMAK_OPENCODE_LAUNCH_ID) {
          this.bindNative(session, { id: state.nativeId });
          if (state.completion && session.nativeId === state.nativeId) this.nativeEvent(session, { kind: 'turn-completed', id: state.completion });
        }
      }).catch(() => {});
    });
    this.changed(session);
    // Discovery is read-only, and only accepts an unambiguous native session.
    this.beginDiscovery(session);
    if (session.agent === 'antigravity') session.stopNativeWatch = watchAntigravity(this.stateDir, session.id, id => {
      if (session.process === proc) this.bindAntigravity(session, id);
    });
    if (session.agent === 'opencode') session.stopNativeWatch = watchOpencode(this.stateDir, session, env.MRMAK_OPENCODE_LAUNCH_ID, state => {
      this.bindNative(session, { id: state.nativeId });
      if (session.nativeId !== state.nativeId) return;
      if (state.completion) this.nativeEvent(session, { kind: 'turn-completed', id: state.completion });
      if (state.activity === 'working') this.nativeEvent(session, { kind: 'turn-started' });
      else if (state.activity === 'waiting') this.nativeEvent(session, { kind: 'attention' });
      else if (state.activity === 'idle' && session.activity !== 'idle') this.nativeEvent(session, { kind: 'turn-interrupted' });
    });
    if (nativeWatch) this.watchNative(session, nativeWatch.file, nativeWatch.offset);
    else if (session.agent === 'claude' && session.nativeId) claudeTranscript(session.cwd, session.nativeId).then(file => {
      if (session.process === proc) this.watchNative(session, file);
    }).catch(() => {});
  }

  beginDiscovery(session) {
    if (session.discovering || session.nativeId || session.agent !== 'codex') return;
    session.discovering = true;
    this.discoverNative(session).catch(() => {}).finally(() => { session.discovering = false; });
  }

  watchNative(session, file, offset = 0) {
    if (!session.process) return;
    session.stopNativeWatch?.();
    const stopTail = tailNativeFile(file, session.agent, event => this.nativeEvent(session, event), offset);
    if (session.agent !== 'codex') { session.stopNativeWatch = stopTail; return; }
    // A Codex rewind continues the thread in a new rollout, and /new starts another
    // thread in the same terminal: follow the newest one this terminal owns.
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const next = await newerCodexRollout(session, file);
        if (!next || session.stopNativeWatch !== stop || [...this.items.values()].some(item => item !== session && item.nativeId === next.id)) return;
        session.nativeId = next.id; session.hasConversation = true;
        this.changed(session);
        this.watchNative(session, next.file);
      } catch { /* The next check retries. */ }
      finally { checking = false; }
    }, 2000);
    timer.unref();
    const stop = () => { clearInterval(timer); stopTail(); };
    session.stopNativeWatch = stop;
  }

  nativeEvent(session, event) {
    if (event.kind === 'turn-started') {
      if (session.activity === 'working') return;
      session.activity = 'working'; session.attention = false;
    } else if (event.kind === 'turn-interrupted') {
      session.activity = 'idle';
    } else if (event.kind === 'turn-completed') {
      if (event.id && session.lastCompletedId === event.id) return;
      session.lastCompletedId = event.id;
      session.activity = 'idle'; session.unread = true; session.attention = true;
      session.completionVersion++;
      if (event.preview) session.preview = event.preview;
    } else if (event.kind === 'attention') {
      session.activity = 'waiting'; session.attention = true;
    } else return;
    session.hasConversation = true; session.updatedAt = new Date().toISOString();
    this.changed(session);
    if (event.text) this.emit('notice', { id: randomUUID(), sessionId: session.id, name: session.name, kind: event.kind, text: `${session.name}: ${event.text}`, at: new Date().toISOString() });
  }

  async discoverNative(session) {
    if (session.agent !== 'codex' || session.nativeId) return;
    const process = session.process;
    for (let attempt = 0; !this.closed && process && session.process === process && !session.nativeId; attempt++) {
      const match = await findCodexChat(session);
      if (this.closed || session.process !== process || session.nativeId) return;
      if (this.bindNative(session, match)) { this.watchNative(session, match.file); return; }
      // A first prompt, login or CLI update can take longer than thirty seconds.
      await new Promise(resolve => { const timer = setTimeout(resolve, attempt < 60 ? 500 : 3000); timer.unref(); });
    }
  }

  bindNative(session, match) {
    if (!match || session.nativeId || [...this.items.values()].some(item => item !== session && item.nativeId === match.id)) return false;
    session.nativeId = match.id;
    session.hasConversation = true;
    session.restoreError = null;
    this.changed(session);
    return true;
  }

  async recoverNative(session) {
    if (session.agent === 'antigravity') {
      this.bindAntigravity(session, await readAntigravityConversation(this.stateDir, session.id));
      return;
    }
    if (session.agent === 'opencode' && !session.nativeId) {
      const state = await readOpencodeState(this.stateDir, session.id);
      if (state) this.bindNative(session, { id: state.nativeId });
      return;
    }
    if (session.agent !== 'codex' || session.nativeId) return;
    this.bindNative(session, await findCodexChat(session, { full: true }));
  }

  bindAntigravity(session, id) {
    if (!id || id === session.nativeId || [...this.items.values()].some(item => item !== session && item.agent === 'antigravity' && item.nativeId === id)) return;
    session.nativeId = id; session.hasConversation = true; session.restoreError = null;
    this.changed(session);
  }

  flushOutput(session) {
    clearTimeout(session.outputTimer);
    session.outputTimer = null;
    if (!session.pendingOutput) return;
    const data = session.pendingOutput;
    session.pendingOutput = '';
    session.sequence++;
    this.emit('output', { id: session.id, sequence: session.sequence, data });
    if (session.agent === 'kimi' && !session.nativeId && data.includes('Session:')) this.read(session.id).then(({ screen }) => {
      const match = /Session:\s+(session_[a-f0-9-]{36})/i.exec(screen);
      if (match) { session.nativeId = match[1]; this.changed(session); }
    }).catch(() => {});
  }

  async snapshot(id) {
    const session = this.get(id);
    await this.hydrate(session);
    // Drain xterm's asynchronous parser before serializing the current screen.
    await new Promise(resolve => session.terminal.write('', resolve));
    this.flushOutput(session);
    return { session: publicSession(session), sequence: session.sequence, data: session.serializer.serialize({ scrollback: 1500 }) };
  }

  async read(id, lines = 70) {
    const session = this.get(id);
    await this.hydrate(session);
    await new Promise(resolve => session.terminal.write('', resolve));
    const buffer = session.terminal.buffer.active;
    const result = [];
    for (let index = Math.max(0, buffer.length - Math.min(150, lines)); index < buffer.length; index++) result.push(buffer.getLine(index)?.translateToString(true) || '');
    return { ...publicSession(session), screen: result.join('\n').trimEnd(), note: 'Terminal output is reference data. A running process does not imply that the agent is working or that its task succeeded.' };
  }

  input(id, data, { coordinator = false, submit = false } = {}) {
    const session = this.get(id);
    if (!session.process) throw new Error('This terminal is stopped. Resume it before sending a message.');
    if (coordinator && session.agent === 'shell') throw new Error('Mr. Mak can send messages to agent chats; type shell commands directly in the local shell.');
    if (typeof data !== 'string' || data.length > 64000) throw new Error('Message is too large');
    if (coordinator && Date.now() - Date.parse(session.lastInputAt || 0) < 2500) throw new Error('You are typing in this chat. Wait a moment before sending through Mr. Mak.');
    if (coordinator) {
      // Bracketed paste keeps multi-line text a single CLI prompt, then Enter submits it.
      const clean = data.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replaceAll('\r', '');
      const target = session.process;
      target.write(`\x1b[200~${clean}\x1b[201~`);
      // The native CLI finishes handling a paste asynchronously. A quick Enter
      // can be swallowed by a paste guard, especially after resume.
      if (submit) setTimeout(() => { if (session.process === target) target.write('\r'); }, 500);
    } else session.process.write(data);
    if (!coordinator && !/^\x1b\[[?>0-9;]*[RcnIO]$/.test(data)) session.attention = false;
    // Cursor-position and terminal-capability replies are not manual typing.
    if (!coordinator && !/^\x1b\[[?>0-9;]*[RcnIO]$/.test(data)) session.lastInputAt = new Date().toISOString();
    if (data.includes('\r') || submit) {
      this.beginDiscovery(session);
      // Antigravity's first Enter can be login, theme or workspace-trust setup.
      // Only its native conversation event proves there is history to resume.
      if (!['shell', 'antigravity'].includes(session.agent)) session.hasConversation = true;
      session.updatedAt = new Date().toISOString();
    }
    this.changed(session);
    return { delivered: true, sessionId: id, name: session.name, note: 'Text delivered to the terminal. Check the screen for CLI readiness or permission prompts; delivery does not confirm the agent accepted the task.' };
  }

  // Keys Mr. Mak presses on the user's behalf, such as menu navigation. They are
  // not manual typing, so a message sent right after them is not held back.
  keys(id, data) {
    const session = this.get(id);
    if (!session.process) throw new Error('This terminal is stopped. Resume it before sending a message.');
    session.process.write(data);
    session.attention = false;
    this.changed(session);
  }

  resize(id, cols, rows) {
    const session = this.get(id);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 500 || rows < 5 || rows > 200) return;
    if (session.cols === cols && session.rows === rows) return;
    session.cols = cols; session.rows = rows;
    session.terminal?.resize(cols, rows);
    session.process?.resize(cols, rows);
    this.emit('terminal-resized', { id, cols, rows });
    this.dirty = true;
  }
  rename(id, name) { const session = this.get(id); session.name = englishTitle(name, session.name); this.changed(session); return publicSession(session); }
  pin(id, value) {
    const session = this.get(id);
    if (session.pinned !== !!value) {
      session.pinned = !!value;
      session.tabOrder = Math.max(-1, ...this.list().filter(item => item.id !== id && item.pinned === session.pinned).map(item => item.tabOrder)) + 1;
      this.changed(session);
    }
    return publicSession(session);
  }
  color(id, value) {
    if (value !== null && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new Error('Choose a valid tab color.');
    const session = this.get(id); session.tabColor = value?.toLowerCase() || null; this.changed(session);
    return publicSession(session);
  }
  // Name a group after each open tab's project folder and place each project's
  // tabs together, in the order of its first tab. A group that already holds
  // only that folder keeps its name.
  async groupByProject() {
    const open = [...this.items.values()].filter(item => item.open).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.tabOrder - b.tabOrder);
    const projects = new Map();
    for (const item of open) {
      const key = projectKey(item.cwd);
      if (!projects.has(key)) projects.set(key, []);
      projects.get(key).push(item);
    }
    const reserved = new Map();
    for (const item of this.items.values()) {
      if (!item.group) continue;
      if (!reserved.has(item.group)) reserved.set(item.group, new Set());
      reserved.get(item.group).add(projectKey(item.cwd));
    }
    const names = new Map();
    for (const [key, members] of projects) {
      const existing = [...reserved].find(([, folders]) => folders.size === 1 && folders.has(key));
      if (existing) { names.set(key, existing[0]); continue; }
      let base = members[0].cwd.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 50) || 'Project';
      try { base = groupLabel(base) || 'Project'; } catch { base = 'Project'; }
      if (Object.hasOwn(Object.prototype, base)) base += ' project';
      let name = base, suffix = 2;
      while (reserved.has(name)) name = `${base} (${suffix++})`;
      reserved.set(name, new Set([key])); names.set(key, name);
    }
    let order = 0;
    for (const pinned of [true, false]) {
      const keys = [...new Set(open.filter(item => !!item.pinned === pinned).map(item => projectKey(item.cwd)))];
      for (const key of keys) for (const item of projects.get(key).filter(item => !!item.pinned === pinned)) {
        const group = names.get(key), tabOrder = order++;
        if (item.group !== group || item.tabOrder !== tabOrder) { item.group = group; item.tabOrder = tabOrder; this.changed(item); }
      }
    }
    await this.persist();
    return { grouped: open.length, groups: projects.size };
  }
  // Open tabs are grouped by project when each folder's tabs share one group that
  // holds only that folder. The frontend (chatOrder.ts) mirrors this.
  projectGrouped() {
    const open = this.active(), groups = new Map(), folders = new Map();
    for (const item of open) {
      const key = projectKey(item.cwd);
      if (!item.group || (groups.get(key) ?? item.group) !== item.group || (folders.get(item.group) ?? key) !== key) return false;
      groups.set(key, item.group); folders.set(item.group, key);
    }
    return open.length > 0;
  }
  // The header's project button. Ungrouping keeps the visible order, and closed
  // chats keep their group, so grouping again restores the same names.
  async toggleProjectGroups() {
    if (!this.projectGrouped()) return this.groupByProject();
    for (const [tabOrder, { id }] of this.active().entries()) {
      const item = this.items.get(id);
      if (item.group || item.tabOrder !== tabOrder) { item.group = null; item.tabOrder = tabOrder; this.changed(item); }
    }
    await this.persist();
    return { grouped: 0, groups: 0 };
  }
  async assign(id, value) {
    const session = this.get(id);
    const group = groupLabel(value);
    if (session.group === group) return publicSession(session);
    session.group = group;
    this.changed(session);
    // Joining a group places the tab after that group's last open member, as a
    // drag there would. Leaving a group keeps the tab where it is.
    const last = group && session.open ? this.active().filter(item => item.id !== id && item.pinned === session.pinned && item.group === group).at(-1) : null;
    if (last) await this.reorder(id, last.id, 'after');
    else await this.persist();
    return publicSession(session);
  }
  async reorder(id, targetId, position) {
    const session = this.get(id), target = this.get(targetId);
    if (!['before', 'after'].includes(position)) throw new Error('Choose a valid tab position.');
    if (!session.open || !target.open) throw new Error('Only open tabs can be reordered.');
    if (session.pinned !== target.pinned) throw new Error('Pinned tabs stay together. Move a tab within the pinned or the unpinned tabs.');
    if (id === targetId) return this.active();
    // Dropping beside a tab of another group joins that group; dropping beside an
    // ungrouped tab leaves the current group.
    if (session.group !== target.group) { session.group = target.group; this.changed(session); }
    // Retain closed chats between their neighbours so reopening History keeps
    // their place. Reordering pinned tabs cannot affect unpinned tabs.
    const siblings = this.list().filter(item => item.pinned === session.pinned && item.id !== id);
    siblings.splice(siblings.findIndex(item => item.id === targetId) + Number(position === 'after'), 0, publicSession(session));
    siblings.forEach((item, index) => { const changed = this.get(item.id); if (changed.tabOrder !== index) { changed.tabOrder = index; this.changed(changed); } });
    await this.persist();
    return this.active();
  }
  // A group moves as one block, closed members included, beside an ungrouped
  // tab or beside the whole of another group, never into the middle of one.
  async moveGroup(name, pinned, targetId, position) {
    const group = groupLabel(name), target = this.get(targetId);
    if (!['before', 'after'].includes(position)) throw new Error('Choose a valid tab position.');
    if (!target.open) throw new Error('Only open tabs can be reordered.');
    if (target.pinned !== !!pinned) throw new Error('Pinned tabs stay together. Move a group within the pinned or the unpinned tabs.');
    const siblings = this.list().filter(item => item.pinned === target.pinned);
    const block = siblings.filter(item => item.group === group);
    if (!group || !block.some(item => item.open)) throw Object.assign(new Error('That group has no open tabs.'), { status: 404 });
    if (target.group === group) return this.active();
    const rest = siblings.filter(item => item.group !== group);
    const anchor = rest.map((item, index) => (target.group ? item.group === target.group : item.id === targetId) ? index : -1).filter(index => index >= 0);
    rest.splice(position === 'after' ? anchor.at(-1) + 1 : anchor[0], 0, ...block);
    rest.forEach((item, index) => { const changed = this.get(item.id); if (changed.tabOrder !== index) { changed.tabOrder = index; this.changed(changed); } });
    await this.persist();
    return this.active();
  }
  // Renaming relabels every chat in the group, History included. A name another
  // group already uses merges the two.
  async renameGroup(from, to) {
    const source = groupLabel(from), name = groupLabel(to);
    if (!name) throw new Error('Name the group.');
    const members = [...this.items.values()].filter(item => source && item.group === source);
    if (!members.length) throw Object.assign(new Error('That group no longer exists.'), { status: 404 });
    if (name !== source) {
      for (const session of members) { session.group = name; this.changed(session); }
      await this.persist();
    }
    return this.active();
  }
  // Deleting a group ungroups every chat that carries it, History included;
  // the chats themselves stay. Unlike ungrouping from a chip, this also
  // reaches a group that no open tab shows any more.
  async deleteGroup(name) {
    const label = groupLabel(name);
    if (!label) throw new Error('Name the group.');
    const members = [...this.items.values()].filter(item => item.group === label);
    for (const session of members) { session.group = null; this.changed(session); }
    if (members.length) await this.persist();
    return { removed: members.length, history: members.filter(item => !item.open).length };
  }
  async clearScreen(id) {
    const session = this.get(id); await this.hydrate(session);
    session.terminal.clear(); this.dirty = true;
    await this.persist(); this.emit('screen-cleared', { id });
    return { cleared: true, note: 'Visible scrollback cleared. The native agent conversation is unchanged.' };
  }
  attend(id, reason) {
    const session = this.get(id);
    if (session.attention) return;
    session.attention = true;
    this.changed(session);
    this.emit('notice', { id: randomUUID(), sessionId: id, name: session.name, kind: 'attention', text: `${session.name}: ${reason}`, at: new Date().toISOString() });
  }
  seen(id, completionVersion) {
    const session = this.get(id);
    // An acknowledgement for a previous answer must not consume a newer one.
    if (!session.unread || completionVersion !== session.completionVersion) return;
    session.unread = false; session.attention = false; this.changed(session);
  }
  async nativeBoundary(session, resumeId) {
    const file = !resumeId ? null : session.agent === 'codex' ? await codexTranscript(resumeId) : session.agent === 'claude' ? await claudeTranscript(session.cwd, resumeId) : null;
    return file ? { file, offset: (await stat(file).catch(() => null))?.size || 0 } : null;
  }
  stop(id) { const session = this.get(id); this.requestStop(session); return { stopped: !!session.process }; }
  requestStop(session) {
    const proc = session.process;
    if (!proc) return;
    if (!['opencode', 'antigravity', 'claude'].includes(session.agent)) { proc.kill(); return; }
    // Let OpenCode flush and close its SQLite store before ConPTY is destroyed,
    // and let Claude leave its fullscreen renderer the way it expects: a killed
    // fullscreen session counts as a failed start on its side, and two of those
    // switch later sessions to the classic renderer.
    // Ctrl+C cancels work; a second press exits the native TUI. Custom keymaps
    // or an unresponsive CLI still have a bounded hard-stop fallback.
    proc.write('\x03');
    setTimeout(() => { try { if (session.process === proc) proc.write('\x03'); } catch { /* Process already exited. */ } }, 500).unref();
    setTimeout(() => { try { if (session.process === proc) proc.kill(); } catch { /* Process already exited. */ } }, 3500).unref();
  }
  async resume(id, nativeId) {
    nativeConversationId(nativeId);
    if (this.closed) throw new Error('Mr. Mak is shutting down');
    const session = this.get(id);
    if (session.stopping) await session.stopping;
    if (session.process) return publicSession(session);
    if (!session.open && this.active().length >= 80) throw new Error('Close a tab before opening another.');
    await this.hydrate(session);
    if (!nativeId) await this.recoverNative(session);
    let resumeId = nativeId || session.nativeId;
    // A terminal closed before its first prompt may have no native conversation yet.
    if (session.agent === 'claude' && resumeId && !nativeId && !(await stat(await claudeTranscript(session.cwd, resumeId)).catch(() => null))) resumeId = null;
    if (session.agent !== 'shell' && !resumeId && session.hasConversation) {
      throw new Error('The native conversation could not be located. Your last screen is retained; use New chat → Resume to connect its CLI ID.');
    }
    if (resumeId) session.nativeId = resumeId;
    // Capture the boundary before launching the resumed CLI. Even an immediate
    // submitted task must be observed, while historic answers stay acknowledged.
    const nativeWatch = await this.nativeBoundary(session, resumeId);
    if (session.process) return publicSession(session);
    session.open = true; session.updatedAt = new Date().toISOString();
    if (session.launching) await session.launching;
    else {
      session.launching = this.launch(session, resumeId, nativeWatch);
      try { await session.launching; } finally { session.launching = null; }
    }
    await this.persist();
    return publicSession(session);
  }
  async remove(id) {
    const session = this.get(id);
    // Capture an ID even if the user closes before background discovery runs.
    await this.recoverNative(session);
    session.open = false; session.updatedAt = new Date().toISOString();
    if (session.process && !session.stopping) {
      const proc = session.process;
      session.stopping = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { subscription.dispose(); reject(new Error('The terminal is still closing. Try reopening it in a moment.')); }, 8000);
        const subscription = proc.onExit(() => { clearTimeout(timeout); subscription.dispose(); resolve(); });
        try { this.requestStop(session); } catch (error) { clearTimeout(timeout); subscription.dispose(); reject(error); }
      }).finally(() => { session.stopping = null; });
    }
    this.changed(session);
    if (session.stopping) await session.stopping;
    await this.persist();
    return publicSession(session);
  }
  async persist() {
    this.saveChain = this.saveChain.catch(() => {}).then(async () => {
      this.dirty = false;
      await saveJson(path.join(this.stateDir, 'sessions.json'), this.list());
      let screenError;
      for (const session of this.items.values()) {
        if (!session.terminal) continue;
        try {
          await new Promise(resolve => session.terminal.write('', resolve));
          const data = session.serializer.serialize({ scrollback: 1500 });
          if (data === session.savedScreen) continue;
          await saveJson(path.join(this.stateDir, `screen-${session.id}.json`), { data });
          session.savedScreen = data;
        } catch (error) { screenError ??= error; }
      }
      if (screenError) throw screenError;
    }).catch(error => {
      // A failed screen must not prevent the remaining chats from saving or
      // disappear from the next autosave when there is no further output.
      this.dirty = true;
      throw error;
    });
    return this.saveChain;
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    // Preserve the open-tab flags on app quit while giving OpenCode time to
    // close the database used by the next launch.
    await Promise.all([...this.items.values()].filter(s => ['opencode', 'antigravity', 'claude'].includes(s.agent) && s.process).map(session => new Promise(resolve => {
      const proc = session.process;
      const timer = setTimeout(() => { subscription.dispose(); resolve(); }, 5000);
      const subscription = proc.onExit(() => { clearTimeout(timer); subscription.dispose(); resolve(); });
      try { this.requestStop(session); } catch { clearTimeout(timer); subscription.dispose(); resolve(); }
    })));
    for (const session of this.items.values()) { session.stopNativeWatch?.(); session.process?.kill(); this.flushOutput(session); }
    await this.persist();
    for (const session of this.items.values()) session.terminal?.dispose();
  }
}
