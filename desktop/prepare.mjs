import { cp, mkdir, readFile, writeFile, access, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(repo, '.cache', 'desktop-runtime');
if (!['win32', 'linux', 'darwin'].includes(process.platform)) throw new Error(`Unsupported desktop platform: ${process.platform}`);
// Clear only this generated staging directory, after verifying its resolved path.
const actualRuntime = await realpath(runtime).catch(() => null);
if (actualRuntime) {
  const expected = path.join(await realpath(repo), '.cache', 'desktop-runtime');
  if (actualRuntime.toLowerCase() !== expected.toLowerCase()) throw new Error('Refusing to clear a staging directory outside this repository');
  await rm(actualRuntime, { recursive: true });
}
await mkdir(runtime, { recursive: true });
// npm may be installed separately from Node (system packages and nvm do this),
// and npm_execpath can point at an old Node installation after switching
// versions. Prefer a valid npm_execpath, then resolve the active npm command.
const configuredNpm = process.env.npm_execpath;
const npmScript = configuredNpm && await access(configuredNpm).then(() => configuredNpm).catch(() => null);
const npmCommand = npmScript || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const run = (args, cwd) => {
  const command = npmScript ? process.execPath : npmCommand;
  const commandArgs = npmScript ? [npmScript, ...args] : args;
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`npm ${args.join(' ')} failed: ${result.error?.message || `exit ${result.status}`}`);
};
run(['run', 'build'], repo);
await cp(process.execPath, path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'));
await mkdir(path.join(runtime, 'service'), { recursive: true });
const serviceSource = path.join(repo, 'desktop', 'service');
await cp(serviceSource, path.join(runtime, 'service'), { recursive: true, filter: source => !path.relative(serviceSource, source).split(path.sep).some(part => ['node_modules', 'test', '.cache'].includes(part)) });
// A checkout can itself live under a cache/worktree directory. Validate the
// payload before npm can resolve an unrelated parent package.json.
for (const file of ['package.json', 'package-lock.json', 'main.mjs', 'server.mjs']) await access(path.join(runtime, 'service', file));
run(['ci', '--omit=dev'], path.join(runtime, 'service'));
await cp(path.join(repo, 'dist'), path.join(runtime, 'ui'), { recursive: true });
// Vite deliberately does not copy the enormous workspace junction. Bundle only UI assets.
try { await access(path.join(repo, 'public', 'assets')); await cp(path.join(repo, 'public', 'assets'), path.join(runtime, 'ui', 'assets'), { recursive: true }); } catch { /* Optional brand assets. */ }
await writeFile(path.join(runtime, 'README.txt'), `Mr. Mak local runtime for ${process.platform}. User repositories, keys and CLI logins are not included.\n`);
const licenseCandidates = [
  path.join(path.dirname(process.execPath), 'LICENSE'),
  path.join(path.dirname(path.dirname(process.execPath)), 'LICENSE'),
  '/usr/share/licenses/nodejs-libs/LICENSE',
];
let license;
for (const nodeLicense of licenseCandidates) {
  try { license = await readFile(nodeLicense); break; } catch { /* Try the next installation layout. */ }
}
if (!license) {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!response.ok) throw new Error('Could not retrieve the license for the bundled Node runtime');
  license = await response.text();
}
await writeFile(path.join(runtime, 'NODE-LICENSE.txt'), license);
console.log('Desktop runtime prepared: Node, native terminals and production UI.');
