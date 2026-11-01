# Godot 4 2D reference

Values apply to Godot 4.3 and later. Check the project's version and the class
reference when a property is missing; names change between minor versions.

## Project settings for pixel art

| Setting | Pixel-art value | Note |
| --- | --- | --- |
| `rendering/textures/canvas_textures/default_texture_filter` | `0` (Nearest) | Per-node overrides still win. |
| `display/window/stretch/mode` | `viewport` or `canvas_items` | See the trade-off in the skill. |
| `display/window/stretch/aspect` | `keep` or `expand` | `expand` shows more world on wider screens. |
| `display/window/stretch/scale_mode` | `integer` or `fractional` | Integer avoids uneven pixels; may add borders. |
| `rendering/2d/snap/snap_2d_transforms_to_pixel` | `true` for strict pixel motion | Can make slow movement step visibly. |
| `rendering/2d/snap/snap_2d_vertices_to_pixel` | usually `false` | Enable only to fix specific seams. |

Camera smoothing with pixel snapping can jitter; snap the camera position in
code or move the camera in whole pixels when that happens.

## Texture import parameters

In each `<texture>.import` file under `[params]`:

| Parameter | Pixel-safe value |
| --- | --- |
| `compress/mode` | `0` (Lossless) |
| `mipmaps/generate` | `false` |
| `process/fix_alpha_border` | `true` |
| `process/size_limit` | `0` |
| `detect_3d/compress_to` | `0` keeps a 2D texture lossless if 3D use is detected |
| `svg/scale` (SVG only) | integer, such as `1.0` or `2.0` |

Set them once as the default preset for 2D pixel textures in the Import dock
(Preset > Set as Default), then reimport existing files.

## Node setups

- **Character**: `CharacterBody2D` > `Sprite2D` (or `AnimatedSprite2D`) with
  `centered = false` and an `offset` of `-pivot`, so the body origin is the
  feet. Layer sprites are siblings with the same offset.
- **Event frames**: `AnimationPlayer` with a value track on `frame` and a
  method-call track for footsteps, releases and hits.
- **Y-sorting**: enable `y_sort_enabled` on the parent of actors and on wall or
  prop `TileMapLayer`s; set tile `y_sort_origin` for tall tiles so actors sort
  by their feet against the tile base.
- **Light**: `Sprite2D.texture` set to a `CanvasTexture` with
  `diffuse_texture`, `normal_texture` and optional `specular_texture`;
  `PointLight2D` with `shadow_enabled`; `LightOccluder2D` on props.

## Palette swap shader

Author recolourable parts with exact palette colours. Make two 1 px-high strips
of equal length: the source ramp and the target ramp (see `palette.py strip`).
Import strips with Lossless compression and no mipmaps.

```glsl
shader_type canvas_item;

uniform sampler2D source_palette : filter_nearest;
uniform sampler2D target_palette : filter_nearest;
uniform int palette_size = 4;
uniform float tolerance = 0.01;

varying vec4 modulate;

void vertex() {
	modulate = COLOR;
}

void fragment() {
	vec4 tex = texture(TEXTURE, UV);
	vec3 mapped = tex.rgb;
	for (int i = 0; i < palette_size; i++) {
		vec2 at = vec2((float(i) + 0.5) / float(palette_size), 0.5);
		if (distance(tex.rgb, texture(source_palette, at).rgb) < tolerance) {
			mapped = texture(target_palette, at).rgb;
			break;
		}
	}
	COLOR = vec4(mapped, tex.a) * modulate;
}
```

Use one `ShaderMaterial` per variant and share it between sprites of that
variant. For many simultaneous variants, consider baking textures instead and
compare draw calls.

## Headless commands

```text
<godot> --headless --path <project> --import
<godot> --headless --path <project> --script res://tools/check.gd
<godot> --headless --script <file.gd> -- <args>
```

`--import` starts the editor, imports changed resources and quits. A script run
with `--script` should extend `SceneTree` and call `quit()` when done.
