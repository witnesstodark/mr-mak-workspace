#!/usr/bin/env python3
"""Author pixel art as text grids and render them to PNG sheets.

Subcommands:
  check   parse a .pxt file and report sprites, colours and errors
  render  write 1x sheets, JSON manifests and optional previews per sprite
  import  turn a PNG (or a sheet with --cell) into an editable .pxt file

A .pxt file holds palettes and sprites. One character is one pixel:

  palette base
    . transparent
    k #1a1c2c
    y #ffcd75
  palette silver          # later palettes override base keys: variants
    y #c0c8d0

  sprite coin 8x8
    pivot 4,7
    anim spin 0-1,1 fps=8
    frame
      ..kkkk..
      (8 rows of 8 keys)
    frame blink from=0 flip=h shift=0,1

After a `frame` line, the next H non-blank lines are the grid; a frame with
`from=` copies another frame (index or name) instead. Lines starting with `#`
outside grids are comments. Outputs never overwrite inputs and each command
prints a JSON report to stdout; check exits with 1 on errors.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Characters offered by `import`, most readable first.
KEY_POOL = ('kwrgbyocmpvtlnsdefhijquxzKWRGBYOCMPVTLNSDEFHIJQUXZ'
            '0123456789@$%&*+=-~^:;!?<>/\\|()[]{}')


class PxtError(Exception):
    pass


# ---------------------------------------------------------------- helpers

def parse_colour(text, where):
    value = text.strip().lower()
    if value in ('transparent', 'none'):
        return (0, 0, 0, 0)
    match = re.fullmatch(r'#?([0-9a-f]{6})([0-9a-f]{2})?', value)
    if not match:
        raise PxtError('%s: expected #rrggbb, #rrggbbaa or transparent, got %r' % (where, text))
    rgb = tuple(int(match.group(1)[i:i + 2], 16) for i in (0, 2, 4))
    alpha = int(match.group(2), 16) if match.group(2) else 255
    return rgb + (alpha,)


def colour_text(rgba):
    if rgba[3] == 0:
        return 'transparent'
    text = '#%02x%02x%02x' % rgba[:3]
    return text if rgba[3] == 255 else text + '%02x' % rgba[3]


def parse_size(text):
    match = re.fullmatch(r'(\d+)x(\d+)', text.lower())
    if not match or int(match.group(1)) <= 0 or int(match.group(2)) <= 0:
        raise argparse.ArgumentTypeError('expected WxH, got %r' % text)
    return int(match.group(1)), int(match.group(2))


def parse_options(tokens, where):
    """['from=0', 'flip=h', 'loop'] -> ({'from': '0', 'flip': 'h'}, ['loop'])."""
    options, flags = {}, []
    for token in tokens:
        if '=' in token:
            key, value = token.split('=', 1)
            options[key] = value
        else:
            flags.append(token)
    return options, flags


def guard(out_dir, sources):
    out = Path(out_dir).resolve()
    for source in sources:
        if Path(source).resolve().parent == out:
            raise SystemExit('--out must not be the folder that holds the input: %s' % out)


# ---------------------------------------------------------------- parsing

def parse_text(text, origin='<text>'):
    """Parse .pxt text into {'palettes': {...}, 'sprites': [...]}."""
    lines = text.splitlines()
    palettes = {}
    palette_order = []
    sprites = []
    current_palette = None
    sprite = None
    index = 0

    def where(number):
        return '%s:%d' % (origin, number)

    while index < len(lines):
        number = index + 1
        raw = lines[index]
        index += 1
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        tokens = line.split()
        head = tokens[0]

        if head == 'palette':
            if len(tokens) < 2:
                raise PxtError('%s: palette needs a name' % where(number))
            name = tokens[1]
            if name in palettes:
                raise PxtError('%s: palette %r defined twice' % (where(number), name))
            palettes[name] = {}
            palette_order.append(name)
            current_palette, sprite = name, None
            continue

        if head == 'sprite':
            if len(tokens) != 3:
                raise PxtError('%s: expected "sprite NAME WxH"' % where(number))
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', tokens[1]):
                raise PxtError('%s: sprite names use letters, digits, _ . -' % where(number))
            if any(s['name'] == tokens[1] for s in sprites):
                raise PxtError('%s: sprite %r defined twice' % (where(number), tokens[1]))
            try:
                width, height = parse_size(tokens[2])
            except argparse.ArgumentTypeError as error:
                raise PxtError('%s: %s' % (where(number), error))
            sprite = {'name': tokens[1], 'size': [width, height], 'pivot': None,
                      'anims': [], 'frames': [], 'line': number}
            sprites.append(sprite)
            current_palette = None
            continue

        if current_palette is not None:
            # Key lines: "<char> <colour>". The comment rule applies before this,
            # so '#' cannot be a key.
            if len(tokens) < 2 or len(head) != 1:
                raise PxtError('%s: expected "<one character> <colour>"' % where(number))
            if head in palettes[current_palette]:
                raise PxtError('%s: key %r repeated in palette %r' % (where(number), head, current_palette))
            palettes[current_palette][head] = parse_colour(tokens[1], where(number))
            continue

        if sprite is None:
            raise PxtError('%s: %r outside a palette or sprite' % (where(number), head))

        if head == 'pivot':
            match = re.fullmatch(r'(-?\d+),(-?\d+)', ''.join(tokens[1:]))
            if not match:
                raise PxtError('%s: expected "pivot X,Y"' % where(number))
            sprite['pivot'] = [int(match.group(1)), int(match.group(2))]
        elif head == 'anim':
            if len(tokens) < 3:
                raise PxtError('%s: expected "anim NAME FRAMES [fps=N] [once]"' % where(number))
            options, flags = parse_options(tokens[3:], where(number))
            try:
                fps = float(options.get('fps', 8))
            except ValueError:
                raise PxtError('%s: fps must be a number' % where(number))
            sprite['anims'].append({'name': tokens[1], 'spec': tokens[2], 'fps': fps,
                                    'loop': 'once' not in flags, 'line': number})
        elif head == 'frame':
            rest = tokens[1:]
            name = rest.pop(0) if rest and '=' not in rest[0] else None
            options, flags = parse_options(rest, where(number))
            unknown = set(options) - {'from', 'flip', 'shift'}
            if unknown or flags:
                raise PxtError('%s: unknown frame options: %s' % (where(number), ' '.join(sorted(unknown) + flags)))
            frame = {'name': name, 'options': options, 'line': number, 'rows': None}
            if 'from' not in options:
                rows = []
                while len(rows) < sprite['size'][1]:
                    if index >= len(lines):
                        raise PxtError('%s: frame needs %d rows, found %d' % (where(number), sprite['size'][1], len(rows)))
                    row = lines[index].strip()
                    index += 1
                    if row:
                        rows.append((index, row))
                frame['rows'] = rows
            sprite['frames'].append(frame)
        else:
            raise PxtError('%s: unknown keyword %r in sprite %r' % (where(number), head, sprite['name']))

    if not palette_order:
        raise PxtError('%s: no palette defined' % origin)
    return {'palettes': palettes, 'palette_order': palette_order, 'sprites': sprites, 'origin': origin}


def resolve_frame_ref(sprite, ref, where):
    if re.fullmatch(r'\d+', ref):
        position = int(ref)
        if position >= len(sprite['frames']):
            raise PxtError('%s: frame %d does not exist' % (where, position))
        return position
    for position, frame in enumerate(sprite['frames']):
        if frame['name'] == ref:
            return position
    raise PxtError('%s: no frame named %r' % (where, ref))


def build(doc):
    """Turn parsed grids into key arrays; report colour use. Raises PxtError."""
    base = doc['palettes'][doc['palette_order'][0]]
    for name in doc['palette_order'][1:]:
        extra = set(doc['palettes'][name]) - set(base)
        if extra:
            raise PxtError('palette %r adds keys missing from %r: %s' % (name, doc['palette_order'][0], ''.join(sorted(extra))))
    origin = doc['origin']
    built = []
    for sprite in doc['sprites']:
        width, height = sprite['size']
        if not sprite['frames']:
            raise PxtError('%s:%d: sprite %r has no frames' % (origin, sprite['line'], sprite['name']))
        grids = []
        for position, frame in enumerate(sprite['frames']):
            where = '%s:%d' % (origin, frame['line'])
            if frame['rows'] is not None:
                grid = []
                for number, row in frame['rows']:
                    if len(row) != width:
                        raise PxtError('%s:%d: row has %d pixels, sprite %r is %d wide'
                                       % (origin, number, len(row), sprite['name'], width))
                    missing = sorted(set(row) - set(base))
                    if missing:
                        raise PxtError('%s:%d: keys not in palette: %s' % (origin, number, ''.join(missing)))
                    grid.append(list(row))
                grid = np.array(grid, dtype='<U1')
            else:
                source = resolve_frame_ref(sprite, frame['options']['from'], where)
                if source >= position:
                    raise PxtError('%s: from= must name an earlier frame' % where)
                grid = grids[source].copy()
                flip = frame['options'].get('flip', '')
                if set(flip) - set('hv'):
                    raise PxtError('%s: flip must be h, v or hv' % where)
                if 'h' in flip:
                    grid = grid[:, ::-1]
                if 'v' in flip:
                    grid = grid[::-1, :]
                if 'shift' in frame['options']:
                    match = re.fullmatch(r'(-?\d+),(-?\d+)', frame['options']['shift'])
                    if not match:
                        raise PxtError('%s: expected shift=DX,DY' % where)
                    grid = shift_grid(grid, int(match.group(1)), int(match.group(2)), transparent_key(base))
            grids.append(grid)
        anims = []
        for anim in sprite['anims']:
            where = '%s:%d' % (origin, anim['line'])
            frames = []
            for part in anim['spec'].split(','):
                match = re.fullmatch(r'(\d+)-(\d+)', part)
                if match:
                    first, last = int(match.group(1)), int(match.group(2))
                    step = 1 if last >= first else -1
                    refs = [str(i) for i in range(first, last + step, step)]
                else:
                    refs = [part]
                frames += [resolve_frame_ref(sprite, ref, where) for ref in refs]
            anims.append({'name': anim['name'], 'frames': frames, 'fps': anim['fps'], 'loop': anim['loop']})
        names = [f['name'] or '%s_%d' % (sprite['name'], i) for i, f in enumerate(sprite['frames'])]
        built.append({'name': sprite['name'], 'size': [width, height], 'pivot': sprite['pivot'],
                      'grids': grids, 'frame_names': names, 'anims': anims})
    return built


def transparent_key(palette):
    for key, colour in palette.items():
        if colour[3] == 0:
            return key
    return None


def shift_grid(grid, dx, dy, fill):
    if fill is None:
        raise PxtError('shift= needs a transparent key in the base palette')
    height, width = grid.shape
    out = np.full_like(grid, fill)
    src = grid[max(0, -dy):height - max(0, dy), max(0, -dx):width - max(0, dx)]
    out[max(0, dy):max(0, dy) + src.shape[0], max(0, dx):max(0, dx) + src.shape[1]] = src
    return out


def load(path):
    path = Path(path)
    doc = parse_text(path.read_text(encoding='utf-8'), origin=path.name)
    return doc, build(doc)


def palette_for(doc, variant):
    palette = dict(doc['palettes'][doc['palette_order'][0]])
    if variant != doc['palette_order'][0]:
        palette.update(doc['palettes'][variant])
    return palette


def grid_to_rgba(grid, palette):
    lookup = {key: np.array(colour, np.uint8) for key, colour in palette.items()}
    out = np.zeros(grid.shape + (4,), np.uint8)
    for key, colour in lookup.items():
        out[grid == key] = colour
    return out


# ---------------------------------------------------------------- commands

def command_check(args):
    try:
        doc, sprites = load(args.input)
    except PxtError as error:
        print(json.dumps({'command': 'check', 'ok': False, 'error': str(error)}))
        return 1
    base = doc['palettes'][doc['palette_order'][0]]
    used = set()
    for sprite in sprites:
        for grid in sprite['grids']:
            used |= set(np.unique(grid).tolist())
    report = {'command': 'check', 'ok': True,
              'palettes': doc['palette_order'],
              'sprites': [{'name': s['name'], 'size': s['size'], 'frames': len(s['grids']),
                           'anims': [a['name'] for a in s['anims']]} for s in sprites],
              'colours_used': len(used - {transparent_key(base)}),
              'unused_keys': ''.join(sorted(set(base) - used))}
    print(json.dumps(report))
    return 0


def command_render(args):
    guard(args.out, [args.input])
    try:
        doc, sprites = load(args.input)
    except PxtError as error:
        raise SystemExit(str(error))
    variants = doc['palette_order'] if args.variants == 'all' else args.variants.split(',')
    for variant in variants:
        if variant not in doc['palettes']:
            raise SystemExit('unknown palette %r; have %s' % (variant, ', '.join(doc['palette_order'])))
    wanted = set(args.sprite or [])
    if wanted - {s['name'] for s in sprites}:
        raise SystemExit('unknown sprite(s): %s' % ', '.join(sorted(wanted - {s['name'] for s in sprites})))
    background = parse_colour(args.preview_bg, '--preview-bg') if args.preview_bg != 'none' else None
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for sprite in sprites:
        if wanted and sprite['name'] not in wanted:
            continue
        width, height = sprite['size']
        count = len(sprite['grids'])
        columns = min(args.columns or count, count)
        rows = -(-count // columns)
        stride_x, stride_y = width + 2 * args.padding, height + 2 * args.padding
        used = set().union(*(np.unique(grid).tolist() for grid in sprite['grids']))
        for variant in variants:
            # A variant that recolours none of this sprite's keys would duplicate the base.
            if variant != doc['palette_order'][0] and not used & set(doc['palettes'][variant]):
                continue
            palette = palette_for(doc, variant)
            stem = sprite['name'] if variant == doc['palette_order'][0] else '%s.%s' % (sprite['name'], variant)
            frames = [grid_to_rgba(grid, palette) for grid in sprite['grids']]
            sheet = np.zeros((rows * stride_y, columns * stride_x, 4), np.uint8)
            entries = []
            for index, frame in enumerate(frames):
                x = (index % columns) * stride_x + args.padding
                y = (index // columns) * stride_y + args.padding
                sheet[y:y + height, x:x + width] = frame
                entries.append({'index': index, 'name': sprite['frame_names'][index],
                                'x': x, 'y': y, 'w': width, 'h': height})
            sheet_path = out / (stem + '.png')
            Image.fromarray(sheet, 'RGBA').save(sheet_path)
            files = [sheet_path.name]
            manifest = {'command': 'render', 'source': Path(args.input).name, 'sprite': sprite['name'],
                        'palette': variant, 'image': sheet_path.name,
                        'size': [sheet.shape[1], sheet.shape[0]], 'cell': [width, height],
                        'columns': columns, 'rows': rows, 'padding': args.padding,
                        'pivot': sprite['pivot'], 'frames': entries,
                        'anims': {a['name']: {'frames': a['frames'], 'fps': a['fps'], 'loop': a['loop']}
                                  for a in sprite['anims']}}
            manifest_path = out / (stem + '.json')
            manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
            files.append(manifest_path.name)
            if args.frames:
                for index, frame in enumerate(frames):
                    path = out / ('%s_%02d.png' % (stem, index))
                    Image.fromarray(frame, 'RGBA').save(path)
                    files.append(path.name)
            if args.scale > 1:
                files += write_previews(out, stem, sheet, frames, sprite['anims'], args.scale, background)
            written.append({'sprite': sprite['name'], 'palette': variant, 'frames': count, 'files': files})
    print(json.dumps({'command': 'render', 'out': str(out), 'written': written}))
    return 0


def upscale(pixels, scale, background):
    image = Image.fromarray(pixels, 'RGBA')
    image = image.resize((image.width * scale, image.height * scale), Image.NEAREST)
    if background is None:
        return image
    ground = Image.new('RGBA', image.size, background[:3] + (255,))
    ground.alpha_composite(image)
    return ground


def write_previews(out, stem, sheet, frames, anims, scale, background):
    files = []
    path = out / ('%s.x%d.png' % (stem, scale))
    upscale(sheet, scale, background).save(path)
    files.append(path.name)
    for anim in anims:
        images = [upscale(frames[i], scale, background or (128, 128, 128, 255)).convert('RGB') for i in anim['frames']]
        path = out / ('%s.%s.gif' % (stem, anim['name']))
        duration = max(20, int(round(1000 / anim['fps'])))
        images[0].save(path, save_all=True, append_images=images[1:], duration=duration,
                       loop=0 if anim['loop'] else 1, disposal=1)
        files.append(path.name)
    return files


def command_import(args):
    guard(Path(args.out).parent, [args.input])
    with Image.open(args.input) as image:
        pixels = np.array(image.convert('RGBA'))
    pixels[pixels[:, :, 3] == 0] = 0
    height, width = pixels.shape[:2]
    cell_w, cell_h = args.cell or (width, height)
    if width % cell_w or height % cell_h:
        raise SystemExit('image %dx%d is not a whole number of %dx%d cells' % (width, height, cell_w, cell_h))
    colours = [tuple(int(v) for v in c) for c in np.unique(pixels.reshape(-1, 4), axis=0)]
    colours.sort(key=lambda c: (c[3] != 0, sum(c[:3])))
    keys = {}
    if args.keys_from:
        try:
            known = parse_text(Path(args.keys_from).read_text(encoding='utf-8'), Path(args.keys_from).name)
        except PxtError as error:
            raise SystemExit(str(error))
        for key, colour in known['palettes'][known['palette_order'][0]].items():
            if colour in colours and colour not in keys:
                keys[colour] = key
    pool = [k for k in KEY_POOL if k not in keys.values()]
    for colour in colours:
        if colour in keys:
            continue
        if colour[3] == 0 and '.' not in keys.values():
            keys[colour] = '.'
            continue
        if not pool:
            raise SystemExit('%d colours exceed the %d available keys; reduce the palette first'
                             % (len(colours), len(KEY_POOL) + 1))
        keys[colour] = pool.pop(0)
    name = args.name or re.sub(r'[^A-Za-z0-9_.-]', '_', Path(args.input).stem)
    lines = ['# imported from %s' % Path(args.input).name, 'palette base']
    lines += ['  %s %s' % (keys[c], colour_text(c)) for c in colours]
    lines += ['', 'sprite %s %dx%d' % (name, cell_w, cell_h)]
    frames = 0
    for top in range(0, height, cell_h):
        for left in range(0, width, cell_w):
            cell = pixels[top:top + cell_h, left:left + cell_w]
            if args.skip_empty and not cell[:, :, 3].any():
                continue
            lines.append('  frame')
            for row in cell:
                lines.append('    ' + ''.join(keys[tuple(int(v) for v in p)] for p in row))
            frames += 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'command': 'import', 'out': str(out), 'sprite': name,
                      'cell': [cell_w, cell_h], 'frames': frames, 'colours': len(colours)}))
    return 0


# ---------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    check = sub.add_parser('check', help='parse a .pxt file and report errors')
    check.add_argument('input')
    check.set_defaults(func=command_check)

    render = sub.add_parser('render', help='render sprites to sheets and manifests')
    render.add_argument('input')
    render.add_argument('--out', required=True, help='output folder')
    render.add_argument('--sprite', action='append', help='render only this sprite (repeatable)')
    render.add_argument('--variants', default='all', help='"all" or comma-separated palette names')
    render.add_argument('--columns', type=int, default=0, help='sheet columns (default: one row)')
    render.add_argument('--padding', type=int, default=0, help='transparent pixels around each cell')
    render.add_argument('--frames', action='store_true', help='also write one PNG per frame')
    render.add_argument('--scale', type=int, default=1, help='integer preview scale; >1 writes previews and GIFs')
    render.add_argument('--preview-bg', default='#808080', help='preview background colour or none')
    render.set_defaults(func=command_render)

    imp = sub.add_parser('import', help='turn a PNG or sheet into a .pxt file')
    imp.add_argument('input')
    imp.add_argument('--out', required=True, help='output .pxt path')
    imp.add_argument('--cell', type=parse_size, help='frame size WxH when the input is a sheet')
    imp.add_argument('--name', help='sprite name (default: file stem)')
    imp.add_argument('--keys-from', help='reuse palette keys from an existing .pxt file')
    imp.add_argument('--skip-empty', action='store_true', help='drop fully transparent cells')
    imp.set_defaults(func=command_import)

    args = parser.parse_args(argv)
    if getattr(args, 'scale', 1) < 1 or getattr(args, 'padding', 0) < 0 or getattr(args, 'columns', 0) < 0:
        raise SystemExit('--scale must be >= 1; --padding and --columns must not be negative')
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
