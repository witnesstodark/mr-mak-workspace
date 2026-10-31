import { spawn } from 'node:child_process';
import { childEnvironment, claudeBinary } from './agents.mjs';

// One Claude Code call without tools, on the owner's sign-in; the prompt goes on stdin.
export function askClaude(prompt, { model = 'sonnet', effort, timeout = 240000 } = {}) {
  return new Promise((resolve, reject) => {
    const command = claudeBinary();
    const child = spawn(command.file, [...command.args, '-p', '--model', model, ...(effort ? ['--effort', effort] : []), '--output-format', 'json', '--tools', '', '--setting-sources', '', '--no-session-persistence'], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude Code took too long to answer.')); }, timeout);
    child.stdout.on('data', chunk => { out += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => {
      clearTimeout(timer);
      try { const value = JSON.parse(out); if (value.is_error) throw new Error(value.result || 'Claude Code could not answer.'); resolve(String(value.result || '')); }
      catch (error) { reject(error instanceof SyntaxError ? new Error('Claude Code gave no answer. Check that it is installed and signed in.') : error); }
    });
    child.stdin.end(prompt);
  });
}
