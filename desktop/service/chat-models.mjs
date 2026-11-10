import path from 'node:path';
import { readJson, saveJson, sleep } from './util.mjs';
import { projectKey } from './recent-projects.mjs';
import { answerPrompt, readPrompt } from './terminal-prompt.mjs';
import { claudeModels, readStatus, sameModel } from './claude-status.mjs';

// The chat footer's model and effort menu. Claude Code applies `/model <id>` and
// `/effort <level>` at once when they carry an argument; only a bare command opens
// the picker that the Conversation view would show as a question.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const validModel = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.\-[\]]{0,80}$/i.test(value);

// The last choice per project folder and agent, kept beside the chats in the state
// folder. A new chat in that folder starts with it; each chat also keeps its own,
// which its next launch or resume passes to the CLI.
const memoryFile = stateDir => path.join(stateDir, 'chat-models.json');
let memoryChain = Promise.resolve();
export async function rememberedChoice(stateDir, cwd, agent) {
  const value = (await readJson(memoryFile(stateDir), {}))?.[projectKey(cwd)]?.[agent];
  return { model: validModel(value?.model) ? value.model : undefined, effort: EFFORTS.includes(value?.effort) ? value.effort : undefined };
}
function remember(stateDir, cwd, agent, choice) {
  memoryChain = memoryChain.catch(() => {}).then(async () => {
    const all = await readJson(memoryFile(stateDir), {});
    const key = projectKey(cwd);
    const entry = { ...all[key]?.[agent], ...choice, at: new Date().toISOString() };
    const next = { ...all, [key]: { ...all[key], [agent]: entry } };
    // The 200 most recently chosen projects.
    const latest = value => Math.max(0, ...Object.values(value || {}).map(item => Date.parse(item?.at) || 0));
    const recent = Object.entries(next).sort(([, a], [, b]) => latest(b) - latest(a)).slice(0, 200);
    await saveJson(memoryFile(stateDir), Object.fromEntries(recent));
  });
  return memoryChain;
}

// Chats whose footer change is being applied. Claude Code's cache warning during the
// switch is answered by Mr. Mak, so the Conversation view does not show it meanwhile.
const switching = new Set();
export const switchingModel = id => switching.has(id);

const SWITCH_QUESTION = /^(?:Switch model|Change effort level)\?$/;
// Claude Code asks before a switch that drops a warm prompt cache: "Your next response
// will be slower and use more tokens". The person already chose in the footer, so Mr.
// Mak confirms that warning. A confirmation a PreModelSwitch hook asks for stays theirs.
export const cacheWarning = prompt => !!prompt && SWITCH_QUESTION.test(String(prompt.question || '').trim()) && (prompt.detail || []).some(line => /next response will be slower/i.test(line)) && !(prompt.detail || []).some(line => /PreModelSwitch hook/i.test(line));

// What Claude Code prints once it has handled the command. Only a success line counts
// as applied; a refusal or silence leaves the previous setting in place.
const APPLIED = /Set model to|Kept model as|Set effort level to|Effort level set to/gi;
const FAILED = /Model switch failed|Failed to validate model|not found|isn't available|is not available|not supported/gi;
const count = (screen, pattern) => (screen.match(pattern) || []).length;
// The newest line of the screen that carries a refusal, for the menu to show.
const failureLine = screen => screen.split('\n').reverse().find(line => count(line, FAILED))?.replace(/^[\s⎿│]+/, '').trim().slice(0, 200) || '';

// Paste one command and wait for its result: 'applied', 'failed' (with the CLI's
// line), 'hook' or 'prompt' (a question left to the person) or 'unconfirmed'.
async function runCommand(sessions, id, text, timeout) {
  const start = (await sessions.read(id, 150)).screen;
  const before = { applied: count(start, APPLIED), failed: count(start, FAILED) };
  sessions.input(id, text, { coordinator: true, submit: true });
  // Enter follows the paste after 500 ms. The CLI may check a model with the server first.
  await sleep(650);
  let answered = false;
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(150)) {
    const prompt = await readPrompt(sessions, id);
    if (cacheWarning(prompt)) {
      // The cache warning is part of the switch the person asked for. Confirm it once,
      // then keep waiting for the CLI to say whether the switch went through.
      if (!answered) {
        const yes = prompt.options.findIndex(option => /^Yes\b/i.test(option));
        await answerPrompt(sessions, id, prompt.id, yes < 0 ? 0 : yes);
        answered = true;
        await sleep(300);
      }
      continue;
    }
    if (prompt) return { status: SWITCH_QUESTION.test(String(prompt.question || '').trim()) ? 'hook' : 'prompt' };
    const screen = (await sessions.read(id, 150)).screen;
    if (count(screen, FAILED) > before.failed) return { status: 'failed', line: failureLine(screen) };
    if (count(screen, APPLIED) > before.applied) return { status: 'applied' };
  }
  return { status: 'unconfirmed' };
}

