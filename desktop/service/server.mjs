import http from 'node:http';
import path from 'node:path';
import { readFile, stat, realpath } from 'node:fs/promises';
import { watch } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseEnv } from 'dotenv';
import { Sessions } from './sessions.mjs';
import { Coordinator } from './coordinator.mjs';
import { Files, serveFile } from './files.mjs';
import { importFile, dragFiles, moveFile, recyclePath, MAX_FILE_BYTES } from './file-transfers.mjs';
import { inventory } from './agents.mjs';
import { Attachments, attachmentText, MAX_IMAGE_BYTES } from './attachments.mjs';
import { ContextLibrary } from './context.mjs';
import { taskTitle } from './titles.mjs';
import { taskEffort } from './effort.mjs';
import { Workspace, localDay, metadataPatch } from './workspace.mjs';
import { QuickActions } from './quick-actions.mjs';
import { defaultVoiceStyle, voiceSession } from './voice-profile.mjs';
import { NativeSettings } from './native-settings.mjs';
import { McpInventory } from './mcp.mjs';
import { body, equalSecret, json, publicError, readJson, realFile, saveJson, secret } from './util.mjs';
import { ProjectAdapterRegistry } from './project-adapters/registry.mjs';
import { KnowledgeManager, MarkdownKnowledgeProvider } from './knowledge/providers.mjs';
import { IntegrationManager } from './integrations/manager.mjs';
import { MobileDictation } from './mobile-dictation.mjs';
import { MobileGateway } from './mobile.mjs';

const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });

