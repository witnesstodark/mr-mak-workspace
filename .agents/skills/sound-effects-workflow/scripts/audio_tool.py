#!/usr/bin/env python3
"""Prepare and inspect game sound effects: WAV I/O, loudness, splitting, loops.

Subcommands
  pcm2wav  wrap raw PCM (for example a generator's pcm_48000 output) in a WAV
  analyze  levels, true peak, BS.1770 loudness, silence, DC, clipping, takes
  split    cut a multi-take file into one WAV per take at silences
  process  mono, trim, fades, resample and loudness normalisation with a
           true-peak ceiling (gain only: no limiter or compression)
  loop     seamless loop by an equal-power crossfade of the tail into the head
  sheet    review image: waveform and log-frequency spectrogram per file

Reads 8/16/24/32-bit PCM and 32/64-bit float WAV (including
WAVE_FORMAT_EXTENSIBLE). Other formats need ffmpeg on PATH. Writes 16- or
24-bit PCM WAV; 16-bit output from processed audio gets TPDF dither.

Conventions
  * dBFS: a full-scale sine has a peak of 0 dBFS and an RMS of -3.01 dBFS.
  * Loudness: ITU-R BS.1770-4 K-weighting and gating. Mono is measured as one
    channel (no dual-mono +3 dB): a 997 Hz sine at 0 dBFS reads -3.01 LUFS.
    Files shorter than 400 ms are zero-padded to one 400 ms block, so short
    one-shots get comparable momentary values; short-term pads to 3 s.
  * Every command leaves its inputs untouched and refuses to write over them.
"""
import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal

PCM, FLOAT, EXTENSIBLE = 1, 3, 0xFFFE
PREROLL_MS = 5.0   # kept before the first sound when trimming
POSTROLL_MS = 10.0  # kept after the last sound when trimming


# ---------------------------------------------------------------- WAV I/O

def read_wav(path):
    """Return (samples float64 [n, channels], rate, info) for a WAV file."""
    data = Path(path).read_bytes()
    if len(data) < 12 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('not a RIFF/WAVE file')
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack('<I', data[pos + 4:pos + 8])[0]
        body = pos + 8
        if cid == b'fmt ':
            code, channels, rate, _, align, bits = struct.unpack('<HHIIHH', data[body:body + 16])
            if code == EXTENSIBLE and size >= 40:
                code = struct.unpack('<H', data[body + 24:body + 26])[0]
            fmt = (code, channels, rate, align, bits)
        elif cid == b'data':
            end = len(data) if size == 0xFFFFFFFF or body + size > len(data) else body + size
            raw = data[body:end]
        pos = body + size + (size & 1)
    if fmt is None or raw is None:
        raise ValueError('WAV is missing its fmt or data chunk')
    code, channels, rate, align, bits = fmt
    width = align // channels if channels else 0
    raw = raw[:len(raw) - len(raw) % align] if align else b''
    if code == PCM and width == 1:
        x = (np.frombuffer(raw, np.uint8).astype(np.float64) - 128.0) / 128.0
    elif code == PCM and width == 2:
        x = np.frombuffer(raw, '<i2').astype(np.float64) / 32768.0
    elif code == PCM and width == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        x = v.astype(np.float64) / 8388608.0
    elif code == PCM and width == 4:
        x = np.frombuffer(raw, '<i4').astype(np.float64) / 2147483648.0
    elif code == FLOAT and width == 4:
        x = np.frombuffer(raw, '<f4').astype(np.float64)
    elif code == FLOAT and width == 8:
        x = np.frombuffer(raw, '<f8').astype(np.float64)
    else:
        raise ValueError('unsupported WAV encoding (format %d, %d bytes per sample)' % (code, width))
    info = {'bits': bits, 'encoding': 'float' if code == FLOAT else 'pcm'}
    return x.reshape(-1, channels), rate, info


