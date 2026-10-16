import { cp, mkdir, readFile, writeFile, access, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(repo, '.cache', 'desktop-runtime');
if (!['win32', 'linux', 'darwin'].includes(process.platform)) throw new Error(`Unsupported desktop platform: ${process.platform}`);
// macOS only: the libraries a Mach-O binary links (null when otool fails) and its minimum macOS.
function linkedLibraries(binary) {
  const result = spawnSync('otool', ['-L', binary], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').slice(1).map(line => line.trim().replace(/ \(compatibility version .*$/, '')).filter(Boolean);
}
const systemLibrary = file => file.startsWith('/usr/lib/') || file.startsWith('/System/Library/');
function minimumMacos(binary) {
  const commands = spawnSync('otool', ['-l', binary], { encoding: 'utf8' }).stdout || '';
  return commands.match(/cmd LC_BUILD_VERSION\n(?:.*\n){0,2}?\s*minos (\S+)/)?.[1]
    || commands.match(/cmd LC_VERSION_MIN_MACOSX\n(?:.*\n){0,1}?\s*version (\S+)/)?.[1] || null;
}
const newerMacos = (a, b) => {
  const [x, y] = [a, b].map(version => String(version).split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const declaredMacos = async () => JSON.parse(await readFile(path.join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8')).bundle.macOS.minimumSystemVersion;
// setup.sh asks before `tauri build` whether the bundled Node needs a newer macOS than
// tauri.conf.json declares (official Node 23+ needs 13.5), so Info.plist can say so.
if (process.argv.includes('--macos-minimum')) {
  const minos = process.platform === 'darwin' ? minimumMacos(await portableNode()) : null;
  if (minos && newerMacos(minos, await declaredMacos())) console.log(minos);
  process.exit(0);
}
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
// Homebrew's node is a small launcher linked to libnode.dylib, and Homebrew/MacPorts
// builds link versioned dylibs under /opt; neither can run from the app bundle. On
// macOS, unless every linked library is part of macOS, bundle the official
// self-contained build of the same version instead (checksum-verified, cached
// under .cache/node-download).
async function portableNode() {
  if (process.platform !== 'darwin') return process.execPath;
  const linked = linkedLibraries(process.execPath);
  if (linked?.length && linked.every(systemLibrary)) return process.execPath;
  const name = `node-${process.version}-darwin-${process.arch}`;
  const cache = path.join(repo, '.cache', 'node-download');
  const binary = path.join(cache, name, 'bin', 'node');
  if (await access(binary).then(() => true, () => false)) return binary;
  const base = `https://nodejs.org/dist/${process.version}`;
  console.warn(`[mak] ${process.execPath} is not self-contained (links ${linked?.find(file => !systemLibrary(file)) || 'unknown libraries'}); downloading ${name} from nodejs.org`);
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find(line => line.endsWith(`  ${name}.tar.gz`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`nodejs.org lists no ${name}.tar.gz`);
  const response = await fetch(`${base}/${name}.tar.gz`);
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const { createHash } = await import('node:crypto');
  if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error(`Checksum mismatch for ${name}.tar.gz`);
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, `${name}.tar.gz`), archive);
  const extracted = spawnSync('tar', ['-xzf', path.join(cache, `${name}.tar.gz`), '-C', cache, `${name}/bin/node`], { stdio: 'inherit' });
  if (extracted.status !== 0) throw new Error(`Could not extract ${name}`);
  await rm(path.join(cache, `${name}.tar.gz`));
  return binary;
}
const bundledNode = path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node');
await cp(await portableNode(), bundledNode);
// Package-manager installs can be read-only; the bundler must be able to replace the copy on the next build.
if (process.platform !== 'win32') { const { chmod } = await import('node:fs/promises'); await chmod(bundledNode, 0o755); }
if (process.platform === 'darwin') {
  const foreign = (linkedLibraries(bundledNode) || ['(otool failed; install the Xcode Command Line Tools)']).filter(file => !systemLibrary(file));
  if (foreign.length) throw new Error(`The bundled Node links libraries outside macOS: ${foreign.join(', ')}`);
  // MRMAK_MACOS_MINIMUM is set by setup.sh when it raises minimumSystemVersion with --config.
  const minos = minimumMacos(bundledNode), declared = process.env.MRMAK_MACOS_MINIMUM || await declaredMacos();
  if (minos && newerMacos(minos, declared)) {
    console.warn(`\n[mak] WARNING: the bundled Node ${process.version} requires macOS ${minos}, but the app declares macOS ${declared}.`);
    console.warn(`[mak] On older macOS versions the app opens but its service cannot start. Build with Node 22, or use ./setup.sh desktop, which raises the declared minimum.\n`);
  }
}
await mkdir(path.join(runtime, 'service'), { recursive: true });
const serviceSource = path.join(repo, 'desktop', 'service');
await cp(serviceSource, path.join(runtime, 'service'), { recursive: true, filter: source => !path.relative(serviceSource, source).split(path.sep).some(part => ['node_modules', 'test', '.cache'].includes(part)) });
// A checkout can itself live under a cache/worktree directory. Validate the
// payload before npm can resolve an unrelated parent package.json.
for (const file of ['package.json', 'package-lock.json', 'main.mjs', 'server.mjs']) await access(path.join(runtime, 'service', file));
run(['ci', '--omit=dev'], path.join(runtime, 'service'));
// npm can unpack node-pty's macOS spawn-helper without the execute bit; terminals then fail with posix_spawnp.
if (process.platform === 'darwin') {
  const { chmod, readdir } = await import('node:fs/promises');
  const prebuilds = path.join(runtime, 'service', 'node_modules', 'node-pty', 'prebuilds');
  for (const dir of (await readdir(prebuilds).catch(() => [])).filter(name => name.startsWith('darwin-'))) {
    await chmod(path.join(prebuilds, dir, 'spawn-helper'), 0o755).catch(() => {});
  }
}
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
