# Music with modelled instruments

## Score format

```
tempo 112                 # beats per minute
loop 16                   # optional: a seamless loop this many beats long
humanize 0.004            # optional: seeded timing wander in seconds
track chords pluck pan=-0.3 strum=0.018 velocity=0.65
  A2:1 A3+C4+E4:1/2 A3+C4+E4:1/2 E3:1 A3+C4+E4:1 |
  G2:1 G3+B3+D4:1/2 G3+B3+D4:1/2 D3:1 G3+B3+D4:1
track melody flute pan=0.25 gain=-3
  E5:1 C5:1/2 D5:1/2 E5:1 A4:1 | D5:1 B4:1/2 C5:1/2 D5:1 G4:1
track beat drum velocity=0.7
  low:1 high:1/2 high:1/2 low:1/2 low:1/2 high:1
```

- A token is `WHAT:BEATS` or `WHAT:BEATS@VELOCITY`. WHAT is a note (`C4` is
  middle C; `F#3`, `Bb2`), a MIDI number (`69`), a chord (`C3+E3+G3`), a rest
  (`r`) or, on a drum track, a hit: `low` (palm in the middle), `high` (fingers
  near the rim), `rim` (the frame).
- Beats: `1`, `0.5`, `1/2`, `3/2`. Each track keeps its own position; tracks
  start together. `|` is only for reading; `#` after a space starts a comment.
- Track options: `pan` (-1 left to 1 right), `gain` (dB), `velocity` (default
  for its notes, 0 to 1), `octave` (shift every note), `strum` (seconds between
  a chord's notes, low to high).
- A one-shot lasts until its last ring dies. With `loop`, the file is exactly
  that many beats and tails fold over the seam; write the loop so its last bar
  leads back into its first.

## Instruments

| Name | Model | Good range | Character |
| --- | --- | --- | --- |
| `pluck` | Modal string: plucking-point comb, stiffness, two strings beating, body warmth | E2-E5 | Guitar, harp, cittern; chords strummed |
| `reed` | Odd harmonics, nasal formant, breath, pitch scoop | C3-C6 | Clarinet, shawm, pipe chanter: fanfares, rustic leads |
| `bowed` | Sawtooth-like series, slow attack, delayed vibrato, body resonances | C2-A5 | Fiddle, cello: drones, sad or tense lines |
| `flute` | Strong fundamental, breath noise, chiff | C4-C7 | Flute, recorder, whistle: melodies |
| `drum` | Membrane modes with tension glide | `low`, `high`, `rim` | Hand drum or tom |
| `bell` | Bell partials with warbling doublets, rings about 3 s | C4-C6 | Rewards, tolls, endings |
| `mallet` | Tuned bar modes over a resonator | C4-C7 | Marimba, xylophone: interface motifs, arpeggios |

Instruments are plain functions `play(rng, freq, seconds, velocity)`; add one
by modelling its exciter and resonator the same way and registering it in
`INSTRUMENTS`.

## Writing cues

- **Length:** a sting is 0.5 to 3 seconds; a fanfare 2 to 5; a loop 4 to 16 bars.
- **Meaning:** rising and major for success, falling and minor for loss, a
  short unresolved figure for alarm or suspicion, a single bell or bar for a
  neutral event. Keep one instrument family per game so cues feel related.
- **Mix:** two or three tracks at once. Pan the accompaniment away from the
  lead, keep drums central, and use `gain` before velocity to balance tracks.
- **Takes:** the seed changes the humanising, velocities and each note's fine
  detail, not the notes. Write a second score for a real variation.

## Limits

These models play notes cleanly but without the phrasing, dynamics and
ensemble interplay of a performance, and the palette is small. Use them for
short cues, interface motifs and simple loops. For a level theme, menu music
or anything longer than a minute, prefer a composer, a DAW or MIDI with
sampled instruments, a music generator, or a licensed library, and keep these
cues as the game's short musical punctuation.
