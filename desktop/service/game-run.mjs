import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isExecutable, isWindows, resolveCommand, terminateProcessTree } from './platform.mjs';
import { readJson, saveJson, within } from './util.mjs';

// How one project starts its game. It lives in the repository beside the
// project rules, so an agent sets it up once and the owner can run the game
// from Mr. Mak without spending an agent turn. Because the file comes from the
// repository, nothing in it runs until the owner has seen the exact command and
// confirmed it; a changed file needs a new confirmation.
export const GAME_PATH = path.join('.agents', 'game.json');
export const MAX_RUN_MS = 12 * 60 * 60 * 1000;
const MAX_BYTES = 16 * 1024, MAX_COMMAND = 2000, MAX_LINES = 200, MAX_LINE = 1000, MAX_APPROVALS = 200;
const windowsPrograms = ['.exe', '.com', '.cmd', '.bat'];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const gameFile = cwd => {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw fail('Choose a project folder.');
  return path.join(cwd, GAME_PATH);
};
const line = (value, name, max) => {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || value.length > max) throw fail(`The game ${name} must be one line of at most ${max} characters.`);
  return value.trim();
};
const previewUrl = value => {
  const url = line(value, 'preview address', 500);
  if (url && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i.test(url)) throw fail('The preview address must be a local http address, such as http://localhost:8080.');
  return url;
};

