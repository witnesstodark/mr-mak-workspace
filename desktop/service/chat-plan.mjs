import { createHmac } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { equalSecret } from './util.mjs';
import { codexRulesInstruction, globalRulesFile } from './project-rules.mjs';

// The plan of one chat, beside the chat. Every agent Mr. Mak can instruct keeps
// it in a small Markdown file in the project, which the Plan panel reads. The
// folder ignores itself, so plans never reach the repository.
export const PLANS_DIR = path.join('.agents', 'plans');
const MAX_BYTES = 64 * 1024, MAX_TASKS = 100;
const text = (value, max = 300) => value.replace(/\s+/g, ' ').trim().slice(0, max);
const MARKS = { ' ': 'pending', x: 'completed', X: 'completed', '>': 'in_progress', '~': 'in_progress', '/': 'in_progress', '-': 'in_progress' };
export const PLAN_STATUSES = ['working', 'needs review', 'blocked', 'done'];

export function planFile(cwd, id) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !/^[\w-]{1,80}$/.test(String(id))) throw new Error('This chat has no plan file.');
  return path.join(cwd, PLANS_DIR, `${id}.md`);
}

export async function preparePlanFolder(cwd) {
  const folder = path.join(cwd, PLANS_DIR);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
}

// What a chat is told about its plan: the report_plan tool when the owner turned
// it on, else the plan file.
export const planInstruction = (file, tool = false) => tool ? `Mr. Mak shows this chat's plan in a panel beside the chat. When a task has more than one step, report its plan with the ${PLAN_TOOL.name} tool (${PLAN_TOOL_NAME}): call it when the task starts, after each step and at the end, each time with the whole plan (the owner's request in one line, the status, every step with its status, and the next step).` : `Mr. Mak shows this chat's plan in a panel beside the chat. When a task has more than one step, keep its plan in ${file} (create it, Markdown, ignored by Git) and update it as you work: a line "Request: " with the owner's request in one line, a line "Status: " with working, needs review, blocked or done, one checklist line per step ("- [ ] " pending, "- [>] " in progress, "- [x] " done), and a line "Next: " with the next step. Start it over when a new task begins.`;

// The skill that tells an agent how Mr. Mak's features expect it to work.
export const featuresSkillFile = repo => path.join(repo, '.agents', 'skills', 'mrmak-chat-features', 'SKILL.md');
const featuresInstruction = (file, repo) => `When a message comes from a Mr. Mak feature or a task touches one (the plan, project or global rules and "remember:" notes, the Run game button and .agents/game.json, a Workspace card asset, a handoff, links to files, a Game UI Studio Copilot message), read ${file} first. In it, <mrmak> means ${repo}.`;

