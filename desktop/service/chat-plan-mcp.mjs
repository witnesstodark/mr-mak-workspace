import { createInterface } from 'node:readline';
import { PLAN_TOOL } from './chat-plan.mjs';

// The MCP server a chat starts when the Plan tool is on. It has one tool,
// report_plan, and forwards each call to the Mr. Mak service with the chat's key.
const url = process.env.MRMAK_PLAN_URL, chat = process.env.MRMAK_PLAN_CHAT, key = process.env.MRMAK_PLAN_KEY;
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } }) + '\n');

async function call(id, { name, arguments: args } = {}) {
  try {
    if (name !== PLAN_TOOL.name) throw new Error('Unknown tool.');
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mrmak-Plan': key }, body: JSON.stringify({ chat, plan: args || {} }) });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || `Mr. Mak answered ${response.status}`);
    reply(id, { content: [{ type: 'text', text: value.text || 'ok' }] });
  } catch (error) { reply(id, { content: [{ type: 'text', text: error.message }], isError: true }); }
}

createInterface({ input: process.stdin }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const { id, method, params } = message;
  if (id == null) return; // Notifications need no answer.
  if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mrmak-plan', version: '1.0.0' } });
  if (method === 'tools/list') return reply(id, { tools: [PLAN_TOOL] });
  if (method === 'tools/call') return void call(id, params);
  if (method === 'ping') return reply(id, {});
  fail(id, 'Only report_plan is available.');
});
