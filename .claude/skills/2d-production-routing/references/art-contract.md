# 2D art contract template

Copy this into the project folder (for example `projects/<game>/art-contract.md`)
and fill it from the design notes. Write each value once, with its status:
**decided** (by the owner, with a date) or **proposal** (awaiting acceptance).
Every 2D skill reads this file; a value that lives only in a chat is lost.

## 1. View and scale

- Perspective: side view, top-down 3/4 (oblique), isometric or flat top-down.
- Tile size and base resolution, and how many tiles fit on screen.
- Pixel density: one art pixel per base-resolution pixel for every asset.
  No mixed densities, no non-integer scaling of finished art.
- Window scaling: stretch mode, aspect handling, integer or fractional scale.

## 2. Palette

- Master palette file (`.hex`, plus `.gpl` for editors) and its ramps.
- Subsets per biome, realm or faction, and when each applies.
- Colour budget per asset class (for example 16 for a prop, 24 for a character).
- Reserved colours (UI semantics, glitch or debug colours) and where they may
  appear.
- Transparency: hard alpha for sprites and tiles. List the exceptions, such as
  shadows, glows and light textures.

## 3. Shading and line

- Key light direction for baked shading (for example from the top left).
- Shades per material, hue-shift rule, dithering and anti-aliasing policy.
- Outline rule: where outlines appear, their colour (black, darkest ramp shade
  or a dedicated outline colour) and selective outlining on lit edges.

## 4. Canvas sizes and pivots

| Class | Canvas (px) | Pivot | Content size | Notes |
| --- | --- | --- | --- | --- |
| Character | | feet contact point | height range | layers share the canvas |
| Large character / boss | | | | |
| Prop | footprint x tile | base centre | | y-sort at pivot |
| Tile | tile size | | | |
| Item icon | | | | |
| Overhead / status icon | | | | |
| Portrait | | | | |
| Effect | | emission point | | |

## 5. Animation

- Facing directions and mirroring rule; list mirror-unsafe details.
- Clip list with frames, per-frame durations, loop or one-shot and event frames.
- Relationship to movement speed (stride per cycle) and gameplay timing.
- Layer order per direction for modular characters.

## 6. Tiles

- Terrain layout (47-tile blob, 16-tile sides or corners, hand-placed).
- Wall construction (cap, face height, corners, doors) and what walls hide.
- Variants and their weights; transitions between terrains.
- Metadata: collision, light occlusion, navigation, custom data (material,
  flammable, noise and similar).

## 7. Lighting and effects

- Baked versus dynamic light; normal maps for which asset classes.
- Emissive parts, light textures, day or time tinting.
- Effect sizes, palette and frame timing rules.

## 8. UI

- UI scale relative to the world, pixel font or vector font, in-world UI rules.
- Icon sizes and the semantic colours that must stay distinct.

## 9. Files and naming

- Folders for sources, masters and exports; naming pattern
  (for example `<category>/<name>_<clip>_<direction>_<frame>.png`).
- What is committed, what is generated, and the manifest of exports.

## 10. Open questions

List undecided items with the proposed default, so work can continue without
guessing silently.
