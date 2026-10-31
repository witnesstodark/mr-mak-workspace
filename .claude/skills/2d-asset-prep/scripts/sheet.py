#!/usr/bin/env python3
"""Pack, slice and preview sprite sheets.

Subcommands:
  pack     place frames in uniform cells and write sheet.png + sheet.json
  slice    cut a sheet into numbered frame PNGs
  preview  write an animated GIF at an integer nearest-neighbour scale
  contact  write a contact sheet of frames at an integer scale

Frames sit at the top-left of their cell. Outputs never overwrite inputs and
each command prints a JSON report to stdout.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------- helpers

def load_rgba(path):
    with Image.open(path) as image:
        return image.convert('RGBA')


def parse_size(text):
    parts = text.lower().split('x')
    if len(parts) != 2:
        raise argparse.ArgumentTypeError('expected WxH, got %r' % text)
    width, height = int(parts[0]), int(parts[1])
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError('size must be positive: %r' % text)
    return width, height


def parse_point(text):
    parts = text.split(',')
    if len(parts) != 2:
        raise argparse.ArgumentTypeError('expected X,Y, got %r' % text)
    return int(parts[0]), int(parts[1])


def parse_background(text):
    if text.lower() == 'none':
        return None
    value = text.strip().lstrip('#')
    if len(value) != 6:
        raise argparse.ArgumentTypeError('expected #rrggbb or none, got %r' % text)
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def parse_frames(text, count):
    """'0-3' or '0,2,5-7' -> indices, validated against count."""
    indices = []
    for part in text.split(','):
        part = part.strip()
        if '-' in part:
            start, end = (int(v) for v in part.split('-', 1))
            indices.extend(range(start, end + 1))
        elif part:
            indices.append(int(part))
    bad = [i for i in indices if i < 0 or i >= count]
    if bad:
        raise SystemExit('frame indices out of range 0-%d: %s' % (count - 1, bad))
    return indices


def natural_key(path):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', Path(path).name)]


def guard(target, sources):
    resolved = Path(target).resolve()
    for source in sources:
        if resolved == Path(source).resolve():
            raise SystemExit('refusing to overwrite input %s; choose another --out' % source)


def is_empty(image):
    return image.getchannel('A').getbbox() is None


# ---------------------------------------------------------------- pack

def extrude_cell(sheet, x, y, width, height, amount):
    """Copy the cell's edge pixels outward by `amount` pixels."""
    pixels = np.array(sheet)
    for step in range(1, amount + 1):
        pixels[y:y + height, x - step] = pixels[y:y + height, x]
        pixels[y:y + height, x + width - 1 + step] = pixels[y:y + height, x + width - 1]
    for step in range(1, amount + 1):
        pixels[y - step, x - amount:x + width + amount] = pixels[y, x - amount:x + width + amount]
        pixels[y + height - 1 + step, x - amount:x + width + amount] = \
            pixels[y + height - 1, x - amount:x + width + amount]
    return Image.fromarray(pixels, 'RGBA')


def command_pack(args):
    sources = sorted(args.frames, key=natural_key) if args.order == 'name' else list(args.frames)
    guard(args.out, sources)
    frames = [load_rgba(path) for path in sources]
    if args.cell:
        cell_w, cell_h = args.cell
        large = [str(p) for p, f in zip(sources, frames) if f.width > cell_w or f.height > cell_h]
        if large:
            raise SystemExit('frames larger than --cell %dx%d: %s' % (cell_w, cell_h, ', '.join(large)))
    else:
        cell_w, cell_h = max(f.width for f in frames), max(f.height for f in frames)
    if args.extrude > args.padding:
        raise SystemExit('--extrude must not exceed --padding')
    columns = args.columns or len(frames)
    rows = math.ceil(len(frames) / columns)
    stride_x, stride_y = cell_w + 2 * args.padding, cell_h + 2 * args.padding
    sheet = Image.new('RGBA', (columns * stride_x, rows * stride_y), (0, 0, 0, 0))
    entries = []
    for index, (source, frame) in enumerate(zip(sources, frames)):
        x = (index % columns) * stride_x + args.padding
        y = (index // columns) * stride_y + args.padding
        sheet.paste(frame, (x, y))
        entries.append({'index': index, 'name': Path(source).stem, 'source': str(source),
                        'x': x, 'y': y, 'w': cell_w, 'h': cell_h,
                        'frame_size': [frame.width, frame.height]})
    if args.extrude:
        for entry in entries:
            sheet = extrude_cell(sheet, entry['x'], entry['y'], cell_w, cell_h, args.extrude)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    report = {'command': 'pack', 'image': out.name, 'size': [sheet.width, sheet.height],
              'cell': [cell_w, cell_h], 'columns': columns, 'rows': rows,
              'padding': args.padding, 'extrude': args.extrude, 'frames': entries}
    manifest = out.with_suffix('.json')
    manifest.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(report, manifest=str(manifest), frames=len(entries))))
    return 0


# ---------------------------------------------------------------- slice

