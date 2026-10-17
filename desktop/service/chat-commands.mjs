import os from 'node:os';
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

// Built-in commands each CLI ships. `terminal` marks commands that open a picker
// or dialog the Conversation view cannot draw, so the chat switches to Terminal.
const CLAUDE_BUILTINS = [
  ['add-dir', 'Add a working directory'], ['agents', 'Manage subagents', true], ['clear', 'Clear the conversation history'],
  ['compact', 'Summarize the conversation to free context'], ['config', 'Open settings', true], ['context', 'Show context usage'],
  ['cost', 'Show session cost and plan usage', true], ['doctor', 'Check the Claude Code installation', true], ['export', 'Export the conversation', true],
  ['help', 'Show help', true], ['hooks', 'Manage hooks', true], ['init', 'Create a CLAUDE.md for this project'],
  ['login', 'Sign in', true], ['logout', 'Sign out', true], ['mcp', 'Manage MCP servers', true], ['memory', 'Edit memory files', true],
  ['model', 'Choose the model', true], ['output-style', 'Choose the output style', true], ['permissions', 'Manage tool permissions', true],
  ['plugin', 'Manage plugins', true], ['release-notes', 'Show release notes'], ['resume', 'Resume another conversation', true],
  ['review', 'Review a pull request'], ['rewind', 'Rewind the conversation or code', true], ['security-review', 'Review pending changes for security issues'],
  ['status', 'Show account and system status', true], ['statusline', 'Set up the status line'], ['todos', 'Show the current todo list'],
  ['usage', 'Show plan usage limits', true], ['vim', 'Toggle Vim editing mode'],
];
// Checked against Codex 0.163. Commands that start another thread in the same
// terminal (/fork, /side, /clear) are left out; /new and /resume remain.
const CODEX_BUILTINS = [
  ['agents', 'Open the agent command center', true], ['compact', 'Summarize the conversation to free context'],
  ['config', 'Configure Codex preferences', true], ['copy', 'Copy the last response or part of it', true],
  ['diff', 'Show the Git diff, including untracked files', true], ['export', 'Export the conversation as Markdown'],
  ['fast', 'Toggle faster responses with higher usage'], ['feedback', 'Send feedback to the Codex team', true],
  ['goal', 'Set or view the goal for a long-running task'], ['init', 'Create an AGENTS.md for this project'],
  ['logout', 'Sign out of Codex', true], ['mcp', 'List configured MCP tools'], ['mention', 'Mention a file', true],
  ['model', 'Choose the model and reasoning effort', true], ['new', 'Start a new conversation'],
  ['permissions', 'Choose what Codex is allowed to do', true], ['plan', 'Switch to Plan mode'],
  ['recap', 'Summarize the conversation now'], ['rename', 'Rename the current thread'],
  ['resume', 'Resume another conversation', true], ['review', 'Review current changes', true],
  ['skills', 'Choose skills for Codex to use', true], ['status', 'Show session configuration and token usage'],
];

// A single frontmatter value, including a folded or literal block (`description: >`).
function field(text, name) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1].match(new RegExp(`^${name}:[ \\t]*(.*)((?:\\r?\\n[ \\t]+.*)*)`, 'm'));
  if (!match) return '';
  const value = /^[>|][+-]?$/.test(match[1].trim()) ? match[2] : `${match[1]}${match[2]}`;
  return value.replace(/\s+/g, ' ').trim().replace(/^(['"])(.*)\1$/, '$2');
}
const isDirectory = async folder => (await stat(folder).catch(() => null))?.isDirectory() || false;
const summary = text => field(text, 'description') || text.replace(/^---[\s\S]*?\n---/, '').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#')) || '';

// One skill per `<root>/<folder>/SKILL.md`; the frontmatter name wins over the folder.
async function skills(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const text = await readFile(path.join(root, entry.name, 'SKILL.md'), 'utf8').catch(() => null);
    return text === null ? null : { name: prefix + (field(text, 'name') || entry.name), description: summary(text) };
  }))).filter(Boolean);
}
async function markdownCommands(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(async entry => {
    const text = await readFile(path.join(root, entry.name), 'utf8').catch(() => '');
    return { name: prefix + entry.name.slice(0, -3), description: summary(text) };
  }));
}
// The chat folder and its parents up to the repository root, nearest first.
async function projectFolders(cwd) {
  const folders = [];
  for (let folder = path.resolve(cwd); ; folder = path.dirname(folder)) {
    folders.push(folder);
    if (await stat(path.join(folder, '.git')).catch(() => null) || path.dirname(folder) === folder) return folders;
  }
}
async function claudePlugins(claudeHome) {
  const installed = JSON.parse(await readFile(path.join(claudeHome, 'plugins', 'installed_plugins.json'), 'utf8').catch(() => '{}')).plugins || {};
  const enabled = JSON.parse(await readFile(path.join(claudeHome, 'settings.json'), 'utf8').catch(() => '{}')).enabledPlugins || {};
  const found = [];
  for (const [id, installs] of Object.entries(installed)) {
    const folder = Array.isArray(installs) ? installs[0]?.installPath : null;
    if (enabled[id] !== true || typeof folder !== 'string') continue;
    const prefix = `${id.split('@')[0]}:`;
    found.push(...await skills(path.join(folder, 'skills'), prefix), ...await markdownCommands(path.join(folder, 'commands'), prefix));
  }
  return found;
}

// Commands and skills the chat's CLI accepts in its prompt, for Conversation autocomplete.
export async function chatCommands(agent, cwd, { home = os.homedir(), env = process.env } = {}) {
  const items = [], seen = new Set();
  const add = (trigger, source, list) => {
    for (const item of list) {
      const key = `${trigger}${item.name}`.toLowerCase();
      if (!item.name || seen.has(key)) continue;
      seen.add(key); items.push({ trigger, name: item.name, description: item.description.slice(0, 200), source, ...(item.terminal ? { terminal: true } : {}) });
    }
  };
  const builtins = list => list.map(([name, description, terminal = false]) => ({ name, description, terminal }));
  const folders = cwd && await isDirectory(cwd) ? await projectFolders(cwd) : [];
  if (agent === 'claude') {
    const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    add('/', 'built-in', builtins(CLAUDE_BUILTINS));
    for (const folder of folders) { add('/', 'project', await markdownCommands(path.join(folder, '.claude', 'commands'))); add('/', 'project', await skills(path.join(folder, '.claude', 'skills'))); }
    add('/', 'user', await markdownCommands(path.join(claudeHome, 'commands')));
    add('/', 'user', await skills(path.join(claudeHome, 'skills')));
    add('/', 'plugin', await claudePlugins(claudeHome));
  } else if (agent === 'codex') {
    const codexHome = env.CODEX_HOME || path.join(home, '.codex');
    add('/', 'built-in', builtins(CODEX_BUILTINS));
    add('/', 'user', await markdownCommands(path.join(codexHome, 'prompts'), 'prompts:'));
    for (const folder of folders) add('$', 'project', await skills(path.join(folder, '.agents', 'skills')));
    add('$', 'user', await skills(path.join(home, '.agents', 'skills')));
    add('$', 'user', await skills(path.join(codexHome, 'skills')));
  }
  return { commands: items };
}
