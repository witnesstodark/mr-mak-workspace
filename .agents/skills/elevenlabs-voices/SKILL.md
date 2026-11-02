---
name: elevenlabs-voices
description: Design character voices with ElevenLabs from written descriptions, compare candidates, save the chosen ones, and speak lines, barks and gibberish with emotion, seeds and takes, recording every paid step so reruns never pay twice; then tighten pauses, master with sound-effects-workflow and present a listening page.
---

# ElevenLabs voices

Use this for anything a character says or vocalises: barks, gibberish, short
lines, signature phrases, efforts and reactions. A voice synthesised in code
rarely convinces as a person; non-voice sounds belong to
[procedural-audio](../procedural-audio/SKILL.md) or
[sound-effects-workflow](../sound-effects-workflow/SKILL.md), and
[game-audio-workflow](../game-audio-workflow/SKILL.md) maps the chosen takes to
events. Start from the project's sound contract (rate, loudness target for
voices, naming) and a voice list: who speaks, what they say, when and how often.

## Before spending

The API key comes only from the environment variable `ELEVENLABS_API_KEY`.
The owner sets it once in a normal terminal, not in an agent chat, so the key
never enters a conversation, file or log; a chat started earlier must be
restarted to see it. On Windows:
`[Environment]::SetEnvironmentVariable("ELEVENLABS_API_KEY", "<key>", "User")`.

Run `check` first. It is read-only and reports the plan, credits used and
remaining, the reset date, voice slots and the speech models with their
character limits and cost multipliers. Estimate the batch (preview text
characters per design, line characters x takes per line), compare it with what
remains and with the generation budget the owner set, and get approval for a
batch the task did not already authorise. Pass `--max-credits` on paid commands
so a mistake cannot overspend. Every saved voice uses a slot until deleted.

## The route

1. **Describe each voice** in ElevenLabs' order: language and regional variant,
   gender and age, recording quality, persona (2 to 5 words), emotion (2 to 3
   adjectives), then one or two sentences on timbre, pitch, pacing and
   delivery. Write a preview text of 100 to 1000 characters that the voice
   would plausibly say, in plain language so the voice itself is judged.
   [Writing voices](references/writing-voices.md) has examples and the rules.
2. **Design** (`design NAME`): one call returns three candidates as previews,
   from a seed, and is charged once for the preview text. Revise the
   description and design again under a new name (`NAME_r2`) rather than
   repeating a seed. Keep `eleven_ttv_v3` unless `check` and the docs show a
   newer design model.
3. **Compare** on the listening page (`page`). The owner chooses. To compare
   candidates on real lines rather than the preview, save two or three with
   `--trial`, speak the same short lines with each, and delete the trials once
   one is chosen.
4. **Save** the chosen candidate (`save NAME --candidate b`). It becomes a voice
   in the account with an ID recorded in the manifest.
5. **Speak** each line in takes (`speak KEY --voice NAME --takes 3`): one request
   per take, take N with seed + N - 1, so each take differs and every take can be
   reproduced as closely as the service allows (determinism is best effort).
   Emotion comes from three places: the voice's description, the words and
   punctuation, and audio tags such as `[whispers]`, `[sighs]` or `[excited]`.
   Compare `eleven_v4` and `eleven_v3` on the first voice before a batch.
6. **Edit**: `scripts/tighten.py` shortens long pauses inside a take, then
   `sound-effects-workflow`'s `audio_tool.py process --trim --mono --normalize
   momentary --target <voice LUFS> --rate 48000` trims, fades and sets loudness
   under the true-peak ceiling; `analyze --check` and `sheet` catch technical
   faults. Keep the downloaded take, the edited master and the engine file apart.
7. **Review**: `page --processed <masters>` shows each take's original and edited
   version with its text, settings, seed and cost. Record the owner's verdict
   with `mark`; only that listening accepts a take.
8. **Clean up**: `delete --trials` removes comparison voices; `delete NAME`
   removes a voice whose lines are finished, since the files no longer need it
   and the description can design a similar voice again. `list` shows what is in
   the account.

## Settings, formats and seeds

- **Output:** raw PCM at the contract rate, `pcm_48000` first with `pcm_32000` as
  the fallback (the script tries `--formats` in order and keeps the first the
  plan accepts). PCM is wrapped as 16-bit mono WAV. MP3 and Opus are previews,
  not masters. Resample a 32 kHz take to the contract rate in `process`.
- **Voice settings** (`--stability`, `--similarity-boost`, `--style`, `--speed`)
  override the voice's stored settings for that request only. Lower stability
  gives a broader emotional range; leave the others at their defaults unless a
  comparison shows a reason. Do not use the API's `audio_effects`: the engine adds
  the room and distance.
- **Seeds:** designs and lines default to a seed derived from their name. A new
  take is a new seed, never a repeat of a recorded one.

## The manifest makes reruns safe

`<dir>/manifest.json` records each design, saved voice, line and take: the
request (description, text, model, settings, seed), the output format, file,
duration, request ID and credits (the `character-cost` header, or the change in
the account's count when the API sends none). Each step is written as
`pending` before its request is sent, so a run cut off mid-request leaves a mark
instead of a silent gap. A recorded step is skipped; a changed request under the
same name is refused, so use a new name. A timed-out step becomes `unknown` and blocks
itself: look for it with `history --since <sent_at>` (match the time, model and
credits), and rerun with `--retry-unknown` only when it is not there. The
manifest holds no key; keep it with the project's audio sources.

## Commands

```bash
python scripts/eleven_voice.py check --dir voices
python scripts/eleven_voice.py design town_guard --dir voices --description "..." --text "..." --max-credits 400
python scripts/eleven_voice.py save town_guard --candidate b --dir voices
python scripts/eleven_voice.py speak town_guard_alarm --dir voices --voice town_guard_b --text "[shouting] Stop right there!" --takes 3 --max-credits 200
python scripts/tighten.py voices/takes/town_guard_alarm_*.wav --out voices/tight
python ../sound-effects-workflow/scripts/audio_tool.py process voices/tight/*.wav --out voices/masters --trim --mono --normalize momentary --target -20 --rate 48000
python scripts/eleven_voice.py page --dir voices --processed voices/masters
python scripts/eleven_voice.py delete --trials --dir voices
```

Every command has `--help` and prints a JSON report; paid commands accept
`--dry-run`, which prints the request without any network call. `--voice-id`
speaks with any voice in the account, such as a premade one for a quick test.
[API notes](references/api-notes.md) records the endpoints, models, formats,
tags and prices checked against ElevenLabs' documentation, and when.

Example request: "Give the town guard a voice with an alarm shout and a relieved
sigh." Expected result: a description and preview text approved by the owner,
one design call with three candidates on a listening page, the chosen voice
saved, three takes of each line tightened, mastered and checked, a page with
originals and masters, verdicts in the manifest, trial voices deleted and the
credits used reported.

Dependencies: Python 3.9+; the client uses only the standard library;
`tighten.py` needs numpy ([requirements](scripts/requirements.txt)); editing
needs [sound-effects-workflow](../sound-effects-workflow/SKILL.md)'s
`audio_tool.py`; an ElevenLabs account with API access, paid by the owner.
