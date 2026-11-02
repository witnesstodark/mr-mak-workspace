"""Instruments modelled for short musical cues, one note at a time.

Each instrument is `play(rng, freq, seconds, velocity)` and returns mono
samples: the note held for `seconds`, then its release or natural ring.
Velocity (0 to 1) sets loudness and brightness, as a harder pluck, strike
or breath does. The drum takes a hit name instead of a pitch (DRUM_HITS).

- pluck: a plucked string as a travelling wave in a delay loop
  (Karplus-Strong): the loop's length sets the pitch, a gentle low-pass in
  the loop makes high harmonics die first, the shape of the initial
  displacement sets the plucking point and brightness, and two strings a
  few cents apart beat; a few body resonances add warmth.
- reed: a reed that chokes the airflow at each cycle: a sine driven into
  soft clipping gives mostly odd harmonics (a cylindrical bore), brighter
  as the breath pressure builds; breath turbulence follows the opening.
- bowed: a bowed string's stick-and-slip as a sawtooth-like series, slow
  attack, delayed vibrato, bow noise and a body's resonances.
- flute: an air jet across a pipe: a strong fundamental, weak upper
  harmonics, breath noise around the note and a chiff at the start.
- drum: a circular membrane's modes from the zeros of Bessel functions,
  each excited by how far from the centre it is struck: the centre gives a
  deep, round note, near the rim a bright, short one; the rim hits the shell.
- bell: an idealised tuned bell (hum, prime, minor third, fifth, nominal and
  upper partials), each a slowly beating pair, higher ones dying faster.
- mallet: a tuned bar (marimba 1 : 4 : 10, or xylophone 1 : 3 : 6) struck by a
  mallet whose hardness follows velocity, over a resonator tube.
"""
import numpy as np
from scipy.special import jn_zeros, jv

from dsp import (SR, butter_band, butter_high, butter_low, contact_force, fade_tail, hiss, impact, mix_into,
                 note_envelope, peak_normalise, resonance, samples, timeline)

SEMITONES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def note_freq(name):
    """'A4' -> 440.0; sharps '#', flats 'b'; or a MIDI number such as '69'."""
    if name.lstrip('-').isdigit():
        midi = int(name)
    else:
        letter, rest = name[:1].upper(), name[1:]
        if letter not in SEMITONES or not rest:
            raise ValueError('not a note: %r' % name)
        accidental = 0
        while rest[:1] in ('#', 'b') and rest:
            accidental += 1 if rest[0] == '#' else -1
            rest = rest[1:]
        midi = 12 * (int(rest) + 1) + SEMITONES[letter] + accidental
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def _wander(rng, n, cents):
    """Slow pitch wander as a factor: no player holds a pitch perfectly still."""
    w = butter_low(rng.normal(size=n), 3.0, 1)
    w /= max(np.max(np.abs(w)), 1e-12)
    return 2.0 ** (cents * w / 1200.0)


def _vibrato(n, rate, depth, delay, rng):
    t = np.arange(n) / SR
    onset = np.clip((t - delay) / 0.3, 0.0, 1.0)
    return 1.0 + depth * onset * np.sin(2 * np.pi * rate * t + rng.uniform(0, 2 * np.pi))


# ---------------------------------------------------------------- strings and winds

def _string(rng, freq, n_out, velocity, position, sustain):
    """One string by Karplus-Strong, rendered at an integer loop length and
    resampled to the exact pitch."""
    loop = max(4, int(round(SR / freq)))
    natural = SR / (loop + 0.5)  # the two-point average adds half a sample of delay
    ratio = freq / natural
    n_loop = int(np.ceil(n_out * ratio)) + loop + 2
    shape = rng.uniform(-1.0, 1.0, loop)
    smooth = 1 + int(round((1.0 - velocity) * 5))  # a soft pluck is a rounder initial shape
    shape = np.convolve(np.concatenate([shape, shape[:smooth]]), np.ones(smooth) / smooth, 'valid')[:loop]
    shape -= np.roll(shape, max(1, int(round(position * loop))))  # no motion at the plucking point
    gain = 10.0 ** (-3.0 / (sustain * natural))  # -60 dB after `sustain` seconds, before the averaging loss
    y = np.zeros(n_loop + 1)
    y[1:loop + 1] = shape
    for start in range(loop + 1, len(y), loop):
        end = min(start + loop, len(y))
        y[start:end] = gain * 0.5 * (y[start - loop:end - loop] + y[start - loop - 1:end - loop - 1])
    position_out = np.arange(n_out) * ratio
    return np.interp(position_out, np.arange(len(y) - 1), y[1:])


