# Prompting sound effect generators

Generators follow concrete physical descriptions better than adjectives. Build
each prompt from these parts, in this order, and leave out what does not apply:

1. **Source and action:** "a heavy wooden crate is smashed by a mace".
2. **Material and size:** "thick oak planks, iron brackets, splinters".
3. **Perspective:** "close", "from across a small room", "distant".
4. **Length and shape:** "a single short hit, sharp attack, 0.6 seconds,
   quick natural decay".
5. **Character:** the project's sound style, such as "warm, punchy, slightly
   cartoony, clean".
6. **Exclusions:** "isolated, no music, no voice, no reverb, no background
   noise".

Keep one sound per request. A prompt asking for "three variations" often
returns one file with three hits; split it, or better, send three requests.

## Settings

- **Duration:** set it explicitly for short one-shots (0.3-1.5 s). Generators
  pad short sounds with tails or silence when left to guess.
- **Prompt influence** (where offered): higher follows the text more literally
  with less variety. Raise it for precise sounds; lower it to explore.
- **Loop:** request a looping sound for continuous material such as fire,
  rain, wind or machinery, then verify the seam with `audio_tool.py sheet` and,
  if needed, `audio_tool.py loop`.
- **Format:** request WAV or raw PCM at 48 kHz (or the contract rate). MP3 and
  Opus are previews, not masters.

## Patterns by category

| Category | Pattern | Example |
| --- | --- | --- |
| Footstep | {shoe} footstep on {surface}, {gait}, single step, close, dry, no reverb | soft leather boot footstep on worn cobblestone, sneaking, single step, close, dry, no reverb |
| Impact | {object} hits {material}, single impact, {weight}, quick decay | wooden club hits a thick oak door, single impact, heavy, quick decay |
| Break | {object} of {material} breaks apart, {debris}, 1 second | wooden crate breaks apart, planks cracking and splinters scattering, 1 second |
| Weapon air | {weapon} swing whoosh, {speed}, no impact | short sword swing whoosh, fast, no impact |
| Bow, throw | {action}, mechanical detail, no impact | longbow string release with a soft thrum and arrow whoosh, no impact |
| Magic | {element} spell {phase}, {texture}, fantasy, no voice | fire spell cast, a quick whoosh igniting into a crackling flare, fantasy, no voice |
| Pickup, UI | {object} {action}, tiny, bright, playful | three small gold coins clinking into a leather pouch, tiny, bright, playful |
| Interface tone | soft {instrument-like} {gesture}, {length} | soft wooden marimba blip rising two notes, 0.2 seconds |
| Alert sting | short {mood} sting for a guard noticing someone, {instrument} | short curious sting, a plucked lute note rising with a question, 0.6 seconds |
| Ambience loop | {place} ambience, {time}, {layers}, seamless loop, no music | medieval village square at noon, distant chatter, chickens, a blacksmith hammering far away, seamless loop, no music |
| Creature | {creature} {vocal action}, {size}, cartoon fantasy | small goblin snicker, high pitched, cartoon fantasy |

## Gibberish voices (barks)

For short nonsense voice lines, either:

- **Text-to-speech with designed voices:** design one voice per race or
  faction, then speak nonsense syllables with punctuation that sets the emotion
  ("Hrm? Bah-dum wekka?" for suspicion). Keep the syllables fixed per voice so
  each speaker sounds consistent, and vary the emotion by punctuation and
  delivery settings.
- **Syllable synthesis:** record or generate a small set of vowel and syllable
  sounds per voice, then build lines in the engine by playing random syllables
  at the voice's pitch with small variations. This is cheap, has no length
  limit and follows subtitles.

Subtitles carry the meaning; the voice carries identity and emotion. Check
that hostile, suspicious and friendly barks are distinguishable without the
subtitle.

## Review notes to record per take

Prompt, provider and model, settings (duration, influence, loop, format), seed
or request ID, the file name of the original, the edited master, metrics from
`analyze`, the sheet image, and the owner's listening verdict.
