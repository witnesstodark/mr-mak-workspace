import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, realpath, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { expandHome, realFile, secret, within } from './util.mjs';
import { isMacOS } from './platform.mjs';
import { serveReport } from './report-chrome.mjs';

const mime = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.m4v': 'video/mp4', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
// WebKit on macOS plays QuickTime screen recordings and shows iPhone photos.
// WebView2 and WebKitGTK may not, so they keep the "Open in its application" card.
if (isMacOS) Object.assign(mime, { '.mov': 'video/quicktime', '.heic': 'image/heic', '.heif': 'image/heif' });
const textExtensions = new Set(['.txt', '.md', '.json', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.py', '.rs', '.toml', '.yaml', '.yml', '.csv', '.log', '.xml', '.ini', '.ps1', '.cmd', '.sh', '.gitignore']);
const secretPart = value => value.startsWith('.') || /^(node_modules|target|oauth_.*\.json|.*_secret.*\.json|tokens?\.json|auth\.json)$/i.test(value);

export async function serveFile(request, response, file, info, headers = {}) {
  const contentType = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const common = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...headers };
  let start = 0, end = info.size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2]) || info.size === 0) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    if (!match[1]) { start = Math.max(0, info.size - Number(match[2])); }
    else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    status = 206; common['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  response.writeHead(status, { ...common, 'Content-Length': Math.max(0, end - start + 1) });
  if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

export class Files {
  constructor(repo) { this.repo = repo; this.grants = new Map(); this.repoGrant = this.grant(repo); this.writes = Promise.resolve(); }
  grant(root) {
    for (const [token, value] of this.grants) if (value === root) return token;
    const token = secret(); this.grants.set(token, root); return token;
  }
  url(file) {
    const absolute = path.resolve(file);
    const relative = path.relative(this.repo, absolute);
    const root = within(this.repo, absolute) && !relative.split(/[\\/]/).some(secretPart) ? this.repo : path.dirname(absolute);
    return `${this.origin}/view/${this.grant(root)}/${path.relative(root, absolute).split(path.sep).map(encodeURIComponent).join('/')}`;
  }
  async list(folder = this.repo, mode = 'main', query = '') {
    const actual = await realpath(path.resolve(expandHome(folder)));
    const entries = await readdir(actual, { withFileTypes: true });
    const atRoot = actual.toLowerCase() === this.repo.toLowerCase();
    const filtered = entries.filter(entry => (!atRoot || mode === 'all' || ['inbox', 'projects', 'workspace', 'knowledge', 'processes', 'context'].includes(entry.name)) && (!query || entry.name.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())));
    const result = await Promise.all(filtered.slice(0, 1500).map(async entry => {
      const full = path.join(actual, entry.name);
      const info = await stat(full).catch(() => null);
      return { name: entry.name, path: full, directory: info?.isDirectory() || entry.isDirectory(), size: info?.size || 0, modifiedAt: info?.mtime.toISOString() || null };
    }));
    if (atRoot && mode !== 'all') {
      for (const [name, relative] of [['Claude skills', '.claude/skills'], ['Codex skills', '.agents/skills']]) {
        const full = path.join(this.repo, relative), info = await stat(full).catch(() => null);
        if (info?.isDirectory()) result.push({ name, path: full, directory: true, size: 0, modifiedAt: info.mtime.toISOString() });
      }
    }
    result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { path: actual, parent: path.dirname(actual), entries: result, truncated: filtered.length > 1500, mode };
  }
  async preview(file) {
    const actual = await realpath(path.resolve(expandHome(file)));
    const info = await stat(actual);
    if (!info.isFile()) throw new Error('Choose a file to preview');
    const ext = path.extname(actual).toLowerCase();
    const base = { path: actual, name: path.basename(actual), size: info.size };
    if (['.html', '.htm', '.pdf'].includes(ext)) return { ...base, kind: 'document', url: this.url(actual) };
    if (/^image\//.test(mime[ext] || '')) return { ...base, kind: 'image', url: this.url(actual) };
    if (/^(video|audio)\//.test(mime[ext] || '')) return { ...base, kind: mime[ext].split('/')[0], url: this.url(actual) };
    if (textExtensions.has(ext) || info.size === 0 || path.basename(actual).startsWith('.env')) {
      if (info.size > 2 * 1024 * 1024) return { ...base, kind: 'unsupported', reason: 'This text file is larger than the 2 MB preview limit.' };
      const bytes = await readFile(actual);
      return { ...base, kind: 'text', text: bytes.toString('utf8'), ...(ext === '.md' ? { revision: createHash('sha256').update(bytes).digest('hex'), url: this.url(actual) } : {}) };
    }
    return { ...base, kind: 'unsupported', reason: 'Open this file in its desktop application.' };
  }
  async saveMarkdown({ path: requested, text, revision }) {
    if (typeof requested !== 'string' || path.extname(requested).toLowerCase() !== '.md' || typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(revision || '')) throw new Error('Choose a Markdown file of up to 2 MB with a current revision.');
    const operation = this.writes.catch(() => {}).then(async () => {
      const actual = await realpath(path.resolve(requested));
      if (path.extname(actual).toLowerCase() !== '.md') throw new Error('Only Markdown files can be edited.');
      const original = await readFile(actual);
      if (createHash('sha256').update(original).digest('hex') !== revision) throw Object.assign(new Error('This file changed on disk. Your draft is kept. Reopen the file to compare before saving.'), { status: 409 });
      const backupFolder = path.join(this.repo, '.mrmak', 'markdown-backups');
      await mkdir(backupFolder, { recursive: true });
      const id = `${Date.now()}-${randomUUID()}`;
      await writeFile(path.join(backupFolder, `${id}.md`), original, { flag: 'wx' });
      await writeFile(path.join(backupFolder, `${id}.json`), JSON.stringify({ path: actual, revision, savedAt: new Date().toISOString() }), { flag: 'wx' });
      const temp = path.join(path.dirname(actual), `.${path.basename(actual)}.${id}.tmp`);
      try {
        await writeFile(temp, text, { flag: 'wx' });
        if (createHash('sha256').update(await readFile(actual)).digest('hex') !== revision) throw Object.assign(new Error('This file changed while saving. Your draft is kept; reopen the file to compare.'), { status: 409 });
        await rename(temp, actual);
      } finally { await unlink(temp).catch(() => {}); }
      return this.preview(actual);
    });
    this.writes = operation;
    return operation;
  }
  async content(request, response, url) {
    const match = /^\/view\/([\w-]+)\/(.*)$/.exec(url.pathname);
    if (!match || !this.grants.has(match[1])) throw Object.assign(new Error('Preview not found'), { status: 404 });
    const relative = decodeURIComponent(match[2]);
    if (relative.split(/[\\/]/).some(secretPart)) throw Object.assign(new Error('Private application files cannot be loaded by reports'), { status: 403 });
    const { file, info } = await realFile(this.grants.get(match[1]), relative);
    if (!info.isFile()) throw Object.assign(new Error('File not found'), { status: 404 });
    const serve = /\.html?$/i.test(file) ? serveReport : serveFile;
    await serve(request, response, file, info, { 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': this.uiOrigin, 'Cross-Origin-Resource-Policy': 'cross-origin' });
  }
}
