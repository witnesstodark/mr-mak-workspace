import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Rules the owner set for agents in one project folder. They live in the
// repository, so they travel with it, and each new chat there starts with them.
export const RULES_PATH = path.join('.agents', 'rules.md');
const MAX_RULES = 200, MAX_TEXT = 500, MAX_BYTES = 256 * 1024;
const HEADER = `# Project rules

Rules the owner set for agents working in this project. Follow them in every task.
When the owner corrects how you work and the correction should hold for later tasks,
add it here as one short line starting with "- ", then tell the owner which rule you
added. Do not remove or reword a rule unless the owner asks.
`;

const GLOBAL_HEADER = `# Global rules

Rules the owner set for every agent Mr. Mak starts, in any project. Follow them in
every task. Do not remove or reword a rule unless the owner asks.
`;
// Rules for every chat, kept with Mr. Mak's own repository.
export const globalRulesFile = repo => path.join(repo, '.agents', 'global-rules.md');

const rulesFile = cwd => {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Choose a project folder.');
  return path.join(cwd, RULES_PATH);
};
const bullet = /^\s*[-*]\s+(.*\S)\s*$/;

async function load(file) {
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('The project rules file is not a readable text file.');
  return (await readFile(file, 'utf8')).replace(/^﻿/, '');
}

const parse = text => text.split(/\r?\n/).flatMap((line, index) => {
  const match = bullet.exec(line);
  return match ? [{ line: index, text: match[1] }] : [];
});

export async function readRulesAt(file) {
  const text = await load(file);
  return { path: file, exists: text != null, rules: text == null ? [] : parse(text) };
}
export const readRules = cwd => readRulesAt(rulesFile(cwd));

// The file a new chat starts with, or null while it holds no rule.
export async function activeRules(cwd, file = rulesFile(cwd)) {
  try { const { rules } = await readRulesAt(file); return rules.length ? file : null; }
  catch { return null; }
}

function ruleText(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value.trim()) || !value.trim() || value.trim().length > MAX_TEXT) throw new Error(`Write a rule as one line of at most ${MAX_TEXT} characters.`);
  return value.trim().replace(/^[-*]\s+/, '');
}

// Edits only the rule lines. Anything else an agent or the owner wrote in the
// file stays where it was. A rule that changed since it was read is refused.
export const editRules = (cwd, change) => editRulesAt(rulesFile(cwd), change, HEADER);
export const editGlobalRules = (repo, change) => editRulesAt(globalRulesFile(repo), change, GLOBAL_HEADER);
export async function editRulesAt(file, { action, line, expected, text } = {}, header = HEADER) {
  const current = await load(file);
  const eol = current?.includes('\r\n') ? '\r\n' : '\n';
  const lines = (current ?? header).split(/\r?\n/);
  if (action === 'add') {
    if (parse(lines.join('\n')).length >= MAX_RULES) throw new Error(`A project keeps at most ${MAX_RULES} rules.`);
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    lines.push(`- ${ruleText(text)}`, '');
  } else if (action === 'update' || action === 'remove') {
    const match = Number.isInteger(line) ? bullet.exec(lines[line] ?? '') : null;
    if (!match || match[1] !== expected) throw new Error('The rules changed since they were shown. Check the list and try again.');
    if (action === 'update') lines[line] = `${/^\s*/.exec(lines[line])[0]}- ${ruleText(text)}`;
    else lines.splice(line, 1);
  } else throw new Error('Choose add, update or remove.');
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, lines.join(eol));
  await rename(temporary, file);
  return readRulesAt(file);
}

// A rule the owner marked in a message: "remember: …" or "lembre: …" at its start.
const MARKER = /^\s*(?:remember|lembre(?:-se)?)\s*:\s*(\S[\s\S]*)$/i;
export function markedRule(text) {
  const match = MARKER.exec(String(text || ''));
  const rule = match?.[1].replace(/\s+/g, ' ').trim();
  return rule && rule.length <= MAX_TEXT ? rule : null;
}

// Codex takes extra developer instructions as one config value. A value that is
// not TOML is used verbatim, so the sentence needs no quoting on any platform.
export const codexRulesInstruction = file => `Project rules for this folder are in ${file}. Read that file before your first task and follow it. When the owner corrects how you work and the correction should hold for later tasks, add it there as one short line starting with a dash.`;
