import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { claudeBinary, childEnvironment } from './agents.mjs';
import { Coordinator, TIMEOUT, TURN_MS, coordinatorInstructions, coordinatorTools } from './coordinator.mjs';
import { equalSecret, publicError, secret } from './util.mjs';

const bridge = fileURLToPath(new URL('./coordinator-mcp.mjs', import.meta.url));
const SERVER = 'mrmak';
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const EFFORTS = { medium: 'medium', high: 'high' };

// The same Mr. Mak coordinator, answered by Claude Code on the owner's Claude
// sign-in. Claude gets no built-in tools: only the coordinator tools, which a
// small MCP bridge forwards back to this service with a per-process secret.
export class ClaudeCoordinator extends Coordinator {
  constructor(options) {
    super(options);
    this.provider = 'claude'; this.toolSecret = secret(); this.toolUrl = options.toolUrl;
  }
  send() { throw new Error('Claude coordinator has no JSON-RPC channel'); }
  async startInternal() {
    this.setState('connecting');
    const command = claudeBinary();
    const mcp = { mcpServers: { [SERVER]: { type: 'stdio', command: process.execPath, args: [bridge], env: { MRMAK_COORDINATOR_URL: this.toolUrl(), MRMAK_COORDINATOR_SECRET: this.toolSecret } } } };
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--system-prompt', coordinatorInstructions + '\n\n' + await this.orientation(),
      '--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp),
      '--allowedTools', coordinatorTools.map(item => `mcp__${SERVER}__${item.name}`).join(','),
      '--setting-sources', '', '--no-session-persistence',
      ...(this.model ? ['--model', this.model] : []),
      ...(EFFORTS[this.settings().coordinatorEffort] ? ['--effort', EFFORTS[this.settings().coordinatorEffort]] : []),
    ];
    const child = spawn(command.file, [...command.args, ...args], { cwd: this.repo, env: childEnvironment(this.repo), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    child.stderr.on('data', () => {}); // Diagnostics may contain local account context.
    createInterface({ input: child.stdout }).on('line', line => { try { this.message(JSON.parse(line)); } catch { /* Not a stream record. */ } });
    const disconnected = error => {
      if (this.child !== child) return;
      this.child = null; this.threadId = null; this.setState('offline');
      this.active?.reject(error); this.active = null;
    };
    child.once('error', disconnected);
    child.once('exit', () => disconnected(new Error('Claude coordinator closed. Your terminal chats are still running.')));
    this.threadId = 'claude';
    this.setState('idle');
  }
  message(record) {
    if (!this.active) return;
    if (record.type === 'assistant') for (const part of record.message?.content || []) if (part.type === 'text') this.active.text = part.text;
    if (record.type === 'result') {
      if (record.is_error || record.subtype !== 'success') this.active.reject(new Error(record.result || 'The Claude coordinator could not finish this request.'));
      else this.active.resolve(record.result || this.active.text || 'Done.');
    }
  }
  async turn(prompt, images, operationId) {
    const content = [{ type: 'text', text: prompt }];
    for (const file of images) {
      const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
      if (type) content.push({ type: 'image', source: { type: 'base64', media_type: type, data: (await readFile(file)).toString('base64') } });
    }
    const completion = new Promise((resolve, reject) => { this.active = { resolve, reject, text: '', calls: new Map(), operationId }; });
    const timer = setTimeout(() => this.active?.reject(new Error(TIMEOUT)), TURN_MS);
    try {
      this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
      return await completion;
    } catch (error) {
      // A stream turn cannot be interrupted; a fresh process starts with the next request.
      completion.catch(() => {}); this.close();
      throw error;
    } finally { clearTimeout(timer); this.active = null; }
  }
  // A tool call from the MCP bridge. Only the running request may act.
  async callTool(key, name, args) {
    if (!equalSecret(key, this.toolSecret)) throw Object.assign(new Error('Not allowed'), { status: 403 });
    if (!this.active || !coordinatorTools.some(item => item.name === name)) return { success: false, text: 'No active authorized request or unknown tool.' };
    try { return { success: true, text: JSON.stringify(await this.execute(name, args || {}, this.active.operationId)) }; }
    catch (error) { return { success: false, text: publicError(error) }; }
  }
  close() { const child = this.child; this.child = null; this.threadId = null; child?.kill(); if (child) this.setState('offline'); }
}
