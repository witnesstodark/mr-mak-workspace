"""Offline CPU dictation. Audio and transcripts are never logged."""
import argparse
import json
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--audio', required=True)
args = parser.parse_args()
model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
audio = decode_audio(args.audio, sampling_rate=16000)
if len(audio) > 125 * 16000:
    raise ValueError('Recording exceeds two minutes')
segments, info = model.transcribe(audio, task='transcribe', vad_filter=True, beam_size=5, condition_on_previous_text=False)
print(json.dumps({'text': ' '.join(segment.text.strip() for segment in segments).strip()}, ensure_ascii=False))
