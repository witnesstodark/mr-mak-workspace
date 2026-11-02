---
name: blender-sprite-render
description: Render a modelled, rigged and animated 3D character or prop in Blender into 2D sprites for a realistic, painted, toon or pixel look, with an orthographic camera at the game's view angle and pixel scale, 4 or 8 directions, clip frames and event frames, one fixed light, fixed pivots, normal, depth and shadow passes, packed sheets and a JSON manifest, headlessly.
---

# Blender sprite render

Use this when 2D sprites should come from a 3D model: realistic or painted
characters, many directions and frames that must stay consistent, or a toon
or pixel look that is easier to light once than to draw again for every
facing. Read the project's art contract first (see
[2d-production-routing](../2d-production-routing/SKILL.md)): view, tile size,
canvas, pivot, directions, timing and light direction. The render must match
the approved hand-made or generated art beside it, not just look good alone.

## Prepare the subject

Model the character or prop, or take a supplied one, then rig and animate it
with [blender-game-animation](../blender-game-animation/SKILL.md); that skill
covers skeletons, weights, contacts and loops. For sprites, also:

- Put the origin, or the root the subject hangs from, on the ground contact
  point (between the feet), at the world origin, with the front facing -Y
  (Blender's front view). Apply scale, or outlines come out uneven.
- Lay each clip out on the scene timeline as a frame range (one action per
  range, or baked), with the loop's first and last poses meeting cleanly.
- Keep the model's proportions and silhouette readable at the sprite size:
  heads, hands and held items are often enlarged for small sprites.

## Configure the render

`scripts/render_sprites.py` reads a JSON config; every key and its default
is in `scripts/sprite_config.py`, and
[example-config.json](references/example-config.json) shows a full one.

- **Camera:** orthographic, at the view's elevation: `side` 0 deg,
  `three-quarter` 35 deg, `top-down` 90 deg, `isometric` 30 deg turned 45 deg (2:1
  diamonds). `pixels_per_unit` fixes the scale for every asset, so a 1 m
  character in a 32 px-per-metre game is 32 px across. In a tilted view,
  heights shrink by cos(elevation) and ground depth by sin(elevation); the
  manifest records both so tile sizes can be checked against the grid.
- **Pivot:** `anchor` is the canvas pixel the ground point lands on, the same
  in every frame. The canvas stays constant; never trim frames one by one.
- **Directions:** 1, 2, 4, 8 or a list such as `["down", "down_right", "right",
  "up_right", "up"]`. The subject turns on a pivot; camera and light stay
  still. Render one side and mirror in the engine only where the design
  allows (see [sprite-animation-workflow](../sprite-animation-workflow/SKILL.md)).
- **Clips:** `start`, `end` and `step` choose the frames, `fps` the playback
  speed, `loop`, and `events` (such as `"contact": [25, 37]`) name scene
  frames that must be among those sampled; the manifest gives them as frame
  indices for gameplay code.
- **Light:** one sun fixed to the camera (`azimuth` 0 shines from the
  camera's side, -90 from screen left, 180 from behind) plus even ambient,
  for the whole set. The file's own lights are switched off unless
  `use_scene_lights` is true.

## Looks and passes

- `realistic`: the materials as they are, in EEVEE or Cycles.
- `toon`: flat bands from Shader to RGB and a constant ramp, times each
  material's base colour, with an outline: `hull` (an inverted shell,
  `outline_px` thick at the sprite scale) or `freestyle`. EEVEE only.
- `pixel`: toon shading rendered at game size with no anti-aliasing. Then
  lock the palette and clean stray pixels with
  [pixel-art-workflow](../pixel-art-workflow/SKILL.md); a render is a strong
  start, not finished pixel art.

Passes beside the colour: `normal` (camera-space, green up, ready for a
Godot `CanvasTexture`; see [godot-2d-integration](../godot-2d-integration/SKILL.md)),
`depth` (near is white) and `shadow` (the sun's shadow alone on a Cycles
shadow catcher, at `shadow_opacity`, as its own sprite to draw under the
character, so it can be dropped or tinted per level).

## Commands

```bash
blender -b hero.blend --factory-startup --python-exit-code 1 -P scripts/render_sprites.py -- --config hero_sprites.json --out build/hero
python scripts/pack_sprites.py build/hero --previews --scale 4
blender -b --factory-startup --python-exit-code 1 -P scripts/render_sprites.py -- --demo --out build/demo
```

Frames go to `<out>/frames/<clip>/<direction>/<clip>_<direction>_<NN>.png`,
with `_n`, `_d` and `_s` for the normal, depth and shadow passes, and
`<out>/sprites.json` records camera, scale, pivot, the pivot's projected
pixel (it must equal the anchor), directions, clips, events, files and
warnings: frames that are empty or touch the canvas edge. `--dry-run` reports
the plan and render count without rendering; `--only` renders chosen clips.
The .blend is never saved. `pack_sprites.py` packs one sheet per clip and
pass with [2d-asset-prep](../2d-asset-prep/SKILL.md)'s `sheet.py` (a row per
direction, a column per frame, the same cell fields) and adds clip, fps,
loop, events and pivot to each sheet's JSON; `--previews` adds a GIF per clip
and direction and a contact sheet per clip. `--demo` builds a primitive
figure with idle and walk clips to try settings without a model.

## Review

Look at every contact sheet and GIF, then judge the sprites at game scale
beside approved art, in a game capture or a faithful mock on real ground:
size against the tile, light direction against the environment, outline
weight, palette, readability of the silhouette at 1x, and a pivot that does
not jitter. Settle style on one direction and clip before rendering the set.
Fix warnings before review. Only the owner's verdict accepts a set; keep the
.blend, the config and the frames as sources and the sheets as exports.
[Blender notes](references/blender-notes.md) lists the 5.x API details, timings
and fixes by symptom.

Example request: "Render our knight in four directions with idle, walk and
attack for the 3/4 view, toon style." Expected result: a config from the art
contract, the knight's clips on the timeline, a test render of one direction
approved at game scale, then the full set with normal and shadow passes,
sheets with JSON giving fps, pivot and the attack's hit frame, GIF previews,
and no warnings.

Dependencies: Blender 5.x (tested on 5.2.3 LTS; written to fall back to
4.2's API names but not tested there); Python 3.9+ with Pillow and numpy for packing
([requirements](scripts/requirements.txt)); [2d-asset-prep](../2d-asset-prep/SKILL.md)'s
`scripts/sheet.py` beside this skill.