export async function createService({ repo, uiDir, stateDir, token = secret(), native = () => {}, restoreSessions = false, mcpOptions, mobileOptions }) {
  repo = await realpath(repo);
  stateDir ||= path.join(repo, '.mrmak');
  const dictation = mobileOptions?.dictation || new MobileDictation(repo);
  const files = new Files(repo);
  const attachments = new Attachments(repo);
  const library = new ContextLibrary(repo);
  const knowledgeSources = await readJson(path.join(stateDir, 'knowledge-sources.json'), []);
  const knowledgeProviders = (Array.isArray(knowledgeSources) ? knowledgeSources : []).filter(item => typeof item?.root === 'string').map(item => new MarkdownKnowledgeProvider(item.root, { id: item.id, label: item.label }));
  const knowledge = new KnowledgeManager(library, knowledgeProviders);
  const projects = new ProjectAdapterRegistry();
  const integrations = await new IntegrationManager(stateDir).init();
  const mcp = new McpInventory(repo, mcpOptions);
  const sessions = await new Sessions(repo, stateDir).init();
  const environment = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
  const settingsPath = path.join(stateDir, 'settings.json');
  let settings = { defaultAgent: 'codex', defaultBypass: false, coordinatorModel: environment.MRMAK_COORDINATOR_MODEL?.trim() || null, terminalFontSize: 13, terminalAppearance: 'original', workspaceTheme: 'dark', coordinatorEffort: 'medium', voiceName: 'cedar', voiceStyle: defaultVoiceStyle, ...await readJson(settingsPath, {}) };
  dictation.providerChoice = () => settings.transcribeProvider || null;
  const chooseDictation = async provider => {
    if (!['local', 'openai', 'openrouter', 'off'].includes(provider)) throw Object.assign(new Error('Choose a supported speech-to-text provider.'), { status: 400 });
    settings.transcribeProvider = provider; await saveSettings();
    const info = await dictation.status();
    broadcast('settings', { settings }); broadcast('dictation', { dictation: info });
    mobile?.broadcast({ type: 'dictation', dictation: info });
    return info;
  };
  let selectedId = sessions.active().some(item => item.id === settings.selectedId) ? settings.selectedId : sessions.active()[0]?.id || null;
  let workspaceRoute = settings.workspaceRoute || null;
  let settingsTimer;
  let settingsSave = Promise.resolve();
  const saveSettings = () => { settingsSave = settingsSave.catch(() => {}).then(() => saveJson(settingsPath, settings)); return settingsSave; };
  const scheduleSettings = () => { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => saveSettings().catch(() => {}), 500); };
  const transcriptPath = path.join(stateDir, 'voice-transcripts.json');
  let voiceHistory = await readJson(transcriptPath, []);
  let transcriptSave = Promise.resolve();
  let voiceOwner = null;
  let closing = false;
  const clients = new Set();
  let mobile;
  const notices = [];
  const send = (ws, type, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...value })); };
  const broadcast = (type, value) => { for (const ws of clients) send(ws, type, value); };
  const nativeSettings = new NativeSettings(native, value => broadcast('native-settings', value));
  const show = (window, extra = {}) => { native({ type: 'window', action: 'show', window }); broadcast('navigate', { window, ...extra }); };
  const focus = id => { sessions.get(id); selectedId = id; settings.selectedId = id; scheduleSettings(); show('chats', { sessionId: id }); return { selectedId: id }; };
  const registry = async () => readJson(path.join(repo, 'workspace', 'workspace.json'), { entities: [] });
  const workspace = new Workspace(repo, () => broadcast('workspace-changed', {}));
  const history = query => sessions.list().filter(item => !query || `${item.name} ${item.agent} ${item.cwd} ${item.preview || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const closeChat = async id => {
    await sessions.remove(id);
    if (selectedId === id) { selectedId = sessions.active()[0]?.id || null; settings.selectedId = selectedId; scheduleSettings(); broadcast('selection', { selectedId }); }
    return { closed: true, savedInHistory: true };
  };
  const attach = async (id, paths, coordinator = false) => {
    const session = sessions.get(id);
    const verified = await attachments.paths(paths);
    sessions.input(id, attachmentText(verified, session.agent), { coordinator, submit: false });
    return { attached: verified, submitted: false };
  };
  const coordinator = await new Coordinator({
    repo, stateDir, orientation: () => library.orientation(), settings: () => settings,
    context: () => ({ repo, localDate: localDay(), selectedId, workspaceRoute, chats: sessions.active(), recentNotices: notices.slice(-5), recentRequests: [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-6).map(({ text, result, status }) => ({ text, result, status })) }),
    execute: async (name, args, operationId, requestText) => {
      const latestRequest = requestText || coordinator.operations.get(operationId)?.text || '';
      switch (name) {
        case 'list_chats': return sessions.active();
        case 'search_history': return history(args.query || '').slice(0, 70);
        case 'reopen_chat': { const session = await sessions.resume(args.id); focus(session.id); return session; }
        case 'close_chat': return closeChat(args.id);
        case 'pin_chat': return sessions.pin(args.id, args.pinned);
        case 'open_chat': {
          if (args.bypass != null && typeof args.bypass !== 'boolean') throw new Error('Choose a valid chat permission setting.');
          if (args.bypass === true && settings.defaultBypass !== true) throw new Error('To enable bypass, choose it yourself in New chat or Settings. Mr. Mak cannot raise the selected permission level.');
          const session = await sessions.create({ ...args, name: taskTitle(args.name), effort: taskEffort(latestRequest, args.effort), bypass: args.bypass === false ? false : settings.defaultBypass === true });
          focus(session.id); return session;
        }
        case 'read_chat': return sessions.read(args.id);
        case 'send_to_chat': return sessions.input(args.id, args.text, { coordinator: true, submit: true });
        case 'attach_files': return attach(args.id, args.paths, true);
        case 'focus_chat': return focus(args.id);
        case 'rename_chat': return sessions.rename(args.id, args.name);
        case 'interrupt_chat': sessions.input(args.id, '\x03'); return { delivered: 'Ctrl+C', sessionId: args.id };
        case 'list_workspace': return workspace.list(args);
        case 'read_workspace': return workspace.read(args.entityId, args.step);
        case 'workspace_activity': return workspace.activity(args.date);
        case 'update_workspace': return workspace.update(args.entityId, args);
        case 'show_workspace': {
          if (args.entityId && !(await registry()).entities.some(item => item.id === args.entityId)) throw new Error('Workspace report does not exist');
          workspaceRoute = args.entityId ? `#/${encodeURIComponent(args.entityId)}${Number.isInteger(args.step) ? '/' + args.step : ''}` : null;
          settings.workspaceRoute = workspaceRoute; scheduleSettings();
          show('workspace', { route: workspaceRoute }); return { shown: true, route: workspaceRoute };
        }
        case 'preview_file': { const preview = await files.preview(args.path); show('workspace', { preview }); return { shown: preview.path }; }
        case 'list_files': return files.list(args.path || repo, 'all', args.query || '');
        case 'search_context': return knowledge.searchText(args.query);
        case 'read_context': return knowledge.read(args.path, args.offset);
        case 'list_skills': return knowledge.skills(args.query || '');
        case 'list_mcp': return mcp.list();
        case 'get_app_settings': return { voice: settings.voiceName, style: settings.voiceStyle, model: coordinator.model || 'Codex default', effort: settings.coordinatorEffort, billing: 'Codex subscription for the coordinator; OpenAI API for voice' };
        case 'update_voice': {
          if (typeof args.style === 'string' && args.style.trim()) settings.voiceStyle = args.style.trim().slice(0, 1800);
          if (['cedar', 'marin'].includes(args.voice)) settings.voiceName = args.voice;
          await saveSettings(); broadcast('settings', { settings });
          return { saved: true, voice: settings.voiceName, style: settings.voiceStyle, applies: 'Next voice connection. Reconnect to apply the saved voice and personality.' };
        }
        default: throw new Error('Unknown coordinator tool');
      }
    },
  }).init();
  const quick = await new QuickActions({ stateDir, workspace, context: () => ({ chats: sessions.active(), route: workspaceRoute }), execute: (...args) => coordinator.execute(...args), completed: operation => broadcast('coordinator-result', { operation }) }).init();
  const askMak = async data => {
    if (coordinator.operationPromises.has(data.id) || coordinator.operations.has(data.id)) return coordinator.ask(data);
    const images = await attachments.coordinatorImages(data.images);
    if (images.length) return coordinator.ask({ ...data, images });
    return await quick.ask(data) || coordinator.ask({ ...data, images });
  };
  coordinator.on('state', state => broadcast('coordinator-state', { state }));
  coordinator.on('result', operation => broadcast('coordinator-result', { operation }));
  coordinator.on('error-detail', error => broadcast('service-error', { error }));
  sessions.on('session', session => { broadcast('session', { session }); integrations.publish('session', { event: session.status, session }).catch(() => {}); });
  sessions.on('screen-cleared', ({ id }) => broadcast('screen-cleared', { id }));
  sessions.on('service-error', error => broadcast('service-error', { error: publicError(error) }));
  sessions.on('output', output => {
    for (const ws of clients) {
      if (ws.sessionId !== output.id) continue;
      if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'Reconnect to restore the terminal screen'); continue; }
      send(ws, 'output', output);
    }
  });
  sessions.on('notice', notice => { notices.push(notice); if (notices.length > 100) notices.shift(); broadcast('notice', { notice }); if (notice.kind === 'turn-completed' || notice.kind === 'exit') integrations.publish('completion', notice).catch(() => {}); });

  const contentServer = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(files.origin).host || !['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 403 });
      await files.content(request, response, new URL(request.url, files.origin));
    } catch (error) { if (!response.headersSent) json(response, error.status || 404, { error: publicError(error) }); }
  });
  files.origin = await listen(contentServer);

  function authorize(request) {
    if (request.headers.host !== new URL(origin).host) throw Object.assign(new Error('Unexpected host'), { status: 403 });
    if (request.headers.origin && request.headers.origin !== origin) throw Object.assign(new Error('Unexpected origin'), { status: 403 });
    if (!equalSecret(request.headers.authorization, `Bearer ${token}`)) throw Object.assign(new Error('Open Mr. Mak from its desktop launcher'), { status: 401 });
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (request.headers.host !== new URL(origin).host) throw Object.assign(new Error('Unexpected host'), { status: 403 });
      if (url.pathname === '/health') return json(response, 200, { service: 'mrmak', version: '0.5.0' });
      if (url.pathname.startsWith('/api/')) {
        authorize(request);
        const method = request.method;
        if (method === 'POST' && url.pathname === '/api/files/import') {
          if (Number(request.headers['content-length']) > MAX_FILE_BYTES) throw Object.assign(new Error('Choose files of 1 GB or less.'), { status: 413 });
          const result = await importFile(request, url.searchParams.get('folder'), url.searchParams.get('name'));
          await integrations.publish('artifact', { kind: 'imported', ...result });
          broadcast('workspace-changed', {});
          return json(response, 201, result);
        }
        if (method === 'POST' && url.pathname === '/api/attachments') {
          const chunks = []; let length = 0;
          for await (const chunk of request) { length += chunk.length; if (length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Choose an image smaller than 25 MB.'), { status: 413 }); chunks.push(chunk); }
          return json(response, 201, await attachments.save(Buffer.concat(chunks), decodeURIComponent(request.headers['x-file-name'] || 'Screenshot')));
        }
        if (method === 'GET' && url.pathname === '/api/dictation') return json(response, 200, await dictation.status());
        if (method === 'POST' && url.pathname === '/api/transcribe') return json(response, 200, await dictation.transcribe(request, 'desktop', () => !closing));
        const data = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await body(request, url.pathname === '/api/files/markdown' ? 12 * 1024 * 1024 : 256 * 1024) : {};
        if (method === 'POST' && url.pathname === '/api/dictation') return json(response, 200, await chooseDictation(data.provider));
        if (method === 'GET' && url.pathname === '/api/mobile') return json(response, 200, mobile.status());
        if (method === 'GET' && url.pathname === '/api/mobile/check') return json(response, 200, await mobile.transport.probe());
        if (method === 'POST' && url.pathname === '/api/mobile/enable') return json(response, 200, await mobile.enable());
        if (method === 'POST' && url.pathname === '/api/mobile/disable') return json(response, 200, await mobile.disable());
        if (method === 'POST' && url.pathname === '/api/mobile/pair') return json(response, 200, await mobile.newPairing());
        if (method === 'POST' && url.pathname === '/api/mobile/approve') return json(response, 200, await mobile.approve(data.id));
        if (method === 'POST' && url.pathname === '/api/mobile/revoke') return json(response, 200, await mobile.revoke(data.id));
        if (method === 'GET' && url.pathname === '/api/bootstrap') {
          const keys = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
          return json(response, 200, { repo, contentBase: `${files.origin}/view/${files.repoGrant}`, agents: inventory(), sessions: sessions.list(), settings, selectedId, notices, coordinator: coordinator.state, voice: { configured: !!(keys.OPENAI_API_KEY || keys.OPENAI_KEY || process.env.OPENAI_API_KEY), owner: voiceOwner }, voiceHistory, operations: [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-30) });
        }
        if (method === 'GET' && url.pathname === '/api/workspace') return json(response, 200, await registry());
        const cardMetadata = url.pathname.match(/^\/api\/workspace\/entities\/([^/]+)$/);
        if (method === 'PATCH' && cardMetadata) return json(response, 200, await workspace.update(decodeURIComponent(cardMetadata[1]), metadataPatch(data)));
        if (method === 'GET' && url.pathname === '/api/projects') {
          const matches = await projects.detect(url.searchParams.get('path') || repo);
          return json(response, 200, { matches, adapters: projects.adapters.map(item => ({ id: item.id, label: item.label })) });
        }
        if (method === 'GET' && url.pathname === '/api/projects/capabilities') {
          const matches = await projects.detect(url.searchParams.get('path') || repo);
          const selected = matches.find(item => item.adapterId === (url.searchParams.get('adapter') || matches[0]?.adapterId));
          return json(response, 200, selected ? await projects.capabilities(selected) : { matches: [] });
        }
        if (method === 'GET' && url.pathname === '/api/knowledge/providers') return json(response, 200, knowledge.list());
        if (method === 'GET' && url.pathname === '/api/knowledge/search') return json(response, 200, await knowledge.search(url.searchParams.get('q') || '', url.searchParams.get('provider')));
        if (method === 'GET' && url.pathname === '/api/knowledge/document') return json(response, 200, await knowledge.retrieve(url.searchParams.get('provider') || '', url.searchParams.get('ref') || '', url.searchParams.get('offset')));
        if (method === 'GET' && url.pathname === '/api/integrations') return json(response, 200, { providers: integrations.list(), bindings: integrations.bindings.map(({ providerId, externalId, workspaceId, boundAt }) => ({ providerId, externalId, workspaceId, boundAt })) });
        if (method === 'POST' && url.pathname === '/api/integrations/bind') return json(response, 200, await integrations.bind(data));
        if (method === 'GET' && url.pathname === '/api/native/settings') return json(response, 200, nativeSettings.value);
        if (method === 'GET' && url.pathname === '/api/mcp') return json(response, 200, await mcp.list());
        if (method === 'POST' && url.pathname === '/api/mcp/check') return json(response, 200, await mcp.check(data.id));
        if (method === 'POST' && url.pathname === '/api/native/settings') return json(response, 200, await nativeSettings.set(data.winKey));
        if (method === 'GET' && url.pathname === '/api/history') return json(response, 200, history(url.searchParams.get('q') || ''));
        if (method === 'POST' && url.pathname === '/api/history/import') return json(response, 201, await sessions.importConversation(data));
        if (method === 'GET' && url.pathname === '/api/files') return json(response, 200, await files.list(url.searchParams.get('path') || repo, url.searchParams.get('mode') || 'main', url.searchParams.get('q') || ''));
        if (method === 'POST' && url.pathname === '/api/files/pick') {
          if (typeof data.requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(data.requestId)) throw new Error('Invalid file picker request.');
          native({ type: 'pick-files', window: 'chats', requestId: data.requestId });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/files/drag') {
          const paths = await dragFiles(data.paths);
          native({ type: 'drag-files', window: 'workspace', paths });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/files/move') {
          const result = await moveFile(data.path, data.folder);
          broadcast('workspace-changed', {});
          return json(response, 200, result);
        }
        if (method === 'POST' && url.pathname === '/api/files/recycle') {
          const file = await recyclePath(data.path, repo);
          native({ type: 'recycle-file', path: file });
          return json(response, 200, { requested: true, path: file });
        }
        if (method === 'GET' && url.pathname === '/api/preview') return json(response, 200, await files.preview(url.searchParams.get('path') || ''));
        if (method === 'POST' && url.pathname === '/api/files/markdown') {
          const preview = await files.saveMarkdown(data); await integrations.publish('artifact', { kind: 'updated', path: preview.path, name: preview.name }); broadcast('workspace-changed', {});
          return json(response, 200, preview);
        }
        if (method === 'POST' && url.pathname === '/api/settings') {
          if (inventory().some(item => item.id === data.defaultAgent)) settings.defaultAgent = data.defaultAgent;
          if (typeof data.defaultBypass === 'boolean') settings.defaultBypass = data.defaultBypass;
          if (Number.isInteger(data.terminalFontSize) && data.terminalFontSize >= 10 && data.terminalFontSize <= 24) settings.terminalFontSize = data.terminalFontSize;
          if (['focus', 'original'].includes(data.terminalAppearance)) settings.terminalAppearance = data.terminalAppearance;
          if (['dark', 'light', 'system'].includes(data.workspaceTheme)) settings.workspaceTheme = data.workspaceTheme;
          if (['medium', 'high'].includes(data.coordinatorEffort)) settings.coordinatorEffort = data.coordinatorEffort;
          if (['cedar', 'marin'].includes(data.voiceName)) settings.voiceName = data.voiceName;
          await saveSettings(); broadcast('settings', { settings }); return json(response, 200, settings);
        }
        if (method === 'POST' && url.pathname === '/api/sessions') { const session = await sessions.create({ ...data, bypass: data.bypass ?? settings.defaultBypass }); await integrations.publish('session', { event: 'started', session }); focus(session.id); return json(response, 201, session); }
        const sessionRoute = /^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/.exec(url.pathname);
        if (sessionRoute) {
          const [, id, action] = sessionRoute;
          if (method === 'GET' && action === 'screen') return json(response, 200, await sessions.read(id));
          if (method === 'POST' && action === 'focus') return json(response, 200, focus(id));
          if (method === 'POST' && action === 'stop') return json(response, 200, sessions.stop(id));
          if (method === 'POST' && action === 'resume') { const session = await sessions.resume(id, data.nativeId); focus(id); return json(response, 200, session); }
          if (method === 'POST' && action === 'attach') return json(response, 200, await attach(id, data.paths));
          if (method === 'POST' && action === 'clear') return json(response, 200, await sessions.clearScreen(id));
          if (method === 'POST' && action === 'reorder') return json(response, 200, await sessions.reorder(id, data.targetId, data.position));
          if (method === 'POST' && action === 'input') return json(response, 200, sessions.input(id, data.text, { coordinator: data.paste !== false, submit: data.submit !== false }));
          if (method === 'PATCH' && !action) return json(response, 200, typeof data.pinned === 'boolean' ? sessions.pin(id, data.pinned) : 'tabColor' in data ? sessions.color(id, data.tabColor) : sessions.rename(id, data.name));
          if (method === 'DELETE' && !action) return json(response, 200, await closeChat(id));
        }
        if (method === 'POST' && url.pathname === '/api/window') {
          if (!['chats', 'workspace'].includes(data.window) || !['show', 'hide', 'minimize', 'pin'].includes(data.action)) throw new Error('Unknown window action');
          native({ type: 'window', action: data.action, window: data.window, value: !!data.value }); return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/reveal') {
          const file = await realpath(path.resolve(data.path));
          native({ type: 'reveal', path: file }); return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/coordinator') return json(response, 200, await askMak(data));
        if (method === 'POST' && url.pathname === '/api/coordinator/prepare') { await coordinator.start(); return json(response, 200, { ready: true, model: coordinator.model }); }
        if (method === 'POST' && url.pathname === '/api/live/transcript') {
          if (typeof data.id !== 'string' || data.id.length > 200 || !Array.isArray(data.captions)) throw new Error('A voice session and captions are required.');
          const captions = data.captions.slice(-50).filter(item => ['user', 'assistant'].includes(item.role) && typeof item.text === 'string').map(item => ({ role: item.role, text: item.text.slice(0, 1000), start: Number(item.start) || 0, end: Number(item.end) || 0 }));
          const transcript = { id: data.id, at: new Date().toISOString(), captions };
          voiceHistory = [...voiceHistory.filter(item => item.id !== data.id), transcript].slice(-12);
          const snapshot = voiceHistory;
          transcriptSave = transcriptSave.catch(() => {}).then(() => saveJson(transcriptPath, snapshot)); await transcriptSave;
          return json(response, 200, { saved: true });
        }
        if (method === 'POST' && url.pathname === '/api/live/release') {
          if (voiceOwner?.clientId === data.clientId) { voiceOwner = null; broadcast('voice-owner', { owner: null }); }
          return json(response, 200, { released: true });
        }
        if (method === 'POST' && url.pathname === '/api/live/session') {
          if (voiceOwner && voiceOwner.clientId !== data.clientId) throw new Error(`Voice is already active in the ${voiceOwner.surface} window`);
          if (typeof data.sdp !== 'string' || !data.sdp.trim() || typeof data.clientId !== 'string') throw new Error('A microphone connection is required');
          const keys = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
          const key = keys.OPENAI_API_KEY || keys.OPENAI_KEY || process.env.OPENAI_API_KEY;
          if (!key) throw new Error('Add OPENAI_API_KEY to the repository .env, then press the nose again.');
          voiceOwner = { clientId: data.clientId, surface: data.surface === 'chats' ? 'chats' : 'workspace' };
          broadcast('voice-owner', { owner: voiceOwner });
          try {
            const result = await fetch('https://api.openai.com/v1/live/sessions', {
              method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
                body: JSON.stringify({ session: voiceSession(settings), transport: { type: 'webrtc', sdp: data.sdp } }),
            });
            const value = await result.json().catch(() => ({}));
            if (!result.ok) throw new Error(`OpenAI Live (${result.status}): ${value.error?.message || 'Session could not be started'}`);
            return json(response, 201, value);
          } catch (error) { voiceOwner = null; broadcast('voice-owner', { owner: null }); throw error; }
        }
        throw Object.assign(new Error('Endpoint not found'), { status: 404 });
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 405 });
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const { file, info } = await realFile(uiDir, relative);
      if (!info.isFile()) throw new Error('File not found');
      await serveFile(request, response, file, info, {
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: ${files.origin}; media-src 'self' blob: ${files.origin}; connect-src 'self' ws://127.0.0.1:* ${files.origin}; frame-src ${files.origin}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      });
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: publicError(error) }); }
  });
  const origin = await listen(server);
  files.uiOrigin = origin;
  mobile = await new MobileGateway({ ...mobileOptions, dictation, chooseDictation, repo, uiDir, stateDir, sessions, attachments, closeChat, settings: () => settings, changed: state => broadcast('mobile-state', { mobile: state }) }).init();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, origin);
    if (request.headers.host !== new URL(origin).host || request.headers.origin !== origin || url.pathname !== '/events') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.authenticated = false; ws.sessionId = null;
    const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    ws.on('message', async raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (!ws.authenticated) {
          if (message.type !== 'auth' || !equalSecret(message.token, token)) return ws.close(1008, 'Authentication failed');
          ws.authenticated = true; ws.clientId = message.clientId; ws.surface = message.surface; clients.add(ws); clearTimeout(authTimer);
          send(ws, 'connected', { sessions: sessions.list(), selectedId, coordinator: coordinator.state }); return;
        }
        if (message.type === 'subscribe') {
          ws.sessionId = message.id;
          const snapshot = await sessions.snapshot(message.id);
          if (ws.sessionId === message.id) send(ws, 'snapshot', snapshot);
        } else if (message.type === 'input') sessions.input(message.id, message.data);
        else if (message.type === 'resize') sessions.resize(message.id, message.cols, message.rows);
        else if (message.type === 'selected') { sessions.get(message.id); selectedId = message.id; settings.selectedId = selectedId; scheduleSettings(); }
        else if (message.type === 'seen' && ws.surface === 'chats' && ws.sessionId === message.id && selectedId === message.id) sessions.seen(message.id, message.completionVersion);
        else if (message.type === 'workspace-route') { workspaceRoute = String(message.route || '').slice(0, 500); settings.workspaceRoute = workspaceRoute; scheduleSettings(); }
        else if (message.type === 'ping') send(ws, 'pong', {});
      } catch (error) { send(ws, 'service-error', { error: publicError(error) }); }
    });
    ws.on('close', () => { clearTimeout(authTimer); clients.delete(ws); if (voiceOwner?.clientId === ws.clientId) { voiceOwner = null; broadcast('voice-owner', { owner: null }); } });
    ws.on('error', () => {});
  });
  let watcher;
  try { watcher = watch(path.join(repo, 'workspace', 'workspace.json'), () => broadcast('workspace-changed', {})); watcher.on('error', () => {}); } catch { /* Registry may be created after first setup. */ }
  const restoreTimer = restoreSessions ? setTimeout(() => sessions.restore().catch(error => sessions.emit('service-error', error)), 100) : null;
  return {
    origin, contentOrigin: files.origin, token, sessions, coordinator, quick, workspace, files, projects, knowledge, integrations, mobile,
    urls: { workspace: `${origin}/?desktop=1&surface=workspace&token=${token}`, chats: `${origin}/?desktop=1&surface=chats&token=${token}` },
      nativeMessage: event => nativeSettings.receive(event),
      async close() {
        if (closing) return; closing = true; mcp.close(); nativeSettings.close(); await files.writes.catch(() => {});
      watcher?.close(); clearTimeout(restoreTimer); coordinator.close(); clearTimeout(settingsTimer); await saveSettings(); await transcriptSave; await quick.saves; await workspace.writes;
      dictation.close(); await mobile.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close(); await sessions.close();
      server.closeAllConnections(); contentServer.closeAllConnections();
      await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => contentServer.close(resolve))]);
    },
  };
}