def wav_bytes(samples, rate, bits=16, dither=False, seed=0):
    """Encode float samples [n, channels] as 16- or 24-bit PCM WAV bytes."""
    x = np.asarray(samples, np.float64)
    if x.ndim == 1:
        x = x[:, None]
    if bits not in (16, 24):
        raise ValueError('bits must be 16 or 24')
    scale = 32768.0 if bits == 16 else 8388608.0
    y = x * scale
    if dither:
        rng = np.random.default_rng(seed)
        y = y + rng.random(y.shape) - rng.random(y.shape)  # TPDF, +-1 LSB
    y = np.clip(np.round(y), -scale, scale - 1).astype(np.int32)
    if bits == 16:
        payload = y.astype('<i2').tobytes()
    else:
        u = (y.reshape(-1) & 0xFFFFFF).astype(np.uint32)
        payload = np.stack([u & 0xFF, (u >> 8) & 0xFF, (u >> 16) & 0xFF], 1).astype(np.uint8).tobytes()
    channels, width = x.shape[1], bits // 8
    header = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(payload), b'WAVE', b'fmt ', 16, PCM,
                         channels, rate, rate * channels * width, channels * width, bits,
                         b'data', len(payload))
    return header + payload


def guard(target, sources):
    """Refuse to write over an input file."""
    target = Path(target).resolve()
    for source in sources:
        if Path(source).resolve() == target:
            raise SystemExit('refusing to overwrite input %s' % source)


def write_wav(path, samples, rate, bits=16, dither=False, sources=()):
    guard(path, sources)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(wav_bytes(samples, rate, bits, dither))


def load_audio(path):
    """Read a WAV directly, or decode another format through ffmpeg when available."""
    path = Path(path)
    if not path.is_file():
        raise SystemExit('missing input %s' % path)
    with path.open('rb') as handle:
        head = handle.read(12)
    if head[:4] == b'RIFF' and head[8:12] == b'WAVE':
        try:
            return read_wav(path)
        except ValueError as error:
            raise SystemExit('%s: %s' % (path, error))
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise SystemExit('%s is not a WAV file and ffmpeg is not on PATH. Request WAV or PCM output '
                         'from the generator (wrap raw PCM with pcm2wav), or install ffmpeg.' % path)
    with tempfile.TemporaryDirectory(prefix='audio-tool-') as temp:
        decoded = Path(temp) / 'decoded.wav'
        result = subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(path), '-acodec', 'pcm_f32le',
                                 '-f', 'wav', str(decoded)], capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit('ffmpeg could not decode %s: %s' % (path, result.stderr.strip()[:300]))
        samples, rate, info = read_wav(decoded)
    info['decoded_by'] = 'ffmpeg'
    return samples, rate, info


# ---------------------------------------------------------------- measurement

def db(value):
    return None if value <= 0 else round(20.0 * math.log10(value), 2)


