#!/usr/bin/env python3
"""Cut sprites out of flat backgrounds, trim them and harden their alpha.

Subcommands:
  key    remove a flat background colour (flood from the border, or global)
  trim   crop to content, optionally with shared bounds or a fixed canvas
  alpha  binarize alpha for hard-edged pixel art

Every subcommand writes new PNG files into --out, never over an input, and
prints a JSON report to stdout.
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image


# ---------------------------------------------------------------- helpers

def load_rgba(path):
    with Image.open(path) as image:
        return np.array(image.convert('RGBA'), dtype=np.uint8)


def save_rgba(array, path):
    Image.fromarray(np.ascontiguousarray(array), 'RGBA').save(path)


def parse_color(text):
    value = text.strip().lstrip('#')
    if len(value) != 6:
        raise argparse.ArgumentTypeError('expected #rrggbb, got %r' % text)
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise argparse.ArgumentTypeError('expected #rrggbb, got %r' % text)


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


def hex_color(rgb):
    return '#%02x%02x%02x' % tuple(int(c) for c in rgb[:3])


def output_for(source, out_dir):
    """Return the output PNG path for a source, refusing to overwrite it."""
    target = Path(out_dir) / (Path(source).stem + '.png')
    if target.resolve() == Path(source).resolve():
        raise SystemExit('refusing to overwrite input %s; choose another --out' % source)
    return target


def semi_count(rgba):
    alpha = rgba[:, :, 3]
    return int(((alpha > 0) & (alpha < 255)).sum())


def harden(rgba, threshold):
    result = rgba.copy()
    opaque = result[:, :, 3] >= threshold
    result[:, :, 3] = np.where(opaque, 255, 0)
    result[~opaque, :3] = 0
    return result


# ---------------------------------------------------------------- key

def border_key(rgba):
    """Most common opaque colour along the image border, or None."""
    edges = np.concatenate([rgba[0], rgba[-1], rgba[:, 0], rgba[:, -1]])
    opaque = edges[edges[:, 3] > 0]
    if not len(opaque):
        return None
    counts = Counter(map(tuple, opaque[:, :3].tolist()))
    return max(counts.items(), key=lambda item: (item[1], item[0]))[0]


def _spread_rows(marked, candidate):
    """Mark every run of candidate pixels in a row that touches a marked pixel."""
    height, width = candidate.shape
    previous = np.concatenate([np.zeros((height, 1), bool), candidate[:, :-1]], axis=1)
    starts = candidate & ~previous
    ids = np.cumsum(starts.ravel()).reshape(height, width)
    ids = np.where(candidate, ids, 0)
    hit = np.zeros(int(ids.max()) + 1, bool)
    hit[ids[marked & candidate]] = True
    hit[0] = False
    return hit[ids]


def flood_from_border(candidate):
    """4-connected region of candidate pixels reachable from the image border."""
    seeds = np.zeros_like(candidate)
    seeds[0, :] = seeds[-1, :] = True
    seeds[:, 0] = seeds[:, -1] = True
    marked = seeds & candidate
    while True:
        grown = _spread_rows(marked, candidate)
        grown = _spread_rows(grown.T, candidate.T).T | marked
        if np.array_equal(grown, marked):
            return marked
        marked = grown


def dilate(mask, steps):
    """8-neighbour dilation, `steps` times."""
    result = mask.copy()
    height, width = mask.shape
    for _ in range(steps):
        padded = np.pad(result, 1, constant_values=False)
        grown = result.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown |= padded[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
        result = grown
    return result


def defringe(rgba, background, key, tolerance):
    """Unmix the key colour from opaque pixels next to the removed background.

    A pixel at distance d from the key, with tolerance < d < 4 * tolerance, is
    treated as a blend of the subject and the key with alpha (d - t) / (3 t);
    its colour is recovered as (c - (1 - a) k) / a.
    """
    result = rgba.astype(np.float32)
    ring = dilate(background, 2) & ~background & (rgba[:, :, 3] > 0)
    rgb = result[:, :, :3]
    distance = np.sqrt(((rgb - np.array(key, np.float32)) ** 2).sum(axis=2))
    band = ring & (distance < 4 * tolerance)
    alpha = np.clip((distance - tolerance) / (3.0 * tolerance), 0.0, 1.0)
    safe = np.maximum(alpha, 1e-3)[:, :, None]
    unmixed = np.clip((rgb - (1.0 - alpha[:, :, None]) * np.array(key, np.float32)) / safe, 0, 255)
    result[:, :, :3] = np.where(band[:, :, None], unmixed, rgb)
    result[:, :, 3] = np.where(band, result[:, :, 3] * alpha, result[:, :, 3])
    return np.round(result).astype(np.uint8), int(band.sum())


def key_image(rgba, color, tolerance, mode, use_defringe):
    key = border_key(rgba) if color == 'auto' else color
    if key is None:
        return rgba.copy(), {'key': None, 'removed_percent': 0.0, 'note': 'border already transparent'}
    rgb = rgba[:, :, :3].astype(np.int32)
    distance = np.sqrt(((rgb - np.array(key)) ** 2).sum(axis=2))
    candidate = (distance <= tolerance) | (rgba[:, :, 3] == 0)
    background = flood_from_border(candidate) if mode == 'flood' else candidate
    result = rgba.copy()
    result[background] = 0
    report = {'key': hex_color(key)}
    if use_defringe:
        result, fringe = defringe(result, background, key, max(tolerance, 1))
        report['defringed_pixels'] = fringe
    removed = int((background & (rgba[:, :, 3] > 0)).sum())
    report['removed_percent'] = round(100.0 * removed / background.size, 2)
    return result, report


def command_key(args):
    Path(args.out).mkdir(parents=True, exist_ok=True)
    color = 'auto' if args.color == 'auto' else parse_color(args.color)
    files = []
    for source in args.inputs:
        target = output_for(source, args.out)
        result, report = key_image(load_rgba(source), color, args.tolerance, args.mode, args.defringe)
        if args.hard_alpha:
            result = harden(result, args.alpha_threshold)
        save_rgba(result, target)
        report.update(source=str(source), output=str(target), semi_transparent=semi_count(result))
        files.append(report)
    print(json.dumps({'command': 'key', 'mode': args.mode, 'tolerance': args.tolerance, 'files': files}))
    return 0


# ---------------------------------------------------------------- trim

def content_bbox(rgba):
    """[x0, y0, x1, y1) of pixels with alpha > 0, or None when empty."""
    ys, xs = np.nonzero(rgba[:, :, 3] > 0)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def union_bbox(boxes):
    boxes = [b for b in boxes if b is not None]
    if not boxes:
        return None
    return [min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]


def pivot_point(bbox, pivot):
    """Pivot pixel in source coordinates.

    bottom-center: the centre column of the content's bottom row (the left of
    the two centre columns for an even width); center: the centre pixel.
    """
    if isinstance(pivot, tuple):
        return pivot
    x0, y0, x1, y1 = bbox
    if pivot == 'center':
        return (x0 + x1 - 1) // 2, (y0 + y1 - 1) // 2
    return (x0 + x1 - 1) // 2, y1 - 1


def default_anchor(canvas, pivot, padding):
    """Canvas pixel that receives the pivot when --anchor is omitted.

    ((W - 1) // 2, H - 1 - padding) for bottom-center and explicit pivots, and
    ((W - 1) // 2, (H - 1) // 2) for center. Even-width content on an even
    canvas is therefore symmetric about the canvas centre line x = W / 2.
    """
    width, height = canvas
    if pivot == 'center':
        return (width - 1) // 2, (height - 1) // 2
    return (width - 1) // 2, height - 1 - padding


def paste(canvas, source, dx, dy):
    """Copy source onto canvas with its origin at (dx, dy), clipping edges."""
    height, width = canvas.shape[:2]
    sh, sw = source.shape[:2]
    x0, y0 = max(dx, 0), max(dy, 0)
    x1, y1 = min(dx + sw, width), min(dy + sh, height)
    if x1 > x0 and y1 > y0:
        canvas[y0:y1, x0:x1] = source[y0 - dy:y1 - dy, x0 - dx:x1 - dx]


def command_trim(args):
    Path(args.out).mkdir(parents=True, exist_ok=True)
    images = [load_rgba(source) for source in args.inputs]
    boxes = [content_bbox(image) for image in images]
    pivot = args.pivot
    if pivot not in ('bottom-center', 'center'):
        pivot = parse_point(pivot)
    if args.shared:
        if len({image.shape[:2] for image in images}) > 1:
            raise SystemExit('--shared needs inputs of one size so their coordinates match')
        shared = union_bbox(boxes)
    if args.canvas:
        anchor = args.anchor or default_anchor(args.canvas, args.pivot, args.padding)
    files, clipped = [], []
    for source, image, own in zip(args.inputs, images, boxes):
        target = output_for(source, args.out)
        box = shared if args.shared else own
        entry = {'source': str(source), 'output': str(target),
                 'source_size': [image.shape[1], image.shape[0]], 'bbox': own}
        if args.canvas:
            width, height = args.canvas
            result = np.zeros((height, width, 4), np.uint8)
            if box is not None:
                px, py = pivot_point(box, pivot)
                dx, dy = anchor[0] - px, anchor[1] - py
                if own is not None and (own[0] + dx < 0 or own[1] + dy < 0
                                        or own[2] + dx > width or own[3] + dy > height):
                    clipped.append(str(source))
                paste(result, image, dx, dy)
                entry.update(offset=[dx, dy], pivot=[anchor[0], anchor[1]])
            else:
                entry.update(offset=None, pivot=[anchor[0], anchor[1]], empty=True)
        else:
            pad = args.padding
            if box is None:
                result = np.zeros((max(2 * pad, 1), max(2 * pad, 1), 4), np.uint8)
                entry.update(offset=None, pivot=None, empty=True)
            else:
                x0, y0, x1, y1 = box
                result = np.zeros((y1 - y0 + 2 * pad, x1 - x0 + 2 * pad, 4), np.uint8)
                dx, dy = pad - x0, pad - y0
                paste(result, image, dx, dy)
                px, py = pivot_point(box, pivot)
                entry.update(offset=[dx, dy], pivot=[px + dx, py + dy])
        entry['output_size'] = [result.shape[1], result.shape[0]]
        if clipped and clipped[-1] == str(source) and not args.allow_clip:
            continue
        save_rgba(result, target)
        files.append(entry)
    report = {'command': 'trim', 'shared': bool(args.shared), 'padding': args.padding,
              'canvas': list(args.canvas) if args.canvas else None,
              'anchor': list(anchor) if args.canvas else None,
              'pivot': args.pivot, 'files': files}
    if args.shared:
        report['shared_bbox'] = shared
    if clipped:
        report['clipped'] = clipped
    manifest = Path(args.out) / 'trim.json'
    manifest.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
    if clipped and not args.allow_clip:
        print('content would be clipped by the canvas: %s (use a larger --canvas, '
              'another --anchor or --allow-clip)' % ', '.join(clipped), file=sys.stderr)
        return 1
    return 0


# ---------------------------------------------------------------- alpha

def command_alpha(args):
    Path(args.out).mkdir(parents=True, exist_ok=True)
    files = []
    for source in args.inputs:
        target = output_for(source, args.out)
        image = load_rgba(source)
        before = semi_count(image)
        save_rgba(harden(image, args.threshold), target)
        files.append({'source': str(source), 'output': str(target), 'semi_transparent_before': before})
    print(json.dumps({'command': 'alpha', 'threshold': args.threshold, 'files': files}))
    return 0


# ---------------------------------------------------------------- cli

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    key = sub.add_parser('key', help='remove a flat background colour')
    key.add_argument('inputs', nargs='+', metavar='IN')
    key.add_argument('--out', required=True, help='output directory')
    key.add_argument('--color', default='auto', help='auto (most common border colour) or #rrggbb')
    key.add_argument('--tolerance', type=float, default=24, help='RGB distance treated as background (default 24)')
    key.add_argument('--mode', choices=('flood', 'global'), default='flood',
                     help='flood: only background connected to the border (default); global: every match')
    key.add_argument('--hard-alpha', action='store_true', help='binarize alpha after keying')
    key.add_argument('--alpha-threshold', type=int, default=128, help='alpha kept as opaque with --hard-alpha')
    key.add_argument('--defringe', action='store_true', help='unmix key-tinted edge pixels (soft halo removal)')
    key.set_defaults(func=command_key)

    trim = sub.add_parser('trim', help='crop to content or place on a fixed canvas')
    trim.add_argument('inputs', nargs='+', metavar='IN')
    trim.add_argument('--out', required=True, help='output directory (receives trim.json)')
    trim.add_argument('--padding', type=int, default=0, help='transparent margin in pixels')
    trim.add_argument('--shared', action='store_true', help='use the union bbox of all inputs (keeps frame alignment)')
    trim.add_argument('--canvas', type=parse_size, help='fixed output size WxH')
    trim.add_argument('--pivot', default='bottom-center', help='bottom-center, center or X,Y in source pixels')
    trim.add_argument('--anchor', type=parse_point, help='canvas pixel X,Y that receives the pivot')
    trim.add_argument('--allow-clip', action='store_true', help='write frames even if the canvas clips them')
    trim.set_defaults(func=command_trim)

    alpha = sub.add_parser('alpha', help='binarize alpha')
    alpha.add_argument('inputs', nargs='+', metavar='IN')
    alpha.add_argument('--out', required=True, help='output directory')
    alpha.add_argument('--threshold', type=int, default=128, help='alpha >= threshold becomes opaque (default 128)')
    alpha.set_defaults(func=command_alpha)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