// The command line as a program and its arguments, run without a shell. Double
// or single quotes group words; backslashes stay literal for Windows paths.
// Shell operators are refused so the command shown is the only one that runs.
export function commandWords(command) {
  const words = [];
  let word = '', quote = '', started = false;
  for (const character of command) {
    if (quote) { if (character === quote) quote = ''; else word += character; continue; }
    if (character === '"' || character === "'") { quote = character; started = true; continue; }
    if (/\s/.test(character)) { if (started) words.push(word); word = ''; started = false; continue; }
    if (/[&|<>;`]/.test(character)) throw fail('Mr. Mak runs the game command without a shell. Write one program and its arguments; put several steps in a script in the project.');
    word += character; started = true;
  }
  if (quote) throw fail('The game command has an unclosed quote.');
  if (started) words.push(word);
  if (!words.length || !words[0]) throw fail('Write the command that starts the game.');
  return words;
}

// Only these fields are kept. Unknown fields are dropped; wrong types are refused.
export function gameConfig(value, cwd) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('The game settings must be a JSON object.');
  const command = line(value.command, 'command', MAX_COMMAND), folder = line(value.cwd, 'folder', 500);
  if (!command) throw fail('Write the command that starts the game.');
  commandWords(command);
  if (folder && (path.isAbsolute(folder) || !within(cwd, path.resolve(cwd, folder)))) throw fail('The game folder must be a folder inside the project.');
  const url = previewUrl(value.url);
  return { command, ...(folder ? { cwd: folder } : {}), ...(url ? { url } : {}) };
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

// What an approval covers: the project and every field that decides what runs
// or what the panel loads.
export const gameDigest = (cwd, config) => createHash('sha256').update(JSON.stringify([path.resolve(cwd), config.command, config.cwd || '', config.url || ''])).digest('hex').slice(0, 32);
const folderKey = cwd => isWindows ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);

// Resolve the program the way the owner expects to read it: a path is taken
// from the game folder, a bare name from PATH (then the game folder on
// Windows, as cmd.exe does for gradlew.bat).
function resolveProgram(name, folder) {
  const candidates = file => isWindows && !path.extname(file) ? windowsPrograms.map(extension => file + extension) : [file];
  if (path.isAbsolute(name) || /[\\/]/.test(name)) return candidates(path.resolve(folder, name)).find(isExecutable) || null;
  const found = resolveCommand(name);
  if (found) return found;
  return isWindows ? candidates(path.join(folder, name)).find(isExecutable) || null : null;
}

// cmd.exe is needed only for .cmd and .bat programs on Windows. Arguments are
// quoted for it and characters it would still expand inside quotes are refused.
const cmdArgument = value => {
  if (/["%\r\n]/.test(value)) throw fail('On Windows a .cmd or .bat game command cannot contain " or % in its arguments.');
  return value === '' || /[\s&|<>^(),;=!@]/.test(value) ? `"${value}"` : value;
};

// The launch Mr. Mak would perform for this configuration. Nothing runs here.
export async function gamePlan(cwd, config) {
  const project = await realpath(cwd);
  const folder = config.cwd ? await realpath(path.resolve(project, config.cwd)).catch(() => null) : project;
  if (!folder || !within(project, folder) || !(await stat(folder)).isDirectory()) throw fail('The game folder does not exist inside the project.');
  const [name, ...args] = commandWords(config.command);
  const program = resolveProgram(name, folder);
  if (!program) throw fail(`Mr. Mak cannot find the program ${name}. Use its full path or a path inside the project.`);
  const extension = path.extname(program).toLowerCase();
  if (isWindows && !windowsPrograms.includes(extension)) throw fail('On Windows the game command must start a .exe, .cmd or .bat program.');
  if (isWindows && ['.cmd', '.bat'].includes(extension)) {
    const commandLine = [`"${program}"`, ...args.map(cmdArgument)].join(' ');
    return { folder, program, args, shell: true, file: process.env.ComSpec || 'cmd.exe', argv: ['/d', '/v:off', '/s', '/c', `"${commandLine}"`], verbatim: true };
  }
  return { folder, program, args, shell: false, file: program, argv: args, verbatim: false };
}

// Commands the owner confirmed, per project, kept in Mr. Mak's own state
// folder: a freshly cloned repository cannot bring its own approval.
export class GameApprovals {
  constructor(file) { this.file = file; this.items = null; this.saves = Promise.resolve(); }
  async load() { if (!this.items) { const saved = this.file ? await readJson(this.file, {}) : {}; this.items = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; } return this.items; }
  async state(cwd, digest) { const items = await this.load(), current = items[folderKey(cwd)]; return { approved: current?.digest === digest, changed: !!current && current.digest !== digest }; }
  async approve(cwd, digest) {
    const items = await this.load();
    items[folderKey(cwd)] = { digest, at: new Date().toISOString() };
    const keys = Object.keys(items).sort((a, b) => String(items[b].at).localeCompare(String(items[a].at)));
    for (const key of keys.slice(MAX_APPROVALS)) delete items[key];
    if (this.file) { this.saves = this.saves.catch(() => {}).then(() => saveJson(this.file, items)); await this.saves; }
  }
}

// What the panel shows before the owner runs anything.
export async function describeGame(cwd, approvals) {
  const game = await readGame(cwd);
  if (!game.config) return { ...game, launch: null };
  const digest = gameDigest(cwd, game.config);
  try {
    const plan = await gamePlan(cwd, game.config);
    return { ...game, launch: { digest, ...await approvals.state(cwd, digest), program: plan.program, args: plan.args, folder: plan.folder, shell: plan.shell } };
  } catch (error) { return { ...game, launch: { digest, ...await approvals.state(cwd, digest), error: error.message } }; }
}

// The message an agent receives when the owner asks it to set the game up.
export const gameSetupPrompt = (file, folder, guide) => `Set up the Mr. Mak "Run game" button for the project in ${folder}.${guide ? ` Follow ${guide}.` : ''} Find how its game is started (executable, engine command, dev server or script), then write ${file} as JSON with "command" (one program and its arguments that start the game in its own window; Mr. Mak runs it without a shell, so no &&, pipes or redirections), optional "cwd" (a folder relative to the project) and optional "url" (a local http address when the game runs in a browser, such as a dev server). Do not start the game yourself. Tell me the command you chose. Update the file later when the way the game starts changes.`;

// One running game per project folder. Output stays in memory for the panel.
export class GameRunner extends EventEmitter {
  constructor({ approvals = new GameApprovals(null), maxRunMs = MAX_RUN_MS } = {}) { super(); this.runs = new Map(); this.approvals = approvals; this.maxRunMs = maxRunMs; this.closed = false; }
  status(cwd) {
    const run = this.runs.get(folderKey(cwd));
    return run ? { running: run.running, pid: run.pid, startedAt: run.startedAt, endedAt: run.endedAt, exitCode: run.exitCode, command: run.command, sessionId: run.sessionId, output: run.output.slice(-MAX_LINES) } : { running: false, output: [] };
  }
  // Runs only with the owner's confirmation of this exact configuration: either
  // one saved earlier, or `approve` carrying the digest the panel showed.
  async run(cwd, { approve, sessionId = null } = {}) {
    if (this.closed) throw fail('Mr. Mak is closing.');
    const key = folderKey(cwd);
    if (this.runs.get(key)?.running) return this.status(cwd);
    const { config, error } = await readGame(cwd);
    if (!config) throw fail(error || 'This project has no game command yet. Ask an agent to set it up.');
    const digest = gameDigest(cwd, config), approval = await this.approvals.state(cwd, digest);
    if (!approval.approved) {
      if (approve !== digest) throw Object.assign(fail(approve ? 'The game command changed after you saw it. Review the new command.' : 'Confirm the game command before it runs.', 409), { confirm: true });
    }
    const plan = await gamePlan(cwd, config);
    if (!approval.approved) await this.approvals.approve(cwd, digest);
    if (this.runs.get(key)?.running) return this.status(cwd);
    const child = spawn(plan.file, plan.argv, { cwd: plan.folder, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: plan.verbatim, detached: !isWindows });
    const run = { child, cwd, pid: child.pid, running: true, startedAt: new Date().toISOString(), command: config.command, sessionId, output: [], partial: '' };
    this.runs.set(key, run);
    let timer = null;
    const changed = () => { if (!timer) timer = setTimeout(() => { timer = null; this.emit('changed', cwd); }, 150); };
    const keep = text => { if (text.trim()) run.output.push(text.length > MAX_LINE ? text.slice(0, MAX_LINE) + '…' : text); };
    const add = chunk => {
      const lines = (run.partial + String(chunk)).split(/\r?\n/);
      run.partial = lines.pop().slice(-MAX_LINE * 4);
      for (const text of lines) keep(text);
      if (run.output.length > MAX_LINES * 2) run.output.splice(0, run.output.length - MAX_LINES);
      changed();
    };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const limit = setTimeout(() => { run.output.push(`Stopped after ${Math.round(this.maxRunMs / 60000)} minutes.`); void this.stop(cwd); }, this.maxRunMs);
    limit.unref?.();
    run.exited = new Promise(resolve => {
      const ended = (code, failure) => {
        if (!run.running) return;
        clearTimeout(limit); keep(run.partial); run.partial = '';
        Object.assign(run, { running: false, endedAt: new Date().toISOString(), exitCode: code ?? null });
        if (failure) run.output.push(`Could not start: ${failure.message}`);
        clearTimeout(timer); timer = null; this.emit('changed', cwd); resolve();
      };
      child.once('error', failure => ended(null, failure));
      // Output can still be in the pipes when the process exits.
      child.once('exit', code => { const done = () => ended(code); child.once('close', done); setTimeout(done, 500).unref?.(); });
    });
    this.emit('changed', cwd);
    return this.status(cwd);
  }
  // Ends the command's whole process tree and waits for it to exit.
  async stop(cwd) {
    const run = this.runs.get(folderKey(cwd));
    if (run?.running) {
      await terminateProcessTree(run.pid, { force: true });
      await Promise.race([run.exited, new Promise(resolve => setTimeout(resolve, 5000).unref?.())]);
    }
    return this.status(cwd);
  }
  // A closed chat takes the game it started with it.
  async stopSession(sessionId) {
    await Promise.all([...this.runs.values()].filter(run => run.running && run.sessionId === sessionId).map(run => this.stop(run.cwd)));
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.runs.values()].filter(run => run.running).map(run => this.stop(run.cwd)));
  }
}
