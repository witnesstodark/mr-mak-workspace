import http from 'node:http';
import path from 'node:path';
import { readFile, stat, realpath } from 'node:fs/promises';
import { watch } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseEnv } from 'dotenv';
import { Sessions } from './sessions.mjs';
import { Coordinator, openChatArguments } from './coordinator.mjs';
import { ClaudeCoordinator } from './coordinator-claude.mjs';
import { Overseer } from './overseer.mjs';
import { Files, serveFile } from './files.mjs';
import { importFile, dragFiles, moveFile, recyclePath, MAX_FILE_BYTES } from './file-transfers.mjs';
import { inventory } from './agents.mjs';
import { Attachments, attachmentText, MAX_IMAGE_BYTES } from './attachments.mjs';
import { ContextLibrary } from './context.mjs';
import { groupLabel, taskTitle } from './titles.mjs';
import { taskEffort } from './effort.mjs';
import { Workspace, localDay, metadataPatch } from './workspace.mjs';
import { CardDocuments } from './card-documents.mjs';
import { QuickActions } from './quick-actions.mjs';
import { defaultVoiceStyle, voiceSession } from './voice-profile.mjs';
import { NativeSettings } from './native-settings.mjs';
import { McpInventory } from './mcp.mjs';
import { engineStatus } from './engines.mjs';
import { editGlobalRules, editRules, globalRulesFile, readRules, readRulesAt } from './project-rules.mjs';
import { RuleSuggestions } from './rule-suggestions.mjs';
import { createSkill, discoverSkills } from './skill-discovery.mjs';
import { GameRunner, gameSetupPrompt, readGame, saveGame } from './game-run.mjs';
import { CPU_PRIORITIES } from './platform.mjs';
import { body, equalSecret, json, publicError, readJson, realFile, saveJson, secret, within } from './util.mjs';
import { ProjectAdapterRegistry } from './project-adapters/registry.mjs';
import { KnowledgeManager, MarkdownKnowledgeProvider } from './knowledge/providers.mjs';
import { IntegrationManager } from './integrations/manager.mjs';
import { MobileDictation } from './mobile-dictation.mjs';
import { MobileGateway } from './mobile.mjs';
import { ConversationTranscripts } from './mobile-transcript.mjs';
import { ConversationMedia } from './conversation-media.mjs';
import { projectKey, recentProjects } from './recent-projects.mjs';
import { answerPrompt, readPrompt } from './terminal-prompt.mjs';
import { applyChoice, liveStats, modelOptions, switchingModel } from './chat-models.mjs';
import { EFFORT_ADVICE, EffortAdvisor } from './effort-advice.mjs';
import { rewindToMessage } from './message-edit.mjs';
import { LocalReadAloud } from './local-read-aloud.mjs';
import { Handoffs } from './handoff.mjs';
import { CACHE_TTL_MINUTES, IDLE_CACHE_MINUTES, IDLE_CACHE_MIN_TOKENS } from './context-alerts.mjs';
import { chatCommands } from './chat-commands.mjs';
import { ClaudeSessions, sessionRail } from './claude-sessions.mjs';
import { chatPlan, savePlan, validPlanKey } from './chat-plan.mjs';
import { FileInsights, folderMap } from './file-insights.mjs';
import { ColdGuard, cacheView } from './chat-cache.mjs';
import { SideQuestions } from './side-questions.mjs';
import { isThemePreference } from './appearance.mjs';

