import path from 'node:path';
import { readJson, saveJson, publicError } from './util.mjs';
import { localDay } from './workspace.mjs';
import { taskTitle } from './titles.mjs';
import { defaultWorkerEffort } from './effort.mjs';

const normalize = text => String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const polite = text => String(text || '').trim().replace(/^(?:(?:ну|так|слушай|давай|пожалуйста|please|can you)[,\s]+)+/iu, '').replace(/[,\s]+пожалуйста[.!?]?$/iu, '').replace(/[.!?]+$/, '').trim();
const topic = text => normalize(text).replace(/^(?:эту |этот |текущую |текущий |выбранную |выбранный |this |current |the )?(?:карточку|карточка|карту|card|чат|chat)\s*/u, '').trim();
const subjectKind = text => /(?:карточк|\bcard\b)/iu.test(text) ? 'card' : /(?:чат|\bchat\b)/iu.test(text) ? 'chat' : null;
const findNamed = (items, text, currentId) => {
  const target = topic(text);
  if (!target || /^(?:эту|текущую|выбранную|this|current|it)$/u.test(target)) return items.find(item => item.id === currentId) || null;
  const exact = items.filter(item => [item.id, item.title || item.name].some(value => normalize(value) === target));
  if (exact.length === 1) return exact[0];
  const partial = items.filter(item => normalize(item.title || item.name).includes(target) || normalize(item.id).includes(target));
  return partial.length === 1 ? partial[0] : null;
};

