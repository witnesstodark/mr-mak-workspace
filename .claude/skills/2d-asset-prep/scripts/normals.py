#!/usr/bin/env python3
"""Generate starting normal maps for 2D sprites lit by dynamic 2D lights.

Height comes from the sprite itself:
  bevel      distance to the transparent edge, with a rounded profile
  luminance  pixel brightness (bright = raised)
  both       bevel plus half-strength luminance

Output: <name>_n.png per input, same size, opaque RGB. Transparent source
pixels receive the flat normal (128, 128, 255). The default --green up
writes the OpenGL convention (Y+ up) that Godot expects; use --green down for
DirectX-style tools. Generated maps are a starting point: check them under a
moving light and repaint where the form reads wrong.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def load_rgba(path):
    with Image.open(path) as image:
        return np.array(image.convert('RGBA'), dtype=np.uint8)


def edge_distance(mask, limit):
    """Chessboard distance (1 = touching transparency) capped at `limit`."""
    height, width = mask.shape
    distance = np.zeros(mask.shape, np.float32)
    current = mask.copy()
    for step in range(1, limit + 1):
        distance[current] = step
        padded = np.pad(current, 1, constant_values=False)
        eroded = current.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                eroded &= padded[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
        current = eroded
    return distance


def bevel_height(mask, bevel):
    """Quarter-circle profile from the edge (0) to full height (1) over `bevel` px."""
    t = edge_distance(mask, bevel) / float(bevel)
    return np.where(mask, np.sqrt(np.clip(1.0 - (1.0 - t) ** 2, 0.0, 1.0)), 0.0).astype(np.float32)


def luminance(rgba):
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0
    return (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]).astype(np.float32)


def gradient(height, mask, outside_is_zero):
    """Central differences; transparent neighbours count as height 0 or are skipped."""
    h, w = height.shape
    padded = np.pad(height, 1, constant_values=0.0)
    valid = np.pad(mask, 1, constant_values=False)
    if outside_is_zero:
        valid = np.ones_like(valid)
    centre = height

    def side(dy, dx):
        values = padded[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
        ok = valid[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
        return np.where(ok, values, centre), ok

    right, ok_r = side(0, 1)
    left, ok_l = side(0, -1)
    down, ok_d = side(1, 0)
    up, ok_u = side(-1, 0)
    span_x = np.maximum(ok_r.astype(np.float32) + ok_l.astype(np.float32), 1.0)
    span_y = np.maximum(ok_d.astype(np.float32) + ok_u.astype(np.float32), 1.0)
    return (right - left) / span_x, (down - up) / span_y


def normal_map(rgba, mode='bevel', bevel=2, strength=1.0, green='up'):
    """Return an (H, W, 3) uint8 normal map for an RGBA sprite."""
    mask = rgba[:, :, 3] >= 128
    if mode == 'bevel':
        height, outside_zero = bevel_height(mask, bevel), True
    elif mode == 'luminance':
        height, outside_zero = luminance(rgba) * mask, False
    else:
        height, outside_zero = bevel_height(mask, bevel) + 0.5 * luminance(rgba) * mask, True
    dx, dy = gradient(height, mask, outside_zero)
    k = 2.0 * strength
    # Surface normal in image space (x right, y down, z toward the viewer).
    nx, ny_down, nz = -dx * k, -dy * k, np.ones_like(dx)
    length = np.sqrt(nx * nx + ny_down * ny_down + nz * nz)
    nx, ny_down, nz = nx / length, ny_down / length, nz / length
    ny = -ny_down if green == 'up' else ny_down
    encoded = np.stack([nx, ny, nz], axis=2) * 0.5 + 0.5
    result = np.round(encoded * 255.0).astype(np.uint8)
    result[~mask] = (128, 128, 255)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('inputs', nargs='+', metavar='IN')
    parser.add_argument('--out', required=True, help='output directory')
    parser.add_argument('--mode', choices=('bevel', 'luminance', 'both'), default='bevel')
    parser.add_argument('--bevel', type=int, default=2, help='edge rounding width in pixels (default 2)')
    parser.add_argument('--strength', type=float, default=1.0, help='slope multiplier (default 1.0)')
    parser.add_argument('--green', choices=('up', 'down'), default='up',
                        help='up = OpenGL/Godot (default), down = DirectX')
    args = parser.parse_args(argv)
    if args.bevel < 1:
        parser.error('--bevel must be at least 1')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    files = []
    for source in args.inputs:
        target = out / (Path(source).stem + '_n.png')
        if target.resolve() == Path(source).resolve():
            raise SystemExit('refusing to overwrite input %s' % source)
        rgba = load_rgba(source)
        Image.fromarray(normal_map(rgba, args.mode, args.bevel, args.strength, args.green), 'RGB').save(target)
        files.append({'source': str(source), 'output': str(target), 'size': [rgba.shape[1], rgba.shape[0]]})
    print(json.dumps({'command': 'normals', 'mode': args.mode, 'bevel': args.bevel,
                      'strength': args.strength, 'green': args.green, 'files': files}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