def pluck(rng, freq, seconds, velocity=0.8, position=0.16, release=0.12):
    n = samples(seconds + release)
    sustain = 0.6 + 1.6 * (220.0 / freq) ** 0.5
    cents = rng.uniform(1.0, 2.5)
    out = _string(rng, freq, n, velocity, position, sustain)
    out += 0.8 * _string(rng, freq * 2.0 ** (cents / 1200.0), n, velocity, position + 0.02, sustain)
    out += 0.25 * (resonance(out, 105.0, 4.0) + resonance(out, 215.0, 5.0) + resonance(out, 430.0, 6.0))
    out = butter_high(out, 50.0)
    return peak_normalise(out * note_envelope(seconds, 0.0005, release)) * velocity


def reed(rng, freq, seconds, velocity=0.8, release=0.06):
    n = samples(seconds + release)
    t = np.arange(n) / SR
    phase = 2 * np.pi * np.cumsum(freq * _wander(rng, n, 4.0)) / SR
    pressure = (1.0 - np.exp(-t / 0.02)) * (1.5 + 3.0 * velocity)
    flow = np.tanh(pressure * (np.sin(phase) + 0.06))  # the reed closing off the air
    tone = butter_high(flow, 60.0)
    tone += 0.6 * resonance(tone, 900.0 + 900.0 * velocity, 1.5)
    breath = butter_high(rng.normal(size=n), 2000.0) * 0.02 * (1.0 + flow)
    out = (tone + breath) * note_envelope(seconds, 0.025, release)
    return peak_normalise(butter_low(out, 9000.0)) * velocity


def bowed(rng, freq, seconds, velocity=0.8, release=0.15):
    n = samples(seconds + release)
    phase = 2 * np.pi * np.cumsum(freq * _vibrato(n, 5.3, 0.004, 0.25, rng) * _wander(rng, n, 2.0)) / SR
    tone = np.zeros(n)
    k = 1
    while freq * k < 9000:
        tone += np.sin(k * phase) / k ** (1.1 - 0.15 * velocity)
        k += 1
    body = sum(g * resonance(tone, f, q) for f, q, g in ((290, 4, 1.0), (520, 4, 0.6), (1100, 3, 0.5),
                                                           (2900, 3, 0.4)))
    noise = butter_band(rng.normal(size=n), 2000, 7000) * 0.02 * (0.6 + velocity)
    out = (peak_normalise(0.5 * tone + body) + noise) * note_envelope(seconds, 0.12 - 0.06 * velocity, release)
    return peak_normalise(out) * velocity


def flute(rng, freq, seconds, velocity=0.8, release=0.08):
    n = samples(seconds + release)
    phase = 2 * np.pi * np.cumsum(freq * _vibrato(n, 5.0, 0.005, 0.18, rng) * _wander(rng, n, 3.0)) / SR
    partials = ((1, 1.0), (2, 0.22 + 0.15 * velocity), (3, 0.1), (4, 0.04), (5, 0.02))
    tone = sum(a * np.sin(k * phase) for k, a in partials)
    breath = butter_band(rng.normal(size=n), freq * 0.9, min(freq * 5.0, 15000.0)) * (0.05 + 0.04 * velocity)
    chiff = np.zeros(n)
    mix_into(chiff, hiss(rng, 0.04, freq, min(freq * 6.0, 15000.0), 0.012, attack=0.003) * 0.25, 0.0)
    out = (tone + breath + chiff) * note_envelope(seconds, 0.045, release)
    return peak_normalise(out) * velocity


# ---------------------------------------------------------------- struck instruments

# Membrane modes (m nodal diameters, k nodal circles): frequency ratio to the
# fundamental is the Bessel zero j(m, k) / j(0, 1).
MEMBRANE = [(m, k, jn_zeros(m, k)[-1] / jn_zeros(0, 1)[0]) for m in range(4) for k in range(1, 4)]
DRUM_HITS = {
    # where struck (0 centre, 1 edge), contact (s), decay of the fundamental (s), shell click, slap band
    'low': (0.04, 0.003, 0.4, 0.0, (180, 1500)),
    'high': (0.78, 0.0007, 0.18, 0.08, (1200, 6500)),
    'rim': (0.94, 0.0004, 0.1, 0.7, (2500, 9000)),
}


