import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isWindows, terminateProcessTree } from './platform.mjs';
import { within } from './util.mjs';

// How one project starts its game. It lives in the repository beside the
// project rules, so an agent sets it up once and the owner can run the game
// from Mr. Mak without spending an agent turn.
export const GAME_PATH = path.join('.agents', 'game.json');
const MAX_BYTES = 16 * 1024, MAX_OUTPUT = 200;

const gameFile = cwd => {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Choose a project folder.');
  return path.join(cwd, GAME_PATH);
};
const line = (value, name, max = 2000) => {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || value.length > max) throw new Error(`The game ${name} must be one line of at most ${max} characters.`);
  return value.trim();
};
const previewUrl = value => {
  const url = line(value, 'preview address');
  if (url && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url)) throw new Error('The preview address must be a local http address, such as http://localhost:8080.');
  return url;
};

// Only these fields are kept; the command is run only when the owner presses Run.
export function gameConfig(value, cwd) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The game settings must be a JSON object.');
  const command = line(value.command, 'command'), folder = line(value.cwd, 'folder', 500);
  if (!command) throw new Error('Write the command that starts the game.');
  if (folder && !within(cwd, path.resolve(cwd, folder))) throw new Error('The game folder must be inside the project.');
  return { command, ...(folder ? { cwd: folder } : {}), ...(previewUrl(value.url) ? { url: previewUrl(value.url) } : {}) };
}

export async function readGame(cwd) {
  const file = gameFile(cwd), info = await stat(file).catch(() => null);
  if (!info) return { path: file, config: null };
  if (!info.isFile() || info.size > MAX_BYTES) return { path: file, config: null, error: 'The game settings file is not a small JSON file.' };
  try { return { path: file, config: gameConfig(JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')), cwd) }; }
  catch (error) { return { path: file, config: null, error: error instanceof SyntaxError ? 'The game settings file is not valid JSON.' : error.message }; }
}

export async function saveGame(cwd, value) {
  const file = gameFile(cwd), config = gameConfig(value, cwd);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n');
  await rename(temporary, file);
  return readGame(cwd);
}

// The message an agent receives when the owner asks it to set the game up.
export const gameSetupPrompt = (file, folder) => `Set up the Mr. Mak "Run game" button for the project in ${folder}. Find how its game is started (executable, engine command, dev server or script), then write ${file} as JSON with "command" (the command line that starts the game in its own window; it runs in the project folder), optional "cwd" (a folder relative to the project) and optional "url" (a local http address when the game runs in a browser, such as a dev server). Do not start the game yourself. Tell me the command you chose. Update the file later when the way the game starts changes.`;

// One running game per project folder. Output stays in memory for the panel.
export class GameRunner extends EventEmitter {
  constructor() { super(); this.runs = new Map(); }
  status(cwd) {
    const run = this.runs.get(cwd);
    return run ? { running: run.running, pid: run.pid, startedAt: run.startedAt, endedAt: run.endedAt, exitCode: run.exitCode, command: run.command, output: run.output.slice(-MAX_OUTPUT) } : { running: false, output: [] };
  }
  async run(cwd) {
    if (this.runs.get(cwd)?.running) return this.status(cwd);
    const { config, error } = await readGame(cwd);
    if (!config) throw new Error(error || 'This project has no game command yet. Ask an agent to set it up.');
    const folder = config.cwd ? path.resolve(cwd, config.cwd) : cwd;
    // A shell runs the command line exactly as an agent or the owner wrote it.
    const shell = isWindows ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${config.command}"`], options: { windowsVerbatimArguments: true } } : { file: '/bin/sh', args: ['-c', config.command], options: { detached: true } };
    const child = spawn(shell.file, shell.args, { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'], ...shell.options });
    const run = { child, pid: child.pid, running: true, startedAt: new Date().toISOString(), command: config.command, output: [] };
    this.runs.set(cwd, run);
    const add = chunk => {
      for (const text of String(chunk).split(/\r?\n/)) if (text.trim()) run.output.push(text.slice(0, 1000));
      if (run.output.length > MAX_OUTPUT * 2) run.output.splice(0, run.output.length - MAX_OUTPUT);
      this.emit('changed', cwd);
    };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const ended = (code, failure) => {
      if (!run.running) return;
      Object.assign(run, { running: false, endedAt: new Date().toISOString(), exitCode: code ?? null });
      if (failure) run.output.push(`Could not start: ${failure.message}`);
      this.emit('changed', cwd);
    };
    child.once('error', error => ended(null, error));
    child.once('exit', code => ended(code));
    this.emit('changed', cwd);
    return this.status(cwd);
  }
  async stop(cwd) {
    const run = this.runs.get(cwd);
    if (run?.running) await terminateProcessTree(run.pid, { force: true });
    return this.status(cwd);
  }
  async close() { await Promise.all([...this.runs.keys()].map(cwd => this.stop(cwd))); }
}
