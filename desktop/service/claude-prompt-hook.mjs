// Claude Code runs this before AskUserQuestion and ExitPlanMode in chats Mr. Mak
// starts (see claude-prompts.mjs). It saves what Claude is about to ask, so the
// phone can show it, and says nothing back: the tool runs as it would anyway.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2];
let input = '';
try {
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw new Error('Too large'); }
  const data = JSON.parse(input);
  if (dir && /^[A-Za-z0-9-]{1,128}$/.test(data.session_id || '') && typeof data.tool_use_id === 'string') {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${data.session_id}.json`), temporary = `${file}.${process.pid}`;
    await writeFile(temporary, JSON.stringify({ tool: data.tool_name, id: data.tool_use_id, input: data.tool_input, at: new Date().toISOString() }));
    await rename(temporary, file);
  }
} catch { /* A missed save only means the phone cannot show this question. */ }
process.exit(0);
