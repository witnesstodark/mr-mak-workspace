#!/usr/bin/env python3
"""Turn upscaled or generated "pixel art" into true-resolution pixel art.

Subcommands:
  detect    estimate the art-pixel scale and grid offset of an upscaled image
  fit       sample one colour per grid cell, then optionally lock to a palette
  quantize  map any image to a palette (nearest colour in OKLab, no dithering)
  upscale   nearest-neighbour preview at an integer scale

Alpha is always hard (0 or 255) in the outputs. Palettes may be .hex, .gpl
or .png files. Each command prints a JSON report to stdout.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


# ---------------------------------------------------------------- helpers

def load_rgba(path):
    with Image.open(path) as image:
        return np.array(image.convert('RGBA'), dtype=np.uint8)


def save_rgba(array, path, sources):
    target = Path(path)
    for source in sources:
        if target.resolve() == Path(source).resolve():
            raise SystemExit('refusing to overwrite input %s; choose another --out' % source)
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(array), 'RGBA').save(target)


def parse_size(text):
    parts = text.lower().split('x')
    if len(parts) != 2:
        raise argparse.ArgumentTypeError('expected WxH, got %r' % text)
    return int(parts[0]), int(parts[1])


def parse_offset(text):
    parts = text.split(',')
    if len(parts) != 2:
        raise argparse.ArgumentTypeError('expected X,Y, got %r' % text)
    return float(parts[0]), float(parts[1])


def load_palette(path):
    """Read a .hex, .gpl or .png palette as an (N, 3) uint8 array."""
    path = Path(path)
    suffix = path.suffix.lower()
    colours = []
    if suffix == '.png':
        rgba = load_rgba(path).reshape(-1, 4)
        seen = set()
        for r, g, b, a in rgba.tolist():
            if a > 0 and (r, g, b) not in seen:
                seen.add((r, g, b))
                colours.append((r, g, b))
    elif suffix == '.gpl':
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or line.startswith('GIMP') or ':' in line.split()[0]:
                continue
            parts = line.split()
            if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
                colours.append(tuple(int(p) for p in parts[:3]))
    else:
        for line in path.read_text(encoding='utf-8').splitlines():
            value = line.strip().lstrip('#')
            if not value or value.startswith(';') or value.startswith('//'):
                continue
            value = value.split()[0]
            if len(value) != 6:
                raise SystemExit('bad palette line in %s: %r' % (path, line))
            colours.append(tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)))
    if not colours:
        raise SystemExit('palette %s has no colours' % path)
    return np.array(colours, np.uint8)


def srgb_to_oklab(rgb):
    """(N, 3) sRGB uint8 -> (N, 3) OKLab float."""
    c = rgb.astype(np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lms = linear @ np.array([[0.4122214708, 0.2119034982, 0.0883024619],
                             [0.5363325363, 0.6806995451, 0.2817188376],
                             [0.0514459929, 0.1073969566, 0.6299787005]])
    root = np.cbrt(lms)
    return root @ np.array([[0.2104542553, 1.9779984951, 0.0259040371],
                            [0.7936177850, -2.4285922050, 0.7827717662],
                            [-0.0040720468, 0.4505937099, -0.8086757660]])


def quantize_to_palette(rgba, palette, alpha_threshold=128):
    """Nearest palette colour (OKLab) for every opaque pixel; alpha made hard."""
    result = rgba.copy()
    opaque = rgba[:, :, 3] >= alpha_threshold
    pixels = rgba[:, :, :3][opaque]
    if len(pixels):
        unique, inverse = np.unique(pixels, axis=0, return_inverse=True)
        target = srgb_to_oklab(palette)
        source = srgb_to_oklab(unique)
        nearest = np.empty(len(unique), np.int64)
        for start in range(0, len(unique), 4096):
            chunk = source[start:start + 4096]
            distance = ((chunk[:, None, :] - target[None, :, :]) ** 2).sum(axis=2)
            nearest[start:start + 4096] = distance.argmin(axis=1)
        result[:, :, :3][opaque] = palette[nearest[inverse.reshape(-1)]]
    result[:, :, 3] = np.where(opaque, 255, 0)
    result[~opaque, :3] = 0
    return result


def reduce_colours(rgba, count):
    """Median-cut the opaque pixels to at most `count` colours (no dithering)."""
    opaque = rgba[:, :, 3] == 255
    pixels = rgba[:, :, :3][opaque]
    if not len(pixels):
        return rgba
    strip = Image.fromarray(pixels.reshape(-1, 1, 3), 'RGB')
    reduced = strip.quantize(colors=count, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = np.array(reduced.getpalette()[:count * 3], np.uint8).reshape(-1, 3)
    indices = np.array(reduced).reshape(-1)
    result = rgba.copy()
    result[:, :, :3][opaque] = palette[indices]
    return result


def colour_count(rgba):
    opaque = rgba[:, :, 3] > 0
    return int(len(np.unique(rgba[:, :, :3][opaque], axis=0))) if opaque.any() else 0


# ---------------------------------------------------------------- detect

def edge_profiles(rgba):
    """Edge strength between neighbouring columns and rows, noise floor removed."""
    f = rgba.astype(np.float32)
    f[:, :, :3] *= (f[:, :, 3:4] / 255.0)
    px = np.abs(np.diff(f, axis=1)).sum(axis=2).sum(axis=0)
    py = np.abs(np.diff(f, axis=0)).sum(axis=2).sum(axis=1)
    px = np.maximum(px - np.median(px), 0)
    py = np.maximum(py - np.median(py), 0)
    return px, py


def _periodicity(weights, scales):
    """Circular-mean strength and phase of boundary positions for each scale."""
    positions = np.arange(1, len(weights) + 1, dtype=np.float64)
    keep = weights > 0
    positions, weights = positions[keep], weights[keep].astype(np.float64)
    total = weights.sum()
    if total <= 0:
        return np.zeros(len(scales)), np.zeros(len(scales))
    strength = np.empty(len(scales))
    phase = np.empty(len(scales))
    for start in range(0, len(scales), 256):
        chunk = scales[start:start + 256]
        angle = 2.0 * np.pi * positions[None, :] / chunk[:, None]
        re = (weights * np.cos(angle)).sum(axis=1)
        im = (weights * np.sin(angle)).sum(axis=1)
        strength[start:start + 256] = np.hypot(re, im) / total
        phase[start:start + 256] = np.arctan2(im, re)
    return strength, phase


def detect_grid(rgba, min_scale=1.5, min_cells=8):
    """Estimate (scale, offset_x, offset_y, confidence) of an art-pixel grid.

    Boundaries between art pixels repeat every `scale` image pixels. Sub-multiples
    of the true scale fit equally well, so the largest scale whose score is
    within 85% of the best is chosen, then refined.
    """
    height, width = rgba.shape[:2]
    px, py = edge_profiles(rgba)
    max_scale = max(min(width, height) / float(min_cells), min_scale + 0.5)
    scales = np.arange(min_scale, max_scale, 0.01)

    def score(candidates):
        sx, phx = _periodicity(px, candidates)
        sy, phy = _periodicity(py, candidates)
        return (sx + sy) / 2.0, phx, phy

    coarse, _, _ = score(scales)
    if not len(coarse) or coarse.max() <= 0:
        return None
    best = coarse.max()
    peaks = [i for i in range(len(coarse))
             if coarse[i] >= 0.85 * best
             and coarse[i] >= coarse[max(i - 1, 0)] and coarse[i] >= coarse[min(i + 1, len(coarse) - 1)]]
    chosen = scales[max(peaks)] if peaks else scales[int(coarse.argmax())]
    fine = np.arange(max(chosen - 0.02, min_scale), chosen + 0.02, 0.0005)
    refined, phx, phy = score(fine)
    index = int(refined.argmax())
    scale = float(fine[index])
    offset_x = (phx[index] / (2.0 * np.pi) * scale) % scale
    offset_y = (phy[index] / (2.0 * np.pi) * scale) % scale
    alternatives = sorted({round(float(scales[i]), 2) for i in peaks if scales[i] != chosen})[-3:]
    return {'scale': round(scale, 4), 'offset': [round(float(offset_x), 3), round(float(offset_y), 3)],
            'confidence': round(float(refined[index]), 3), 'submultiples': alternatives}


def command_detect(args):
    rgba = load_rgba(args.input)
    found = detect_grid(rgba, args.min_scale, args.min_cells)
    height, width = rgba.shape[:2]
    if found is None:
        print(json.dumps({'command': 'detect', 'input': str(args.input), 'scale': None,
                          'note': 'no edges found'}))
        return 1
    found['true_size'] = list(grid_size(width, height, found['scale'], found['scale'], *found['offset']))
    found.update(command='detect', input=str(args.input), size=[width, height])
    if found['confidence'] < 0.55:
        found['note'] = 'low confidence: the image may be native resolution, painterly or heavily filtered'
    print(json.dumps(found))
    return 0


# ---------------------------------------------------------------- fit

def cell_edges(length, scale, offset):
    """Cell boundaries covering [0, length): cells with >= half their size inside."""
    start = offset - scale * math.ceil(offset / scale) if offset > 0 else 0.0
    edges = []
    position = start
    while position < length:
        end = position + scale
        if min(end, length) - max(position, 0.0) >= 0.5 * scale:
            edges.append((max(position, 0.0), min(end, float(length))))
        position = end
    return edges


def grid_size(width, height, scale_x, scale_y, offset_x=0.0, offset_y=0.0):
    return len(cell_edges(width, scale_x, offset_x)), len(cell_edges(height, scale_y, offset_y))


def inner_pixels(lo, hi):
    """Pixel indices whose centres fall in the inner half of [lo, hi)."""
    size = hi - lo
    a, b = lo + 0.25 * size, hi - 0.25 * size
    first, last = int(math.ceil(a - 0.5)), int(math.floor(b - 0.5 - 1e-9))
    if last < first:
        centre = int((lo + hi) / 2.0)
        return centre, centre + 1
    return first, last + 1


def sample_cell(block, method):
    flat = block.reshape(-1, 4)
    if method == 'center':
        return flat[len(flat) // 2]
    if method == 'mode':
        colours, counts = np.unique(flat, axis=0, return_counts=True)
        top = counts.argmax()
        if counts[top] >= 0.3 * len(flat):
            return colours[top]
    return np.median(flat, axis=0).round().astype(np.uint8)


def fit_image(rgba, scale_x, scale_y, offset_x, offset_y, method):
    height, width = rgba.shape[:2]
    columns = cell_edges(width, scale_x, offset_x)
    rows = cell_edges(height, scale_y, offset_y)
    result = np.zeros((len(rows), len(columns), 4), np.uint8)
    spans_x = [inner_pixels(lo, hi) for lo, hi in columns]
    spans_y = [inner_pixels(lo, hi) for lo, hi in rows]
    for j, (y0, y1) in enumerate(spans_y):
        for i, (x0, x1) in enumerate(spans_x):
            result[j, i] = sample_cell(rgba[y0:y1, x0:x1], method)
    return result


def command_fit(args):
    rgba = load_rgba(args.input)
    height, width = rgba.shape[:2]
    offset_x, offset_y = args.offset or (0.0, 0.0)
    detected = None
    if args.size:
        scale_x, scale_y = width / float(args.size[0]), height / float(args.size[1])
        offset_x = offset_y = 0.0
    elif args.scale == 'auto':
        detected = detect_grid(rgba)
        if detected is None:
            raise SystemExit('could not detect a grid; pass --scale or --size')
        scale_x = scale_y = detected['scale']
        if not args.offset:
            offset_x, offset_y = detected['offset']
    elif args.scale:
        scale_x = scale_y = float(args.scale)
    else:
        raise SystemExit('give --scale S, --scale auto or --size WxH')
    result = fit_image(rgba, scale_x, scale_y, offset_x, offset_y, args.method)
    if args.palette:
        result = quantize_to_palette(result, load_palette(args.palette), args.alpha_threshold)
    else:
        opaque = result[:, :, 3] >= args.alpha_threshold
        result[:, :, 3] = np.where(opaque, 255, 0)
        result[~opaque, :3] = 0
        if args.max_colors:
            result = reduce_colours(result, args.max_colors)
    save_rgba(result, args.out, [args.input])
    report = {'command': 'fit', 'input': str(args.input), 'output': str(args.out),
              'source_size': [width, height], 'true_size': [result.shape[1], result.shape[0]],
              'scale': [round(scale_x, 4), round(scale_y, 4)], 'offset': [offset_x, offset_y],
              'method': args.method, 'colours': colour_count(result),
              'palette': str(args.palette) if args.palette else None}
    if detected:
        report['detected'] = detected
    print(json.dumps(report))
    return 0


# ---------------------------------------------------------------- quantize / upscale

def command_quantize(args):
    rgba = load_rgba(args.input)
    palette = load_palette(args.palette)
    result = quantize_to_palette(rgba, palette, args.alpha_threshold)
    save_rgba(result, args.out, [args.input])
    print(json.dumps({'command': 'quantize', 'input': str(args.input), 'output': str(args.out),
                      'palette_size': len(palette), 'colours_before': colour_count(rgba),
                      'colours_after': colour_count(result)}))
    return 0


def command_upscale(args):
    if args.scale < 1:
        raise SystemExit('--scale must be a positive integer')
    rgba = load_rgba(args.input)
    result = np.repeat(np.repeat(rgba, args.scale, axis=0), args.scale, axis=1)
    save_rgba(result, args.out, [args.input])
    print(json.dumps({'command': 'upscale', 'input': str(args.input), 'output': str(args.out),
                      'size': [result.shape[1], result.shape[0]]}))
    return 0


# ---------------------------------------------------------------- cli

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    detect = sub.add_parser('detect', help='estimate the art-pixel grid')
    detect.add_argument('input', metavar='IN')
    detect.add_argument('--min-scale', type=float, default=1.5, help='smallest scale considered (default 1.5)')
    detect.add_argument('--min-cells', type=int, default=8, help='fewest art pixels across the short side (default 8)')
    detect.set_defaults(func=command_detect)

    fit = sub.add_parser('fit', help='downsample to true resolution')
    fit.add_argument('input', metavar='IN')
    fit.add_argument('--out', required=True, help='output PNG')
    fit.add_argument('--scale', help='image pixels per art pixel (float) or auto')
    fit.add_argument('--offset', type=parse_offset, help='grid offset X,Y in image pixels (from detect)')
    fit.add_argument('--size', type=parse_size, help='target true size WxH instead of --scale')
    fit.add_argument('--method', choices=('mode', 'median', 'center'), default='mode',
                     help='mode: dominant exact colour of the inner cell, else median (default)')
    fit.add_argument('--palette', help='lock colours to this palette (.hex, .gpl or .png)')
    fit.add_argument('--max-colors', type=int, help='without --palette, reduce to N colours')
    fit.add_argument('--alpha-threshold', type=int, default=128, help='alpha kept as opaque (default 128)')
    fit.set_defaults(func=command_fit)

    quantize = sub.add_parser('quantize', help='map an image to a palette')
    quantize.add_argument('input', metavar='IN')
    quantize.add_argument('--palette', required=True)
    quantize.add_argument('--out', required=True)
    quantize.add_argument('--alpha-threshold', type=int, default=128)
    quantize.set_defaults(func=command_quantize)

    upscale = sub.add_parser('upscale', help='nearest-neighbour preview')
    upscale.add_argument('input', metavar='IN')
    upscale.add_argument('--scale', type=int, default=4)
    upscale.add_argument('--out', required=True)
    upscale.set_defaults(func=command_upscale)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
