---
name: game-audio-workflow
description: Build and review game sound banks, map chosen takes to real events, and prepare or verify runtime playback with timing, repetition and mix limits. Use for unit voices, foley, impacts, UI cues and ambience.
---

# Game audio workflow

Start with an event inventory and native motion/gameplay references. Separate
unit voice, movement/gear, weapon air, material impact, victim reaction, UI,
strategic alerts, music and ambience. A good recording can still be wrong for
the event, camera distance or crowd mix.

## Prepare and select material

For sourcing, generator prompts, editing and loudness preparation, see
`sound-effects-workflow`.

For each event, record its meaning, motion anchor, source or generation route,
desired length and review state. Reuse the user's chosen provider, voice and
references. Inspect current tool capabilities instead of copying a stale model
identifier. Keep generation IDs to recover pending jobs without duplicating them.

Use stable take IDs and direct local playback. Keep source, audition edit and
runtime file distinct. Record cut points, fades, gain/pitch/time changes and
source hashes. A compressed preview is not a lossless production master.
Review actual samples for clipping, silence, format, duration and loop seams;
technical checks do not establish the desired performance or tone.

Keep candidate, liked-for-comparison, accepted, integrated and mix-reviewed
states separate. Preserve rejected history without presenting it as selected.
Do not normalize or replace an accepted original silently. One accepted source
may map to multiple events without duplicate files.

## Follow the real event

Split an attack into optional effort, swing air, confirmed material contact and
recipient reaction. A cancelled attack produces no contact sound. A death voice
is separate from the body's actual landing. Footsteps follow planted-foot events
or the project's verified distance/phase system; an arbitrary timer or a full
audition loop may drift from the animation.

Play one appropriate speaker for a group command, with per-speaker repetition
limits. Repeated path updates may affect movement without repeating the voice.
Choose concurrency, variation and distance limits from the actual mix. Coalesce
related alerts and fire a match result once from the authoritative result event,
not whenever the HUD refreshes. Do not add a parry cue without a real parry event.

## Integrate and listen

Use the project's mixer groups and persistent settings. Verify pause, mute,
scene changes, interruption, visibility and source cleanup. Audition at gameplay
distance and with a representative crowd, then check normal device output.
Preserve the user's mix; do not replay unrelated narration during a focused test.

Deliver an event-to-file manifest, provenance/licences, original and derived
files, selected states, event anchors, native listening capture and open mix
decisions. Name which checks were technical and which were listened to.

Example: a robot's walk, swing, metal impact and shutdown. Successful delivery
keeps the impact conditional on a hit, aligns steps, limits crowd repetition and
preserves the approved takes. Dependencies: an audio editor or FFmpeg for edits,
chosen generation/stock tools when requested, and engine access for integration.
