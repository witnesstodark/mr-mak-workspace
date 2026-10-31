---
name: pixel-art-workflow
description: Make grid-true, palette-locked pixel art from generated, painted or hand-drawn sources, design palettes and hue-shifted ramps, and produce recolour variants, with review at game scale.
---

# Pixel art workflow

Read the project's art contract first: pixel density, palette, colour budget,
outline, light direction and canvas sizes. One art pixel is the same size on
screen for every asset. Never scale finished art by a non-integer factor, and do
not mix a 16 px-density prop into a 32 px-density world.

## Choose a generator

Pixel-native generators (for example PixelLab or Retro Diffusion) work on a
true grid at sprite sizes, can constrain output to a palette and offer
directions, animation and tiles. General image models are better for concepts
than for sprites. Use the provider the project selected, read its live tool
schema before each new operation, check the price of a batch, and record the
prompt, settings, seed and job ID with the raw output. Output from any tool
still goes through the steps below.

## From a source to game pixels

Generated "pixel art" is usually a painting of pixel art: uneven pixel sizes,
blurred edges, hundreds of colours and a background. Treat it as a reference
and produce the real asset from it:

1. Cut the subject out with [2d-asset-prep](../2d-asset-prep/SKILL.md) when the
   background is not flat. Ask generators for a flat, unused background colour.
2. Measure the source grid with `pixel_fit.py detect`. Confidence below about
   0.55 usually means the image is already at native resolution or has no
   regular grid; then choose the true size from the contract (for example a
   character that stands 46 px tall on its canvas) and pass `--size WxH`.
3. Run `pixel_fit.py fit` (`--scale auto`, a measured `--scale`, or `--size`)
   with `--palette` set to the contract palette, or the realm subset when one
   applies. The result has hard alpha only.
4. Clean it: continuous outlines, single-pixel lines without doubled corners,
   no orphan pixels or noisy clusters, readable eyes and hands, shading from the
   contract light direction, and no more shades per material than its ramp has.
5. `palette.py check` must pass: no off-palette colours, no semi-transparent
   pixels outside the contract's exceptions, and the colour count within budget.
   Isolated pixels are warnings to inspect, not automatic failures.
6. Review at 1x and at the player's zoom, beside approved assets on real ground.

Downscaling a detailed painting to a small sprite seldom gives good pixel art.
Under about 24 px the downscale is a placement guide; pixels need deliberate
placement. Say so rather than presenting a mushy downscale as finished.

Without a pixel editor, edit the master precisely: set listed pixels from code,
or request a faithful edit of the accepted image from the provider. Never
regenerate a whole approved asset to fix one detail.

## Palettes and ramps

A ramp is one material's shades in order from shadow to highlight. Shift hue
along it: shadows toward cool or purple, highlights toward warm or yellow, with
saturation highest in the middle shades. Keep the darkest shade off pure black
unless the style calls for it. Store the master palette and named subsets as
`.hex` (one colour per line) plus `.gpl` for Aseprite, GIMP and Krita, and keep
ramps in a fixed order so tools can address shades by index.

Show proposed palettes with `palette.py swatch`, and test a palette on a small
scene (ground, wall, prop, character) before adopting it. Changing a palette
after production is expensive; remap with `palette.py swap` only between ramps of
equal length and order, then review every remapped asset.

## Recolours and variants

For factions, teams, realms and elements, give each recolourable part its own
ramp, for example a trim ramp, and use that ramp nowhere else in the sprite,
or a swap will recolour skin and props too. Bake variants with `palette.py swap`,
or swap at runtime with a palette shader (see
[godot-2d-integration](../godot-2d-integration/SKILL.md)); `palette.py strip`
writes the 1 px-high palette textures a shader reads. Check every variant for
contrast on its typical ground.

## Review checklist

- Density and size match the contract table; the pivot lands where it should.
- Silhouette reads as a solid fill at 1x.
- Outline rule and light direction are followed; shading follows form, not the
  outline (no "pillow shading").
- No jaggies in curves, banding, orphan pixels or accidental dithering.
- `palette.py check` passes; colour count is within budget.
- It sits correctly beside approved assets at game zoom.

Example request: "Turn the approved goblin concept into an in-game sprite."
Expected result: a 1x master PNG on the contract canvas, palette-checked, with an
upscaled preview, the commands used and a note of what was hand-corrected.

Dependencies: Python 3.9+ with Pillow and numpy ([requirements](scripts/requirements.txt)).
A pixel editor (Aseprite, LibreSprite, Pixelorama) helps but is optional.
