// Stdio MCP server that an agent chat starts. It forwards each tool call to the
// Mr. Mak service, which checks the chat's key and runs the call as that chat.
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chatToolDefinitions } from './chat-tools.mjs';

const { MRMAK_CHAT_URL: url, MRMAK_CHAT_ID: id, MRMAK_CHAT_KEY: key } = process.env;

// node:http instead of fetch: a wait can last longer than fetch's header timeout.
const call = (name, args) => new Promise((resolve, reject) => {
  const data = JSON.stringify(args || {});
  const request = http.request(new URL(`/chat-tools/${encodeURIComponent(name)}`, url), { method: 'POST', headers: { Authorization: `Bearer ${id}.${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, response => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => {
      let value;
      try { value = JSON.parse(text); } catch { value = { error: text || `HTTP ${response.statusCode}` }; }
      resolve({ ok: response.statusCode < 400, value });
    });
  });
  request.on('error', reject);
  request.end(data);
});

const server = new Server({ name: 'mrmak-chats', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: url && id && key ? chatToolDefinitions : [] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const { ok, value } = await call(params.name, params.arguments);
    return { content: [{ type: 'text', text: ok ? JSON.stringify(value, null, 2) : value.error || 'The Mr. Mak service rejected this call.' }], isError: !ok };
  } catch {
    return { content: [{ type: 'text', text: 'Mr. Mak is not running. Chat tools work only while the app is open.' }], isError: true };
  }
});
await server.connect(new StdioServerTransport());
