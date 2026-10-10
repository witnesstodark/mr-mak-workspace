import path from 'node:path';
import os from 'node:os';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./whisper-dictation.py', import.meta.url));
export function localConfig(repo, env = {}) {
  const root = path.join(repo, '.cache', 'dictation');
  return { python: env.MRMAK_WHISPER_PYTHON || path.join(root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), model: env.MRMAK_WHISPER_MODEL || path.join(root, 'model') };
}
export async function localAvailable(config) {
  try { await Promise.all([access(config.python), access(path.join(config.model, 'model.bin'))]); return true; } catch { return false; }
}
export async function localTranscribe(config, audio, extension, signal) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-whisper-'));
  try {
    const file = path.join(folder, `recording.${extension}`);
    await writeFile(file, audio, { mode: 0o600 });
    const { stdout } = await execute(config.python, [worker, '--model', config.model, '--audio', file], { signal, timeout: 240000, windowsHide: true, maxBuffer: 512 * 1024 });
    return JSON.parse(stdout);
  } catch {
    throw Object.assign(new Error('Local transcription could not finish. Retry or record a shorter message.'), { status: 502 });
  } finally { await rm(folder, { recursive: true, force: true }); }
}
