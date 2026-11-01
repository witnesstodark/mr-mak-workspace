---
name: 2d-asset-prep
description: Batch-prepare 2D game images by removing backgrounds, trimming with shared bounds, placing art on fixed canvases with pivots, cleaning alpha, packing and slicing sprite sheets, building previews and generating normal maps for 2D lighting.
---

# 2D asset preparation

These are the mechanical steps between an approved image and an engine import.
Read the art contract for canvas sizes, pivots and alpha rules. Work on copies:
every command writes to a new `--out` folder and leaves masters untouched.
Keep a short log of commands and settings beside the outputs so a batch can be
rebuilt. A script that ran cleanly has not approved anything; open the results.

## Remove backgrounds

- **Flat background** (the usual case for generated sprites): ask the generator
  for one flat colour that the subject does not use, such as magenta or pure
  green. `cutout.py key` removes it. The default flood mode removes only
  background connected to the image border, so matching colours inside the
  subject survive; `--mode global` also clears enclosed gaps, such as between
  an arm and the body. Use `--defringe` for colour halos and `--hard-alpha` for
  pixel art.
- **Complex background**: use a matting model through the project's provider
  ([fal-ai-generation](../fal-ai-generation/SKILL.md) or a pixel-art provider's
  background removal), then inspect edges at full size. Hair, fur, smoke and
  glass need manual review.

## Trim, align and place

Animation frames, layers and directional views must keep their relative
position. `cutout.py trim --shared` trims every input (all the same size) to
the union of their bounds and derives one pivot from it.
`--canvas WxH --pivot bottom-center --anchor X,Y` places content on the contract
canvas so its pivot lands on the anchor, such as the feet contact point.
`bottom-center` is the content's bottom row at its centre column (the left one
of two when the width is even); the default anchor is `((W-1)//2, H-1)`, which
centres even-width content exactly. Content that would be clipped is an error
unless `--allow-clip` is given. `trim.json` records each file's source bounds,
offset and pivot. Trim props and icons individually only when they do not
animate.

## Alpha

Pixel art uses hard alpha: `cutout.py alpha` binarises it and reports how many
semi-transparent pixels there were. Painted UI art and soft shadows may keep
soft alpha; enable the engine's alpha-border fix on import so edges do not
pick up dark fringes.

## Sheets and atlases

`sheet.py pack` builds a sheet in uniform cells with a JSON description of
every frame; `sheet.py slice` cuts an existing sheet back into frames. Padding
and `--extrude` (repeating edge pixels into the padding) prevent bleeding when
textures are filtered, mipmapped or packed tightly. Pixel art drawn with nearest
filtering at integer scale rarely needs extrusion, but tile atlases sampled at
fractional camera positions can. Sheets are exports: rebuild them from masters.

## Previews for review

- `sheet.py preview`: animated GIF at an integer scale and the real frame rate;
  `--onion` overlays the previous frame to show spacing, and `--background
  none` keeps transparency.
- `sheet.py contact`: frames side by side with an optional pixel grid and
  labels.
- `cutout.py` and `sheet.py` reports name the files they wrote; link those in
  the review, not a description of them.

## Normal maps for 2D lighting

`normals.py` derives a starting normal map from a sprite: `bevel` rounds the
silhouette from its distance to the transparent edge, `luminance` treats
brightness as height, and `both` combines them. Output is `<name>_n.png`, the
same size as the sprite, with a flat normal where the sprite is transparent.
The default `--green up` (OpenGL convention) is what Godot 4 2D lights expect;
use `--green down` for engines that want DirectX-style maps. Generated normals
give volume to simple shapes; faces, cloth folds and hard edges look better
hand-painted or corrected. Check the result under a moving light in the engine.

Example request: "Cut out these 24 generated walk frames and put them on the
character canvas." Expected result: transparent frames with hard alpha on the
contract canvas, aligned by shared bounds with the feet on the anchor, a
`trim.json`, a GIF preview at game zoom and a list of frames that need fixes.

Dependencies: Python 3.9+ with Pillow and numpy ([requirements](scripts/requirements.txt)).
