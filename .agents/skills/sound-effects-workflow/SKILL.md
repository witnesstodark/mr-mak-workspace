---
name: sound-effects-workflow
description: Source, generate, edit and deliver game sound effects, from libraries, generators or recordings, with prompt patterns, splitting, trimming, loudness normalisation, loops, visual review for agents and Godot import, before event integration with game-audio-workflow.
---

# Sound effects workflow

Start from the project's sound contract (format, loudness targets, variation
counts, naming, buses) and an event inventory: every gameplay moment that makes
a sound, with its meaning, distance, frequency and the event that triggers it.
If the project has no contract, draft one with the same sections as the art
contract template and mark undecided values as proposals. Hand finished sounds
to [game-audio-workflow](../game-audio-workflow/SKILL.md) for event mapping,
repetition limits and the mix.

## Choose a source per sound

- **Libraries first** for common foley, impacts and ambience: free bundles and
  CC0 packs are recorded well and cost nothing. Record the source, licence and
  attribution requirement per file. Exclude non-commercial licences.
- **Generators** for specific or stylised sounds, many variations and gaps in
  the library. Use the project's provider, read its live schema and price, and
  request uncompressed output (WAV or raw PCM) at the contract sample rate.
- **Recording or synthesis** for UI tones, glitch effects and anything that
  must match exactly; layer and process it like any other source.

## Prompt a generator

Describe one sound: source, action, material, size, perspective, length and
character, then exclusions. Ask for one isolated sound with a clean start, a
short natural tail, no music, no voice and no added room reverb, because the
engine adds space per area. Generate several takes per event in separate
requests, keep the prompt and settings with each take, and change one thing at
a time when revising. [The prompting reference](references/prompting.md) has
patterns, examples and settings for loops, ambience and gibberish voices.

## Prepare the files

Use `audio_tool.py`; every command writes to a new `--out`:

1. `pcm2wav IN --out OUT.wav --rate 48000` wraps raw PCM output (signed 16-bit
   mono by default) into WAV; `split` separates several takes in one file at
   silences. WAV files are read directly; other formats need ffmpeg on PATH.
2. `analyze --check` reports peak, true peak, loudness, DC offset, clipping and
   silence, and fails on problems.
3. `process` converts to mono for positional sounds, trims silence (keeping
   5 ms before the attack), adds short raised-cosine fades, resamples, and
   normalises by `peak`, `momentary` (loudest 400 ms, for one-shots) or
   `integrated` loudness (for loops) to the contract target without exceeding
   the true-peak ceiling. It applies gain only, never limiting or compression;
   when the ceiling stops the target, the report says so.
4. `loop` crossfades a tail into its head for ambience and continuous sounds.
5. `sheet` draws the waveform and spectrogram of each file.

Keep the downloaded original, the edited master and the engine file distinct,
with the commands and settings that produced each.

## Review without ears

An agent cannot listen. Use `sheet` images and `analyze` numbers to reject
technical failures: clipped or cut-off transients, missing tails, hum and
noise floors, hidden extra takes, long silence and audible loop seams. Then the
owner listens: present the takes in a page with native audio players, grouped
by event, with the prompt and metrics beside each. Only the owner's listening
verdict marks a sound accepted; record it per take.

## Variations and engine import

Frequent sounds (footsteps, hits, UI) need 3 to 6 takes plus small random pitch
and volume changes in the engine, rather than pre-rendered pitch copies.
For Godot, see [the Godot audio reference](references/godot-audio.md): import
settings, `AudioStreamRandomizer`, 2D players, buses and multiplayer rules.

Example request: "Make footsteps for stone, wood and grass, walking and
sneaking." Expected result: four to six takes per surface and gait from a
library or generator, split, trimmed, mono and normalised to the footstep
target, with sheets, metrics, a listening page and a manifest of sources and
licences ready for event mapping.

Dependencies: Python 3.9+ with numpy, scipy and Pillow
([requirements](scripts/requirements.txt)); ffmpeg only to decode MP3, Ogg or
FLAC; an audio player for the owner's listening pass.
