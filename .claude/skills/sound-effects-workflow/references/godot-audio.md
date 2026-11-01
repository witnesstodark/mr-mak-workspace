# Godot 4 audio reference

Property names and defaults were read from Godot 4.7.2. Check the class
reference for other versions.

## WAV import parameters

In `<sound>.wav.import` under `[params]`:

| Parameter | Values | Use |
| --- | --- | --- |
| `compress/mode` | `0` PCM, `1` IMA-ADPCM, `2` QOA (default) | QOA is small with good quality; use PCM for a sound with audible artefacts. |
| `edit/loop_mode` | `0` detect from file (default), `1` disabled, `2` forward, `3` ping-pong | Forward for ambience and continuous loops. |
| `edit/loop_begin`, `edit/loop_end` | samples; `-1` end means the end of the file | Set after `audio_tool.py loop`. |
| `edit/trim`, `edit/normalize` | `false` (default) | Keep off: trimming and loudness are decided in the masters. |
| `force/mono` | `false` (default) | Prefer mono masters for positional sounds. |
| `force/max_rate`, `force/max_rate_hz` | `false`, `44100` | Use only to save memory on long files. |

Change the defaults once in the Import dock (Preset > Set as Default) for the
SFX folder, then reimport. Keep `.import` files under version control.

## Variations: AudioStreamRandomizer

```gdscript
var steps := AudioStreamRandomizer.new()
for path in ["res://assets/audio/sfx/foot/sfx_foot_stone_walk_01.wav",
		"res://assets/audio/sfx/foot/sfx_foot_stone_walk_02.wav"]:
	steps.add_stream(-1, load(path), 1.0)
steps.playback_mode = AudioStreamRandomizer.PLAYBACK_RANDOM_NO_REPEATS
steps.random_pitch = 1.08          # pitch varies between 1/1.08 and 1.08
steps.random_volume_offset_db = 1.5
```

Save randomizers as `.tres` resources per event (footstep set, hit set) so
designers can add takes without code. `playback_mode` values:
`PLAYBACK_RANDOM_NO_REPEATS` (default), `PLAYBACK_RANDOM`,
`PLAYBACK_SEQUENTIAL`.

## Positional 2D sound: AudioStreamPlayer2D

| Property | Default | Note |
| --- | --- | --- |
| `max_distance` | `2000.0` (px) | Set from the contract's fade-out distance in tiles x tile size. |
| `attenuation` | `1.0` | Exponent of the distance curve; higher falls off faster. |
| `max_polyphony` | `1` | Raise for sounds that overlap, such as rapid hits. |
| `panning_strength` | `1.0` | Lower it in top-down views so sounds do not jump hard left and right. |
| `bus` | `Master` | Route to the contract's SFX or World buses. |
| `area_mask` | `0` | Lets `Area2D` bus overrides apply to this player. |

An `Area2D` with `audio_bus_override = true` and `audio_bus_name = "World_Cave"`
sends players inside it (matching its layer in their `area_mask`) to that bus;
put the cave reverb on that bus. The listener is the current `Camera2D`; with
several local views, make each view's camera current in its own viewport.

For many short sounds from one place (UI, a crowd), an `AudioStreamPolyphonic`
stream with a `polyphony` count avoids creating a node per sound.

## Buses

Create buses in the Audio panel and save the layout as `default_bus_layout.tres`:
Master with a Limiter, then Music, Ambience, SFX, UI and Voice; World buses fed
by SFX for each space with a Reverb effect; optional effect buses such as a
glitch bus with a Distortion effect in LoFi mode, toggled at runtime with
`AudioServer.set_bus_effect_enabled`. Volume settings in menus set bus volumes,
stored with the player's settings.

## Adaptive layers

`AudioStreamSynchronized` plays up to 32 streams in sync with a volume per
stream (`stream_N/stream`, `stream_N/volume`), suited to calm, suspicious and
combat layers that fade in and out. `AudioStreamInteractive` switches between
named clips with transitions. Both exist in Godot 4.3 and later.

## Multiplayer

Replicate gameplay events, not sounds. Each client plays the sound for an event
it receives (hit confirmed, door opened, noise made) at the event's position.
Footsteps of other players come from their replicated animation, so they stay in
step. A cancelled action sends no event and so plays no impact.

## Verify

1. `<godot> --headless --path <project> --import` finishes without errors.
2. Read the `.import` files of new sounds and confirm compression and loop
   settings.
3. Run the scene, trigger each event, and have the owner listen at gameplay
   distance with representative crowds; record which checks were listening.
