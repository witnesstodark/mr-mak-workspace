---
name: pixel-text-sprites
description: Author pixel art directly as text grids in .pxt files, one character per pixel with named palettes, frames, mirrored or shifted copies and animations, then render 1x sprite sheets, JSON manifests, recolour variants and scaled previews headlessly.
---

# Pixel text sprites

Use this when the agent itself places the pixels: small sprites, items, icons,
tiles and simple animations written as text, with no editor or generator. It
complements [pixel-art-workflow](../pixel-art-workflow/SKILL.md), which turns
generated or painted sources into game pixels; both share the same palette,
density and review rules. Read the project's art contract first (see
[2d-production-routing](../2d-production-routing/SKILL.md)) for density, palette,
outline, light direction and canvas sizes.

## The .pxt format

One file holds palettes and sprites. [example.pxt](references/example.pxt) is a
complete working file.

```
palette base              # the first palette defines every key
  . transparent
  k #1a1c2c
  y #f7c95a
  w #fff6d3cc             # #rrggbbaa for deliberate semi-transparency
palette silver            # later palettes override keys: recolour variants
  y #c0c8d0

sprite coin 8x8
  pivot 4,7
  anim spin 0-3 fps=10    # frames by index, range or name; add "once" for no loop
  frame face              # optional name; the next 8 non-blank lines are the grid
    ..kkkk..
    ...
  frame back from=1 flip=h          # copy an earlier frame, mirrored (h, v or hv)
  frame bob from=face shift=0,1     # copy and move; the gap fills with transparency
```

- A key is any single non-space character except `#`. Choose keys that read
  well: `.` transparent, `k` outline, letters for materials, and capitals or
  digits for lighter and darker shades of the same material (`g G d`).
- Lines starting with `#` are comments; trailing `# ...` works on keyword lines,
  not inside grids.
- Every row must be exactly the sprite's width, and only use base palette keys.
  `check` reports the file and line of any mistake.
- Variant palettes may only override keys that exist in the base palette.
  `render` skips a variant for any sprite that uses none of its keys.

## Commands

The tool is `scripts/pxt.py`. Each command has `--help`, never changes its
input, and prints a JSON report.

```bash
python scripts/pxt.py check art/sprites.pxt
python scripts/pxt.py render art/sprites.pxt --out build/sprites --scale 8
python scripts/pxt.py import old_sheet.png --cell 16x16 --out art/old.pxt --skip-empty
```

`render` writes `<sprite>.png` (a 1x sheet, one row unless `--columns`) and
`<sprite>.json` (cells, frame names, pivot, animations with fps and loop) for
each sprite, plus `<sprite>.<variant>.png/json` for each palette variant. Add
`--scale N` for an upscaled `<sprite>.xN.png` and one GIF per animation, `--frames`
for one PNG per frame, and `--padding` for engines that bleed at cell edges.
Treat the `.pxt` file as the master and everything in `--out` as a rebuildable
export; never hand-edit the PNGs.

`import` converts an existing PNG or sheet into a `.pxt` file so it can be
edited as text. Pass `--keys-from` with an existing `.pxt` file to reuse its keys
for colours that match.

## Drawing method

1. Fix the canvas size, pivot and palette from the contract before drawing. Put
   the palette in the file with one key per contract colour, ordered as ramps
   (shadow to highlight).
2. Block in the silhouette with one fill key and the outline, render at
   `--scale 8` or more, and look at the preview. A silhouette that does not read
   as a solid shape will not be fixed by shading.
3. Shade from the contract light direction with the material ramps, add
   highlights last, then clean: single-pixel lines without doubled corners, no
   orphan pixels, symmetric where the design is symmetric.
4. Animate by changing as few pixels as possible. Use `from=` with `flip` or
   `shift` for mirrored directions, bobs and holds, and write out a full grid
   only for frames that really change shape. Keep the pivot pixel steady unless
   the motion requires it to move.
5. Run `check`, render, and view every preview image and GIF before calling it
   done. Run `pixel-art-workflow`'s `palette.py check` on the 1x sheets against the
   contract palette.
6. Review at 1x and at game zoom beside approved assets, as the
   [pixel-art-workflow checklist](../pixel-art-workflow/SKILL.md#review-checklist)
   describes.

Text grids stay practical up to about 48 x 48 pixels per frame. For larger art,
split it into parts or tiles, or start from a generated source with
`pixel-art-workflow`. Keep variants to recolours with one ramp per recolourable
part; use separate sprites for changes of shape.

## Handing off to an engine

The manifest uses the same cell fields (`x`, `y`, `w`, `h`) as
[2d-asset-prep](../2d-asset-prep/SKILL.md)'s `sheet.py pack`, so other tools
and engine import scripts can read it. To combine sprites into one atlas,
render with `--frames` and pack the frame PNGs with `sheet.py`. For Godot
imports, SpriteFrames and palette shaders, see
[godot-2d-integration](../godot-2d-integration/SKILL.md).

Example request: "Make a 16x16 health potion with a 4-frame shimmer." Expected
result: a `.pxt` master in the project's art folder, a 1x sheet with its manifest,
an 8x preview and GIF that were viewed, a passing palette check, and a note of
the palette keys used.

Dependencies: Python 3.9+ with Pillow and numpy ([requirements](scripts/requirements.txt)).
