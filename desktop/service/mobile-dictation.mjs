import path from 'node:path';
import { localAvailable, localConfig, localTranscribe } from './local-dictation.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';

export const AUDIO_LIMIT = 8 * 1024 * 1024;
export const RECORDING_SECONDS = 120;
const PROMPT = 'Transcribe speech verbatim in its original language(s). Preserve code-switching, names and technical terms. Do not translate or summarize.';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const formats = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

export class MobileDictation {
  constructor(repo, { fetcher = fetch, env = process.env, localRunner = localTranscribe, localStatus = localAvailable, providerChoice = () => null } = {}) {
    this.providerChoice = providerChoice; this.localRunner = localRunner; this.localStatus = localStatus;
    this.repo = repo; this.fetcher = fetcher; this.env = env;
    this.jobs = new Map(); this.controllers = new Map(); this.rates = new Map(); this.closed = false;
  }
  async config() {
    const keys = { ...this.env, ...parse(await readFile(path.join(this.repo, '.env'), 'utf8').catch(() => '')) };
    const router = keys.OPENROUTER_API_KEY || keys.OPENROUTER_KEY;
    const openai = keys.OPENAI_API_KEY || keys.OPENAI_KEY;
    const provider = this.providerChoice() || keys.MRMAK_TRANSCRIBE_PROVIDER?.trim().toLowerCase() || 'local';
    const key = provider === 'openrouter' ? router : provider === 'openai' ? openai : null;
    const modelOverride = !this.providerChoice() || keys.MRMAK_TRANSCRIBE_PROVIDER?.trim().toLowerCase() === provider ? keys.MRMAK_TRANSCRIBE_MODEL?.trim() : null;
    return { provider, key, local: localConfig(this.repo, keys), model: modelOverride || (provider === 'openrouter' ? 'openai/gpt-4o-transcribe' : 'gpt-4o-transcribe') };
  }
  async status() {
    const config = await this.config();
    const keys = { ...this.env, ...parse(await readFile(path.join(this.repo, '.env'), 'utf8').catch(() => '')) };
    const providers = [
      { id: 'local', label: 'Local Whisper · Free', available: await this.localStatus(config.local), detail: 'Runs on your computer. No API charges.' },
      { id: 'openai', label: 'OpenAI · Paid', available: !!(keys.OPENAI_API_KEY || keys.OPENAI_KEY), detail: 'Uses your OpenAI API credit.' },
      { id: 'openrouter', label: 'OpenRouter · Paid', available: !!(keys.OPENROUTER_API_KEY || keys.OPENROUTER_KEY), detail: 'Uses your OpenRouter API credit.' },
      { id: 'off', label: 'Off', available: true, detail: 'Microphone dictation disabled.' },
    ];
    return { available: config.provider !== 'off' && !!providers.find(item => item.id === config.provider)?.available, provider: config.provider, providers, maxSeconds: RECORDING_SECONDS, maxBytes: AUDIO_LIMIT };
  }

