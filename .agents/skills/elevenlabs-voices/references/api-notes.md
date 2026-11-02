# ElevenLabs API notes

Checked against ElevenLabs' live documentation on 2026-11-01, and with
read-only calls plus one 37-character text-to-speech request on a Creator-plan
account the same day. Services change: before a batch, run `check` and reread
the pages below for anything the batch depends on.

## Endpoints the script uses

| Step | Request | Notes |
| --- | --- | --- |
| Plan and credits | `GET /v1/user/subscription` | `tier`, `character_count` (credits used), `character_limit`, `next_character_count_reset_unix`, `voice_slots_used`, `voice_limit`. |
| Models | `GET /v1/models` | `model_id`, `can_do_text_to_speech`, `maximum_text_length_per_request`, `model_rates.character_cost_multiplier`. The voice design models are not listed here. |
| Voices | `GET /v2/voices` | `voice_type` (`personal`, `default`, `workspace`, `saved` ...), `search`, `page_size` up to 100, `next_page_token`, `has_more`, `total_count`. |
| Design | `POST /v1/text-to-voice/design?output_format=...` | Body: `voice_description`, `model_id` (`eleven_ttv_v3` or `eleven_multilingual_ttv_v2`, the default), `text` (100 to 1000 characters) or `auto_generate_text`, `seed`, `guidance_scale` (default 5), `loudness` (-1 to 1, default 0.5; 0 is about -24 LUFS), `quality`, `should_enhance`, `reference_audio_base64` and `prompt_strength` (v3 only). Returns `previews` (`audio_base_64`, `generated_voice_id`, `media_type`, `duration_secs`, `language`) and `text`. 409 means a generation is already running: retry. |
| Save | `POST /v1/text-to-voice` | `voice_name`, `voice_description`, `generated_voice_id`, optional `labels`. Returns `voice_id`. Uses a voice slot. |
| Speak | `POST /v1/text-to-speech/{voice_id}?output_format=...` | Body: `text`, `model_id` (default `eleven_multilingual_v2`, so always pass one), `voice_settings` (`stability` 0.5, `similarity_boost` 0.75, `style` 0, `speed` 1, `use_speaker_boost` true by default), `seed` (0 to 4294967295, best-effort determinism), `language_code`, `previous_text`/`next_text`, `apply_text_normalization`, `audio_effects`. Response headers seen live: `character-cost`, `request-id`, `content-type: audio/pcm`. |
| History | `GET /v1/history` | `source=TTS`, `voice_id`, `date_after_unix`, `page_size`. Items carry `request_id`, `model_id`, `date_unix` and the credit change; `text` and `voice_id` may be empty. Audio: `GET /v1/history/{history_item_id}/audio`. |
| Delete | `DELETE /v1/voices/{voice_id}` | Returns `{"status": "ok"}`. |

All requests send the key in the `xi-api-key` header. Regional hosts
(`api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io` and others) can be
selected with `ELEVENLABS_BASE_URL`; the script accepts only `*.elevenlabs.io`
hosts or a local test server, so the key cannot be sent elsewhere.

## Output formats

Both design and speech accept `mp3_22050_32` to `mp3_44100_192`, `pcm_8000`,
`pcm_16000`, `pcm_22050`, `pcm_24000`, `pcm_32000`, `pcm_44100`, `pcm_48000`,
`ulaw_8000`, `alaw_8000` and `opus_48000_32` to `opus_48000_192`. Speech also
accepts `wav_8000` to `wav_48000`. The docs say `mp3_44100_192` needs Creator
or above and 44.1 kHz PCM or WAV needs Pro or above; they say nothing about
48 kHz. On the Creator account checked, `pcm_48000` was accepted for speech.
PCM is signed 16-bit little-endian mono. Speech defaults to
`mp3_44100_128`, so always pass a format.

## Models (2026-11-01)

| Model | Use | Characters per request | Cost multiplier (live) |
| --- | --- | --- | --- |
| `eleven_v4` | Flagship speech, audio tags | 10,000 | 1.0 |
| `eleven_v3` | Expressive speech, audio tags | 5,000 | 1.0 |
| `eleven_v4_turbo`, `eleven_v3_conversational` | Real-time speech | 10,000 / 5,000 | 0.5 |
| `eleven_multilingual_v2` | Older speech model, 29 languages | 10,000 | 1.0 |
| `eleven_flash_v2_5` | Low-latency speech | 40,000 | 0.5 |
| `eleven_ttv_v3`, `eleven_multilingual_ttv_v2` | Voice design | preview text 100 to 1000 | |

## Audio tags and delivery

Eleven v4 and v3 follow audio tags in square brackets; the docs say v4 follows
them more reliably, including deliveries the voice was not trained on. Listed
examples: `[laughs]`, `[laughs harder]`, `[starts laughing]`, `[wheezing]`,
`[whispers]`, `[sighs]`, `[exhales]`, `[sarcastic]`, `[curious]`, `[excited]`,
`[crying]`, `[snorts]`, `[mischievously]`; sound effects `[gunshot]`,
`[applause]`, `[clapping]`, `[explosion]`, `[swallows]`, `[gulps]`; experimental
`[strong X accent]`, `[sings]`, `[woo]`. Other tags such as `[shouting]` or
`[gasps]` often work but are not listed: test them. Describe the quality when a
tag is misread as a sound effect (`[low, gravelly voice]`). Ellipses add pauses,
capitals add emphasis, punctuation sets rhythm. SSML `<break>` tags are not
supported by v4 or v3.

## Prices (2026-11-01)

- Plans, monthly: Free 10,000 credits and 3 custom voices; Starter $6, 30,000
  credits, 10 voices, commercial licence; Creator $22 (first month less),
  121,000 credits, 30 voices; Pro $99, 600,000 credits, 160 voices; Scale $299;
  Business $990. An account's `character_limit` can differ from the pricing
  page (older subscriptions keep their terms); trust `check`.
- Speech: one credit per character at multiplier 1.0, half for 0.5 models. The
  API price list shows $0.08 per 1,000 characters for v4, v3 and Multilingual v2
  and $0.04 for Flash and Turbo. The live 37-character `eleven_v4` request
  reported a `character-cost` of 16, so measure rather than assume.
- Voice design: charged once per call for the preview text, though it returns
  three candidates; saving a candidate costs a voice slot, not credits.

## Sources

- https://elevenlabs.io/docs/api-reference/text-to-voice/design
- https://elevenlabs.io/docs/api-reference/text-to-voice/create
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- https://elevenlabs.io/docs/api-reference/user/subscription/get
- https://elevenlabs.io/docs/api-reference/models/list
- https://elevenlabs.io/docs/api-reference/voices/search
- https://elevenlabs.io/docs/api-reference/voices/delete
- https://elevenlabs.io/docs/api-reference/history/list
- https://elevenlabs.io/docs/models
- https://elevenlabs.io/docs/best-practices/prompting
- https://elevenlabs.io/docs/eleven-creative/voices/voice-design
- https://elevenlabs.io/pricing and https://elevenlabs.io/pricing/api
