"""A small text score for stings, fanfares and short loops, rendered with
instruments.py.

    tempo 120                     # beats per minute
    loop 8                        # optional: a loop this many beats long
    humanize 0.006                # optional: timing wander in seconds (seeded)
    track lead reed pan=0.2 gain=-2 velocity=0.8
      G4:1/2 C5:1/2 E5:1/2 G5:3/2 | E5:1/2 G5:2
    track chords pluck pan=-0.3 strum=0.015
      C3+G3+C4+E4:2 F3+C4+F4+A4:2
    track beat drum
      low:1 high:1/2 high:1/2 rim:1 r:1

A token is NOTE:BEATS, optionally @VELOCITY: a note name (C4 is middle C,
sharps #, flats b) or a MIDI number, a chord joined with +, `r` for a rest,
or a drum hit (low, high, rim). Beats may be whole, decimal or a fraction.
`|` marks bars and is ignored; `#` after a space starts a comment. Track
options: pan (-1 to 1), gain (dB), velocity (0 to 1, the default for its
notes), octave (shift), strum (seconds between a chord's notes). Several
lines may follow a track line.

A one-shot cue lasts until the last note's ring has died. A loop is exactly
`loop` beats long, and every tail that runs past its end is folded back onto
its start, so it repeats without a seam.
"""
import re
from fractions import Fraction

import numpy as np

from dsp import fold_loop, mix_into, place_stereo, samples
from instruments import DRUM_HITS, INSTRUMENTS, UNPITCHED, note_freq


class ScoreError(ValueError):
    pass


def parse_beats(text, where):
    try:
        value = float(Fraction(text))
    except (ValueError, ZeroDivisionError):
        raise ScoreError('%s: %r is not a number of beats' % (where, text))
    if value <= 0:
        raise ScoreError('%s: a duration must be positive' % where)
    return value


def parse(text):
    """Score text -> {'tempo', 'loop', 'humanize', 'tracks': [...]}; each track has
    its instrument, options and notes [(beat, beats, [pitches or hits], velocity)]."""
    score = {'tempo': 120.0, 'loop': None, 'humanize': 0.0, 'tracks': []}
    track = None
    for number, raw in enumerate(text.splitlines(), 1):
        line = re.sub(r'(^|\s)#.*$', '', raw).strip()  # a comment; G#4 is a note
        where = 'line %d' % number
        if not line:
            continue
        words = line.split()
        if words[0] in ('tempo', 'loop', 'humanize') and len(words) == 2:
            try:
                score[words[0]] = float(Fraction(words[1]))
            except ValueError:
                raise ScoreError('%s: %s needs a number' % (where, words[0]))
            continue
        if words[0] == 'track':
            if len(words) < 3 or words[2] not in INSTRUMENTS:
                raise ScoreError('%s: write "track NAME INSTRUMENT [options]"; instruments: %s'
                                 % (where, ', '.join(sorted(INSTRUMENTS))))
            options = {'pan': 0.0, 'gain': 0.0, 'velocity': 0.8, 'octave': 0, 'strum': 0.0}
            for word in words[3:]:
                key, _, value = word.partition('=')
                if key not in options or not value:
                    raise ScoreError('%s: unknown track option %r' % (where, word))
                try:
                    options[key] = int(value) if key == 'octave' else float(value)
                except ValueError:
                    raise ScoreError('%s: %s needs a number' % (where, key))
            track = {'name': words[1], 'instrument': words[2], 'options': options, 'notes': [], 'beat': 0.0}
            score['tracks'].append(track)
            continue
        if track is None:
            raise ScoreError('%s: notes before any track line' % where)
        for token in words:
            if token == '|':
                continue
            match = re.fullmatch(r'([^:@]+):([0-9./]+)(?:@([0-9.]+))?', token)
            if not match:
                raise ScoreError('%s: %r is not NOTE:BEATS[@VELOCITY]' % (where, token))
            what, beats, velocity = match.group(1), parse_beats(match.group(2), where), match.group(3)
            if what != 'r':
                parts = what.split('+')
                if track['instrument'] in UNPITCHED:
                    bad = [p for p in parts if p not in DRUM_HITS]
                else:
                    bad = []
                    for p in parts:
                        try:
                            note_freq(p)
                        except (ValueError, IndexError):
                            bad.append(p)
                if bad:
                    raise ScoreError('%s: %s is not a %s' % (where, ', '.join(bad),
                                                             'drum hit' if track['instrument'] in UNPITCHED else 'note'))
                track['notes'].append((track['beat'], beats, parts,
                                       float(velocity) if velocity else track['options']['velocity']))
            track['beat'] += beats
    if not score['tracks']:
        raise ScoreError('the score has no tracks')
    if score['tempo'] <= 0:
        raise ScoreError('tempo must be positive')
    return score


def length_beats(score):
    return score['loop'] or max(t['beat'] for t in score['tracks'])


def render(text, rng, loop=None):
    """Stereo samples [n, 2] of a score. `loop` overrides the score's own loop
    setting (True: loop to its length in beats; False: a one-shot)."""
    score = parse(text) if isinstance(text, str) else text
    beat_s = 60.0 / score['tempo']
    total = length_beats(score) * beat_s
    as_loop = bool(score['loop']) if loop is None else bool(loop)
    tail = 4.0
    out = np.zeros((samples(total + tail), 2))
    for track in score['tracks']:
        options = track['options']
        play = INSTRUMENTS[track['instrument']]
        part = np.zeros(len(out))
        for beat, beats, parts, velocity in track['notes']:
            seconds = beats * beat_s
            for i, what in enumerate(parts):
                v = float(np.clip(velocity * rng.uniform(0.92, 1.0), 0.05, 1.0))
                if track['instrument'] in UNPITCHED:
                    note = play(rng, what, seconds, v)
                else:
                    note = play(rng, note_freq(what) * 2.0 ** options['octave'], seconds, v)
                at = beat * beat_s + i * options['strum'] + score['humanize'] * rng.uniform(-1, 1)
                mix_into(part, note, max(0.0, at))
        out += place_stereo(part, options['pan']) * 10.0 ** (options['gain'] / 20.0)
    if as_loop:
        return fold_loop(out, total)
    level = np.abs(out).max(axis=1)
    peak = level.max() if len(level) else 0.0
    if peak > 0:
        last = np.nonzero(level > peak * 10 ** (-60 / 20))[0][-1]
        out = out[:max(last + samples(0.02), samples(total))]
    return out


def describe(text):
    score = parse(text)
    beats = length_beats(score)
    return {'tempo': score['tempo'], 'beats': beats, 'seconds': round(beats * 60.0 / score['tempo'], 3),
            'loop': bool(score['loop']),
            'tracks': [{'name': t['name'], 'instrument': t['instrument'], 'notes': len(t['notes'])}
                       for t in score['tracks']]}
