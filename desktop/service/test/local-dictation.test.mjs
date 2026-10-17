import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { localConfig, localTranscribe } from '../local-dictation.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const { python } = localConfig(repo, process.env);
const installed = await access(python).then(() => true, () => false);
const stub = {
  '__init__.py': "class Segment:\n    text = ' Eu falo português, não é? '\nclass WhisperModel:\n    def __init__(self, *args, **kwargs): pass\n    def transcribe(self, audio, **kwargs): return [Segment()], None\n",
  'audio.py': 'def decode_audio(path, sampling_rate): return [0.0] * sampling_rate\n',
};

test('a local transcript keeps accented letters through the Python output pipe', { skip: !installed && 'local dictation Python is not installed' }, async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-whisper-stub-'));
  await mkdir(path.join(folder, 'faster_whisper'));
  for (const [name, source] of Object.entries(stub)) await writeFile(path.join(folder, 'faster_whisper', name), source);
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = folder;
  t.after(async () => {
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous;
    await rm(folder, { recursive: true, force: true });
  });
  const result = await localTranscribe({ python, model: folder }, Buffer.alloc(32), 'webm');
  assert.equal(result.text, 'Eu falo português, não é?');
});

