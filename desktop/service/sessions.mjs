import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import pty from 'node-pty';
import headless from '@xterm/headless';
import { TerminalSnapshotAddon } from './terminal-snapshot.mjs';
import { terminalCommand, childEnvironment } from './agents.mjs';
import { readJson, saveJson } from './util.mjs';
import { claudeTranscript, codexTranscript, tailNativeFile } from './native-events.mjs';
import { findCodexChat } from './codex-history.mjs';
import { englishTitle, restoredTitle } from './titles.mjs';
import { defaultWorkerEffort, workerEfforts } from './effort.mjs';
import { ptyOptions } from './platform.mjs';
import { opencodeVersion, opencodeEnvironment, readOpencodeState, watchOpencode } from './opencode.mjs';

const { Terminal } = headless;
const publicSession = session => {
  const { id, name, agent, cwd, bypass, effort, status, createdAt, lastOutputAt, lastInputAt, exitCode, nativeId, attention, activity, unread, completionVersion, lastCompletedId, cols, rows, open, pinned, tabOrder, tabColor, updatedAt, preview, hasConversation, restoreError } = session;
  return { id, name, agent, cwd, bypass, effort, status, createdAt, lastOutputAt, lastInputAt, exitCode, nativeId, attention, activity, unread, completionVersion, lastCompletedId, cols, rows, open, pinned, tabOrder, tabColor, updatedAt, preview, hasConversation, restoreError };
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
    return { activity: 'idle', unread: false, completionVersion: 0, tabOrder: this.items.size, tabColor: null, ...metadata, effort: ['codex', 'claude'].includes(metadata.agent) ? metadata.effort || defaultWorkerEffort : undefined, terminal: null, serializer: null, process: null, sequence: 0, pendingOutput: '', outputTimer: null };
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
    })();
    try { await session.hydrating; } finally { session.hydrating = null; }
  }

  list() { return [...this.items.values()].map(publicSession).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.tabOrder - b.tabOrder); }
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
    if (options.effort && !workerEfforts.includes(options.effort)) throw new Error('Reasoning effort must be medium, high, xhigh or max.');
    const cwd = path.resolve(options.cwd || this.repo);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Working folder must be a directory');
    const now = new Date().toISOString();
    const session = this.make({
      id: randomUUID(), agent, name: englishTitle(options.name, `Conversation ${this.items.size + 1}`),
      tabOrder: Math.max(-1, ...this.list().map(item => item.tabOrder)) + 1,
      cwd, bypass: options.bypass === true, createdAt: now, lastInputAt: null, lastOutputAt: null,
      effort: options.effort,
      status: 'starting', nativeId: options.resumeId || (agent === 'claude' ? randomUUID() : null),
      open: true, pinned: false, updatedAt: now, preview: '', hasConversation: !!options.resumeId, restoreError: null,
      attention: false, cols: Math.min(500, Math.max(20, options.cols || 90)), rows: Math.min(200, Math.max(5, options.rows || 32)),
    });
    this.items.set(session.id, session);
    await this.hydrate(session);
    try { await this.launch(session, options.resumeId, await this.nativeBoundary(session, options.resumeId)); }
    catch (error) { this.items.delete(session.id); session.terminal.dispose(); throw error; }
    await this.persist();
    return publicSession(session);
  }

  async importConversation({ agent, nativeId, name, cwd, pinned = false, bypass = false }) {
    if (!['codex', 'claude', 'opencode', 'kimi'].includes(agent) || typeof nativeId !== 'string' || !nativeId.trim()) throw new Error('Choose an agent and its native conversation ID.');
    nativeId = nativeId.trim();
    cwd = path.resolve(cwd || this.repo);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Working folder must be a directory');
    const existing = [...this.items.values()].find(item => item.agent === agent && item.nativeId === nativeId);
    if (existing) { existing.name = englishTitle(name, existing.name); existing.pinned = pinned; this.changed(existing); await this.persist(); return publicSession(existing); }
    const now = new Date().toISOString();
    const session = this.make({ id: randomUUID(), agent, nativeId, name: englishTitle(name), cwd: path.resolve(cwd || this.repo), bypass, pinned, open: false, status: 'stopped', createdAt: now, updatedAt: now, hasConversation: true, lastInputAt: null, lastOutputAt: null, preview: '', cols: 90, rows: 32, attention: false });
    this.items.set(session.id, session); this.changed(session); await this.persist();
    return publicSession(session);
  }

  async launch(session, resumeId, nativeWatch) {
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
    const command = terminalCommand(session.agent, { bypass: session.bypass, resumeId, nativeId: session.nativeId, effort: session.effort, opencodeMajor });
    if (session.agent === 'codex') env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = `mrmak_chat_${session.id}`;
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
    session.stopNativeWatch = tailNativeFile(file, session.agent, event => this.nativeEvent(session, event), offset);
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
    if (session.agent === 'opencode' && !session.nativeId) {
      const state = await readOpencodeState(this.stateDir, session.id);
      if (state) this.bindNative(session, { id: state.nativeId });
      return;
    }
    if (session.agent !== 'codex' || session.nativeId) return;
    this.bindNative(session, await findCodexChat(session, { full: true }));
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
      if (session.agent !== 'shell') session.hasConversation = true;
      session.updatedAt = new Date().toISOString();
    }
    this.changed(session);
    return { delivered: true, sessionId: id, name: session.name, note: 'Text delivered to the terminal. Check the screen for CLI readiness or permission prompts; delivery does not confirm the agent accepted the task.' };
  }

  resize(id, cols, rows) {
    const session = this.get(id);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 500 || rows < 5 || rows > 200) return;
    if (session.cols === cols && session.rows === rows) return;
    session.cols = cols; session.rows = rows;
    session.terminal?.resize(cols, rows);
    session.process?.resize(cols, rows);
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
  async reorder(id, targetId, position) {
    const session = this.get(id), target = this.get(targetId);
    if (!['before', 'after'].includes(position)) throw new Error('Choose a valid tab position.');
    if (!session.open || !target.open) throw new Error('Only open tabs can be reordered.');
    if (session.pinned !== target.pinned) throw new Error('Pinned tabs stay together. Reorder within the same group.');
    if (id === targetId) return this.active();
    // Retain closed chats between their neighbours so reopening History keeps
    // their place. Reordering one group cannot affect the other group.
    const group = this.list().filter(item => item.pinned === session.pinned && item.id !== id);
    group.splice(group.findIndex(item => item.id === targetId) + Number(position === 'after'), 0, publicSession(session));
    group.forEach((item, index) => { const changed = this.get(item.id); if (changed.tabOrder !== index) { changed.tabOrder = index; this.changed(changed); } });
    await this.persist();
    return this.active();
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
    if (session.agent !== 'opencode') { proc.kill(); return; }
    // Let OpenCode flush and close its SQLite store before ConPTY is destroyed.
    // Ctrl+C cancels work; a second press exits the native TUI. Custom keymaps
    // or an unresponsive CLI still have a bounded hard-stop fallback.
    proc.write('\x03');
    setTimeout(() => { try { if (session.process === proc) proc.write('\x03'); } catch { /* Process already exited. */ } }, 500).unref();
    setTimeout(() => { try { if (session.process === proc) proc.kill(); } catch { /* Process already exited. */ } }, 3500).unref();
  }
  async resume(id, nativeId) {
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
    this.dirty = false;
    this.saveChain = this.saveChain.catch(() => {}).then(async () => {
      await saveJson(path.join(this.stateDir, 'sessions.json'), this.list());
      for (const session of this.items.values()) {
        if (!session.terminal) continue;
        await new Promise(resolve => session.terminal.write('', resolve));
        await saveJson(path.join(this.stateDir, `screen-${session.id}.json`), { data: session.serializer.serialize({ scrollback: 1500 }) });
      }
    });
    return this.saveChain;
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    // Preserve the open-tab flags on app quit while giving OpenCode time to
    // close the database used by the next launch.
    await Promise.all([...this.items.values()].filter(s => s.agent === 'opencode' && s.process).map(session => new Promise(resolve => {
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
