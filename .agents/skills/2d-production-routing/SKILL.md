---
name: 2d-production-routing
description: Set up a 2D game's art contract and choose the workflow for pixel art, sprites, animation, tilesets, cutouts, SVG graphics, UI, effects and engine import.
---

# Route 2D production

Start from the project's art contract: one file in the project folder that fixes
the view, grid, pixel density, palette, shading, outline, canvas sizes, pivots,
animation timing and naming. Read it before producing or reviewing any asset.
If there is none, draft one from [the template](references/art-contract.md) and
the game's design notes. Mark every value the owner has not decided as a
proposal, and get the proposals accepted before producing more than a test set.

| Need | Skill |
| --- | --- |
| Style frames, concepts or a faithful edit of an accepted image | `image-reference-workflow` |
| Generate or edit images through a provider | `fal-ai-generation` or `higgsfield-workflow` |
| Pixel-native generation: characters, rotations, animation, tilesets | the project's pixel-art provider over MCP (such as PixelLab or Retro Diffusion), then `pixel-art-workflow` |
| Grid-true, palette-locked pixel art; palettes, ramps and recolours | `pixel-art-workflow` |
| Pixel art written directly as text grids, with frames and recolours, when no generator or editor is used | `pixel-text-sprites` |
| Directions, frames, timing, pivots, layered equipment, flipbook effects | `sprite-animation-workflow` |
| Terrain autotiles, walls, grid props, destructible states, tile metadata | `tileset-workflow` |
| Background removal, trimming, canvases, sheets, previews, normal maps | `2d-asset-prep` |
| Icons, logos, menu shapes and other vector art as SVG | `vector-graphics-workflow` |
| HUD, menus, icon sets and portraits as one system | `game-ui-workflow` |
| Effect meaning, triggers and lifecycle | `game-vfx-workflow` |
| Import settings, SpriteFrames, TileSet, 2D lights and shaders in Godot | `godot-2d-integration` |
| Evidence from the running game | `gameplay-visual-review` |

Read the selected skill before execution. Its presence does not mean a provider,
editor or engine is connected; inspect what is available.

## Prove the style before the batch

For a new art direction or asset family, work in this order: style test,
contract update, one reference asset approved at game scale, then the batch.
Show one character, one terrain patch and one prop together at the base
resolution, in a game capture or a faithful mock. An attractive asset in
isolation can still clash in scale, palette or light direction beside the set.

Review every 2D asset at 1x and at the zoom the player sees, on its real ground
and lighting. Check size against the tile, palette, outline, light direction,
pivot and silhouette next to approved neighbours. Keep generated sources, cleaned
masters, exports and review verdicts apart: a cleaned PNG is a master; a packed
sheet or atlas is an export that a script can rebuild from masters.

## Tools

The helper scripts in these skills need Python 3.9+ with Pillow and numpy.
Each has `--help`, never changes its inputs, writes files only to an explicit
`--out` and prints a JSON report; validation commands exit with 1 when a check
fails.
Find the interpreter the project actually uses (virtual environment, conda or
system install); do not assume `python` on PATH resolves to it. Record the
working command in the project notes so later sessions reuse it. Engine checks
need the project's engine version; record its executable path the same way.

Example request: "We need goblin enemies for the Warrens." Read the contract;
use `image-reference-workflow` for two silhouettes, `pixel-art-workflow` to turn
the chosen one into game pixels, `sprite-animation-workflow` for idle and walk,
then `godot-2d-integration` to import it and check it in a room. Success is an
approved sprite moving in the game, not a generated image.
