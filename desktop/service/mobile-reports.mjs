import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readJson, realFile, secret, within } from './util.mjs';
import { serveReport } from './report-chrome.mjs';
import { serveFile } from './files.mjs';
import { cardPhase, cardProgress } from './workspace.mjs';
import { validateCard, CARD_MAX_BYTES } from './card-schema.mjs';

const extensions = new Set(['.html', '.htm', '.md', '.txt', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.pdf', '.woff', '.woff2', '.ttf', '.glb', '.gltf', '.bin', '.wasm']);
const coverTypes = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const safePath = value => typeof value === 'string' && value.length < 1200 && !value.split(/[\\/]/).some(part => !part || part.startsWith('.') || /^(node_modules|auth\.json|tokens?\.json)$/i.test(part)) && !path.isAbsolute(value) && !value.includes(':');
const cardPrefix = entity => `workspace/${entity.folder.replaceAll('\\', '/')}/`;
// How the phone shows a linked file: a page in the report frame, text as Markdown,
// media and anything else in the browser.
const fileView = (file, url, text) => {
  const extension = path.extname(file).toLowerCase();
  const kind = ['.html', '.htm'].includes(extension) ? 'html' : text !== undefined ? 'markdown' : coverTypes.has(extension) || extension === '.svg' ? 'image' : ['.mp4', '.webm'].includes(extension) ? 'video' : 'other';
  return { name: path.basename(file), url, kind, ...(text !== undefined ? { text } : {}) };
};
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };

export class MobileReports {
  constructor(gateway) { this.gateway = gateway; this.grants = new Map(); }
  async registry() { return (await readJson(path.join(this.gateway.repo, 'workspace/workspace.json'), { entities: [] })).entities || []; }
  // The cover is an image inside the card's own folder; anything else is treated as no cover.
  async coverFile(entity) {
    const raster = value => coverTypes.has(path.extname(value).toLowerCase());
    if (!safePath(entity.folder) || !safePath(entity.cover) || !raster(entity.cover)) return null;
    try {
      const root = await realpath(path.join(this.gateway.repo, 'workspace', entity.folder));
      if (!within(await realpath(this.gateway.repo), root)) return null;
      const { file, info } = await realFile(root, entity.cover);
      return info.isFile() && info.size <= 8 * 1024 * 1024 && raster(file) ? { file, info } : null;
    } catch { return null; }
  }
  async list() {
    const cards = await Promise.all((await this.registry()).filter(item => item.status !== 'archived' && safePath(item.folder)).map(async item => {
      const steps = (item.steps || []).map((step, index) => ({ name: step.name, index }));
      const cover = steps.length ? await this.coverFile(item) : null, progress = cardProgress(item.progress), phase = cardPhase(item.phase);
      return { id: item.id, title: item.title, category: item.category, updated: item.updated || item.created, steps, ...(cover ? { cover: `/mobile/api/reports/${encodeURIComponent(item.id)}/cover?v=${Math.floor(cover.info.mtimeMs)}` } : {}), ...(progress ? { progress } : {}), ...(phase ? { phase } : {}) };
    }));
    return cards.filter(item => item.steps.length).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  async serveCover(request, response, encodedId) {
    let id; try { id = decodeURIComponent(encodedId); } catch { fail('Cover not found', 404); }
    const entity = (await this.registry()).find(item => item.id === id && item.status !== 'archived'), cover = entity && await this.coverFile(entity);
    if (!cover) fail('Cover not found', 404);
    await serveFile(request, response, cover.file, cover.info, { 'Cache-Control': 'private, max-age=300' });
  }
  async open(device, { entityId, step = 0 }) {
    const entity = (await this.registry()).find(item => item.id === entityId);
    if (!entity || !safePath(entity.folder) || !Number.isInteger(step) || !safePath(entity.steps?.[step]?.path)) fail('This report is unavailable on mobile.', 404);
    const root = await realpath(path.join(this.gateway.repo, 'workspace', entity.folder));
    if (!within(await realpath(this.gateway.repo), root)) fail('This report folder is outside the Workspace repository.');
    const relative = entity.steps[step].path, { file, info } = await realFile(root, relative);
    if (!info.isFile()) fail('Report not found', 404);
    const extension = path.extname(file).toLowerCase();
    const card = entity.steps[step].viewer === 'card' && relative.endsWith('.card.json');
    if (!card && !['.html', '.htm', '.md', '.txt'].includes(extension)) fail('Open this type of report on your computer.');
    if (card && info.size > CARD_MAX_BYTES) fail('This card is too large to preview.', 400);
    const document = card ? validateCard(JSON.parse(await readFile(file, 'utf8'))) : undefined;
    const url = this.viewUrl(device, root, cardPrefix(entity), relative);
    if (card) return { statePersistence: false, title: entity.title, step: entity.steps[step].name, kind: 'card', url, document };
    return { statePersistence: true, title: entity.title, step: entity.steps[step].name, kind: extension === '.md' || extension === '.txt' ? 'markdown' : 'html', url, ...(extension === '.md' || extension === '.txt' ? { text: (await readFile(file, 'utf8')).slice(0, 2 * 1024 * 1024) } : {}) };
  }
  // A short-lived grant on one folder for this phone, and the file's address under it.
  viewUrl(device, root, prefix, relative) {
    for (const [id, grant] of this.grants) if (grant.expires < Date.now() || !this.gateway.state.devices.some(item => item.id === grant.deviceId)) this.grants.delete(id);
    const existing = [...this.grants].find(([, grant]) => grant.deviceId === device.id && grant.root === root && grant.prefix === prefix);
    const token = existing?.[0] || secret();
    if (!existing && this.grants.size >= 100) this.grants.delete(this.grants.keys().next().value);
    this.grants.set(token, { root, prefix, deviceId: device.id, expires: Date.now() + 30 * 60 * 1000 });
    return `/mobile/view/${token}/${prefix}${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
  }
  // A local file linked in a chat, relative to the chat's folder. A Workspace report
  // page opens as that report; another file inside the chat's folder or the Workspace
  // repository opens on its own, with its card's folder (or its own folder) for assets.
  async openLocal(device, session, target) {
    if (typeof target !== 'string' || !target.trim() || target.length > 1200 || /[\x00-\x1f]/.test(target)) fail('Choose a local file.', 400);
    let file;
    try { file = await realpath(path.resolve(session.cwd, target)); } catch { fail('This file is not on your computer anymore.', 404); }
    const info = await stat(file);
    if (!info.isFile()) fail('Open folders on your computer.', 400);
    const repo = await realpath(this.gateway.repo), folder = await realpath(session.cwd).catch(() => null);
    const base = [folder, repo].find(item => item && within(item, file) && safePath(path.relative(item, file)));
    if (!base) fail('This file is outside the chat folder and the Workspace.');
    const extension = path.extname(file).toLowerCase();
    if (!extensions.has(extension)) fail('Open this type of file on your computer.');
    const text = ['.md', '.txt'].includes(extension) && info.size <= 2 * 1024 * 1024 ? await readFile(file, 'utf8') : undefined;
    const workspace = path.join(repo, 'workspace');
    for (const entity of within(workspace, file) ? await this.registry() : []) {
      if (entity.status === 'archived' || !safePath(entity.folder)) continue;
      const root = await realpath(path.join(workspace, entity.folder)).catch(() => null);
      if (!root || !within(root, file)) continue;
      const step = (entity.steps || []).findIndex(item => safePath(item.path) && path.resolve(root, item.path) === file);
      if (step >= 0) return { report: { entityId: entity.id, step } };
      return { file: fileView(file, this.viewUrl(device, root, cardPrefix(entity), path.relative(root, file)), text) };
    }
    return { file: fileView(file, this.viewUrl(device, path.dirname(file), 'files/', path.basename(file)), text) };
  }
  async serve(request, response, url) {
    const gateway = this.gateway;
    if (!gateway.active || !['GET', 'HEAD'].includes(request.method) || request.headers.host !== new URL(gateway.origin).host) fail('Not allowed');
    const match = /^\/mobile\/view\/([a-zA-Z0-9_-]+)\/(.+)$/.exec(url.pathname), grant = match && this.grants.get(match[1]);
    if (!grant || grant.expires < Date.now() || !gateway.state.devices.some(device => device.id === grant.deviceId && gateway.validDevice(device))) fail('Reopen this report to refresh its preview.', 401);
    const relative = decodeURIComponent(match[2]);
    if (!safePath(relative)) fail('Invalid report path');
    let root, filePath;
    if (relative.startsWith(grant.prefix)) { root = grant.root; filePath = relative.slice(grant.prefix.length); }
    else if (relative.startsWith('workspace/_shared/')) { root = path.join(gateway.repo, 'workspace/_shared'); filePath = relative.slice('workspace/_shared/'.length); }
    else fail('This file is outside the selected report.');
    if (!extensions.has(path.extname(filePath).toLowerCase())) fail('This file type is unavailable in report previews.');
    const { file, info } = await realFile(root, filePath);
    if (!info.isFile()) fail('File not found', 404);
    const base = `${gateway.origin}/mobile/view/${match[1]}/`;
    // A report is an opaque sandbox with access only to this short-lived folder grant.
    // It has no same-origin privileges, desktop token, device cookie or mobile API access.
    const html = /\.html?$/i.test(file) && url.searchParams.get('download') !== '1';
    await (html ? serveReport : serveFile)(request, response, file, info, {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*',
      ...(url.searchParams.get('download') === '1' ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` } : {}),
      'Content-Security-Policy': `sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline' ${base}; style-src 'unsafe-inline' ${base}; img-src data: blob: ${base}; media-src blob: ${base}; font-src data: ${base}; connect-src ${base}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${gateway.origin}`,
    }, { parentOrigin: gateway.origin, mobileState: true });
  }
}