def drum(rng, hit='low', seconds=0.0, velocity=0.8, pitch=88.0):
    if hit not in DRUM_HITS:
        raise ValueError('drum hits are %s, not %r' % (', '.join(DRUM_HITS), hit))
    where, contact_s, tau0, shell, (slap_lo, slap_hi) = DRUM_HITS[hit]
    length = 1.0
    t = timeline(length)
    f0 = pitch * rng.uniform(0.98, 1.02)
    tension = 1.0 + 0.05 * velocity * np.exp(-t / 0.02)  # a hard hit stretches the skin for a moment
    angle = rng.uniform(0, 2 * np.pi)
    out = np.zeros(len(t))
    for m, k, ratio in MEMBRANE:
        level = abs(jv(m, ratio * jn_zeros(0, 1)[0] * where)) * (abs(np.cos(m * angle)) if m else 1.0)
        if level < 1e-3:
            continue
        phase = 2 * np.pi * np.cumsum(f0 * ratio * tension) / SR
        out += level * np.sin(phase) * np.exp(-t / (tau0 * ratio ** -1.2)) * (1 if rng.random() < 0.5 else -1)
    out = np.convolve(out, contact_force(contact_s * (1.3 - 0.4 * velocity)))[:len(t)]
    if shell:
        click = impact(rng, 0.0003, [1700, 2950, 4400], [0.02, 0.012, 0.008], [1.0, 0.6, 0.3], 0.06)
        mix_into(out, peak_normalise(click) * shell * np.max(np.abs(out)), 0.0)
    slap = hiss(rng, 0.03, slap_lo, slap_hi, 0.004 if hit == 'low' else 0.002)
    mix_into(out, peak_normalise(slap) * (0.15 if hit == 'low' else 0.3) * np.max(np.abs(out)), 0.0)
    return peak_normalise(fade_tail(out, 0.08)) * velocity


BELL_PARTIALS = [0.5, 1.0, 1.2, 1.5, 2.0, 2.5, 8.0 / 3.0, 3.0, 4.0, 16.0 / 3.0]


def bell(rng, freq, seconds, velocity=0.8, ring_s=3.0):
    length = max(seconds, ring_s)
    t = timeline(length)
    out = np.zeros(len(t))
    for ratio in BELL_PARTIALS:
        f = freq * ratio * np.exp(rng.normal(0, 0.0015))
        if f > SR * 0.45:
            continue
        level = 1.0 / (1.0 + 0.6 * abs(np.log2(ratio / 2.0))) * min(1.0, (2.0 / ratio) ** 0.5)
        tau = 0.35 * length * ratio ** -0.9
        beat = rng.uniform(0.3, 1.5)  # each partial is a close pair: the bell's slow warble
        pair = np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * (f + beat) * t)
        out += level * pair * np.exp(-t / tau)
    out = np.convolve(out, contact_force(0.0012 - 0.0006 * velocity))[:len(t)]
    return peak_normalise(fade_tail(out, length * 0.2)) * velocity


BAR_TUNINGS = {'marimba': (1.0, 3.98, 9.85), 'xylophone': (1.0, 3.0, 6.2)}


def mallet(rng, freq, seconds, velocity=0.8, muted=False, tuning='marimba'):
    ratios = np.asarray(BAR_TUNINGS[tuning]) * np.exp(rng.normal(0, 0.003, 3))
    base = 0.35 * (440.0 / freq) ** 0.5 * (0.25 if muted else 1.0)
    length = max(seconds, 0.05) + base * 3.0
    taus = base * ratios ** -0.85
    levels = [1.0, 0.25 + 0.25 * velocity, 0.06 + 0.12 * velocity]
    out = impact(rng, 0.002 - 0.0013 * velocity, freq * ratios, taus, levels, length)
    out += 0.5 * resonance(out, freq, 25.0)  # the tube under the bar sustains the fundamental
    return peak_normalise(fade_tail(butter_high(out, 60.0), min(0.08, length * 0.3))) * velocity


INSTRUMENTS = {'pluck': pluck, 'reed': reed, 'bowed': bowed, 'flute': flute, 'drum': drum, 'bell': bell,
               'mallet': mallet}
UNPITCHED = {'drum'}
