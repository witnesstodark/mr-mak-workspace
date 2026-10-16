import { readFile, writeFile, rename, mkdir, realpath, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const secret = () => randomBytes(32).toString('base64url');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
export async function saveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
// Typed folders such as `~/Projects` mean the home folder, not a `~` folder
// under the service's working directory. `~user` and inner `~` stay literal.
export const expandHome = value => typeof value === 'string' && (process.platform === 'win32' ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/).test(value) ? path.join(os.homedir(), value.slice(1)) : value;
export const within = (root, file) => {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};
export async function realFile(root, relative = '') {
  const file = path.resolve(root, relative);
  if (!within(root, file)) throw Object.assign(new Error('Path is outside this location'), { status: 403 });
  const actual = await realpath(file);
  // A configured folder may itself be a junction. Resolve that root as well.
  if (!within(await realpath(root), actual)) throw Object.assign(new Error('Link leaves this location'), { status: 403 });
  return { file: actual, info: await stat(actual) };
}
export function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
export async function body(request, limit = 256 * 1024) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('Request is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
export function publicError(error) {
  // Errors from HTTP providers must never include request headers or environment values.
  return String(error?.message || 'Unexpected error').slice(0, 1500);
}
