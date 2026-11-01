---
name: godot-2d-integration
description: Bring 2D art into a Godot 4 project with pixel-safe import settings, SpriteFrames and AnimationPlayer clips, TileSet terrains and physics or occlusion layers, 2D lights with normal maps, palette shaders, y-sorting and pixel-perfect scaling, verified headlessly and in a run.
---

# Godot 2D integration

Inspect before changing anything: `project.godot` (renderer, stretch mode,
aspect, scale mode, default texture filter, 2D snapping), the folders for art,
the scenes and scripts that draw placeholders, and whether the project is under
version control. Recommend committing before a bulk import. Changes to project
settings that alter how the whole game looks are the owner's decision: propose
them with the trade-off instead of switching them silently.

Read [the reference](references/godot-2d-reference.md) for settings, import
parameters, node setups and the palette shader.

## Pixel-safe defaults

For pixel art, the default canvas texture filter is Nearest and imports are
lossless without mipmaps. The stretch mode decides how pixels reach the screen:
`viewport` renders at the base resolution and scales the result, keeping a true
pixel grid; `canvas_items` renders at window resolution, which keeps text and
sub-pixel motion smooth but can misalign pixels at fractional scales. Integer
scaling avoids uneven pixels at the cost of borders on some displays. Record
the choice in the art contract.

Run `import_audit.py <project>` to list textures whose import settings are not
pixel-safe: lossy or Basis compression, mipmaps, a size limit or a fractional SVG
scale fail the audit; a disabled alpha-border fix is a warning. It also reports
the project-level values above as warnings, which never fail the run. Addons are
skipped unless `--include-addons` is given.

## Sprites and animation

Set each sprite's offset so the node origin is the contract pivot, usually the
feet; y-sorting and positioning then work in gameplay units. Use `SpriteFrames`
with `AnimatedSprite2D` for simple looping clips. Use a `Sprite2D` with
`hframes` and `vframes` driven by an `AnimationPlayer` when gameplay events
(footsteps, release, hit) must live in the clip as method-call tracks. Mirror
the side view with `flip_h` only where the contract allows it. Layered
characters are sibling sprites playing the same frame index; keep their order
per facing direction in code or the scene, not baked into textures.

## Tiles

Build the `TileSet` from the atlas with the contract tile size. Terrain sets
use Match Corners and Sides for 47-tile blob sets and Match Sides or Match
Corners for 16-tile sets. `tiles.py blob --godot-tres` from
[tileset-workflow](../tileset-workflow/SKILL.md) writes the terrain bits for a
composed blob atlas. Add physics layers for collision, occlusion layers for
light occluders, navigation layers and custom data layers (material, flammable,
noise) that gameplay reads. Use one `TileMapLayer` per role (ground, walls,
decor) and enable y-sorting where actors move behind tiles.

## Lighting and colour

A `CanvasTexture` pairs the diffuse texture with a normal map (and optional
specular) so `PointLight2D` and `DirectionalLight2D` shade sprites. Add
`LightOccluder2D` or tile occlusion polygons for shadows, and `CanvasModulate`
for time-of-day tint. Measure light counts and shadow cost on the target
renderer, especially the Compatibility renderer. When gameplay depends on light,
compute it from the same light data in code; never read rendered pixels.

For faction or realm recolours, use the palette shader from the reference with
1 px-high palette strips imported with Nearest filtering, or bake variants.

## Verify

1. Run a headless import: `<godot> --headless --path <project> --import`. It
   must finish without errors for the new files.
2. Run `import_audit.py` again and fix reported textures.
3. Run the scene that uses the assets and capture it at the base resolution and
   at a common window size. Follow [gameplay-visual-review](../gameplay-visual-review/SKILL.md)
   for evidence and acceptance.

Keep `.import` and `.uid` files under version control with their textures. Do
not hand-edit them while the editor has the project open.

Example request: "Import the bandit sprites and the cobblestone tileset and
use them in the test room." Expected result: pixel-safe imports, a SpriteFrames
or AnimationPlayer setup with the pivot at the feet, a TileSet with collision
and terrain bits, a headless import log, an audit report and a capture of the
room in a run.

Dependencies: the project's Godot 4 executable and the art contract.
