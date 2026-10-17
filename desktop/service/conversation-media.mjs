import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { secret } from './util.mjs';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_INLINE = 3 * 1024 * 1024;
const types = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (data.subarray(0, 2).toString() === 'BM') return 'image/bmp';
  if (data.subarray(4, 8).toString() === 'ftyp') return data.subarray(8, 12).toString() === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && data.includes(Buffer.from('webm'))) return 'video/webm';
  throw new Error('Media unavailable');
}

// Read only explicit media records and media links; never infer media from arbitrary tool text.
export function imageReferences(content, text = '') {
  const refs = [];
  const add = source => { if (typeof source === 'string' && source.length <= MAX_INLINE * 1.4 && !refs.includes(source) && refs.length < 12) refs.push(source); };
  const visit = (parts, depth = 0) => {
    if (!Array.isArray(parts) || depth > 2) return;
    for (const part of parts) {
      if (['image', 'input_image', 'image_url', 'video', 'input_video', 'video_url'].includes(part?.type)) {
        if (part.source?.type === 'base64' && types.has(part.source.media_type)) add(`data:${part.source.media_type};base64,${part.source.data}`);
        else add(part.video_url?.url || part.video_url || part.image_url?.url || part.image_url || part.source?.url || part.url);
      }
      if (part?.type === 'tool_result') visit(part.content, depth + 1);
    }
  };
  visit(content);
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)/g)) {
    const source = match[1].replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']$/, '');
    if (/\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v)(?:[?#].*)?$/i.test(source) || source.startsWith('data:image/')) add(source);
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
      if (!info.isFile() || info.size < 1 || info.size > MAX_VIDEO_BYTES) throw new Error('Image unavailable');
      const head = Buffer.alloc(4096); await handle.read(head, 0, head.length, 0);
      const type = imageType(head);
      if (!type.startsWith('video/') && info.size > MAX_BYTES) throw new Error('Media unavailable');
      return { file: actual, type, name: path.basename(actual) };
    } finally { await handle.close(); }
  }
  async present(value, session, deviceId, mediaUrl = token => `/mobile/api/sessions/${session.id}/media/${token}`) {
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
          images.push({ url: mediaUrl(token), name: grant.name, kind: grant.type.startsWith('video/') ? 'video' : 'image', type: grant.type });
        } catch { images.push({ unavailable: true, name: 'Media unavailable', kind: /\.(mp4|webm|mov|m4v)$/i.test(reference) ? 'video' : 'image' }); }
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
    if (grant.type.startsWith('video/')) {
      let handle;
      try {
        if (await realpath(grant.file) !== grant.file) throw new Error('Media unavailable');
        handle = await open(grant.file, 'r');
        const info = await handle.stat(), head = Buffer.alloc(4096);
        await handle.read(head, 0, head.length, 0);
        if (!info.isFile() || info.size < 1 || info.size > MAX_VIDEO_BYTES || imageType(head) !== grant.type) throw new Error('Media unavailable');
        const headers = { 'Content-Type': grant.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(grant.name)}` } : {}) };
        let start = 0, end = info.size - 1, status = 200;
        const range = request.headers?.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
          start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        }
        response.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
        if (request.method === 'HEAD') { response.end(); return; }
        const stream = handle.createReadStream({ start, end, autoClose: true });
        handle = null;
        response.on('close', () => stream.destroy());
        stream.on('error', () => response.destroy());
        stream.pipe(response);
      } catch { if (!response.headersSent) { response.writeHead(404); response.end(); } else response.destroy(); }
      finally { if (handle) await handle.close(); }
      return;
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