export function requestDate(text, now = new Date()) {
  const valid = value => {
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.valueOf()) && localDay(date) === value ? value : null;
  };
  let match = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (match) return valid(match[0]);
  match = /\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?\b/.exec(text);
  if (match) return valid(`${match[3] || now.getFullYear()}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  const months = ['январ', 'феврал', 'март', 'апрел', 'мая', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  match = /(\d{1,2})\s+([а-я]+)(?:\s+(20\d{2}))?/iu.exec(text);
  if (match) { const month = months.findIndex(value => match[2].toLowerCase().startsWith(value)); if (month >= 0) return valid(`${match[3] || now.getFullYear()}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`); }
  const days = /позавчера|day before yesterday/iu.test(text) ? 2 : /вчера|yesterday/iu.test(text) ? 1 : /сегодня|today/iu.test(text) ? 0 : null;
  if (days === null) return null;
  const date = new Date(now); date.setDate(date.getDate() - days); return localDay(date);
}

export class QuickActions {
  constructor({ stateDir, workspace, context, execute, completed }) {
    Object.assign(this, { workspace, context, execute, completed });
    this.file = path.join(stateDir, 'quick-operations.json'); this.operations = new Map(); this.pending = new Map(); this.saves = Promise.resolve();
  }
  async init() {
    for (const item of await readJson(this.file, [])) this.operations.set(item.id, item.status === 'running' ? { ...item, status: 'interrupted', result: 'The app restarted during this action. Check its current state before repeating it.' } : item);
    return this;
  }
  save() { this.saves = this.saves.catch(() => {}).then(() => saveJson(this.file, [...this.operations.values()].slice(-100))); return this.saves; }
  async plan(request) {
    const text = polite(request.text), state = this.context();
    const call = (name, args) => this.execute(name, args, request.id, request.text);
    // Compound or uncertain instructions belong to the language-aware coordinator.
    if (/(?:;|\n|\s(?:затем|потом|then)\s|\s(?:и|and)\s+(?:открой|покажи|прочитай|архивируй|заархивируй|закрой|создай|измени|отметь|пришли|сделай|open|show|read|archive|close|create|change|mark|send|make)(?=\s|$))/iu.test(text)) return null;
    const date = requestDate(text);
    if (date && /что|чем|делал|работ|what|work|activity|history/iu.test(text)) return async () => {
      const result = await this.workspace.activity(date);
      const titles = result.cards.slice(0, 12).map(item => `• ${item.title}`).join('\n');
      return result.cards.length ? `Found ${result.cards.length} cards for ${date} in Workspace dates and Git history:\n${titles}${result.cards.length > 12 ? '\nMore cards are available.' : ''}` : `No Workspace or Git history entries were found for ${date}. Unsaved work is not included.`;
    };
    const cards = await this.workspace.list();
    const currentId = decodeURIComponent(/^#\/([^/]+)/.exec(state.route || '')?.[1] || '');
    const resolve = subject => {
      const kind = subjectKind(subject);
      const card = kind === 'chat' ? null : findNamed(cards, subject, currentId);
      const chat = kind === 'card' ? null : findNamed(state.chats, subject, request.selectedId);
      // A name shared by a card and chat needs the user's intended surface.
      return card && chat ? {} : { card, chat };
    };
    let match = /^(?:архивируй|заархивируй|отправь в архив|archive)\s+(.+)$/iu.exec(text);
    if (match) { const { card } = resolve(match[1]); return card ? async () => { await call('update_workspace', { entityId: card.id, status: 'archived' }); return `Archived the card "${card.title}".`; } : null; }
    match = /^(?:верни из архива|разархивируй|unarchive)\s+(.+)$/iu.exec(text);
    if (match) { const { card } = resolve(match[1]); return card ? async () => { await call('update_workspace', { entityId: card.id, status: 'active' }); return `The card "${card.title}" is active again.`; } : null; }
    match = /^(?:отметь|пометь|mark)\s+(.+?)\s+(?:как\s+|as\s+)?(готовой|готово|завершенной|завершено|done|активной|active)$/iu.exec(text);
    if (match) { const { card } = resolve(match[1]), status = /актив|active/iu.test(match[2]) ? 'active' : 'done'; return card ? async () => { await call('update_workspace', { entityId: card.id, status }); return `"${card.title}": ${status}.`; } : null; }
    match = /^(закрепи|открепи|pin|unpin)\s+(.+)$/iu.exec(text);
    if (match) {
      const { card, chat } = resolve(match[2]), pinned = /^(?:закрепи|pin)$/iu.test(match[1]);
      if (card || chat) return async () => { await call(card ? 'update_workspace' : 'pin_chat', card ? { entityId: card.id, pinned } : { id: chat.id, pinned }); return `"${card?.title || chat.name}": ${pinned ? 'pinned' : 'unpinned'}.`; };
    }
    match = /^(?:закрой|close)\s+(.+)$/iu.exec(text);
    if (match) { const { chat } = resolve(match[1]); return chat ? async () => { await call('close_chat', { id: chat.id }); return `Closed "${chat.name}". It is saved in History.`; } : null; }
    match = /^(?:открой|покажи|open|show|switch to|переключись на)\s+(.+)$/iu.exec(text);
    if (match && !/новый|new|создай/iu.test(match[1])) {
      const subject = match[1];
      const { chat, card } = resolve(subject);
      if (chat) return async () => { await call('focus_chat', { id: chat.id }); return `Opened the chat "${chat.name}".`; };
      if (/^(?:workspace|воркспейс|рабочее пространство)$/iu.test(subject)) return async () => { await call('show_workspace', {}); return 'Workspace is open.'; };
      if (card) return async () => { await call('show_workspace', { entityId: card.id }); return `Opened the card "${card.title}".`; };
    }
    match = /^(?:прочитай|прочти|что в|read|summarize)\s+(.+)$/iu.exec(text);
    if (match) { const { card } = resolve(match[1]); return card ? async () => { const value = await call('read_workspace', { entityId: card.id }); return `${value.title}\n${value.description || ''}\n\n${value.text.slice(0, 4000)}${value.note ? '\n' + value.note : ''}`; } : null; }
    if (/^(?:покажи |список |list |show )?(?:все |all )?(?:чаты|chats)$/iu.test(text)) return async () => state.chats.length ? state.chats.map(({ name, attention }) => `• ${name}${attention ? ' — needs attention' : ''}`).join('\n') : 'There are no open chats.';
    if (/^(?:покажи |список |list |show )?(?:все |all )?(?:карточки|cards)$/iu.test(text)) return async () => `${cards.length} Workspace cards:\n${cards.slice(0, 15).map(({ title }) => `• ${title}`).join('\n')}`;
    match = /^(?:создай|открой|create|open)\s+(?:новый |new )?(?:(codex|кодекс|claude|клод|antigravity|agy|opencode|kimi|pi)\s+)?(?:чат|chat)\s+(?:с названием |под названием |named |called )?[«"“]([^»"”]+)[»"”]$/iu.exec(text);
    if (match) {
      let name; try { name = taskTitle(match[2]); } catch { return null; }
      const agent = /claude|клод/iu.test(match[1] || '') ? 'claude' : /antigravity|agy/iu.test(match[1] || '') ? 'antigravity' : /opencode/iu.test(match[1] || '') ? 'opencode' : /kimi/iu.test(match[1] || '') ? 'kimi' : /^pi$/iu.test(match[1] || '') ? 'pi' : 'codex';
      return async () => { const chat = await call('open_chat', { agent, name, effort: defaultWorkerEffort }); return `Created "${chat.name}". The agent is starting.`; };
    }
    return null;
  }
  ask(request) {
    if (!request.id || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 30000) return Promise.reject(new Error('A request ID and a non-empty message are required'));
    if (this.pending.has(request.id)) return this.pending.get(request.id);
    if (this.operations.has(request.id)) return Promise.resolve(this.operations.get(request.id));
    const promise = (async () => {
      const action = await this.plan(request);
      if (!action) return null;
      const operation = { id: request.id, text: request.text, status: 'running', at: new Date().toISOString(), route: 'direct' };
      this.operations.set(request.id, operation); await this.save();
      const start = performance.now();
      try { operation.result = await action(); operation.status = 'completed'; }
      catch (error) { operation.result = publicError(error); operation.status = 'failed'; }
      operation.durationMs = Math.round(performance.now() - start);
      await this.save(); this.completed(operation); return operation;
    })();
    this.pending.set(request.id, promise);
    return promise.finally(() => this.pending.delete(request.id));
  }
}