  async transcribe(request, deviceId, authorized = () => true) {
    if (this.closed || !authorized()) fail('This phone is disconnected.', 401);
    const id = request.headers['x-transcription-id'];
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) fail('A recording ID is required.');
    const mime = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!formats[mime]) fail('This audio format is not supported. Use your keyboard microphone instead.', 415);
    if (Number(request.headers['content-length'] || 0) > AUDIO_LIMIT) fail('Recording is too large. Record a shorter message.', 413);
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > AUDIO_LIMIT) fail('Recording is too large. Record a shorter message.', 413);
      chunks.push(chunk);
    }
    const audio = Buffer.concat(chunks);
    const valid = audio.length >= 12 && (mime === 'audio/webm' ? audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : mime === 'audio/mp4' ? audio.toString('ascii', 4, 8) === 'ftyp'
      : mime === 'audio/ogg' ? audio.toString('ascii', 0, 4) === 'OggS'
      : audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE');
    if (!valid) fail('The recording is empty or damaged. Try recording again.', 415);
    if (!authorized() || this.closed) fail('This phone is disconnected.', 401);
    const now = Date.now(), key = `${deviceId}:${id}`;
    for (const [key, job] of this.jobs) if (!job.pending && job.expires < now) this.jobs.delete(key);
    for (const [id, rate] of this.rates) if (rate.at + 60000 < now) this.rates.delete(id);
    const hash = createHash('sha256').update(mime).update(audio).digest('hex');
    const previous = this.jobs.get(key);
    if (previous) {
      if (previous.hash !== hash) fail('This recording ID belongs to different audio.', 409);
      return previous.promise;
    }
    if (this.controllers.has(deviceId)) fail('Another recording is being transcribed. Wait a moment and retry.', 429);
    if (this.controllers.size >= 2) fail('Transcription is busy. Wait a moment and retry.', 429);
    const rate = this.rates.get(deviceId) || { at: now, count: 0 };
    if (rate.count >= 6) fail('Please wait a minute before transcribing another recording.', 429);
    const config = await this.config();
    if (config.provider === 'local' && !await this.localStatus(config.local)) fail('Local Whisper is not installed. Run the local dictation setup on your computer.', 503);
    if (config.provider !== 'local' && !config.key) fail('Voice input needs OPENROUTER_API_KEY or OPENAI_API_KEY in the computer workspace .env. Your keyboard microphone still works.', 503);
    // Recheck after the asynchronous config read, before reserving a paid request.
    if (!authorized() || this.closed) fail('This phone is disconnected.', 401);
    const completed = this.jobs.get(key);
    if (completed) {
      if (completed.hash !== hash) fail('This recording ID belongs to different audio.', 409);
      return completed.promise;
    }
    if (this.controllers.has(deviceId)) {
      const existing = this.jobs.get(key);
      if (existing?.hash === hash) return existing.promise;
      fail('Another recording is being transcribed. Wait a moment and retry.', 429);
    }
    if (this.controllers.size >= 2) fail('Transcription is busy. Wait a moment and retry.', 429);
    while (this.jobs.size >= 64) {
      const oldest = [...this.jobs].find(([, job]) => !job.pending);
      if (!oldest) break;
      this.jobs.delete(oldest[0]);
    }
    const currentRate = this.rates.get(deviceId) || rate;
    if (currentRate.count >= 6) fail('Please wait a minute before transcribing another recording.', 429);
    currentRate.count++; this.rates.set(deviceId, currentRate);
    const controller = new AbortController(); this.controllers.set(deviceId, controller);
    const job = { hash, pending: true, expires: now + 10 * 60 * 1000 };
    job.promise = this.call(config, audio, mime, controller.signal).then(result => {
      if (!authorized() || this.closed) fail('This phone is disconnected.', 401);
      return result;
    }).catch(error => { this.jobs.delete(key); throw error; }).finally(() => {
      job.pending = false; this.controllers.delete(deviceId);
    });
    this.jobs.set(key, job);
    return job.promise;
  }
  async call({ provider, key, model, local }, audio, mime, signal) {
    if (provider === 'local') {
      const result = await this.localRunner(local, audio, formats[mime], signal);
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!text) fail('No speech was recognized. Try recording again.', 422);
      if (text.length > 60000) fail('The transcript is too long for one message.', 413);
      return { text };
    }
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `recording.${formats[mime]}`);
    form.append('model', model); form.append('response_format', 'json');
    if (model.includes('gpt-4o')) form.append('prompt', PROMPT);
    const url = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
    let response, result;
    try {
      response = await this.fetcher(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]) });
      result = response.ok ? await response.json() : null;
    } catch { fail('Transcription could not finish. Your recording is kept on this phone; try again.', 502); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) fail('The transcription API key was rejected. Check it on your computer.', 502);
      if (response.status === 402 || response.status === 429) fail('The transcription account has reached its credit or usage limit. Retry later.', 429);
      fail('The transcription provider could not process this recording. Retry or record a shorter message.', 502);
    }
    const text = typeof result?.text === 'string' ? result.text.trim() : '';
    if (!text) fail('No speech was recognized. Try recording again.', 422);
    if (text.length > 60000) fail('The transcript is too long for one message.', 413);
    return { text };
  }
  revoke(deviceId) {
    this.controllers.get(deviceId)?.abort();
    for (const key of this.jobs.keys()) if (key.startsWith(`${deviceId}:`)) this.jobs.delete(key);
  }
  close() { this.closed = true; for (const controller of this.controllers.values()) controller.abort(); this.jobs.clear(); }
}
