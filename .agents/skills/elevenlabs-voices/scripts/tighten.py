#!/usr/bin/env python3
"""Shorten the pauses inside spoken takes (barks, short lines).

Text-to-speech often leaves long gaps between words or after a sigh. Every
quiet stretch between the first and the last sound that lasts longer than
--max-gap-ms is cut down to --keep-gap-ms, joined by a raised-cosine
crossfade inside the quiet. The edges are left alone for audio_tool.py's
trim. A stretch is quiet when its RMS over 10 ms hops is --quiet-db below
the take's loudest hop or under --floor-db.

  python tighten.py takes/*.wav --out tight

Reads 16- or 24-bit PCM WAV, writes the same format to --out with the same
file names, never over an input, and prints a JSON report.
"""
import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np


def read_wav(path):
    with wave.open(str(path), 'rb') as w:
        channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(w.getnframes())
    if width == 2:
        x = np.frombuffer(raw, '<i2').astype(np.float64) / 32768.0
    elif width == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float64) / 8388608.0
    else:
        raise SystemExit('%s: only 16- and 24-bit PCM WAV is supported' % path)
    return x.reshape(-1, channels), rate, width


def write_wav(path, x, rate, width):
    scale = 32768.0 if width == 2 else 8388608.0
    y = np.clip(np.round(x * scale), -scale, scale - 1).astype(np.int32)
    if width == 2:
        raw = y.astype('<i2').tobytes()
    else:
        u = (y.reshape(-1) & 0xFFFFFF).astype(np.uint32)
        raw = np.stack([u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF], 1).astype(np.uint8).tobytes()
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(raw)


def quiet_runs(x, rate, quiet_db, floor_db, hop_ms=10.0):
    """Interior quiet stretches as (start, end) samples, between the first and
    the last loud hop."""
    hop = max(1, int(rate * hop_ms / 1000.0))
    energy = np.concatenate([[0.0], np.cumsum(np.sum(x * x, axis=1))])
    edges = np.arange(0, len(x) - hop + 1, hop)
    if len(edges) == 0:
        return []
    power = (energy[edges + hop] - energy[edges]) / (hop * x.shape[1])
    level = 10.0 * np.log10(power + 1e-12)
    quiet = (level < level.max() - quiet_db) | (level < floor_db)
    loud = np.flatnonzero(~quiet)
    if len(loud) == 0:
        return []
    runs, start = [], None
    for i in range(loud[0], loud[-1] + 1):
        if quiet[i] and start is None:
            start = i
        elif not quiet[i] and start is not None:
            runs.append((start * hop, i * hop))
            start = None
    return runs


def tighten(x, rate, max_gap_ms=150.0, keep_gap_ms=80.0, fade_ms=8.0, quiet_db=40.0, floor_db=-55.0):
    """Returns (shortened samples, [seconds removed per cut])."""
    keep = int(rate * keep_gap_ms / 1000.0)
    half = keep // 2
    fade = min(int(rate * fade_ms / 1000.0), half)
    pieces, removed, pos = [], [], 0
    for a, b in quiet_runs(x, rate, quiet_db, floor_db):
        if (b - a) * 1000.0 / rate <= max_gap_ms:
            continue
        # Keep `half` of quiet after the sound before the gap and `half` before
        # the next sound; overlap `fade` samples so the join is inaudible.
        head = x[pos:a + half + fade].copy()
        tail_start = b - half
        if fade:
            ramp = (0.5 - 0.5 * np.cos(np.pi * (np.arange(fade) + 0.5) / fade))[:, None]
            head[-fade:] = head[-fade:] * (1.0 - ramp) + x[tail_start:tail_start + fade] * ramp
        pieces.append(head)
        pos = tail_start + fade
        removed.append(round((b - a - 2 * half) / rate, 4))
    pieces.append(x[pos:])
    return np.concatenate(pieces), removed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('inputs', nargs='+')
    parser.add_argument('--out', required=True, help='output folder')
    parser.add_argument('--max-gap-ms', type=float, default=150.0, help='pauses longer than this are cut')
    parser.add_argument('--keep-gap-ms', type=float, default=80.0, help='what is left of a cut pause')
    parser.add_argument('--fade-ms', type=float, default=8.0)
    parser.add_argument('--quiet-db', type=float, default=40.0, help='quiet: this far below the loudest hop')
    parser.add_argument('--floor-db', type=float, default=-55.0, help='quiet: or below this level (dBFS)')
    args = parser.parse_args(argv)
    if args.keep_gap_ms >= args.max_gap_ms:
        raise SystemExit('--keep-gap-ms must be shorter than --max-gap-ms')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sources = {Path(p).resolve() for p in args.inputs}
    report = []
    for source in args.inputs:
        target = out / Path(source).name
        if target.resolve() in sources:
            raise SystemExit('refusing to overwrite input %s' % source)
        x, rate, width = read_wav(source)
        y, removed = tighten(x, rate, args.max_gap_ms, args.keep_gap_ms, args.fade_ms, args.quiet_db, args.floor_db)
        write_wav(target, y, rate, width)
        report.append({'file': source, 'output': str(target), 'before_s': round(len(x) / rate, 3),
                       'after_s': round(len(y) / rate, 3), 'pauses_cut_s': removed})
    print(json.dumps({'command': 'tighten', 'files': report}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
