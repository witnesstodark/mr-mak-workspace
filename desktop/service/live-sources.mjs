import path from 'node:path';
import { watch } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const tail = value => Buffer.from(value).subarray(-2048).toString('utf8').replace(/^\uFFFD+/, '').trim();
const inside = (root, file) => { const relative = path.relative(root, file); return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };

// Owner-configured CSP sources, never values supplied by a mobile request.
// Scripts/styles are exact HTTPS paths; fonts may name an HTTPS origin.
export function validateMobileResources(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['scripts', 'styles', 'fonts'].includes(key))) throw new Error('mobileResources accepts scripts, styles and fonts only.');
  const result = {};
  for (const kind of ['scripts', 'styles', 'fonts']) {
    const entries = value[kind] ?? [];
    if (!Array.isArray(entries) || entries.length > 16) throw new Error(`mobileResources.${kind} must be an array of up to 16 HTTPS sources.`);
    result[kind] = Object.freeze(entries.map(entry => {
      if (typeof entry !== 'string' || entry.length > 2048 || /[\s;*'"\\]/.test(entry)) throw new Error(`Invalid mobileResources.${kind} source.`);
      let url;
      try { url = new URL(entry); } catch { throw new Error(`Invalid mobileResources.${kind} URL.`); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (kind === 'fonts' ? entry !== url.origin : url.pathname === '/' || entry !== url.href) || (kind === 'scripts' && !url.pathname.endsWith('.js'))) throw new Error(`mobileResources.${kind} requires ${kind === 'fonts' ? 'an HTTPS origin' : 'an exact HTTPS file path'} without credentials, query or fragment.`);
      return entry;
    }));
  }
  return Object.freeze(result);
}

export async function validateLiveSources(config) {
  if (!Array.isArray(config)) throw new Error('live-sources.json must contain an array.');
  const ids = new Set();
  for (const source of config) {
    if (!source || typeof source.id !== 'string' || !/^[a-z0-9-]+$/.test(source.id) || ids.has(source.id)) throw new Error('Live source IDs must be unique lowercase letters, numbers or hyphens.');
    ids.add(source.id);
    if (typeof source.label !== 'string' || !source.label.trim() || typeof source.python !== 'string' || !source.python.trim()) throw new Error(`${source.id}: label and python must be nonempty strings.`);
    if (!Array.isArray(source.args) || source.args.some(arg => typeof arg !== 'string')) throw new Error(`${source.id}: args must be an array of strings.`);
    if (source.args.some(arg => arg === '--out' || arg.startsWith('--out='))) throw new Error(`${source.id}: Workspace supplies --out.`);
    if (typeof source.project !== 'string' || !path.isAbsolute(source.project) || !(await stat(source.project).catch(() => null))?.isDirectory()) throw new Error(`${source.id}: project must be an existing absolute folder.`);
    validateMobileResources(source.mobileResources);
  }
  return config;
}

export function validateInputs(inputs) {
  if (!inputs || !Array.isArray(inputs.dirs) || !Array.isArray(inputs.files)) throw new Error('--list-inputs must return { dirs, files }.');
  if (inputs.files.some(file => typeof file !== 'string' || !path.isAbsolute(file)) || inputs.dirs.some(dir => !dir || typeof dir.path !== 'string' || !path.isAbsolute(dir.path) || typeof dir.recursive !== 'boolean' || !Array.isArray(dir.extensions) || dir.extensions.some(ext => typeof ext !== 'string' || !ext.startsWith('.')))) throw new Error('--list-inputs contains an invalid path or extension filter.');
  return inputs;
}

export function matchesInput(inputs, directory, filename) {
  const file = filename == null ? null : path.resolve(directory, String(filename));
  if (inputs.files.some(item => file ? path.resolve(item) === file : path.dirname(path.resolve(item)) === directory)) return true;
  return inputs.dirs.some(dir => {
    const root = path.resolve(dir.path);
    if (!file) return root === directory;
    return inside(root, file) && (dir.recursive || path.dirname(file) === root) && (!dir.extensions.length || dir.extensions.some(ext => ext.toLowerCase() === path.extname(file).toLowerCase()));
  });
}

// One queue owns all builder processes, including input discovery. Each source
// has one dirty bit and quiet-period timer, so changes never spawn parallel jobs.
export class LiveSources {
  constructor({ stateDir, files, changed = () => {}, quietMs = 1000, timeoutMs = 10 * 60 * 1000, watchInput = watch }) {
    Object.assign(this, { stateDir: path.resolve(stateDir), files, changed, quietMs, timeoutMs, watchInput });
    this.sources = []; this.closed = false; this.running = null; this.child = null;
  }
  list() { return this.sources.map(({ status }) => ({ ...status })); }
  async reportRoot(id) {
    const source = this.sources.find(item => item.id === id);
    if (!source) throw Object.assign(new Error('This live source is not configured.'), { status: 404 });
    if (this.closed) throw Object.assign(new Error('Live sources are closed.'), { status: 503 });
    // Pin the canonical directory used by the desktop grant. Retargeting a
    // junction after startup must not turn a report into another folder grant.
    if (path.relative(source.root, await realpath(source.outDir)) !== '') throw Object.assign(new Error('The configured report folder changed. Restart after checking its configuration.'), { status: 403 });
    return { root: source.root, resources: source.resources };
  }
  emit(source, values) { Object.assign(source.status, values); if (!this.closed) this.changed({ ...source.status }); }
  async init() {
    let config;
    try { config = JSON.parse(await readFile(path.join(this.stateDir, 'live-sources.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; config = []; }
    await validateLiveSources(config);
    for (const item of config) {
      const outDir = path.join(this.stateDir, 'live', item.id);
      if (inside(path.resolve(item.project), this.stateDir)) throw new Error(`${item.id}: stateDir must be outside the source project.`);
      await mkdir(this.stateDir, { recursive: true });
      const stateRoot = await realpath(this.stateDir), project = await realpath(item.project);
      if (inside(project, stateRoot)) throw new Error(`${item.id}: stateDir must be outside the source project.`);
      await mkdir(outDir, { recursive: true });
      const root = await realpath(outDir);
      if (inside(project, root)) throw new Error(`${item.id}: output must be outside the source project.`);
      if (path.relative(path.join(stateRoot, 'live', item.id), root) !== '') throw new Error(`${item.id}: output links must not leave the configured live output folder.`);
      const previous = await stat(path.join(outDir, 'index.html')).catch(() => null);
      const source = { ...item, outDir, root, resources: validateMobileResources(item.mobileResources), watchers: [], inputs: null, pending: true, due: 0, timer: null,
        status: { id: item.id, label: item.label, state: 'building', builtAt: previous?.isFile() ? previous.mtime.toISOString() : null, error: null, url: '' } };
      this.sources.push(source);
      const report = await this.reportRoot(item.id);
      source.status.url = `${this.files.origin}/view/${this.files.grant(report.root)}/`;
      this.emit(source, {});
    }
    this.pump();
    return this;
  }
  dirty(source) {
    if (this.closed) return;
    source.pending = true; source.due = Date.now() + this.quietMs;
    clearTimeout(source.timer);
    source.timer = setTimeout(() => this.pump(), this.quietMs);
  }
  installInputs(source, inputs) {
    validateInputs(inputs);
    const directories = new Map();
    for (const dir of inputs.dirs) directories.set(path.resolve(dir.path), dir.recursive || directories.get(path.resolve(dir.path)) || false);
    for (const file of inputs.files) { const parent = path.dirname(path.resolve(file)); if (!directories.has(parent)) directories.set(parent, false); }
    const watchers = [];
    try {
      for (const [directory, recursive] of directories) {
        const watcher = this.watchInput(directory, { recursive }, (_event, filename) => { if (matchesInput(inputs, directory, filename)) this.dirty(source); });
        watcher.on('error', error => this.emit(source, { state: 'failed', error: tail(`Input watcher failed: ${error.message}`) }));
        watchers.push(watcher);
      }
    } catch (error) { for (const watcher of watchers) watcher.close(); throw error; }
    for (const watcher of source.watchers) watcher.close();
    source.watchers = watchers; source.inputs = inputs;
  }
  run(source, listing = false) {
    return new Promise((resolve, reject) => {
      const args = [...source.args, '--out', source.outDir, ...(listing ? ['--list-inputs'] : [])];
      const child = spawn(source.python, args, { cwd: source.project, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const decoder = new StringDecoder('utf8');
      let stderr = Buffer.alloc(0), stdout = '', problem = null;
      child.stderr.on('data', chunk => { stderr = Buffer.concat([stderr, chunk]).subarray(-2048); });
      child.stdout.on('data', chunk => {
        if (!listing) return;
        stdout += decoder.write(chunk);
        if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) { problem = new Error('--list-inputs exceeded 4 MB.'); child.kill(); }
      });
      const timer = setTimeout(() => { problem = new Error('Builder timed out after 10 minutes.'); child.kill(); }, this.timeoutMs);
      child.on('error', error => { problem = error; });
      child.on('close', code => {
        clearTimeout(timer); this.child = null;
        if (this.closed) return reject(new Error('Live sources closed.'));
        if (problem || code !== 0) return reject(new Error(tail(stderr.length ? stderr : problem?.message || `Builder exited with code ${code}.`)));
        resolve(stdout + decoder.end());
      });
    });
  }
  pump() {
    if (this.closed || this.running) return;
    const source = this.sources.find(item => item.pending && item.due <= Date.now());
    if (!source) {
      for (const item of this.sources.filter(item => item.pending)) {
        clearTimeout(item.timer); item.timer = setTimeout(() => this.pump(), Math.max(1, item.due - Date.now()));
      }
      return;
    }
    source.pending = false; clearTimeout(source.timer);
    this.emit(source, { state: 'building', error: null });
    this.running = (async () => {
      try {
        if (!source.inputs) this.installInputs(source, JSON.parse(await this.run(source, true)));
        await this.run(source);
        const page = await stat(path.join(source.outDir, 'index.html'));
        if (!page.isFile()) throw new Error('Builder must write index.html in its output folder.');
        this.installInputs(source, JSON.parse(await this.run(source, true)));
        this.emit(source, { state: 'ready', builtAt: new Date().toISOString(), error: null });
      } catch (error) { this.emit(source, { state: 'failed', error: tail(error.message) }); }
    })().finally(() => { this.running = null; this.pump(); });
  }
  async close() {
    this.closed = true;
    for (const source of this.sources) { clearTimeout(source.timer); for (const watcher of source.watchers) watcher.close(); }
    this.child?.kill();
    await this.running;
  }
}
