---
name: tileset-workflow
description: Build 2D tilesets, including terrain autotiles, top-down 3/4 walls, variants, grid props and destructible states, with collision, occlusion and navigation metadata and seam and in-map review.
---

# Tileset workflow

Read the art contract (tile size, view, palette, wall construction) and the
level code: how maps are built, which layers exist, what blocks movement, sight,
light and sound. List the set before drawing: terrains, transitions, wall
pieces, props, interactive and destructible states, and the metadata each tile
carries. Draw one small room with all of it first and review it with characters
at the base resolution before producing the rest of a biome.

## Terrains and autotiles

A terrain that meets other terrains or empty space needs edge, corner and
inner-corner tiles. Choose the layout per terrain:

- **47-tile blob** (corners and sides): smooth organic edges for grass, water,
  pits and paths. Draw a six-tile quarter template and compose all 47 tiles with
  `tiles.py blob`; it can also write a Godot TileSet with the terrain bits set.
- **16-tile sides or corners**: simpler sets, raised platforms and fences.
- **Hand-placed**: one-off features that never autotile.

The template, atlas order and Godot setup are in
[the layout reference](references/autotile-layouts.md).
For a transition between two terrains, decide which one owns the edge (usually
the raised, wetter or more detailed one) and draw its edge over the other's base.
Avoid a transition tile for every pair; let most terrains meet a shared base.

## Seamless repeats and variety

A fill tile must repeat without visible seams or a grid of identical marks.
`tiles.py seams` compares opposite edges; `tiles.py preview` repeats a tile 3x3
for review. Break repetition with two to four weighted variants, sparse decor
tiles and scattered props rather than adding detail to the base tile. Keep the
fill calm: busy ground fights characters and lighting for attention.

## Walls in a 3/4 view

A wall shows its top (cap) and its front face. The face hides whatever stands
behind it, so face height is a gameplay decision as well as an art one. Specify
cap tiles that autotile around rooms, face tiles for straight runs, outer and
inner corners, door and window openings, and the end caps where a wall stops.
Draw the face on the tile row south of the cap. Characters walking behind a
wall must sort behind it, and the game may need to fade or cut away tall faces
that hide players.

## Props and destructible states

Props sit on the grid with a footprint in tiles and a pivot at the base centre
for y-sorting. Collision covers the footprint, not the whole sprite. Tall props
overlap the row above; check them beside walls. For destructible objects, draw
every state on the same footprint and pivot (intact, damaged, broken, rubble),
and record how collision, light occlusion and navigation change per state. Add
the debris flipbook through
[sprite-animation-workflow](../sprite-animation-workflow/SKILL.md).

## Metadata

Record per tile: collision shape, light occluder shape, navigation (walkable or
not), and custom data the systems read, such as material, flammable, noise
level or breakability. Keep it in the engine's tileset resource, not in tile
names. Gameplay must read these values; never sample pixel colours for logic.

## Review

Assemble a mock map at the base resolution with characters, props and lighting.
Check seams, repetition, transitions, wall sorting, readability of walkable
versus blocked tiles and the contrast of characters on every ground. Pack
atlases with [2d-asset-prep](../2d-asset-prep/SKILL.md) `sheet.py pack`; keep
the template and individual masters as sources.

Example request: "Make the Goblin Warrens floor, walls and a breakable crate."
Expected result: a template and composed blob atlas for the floor, wall cap and
face pieces, crate states on one footprint, the tileset resource with metadata
and a mock-room capture with a character for review.

Dependencies: Python 3.9+ with Pillow and numpy ([requirements](scripts/requirements.txt)),
the level code and the art contract.