def cells(sheet, cell, offset=(0, 0), spacing=(0, 0)):
    """Yield (index, box) for every whole cell in reading order."""
    cell_w, cell_h = cell
    ox, oy = offset
    sx, sy = spacing
    columns = (sheet.width - ox + sx) // (cell_w + sx)
    rows = (sheet.height - oy + sy) // (cell_h + sy)
    for row in range(rows):
        for column in range(columns):
            x, y = ox + column * (cell_w + sx), oy + row * (cell_h + sy)
            yield row * columns + column, (x, y, x + cell_w, y + cell_h)


def command_slice(args):
    sheet = load_rgba(args.sheet)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or Path(args.sheet).stem
    written, skipped = [], 0
    for index, box in cells(sheet, args.cell, args.offset, args.spacing):
        frame = sheet.crop(box)
        if args.skip_empty and is_empty(frame):
            skipped += 1
            continue
        target = out / ('%s_%03d.png' % (prefix, index))
        guard(target, [args.sheet])
        frame.save(target)
        written.append({'index': index, 'box': list(box), 'output': str(target)})
    print(json.dumps({'command': 'slice', 'cell': list(args.cell), 'written': len(written),
                      'skipped_empty': skipped, 'frames': written}))
    return 0


# ---------------------------------------------------------------- preview

def gather_frames(args):
    if args.sheet:
        if not args.cell:
            raise SystemExit('--sheet needs --cell WxH')
        sheet = load_rgba(args.sheet)
        boxes = [box for _, box in cells(sheet, args.cell)]
        chosen = parse_frames(args.frames, len(boxes)) if args.frames else range(len(boxes))
        return [sheet.crop(boxes[i]) for i in chosen], [args.sheet]
    if not args.inputs:
        raise SystemExit('give frame files or --sheet')
    return [load_rgba(path) for path in args.inputs], list(args.inputs)


def uniform(frames):
    width, height = max(f.width for f in frames), max(f.height for f in frames)
    result = []
    for frame in frames:
        canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        canvas.paste(frame, (0, 0))
        result.append(canvas)
    return result


def to_palette_frames(frames, transparent):
    """Map RGBA frames to P frames with one shared palette (exact when <= 255 colours)."""
    arrays = [np.array(f) for f in frames]
    opaque = [a[a[:, :, 3] >= 128][:, :3] for a in arrays]
    stacked = np.concatenate(opaque) if any(len(o) for o in opaque) else np.zeros((1, 3), np.uint8)
    colours = np.unique(stacked, axis=0)
    if len(colours) > 255:
        sample = Image.fromarray(stacked.reshape(-1, 1, 3), 'RGB')
        reference = sample.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        colours = np.array(reference.getpalette()[:255 * 3], np.uint8).reshape(-1, 3)
    palette = colours.tolist()
    reference = colours.astype(np.int32)
    result = []
    for array in arrays:
        rgb = array[:, :, :3].reshape(-1, 3).astype(np.int32)
        unique, inverse = np.unique(rgb, axis=0, return_inverse=True)
        nearest = np.array([int(((reference - colour) ** 2).sum(axis=1).argmin()) for colour in unique],
                           np.uint8)
        indices = nearest[inverse.reshape(-1)].reshape(array.shape[:2])
        if transparent:
            indices[array[:, :, 3] < 128] = 255
        frame = Image.fromarray(indices, 'P')
        flat = [v for c in palette for v in c]
        flat += [0, 0, 0] * (256 - len(palette))
        frame.putpalette(flat)
        result.append(frame)
    return result


def command_preview(args):
    frames, sources = gather_frames(args)
    guard(args.out, sources)
    frames = uniform(frames)
    scale = args.scale
    rendered = []
    for index, frame in enumerate(frames):
        if args.background is not None:
            canvas = Image.new('RGBA', frame.size, args.background + (255,))
            if args.onion and index > 0:
                ghost = np.array(frames[index - 1])
                ghost[:, :, 3] = (ghost[:, :, 3].astype(np.float32) * 0.3).astype(np.uint8)
                canvas = Image.alpha_composite(canvas, Image.fromarray(ghost, 'RGBA'))
            frame = Image.alpha_composite(canvas, frame)
        rendered.append(frame.resize((frame.width * scale, frame.height * scale), Image.NEAREST))
    transparent = args.background is None
    palette_frames = to_palette_frames(rendered, transparent)
    duration = max(int(round(1000.0 / args.fps)), 20)
    options = dict(save_all=True, append_images=palette_frames[1:], duration=duration,
                   loop=0, disposal=2, optimize=False)
    if transparent:
        options['transparency'] = 255
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    palette_frames[0].save(out, **options)
    print(json.dumps({'command': 'preview', 'output': str(out), 'frames': len(frames),
                      'fps': args.fps, 'frame_ms': duration, 'scale': scale,
                      'size': [rendered[0].width, rendered[0].height],
                      'onion': bool(args.onion and not transparent)}))
    return 0


# ---------------------------------------------------------------- contact

