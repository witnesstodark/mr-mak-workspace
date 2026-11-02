# Blender notes

Checked headlessly on Blender 5.2.3 LTS (Windows) on 2026-11-02.

## API names this skill depends on

| Need | Blender 5.2 | Earlier versions |
| --- | --- | --- |
| EEVEE engine id | `BLENDER_EEVEE` | `BLENDER_EEVEE_NEXT` in 4.2 to 4.4 (the script falls back to it) |
| Other engines | `CYCLES`, `BLENDER_WORKBENCH` | same |
| Still image output | `image_settings.media_type = 'IMAGE'`, then `file_format = 'PNG'`, `color_mode = 'RGBA'` | no `media_type` before 5.0 |
| Material and world nodes | node trees exist on creation; setting `use_nodes` warns that it goes in 6.0 | `use_nodes = True` needed |
| Compositor | `scene.compositing_node_group` (no `scene.node_tree`) | `scene.node_tree` |
| Actions | layered: `action.slots`, `anim_data.action_slot` | slots from 4.4 |
| Shadow catcher | `object.is_shadow_catcher`, Cycles only | same |
| Per-pass visibility | `object.visible_camera`, `visible_shadow` | same |
| Override material | `view_layer.material_override` | same |
| Toon shading | `ShaderNodeShaderToRGB` (EEVEE only), `ShaderNodeValToRGB` with `CONSTANT` interpolation, `ShaderNodeMix` with `data_type = 'RGBA'` (colour sockets have identifiers `A_Color`, `B_Color`, `Result_Color`) | same since 3.4 |
| Freestyle | `render.use_freestyle`, `line_thickness_mode = 'ABSOLUTE'`, `view_layer.freestyle_settings.linesets` | same |

The script avoids the compositor entirely: data passes are rendered with an
override material written as raw values (view transform `Raw`), so they do
not depend on compositor or render-pass APIs that change between versions.

## Conventions measured in a render

- `ShaderNodeVectorTransform` to `CAMERA` space gives x right, y up and z
  pointing away from the viewer, so the normal pass flips z: a surface facing
  the camera is (128, 128, 255), green is up (Godot's convention).
- With the `Raw` view transform the normal pass decodes to unit-length
  vectors (the head's edge read x = -0.98 with y and z near 0), so values are
  written linearly, without the sRGB curve.
- An orthographic camera's `ortho_scale` spans the larger canvas side, and
  `shift_x`/`shift_y` are fractions of it; the manifest's `pivot_projected`
  confirmed the ground point lands exactly on the anchor in every test.
- Colour passes use the `Standard` view transform: AgX and Filmic change
  saturated colours, which breaks palette matching.

## Timings (72 x 72 canvas, CPU Cycles for shadows)

- EEVEE compiles shaders on its first render (about 16 s the first time on
  the test machine; cached after that). Later frames take a fraction of a second.
- The demo's 8 directions x 2 clips x 12 frames x 4 passes (384 renders)
  took 33 s; colour and normal only, 192 renders, 18 s.

## Fixes by symptom

| Symptom | Cause | Fix |
| --- | --- | --- |
| Outline missing or uneven | Solidify works in local units; unapplied or non-uniform scale | Apply scale; the script divides by the average world scale |
| Outline too heavy at small sizes | 1 px at game size is a large share of a small sprite | `outline_px` 0.6 to 0.8, or no outline and a palette-darkened edge in pixel cleanup |
| Shadow frames warn about the edge | Long shadows from a low or side light | Raise `light.elevation`, enlarge the canvas, or move the anchor |
| A faint dark haze around the shadow | Ambient light occluded by the subject | The script turns ambient off for the shadow pass; check `use_scene_lights` |
| Colour frames touch the edge | Wide poses or held items | Enlarge the canvas or lower `pixels_per_unit` for the whole set, never per clip |
| Toon look fails in Cycles | Shader to RGB is EEVEE only | `engine: eevee` for toon and pixel looks |
| Directions look lit differently | Lights parented to the subject, or scene lights left on | Keep `use_scene_lights` false; the sprite sun is fixed to the camera |
| Pixel look shimmers between frames | Sub-pixel motion at game size | Stronger poses, fewer in-betweens, then clean up with pixel-art-workflow |
