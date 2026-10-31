import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

// The plan of one Claude Code conversation: its task checklist (TaskCreate and
// TaskUpdate, or the older TodoWrite) and what it scheduled (CronCreate and
// ScheduleWakeup). Read from the transcript as it grows, so a long conversation
// is read once and then only its new lines.
const CHUNK = 4 * 1024 * 1024;
const STATUSES = new Set(['pending', 'in_progress', 'completed']);
const text = (value, max = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function emptyPlan() {
  return { tasks: new Map(), todos: [], creates: new Map(), crons: new Map(), cronCreates: new Map(), wakeup: null, updatedAt: null, nextTask: 1 };
}

const resultText = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text || '').join('\n') : '';

// One transcript record applied to the plan. Subagent sidechains keep their own plans.
export function applyRecord(plan, record) {
  if (!record || record.isSidechain || !Array.isArray(record.message?.content)) return;
  for (const part of record.message.content) {
    if (part?.type === 'tool_use') {
      const input = part.input && typeof part.input === 'object' ? part.input : {};
      if (part.name === 'TaskCreate') plan.creates.set(part.id, input);
      else if (part.name === 'TaskUpdate') {
        const task = plan.tasks.get(String(input.taskId));
        if (!task) continue;
        if (input.status === 'deleted') plan.tasks.delete(task.id);
        else {
          if (STATUSES.has(input.status)) task.status = input.status;
          for (const field of ['subject', 'activeForm']) if (text(input[field])) task[field] = text(input[field]);
        }
      } else if (part.name === 'TodoWrite' && Array.isArray(input.todos)) {
        plan.todos = input.todos.slice(0, 100).map((item, index) => ({ id: `todo-${index}`, subject: text(item?.content), activeForm: text(item?.activeForm), status: STATUSES.has(item?.status) ? item.status : 'pending' })).filter(item => item.subject);
      } else if (part.name === 'CronCreate') plan.cronCreates.set(part.id, input);
      else if (part.name === 'CronDelete') plan.crons.delete(String(input.id ?? input.jobId ?? ''));
      else if (part.name === 'ScheduleWakeup') {
        const at = Date.parse(record.timestamp) + Number(input.delaySeconds) * 1000;
        plan.wakeup = input.stop === true || !Number.isFinite(at) ? null : { at: new Date(at).toISOString(), prompt: text(input.prompt), reason: text(input.reason) };
      } else continue;
      plan.updatedAt = record.timestamp || plan.updatedAt;
    } else if (part?.type === 'tool_result') {
      const created = plan.creates.get(part.tool_use_id), cron = plan.cronCreates.get(part.tool_use_id);
      if (!created && !cron) continue;
      plan.creates.delete(part.tool_use_id); plan.cronCreates.delete(part.tool_use_id);
      const result = resultText(part.content);
      if (part.is_error) continue;
      if (created) {
        const id = /Task #(\w+) created/i.exec(result)?.[1] || String(plan.nextTask);
        plan.nextTask = Math.max(plan.nextTask, Number(id) + 1 || plan.nextTask + 1);
        plan.tasks.set(id, { id, subject: text(created.subject) || 'Task', activeForm: text(created.activeForm), status: 'pending' });
      } else {
        // The job ID CronDelete names, as the result reports it.
        const id = /\b(?:job|id)\b[\s:#=]*([\w-]{4,})/i.exec(result)?.[1] || part.tool_use_id;
        plan.crons.set(id, { id, schedule: text(cron.cron ?? cron.schedule, 80), prompt: text(cron.prompt), recurring: cron.recurring !== false });
      }
      plan.updatedAt = record.timestamp || plan.updatedAt;
    }
  }
}

export function planView(plan, now = Date.now()) {
  const tasks = plan.tasks.size ? [...plan.tasks.values()] : plan.todos;
  const schedules = [...plan.crons.values()].map(item => ({ kind: 'cron', ...item }));
  if (plan.wakeup && Date.parse(plan.wakeup.at) > now - 60000) schedules.push({ kind: 'wakeup', ...plan.wakeup });
  return { tasks: tasks.map(({ id, subject, activeForm, status }) => ({ id, subject, activeForm, status })), schedules, updatedAt: plan.updatedAt };
}

export class ClaudePlans {
  cache = new Map();
  async read(file) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return planView(emptyPlan());
    let entry = this.cache.get(file);
    // A shorter or replaced file starts over.
    if (!entry || info.size < entry.offset || info.birthtimeMs !== entry.birth) entry = { offset: 0, rest: '', decoder: new StringDecoder('utf8'), plan: emptyPlan(), birth: info.birthtimeMs };
    if (info.size > entry.offset) {
      const handle = await open(file, 'r');
      try {
        while (entry.offset < info.size) {
          const buffer = Buffer.alloc(Math.min(CHUNK, info.size - entry.offset));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, entry.offset);
          if (!bytesRead) break;
          entry.offset += bytesRead;
          const lines = (entry.rest + entry.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
          entry.rest = lines.pop();
          for (const line of lines) {
            // Only lines that can change the plan are parsed.
            const waiting = entry.plan.creates.size || entry.plan.cronCreates.size;
            if (!/"(?:TaskCreate|TaskUpdate|TodoWrite|CronCreate|CronDelete|ScheduleWakeup)"/.test(line) && !(waiting && line.includes('"tool_result"'))) continue;
            try { applyRecord(entry.plan, JSON.parse(line)); } catch { /* A damaged line is skipped. */ }
          }
        }
      } finally { await handle.close(); }
    }
    this.cache.delete(file); this.cache.set(file, entry);
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
    return planView(entry.plan);
  }
}
