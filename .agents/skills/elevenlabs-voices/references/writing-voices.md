# Writing voices and lines

## Voice descriptions

ElevenLabs' voice design guide recommends this structure, with the language
and regional variant first so the voice does not drift:

```
Native <language and variant>. <Gender>, <age range>. <Recording quality>.
Persona: <2-5 words>. Emotion: <2-3 adjectives>.
<1-2 sentences on timbre, pitch, pacing and delivery.>
```

Examples (illustrative, not anyone's cast):

| Voice | Description |
| --- | --- |
| A tired town guard | Native English, West Country accent. Male, late 40s. Studio-quality recording. Persona: weary night-watch guard. Emotion: gruff, wary, dutiful. A low, chesty voice with some gravel; short, clipped sentences that turn loud and sharp when alarmed. |
| A cheerful market trader | Native English, Liverpool accent. Female, 30s. Studio-quality recording. Persona: quick-talking stall keeper. Emotion: warm, cheeky, persuasive. A bright mid-pitched voice, fast and rhythmic, smiling through the words. |
| An old ferryman | Native English, soft Welsh accent. Male, 70s. Studio-quality recording. Persona: patient river ferryman. Emotion: calm, dry, kindly. A slow, breathy baritone with a slight rasp and long pauses. |
| A small swamp creature | Native English. Gender-neutral, sounds young. Studio-quality recording. Persona: nervous little marsh critter. Emotion: jumpy, curious, timid. A high, reedy, nasal voice; quick bursts of sound and squeaks when startled. |

Rules from the guide and from practice:

- Use "thick" rather than "strong" for a pronounced accent; never "foreign" or
  "exotic". Use "accent" only for dialect; describe intonation as delivery.
- Leave out effect words (reverb, echo, phone, radio, tape). The engine adds
  space and distance.
- Name a quality level ("studio-quality recording") for a clean voice, but
  heavy quality phrasing can pull a very specific voice off target.
- Accents and archetypes are a starting point; a fantasy race or faction does
  not need a real-world accent. Let the owner choose.
- The preview text must suit the voice: a calm voice reading an excited line
  sounds forced. One to three full sentences in the persona's own words.
- `guidance_scale` (API default 5) trades audio quality for closeness to the
  description: raise it only when an accent or tone keeps missing.

## Lines, barks and gibberish

- **Barks** are one to three syllables for an event that repeats (an alarm, a
  hit, pleased, a pain grunt). Short and clear wins over clever: a player hears
  them hundreds of times.
- **Gibberish**: give each voice a small fixed set of nonsense syllables that
  suit its mouth (soft and round for a gentle creature, hard stops for a gruff
  one), and build every line from that set so the speaker stays recognisable.
  Example set for a gruff voice: `brak, tu, hom, dregg, oy, varn`. Subtitles
  carry meaning; the voice carries identity and emotion. A real word or two
  ("stop", "you") can anchor a line without breaking the language.
- **Emotion** comes from the description (the voice's baseline), the words and
  punctuation (`?` lifts, `!` pushes, `...` hesitates, capitals stress), and a
  tag at the start: `[whispers]`, `[sighs]`, `[excited]`, `[curious]`,
  `[laughs]`. One tag per short line is enough. A tag can add a long sigh or
  laugh: compare with and without it.
- **Length:** a model pads very short text with breath and pauses. Ask for the
  shortest wording, then tighten and trim; a line that stays too long after
  that needs fewer words, not a faster `speed`.
- **Takes:** three per line, each its own request and seed. Re-speak a line with
  a new key when its text or settings change.

| Emotion | Typical tag and text | Length |
| --- | --- | --- |
| Alarm | `[shouting] Stop right there!` | 0.5-1.0 s |
| Curious | `[curious] Hm? Who's that?` | 0.4-1.0 s |
| Pleased | `[laughs] Ha! Good.` | 0.3-0.9 s |
| Pain | `Ngh!` (no tag, or `[gasps]`) | 0.2-0.5 s |
| Relief | `[sighs] Thank the stars...` | 0.6-1.5 s |
| Gibberish alarm | `[shouting] Brak! Dregg-oy!` | 0.5-1.0 s |

Check that hostile, suspicious and friendly barks are distinguishable without
the subtitle, at gameplay distance and under the mix.
