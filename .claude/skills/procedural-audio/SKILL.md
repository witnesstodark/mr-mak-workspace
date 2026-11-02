---
name: procedural-audio
description: Make game sound effects, short musical cues and seamless loops by modelling how real things sound in Python (exciter, resonator, layers), rendered deterministically from seeds through a catalogue, mastered to loudness targets under a true-peak ceiling without limiting, with a manifest, review sheets and a listening page.
---

# Procedural audio

Every sound here is code that imitates the physics of its source (what
strikes, what rings, what falls after) and renders to WAV from a seed. A new
seed is a new take, a seed always renders identical bytes, and the scripts are
the source: change a setting and render again.
It suits a grounded style, many variations, impacts, foley, mechanisms,
ambience beds, interface sounds and short music cues, with no licences or
credits. Voices go to [elevenlabs-voices](../elevenlabs-voices/SKILL.md);
library and generator sourcing and the shared editing tool live in
[sound-effects-workflow](../sound-effects-workflow/SKILL.md);
[game-audio-workflow](../game-audio-workflow/SKILL.md) maps accepted takes to
events. Start from the project's sound contract (rate, loudness targets,
mono or stereo, naming) and its event inventory.

## Model the source

1. **Describe the physics** before writing code: what touches what and for
   how long (the exciter: a contact, a scrape, a stick-slip, a stream of air),
   what rings afterwards (the resonator: a plank's modes, a blade, a skin, a
   string, a bubble), and what follows (debris, bounces, a settle). Leave the
   room and distance to the engine: no reverb in the source.
2. **Build from the blocks** in `scripts/dsp.py`: `impact` (a half-sine contact
   through decaying modes; a short contact is bright, a long one dull),
   `material` (a mode table) and `individual` (one object of a kind),
   `low_body`, `hiss`, `crackle` (grit, fibres, rain), `fracture`, `rebounds`,
   `swish` (air whose band follows a speed), `friction` (creaks), `drip_bubble`,
   `place_stereo`, `fold_loop` and `blend_loop`.
   [The modelling guide](references/modelling-guide.md) has recipes, mode sets,
   contact times and fixes by symptom.
3. **Layer** the parts in time with their own levels, then `polish` (no rumble,
   no harsh air). `scripts/models.py` has a dozen worked examples: a door knock,
   a sword on a shield, footsteps on three surfaces, a sack dropped, a crate and
   a pane breaking, swings, a bow, a creak, a lock, coins, a drip, interface
   sounds, a fire loop and a rain loop.
4. **Vary by seed**, as no two blows are alike: sizes, contact times, mode
   offsets, timing and debris counts all come from `np.random.default_rng(seed)`.
   Never use global randomness, the clock or unordered iteration. Variation in
   the source beats pitch-shifted copies; the engine still adds small random
   pitch and volume.

## The catalogue

A catalogue is a Python file with a list `EVENTS` of
`Event(stem, model, takes, target_lufs, describe, params, loop, channels,
category)`. [example_catalogue.py](scripts/example_catalogue.py) lists 25 events:
sounds, interface, four cues and three loops. Seeds come from the stem and take
number, so adding an event or a take never changes another. Sounds the engine
positions are mono; interface sounds, cues, music and beds are stereo.

`render.py render` makes each take: the model's samples, then `master.py`:
one-shots are trimmed (1 ms before the attack, 10 ms after the tail falls 60 dB)
and given raised-cosine fades; loops keep every sample. Gain sets the loudest
400 ms (momentary) of a one-shot, or the gated integrated loudness of a loop,
to the target, but never past the -1 dBTP true-peak ceiling. Nothing limits or
compresses the sound. When the ceiling stops a take short, the report gives the
shortfall: lengthen the contact, add body, take out a low thud that eats
headroom, or lower that event's target. 16-bit files get seeded dither, so a
render repeats byte for byte on the same numpy and scipy versions.

Loops are seamless by construction: events are placed in the loop and their
tails `fold_loop` onto its start; steady textures are rendered longer and
`blend_loop` fades the overhang across the head. The render measures each seam
against the loop itself: the sample step across it beside the largest inside,
and the level change across it beside the usual change from one 50 ms frame to
the next. Set the engine's loop to the whole file.

## Music

`scripts/instruments.py` models a plucked string, a reed, a bowed string, a
blown pipe, a hand drum, a bell and a wooden mallet bar. `scripts/score.py`
reads a small text score (tempo, tracks, `NOTE:BEATS@VELOCITY`, chords with
`+`, rests, an optional loop length) and renders stings, fanfares, interface
motifs and short loops through `models.cue`. See [the music reference](references/music.md).
This suits cues of a few seconds and simple loops of a few bars. It has no
expressive phrasing across a long piece, a small palette and no mix beyond pan
and gain, so longer or richer music needs another source: a composer, a DAW or
MIDI with sampled instruments, a music generator or a licensed library.

## Review

An agent cannot listen. `render --check` fails on loudness off target by more
than 0.5 dB, clipping, a true peak over the ceiling, DC offset or a loop seam.
Run `audio_tool.py analyze --check` on the files as an independent check, and
look at the `--sheets` (waveform and spectrogram per event) for cut-off rings
(a thin vertical line at a tail), missing attacks, aliasing, hum and pumping
loops. Then the owner listens on the `--page`, which groups takes by category
with players, seeds, model calls, metrics and sheets. Only the owner's verdict
accepts a take: record it with `mark`; it lapses if the take's seed or model
call changes. Rendered files are rebuildable outputs: keep the catalogue and
models in version control and the WAVs where the project keeps its audio.

## Commands

```bash
python scripts/render.py list --catalogue scripts/example_catalogue.py
python scripts/render.py render --catalogue scripts/example_catalogue.py --out build/audio --sheets --page --check
python scripts/render.py render --catalogue my_catalogue.py --out build/audio --only knock swing --check
python scripts/render.py mark knock_door --take 2 --verdict accepted --note "solid" --out build/audio
python ../sound-effects-workflow/scripts/audio_tool.py analyze --check build/audio/*/*.wav
```

`render` writes `<out>/<category>/<stem>_<NN>.wav`, `manifest.json` (per take:
seed, model call, SHA-256, length, loudness, true peak, gain, shortfall, seam),
`sheets/` and `listen.html`; `--only` re-renders matching stems and keeps the
rest of the manifest; `--jobs` renders in parallel with identical bytes.

Example request: "We need a wooden door knock, three takes, and a short
victory fanfare." Expected result: a knock model (soft knuckle contact, door
modes, frame thud) and a fanfare score in the catalogue, three and two takes
rendered on target with no check failures, sheets that were looked at, a
listening page, and the takes left as candidates until the owner marks them.

Dependencies: Python 3.9+ with numpy and scipy, and Pillow for sheets
([requirements](scripts/requirements.txt));
[sound-effects-workflow](../sound-effects-workflow/SKILL.md)'s
`scripts/audio_tool.py` beside this skill (or copied into `scripts/`) for
loudness, true peak, WAV writing and sheets.
