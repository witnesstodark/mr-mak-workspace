import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { readJson, realFile, secret, within } from './util.mjs';
import { serveReport } from './report-chrome.mjs';
import { serveFile } from './files.mjs';
import { validateCard, CARD_MAX_BYTES } from './card-schema.mjs';

const extensions = new Set(['.html', '.htm', '.md', '.txt', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.pdf', '.woff', '.woff2', '.ttf', '.glb', '.gltf', '.bin', '.wasm']);
const safePath = value => typeof value === 'string' && value.length < 1200 && !value.split(/[\\/]/).some(part => !part || part.startsWith('.') || /^(node_modules|auth\.json|tokens?\.json)$/i.test(part)) && !path.isAbsolute(value) && !value.includes(':');
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };

export class MobileReports {
  constructor(gateway) { this.gateway = gateway; this.grants = new Map(); }
  async registry() { return (await readJson(path.join(this.gateway.repo, 'workspace/workspace.json'), { entities: [] })).entities || []; }
  async list() {
    return (await this.registry()).filter(item => item.status !== 'archived' && safePath(item.folder)).map(item => ({ id: item.id, title: item.title, category: item.category, updated: item.updated || item.created, steps: (item.steps || []).map((step, index) => ({ name: step.name, index })) })).filter(item => item.steps.length).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
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
    const prefix = `workspace/${entity.folder.replaceAll('\\', '/')}/`;
    for (const [id, grant] of this.grants) if (grant.expires < Date.now() || !this.gateway.state.devices.some(item => item.id === grant.deviceId)) this.grants.delete(id);
    const existing = [...this.grants].find(([, grant]) => grant.deviceId === device.id && grant.root === root && grant.prefix === prefix);
    const token = existing?.[0] || secret();
    if (!existing && this.grants.size >= 100) this.grants.delete(this.grants.keys().next().value);
    this.grants.set(token, { root, prefix, deviceId: device.id, expires: Date.now() + 30 * 60 * 1000 });
    const url = `/mobile/view/${token}/${prefix}${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
    if (card) return { statePersistence: false, title: entity.title, step: entity.steps[step].name, kind: 'card', url, document };
    return { statePersistence: true, title: entity.title, step: entity.steps[step].name, kind: extension === '.md' || extension === '.txt' ? 'markdown' : 'html', url, ...(extension === '.md' || extension === '.txt' ? { text: (await readFile(file, 'utf8')).slice(0, 2 * 1024 * 1024) } : {}) };
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
    else if (/^workspace\/_shared\/(report\.(css|js)|examples\.css)$/.test(relative)) { root = path.join(gateway.repo, 'workspace/_shared'); filePath = relative.slice('workspace/_shared/'.length); }
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
