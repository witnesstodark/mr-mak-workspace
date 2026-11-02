"""Turn a model's raw samples into a delivered file. One-shots lose their
silent edges and get raised-cosine fades; then one gain sets the level
(maximum momentary loudness for one-shots, gated integrated loudness for
loops) as close to the event's target as the true-peak ceiling allows. No
limiter or compressor touches the sound. When the ceiling stops a
sound short of its target, the report says by how much, so the model (a
softer contact, more body) or the target can change instead.

Loudness, true peak and WAV encoding come from sound-effects-workflow's
audio_tool.py, so both skills measure alike.
"""
import importlib.util
import math
from pathlib import Path

import numpy as np

from dsp import SR

CEILING = -1.0  # dBTP
MARGIN = 0.05  # dB kept under the ceiling for 16-bit rounding and dither


def _load_audio_tool():
    here = Path(__file__).resolve().parent
    for candidate in (here / 'audio_tool.py',
                      here.parent.parent / 'sound-effects-workflow' / 'scripts' / 'audio_tool.py'):
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location('audio_tool', candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ImportError('procedural-audio needs sound-effects-workflow/scripts/audio_tool.py beside it '
                      '(copy both skills, or put audio_tool.py in this scripts folder)')


audio_tool = _load_audio_tool()


def frames(x):
    """Shape samples as [n, channels], the layout audio_tool works on."""
    return np.reshape(x, (len(x), -1))


def trim(x, onset_db=-48.0, tail_db=-60.0, keep_before_s=0.0012, keep_after_s=0.012, fade_in_s=0.0006,
         fade_out_s=0.018):
    """Remove silence: start `keep_before_s` before the first sample within
    `onset_db` of the peak, stop `keep_after_s` after the last sample within
    `tail_db`, and fade both ends with raised cosines."""
    y = frames(np.asarray(x, np.float64))
    level = np.max(np.abs(y), axis=1)
    loudest = float(level.max(initial=0.0))
    if loudest == 0.0:
        return x
    above_onset = np.flatnonzero(level >= loudest * 10.0 ** (onset_db / 20.0))
    above_tail = np.flatnonzero(level >= loudest * 10.0 ** (tail_db / 20.0))
    first = max(0, above_onset[0] - int(round(keep_before_s * SR)))
    last = min(len(y), above_tail[-1] + 1 + int(round(keep_after_s * SR)))
    y = audio_tool.fade(y[first:last], max(1, int(round(fade_in_s * SR))), max(1, int(round(fade_out_s * SR))))
    return y[:, 0] if np.ndim(x) == 1 else y


def level_of(x, method):
    """LUFS by the event's measure: 'integrated' for loops, else max momentary."""
    report = audio_tool.loudness(frames(x), SR)
    return report['max_momentary_lufs'] if method != 'integrated' else report['integrated_lufs']


def normalise(x, target, method, ceiling=CEILING):
    """Gain to the target, lowered if needed so the true peak stays under the
    ceiling. Returns (samples, report)."""
    measured = level_of(x, method)
    peak = audio_tool.true_peak(frames(x))
    if measured is None or peak <= 0:
        return x, {'gain_db': 0.0, 'measured_lufs': measured, 'target_reached': False, 'shortfall_db': None}
    wanted = target - measured
    allowed = ceiling - MARGIN - 20.0 * math.log10(peak)
    applied = min(wanted, allowed)
    return x * 10.0 ** (applied / 20.0), {
        'gain_db': round(applied, 2), 'measured_lufs': round(measured, 2),
        'target_reached': wanted <= allowed, 'shortfall_db': round(max(0.0, wanted - allowed), 2)}


def master(x, target, loop=False, ceiling=CEILING):
    """One-shots are trimmed and faded and set by momentary loudness; loops
    keep every sample (a fade would break the seam) and are set by integrated
    loudness."""
    x = np.asarray(x, np.float64)
    if not loop:
        x = trim(x)
    return normalise(x, target, 'integrated' if loop else 'momentary', ceiling)


def encode(x, bits, seed):
    """WAV bytes. 16-bit output is dithered with noise seeded by the take, so
    rendering twice gives identical files."""
    dither = bits == 16
    return audio_tool.wav_bytes(frames(x), SR, bits, dither, seed)


def measure(x):
    return audio_tool.measure(frames(x), SR)


def seam(x, frame_s=0.05):
    """How a loop's end meets its start, judged against the loop itself: the
    wrap's sample step over the largest step inside, and the level change
    between the last and first 50 ms beside the loop's usual change from one
    50 ms frame to the next (music moves more than rain, and that is fine)."""
    y = frames(x)
    inside = np.abs(np.diff(y, axis=0)).max(axis=1)
    jump = float(np.abs(y[0] - y[-1]).max())
    n = int(round(frame_s * SR))
    count = len(y) // n
    level = 10.0 * np.log10(np.mean(y[:count * n].reshape(count, n, -1) ** 2, axis=(1, 2)) + 1e-12)
    end = 10.0 * math.log10(float(np.mean(y[-n:] ** 2)) + 1e-12)
    return {'jump_ratio': round(jump / max(float(inside.max()), 1e-12), 3),
            'level_step_db': round(level[0] - end, 2),
            'usual_step_db': round(float(np.percentile(np.abs(np.diff(level)), 95)), 2)}
