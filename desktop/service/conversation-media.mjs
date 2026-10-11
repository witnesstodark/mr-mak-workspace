import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { secret } from './util.mjs';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_INLINE = 3 * 1024 * 1024;
const types = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (data.subarray(0, 2).toString() === 'BM') return 'image/bmp';
  throw new Error('Image unavailable');
}

// Read only explicit image records and image links; never infer media from arbitrary tool text.
export function imageReferences(content, text = '') {
  const refs = [];
  const add = source => { if (typeof source === 'string' && source.length <= MAX_INLINE * 1.4 && !refs.includes(source) && refs.length < 12) refs.push(source); };
  const visit = (parts, depth = 0) => {
    if (!Array.isArray(parts) || depth > 2) return;
    for (const part of parts) {
      if (['image', 'input_image', 'image_url'].includes(part?.type)) {
        if (part.source?.type === 'base64' && types.has(part.source.media_type)) add(`data:${part.source.media_type};base64,${part.source.data}`);
        else add(part.image_url?.url || part.image_url || part.source?.url || part.url);
      }
      if (part?.type === 'tool_result') visit(part.content, depth + 1);
    }
  };
  visit(content);
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)/g)) {
    const source = match[1].replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']$/, '');
    if (/\.(png|jpe?g|webp|gif|bmp)(?:[?#].*)?$/i.test(source) || source.startsWith('data:image/')) add(source);
  }
  return refs;
}

export class ConversationMedia {
  grants = new Map();
  prune() {
    for (const [token, grant] of this.grants) if (grant.expires < Date.now()) this.grants.delete(token);
    let inlineBytes = [...this.grants.values()].reduce((sum, grant) => sum + (grant.inline?.length || 0), 0);
    while (this.grants.size > 256 || inlineBytes > 16 * 1024 * 1024) { const oldest = this.grants.keys().next().value; inlineBytes -= this.grants.get(oldest).inline?.length || 0; this.grants.delete(oldest); }
  }
  revoke(deviceId) { for (const [token, grant] of this.grants) if (grant.deviceId === deviceId) this.grants.delete(token); }
  async source(reference, cwd) {
    if (reference.startsWith('data:')) {
      const match = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([A-Za-z0-9+/=]+)$/.exec(reference);
      if (!match || match[2].length > MAX_INLINE * 1.4) throw new Error('Image unavailable');
      const data = Buffer.from(match[2], 'base64');
      if (!data.length || data.length > MAX_INLINE || imageType(data) !== match[1]) throw new Error('Image unavailable');
      return { inline: reference, type: match[1], name: 'Shared image' };
    }
    // Network and file:// URLs are not fetched. Only exact paths recorded in this chat can be granted.
    let file = decodeURIComponent(reference);
    if (/^[a-z][a-z\d+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file) || file.startsWith('//') || file.startsWith('\\\\') || /[\x00-\x1f]/.test(file)) throw new Error('Image unavailable');
    if (!path.isAbsolute(file) && !cwd) throw new Error('Image unavailable');
    file = path.resolve(cwd || '.', file);
    const actual = await realpath(file);
    const handle = await open(actual, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) throw new Error('Image unavailable');
      const head = Buffer.alloc(16); await handle.read(head, 0, 16, 0);
      return { file: actual, type: imageType(head), name: path.basename(actual) };
    } finally { await handle.close(); }
  }
  async present(value, session, deviceId) {
    this.prune();
    const messages = [];
    for (const message of value.messages) {
      const { imageRefs = [], ...clean } = message;
      const images = [];
      for (const reference of imageRefs.slice(0, 12)) {
        try {
          const key = createHash('sha256').update(`${deviceId}:${session.id}:${reference}`).digest('hex');
          let existing = [...this.grants].find(([, grant]) => grant.key === key);
          if (!existing) {
            const source = await this.source(reference, session.cwd);
            const token = secret(); this.grants.set(token, { ...source, key, sessionId: session.id, deviceId, expires: Date.now() + 10 * 60 * 1000 });
            existing = [token, this.grants.get(token)];
          }
          const [token, grant] = existing; grant.expires = Date.now() + 10 * 60 * 1000;
          const url = `/mobile/api/sessions/${session.id}/media/${token}`;
          images.push({ url, name: grant.name });
        } catch { images.push({ unavailable: true, name: 'Image unavailable' }); }
      }
      messages.push({ ...clean, ...(images.length ? { images } : {}) });
    }
    this.prune();
    return { ...value, messages };
  }
  async serve(request, response, sessionId, token, deviceId, download) {
    this.prune();
    const grant = this.grants.get(token);
    if (!grant || grant.sessionId !== sessionId || grant.deviceId !== deviceId) {
      response.writeHead(404); response.end(); return;
    }
    let data;
    try {
      if (grant.inline) data = Buffer.from(grant.inline.slice(grant.inline.indexOf(',') + 1), 'base64');
      else {
        if (await realpath(grant.file) !== grant.file) throw new Error('Image unavailable');
        const handle = await open(grant.file, 'r');
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Image unavailable');
          data = await handle.readFile();
        } finally { await handle.close(); }
      }
      if (data.length > MAX_BYTES || imageType(data) !== grant.type) throw new Error('Image unavailable');
    } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': grant.type, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(grant.name === 'Shared image' ? `shared-image.${grant.type.split('/')[1]}` : grant.name)}` } : {}) });
    response.end(request.method === 'HEAD' ? undefined : data);
  }
}
