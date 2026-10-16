// Runs a Python 3 script with whichever interpreter this machine has:
// stock macOS and many Linux distributions ship only `python3`, while python.org
// installs on Windows often have only `python` or the `py` launcher (and
// `python3` may be the Microsoft Store alias stub).
// Usage: node scripts/run-python.mjs <script.py> [args...]
import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []], ['python3', []]]
  : [['python3', []], ['python', []]];
const found = candidates.find(([command, prefix]) => {
  const probe = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8', windowsHide: true });
  return probe.status === 0 && /^Python 3\./.test(`${probe.stdout}${probe.stderr}`.trim());
});
if (!found) {
  console.error(`Python 3 not found. Tried: ${candidates.map(([command, prefix]) => [command, ...prefix].join(' ')).join(', ')}.`);
  process.exit(1);
}
const [command, prefix] = found;
const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
