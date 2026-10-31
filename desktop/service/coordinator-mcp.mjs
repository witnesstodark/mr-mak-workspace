import { createInterface } from 'node:readline';
import { coordinatorTools } from './coordinator.mjs';

// The MCP server Claude Code starts for the Mr. Mak coordinator. It lists the
// coordinator tools and forwards each call to the service that started Claude.
const url = process.env.MRMAK_COORDINATOR_URL, key = process.env.MRMAK_COORDINATOR_SECRET;
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } }) + '\n');
const tools = coordinatorTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

async function call(id, { name, arguments: args } = {}) {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mrmak-Coordinator': key }, body: JSON.stringify({ name, arguments: args || {} }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Mr. Mak answered ${response.status}`);
    reply(id, { content: [{ type: 'text', text: value.text }], isError: !value.success });
  } catch (error) { reply(id, { content: [{ type: 'text', text: error.message }], isError: true }); }
}

createInterface({ input: process.stdin }).on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const { id, method, params } = message;
  if (id == null) return; // Notifications need no answer.
  if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mrmak-coordinator', version: '1.0.0' } });
  if (method === 'tools/list') return reply(id, { tools });
  if (method === 'tools/call') return void call(id, params);
  if (method === 'ping') return reply(id, {});
  fail(id, 'Only the Mr. Mak coordinator tools are available.');
});