// The instructions a chat starts with: its plan file, the features skill and
// the global and project rules from Mr. Mak's repository and the project.
// Rewritten on each launch, so a resumed chat gets the current rules.
export async function writeChatInstructions(stateDir, session, rulesFile, tool = false, repo = null) {
  const plan = planFile(session.cwd, session.id);
  await preparePlanFolder(session.cwd);
  const rules = rulesFile ? await readFile(rulesFile, 'utf8').catch(() => '') : '';
  const globalFile = repo && globalRulesFile(repo), skill = repo && featuresSkillFile(repo);
  const global = globalFile ? await readFile(globalFile, 'utf8').catch(() => '') : '';
  const parts = ['# Mr. Mak chat', planInstruction(plan, tool)];
  if (skill && await stat(skill).then(info => info.isFile(), () => false)) parts.push(featuresInstruction(skill, repo));
  if (/^\s*[-*]\s+\S/m.test(global)) parts.push(`Global rules are in ${globalFile}; follow them in every task.`, global.replace(/^\uFEFF/, '').trim());
  if (rules.trim()) parts.push(codexRulesInstruction(rulesFile), rules.replace(/^﻿/, '').trim());
  const file = path.join(stateDir, 'chat-instructions', `${session.id}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, parts.join('\n\n') + '\n');
  return file;
}

// Codex takes extra developer instructions as one config value; a value that is
// not TOML is used verbatim, so the sentence needs no quoting on any platform.
export const codexInstruction = file => `Mr. Mak instructions for this chat are in ${file}. Read that file before your first task and follow it.`;

export function parsePlan(source) {
  const plan = { request: '', status: '', next: '', tasks: [] };
  for (const line of source.split(/\r?\n/)) {
    const task = /^\s*[-*]\s+\[([ xX>~/-])\]\s+(.*\S)/.exec(line);
    if (task) { if (plan.tasks.length < MAX_TASKS) plan.tasks.push({ id: `step-${plan.tasks.length}`, subject: text(task[2]), activeForm: '', status: MARKS[task[1]] }); continue; }
    const field = /^\s*(?:[-*]\s+)?\**(Request|Status|Next)\**\s*:\s*\**\s*(.*\S)/i.exec(line);
    if (field) plan[field[1].toLowerCase()] = text(field[2], field[1].toLowerCase() === 'status' ? 40 : 300);
  }
  const status = plan.status.toLowerCase();
  plan.status = PLAN_STATUSES.find(item => status.startsWith(item)) || (plan.status ? 'working' : '');
  return plan;
}

// The Plan tool (off by default, so chats carry no extra tool unless the owner
// wants it). Each chat gets its own key, so one chat cannot write another's plan.
export const PLAN_SERVER = 'mrmak-plan';
export const PLAN_TOOL = {
  name: 'report_plan',
  description: "Show this chat's plan in Mr. Mak's Plan panel beside the chat. Call it when a task with more than one step starts, after each step and at the end. Send the whole plan each time; it replaces the previous one.",
  inputSchema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: "The owner's request, in one line." },
      status: { type: 'string', enum: PLAN_STATUSES },
      steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['text', 'status'] } },
      next: { type: 'string', description: 'The next step, in one line.' },
    },
    required: ['steps'],
  },
};
export const PLAN_TOOL_NAME = `mcp__${PLAN_SERVER}__${PLAN_TOOL.name}`;
const bridge = fileURLToPath(new URL('./chat-plan-mcp.mjs', import.meta.url));
export const planKey = (secret, id) => createHmac('sha256', secret).update(String(id)).digest('base64url');
export const validPlanKey = (secret, id, key) => typeof key === 'string' && equalSecret(key, planKey(secret, id));

const line = value => typeof value === 'string' ? text(value) : '';
const STEP_MARKS = { pending: ' ', in_progress: '>', completed: 'x' };
// The tool's plan, written as the same file an agent would keep.
export function planMarkdown(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.steps)) throw new Error('Send the plan with its steps.');
  const steps = input.steps.slice(0, MAX_TASKS).map(item => ({ text: line(item?.text), status: STEP_MARKS[item?.status] ? item.status : 'pending' })).filter(item => item.text);
  const status = PLAN_STATUSES.includes(input.status) ? input.status : 'working';
  return ['# Plan', ...(line(input.request) ? [`Request: ${line(input.request)}`] : []), `Status: ${status}`, ...steps.map(item => `- [${STEP_MARKS[item.status]}] ${item.text}`), ...(line(input.next) ? [`Next: ${line(input.next)}`] : [])].join('\n') + '\n';
}

export async function savePlan(cwd, id, input) {
  const file = planFile(cwd, id), markdown = planMarkdown(input);
  await preparePlanFolder(cwd);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, markdown);
  await rename(temporary, file);
  const plan = parsePlan(markdown);
  return `ok: ${plan.tasks.filter(item => item.status === 'completed').length}/${plan.tasks.length} steps, ${plan.status}`;
}

// How a chat starts the Plan tool: the MCP server's command, and for Claude a config file.
export async function planServer(stateDir, session, { url, secret }) {
  const server = { command: process.execPath, args: [bridge], env: { MRMAK_PLAN_URL: url, MRMAK_PLAN_CHAT: session.id, MRMAK_PLAN_KEY: planKey(secret, session.id) } };
  const configFile = path.join(stateDir, 'chat-instructions', `${session.id}.mcp.json`);
  await mkdir(path.dirname(configFile), { recursive: true });
  await writeFile(configFile, JSON.stringify({ mcpServers: { [PLAN_SERVER]: { type: 'stdio', ...server } } }));
  return { ...server, configFile };
}

export async function readPlanFile(file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > MAX_BYTES) return null;
  const plan = parsePlan(await readFile(file, 'utf8').catch(() => ''));
  return plan.tasks.length || plan.request ? { ...plan, updatedAt: info.mtime.toISOString() } : null;
}

// The chat's plan file first; a Claude chat also shows what it scheduled, and its
// own task list while it keeps no plan file.
export async function chatPlan(session, claudeSessions) {
  const file = planFile(session.cwd, session.id);
  const [own, claude] = await Promise.all([readPlanFile(file), session.agent === 'claude' ? claudeSessions.plan(session).catch(() => null) : null]);
  const native = claude || { tasks: [], schedules: [], updatedAt: null };
  const plan = own || { request: '', status: '', next: '', tasks: native.tasks, updatedAt: native.updatedAt };
  return { ...plan, schedules: native.schedules, source: own ? 'file' : native.tasks.length ? 'agent' : 'none', file };
}
