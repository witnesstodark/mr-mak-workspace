import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { readJson, realFile, secret, within } from './util.mjs';
import { serveFile } from './files.mjs';

const extensions = new Set(['.html', '.htm', '.md', '.txt', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.pdf', '.woff', '.woff2', '.ttf', '.glb', '.gltf', '.bin', '.wasm']);
const safePath = value => typeof value === 'string' && value.length < 1200 && !/[\x00-\x1f\x7f:?#]/.test(value) && !value.split(/[\\/]/).some(part => !part || part.startsWith('.') || /^(node_modules|auth\.json|tokens?\.json)$/i.test(part)) && !path.isAbsolute(value);
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };
const sourceId = value => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);

async function reportFile(root, relative) {
  if (!safePath(relative)) fail('Invalid report path');
  if (path.relative(root, await realpath(root)) !== '') fail('The selected report folder changed. Reopen it after checking its configuration.');
  const result = await realFile(root, relative);
  // A public-looking link must not expose a private or disallowed target.
  if (!safePath(path.relative(root, result.file)) || !extensions.has(path.extname(result.file).toLowerCase())) fail('This file is unavailable in report previews.');
  return result;
}

export class MobileReports {
  constructor(gateway) { this.gateway = gateway; this.grants = new Map(); }
  async registry() { return (await readJson(path.join(this.gateway.repo, 'workspace/workspace.json'), { entities: [] })).entities || []; }
  async list() {
    return (await this.registry()).filter(item => item.status !== 'archived' && (safePath(item.folder) || item.steps?.some(step => sourceId(step.source)))).map(item => ({ id: item.id, title: item.title, category: item.category, updated: item.updated || item.created, steps: (item.steps || []).map((step, index) => ({ name: step.name, index })) })).filter(item => item.steps.length).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  async open(device, { entityId, step = 0 }) {
    const entity = (await this.registry()).find(item => item.id === entityId);
    const selected = entity?.steps?.[step];
    if (!selected || !Number.isInteger(step) || !safePath(selected.path)) fail('This report is unavailable on mobile.', 404);
    let root, prefix, resources;
    if (selected.source !== undefined) {
      if (!sourceId(selected.source) || !this.gateway.liveSources) fail('This live source is not configured.', 404);
      ({ root, resources } = await this.gateway.liveSources.reportRoot(selected.source));
      prefix = `live/${selected.source}/`;
    } else {
      if (!safePath(entity.folder)) fail('This report is unavailable on mobile.', 404);
      root = await realpath(path.join(this.gateway.repo, 'workspace', entity.folder));
      if (!within(await realpath(this.gateway.repo), root)) fail('This report folder is outside the Workspace repository.');
      prefix = `workspace/${entity.folder.replaceAll('\\', '/')}/`;
    }
    const relative = selected.path;
    let file, info;
    try { ({ file, info } = await reportFile(root, relative)); }
    catch (error) {
      if (error.code === 'ENOENT') fail(selected.source !== undefined ? 'This live reader has not produced this page yet. Reopen it when its build finishes.' : 'Report not found.', selected.source !== undefined ? 503 : 404);
      throw error;
    }
    if (!info.isFile()) fail('Report not found', 404);
    const extension = path.extname(file).toLowerCase();
    if (!['.html', '.htm', '.md', '.txt'].includes(extension)) fail('Open this type of report on your computer.');
    const token = secret();
    for (const [id, grant] of this.grants) if (grant.expires < Date.now() || !this.gateway.state.devices.some(item => item.id === grant.deviceId)) this.grants.delete(id);
    if (this.grants.size >= 100) this.grants.delete(this.grants.keys().next().value);
    this.grants.set(token, { root, prefix, source: selected.source, resources, deviceId: device.id, expires: Date.now() + 30 * 60 * 1000 });
    const url = `/mobile/view/${token}/${prefix}${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
    return { title: entity.title, step: entity.steps[step].name, kind: extension === '.md' || extension === '.txt' ? 'markdown' : 'html', url, ...(extension === '.md' || extension === '.txt' ? { text: (await readFile(file, 'utf8')).slice(0, 2 * 1024 * 1024) } : {}) };
  }
  async serve(request, response, url) {
    const gateway = this.gateway;
    if (!gateway.active || !['GET', 'HEAD'].includes(request.method) || request.headers.host !== new URL(gateway.origin).host) fail('Not allowed');
    const match = /^\/mobile\/view\/([a-zA-Z0-9_-]+)\/(.+)$/.exec(url.pathname), grant = match && this.grants.get(match[1]);
    if (!grant || grant.expires < Date.now() || !gateway.state.devices.some(device => device.id === grant.deviceId && device.expires > Date.now())) fail('Reopen this report to refresh its preview.', 401);
    const relative = decodeURIComponent(match[2]).replaceAll('\\', '/');
    if (!safePath(relative)) fail('Invalid report path');
    let root, filePath;
    if (grant.source !== undefined) {
      const configured = await gateway.liveSources.reportRoot(grant.source);
      if (path.relative(grant.root, configured.root) !== '') fail('The selected report folder changed.');
    }
    if (relative.startsWith(grant.prefix)) { root = grant.root; filePath = relative.slice(grant.prefix.length); }
    else if (/^workspace\/_shared\/(report\.(css|js)|examples\.css)$/.test(relative)) {
      root = await realpath(path.join(gateway.repo, 'workspace/_shared'));
      if (!within(await realpath(gateway.repo), root)) fail('Shared report assets are outside the Workspace repository.');
      filePath = relative.slice('workspace/_shared/'.length);
    }
    else fail('This file is outside the selected report.');
    if (!extensions.has(path.extname(filePath).toLowerCase())) fail('This file type is unavailable in report previews.');
    const { file, info } = await reportFile(root, filePath);
    if (!info.isFile()) fail('File not found', 404);
    const base = `${gateway.origin}/mobile/view/${match[1]}/`;
    const scripts = (grant.resources?.scripts || []).join(' '), styles = (grant.resources?.styles || []).join(' '), fonts = (grant.resources?.fonts || []).join(' ');
    // A report is an opaque sandbox with access only to this short-lived folder grant.
    // It has no same-origin privileges, desktop token, device cookie or mobile API access.
    await serveFile(request, response, file, info, {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*',
      ...(url.searchParams.get('download') === '1' ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` } : {}),
      'Content-Security-Policy': `sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline' ${base} ${scripts}; style-src 'unsafe-inline' ${base} ${styles}; img-src data: blob: ${base}; media-src blob: ${base}; font-src data: ${base} ${fonts}; connect-src ${base}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${gateway.origin}`,
    });
  }
}
