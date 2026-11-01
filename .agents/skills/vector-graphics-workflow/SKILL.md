---
name: vector-graphics-workflow
description: Author, optimise and rasterise SVG graphics for games, including icons, logos, menu shapes, cursors and map symbols, with exact export sizes, engine-matched rendering and pixel-art-safe conversion.
---

# Vector graphics workflow

Decide first whether vector art fits. SVG suits interface elements drawn at
window resolution, logos and title treatments, store and press layouts, map
symbols, cursors and icon masters that export at several sizes. It does not
replace in-world sprites in a pixel-art game: those need deliberate pixels at
the art density. A vector icon can still be the master that a small pixel icon
is drawn from.

## Author SVG as code

- Set the `viewBox` on the export grid, such as `0 0 16 16`, `0 0 24 24` or
  `0 0 32 32`, and place geometry on whole units. A 1-unit stroke centred on a
  whole coordinate straddles two pixels; offset it by 0.5 or prefer filled
  shapes.
- Keep shared tokens for stroke width, corner radius and optical padding so a
  set reads as one family. Compare icons side by side for equal visual weight,
  not equal bounding boxes.
- Use colours from the art contract and keep semantic colours (danger, health,
  friend or foe) consistent with the UI.
- Avoid filters, blurs, masks with soft edges, embedded raster images and live
  text in game assets: renderers differ and fonts may be missing. Convert final
  text to paths and keep the editable source beside the export.
- One asset per file with a stable name and meaningful IDs for parts that code
  or animation will address.

## Export

Godot imports SVG through its own renderer (ThorVG) at an import scale. For UI,
use an integer scale or export exactly at display size. `svg_render.gd` renders
an SVG with the same engine renderer so previews match the import. It needs no
Godot project; pass the full path of this skill's
[`scripts/svg_render.gd`](scripts/svg_render.gd):

```text
<godot> --headless --script <skill>/scripts/svg_render.gd -- in.svg out.png --scale 2
<godot> --headless --script <skill>/scripts/svg_render.gd -- in.svg out.png --size 32x32
```

`--size` fits the SVG inside the box and keeps its aspect ratio.

For pixel art, rasterise at the target size, then run `pixel_fit.py quantize`
from [pixel-art-workflow](../pixel-art-workflow/SKILL.md) with the contract
palette and hard alpha, and clean the pixels by hand. Small icons (16 px and
under) almost always need manual correction of stems, diagonals and counters.

## Optimise and review

Remove editor metadata, hidden layers and unused definitions, but keep the
`viewBox`, IDs used by code and the editable source. Do not let an optimiser
merge paths that are animated or recoloured separately. Review every export
size on light and dark backgrounds and in the real UI: silhouette at the
smallest size, pixel alignment of straight edges, equal optical weight and
clear differences between similar icons.

Example request: "Make the eight menu icons as SVG and export them for the
pause menu." Expected result: SVG sources on a shared grid, PNG exports at the
display sizes rendered by the engine's renderer, a contact sheet on light and
dark, and notes on any icon that needed a pixel-level fix.

Dependencies: the project's Godot executable for engine-matched rendering, and
Python with Pillow and numpy for the pixel conversion step.