// A project folder named by the UI: an existing absolute directory.
async function projectFolder(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new Error('Choose a project folder.');
  const folder = await realpath(value).catch(() => null);
  if (!folder || !(await stat(folder)).isDirectory()) throw new Error('This project folder no longer exists.');
  return folder;
}
const listen = server =>new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });

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
  const transcripts = new ConversationTranscripts();
  const claudeSessions = new ClaudeSessions(), sideQuestions = new SideQuestions(sessions);
  const coldGuard = new ColdGuard();
  const fileInsights = new FileInsights(), ruleSuggestions = new RuleSuggestions(stateDir, transcripts);
  const conversationMedia = new ConversationMedia();
  const readAloud = mobileOptions?.readAloud || new LocalReadAloud(repo);
  const environment = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
  const settingsPath = path.join(stateDir, 'settings.json');
  const savedSettings = await readJson(settingsPath, null);
  let settings = { defaultAgent: 'codex', defaultBypass: false, coordinatorModel: environment.MRMAK_COORDINATOR_MODEL?.trim() || null, terminalFontSize: 13, terminalAppearance: 'original', workspaceTheme: 'dark', coordinatorEffort: 'medium', voiceName: 'cedar', voiceStyle: defaultVoiceStyle, handoffAfter: 40, idleCacheMinutes: IDLE_CACHE_MINUTES, idleCacheMinTokens: IDLE_CACHE_MIN_TOKENS, groupTabsByProject: false, projectOrder: [], usageLimitMode: 'all', usageDirection: 'used', systemEvents: 'compact', agentPriority: 'below-normal', ...savedSettings };
  sessions.priority = settings.agentPriority;
  const effortAdvisor = new EffortAdvisor({ sessions, stateDir, transcripts, mode: () => settings.effortAdvice || 'off' });
  if (settings.groupTabsByProject === true) {
    await sessions.groupByProject(settings.projectOrder);
    settings.groupTabsByProject = false;
    await saveJson(settingsPath, settings);
  }
  if (await dictation.initializeProvider?.(settings, savedSettings !== null)) await saveJson(settingsPath, settings);
  dictation.providerChoice = () => settings.transcribeProvider || null;
  const chooseDictation = async provider => {
    if (!['local', 'openai', 'openrouter', 'off'].includes(provider)) throw Object.assign(new Error('Choose a supported speech-to-text provider.'), { status: 400 });
    settings.transcribeProvider = provider; await saveSettings();
    const info = await dictation.status();
    broadcast('settings', { settings }); broadcast('dictation', { dictation: info });
    mobile?.broadcast({ type: 'dictation', dictation: info });
    return info;
  };
  const projectList = () => recentProjects({ repo, sessions: sessions.list(), pinned: settings.pinnedProjects || [] });
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
  const games = new GameRunner();
  games.on('changed', cwd => broadcast('game', { path: cwd, status: games.status(cwd) }));
  const gameState = async cwd => ({ ...await readGame(cwd), status: games.status(cwd) });
  const nativeSettings = new NativeSettings(native, value => broadcast('native-settings', value));
  const show = (window, extra = {}) => { native({ type: 'window', action: 'show', window }); broadcast('navigate', { window, ...extra }); };
  const focus = id => { sessions.get(id); selectedId = id; settings.selectedId = id; scheduleSettings(); show('chats', { sessionId: id }); return { selectedId: id }; };
  const registry = async () => readJson(path.join(repo, 'workspace', 'workspace.json'), { entities: [] });
  const workspace = new Workspace(repo, () => broadcast('workspace-changed', {}));
  const cards = new CardDocuments(workspace);
  const history = query => sessions.list().filter(item => !query || `${item.name} ${item.agent} ${item.cwd} ${item.preview || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const closeChat = async id => {
    await sessions.remove(id);
    if (selectedId === id) { selectedId = sessions.active()[0]?.id || null; settings.selectedId = selectedId; scheduleSettings(); broadcast('selection', { selectedId }); }
    return { closed: true, savedInHistory: true };
  };
  const handoffs = await new Handoffs({ repo, stateDir, sessions, transcripts, opened: id => focus(id), changed: (id, handoff) => broadcast('handoff', { id, handoff }) }).init();
  const attach = async (id, paths, coordinator = false) => {
    const session = sessions.get(id);
    const verified = await attachments.paths(paths);
    sessions.input(id, attachmentText(verified, session.agent), { coordinator, submit: false });
    return { attached: verified, submitted: false };
  };
  // Talk to Mr. Mak runs on the coordinator the owner chose in Settings.
  const coordinatorOptions = {
    repo, stateDir, toolUrl: () => `${origin}/coordinator/tool`, orientation: () => library.orientation(), settings: () => settings,
    context: () => ({ repo, localDate: localDay(), overseerMode: !!settings.overseer, selectedId, workspaceRoute, chats: sessions.active(), recentNotices: notices.slice(-5), recentRequests: [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-6).map(({ text, result, status }) => ({ text, result, status })) }),
    execute: async (name, args, operationId, requestText) => {
      const latestRequest = requestText || coordinator.operations.get(operationId)?.text || '';
      if (['reopen_chat', 'send_to_chat', 'attach_files'].includes(name)) {
        const target = sessions.get(args.id);
        if (target.agent === 'shell') throw new Error('Use the local shell directly. Mr. Mak can send tasks only to agent chats.');
        if (target.bypass && settings.defaultBypass !== true) throw new Error('This chat uses bypass permissions. Send the task directly, or enable bypass yourself in Settings before using Mr. Mak to control it.');
      }
      switch (name) {
        case 'list_chats': return sessions.active();
        case 'search_history': return history(args.query || '').slice(0, 70);
        case 'list_projects': { const query = String(args.query || '').toLowerCase(); return (await projectList()).filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query)).slice(0, 40); }
        case 'reopen_chat': { const session = await sessions.resume(args.id); focus(session.id); return session; }
        case 'close_chat': return closeChat(args.id);
        case 'pin_chat': return sessions.pin(args.id, args.pinned);
        case 'open_chat': {
          args = openChatArguments(args);
          if (args.bypass === true && settings.defaultBypass !== true) throw new Error('To enable bypass, choose it yourself in New chat or Settings. Mr. Mak cannot raise the selected permission level.');
          const session = await sessions.create({ agent: args.agent, cwd: args.cwd, name: taskTitle(args.name), effort: taskEffort(latestRequest, args.effort), bypass: args.bypass === false ? false : settings.defaultBypass === true });
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
        case 'get_app_settings': return { voice: settings.voiceName, style: settings.voiceStyle, coordinator: coordinator.provider === 'claude' ? 'Claude Code' : 'Codex', model: coordinator.model || 'default', effort: settings.coordinatorEffort, billing: `${coordinator.provider === 'claude' ? 'Claude' : 'Codex'} subscription for the coordinator; OpenAI API for voice` };
        case 'update_voice': {
          if (typeof args.style === 'string' && args.style.trim()) settings.voiceStyle = args.style.trim().slice(0, 1800);
          if (['cedar', 'marin'].includes(args.voice)) settings.voiceName = args.voice;
          await saveSettings(); broadcast('settings', { settings });
          return { saved: true, voice: settings.voiceName, style: settings.voiceStyle, applies: 'Next voice connection. Reconnect to apply the saved voice and personality.' };
        }
        default: throw new Error('Unknown coordinator tool');
      }
    },
  };
  const coordinatorProviders = { codex: Coordinator, claude: ClaudeCoordinator };
  const makeCoordinator = async (provider, previous) => {
    const next = new (coordinatorProviders[provider] || Coordinator)(coordinatorOptions);
    if (previous) { next.operations = previous.operations; previous.removeAllListeners(); previous.close(); } else await next.init();
    next.on('state', state => broadcast('coordinator-state', { state }));
    next.on('result', operation => broadcast('coordinator-result', { operation }));
    next.on('error-detail', error => broadcast('service-error', { error }));
    return next;
  };
  let coordinator = await makeCoordinator(settings.coordinatorAgent);
  const overseer = new Overseer({ chats: () => sessions.active(), ask: request => coordinator.ask(request), enabled: () => !!settings.overseer });
  overseer.update();
  const quick = await new QuickActions({ stateDir, workspace, context: () => ({ chats: sessions.active(), route: workspaceRoute }), execute: (...args) => coordinator.execute(...args), completed: operation => broadcast('coordinator-result', { operation }) }).init();
  const askMak = async data => {
    if (coordinator.operationPromises.has(data.id) || coordinator.operations.has(data.id)) return coordinator.ask(data);
    const images = await attachments.coordinatorImages(data.images);
    if (images.length) return coordinator.ask({ ...data, images });
    return await quick.ask(data) || coordinator.ask({ ...data, images });
  };
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
      if (url.pathname === '/health') return json(response, 200, { service: 'mrmak', version: '0.6.0' });
      // An <img> cannot send the bearer token. Its unguessable, short-lived grant
      // is issued only through an authorized messages request for this chat.
      const media = /^\/media\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]{43})$/.exec(url.pathname);
      if (media && ['GET', 'HEAD'].includes(request.method)) return await conversationMedia.serve(request, response, media[1], media[2], 'desktop', url.searchParams.get('download') === '1');
      // The coordinator's MCP bridge, authorized by its own per-process secret.
      if (url.pathname === '/chat-plan/tool' && request.method === 'POST') {
        const call = await body(request), session = sessions.items.get(call.chat);
        if (!session || !validPlanKey(planSecret, call.chat, request.headers['x-mrmak-plan'])) return json(response, 403, { error: 'Not allowed' });
        return json(response, 200, { text: await savePlan(session.cwd, session.id, call.plan) });
      }
      if (url.pathname === '/coordinator/tool' && request.method === 'POST' && coordinator.callTool) { const call = await body(request); return json(response, 200, await coordinator.callTool(request.headers['x-mrmak-coordinator'], call.name, call.arguments)); }
      if (url.pathname.startsWith('/api/')) {
        authorize(request);
        const method = request.method;
        const cardImage = /^\/api\/workspace\/cards\/([^/]+)\/(\d+)\/images$/.exec(url.pathname);
        if (method === 'POST' && cardImage) return json(response, 201, await cards.image(decodeURIComponent(cardImage[1]), Number(cardImage[2]), request, url.searchParams.get('name')));
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
        const data = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await body(request, url.pathname === '/api/files/markdown' ? 12 * 1024 * 1024 : url.pathname.startsWith('/api/workspace/cards') ? 2 * 1024 * 1024 : 256 * 1024) : {};
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
        if (method === 'POST' && url.pathname === '/api/workspace/cards') return json(response, 201, await cards.create(data));
        const cardDocument = /^\/api\/workspace\/cards\/([^/]+)\/(\d+)$/.exec(url.pathname);
        if (cardDocument && method === 'GET') return json(response, 200, await cards.read(decodeURIComponent(cardDocument[1]), Number(cardDocument[2])));
        if (cardDocument && method === 'PUT') return json(response, 200, await cards.save(decodeURIComponent(cardDocument[1]), Number(cardDocument[2]), data));
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
        if (method === 'GET' && url.pathname === '/api/mcp') { const value = await mcp.list(); return json(response, 200, { ...value, engines: await engineStatus(value.servers) }); }
        if (method === 'POST' && url.pathname === '/api/skills/discover') return json(response, 200, await discoverSkills(await projectFolder(data.path)));
        if (method === 'POST' && url.pathname === '/api/skills/create') return json(response, 200, await createSkill(await projectFolder(data.path), data.candidate));
        // Rules for one project, or the global rules every chat gets.
        if (method === 'GET' && url.pathname === '/api/rules') return json(response, 200, url.searchParams.get('scope') === 'global' ? await readRulesAt(globalRulesFile(repo)) : await readRules(await projectFolder(url.searchParams.get('path'))));
        if (method === 'POST' && url.pathname === '/api/rules') return json(response, 200, data.scope === 'global' ? await editGlobalRules(repo, data) : await editRules(await projectFolder(data.path), data));
        if (method === 'GET' && url.pathname === '/api/game') return json(response, 200, await gameState(await projectFolder(url.searchParams.get('path'))));
        if (method === 'POST' && url.pathname === '/api/game') { const cwd = await projectFolder(data.path); await saveGame(cwd, data.config); return json(response, 200, await gameState(cwd)); }
        if (method === 'POST' && url.pathname === '/api/game/run') { const cwd = await projectFolder(data.path); await games.run(cwd); return json(response, 200, await gameState(cwd)); }
        if (method === 'POST' && url.pathname === '/api/game/stop') { const cwd = await projectFolder(data.path); await games.stop(cwd); return json(response, 200, await gameState(cwd)); }
        if (method === 'POST' && url.pathname === '/api/game/setup') { const session = sessions.get(data.id), cwd = await projectFolder(session.gameFolder || session.cwd); return json(response, 200, sessions.input(session.id, gameSetupPrompt((await readGame(cwd)).path, cwd), { coordinator: true, submit: true })); }
        if (method === 'POST' && url.pathname === '/api/mcp/check') return json(response, 200, await mcp.check(data.id));
        if (method === 'POST' && url.pathname === '/api/native/settings') return json(response, 200, await nativeSettings.set(data.winKey));
        if (method === 'GET' && url.pathname === '/api/recent-projects') return json(response, 200, await projectList());
        if (method === 'POST' && url.pathname === '/api/recent-projects/pin') {
          const project = (await projectList()).find(item => typeof data.path === 'string' && projectKey(item.path) === projectKey(data.path));
          if (!project || typeof data.pinned !== 'boolean') throw new Error('Choose a project from the list.');
          const others = (settings.pinnedProjects || []).filter(item => projectKey(item) !== projectKey(project.path));
          settings.pinnedProjects = data.pinned ? [...others, project.path].slice(-30) : others;
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, await projectList());
        }
        if (method === 'GET' && url.pathname === '/api/read-aloud') return json(response, 200, await readAloud.status());
        if (method === 'POST' && url.pathname === '/api/preview/show') {
          // A link in a chat may be relative to that chat's working folder.
          const base = typeof data.sessionId === 'string' ? sessions.get(data.sessionId).cwd : repo;
          if (typeof data.path !== 'string' || !data.path.trim() || /[\x00-\x1f]/.test(data.path)) throw new Error('Choose a local file or folder.');
          const target = await realpath(path.resolve(base, data.path));
          if ((await stat(target)).isDirectory()) { native({ type: 'reveal', path: target }); return json(response, 200, { shown: 'folder', path: target }); }
          const preview = await files.preview(target); show('workspace', { preview });
          return json(response, 200, { shown: 'preview', path: preview.path });
        }
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
        if (method === 'GET' && url.pathname === '/api/files/git') return json(response, 200, await fileInsights.status(url.searchParams.get('path') || repo));
        if (method === 'GET' && url.pathname === '/api/files/diff') return json(response, 200, await fileInsights.diff(url.searchParams.get('path') || ''));
        if (method === 'GET' && url.pathname === '/api/files/map') return json(response, 200, await folderMap(url.searchParams.get('path') || repo));
        // What the chosen chat's agent read and wrote, for the Files tab.
        if (method === 'GET' && url.pathname === '/api/files/activity') { const id = url.searchParams.get('id'); const session = id && sessions.items.get(id); return json(response, 200, { id: session?.id || null, cwd: session?.cwd || null, files: session ? (await transcripts.read(session)).files || [] : [] }); }
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
          if (typeof data.terminalOptionMeta === 'boolean') settings.terminalOptionMeta = data.terminalOptionMeta;
          if (Number.isInteger(data.handoffAfter) && (data.handoffAfter === 0 || (data.handoffAfter >= 10 && data.handoffAfter <= 500))) settings.handoffAfter = data.handoffAfter;
          // The idle-cache alert must come before the prompt cache expires; 0 turns it off.
          if (Number.isInteger(data.idleCacheMinutes) && (data.idleCacheMinutes === 0 || (data.idleCacheMinutes >= 5 && data.idleCacheMinutes < CACHE_TTL_MINUTES))) settings.idleCacheMinutes = data.idleCacheMinutes;
          if (Number.isInteger(data.idleCacheMinTokens) && data.idleCacheMinTokens >= 10000 && data.idleCacheMinTokens <= 1000000) settings.idleCacheMinTokens = data.idleCacheMinTokens;
          if (['all', 'general'].includes(data.usageLimitMode)) settings.usageLimitMode = data.usageLimitMode;
          if (['used', 'remaining'].includes(data.usageDirection)) settings.usageDirection = data.usageDirection;
          if (['full', 'compact', 'hidden'].includes(data.systemEvents)) settings.systemEvents = data.systemEvents;
          if (data.agentPriority in CPU_PRIORITIES && data.agentPriority !== settings.agentPriority) { settings.agentPriority = data.agentPriority; await sessions.setPriority(data.agentPriority); }
          if (isThemePreference(data.workspaceTheme)) settings.workspaceTheme = data.workspaceTheme;
          if (isThemePreference(data.chatTheme)) settings.chatTheme = data.chatTheme;
          if (['medium', 'high'].includes(data.coordinatorEffort)) settings.coordinatorEffort = data.coordinatorEffort;
          if (['codex', 'claude'].includes(data.coordinatorAgent) && data.coordinatorAgent !== (settings.coordinatorAgent || 'codex')) {
            if (coordinator.state === 'working') throw Object.assign(new Error('Mr. Mak is answering a request. Change the coordinator when it finishes.'), { status: 409 });
            settings.coordinatorAgent = data.coordinatorAgent; coordinator = await makeCoordinator(settings.coordinatorAgent, coordinator); broadcast('coordinator-state', { state: coordinator.state });
          } else if (data.coordinatorEffort && coordinator.provider === 'claude' && coordinator.state !== 'working') coordinator.close(); // Claude takes its effort when it starts.
          if (typeof data.overseer === 'boolean') { settings.overseer = data.overseer; overseer.update(); }
          if (typeof data.planTool === 'boolean') settings.planTool = data.planTool;
          if (EFFORT_ADVICE.includes(data.effortAdvice)) settings.effortAdvice = data.effortAdvice;
          if (['cedar', 'marin'].includes(data.voiceName)) settings.voiceName = data.voiceName;
          if (data.groupColors && typeof data.groupColors === 'object' && !Array.isArray(data.groupColors)) settings.groupColors = Object.fromEntries(Object.entries(data.groupColors).filter(([name, value]) => name.length <= 60 && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)).slice(0, 200).map(([name, value]) => [name, value.toLowerCase()]));
          if (Array.isArray(data.collapsedGroups)) settings.collapsedGroups = [...new Set(data.collapsedGroups.filter(item => typeof item === 'string' && item.length <= 60))].slice(0, 200);
          await saveSettings(); broadcast('settings', { settings }); return json(response, 200, settings);
        }
        if (method === 'POST' && url.pathname === '/api/sessions') { const session = await sessions.create({ ...data, bypass: data.bypass ?? settings.defaultBypass }); await integrations.publish('session', { event: 'started', session }); focus(session.id); return json(response, 201, session); }
        if (method === 'POST' && url.pathname === '/api/groups/by-project') return json(response, 200, await sessions.toggleProjectGroups());
        if (method === 'POST' && url.pathname === '/api/groups/move') return json(response, 200, await sessions.moveGroup(data.group, data.pinned, data.targetId, data.position));
        if (method === 'POST' && url.pathname === '/api/groups/rename') {
          // A renamed group keeps its color and collapsed state; merging into an
          // existing group keeps that group's.
          const from = groupLabel(data.from), to = groupLabel(data.to);
          const merging = sessions.list().some(item => item.group === to);
          const result = await sessions.renameGroup(from, to);
          if (from !== to) {
            const { [from]: color, ...colors } = settings.groupColors || {};
            settings.groupColors = color && !merging ? { ...colors, [to]: color } : colors;
            const collapsed = settings.collapsedGroups || [];
            settings.collapsedGroups = [...new Set(collapsed.filter(item => item !== from).concat(collapsed.includes(from) && !merging ? [to] : []))];
            await saveSettings(); broadcast('settings', { settings });
          }
          return json(response, 200, result);
        }
        if (method === 'POST' && url.pathname === '/api/groups/delete') {
          // The group's color and collapsed state go with it; the chats stay.
          const name = groupLabel(data.name);
          const result = await sessions.deleteGroup(name);
          const colors = { ...(settings.groupColors || {}) }; delete colors[name];
          settings.groupColors = colors;
          settings.collapsedGroups = (settings.collapsedGroups || []).filter(item => item !== name);
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, result);
        }
        const sessionRoute = /^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/.exec(url.pathname);
        if (sessionRoute) {
          const [, id, action] = sessionRoute;
          if (method === 'GET' && action === 'screen') return json(response, 200, await sessions.read(id));
          if (method === 'GET' && action === 'messages') {
            const session = sessions.get(id);
            const value = await conversationMedia.present(await transcripts.read(session), session, 'desktop', grant => `/media/${session.id}/${grant}`);
            // Mr. Mak answers Claude Code's cache warning itself while it applies a footer model change.
            return json(response, 200, { ...value, prompt: session.process && !switchingModel(id) ? await readPrompt(sessions, id) : null, btw: sideQuestions.list(id) });
          }
          if (method === 'GET' && action === 'rules') return json(response, 200, await ruleSuggestions.list(sessions.get(id)));
          if (method === 'POST' && action === 'rules') return json(response, 200, await ruleSuggestions.resolve(sessions.get(id), data, repo));
          if (method === 'GET' && action === 'plan') return json(response, 200, await chatPlan(sessions.get(id), claudeSessions));
          if (method === 'GET' && action === 'rail') return json(response, 200, await sessionRail(sessions.get(id), sessions.list(), claudeSessions, transcripts));
          if (method === 'POST' && action === 'btw') return json(response, 200, await sideQuestions.ask(id, data.text));
          if (method === 'GET' && action === 'commands') { const session = sessions.get(id); return json(response, 200, await chatCommands(session.agent, session.cwd, mcpOptions)); }
          if (method === 'GET' && action === 'stats') {
            const session = sessions.get(id);
            const { supported, userMessages = 0, truncated = false, model = null, effort = null, usage = null, modelName = null, cache = null, cacheStats = null } = await liveStats(session, await transcripts.read(session), stateDir);
            return json(response, 200, { supported, userMessages, truncated, model, ...(modelName && { modelName }), effort, usage, ...(cache && { cache: cacheView(cache) }), ...(cacheStats && { cacheStats }), handoff: handoffs.state(id) });
          }
          if (method === 'GET' && action === 'models') return json(response, 200, await modelOptions(sessions.get(id)));
          if (method === 'POST' && action === 'model') return json(response, 200, await applyChoice(sessions, stateDir, id, { model: data.model ?? undefined, effort: data.effort ?? undefined }));
          if (method === 'POST' && action === 'handoff') return json(response, 200, handoffs.start(id));
          // Pause with a summary; on return `then` is "new-chat" (open one from the handoff) or "keep".
          if (method === 'POST' && action === 'pause') {
            if (data.then === 'new-chat') { await handoffs.continueFromPause(id); return json(response, 200, handoffs.state(id)); }
            if (data.then === 'keep') return json(response, 200, handoffs.dismiss(id));
            return json(response, 200, handoffs.pause(id));
          }
          if (method === 'POST' && action === 'compact') return json(response, 200, await handoffs.compact(id));
          if (method === 'POST' && action === 'prompt') return json(response, 200, await answerPrompt(sessions, id, data.id, data.choice));
          if (method === 'POST' && action === 'rewind') return json(response, 200, await rewindToMessage(sessions, transcripts, id, String(data.messageId || '')));
          if (method === 'POST' && action === 'speak') {
            const controller = new AbortController(), abort = () => controller.abort();
            sessions.get(id); response.once('close', abort);
            try {
              const audio = await readAloud.synthesize('desktop', data, controller.signal);
              response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' }); response.end(audio); return;
            } finally { response.off('close', abort); }
          }
          if (method === 'POST' && action === 'send') {
            // One prompt: the text and any attached paths are pasted together, then submitted.
            const session = sessions.get(id), text = typeof data.text === 'string' ? data.text : '';
            const paths = Array.isArray(data.paths) && data.paths.length ? await attachments.paths(data.paths) : [];
            if (!text.trim() && !paths.length) throw new Error('Write a message or attach a file.');
            await sideQuestions.guard(id);
            // A large cold Claude chat holds the first message once, with what it would cost.
            // Slash commands do not reach the model, so they are never held.
            // The desktop answers the hold with Send anyway, Compact first or Summarize and continue.
            if (session.agent === 'claude' && !text.trimStart().startsWith('/')) {
              try { coldGuard.check(session, (await transcripts.read(session)).cache); }
              catch (error) { if (error.cold) return json(response, 409, { error: error.message, coldCache: error.cold }); throw error; }
            }
            // Effort advice holds the message once with the level it needs; the resend carries the answer.
            const { advice } = await effortAdvisor.check(session, text, { choice: data.effort });
            if (advice) return json(response, 409, { error: advice.message, effortAdvice: advice });
            if (data.effort?.action === 'auto' && settings.effortAdvice !== 'auto') { settings.effortAdvice = 'auto'; await saveSettings(); broadcast('settings', { settings }); }
            return json(response, 200, sessions.input(id, `${text}${paths.length ? `${text ? '\n' : ''}${attachmentText(paths, session.agent)}` : ''}`, { coordinator: true, submit: true }));
          }
          if (method === 'POST' && action === 'focus') return json(response, 200, focus(id));
          if (method === 'POST' && action === 'stop') return json(response, 200, sessions.stop(id));
          if (method === 'POST' && action === 'resume') { const session = await sessions.resume(id, data.nativeId); focus(id); return json(response, 200, session); }
          if (method === 'POST' && action === 'attach') return json(response, 200, await attach(id, data.paths));
          if (method === 'POST' && action === 'clear') return json(response, 200, await sessions.clearScreen(id));
          if (method === 'POST' && action === 'reorder') return json(response, 200, await sessions.reorder(id, data.targetId, data.position));
          if (method === 'POST' && action === 'input') return json(response, 200, sessions.input(id, data.text, { coordinator: data.paste !== false, submit: data.submit !== false }));
          if (method === 'PATCH' && !action) return json(response, 200, typeof data.pinned === 'boolean' ? sessions.pin(id, data.pinned) : 'tabColor' in data ? sessions.color(id, data.tabColor) : 'gameFolder' in data ? sessions.setGameFolder(id, data.gameFolder === null ? null : await projectFolder(data.gameFolder)) : 'group' in data ? await sessions.assign(id, data.group) : sessions.rename(id, data.name));
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
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: ${files.origin}; media-src 'self' blob: ${files.origin}; connect-src 'self' ws://127.0.0.1:* ${files.origin}; frame-src http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      });
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: publicError(error) }); }
  });
  const origin = await listen(server);
  files.uiOrigin = origin;
  // The Plan tool's calls come back here with the chat's key; off unless the owner turns it on.
  const planSecret = secret();
  sessions.planTool = { enabled: () => !!settings.planTool, url: () => `${origin}/chat-plan/tool`, secret: planSecret };
  // What the phone shows beside a chat: its plan, plan limits, prompt cache, rules
  // waiting to be saved and the Git changes inside its folder.
  const chatExtras = {
    async details(session) {
      const read = await transcripts.read(session), folder = path.resolve(session.cwd);
      const [stats, plan, rules, git] = await Promise.all([liveStats(session, read, stateDir).catch(() => read), chatPlan(session, claudeSessions).catch(() => null), ruleSuggestions.list(session).catch(() => []), fileInsights.status(folder).catch(() => null)]);
      const changes = (git?.files || []).filter(item => within(folder, item.path));
      return { plan, usage: stats?.usage || null, cache: read.cache ? cacheView(read.cache) : null, rules, changes: changes.slice(0, 200).map(item => ({ ...item, name: path.relative(folder, item.path).replaceAll(path.sep, '/'), folder: /[\\/]$/.test(item.path) })), changeCount: changes.length };
    },
    resolveRule: (session, data) => ruleSuggestions.resolve(session, data, repo),
    async coldCheck(session, text) { if (session.agent === 'claude' && !text.trimStart().startsWith('/')) coldGuard.check(session, (await transcripts.read(session)).cache); },
    // The phone shows no offer: auto mode switches, ask mode sends the message as it is.
    async effortCheck(session, text) { await effortAdvisor.check(session, text, { interactive: false }); },
    // Only a file the chat's folder lists as changed.
    async diff(session, file) {
      const folder = path.resolve(session.cwd), git = await fileInsights.status(folder);
      if (typeof file !== 'string' || !git.files.some(item => item.path === file && within(folder, file))) throw Object.assign(new Error('This file has no change in this chat folder.'), { status: 404 });
      return fileInsights.diff(file);
    },
  };
  mobile = await new MobileGateway({ ...mobileOptions, transcripts, readAloud, dictation, chooseDictation, repo, uiDir, stateDir, sessions, attachments, closeChat, chatExtras, settings: () => settings, changed: state => broadcast('mobile-state', { mobile: state }) }).init();
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
    origin, contentOrigin: files.origin, token, sessions, handoffs, get coordinator() { return coordinator; }, quick, workspace, cards, files, projects, knowledge, integrations, mobile,
    urls: { workspace: `${origin}/?desktop=1&surface=workspace&token=${token}`, chats: `${origin}/?desktop=1&surface=chats&token=${token}` },
      nativeMessage: event => nativeSettings.receive(event),
      async close() {
        if (closing) return; closing = true; mcp.close(); nativeSettings.close(); await files.writes.catch(() => {});
      watcher?.close(); clearTimeout(restoreTimer); overseer.close(); coordinator.close(); clearTimeout(settingsTimer); await saveSettings(); await transcriptSave; await quick.saves; await workspace.writes;
      dictation.close(); await mobile.close(); await games.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close(); await sessions.close();
      server.closeAllConnections(); contentServer.closeAllConnections();
      await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => contentServer.close(resolve)), files.close()]);
    },
  };
}
