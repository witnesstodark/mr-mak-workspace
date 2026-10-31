# Local ComfyUI / MMAudio sound candidates

Use this route when the project/owner selected local ComfyUI. It is not a global
provider preference. Wild Horizons is an existing example, not an obligation to
use its animal prompts, model filenames or server address in every project.

## Resume and preserve

Inspect the running local service and installed node/model capabilities before
submitting work. Keep a stable event/take ID, prompt, seed, requested duration,
model/graph revision, source/output paths and review state in a local receipt.
Save the returned job ID immediately. After a timeout, query/resume that same
job; do not blindly resubmit. Surface failed jobs for inspection rather than
treating missing output as a reason to create a duplicate.

Keep original lossless audio, review derivatives and runtime encodes distinct.
Record hashes and conversion settings. Check both receipt state and source/output
existence before skipping work. Preserve accepted originals and rejected history.
Batch generation is a real GPU workload; run it only for requested sound work.

## Runtime encoding and proof

Minecraft's current Wild Horizons pipeline uses mono 44.1 kHz Vorbis with short
edge fades and headroom. It retains FLAC sources and uses FFmpeg/FFprobe for
conversion and decoded sample checks. These are this project's verified choices,
not universal requirements for music, stereo ambience or another engine.

Measure the decoded encode, since lossy encoding can introduce overshoot after
limiting. Verify channels/rate/codec, duration, silence, peak and RMS; listen for
event fit, clipping, repetition, transitions and spatial mix in the native game.
A silent native video contains no audio acceptance evidence. Keep generated,
technically checked, human accepted, integrated and mix-reviewed states separate.

## Existing implementation

In this repository, inspect `projects/wildhorizons/tools/generate_audio.py` for
the resumable graph/manifest/conversion flow and `tools/verify_resources.py` in
that mod for decoded checks. The owner selected local ComfyUI with MMAudio v2;
the model names in the script reflect that installation. Job IDs, manifests and
lossless sources remain under ignored `audio_sources/`, not shared instructions.
