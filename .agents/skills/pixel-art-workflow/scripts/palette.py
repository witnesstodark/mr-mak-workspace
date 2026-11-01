#!/usr/bin/env python3
"""Check, extract, swap and preview pixel-art palettes.

Subcommands:
  check    validate images against a palette (exit 1 on violations)
  extract  list an image's colours by frequency
  swap     recolour index-to-index between two equal-length palettes
  swatch   render palettes as a labelled swatch image
  strip    write a 1-pixel-tall palette texture for shaders
  convert  rewrite a palette as .hex or .gpl

Palettes may be .hex (one RRGGBB per line), .gpl (GIMP) or .png (unique opaque
colours in reading order). Each command prints a JSON report to stdout.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------- helpers

def load_rgba(path):
    with Image.open(path) as image:
        return np.array(image.convert('RGBA'), dtype=np.uint8)


def hex_color(rgb):
    return '#%02x%02x%02x' % tuple(int(c) for c in rgb[:3])


def parse_hex(text):
    value = text.strip().lstrip('#')
    if len(value) != 6:
        raise SystemExit('expected #rrggbb, got %r' % text)
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def load_palette(path):
    """Read a .hex, .gpl or .png palette as a list of (r, g, b) tuples."""
    path = Path(path)
    suffix = path.suffix.lower()
    colours = []
    if suffix == '.png':
        seen = set()
        for r, g, b, a in load_rgba(path).reshape(-1, 4).tolist():
            if a > 0 and (r, g, b) not in seen:
                seen.add((r, g, b))
                colours.append((r, g, b))
    elif suffix == '.gpl':
        for line in path.read_text(encoding='utf-8').splitlines():
            parts = line.split()
            if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
                colours.append(tuple(int(p) for p in parts[:3]))
    else:
        for line in path.read_text(encoding='utf-8').splitlines():
            value = line.strip()
            if not value or value.startswith(';') or value.startswith('//'):
                continue
            colours.append(parse_hex(value.split()[0]))
    if not colours:
        raise SystemExit('palette %s has no colours' % path)
    return colours


def write_palette(colours, path, name=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == '.gpl':
        lines = ['GIMP Palette', 'Name: %s' % (name or path.stem), 'Columns: 8', '#']
        lines += ['%3d %3d %3d\t%s' % (r, g, b, hex_color((r, g, b))) for r, g, b in colours]
    elif path.suffix.lower() == '.hex':
        lines = [hex_color(c)[1:] for c in colours]
    else:
        raise SystemExit('palette output must end in .hex or .gpl: %s' % path)
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def guard(target, sources):
    for source in sources:
        if Path(target).resolve() == Path(source).resolve():
            raise SystemExit('refusing to overwrite input %s; choose another --out' % source)


def packed(rgb):
    rgb = np.asarray(rgb, np.uint32)
    return (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]


# ---------------------------------------------------------------- check

def isolated_pixels(rgba):
    """Opaque pixels with no 4-neighbour of the same colour (a warning only)."""
    opaque = rgba[:, :, 3] > 0
    key = np.where(opaque, packed(rgba[:, :, :3]).astype(np.int64), -1)
    padded = np.pad(key, 1, constant_values=-2)
    h, w = key.shape
    same = np.zeros(key.shape, bool)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        same |= padded[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] == key
    return int((opaque & ~same).sum())


def check_image(rgba, palette, max_colors=None, allow_semi=False):
    alpha = rgba[:, :, 3]
    opaque = alpha > 0
    keys = packed(rgba[:, :, :3])
    allowed = np.isin(keys, packed(np.array(palette, np.uint8)))
    off = opaque & ~allowed
    ys, xs = np.nonzero(off)
    samples = [[int(x), int(y), hex_color(rgba[y, x])] for y, x in list(zip(ys, xs))[:10]]
    unique = int(len(np.unique(keys[opaque]))) if opaque.any() else 0
    semi = int(((alpha > 0) & (alpha < 255)).sum())
    report = {'colours': unique, 'off_palette': int(off.sum()), 'off_palette_samples': samples,
              'semi_transparent': semi, 'isolated_pixels_warning': isolated_pixels(rgba)}
    failures = []
    if report['off_palette']:
        failures.append('off-palette pixels')
    if semi and not allow_semi:
        failures.append('semi-transparent pixels')
    if max_colors and unique > max_colors:
        failures.append('more than %d colours' % max_colors)
    report['pass'] = not failures
    report['failures'] = failures
    return report


def command_check(args):
    palette = load_palette(args.palette)
    files = []
    for source in args.inputs:
        report = check_image(load_rgba(source), palette, args.max_colors, args.allow_semi)
        report['file'] = str(source)
        files.append(report)
    passed = all(f['pass'] for f in files)
    print(json.dumps({'command': 'check', 'palette': str(args.palette), 'palette_size': len(palette),
                      'pass': passed, 'files': files}))
    return 0 if passed else 1


# ---------------------------------------------------------------- extract

def command_extract(args):
    counts = {}
    for source in args.inputs:
        rgba = load_rgba(source)
        pixels = rgba[:, :, :3][rgba[:, :, 3] > 0]
        if not len(pixels):
            continue
        colours, number = np.unique(pixels, axis=0, return_counts=True)
        for colour, n in zip(map(tuple, colours.tolist()), number.tolist()):
            counts[colour] = counts.get(colour, 0) + n
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    if args.max:
        ordered = ordered[:args.max]
    guard(args.out, args.inputs)
    write_palette([c for c, _ in ordered], args.out)
    print(json.dumps({'command': 'extract', 'output': str(args.out), 'colours': len(ordered),
                      'total_unique': len(counts),
                      'top': [[hex_color(c), n] for c, n in ordered[:16]]}))
    return 0


# ---------------------------------------------------------------- swap

def command_swap(args):
    if args.map:
        mapping = {parse_hex(k): parse_hex(v)
                   for k, v in json.loads(Path(args.map).read_text(encoding='utf-8')).items()}
    else:
        if not (args.source_palette and args.target_palette):
            raise SystemExit('give --from and --to palettes, or --map')
        source, target = load_palette(args.source_palette), load_palette(args.target_palette)
        if len(source) != len(target):
            raise SystemExit('--from has %d colours and --to has %d; they must match' % (len(source), len(target)))
        if len(set(source)) != len(source):
            raise SystemExit('--from contains duplicate colours, so the mapping is ambiguous')
        mapping = dict(zip(source, target))
    rgba = load_rgba(args.input)
    result = rgba.copy()
    keys = packed(rgba[:, :, :3])
    opaque = rgba[:, :, 3] > 0
    changes = {}
    for before, after in mapping.items():
        hit = opaque & (keys == packed(np.array(before, np.uint8)))
        count = int(hit.sum())
        if count:
            result[hit, :3] = after
            changes[hex_color(before)] = [hex_color(after), count]
    guard(args.out, [args.input])
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result, 'RGBA').save(args.out)
    print(json.dumps({'command': 'swap', 'input': str(args.input), 'output': str(args.out),
                      'mapped_pixels': sum(v[1] for v in changes.values()),
                      'unmapped_opaque_pixels': int(opaque.sum()) - sum(v[1] for v in changes.values()),
                      'changes': changes}))
    return 0


# ---------------------------------------------------------------- swatch / strip / convert

def command_swatch(args):
    palettes = [(Path(p).stem, load_palette(p)) for p in args.palettes]
    font = ImageFont.load_default()
    cell = max(args.scale, 46) if args.labels else args.scale
    label_h = 12 if args.labels else 0
    header_h, margin = 14, 6
    columns = args.columns
    blocks = []
    for name, colours in palettes:
        rows = -(-len(colours) // columns)
        blocks.append((name, colours, rows))
    width = margin * 2 + columns * cell
    height = margin + sum(header_h + rows * (cell + label_h) + margin for _, _, rows in blocks)
    image = Image.new('RGB', (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    y = margin
    for name, colours, rows in blocks:
        draw.text((margin, y), '%s (%d)' % (name, len(colours)), fill=(0, 0, 0), font=font)
        y += header_h
        for index, colour in enumerate(colours):
            x = margin + (index % columns) * cell
            top = y + (index // columns) * (cell + label_h)
            draw.rectangle([x, top, x + cell - 1, top + cell - 1], fill=tuple(colour))
            if args.labels:
                draw.text((x + 1, top + cell), hex_color(colour), fill=(0, 0, 0), font=font)
        y += rows * (cell + label_h) + margin
    guard(args.out, args.palettes)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out)
    print(json.dumps({'command': 'swatch', 'output': str(args.out), 'size': [width, height],
                      'palettes': [[name, len(colours)] for name, colours, _ in blocks]}))
    return 0


def command_strip(args):
    colours = load_palette(args.palette)
    guard(args.out, [args.palette])
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.array([colours], np.uint8), 'RGB').save(args.out)
    print(json.dumps({'command': 'strip', 'output': str(args.out), 'size': [len(colours), 1]}))
    return 0


def command_convert(args):
    colours = load_palette(args.palette)
    guard(args.out, [args.palette])
    write_palette(colours, args.out, args.name)
    print(json.dumps({'command': 'convert', 'output': str(args.out), 'colours': len(colours)}))
    return 0


# ---------------------------------------------------------------- cli

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    check = sub.add_parser('check', help='validate images against a palette')
    check.add_argument('inputs', nargs='+', metavar='IN')
    check.add_argument('--palette', required=True)
    check.add_argument('--max-colors', type=int, help='fail above this many colours per image')
    check.add_argument('--allow-semi', action='store_true', help='do not fail on semi-transparent pixels')
    check.set_defaults(func=command_check)

    extract = sub.add_parser('extract', help='colours by frequency')
    extract.add_argument('inputs', nargs='+', metavar='IN')
    extract.add_argument('--out', required=True, help='.hex or .gpl')
    extract.add_argument('--max', type=int, help='keep the N most frequent colours')
    extract.set_defaults(func=command_extract)

    swap = sub.add_parser('swap', help='recolour between palettes')
    swap.add_argument('input', metavar='IN')
    swap.add_argument('--from', dest='source_palette', help='palette the image uses')
    swap.add_argument('--to', dest='target_palette', help='replacement palette of the same length')
    swap.add_argument('--map', help='JSON object {"#from": "#to"} instead of --from/--to')
    swap.add_argument('--out', required=True)
    swap.set_defaults(func=command_swap)

    swatch = sub.add_parser('swatch', help='render palettes')
    swatch.add_argument('palettes', nargs='+', metavar='PAL')
    swatch.add_argument('--out', required=True)
    swatch.add_argument('--scale', type=int, default=16, help='swatch size in pixels (default 16)')
    swatch.add_argument('--columns', type=int, default=8)
    swatch.add_argument('--labels', action='store_true', help='print hex values under swatches')
    swatch.set_defaults(func=command_swatch)

    strip = sub.add_parser('strip', help='1-pixel-tall palette texture')
    strip.add_argument('palette', metavar='PAL')
    strip.add_argument('--out', required=True)
    strip.set_defaults(func=command_strip)

    convert = sub.add_parser('convert', help='rewrite as .hex or .gpl')
    convert.add_argument('palette', metavar='PAL')
    convert.add_argument('--out', required=True)
    convert.add_argument('--name', help='palette name for .gpl')
    convert.set_defaults(func=command_convert)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
