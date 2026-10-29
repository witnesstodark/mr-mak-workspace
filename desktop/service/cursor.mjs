import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandPath, wrapCommand } from './agents.mjs';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// The interactive CLI prints this when it exits: `agent --resume=<id>`.
export function cursorResumeId(text) {
  const match = new RegExp(`--resume(?:=|\\s+)(${uuid})`, 'i').exec(String(text || ''));
  return match ? match[1] : null;
}

// `agent create-chat` writes a local empty conversation and prints its UUID.
// It does not call the API, so a new tab can resume even if the terminal is
// closed before the CLI prints its own resume line.
export async function createCursorChat(cwd, env = process.env) {
  const file = commandPath('agent', env);
  if (!file) throw new Error('Cursor Agent is not installed on this computer');
  const command = wrapCommand(file, ['create-chat']);
  const { stdout } = await promisify(execFile)(command.file, command.args, { cwd, env, windowsHide: true, timeout: 20000, maxBuffer: 64000 });
  const match = new RegExp(uuid, 'i').exec(stdout);
  if (!match) throw new Error('Cursor Agent did not return a conversation ID.');
  return match[0];
}
