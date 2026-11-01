#!/usr/bin/env python3
"""Inspect repeating tiles and build 47-tile blob autotile sets.

Subcommands:
  preview  repeat a tile R x R (optionally tile I of an atlas) to judge seams
  seams    measure wrap-around seams of repeating tiles
  blob     compose a 47-tile blob set from an A2-style quarter template, with a
           JSON map and an optional Godot 4 TileSet resource

Outputs never overwrite inputs; each command prints a JSON report to stdout.

Blob template (A2 style, 2 tiles wide x 3 tiles tall; q = tile / 2):

    +--------+--------+     tile (0,0): isolated preview (not used)
    | single | inner  |     tile (1,0): the four inner corners, each in the
    |        | corners|                 quarter of its own position
    +--------+--------+
    | outer frame of  |     bottom 2x2 tiles: a 2x2 patch of terrain seen
    | a 2x2 patch:    |     alone: outer corners, edges and fill quarters
    | corners, edges, |
    | fill            |
    +--------+--------+

Neighbour bits: N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128. A corner bit only
counts when both adjacent sides are set, which leaves 47 distinct tiles. The
atlas is 8 columns x 6 rows in ascending order of that reduced mask (index 0 =
isolated, index 46 = fully surrounded); slot 47 is empty.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

BITS = {'N': 1, 'NE': 2, 'E': 4, 'SE': 8, 'S': 16, 'SW': 32, 'W': 64, 'NW': 128}
GODOT_BITS = {'N': 'top_side', 'NE': 'top_right_corner', 'E': 'right_side',
              'SE': 'bottom_right_corner', 'S': 'bottom_side', 'SW': 'bottom_left_corner',
              'W': 'left_side', 'NW': 'top_left_corner'}
ORDER = ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')

# Quadrant -> (vertical side, horizontal side, corner, quarter offset in tile,
#              template quarters for outer, horizontal edge, vertical edge, fill, inner).
QUADRANTS = {
    'TL': ('N', 'W', 'NW', (0, 0), {'outer': (0, 2), 'h_edge': (2, 2), 'v_edge': (0, 4), 'fill': (2, 4), 'inner': (2, 0)}),
    'TR': ('N', 'E', 'NE', (1, 0), {'outer': (3, 2), 'h_edge': (1, 2), 'v_edge': (3, 4), 'fill': (1, 4), 'inner': (3, 0)}),
    'BL': ('S', 'W', 'SW', (0, 1), {'outer': (0, 5), 'h_edge': (2, 5), 'v_edge': (0, 3), 'fill': (2, 3), 'inner': (2, 1)}),
    'BR': ('S', 'E', 'SE', (1, 1), {'outer': (3, 5), 'h_edge': (1, 5), 'v_edge': (3, 3), 'fill': (1, 3), 'inner': (3, 1)}),
}


# ---------------------------------------------------------------- helpers

def load_rgba(path):
    with Image.open(path) as image:
        return image.convert('RGBA')


def parse_size(text):
    parts = text.lower().split('x')
    if len(parts) != 2:
        raise argparse.ArgumentTypeError('expected WxH, got %r' % text)
    return int(parts[0]), int(parts[1])


def guard(target, sources):
    for source in sources:
        if Path(target).resolve() == Path(source).resolve():
            raise SystemExit('refusing to overwrite input %s; choose another --out' % source)


def tile_from(image, tile, index):
    if not tile:
        return image
    width, height = tile
    columns = image.width // width
    if columns == 0 or index is None:
        raise SystemExit('--tile needs --index and an atlas at least one tile wide')
    x, y = (index % columns) * width, (index // columns) * height
    if y + height > image.height:
        raise SystemExit('tile index %d is outside the atlas' % index)
    return image.crop((x, y, x + width, y + height))


# ---------------------------------------------------------------- preview / seams

def command_preview(args):
    tile = tile_from(load_rgba(args.input), args.tile, args.index)
    repeat, scale = args.repeat, args.scale
    canvas = Image.new('RGBA', (tile.width * repeat, tile.height * repeat), (0, 0, 0, 0))
    for row in range(repeat):
        for column in range(repeat):
            canvas.paste(tile, (column * tile.width, row * tile.height))
    canvas = canvas.resize((canvas.width * scale, canvas.height * scale), Image.NEAREST)
    if args.grid:
        draw = ImageDraw.Draw(canvas)
        for k in range(1, repeat):
            x, y = k * tile.width * scale, k * tile.height * scale
            draw.line([(x, 0), (x, canvas.height - 1)], fill=(255, 0, 255, 160))
            draw.line([(0, y), (canvas.width - 1, y)], fill=(255, 0, 255, 160))
    guard(args.out, [args.input])
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.out)
    print(json.dumps({'command': 'preview', 'output': str(args.out), 'tile': [tile.width, tile.height],
                      'repeat': repeat, 'scale': scale, 'size': [canvas.width, canvas.height]}))
    return 0


def seam_stats(pixels, threshold):
    """Compare the wrap-around seam with neighbour differences inside the tile.

    ratio = seam mean difference / 90th percentile of the interior line-pair
    mean differences, so a smooth gradient that wraps correctly stays near 1.
    """
    f = pixels.astype(np.float32)

    def axis_stats(first, last, pair_means):
        diff = np.abs(first - last)
        mismatches = int((diff.max(axis=-1) > threshold).sum())
        seam = float(np.sqrt(((first[..., :3] - last[..., :3]) ** 2).sum(axis=-1)).mean())
        typical = float(np.percentile(pair_means, 90)) if len(pair_means) else 0.0
        return {'mismatched_pixels': mismatches, 'seam_mean_diff': round(seam, 2),
                'interior_p90_diff': round(typical, 2),
                'ratio': round(seam / typical, 2) if typical > 0 else (0.0 if seam == 0 else None)}

    columns = np.sqrt((np.diff(f, axis=1)[..., :3] ** 2).sum(axis=-1)).mean(axis=0)
    rows = np.sqrt((np.diff(f, axis=0)[..., :3] ** 2).sum(axis=-1)).mean(axis=1)
    horizontal = axis_stats(f[:, 0], f[:, -1], columns)
    vertical = axis_stats(f[0], f[-1], rows)
    return {'left_right': horizontal, 'top_bottom': vertical}


def command_seams(args):
    results, worst = [], 0.0
    for source in args.inputs:
        image = load_rgba(source)
        tiles = [(None, image)]
        if args.tile:
            width, height = args.tile
            columns, rows = image.width // width, image.height // height
            tiles = [(i, image.crop(((i % columns) * width, (i // columns) * height,
                                     (i % columns + 1) * width, (i // columns + 1) * height)))
                     for i in range(columns * rows)]
        for index, tile in tiles:
            pixels = np.array(tile)
            if pixels[:, :, 3].max() == 0:
                continue
            stats = seam_stats(pixels, args.threshold)
            for axis in stats.values():
                if axis['ratio'] is not None:
                    worst = max(worst, axis['ratio'])
            entry = {'file': str(source), **stats}
            if index is not None:
                entry['index'] = index
            results.append(entry)
    failed = args.strict and worst > args.max_ratio
    print(json.dumps({'command': 'seams', 'threshold': args.threshold, 'worst_ratio': worst,
                      'max_ratio': args.max_ratio, 'pass': not failed, 'tiles': results}))
    return 1 if failed else 0


# ---------------------------------------------------------------- blob

def reduce_mask(mask):
    """Drop corner bits whose two adjacent sides are not both present."""
    for corner, (a, b) in (('NE', ('N', 'E')), ('SE', ('S', 'E')), ('SW', ('S', 'W')), ('NW', ('N', 'W'))):
        if not (mask & BITS[a] and mask & BITS[b]):
            mask &= ~BITS[corner]
    return mask


def blob_masks():
    return sorted({reduce_mask(m) for m in range(256)})


def piece_for(mask, quadrant):
    vertical, horizontal, corner, _, pieces = QUADRANTS[quadrant]
    has_v, has_h = bool(mask & BITS[vertical]), bool(mask & BITS[horizontal])
    if not has_v and not has_h:
        return 'outer'
    if has_v and not has_h:
        return 'v_edge'
    if has_h and not has_v:
        return 'h_edge'
    return 'fill' if mask & BITS[corner] else 'inner'


def compose_blob(template, tile):
    if tile % 2:
        raise SystemExit('--tile must be even so tiles split into quarters')
    if template.size != (2 * tile, 3 * tile):
        raise SystemExit('template must be %dx%d (2 x 3 tiles of %d px), got %dx%d'
                         % (2 * tile, 3 * tile, tile, template.width, template.height))
    quarter = tile // 2
    masks = blob_masks()
    atlas = Image.new('RGBA', (8 * tile, 6 * tile), (0, 0, 0, 0))
    entries = []
    for index, mask in enumerate(masks):
        column, row = index % 8, index // 8
        used = {}
        for name, (_, _, _, (qx, qy), pieces) in QUADRANTS.items():
            kind = piece_for(mask, name)
            sx, sy = pieces[kind]
            piece = template.crop((sx * quarter, sy * quarter, (sx + 1) * quarter, (sy + 1) * quarter))
            atlas.paste(piece, (column * tile + qx * quarter, row * tile + qy * quarter))
            used[name] = kind
        neighbours = [n for n in ORDER if mask & BITS[n]]
        entries.append({'index': index, 'atlas': [column, row], 'mask': mask, 'neighbors': neighbours,
                        'godot_peering': [GODOT_BITS[n] for n in neighbours], 'quarters': used})
    return atlas, entries


def godot_tres(entries, tile, texture_res, terrain_name):
    lines = ['[gd_resource type="TileSet" load_steps=3 format=3]', '',
             '[ext_resource type="Texture2D" path="%s" id="1_atlas"]' % texture_res, '',
             '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_blob"]',
             'texture = ExtResource("1_atlas")',
             'texture_region_size = Vector2i(%d, %d)' % (tile, tile)]
    for entry in entries:
        key = '%d:%d/0' % tuple(entry['atlas'])
        lines.append('%s = 0' % key)
        lines.append('%s/terrain_set = 0' % key)
        lines.append('%s/terrain = 0' % key)
        for bit in entry['godot_peering']:
            lines.append('%s/terrains_peering_bit/%s = 0' % (key, bit))
    lines += ['', '[resource]', 'tile_size = Vector2i(%d, %d)' % (tile, tile),
              'terrain_set_0/mode = 0',
              'terrain_set_0/terrain_0/name = "%s"' % terrain_name.replace('"', ''),
              'terrain_set_0/terrain_0/color = Color(0.36, 0.66, 0.24, 1)',
              'sources/0 = SubResource("TileSetAtlasSource_blob")', '']
    return '\n'.join(lines)


def command_blob(args):
    template = load_rgba(args.template)
    atlas, entries = compose_blob(template, args.tile)
    guard(args.out, [args.template])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(out)
    report = {'command': 'blob', 'output': str(out), 'tiles': len(entries), 'tile': args.tile,
              'columns': 8, 'rows': 6, 'order': 'ascending reduced 8-neighbour mask',
              'bits': BITS}
    if args.json:
        guard(args.json, [args.template])
        Path(args.json).write_text(json.dumps(dict(report, tiles=entries), indent=2) + '\n', encoding='utf-8')
        report['json'] = str(args.json)
    if args.godot_tres:
        if not args.texture_res or not args.texture_res.startswith('res://'):
            raise SystemExit('--godot-tres needs --texture-res res://path/to/atlas.png')
        guard(args.godot_tres, [args.template])
        Path(args.godot_tres).write_text(godot_tres(entries, args.tile, args.texture_res, args.terrain_name),
                                         encoding='utf-8')
        report['godot_tres'] = str(args.godot_tres)
    print(json.dumps(report))
    return 0


# ---------------------------------------------------------------- cli

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    preview = sub.add_parser('preview', help='repeat a tile to inspect seams')
    preview.add_argument('input', metavar='IN')
    preview.add_argument('--out', required=True)
    preview.add_argument('--tile', type=parse_size, help='tile size WxH when IN is an atlas')
    preview.add_argument('--index', type=int, help='tile index in reading order (with --tile)')
    preview.add_argument('--repeat', type=int, default=3)
    preview.add_argument('--scale', type=int, default=2)
    preview.add_argument('--grid', action='store_true', help='mark tile boundaries')
    preview.set_defaults(func=command_preview)

    seams = sub.add_parser('seams', help='measure wrap-around seams')
    seams.add_argument('inputs', nargs='+', metavar='IN')
    seams.add_argument('--tile', type=parse_size, help='check every tile of an atlas')
    seams.add_argument('--threshold', type=float, default=0, help='channel difference allowed per pixel')
    seams.add_argument('--strict', action='store_true', help='exit 1 when a seam ratio exceeds --max-ratio')
    seams.add_argument('--max-ratio', type=float, default=1.5,
                       help='seam difference / interior difference allowed with --strict (default 1.5)')
    seams.set_defaults(func=command_seams)

    blob = sub.add_parser('blob', help='compose a 47-tile blob autotile set')
    blob.add_argument('template', metavar='TEMPLATE')
    blob.add_argument('--tile', type=int, required=True, help='tile size in pixels (even)')
    blob.add_argument('--out', required=True, help='atlas PNG (8 x 6 tiles)')
    blob.add_argument('--json', help='write the tile map with masks and Godot peering bits')
    blob.add_argument('--godot-tres', help='write a Godot 4 TileSet resource')
    blob.add_argument('--texture-res', help='res:// path of the atlas inside the Godot project')
    blob.add_argument('--terrain-name', default='Terrain')
    blob.set_defaults(func=command_blob)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
