// Loaded inside OpenCode. Observe native events only; never intercept a prompt,
// request a model, change permissions, or read provider credentials.
import { writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { opencodeContext, unknownContext } from '../native-context.mjs';

export const validSessionId = value => typeof value === 'string' && /^ses[a-zA-Z0-9_-]{1,160}$/.test(value);
const sameDirectory = (a, b) => {
  if (!a || !b) return false;
  const normalize = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
};

export function createObserver({ directory, nativeId, chatId, launchId, startedAt = Date.now(), save }) {
  let state = { chatId, launchId, nativeId: validSessionId(nativeId) ? nativeId : null, activity: 'idle', completion: null, revision: 0 };
  let finalMessage = null;
  const emit = patch => { state = { ...state, ...patch, revision: state.revision + 1 }; save({ ...state }); };
  const context = usage => emit({ contextUsage: usage, contextRevision: state.revision + 1 });
  const complete = id => {
    if (!id || state.completion === id) return;
    emit({ activity: 'idle', completion: id });
  };
  return event => {
    if (!event || (typeof event.created === 'number' && event.created < startedAt)) return;
    const v2 = !!event.data;
    const data = event.data || event.properties || {};
    const info = data.info;
    if (event.type === 'session.created' && !state.nativeId) {
      const id = v2 ? data.sessionID : info?.id;
      const parent = v2 ? data.parentID : info?.parentID;
      const folder = v2 ? data.location?.directory : info?.directory;
      if (!parent && validSessionId(id) && sameDirectory(folder, directory)) emit({ nativeId: id });
    }
    const id = data.sessionID || info?.sessionID;
    if (!state.nativeId || id !== state.nativeId) return;
    if (event.type === 'session.compacted') context(unknownContext('opencode', 'compacted'));
    if (event.type === 'message.updated' && info?.role === 'assistant' && info.time?.completed && !info.error && !info.summary) context(opencodeContext(info));
    if (event.type === 'session.execution.started' || event.type === 'session.status' && ['busy', 'retry'].includes(data.status?.type)) {
      if (state.activity !== 'working') { finalMessage = null; emit({ activity: 'working' }); }
    } else if (event.type === 'session.execution.succeeded') {
      complete(event.id);
    } else if (event.type === 'message.updated' && info?.role === 'assistant' && info.time?.completed) {
      if (info.error) { finalMessage = null; emit({ activity: info.error.name === 'MessageAbortedError' ? 'idle' : 'waiting' }); }
      else if (info.finish && !['tool-calls', 'unknown'].includes(info.finish)) finalMessage = info.id;
    } else if (event.type === 'session.idle' || event.type === 'session.status' && data.status?.type === 'idle') {
      if (finalMessage) complete(finalMessage);
      else if (state.activity === 'working') emit({ activity: 'idle' });
    } else if (event.type === 'permission.asked' || event.type === 'question.asked') {
      emit({ activity: 'waiting' });
    } else if (event.type === 'permission.replied' || event.type === 'question.replied' || event.type === 'question.rejected') {
      emit({ activity: 'working' });
    } else if (event.type === 'session.execution.failed' || event.type === 'session.error') {
      finalMessage = null;
      emit({ activity: data.error?.name === 'MessageAbortedError' ? 'idle' : 'waiting' });
    } else if (event.type === 'session.execution.interrupted') {
      finalMessage = null; emit({ activity: 'idle' });
    }
  };
}

export function observerFromEnvironment(directory) {
  const file = process.env.MRMAK_OPENCODE_STATE;
  if (!file || !path.isAbsolute(file) || !process.env.MRMAK_OPENCODE_CHAT_ID || !process.env.MRMAK_OPENCODE_LAUNCH_ID) return () => {};
  return createObserver({
    directory, nativeId: process.env.MRMAK_OPENCODE_SESSION_ID,
    chatId: process.env.MRMAK_OPENCODE_CHAT_ID, launchId: process.env.MRMAK_OPENCODE_LAUNCH_ID,
    startedAt: Number(process.env.MRMAK_OPENCODE_STARTED_AT) || Date.now(),
    save(state) {
      try {
        writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
        renameSync(file + '.tmp', file);
      } catch { /* A stopped host must never break the user's native CLI. */ }
    },
  });
}
