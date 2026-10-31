# Autotile layouts

## Six-tile blob template

`tiles.py blob` composes all 47 blob tiles from a template two tiles wide and
three tiles tall (64x96 px for 32 px tiles). Each output tile is built from
four quarters taken from the template, so draw only these pieces:

Positions are in quarters (half a tile), four columns by six rows:

```text
          col 0     col 1     col 2     col 3
  row 0 | single tile       | inner corners     |
  row 1 | (preview only)    | (one per quarter) |
  row 2 | outer TL  top     top       outer TR  |
  row 3 | left      fill    fill      right     |
  row 4 | left      fill    fill      right     |
  row 5 | outer BL  bottom  bottom    outer BR  |
```

Rules for drawing the template:

- The lower 2x2 block must read as one patch of terrain with a complete
  border. Its four middle quarters are the plain fill and must tile with each
  other.
- The top-right tile shows fill with the four inner corners cut in: its
  top-left quarter is the inner corner used at a tile's top-left, and so on.
- Edges must join the fill seamlessly where they meet it, and corners must join
  the edges, because quarters from different template spots end up side by side.
- `--tile` must be even. Use the contract tile size.

## Atlas order and bits

Neighbour bits: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128. A corner
bit only counts when both sides next to it are set, which leaves 47 masks. The
atlas is 8 columns by 6 rows, in ascending order of that reduced mask: index 0
is the isolated tile, index 46 is fully surrounded, and slot 47 stays empty.
Tile `i` sits at column `i % 8`, row `i // 8`.

`--json map.json` lists, for every tile, `index`, `atlas` (column and row),
`mask`, `neighbors`, `godot_peering` (Godot peering-bit names) and `quarters`
(which template piece filled each quarter).

## Godot TileSet

`--godot-tres tileset.tres --texture-res res://path/atlas.png --terrain-name
Grass` writes a TileSet with one terrain set in Match Corners and Sides mode,
one terrain, and every tile's terrain and peering bits. Copy the atlas to the
`res://` path given, then add the TileSet to a `TileMapLayer` and paint with the
terrain tool or `set_cells_terrain_connect`. Add collision, occlusion,
navigation and custom data layers afterwards in the editor, or by script.

Several terrains in one TileSet: compose each atlas separately, then merge the
terrains in the editor (each becomes a terrain in the same terrain set).

## 16-tile corner sets

Generators often produce Wang corner sets: 16 tiles, each defined by which of
its four corners (NW, NE, SW, SE) belong to the upper terrain. Use Godot's Match
Corners mode and set the four corner peering bits from the generator's
metadata. They suit two-terrain transitions, such as grass over dirt, with
fewer tiles than a blob set but less control over sides.