const reason = (result, what) => result.status === 'failed' ? `Claude Code did not change the ${what}${result.line ? `: ${result.line}` : '.'}`
  : result.status === 'unconfirmed' ? `Claude Code did not confirm the ${what} change, so the previous ${what} is kept.`
    : 'Claude Code is asking about this switch in the chat.';

// Apply a model and/or effort to a running Claude chat without opening a picker. Only
// what Claude Code confirmed is kept on the chat and remembered for the folder; the
// /effort waits for a confirmed /model. `applied` is true only when every part was.
export async function applyChoice(sessions, stateDir, id, { model, effort } = {}, { timeout = 8000 } = {}) {
  const session = sessions.get(id);
  if (session.agent !== 'claude') throw new Error('This agent changes its model in its own terminal picker.');
  if (!session.process) throw new Error('This terminal is stopped. Resume it before changing the model.');
  if (model !== undefined && !validModel(model)) throw new Error('Choose one of the listed models.');
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error('Choose one of the listed effort levels.');
  if (model === undefined && effort === undefined) throw new Error('Choose a model or an effort level.');
  if (switching.has(id)) throw Object.assign(new Error('A model change is already being applied to this chat.'), { status: 409 });
  if (await readPrompt(sessions, id)) throw Object.assign(new Error('Answer the question open in this chat first.'), { status: 409 });
  switching.add(id);
  const status = {}, confirmed = {};
  let note = null;
  try {
    if (model !== undefined) {
      const result = await runCommand(sessions, id, `/model ${model}`, timeout);
      status.model = result.status;
      if (result.status === 'applied') confirmed.model = model;
      else note = reason(result, 'model');
    }
    if (effort !== undefined && (model === undefined || confirmed.model)) {
      if (model !== undefined) await sleep(300);
      const result = await runCommand(sessions, id, `/effort ${effort}`, timeout);
      status.effort = result.status;
      if (result.status === 'applied') confirmed.effort = effort;
      else note = reason(result, 'effort');
    }
  } finally { switching.delete(id); }
  if (Object.keys(confirmed).length) {
    Object.assign(session, confirmed, { applied: { ...session.applied, ...confirmed, at: Date.now() } });
    sessions.changed(session);
    await remember(stateDir, session.cwd, session.agent, confirmed);
  }
  const applied = (model === undefined || !!confirmed.model) && (effort === undefined || !!confirmed.effort);
  return { applied, ...confirmed, status, ...(note && { note }) };
}

// What the footer menu offers for a chat.
export async function modelOptions(session) {
  if (session.agent !== 'claude') return { agent: session.agent, supported: false, models: [], efforts: [] };
  return { agent: 'claude', supported: true, models: await claudeModels(), efforts: EFFORTS };
}

// A chat's stats with the live model and effort: the change confirmed in the footer,
// else what Claude Code's status line reported, else the transcript's model. Other
// agents keep their transcript's.
export async function liveStats(session, read, stateDir) {
  if (session.agent !== 'claude' || !read?.supported) return read;
  const [status, models] = await Promise.all([readStatus(stateDir, session.id), claudeModels()]);
  // A report from before this terminal started belongs to an earlier run.
  const chat = status.chat && status.chat.at >= (session.startedAt || 0) - 5000 ? status.chat : null;
  const applied = session.applied && (!chat || session.applied.at > chat.at) ? session.applied : null;
  const model = applied?.model || chat?.model?.id || read.model || null;
  const effort = applied?.effort || chat?.effort || read.effort || null;
  const known = models.find(item => sameModel(item.id, model));
  return { ...read, model, effort, modelName: known?.name || chat?.model?.displayName || null };
}
