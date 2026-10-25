import { randomUUID } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validSessionId } from './pi/observer.mjs';

export const piStatePath = (stateDir, chatId) => path.join(stateDir, `pi-${chatId}.json`);
export const piExtension = fileURLToPath(new URL('./pi/mrmak-observer.mjs', import.meta.url));
export { validSessionId as validPiSessionId };

export function piEnvironment(env, { stateDir, session, launchId = randomUUID() }) {
  if (session.nativeId && !validSessionId(session.nativeId)) throw new Error('Use the Pi session ID shown by /session.');
  return {
    ...env,
    MRMAK_PI_STATE: piStatePath(stateDir, session.id),
    MRMAK_PI_CHAT_ID: session.id,
    MRMAK_PI_LAUNCH_ID: launchId,
    MRMAK_PI_SESSION_ID: session.nativeId || '',
  };
}

export async function readPiState(stateDir, chatId) {
  try {
    const file = piStatePath(stateDir, chatId);
    if ((await stat(file)).size > 4096) return null;
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (state.chatId !== chatId || !validSessionId(state.nativeId)) return null;
    return { ...state, cwd: typeof state.cwd === 'string' && path.isAbsolute(state.cwd) && !/[\x00-\x1f]/.test(state.cwd) ? state.cwd : null };
  } catch { return null; }
}

export function watchPi(stateDir, session, launchId, update) {
  let stopped = false, busy = false, revision = -1;
  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const state = await readPiState(stateDir, session.id);
      if (!stopped && state?.launchId === launchId && Number.isInteger(state.revision) && state.revision > revision) {
        revision = state.revision; update(state);
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => void poll(), 300);
  timer.unref(); void poll();
  return () => { stopped = true; clearInterval(timer); };
}