def command_contact(args):
    guard(args.out, args.inputs)
    frames = [load_rgba(path) for path in args.inputs]
    scale, margin = args.scale, 8
    columns = args.columns or min(len(frames), 8)
    rows = math.ceil(len(frames) / columns)
    cell_w = max(f.width for f in frames) * scale
    cell_h = max(f.height for f in frames) * scale
    label_h = 12 if args.labels else 0
    width = columns * cell_w + (columns + 1) * margin
    height = rows * (cell_h + label_h) + (rows + 1) * margin
    sheet = Image.new('RGBA', (width, height), args.background + (255,))
    font = ImageFont.load_default()
    draw = ImageDraw.Draw(sheet)
    for index, (path, frame) in enumerate(zip(args.inputs, frames)):
        x = margin + (index % columns) * (cell_w + margin)
        y = margin + (index // columns) * (cell_h + label_h + margin)
        big = frame.resize((frame.width * scale, frame.height * scale), Image.NEAREST)
        if args.grid and scale >= 3:
            overlay = Image.new('RGBA', big.size, (0, 0, 0, 0))
            grid = ImageDraw.Draw(overlay)
            for gx in range(0, big.width, scale):
                grid.line([(gx, 0), (gx, big.height - 1)], fill=(0, 0, 0, 48))
            for gy in range(0, big.height, scale):
                grid.line([(0, gy), (big.width - 1, gy)], fill=(0, 0, 0, 48))
            big = Image.alpha_composite(big, overlay)
        sheet.alpha_composite(big, (x, y))
        if args.labels:
            draw.text((x, y + cell_h + 1), Path(path).stem[:max(cell_w // 6, 4)], fill=(0, 0, 0, 255), font=font)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(json.dumps({'command': 'contact', 'output': str(out), 'frames': len(frames),
                      'columns': columns, 'rows': rows, 'scale': scale, 'size': [width, height],
                      'grid': bool(args.grid and scale >= 3)}))
    return 0


# ---------------------------------------------------------------- cli

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    pack = sub.add_parser('pack', help='pack frames into a uniform-cell sheet')
    pack.add_argument('frames', nargs='+', metavar='FRAMES')
    pack.add_argument('--out', required=True, help='sheet PNG path; a .json manifest is written beside it')
    pack.add_argument('--columns', type=int, help='cells per row (default: all frames in one row)')
    pack.add_argument('--cell', type=parse_size, help='cell size WxH (default: largest frame)')
    pack.add_argument('--padding', type=int, default=0, help='transparent pixels around every cell')
    pack.add_argument('--extrude', type=int, default=0, help='repeat cell edge pixels into the padding')
    pack.add_argument('--order', choices=('given', 'name'), default='given', help='frame order (name = natural sort)')
    pack.set_defaults(func=command_pack)

    cut = sub.add_parser('slice', help='cut a sheet into frames')
    cut.add_argument('sheet', metavar='SHEET')
    cut.add_argument('--cell', type=parse_size, required=True, help='cell size WxH')
    cut.add_argument('--out', required=True, help='output directory')
    cut.add_argument('--offset', type=parse_point, default=(0, 0), help='first cell X,Y')
    cut.add_argument('--spacing', type=parse_point, default=(0, 0), help='gap between cells X,Y')
    cut.add_argument('--skip-empty', action='store_true', help='do not write fully transparent cells')
    cut.add_argument('--prefix', help='output name prefix (default: sheet name)')
    cut.set_defaults(func=command_slice)

    preview = sub.add_parser('preview', help='animated GIF preview')
    preview.add_argument('inputs', nargs='*', metavar='FRAMES')
    preview.add_argument('--sheet', help='read frames from a sheet instead of files')
    preview.add_argument('--cell', type=parse_size, help='cell size WxH for --sheet')
    preview.add_argument('--frames', help="frame indices for --sheet, e.g. '0-3' or '0,2,4-6'")
    preview.add_argument('--out', required=True, help='GIF path')
    preview.add_argument('--fps', type=float, default=8, help='frames per second (default 8)')
    preview.add_argument('--scale', type=int, default=4, help='integer zoom (default 4)')
    preview.add_argument('--background', type=parse_background, default=(128, 128, 128),
                         help='#rrggbb (default #808080) or none for GIF transparency')
    preview.add_argument('--onion', action='store_true', help='show the previous frame faintly (needs a background)')
    preview.set_defaults(func=command_preview)

    contact = sub.add_parser('contact', help='contact sheet of frames')
    contact.add_argument('inputs', nargs='+', metavar='FRAMES')
    contact.add_argument('--out', required=True, help='PNG path')
    contact.add_argument('--scale', type=int, default=4, help='integer zoom (default 4)')
    contact.add_argument('--columns', type=int, help='frames per row (default up to 8)')
    contact.add_argument('--grid', action='store_true', help='draw the pixel grid (scale >= 3)')
    contact.add_argument('--background', type=parse_background, default=(128, 128, 128), help='#rrggbb')
    contact.add_argument('--labels', action='store_true', help='print file names under frames')
    contact.set_defaults(func=command_contact)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if getattr(args, 'scale', 1) < 1:
        raise SystemExit('--scale must be a positive integer')
    if args.command == 'contact' and args.background is None:
        args.background = (128, 128, 128)
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