def k_weighting(rate):
    """BS.1770 K-weighting biquads for any sample rate (libebur128 derivation)."""
    f0, gain, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / rate)
    vh = 10.0 ** (gain / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    shelf_b = [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    shelf_a = [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / rate)
    den = 1.0 + k / q + k * k
    high_b = [1.0, -2.0, 1.0]
    high_a = [1.0, 2.0 * (k * k - 1.0) / den, (1.0 - k / q + k * k) / den]
    return (np.array(shelf_b), np.array(shelf_a)), (np.array(high_b), np.array(high_a))


def channel_weights(channels):
    if channels == 6:  # L R C LFE Ls Rs
        return np.array([1.0, 1.0, 1.0, 0.0, 1.41, 1.41])
    return np.ones(channels)


def block_powers(x, rate, seconds, step_seconds=0.1):
    """Weighted mean-square per window of K-weighted audio, zero-padded to one window."""
    (sb, sa), (hb, ha) = k_weighting(rate)
    y = signal.lfilter(hb, ha, signal.lfilter(sb, sa, x, axis=0), axis=0)
    size, step = int(round(seconds * rate)), max(1, int(round(step_seconds * rate)))
    if len(y) < size:
        y = np.vstack([y, np.zeros((size - len(y), y.shape[1]))])
    csum = np.vstack([np.zeros((1, y.shape[1])), np.cumsum(y * y, axis=0)])
    starts = np.arange(0, len(y) - size + 1, step)
    means = (csum[starts + size] - csum[starts]) / size
    return means @ channel_weights(x.shape[1])


def lufs(power):
    return None if power <= 0 else -0.691 + 10.0 * math.log10(power)


def loudness(x, rate):
    """Integrated, max momentary and max short-term loudness (LUFS)."""
    blocks = block_powers(x, rate, 0.4)
    levels = np.array([lufs(p) if p > 0 else -np.inf for p in blocks])
    absolute = blocks[levels > -70.0]
    integrated = None
    if len(absolute):
        relative = lufs(absolute.mean()) - 10.0
        gated = blocks[(levels > -70.0) & (levels > relative)]
        integrated = lufs(gated.mean()) if len(gated) else None
    short = block_powers(x, rate, 3.0)
    rnd = lambda v: None if v is None else round(v, 2)
    return {'integrated_lufs': rnd(integrated), 'max_momentary_lufs': rnd(lufs(blocks.max())),
            'max_short_term_lufs': rnd(lufs(short.max())), 'padded': len(x) < int(round(0.4 * rate))}


def true_peak(x):
    if len(x) == 0:
        return 0.0
    up = signal.resample_poly(x, 4, 1, axis=0)
    return float(max(np.abs(up).max(), np.abs(x).max()))


def envelope_segments(x, rate, silence_db, min_gap_ms, min_length_ms, frame_ms=5.0):
    """Non-silent (start, end) sample ranges split at gaps of at least min_gap_ms."""
    frame = max(1, int(rate * frame_ms / 1000.0))
    level = np.abs(x).max(axis=1) if len(x) else np.zeros(0)
    count = int(math.ceil(len(level) / frame))
    padded = np.zeros(count * frame)
    padded[:len(level)] = level
    active = padded.reshape(count, frame).max(axis=1) > 10.0 ** (silence_db / 20.0)
    segments, start, last = [], None, None
    gap_frames = max(1, int(round(min_gap_ms / frame_ms)))
    for i, on in enumerate(active):
        if on:
            if start is None:
                start = i
            elif i - last > gap_frames:
                segments.append((start, last))
                start = i
            last = i
    if start is not None:
        segments.append((start, last))
    result, skipped = [], []
    for a, b in segments:
        s, e = a * frame, min(len(level), (b + 1) * frame)
        (result if (e - s) * 1000.0 / rate >= min_length_ms else skipped).append((s, e))
    return result, skipped


def edge_silence(x, rate, silence_db):
    level = np.abs(x).max(axis=1) if len(x) else np.zeros(0)
    loud = np.nonzero(level > 10.0 ** (silence_db / 20.0))[0]
    if len(loud) == 0:
        return None, None
    return loud[0], len(level) - 1 - loud[-1]


def measure(x, rate, silence_db=-50.0):
    peak = float(np.abs(x).max()) if x.size else 0.0
    lead, trail = edge_silence(x, rate, silence_db)
    segments, _ = envelope_segments(x, rate, silence_db, 150.0, 40.0)
    report = {'duration_s': round(len(x) / rate, 4), 'peak_dbfs': db(peak), 'true_peak_dbtp': db(true_peak(x)),
              'rms_dbfs': db(float(np.sqrt(np.mean(x * x)))) if x.size else None,
              'dc_offset': round(float(np.abs(x.mean(axis=0)).max()), 5) if x.size else 0.0,
              'clipped_samples': int(np.count_nonzero(np.abs(x) >= 0.999)),
              'leading_silence_ms': None if lead is None else round(lead * 1000.0 / rate, 1),
              'trailing_silence_ms': None if trail is None else round(trail * 1000.0 / rate, 1),
              'segments': len(segments), 'multiple_sounds': len(segments) > 1}
    report.update(loudness(x, rate))
    return report


# ---------------------------------------------------------------- commands

def emit(report, code=0):
    print(json.dumps(report))
    return code


def command_pcm2wav(args):
    raw = Path(args.input).read_bytes()
    width = {'s16le': 2, 's24le': 3, 's32le': 4, 'f32le': 4}[args.sample_format]
    frame = width * args.channels
    if len(raw) % frame:
        raise SystemExit('%d bytes is not a whole number of %d-byte frames' % (len(raw), frame))
    out = Path(args.out)
    guard(out, [args.input])
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.sample_format in ('s16le', 's24le'):
        bits = width * 8
        header = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(raw), b'WAVE', b'fmt ', 16, PCM,
                             args.channels, args.rate, args.rate * frame, frame, bits, b'data', len(raw))
        out.write_bytes(header + raw)
    else:
        dtype = '<i4' if args.sample_format == 's32le' else '<f4'
        x = np.frombuffer(raw, dtype).astype(np.float64)
        if args.sample_format == 's32le':
            x /= 2147483648.0
        bits = args.bits or 24
        out.write_bytes(wav_bytes(x.reshape(-1, args.channels), args.rate, bits, dither=bits == 16))
    return emit({'command': 'pcm2wav', 'output': str(out), 'rate': args.rate, 'channels': args.channels,
                 'bits': bits, 'duration_s': round(len(raw) / frame / args.rate, 4)})


def command_analyze(args):
    files, failed = [], False
    for source in args.inputs:
        x, rate, info = load_audio(source)
        entry = {'file': source, 'rate': rate, 'channels': x.shape[1], 'bits': info['bits'],
                 'encoding': info['encoding']}
        entry.update(measure(x, rate, args.silence_db))
        if args.check:
            flags = []
            if entry['clipped_samples']:
                flags.append('clipping')
            if entry['true_peak_dbtp'] is not None and entry['true_peak_dbtp'] > args.ceiling:
                flags.append('true peak above %.1f dBTP' % args.ceiling)
            if entry['dc_offset'] > 0.01:
                flags.append('dc offset')
            if entry['leading_silence_ms'] is not None and entry['leading_silence_ms'] > 30:
                flags.append('leading silence over 30 ms')
            if entry['leading_silence_ms'] is None:
                flags.append('silent')
            entry['flags'] = flags
            failed = failed or bool(flags)
        files.append(entry)
    return emit({'command': 'analyze', 'files': files}, 1 if failed else 0)


def command_split(args):
    x, rate, info = load_audio(args.input)
    segments, skipped = envelope_segments(x, rate, args.silence_db, args.min_gap_ms, args.min_length_ms)
    pad = int(rate * args.pad_ms / 1000.0)
    out_dir = Path(args.out)
    bits = info['bits'] if info['encoding'] == 'pcm' and info['bits'] in (16, 24) else 24
    takes = []
    for i, (s, e) in enumerate(segments):
        left = 0 if i == 0 else (segments[i - 1][1] + s) // 2
        right = len(x) if i == len(segments) - 1 else (e + segments[i + 1][0]) // 2
        a, b = max(left, s - pad), min(right, e + pad)
        target = out_dir / ('%s_%02d.wav' % (Path(args.input).stem, i + 1))
        write_wav(target, x[a:b], rate, bits, dither=False, sources=[args.input])
        takes.append({'file': str(target), 'start_s': round(a / rate, 4), 'end_s': round(b / rate, 4)})
    return emit({'command': 'split', 'input': args.input, 'takes': takes,
                 'skipped_short': [[round(s / rate, 4), round(e / rate, 4)] for s, e in skipped]})


def fade(x, fade_in, fade_out):
    x = x.copy()
    if fade_in > 0:
        n = min(fade_in, len(x))
        x[:n] *= (0.5 - 0.5 * np.cos(np.pi * np.arange(n) / n))[:, None]
    if fade_out > 0:
        n = min(fade_out, len(x))
        x[len(x) - n:] *= (0.5 + 0.5 * np.cos(np.pi * (np.arange(n) + 1) / n))[:, None]  # ends at 0
    return x


def normalize(x, rate, method, target, ceiling):
    """Gain only: reach the target, but never above the true-peak ceiling."""
    tp = true_peak(x)
    if tp <= 0:
        return x, {'skipped': 'silent'}
    if method == 'peak':
        measured = 20.0 * math.log10(tp)
    else:
        levels = loudness(x, rate)
        measured = levels['integrated_lufs' if method == 'integrated' else 'max_momentary_lufs']
        if measured is None:
            return x, {'skipped': 'below the -70 LUFS gate'}
    gain = target - measured
    limited = 20.0 * math.log10(tp) + gain > ceiling
    if limited:
        gain = ceiling - 20.0 * math.log10(tp)
    return x * 10.0 ** (gain / 20.0), {'method': method, 'target': target, 'measured': round(measured, 2),
                                      'gain_db': round(gain, 2), 'target_reached': not limited,
                                      'limited_by_ceiling': limited}


def command_process(args):
    if args.normalize and args.target is None:
        if args.normalize != 'peak':
            raise SystemExit('--normalize %s needs --target (LUFS)' % args.normalize)
        args.target = -1.0
    out_dir, files = Path(args.out), []
    for source in args.inputs:
        x, rate, info = load_audio(source)
        steps = []
        if args.mono and x.shape[1] > 1:
            x = x.mean(axis=1, keepdims=True)
            steps.append('mono')
        if args.trim:
            lead, trail = edge_silence(x, rate, args.silence_db)
            if lead is not None:
                start = max(0, lead - int(rate * PREROLL_MS / 1000.0))
                end = min(len(x), len(x) - trail + int(rate * POSTROLL_MS / 1000.0))
                x = x[start:end]
                steps.append('trim from %.1f ms, kept %.1f ms' % (start * 1000.0 / rate, len(x) * 1000.0 / rate))
        x = fade(x, int(rate * args.fade_in_ms / 1000.0), int(rate * args.fade_out_ms / 1000.0))
        if args.rate and args.rate != rate:
            g = math.gcd(args.rate, rate)
            x = signal.resample_poly(x, args.rate // g, rate // g, axis=0)
            steps.append('resample %d -> %d' % (rate, args.rate))
            rate = args.rate
        gain = None
        if args.normalize:
            x, gain = normalize(x, rate, args.normalize, args.target, args.ceiling)
        target = out_dir / (Path(source).stem + '.wav')
        write_wav(target, x, rate, args.bits, dither=args.bits == 16 and not args.no_dither, sources=args.inputs)
        written, _, _ = read_wav(target)
        entry = {'file': source, 'output': str(target), 'steps': steps, 'normalize': gain,
                 'rate': rate, 'channels': written.shape[1], 'bits': args.bits}
        entry.update(measure(written, rate, args.silence_db))
        files.append(entry)
    return emit({'command': 'process', 'files': files})


def spectrum_difference(a, b, rate):
    """Mean absolute dB difference between the magnitude spectra of two windows."""
    n = min(len(a), len(b))
    if n < 16:
        return None
    w = np.hanning(n)
    sa = np.abs(np.fft.rfft(a[:n].mean(axis=1) * w)) + 1e-9
    sb = np.abs(np.fft.rfft(b[:n].mean(axis=1) * w)) + 1e-9
    return round(float(np.mean(np.abs(20 * np.log10(sa) - 20 * np.log10(sb)))), 2)


def seam(x, rate):
    n = max(16, int(rate * 0.02))
    return {'sample_jump': round(float(np.abs(x[-1] - x[0]).max()), 5),
            'spectral_difference_db': spectrum_difference(x[-n:], x[:n], rate)}


def command_loop(args):
    x, rate, info = load_audio(args.input)
    start = int(rate * args.start_ms / 1000.0)
    end = len(x) if args.end_ms is None else int(rate * args.end_ms / 1000.0)
    x = x[start:end]
    c = int(rate * args.crossfade_ms / 1000.0)
    if c < 1 or len(x) <= 2 * c:
        raise SystemExit('the region must be longer than twice the crossfade')
    before = seam(x, rate)
    t = (np.arange(c) + 0.5) / c
    head = x[:c] * np.sin(0.5 * np.pi * t)[:, None]
    tail = x[len(x) - c:] * np.cos(0.5 * np.pi * t)[:, None]
    y = np.vstack([head + tail, x[c:len(x) - c]])
    bits = info['bits'] if info['encoding'] == 'pcm' and info['bits'] in (16, 24) else 24
    write_wav(args.out, y, rate, bits, dither=bits == 16, sources=[args.input])
    return emit({'command': 'loop', 'output': args.out, 'loop_length_s': round(len(y) / rate, 4),
                 'crossfade_ms': args.crossfade_ms, 'seam_before': before, 'seam_after': seam(y, rate)})


# ---------------------------------------------------------------- review sheet

COLOUR_STOPS = [(0, 0, 4), (40, 11, 84), (101, 21, 110), (159, 42, 99), (212, 72, 66),
                (245, 125, 21), (250, 193, 39), (252, 255, 164)]


def colour_lut():
    stops = np.array(COLOUR_STOPS, np.float64)
    pos = np.linspace(0, 1, len(stops))
    t = np.linspace(0, 1, 256)
    return np.stack([np.interp(t, pos, stops[:, i]) for i in range(3)], 1).astype(np.uint8)


def nice_step(duration):
    for step in (0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300):
        if duration / step <= 10:
            return step
    return 600


def spectrogram(mono, rate, columns, rows, floor_db=-100.0):
    n_fft = 2 ** max(8, int(round(math.log2(rate * 0.021))))
    hop = max(1, int(math.ceil(len(mono) / columns)))
    padded = np.concatenate([np.zeros(n_fft // 2), mono, np.zeros(n_fft)])
    frames = np.lib.stride_tricks.sliding_window_view(padded, n_fft)[::hop][:max(1, int(math.ceil(len(mono) / hop)))]
    window = np.hanning(n_fft)
    mag = np.abs(np.fft.rfft(frames * window, axis=1)) / (window.sum() / 2.0)
    level = 20.0 * np.log10(mag + 1e-12)
    nyquist = rate / 2.0
    freqs = 20.0 * (nyquist / 20.0) ** (np.arange(rows)[::-1] / max(1, rows - 1))
    bins = np.clip(np.round(freqs / (rate / n_fft)).astype(int), 0, level.shape[1] - 1)
    cols = np.clip((np.arange(columns) * level.shape[0] / columns).astype(int), 0, level.shape[0] - 1)
    grid = level[cols][:, bins].T
    return np.clip((grid - floor_db) / -floor_db, 0, 1), freqs


def command_sheet(args):
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.load_default()
    width, row_h, margin = args.width, args.row_height, 40
    plot_w = width - margin - 4
    label_h, tick_h = 14, 14
    wave_h = int((row_h - label_h - tick_h) * 0.4)
    spec_h = row_h - label_h - tick_h - wave_h
    sheet = Image.new('RGB', (width, row_h * len(args.inputs)), (18, 18, 24))
    draw = ImageDraw.Draw(sheet)
    lut = colour_lut()
    rows = []
    for r, source in enumerate(args.inputs):
        x, rate, _ = load_audio(source)
        top = r * row_h
        stats = measure(x, rate)
        fmt = lambda v: '-inf' if v is None else '%.1f' % v
        if args.labels:
            text = '%s  %.2fs  %d Hz %dch  peak %s dBFS  TP %s dBTP  int %s LUFS  M max %s LUFS' % (
                Path(source).name, stats['duration_s'], rate, x.shape[1], fmt(stats['peak_dbfs']),
                fmt(stats['true_peak_dbtp']), fmt(stats['integrated_lufs']), fmt(stats['max_momentary_lufs']))
            draw.text((4, top + 1), text, fill=(230, 230, 230), font=font)
        wave_top, spec_top = top + label_h, top + label_h + wave_h
        mid = wave_top + wave_h // 2
        draw.line([(margin, mid), (margin + plot_w, mid)], fill=(60, 60, 70))
        n = len(x)
        level = x.max(axis=1) if n else np.zeros(1)
        low = x.min(axis=1) if n else np.zeros(1)
        for c in range(plot_w):
            a, b = int(c * n / plot_w), max(int(c * n / plot_w) + 1, int((c + 1) * n / plot_w))
            if a >= n:
                break
            hi, lo = float(level[a:b].max()), float(low[a:b].min())
            colour = (235, 70, 60) if max(hi, -lo) >= 0.999 else (120, 190, 240)
            y1 = mid - int(hi * (wave_h // 2 - 1))
            y2 = mid - int(lo * (wave_h // 2 - 1))
            draw.line([(margin + c, y1), (margin + c, y2)], fill=colour)
        if n:
            grid, freqs = spectrogram(x.mean(axis=1), rate, plot_w, spec_h)
            sheet.paste(Image.fromarray(lut[(grid * 255).astype(np.uint8)]), (margin, spec_top))
            for f, label in ((100, '100'), (1000, '1k'), (10000, '10k')):
                if f < rate / 2:
                    y = spec_top + int(round((1 - math.log(f / 20.0) / math.log(rate / 40.0)) * (spec_h - 1)))
                    draw.line([(margin - 4, y), (margin - 1, y)], fill=(200, 200, 200))
                    draw.text((4, y - 6), label, fill=(200, 200, 200), font=font)
        duration = n / rate if rate else 0
        if duration > 0:
            step = nice_step(duration)
            t = 0.0
            while t <= duration + 1e-9:
                xpos = margin + int(t / duration * (plot_w - 1))
                draw.line([(xpos, spec_top + spec_h), (xpos, spec_top + spec_h + 3)], fill=(200, 200, 200))
                draw.text((xpos + 2, spec_top + spec_h + 1), ('%gs' % round(t, 3)), fill=(200, 200, 200), font=font)
                t += step
        rows.append({'file': source, 'duration_s': stats['duration_s']})
    out = Path(args.out)
    guard(out, args.inputs)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return emit({'command': 'sheet', 'output': str(out), 'size': list(sheet.size), 'rows': rows})


# ---------------------------------------------------------------- CLI

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('pcm2wav', help='wrap raw PCM in a WAV header')
    p.add_argument('input')
    p.add_argument('--out', required=True)
    p.add_argument('--rate', type=int, required=True)
    p.add_argument('--channels', type=int, default=1)
    p.add_argument('--sample-format', choices=['s16le', 's24le', 's32le', 'f32le'], default='s16le')
    p.add_argument('--bits', type=int, choices=[16, 24], help='output bits for s32le/f32le input (default 24)')

    p = sub.add_parser('analyze', help='levels, loudness, silence and takes')
    p.add_argument('inputs', nargs='+')
    p.add_argument('--silence-db', type=float, default=-50.0)
    p.add_argument('--check', action='store_true', help='flag problems and exit 1 when any are found')
    p.add_argument('--ceiling', type=float, default=-1.0, help='true-peak ceiling for --check (dBTP)')

    p = sub.add_parser('split', help='one WAV per take, split at silences')
    p.add_argument('input')
    p.add_argument('--out', required=True)
    p.add_argument('--silence-db', type=float, default=-45.0)
    p.add_argument('--min-gap-ms', type=float, default=150.0)
    p.add_argument('--min-length-ms', type=float, default=40.0)
    p.add_argument('--pad-ms', type=float, default=10.0)

    p = sub.add_parser('process', help='mono, trim, fades, resample, normalise')
    p.add_argument('inputs', nargs='+')
    p.add_argument('--out', required=True, help='output folder')
    p.add_argument('--trim', action='store_true', help='trim edge silence, keeping 5 ms pre-roll and 10 ms post-roll')
    p.add_argument('--silence-db', type=float, default=-50.0)
    p.add_argument('--fade-in-ms', type=float, default=2.0)
    p.add_argument('--fade-out-ms', type=float, default=20.0)
    p.add_argument('--mono', action='store_true')
    p.add_argument('--normalize', choices=['peak', 'momentary', 'integrated'],
                   help='peak = true peak dBTP; momentary = max 400 ms LUFS; integrated = gated LUFS')
    p.add_argument('--target', type=float, help='dBTP for peak (default -1), LUFS otherwise (required)')
    p.add_argument('--ceiling', type=float, default=-1.0, help='true-peak ceiling (dBTP); gain is reduced to respect it')
    p.add_argument('--rate', type=int, help='resample to this rate')
    p.add_argument('--bits', type=int, choices=[16, 24], default=16)
    p.add_argument('--no-dither', action='store_true', help='skip TPDF dither on 16-bit output')

    p = sub.add_parser('loop', help='seamless loop by crossfading the tail into the head')
    p.add_argument('input')
    p.add_argument('--out', required=True)
    p.add_argument('--crossfade-ms', type=float, default=200.0)
    p.add_argument('--start-ms', type=float, default=0.0)
    p.add_argument('--end-ms', type=float)

    p = sub.add_parser('sheet', help='waveform and spectrogram review image')
    p.add_argument('inputs', nargs='+')
    p.add_argument('--out', required=True)
    p.add_argument('--width', type=int, default=900)
    p.add_argument('--row-height', type=int, default=140)
    p.add_argument('--labels', action='store_true')
    return parser


COMMANDS = {'pcm2wav': command_pcm2wav, 'analyze': command_analyze, 'split': command_split,
            'process': command_process, 'loop': command_loop, 'sheet': command_sheet}


def main(argv=None):
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args)


if __name__ == '__main__':
    sys.exit(main())
