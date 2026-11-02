"""Building blocks for modelled sounds (numpy and scipy).

A sound has an exciter (something strikes, scrapes, sticks and slips, or
blows), a resonator (the modes of a plank, a blade, a skin, a string, a
bubble) and a path to the ear. The path (distance, the room) is the
engine's job, so nothing here adds reverb. Every random choice takes a
numpy Generator: a seed fixes every sample.

Conventions: 48 kHz; mono is a 1-D array and stereo [n, 2]; times and
lengths in seconds; frequencies in Hz.
"""
import numpy as np
from scipy import signal

SR = 48000


# ---------------------------------------------------------------- arrays

def samples(seconds):
    return max(0, int(round(seconds * SR)))


def timeline(seconds):
    return np.arange(samples(seconds)) / SR


def blank(seconds, channels=1):
    shape = (samples(seconds),) if channels == 1 else (samples(seconds), channels)
    return np.zeros(shape)


def db_gain(db):
    return float(np.power(10.0, db / 20.0))


def peak_normalise(x):
    """Scale so the largest magnitude is 1; silence stays silence."""
    top = float(np.max(np.abs(x), initial=0.0))
    return x * (1.0 / top) if top > 0 else x


def mix_into(dst, src, at):
    """Add src into dst from `at` seconds on; what falls outside is dropped."""
    start = samples(at) if at >= 0 else -samples(-at)
    lo, hi = max(start, 0), min(start + len(src), len(dst))
    if hi > lo:
        dst[lo:hi] += src[lo - start:hi - start]
    return dst


def stack(*parts):
    """Sum sounds that begin together but last different times."""
    longest = max(len(p) for p in parts)
    total = np.zeros((longest,) + np.shape(parts[0])[1:])
    for p in parts:
        total[:len(p)] += p
    return total


# ---------------------------------------------------------------- filters

def _design(btype, edges, order=2):
    nyquist_guard = SR * 0.48
    edges = np.clip(np.atleast_1d(np.asarray(edges, float)), 12.0, nyquist_guard)
    if btype == 'bandpass' and edges[0] >= edges[1] * 0.97:
        edges[0] = edges[1] * 0.7
    return signal.butter(order, edges if len(edges) > 1 else edges[0], btype=btype, fs=SR, output='sos')


def butter_band(x, lo, hi, order=2):
    return signal.sosfilt(_design('bandpass', [lo, hi], order), x, axis=0)


def butter_low(x, cutoff, order=2):
    return signal.sosfilt(_design('lowpass', cutoff, order), x, axis=0)


def butter_high(x, cutoff, order=2):
    return signal.sosfilt(_design('highpass', cutoff, order), x, axis=0)


def resonance(x, freq, q):
    """A narrow resonant peak, such as a body or a resonator tube."""
    b, a = signal.iirpeak(min(freq, SR * 0.45), q, fs=SR)
    return signal.lfilter(b, a, x, axis=0)


def polish(x, low=35.0, high=13000.0):
    """The final step of a model: no sub-bass rumble, no harsh top."""
    return butter_band(x, low, high, order=1)


# ---------------------------------------------------------------- envelopes

def _end_taper(env):
    """Zero the last 5 % (10 ms at most) so a ring cut by its buffer ends cleanly."""
    n = min(len(env), max(1, min(samples(0.01), len(env) // 20)))
    env[len(env) - n:] *= np.cos(0.5 * np.pi * (np.arange(1, n + 1) / n)) ** 2
    return env


def exp_decay(seconds, tau, attack=0.0):
    """Rise over `attack` (sine-squared), fall with time constant `tau`, end at zero."""
    t = timeline(seconds)
    env = np.exp(-t / tau)
    rise = min(len(env), samples(attack))
    if rise > 0:
        env[:rise] *= np.sin(0.5 * np.pi * np.arange(rise) / rise) ** 2
    return _end_taper(env)


def note_envelope(seconds, attack, release):
    """Rise, hold for `seconds`, then release: the shape of a held note."""
    env = np.ones(samples(seconds + release))
    rise, fall = max(1, samples(attack)), max(1, samples(release))
    env[:rise] = np.sin(0.5 * np.pi * np.arange(rise) / rise) ** 2
    start = max(0, len(env) - fall)
    env[start:] *= np.cos(0.5 * np.pi * np.arange(1, len(env) - start + 1) / fall) ** 2
    return env


def fade_tail(x, seconds=0.06):
    """Bring the end down to silence over `seconds`, as a hand stills a string."""
    n = min(len(x), max(1, samples(seconds)))
    ramp = np.cos(0.5 * np.pi * np.arange(1, n + 1) / n) ** 2
    y = np.array(x, dtype=float, copy=True)
    y[len(y) - n:] *= ramp if y.ndim == 1 else ramp[:, None]
    return y


# ---------------------------------------------------------------- resonators and contacts

def ring(freqs, taus, amps, seconds):
    """A resonator's impulse response: one exponentially decaying sine per mode,
    starting from zero, tapered to zero at the end. Modes above 0.45 x SR are skipped."""
    t = timeline(seconds)
    total = np.zeros(len(t))
    for f, tau, a in zip(np.atleast_1d(freqs), np.atleast_1d(taus), np.atleast_1d(amps)):
        if 0 < f < SR * 0.45 and a:
            total += a * np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
    return _end_taper(total)


def contact_force(seconds, rough=0.0, rng=None):
    """The force of two bodies meeting: a half-sine pulse (Hertzian contact) of
    unit area. Soft or heavy contacts last longer and excite fewer high modes;
    `rough` adds grit to the pulse."""
    n = max(2, samples(seconds))
    force = signal.windows.cosine(n)
    if rough and rng is not None:
        force = force * np.clip(1.0 + rough * rng.normal(size=n), 0.0, None)
    return force / force.sum()


def impact(rng, contact_s, freqs, taus, amps, seconds, rough=0.0):
    """A contact exciting a resonator. Each mode's polarity is random, as the
    struck point and the listening point differ from blow to blow."""
    polarity = np.where(rng.random(len(freqs)) < 0.5, -1.0, 1.0)
    response = ring(freqs, taus, np.asarray(amps, float) * polarity, seconds)
    return signal.oaconvolve(response, contact_force(contact_s, rough, rng))[:len(response)]


def individual(rng, freqs, spread=0.04, scale=1.0):
    """The modes of one particular object of a kind: scaled to its size, each
    shifted by a small random factor (no two planks are alike)."""
    freqs = np.asarray(freqs, float)
    return freqs * scale * np.exp(rng.normal(0.0, spread / 2.0, len(freqs)))


def material(f0, ratios, tau0, damping, fall):
    """A mode table: frequencies f0 x ratios; decay times shrinking with
    frequency (tau0 x ratio^-damping), as internal friction grows with it;
    levels falling by `fall` per mode."""
    ratios = np.asarray(ratios, float)
    return f0 * ratios, tau0 * ratios ** -damping, fall ** np.arange(len(ratios))


def low_body(freq, tau, seconds, drop=0.2, attack=0.002):
    """A heavy body set moving once: a low tone whose pitch sinks by `drop` as it settles."""
    t = timeline(seconds)
    pitch = freq * (1.0 - drop * (1.0 - np.exp(-t / max(seconds * 0.4, 1e-3))))
    return np.sin(2 * np.pi * np.cumsum(pitch) / SR) * exp_decay(seconds, tau, attack)


# ---------------------------------------------------------------- noise textures

def hiss(rng, seconds, lo, hi, tau, attack=0.0005):
    """A burst of band-limited noise: a slap, a scrape, a splash."""
    return butter_band(rng.normal(size=samples(seconds)), lo, hi) * exp_decay(seconds, tau, attack)


def crackle(rng, seconds, rate, lo, hi, grain=0.0007, fade=None, shape=1.8):
    """Many tiny clicks (grit, fibres, embers, raindrops) arriving at random at
    `rate` per second, thinning out with time constant `fade` when given.
    Levels follow a power law, so a few clicks stand out as in real crackle."""
    n_events = rng.poisson(rate * seconds)
    times = np.sort(rng.uniform(0.0, seconds, n_events))
    if fade:
        times = times[rng.random(len(times)) < np.exp(-times / fade)]
    levels = np.minimum(0.04 + 0.2 * (rng.random(len(times)) ** (-1.0 / shape) - 1.0), 1.0)
    kernels = [hiss(rng, grain * 6, lo, hi, grain, attack=0.0001) for _ in range(6)]
    out = blank(seconds)
    for at, level, pick in zip(times, levels, rng.integers(0, len(kernels), len(times))):
        mix_into(out, kernels[pick] * level, at)
    return out


def fracture(rng, seconds, count, lo, hi, mode_table=None):
    """A crack: a quick run of tiny failures, most of them early, each a sharp
    impulse; rung through the breaking object's modes when a table is given."""
    impulses = blank(seconds + 0.005)
    at = np.minimum(rng.beta(1.0, 3.0, count) * seconds, seconds)
    np.add.at(impulses, (at * SR).astype(int), rng.lognormal(0.0, 0.7, count))
    out = butter_band(impulses, lo, hi) * 0.6
    if mode_table is not None:
        freqs, taus, _ = mode_table
        response = ring(individual(rng, freqs, 0.08), taus, np.ones(len(freqs)), 0.08)
        out += signal.oaconvolve(impulses, response)[:len(impulses)] * 0.15
    return out


def rebounds(rng, first_gap, restitution, count, at=0.0, strength=1.0):
    """A dropped object hitting again and again: each flight shorter and each
    hit softer by the coefficient of restitution. Returns [(time, strength)]."""
    k = np.arange(count)
    gaps = first_gap * restitution ** k
    times = at + np.concatenate([[0.0], np.cumsum(gaps[:-1])])
    levels = strength * restitution ** k * rng.uniform(0.85, 1.08, count)
    keep = (gaps > 0.003) & (levels > 0.02)
    return [(float(t), float(s)) for t, s in zip(times[keep], levels[keep])]


# ---------------------------------------------------------------- moving air and friction

def rushing_air(rng, seconds, centre, width=0.6):
    """Noise shaped in short frames to a band around `centre` (Hz, one value
    per sample), `width` octaves wide: air whose pitch follows a speed."""
    n = samples(seconds)
    seg, hop = 512, 128
    freqs, frame_times, spec = signal.stft(rng.normal(size=n), fs=SR, nperseg=seg, noverlap=seg - hop,
                                           boundary='even')
    centres = np.interp(frame_times, np.arange(n) / SR, centre)
    octaves = np.log2(np.maximum(freqs[:, None], 1.0) / centres[None, :])
    spec *= np.exp(-0.5 * (octaves / (width / 2.0)) ** 2)
    _, air = signal.istft(spec, fs=SR, nperseg=seg, noverlap=seg - hop, boundary=True)
    return air[:n] if len(air) >= n else np.pad(air, (0, n - len(air)))


def swish(rng, seconds, lo, hi, peak=0.4, width=0.7, whistle=0.0, weight=0.0):
    """Something swung through the air: the band climbs from `lo` to `hi` as it
    speeds up, at `peak` of the way through, and falls away after; a thin
    edge adds a narrow whistle an octave up, a heavy head a low push."""
    u = timeline(seconds) / seconds
    a = 1.0 + 6.0 * peak
    b = 1.0 + 6.0 * (1.0 - peak)
    speed = u ** (a - 1) * (1 - u) ** (b - 1)
    speed /= max(speed.max(), 1e-12)
    centre = lo + (hi - lo) * speed
    out = rushing_air(rng, seconds, centre, width)
    if whistle:
        out += rushing_air(rng, seconds, centre * 2.0, 0.12) * whistle
    if weight:
        out += butter_low(rng.normal(size=len(u)), 200.0) * weight * speed
    return out * speed


def friction(rng, seconds, rate, freqs, taus, jitter=0.15):
    """Surfaces that stick and slip (a hinge, a board, a rope): a slip each
    time the accumulated motion passes a threshold, at `rate` slips per
    second (an array over time), each ringing the resonator. The slip rate
    is the pitch you hear in a creak."""
    n = samples(seconds)
    rate = np.interp(np.arange(n), np.linspace(0, n - 1, len(rate)), rate)
    progress = np.cumsum(rate * (1.0 + jitter * rng.uniform(-1, 1, n))) / SR
    slips = np.flatnonzero(np.diff(np.floor(progress)) > 0)
    impulses = np.zeros(n)
    impulses[slips] = rng.uniform(0.5, 1.0, len(slips))
    return signal.oaconvolve(impulses, ring(freqs, taus, np.ones(len(freqs)), 0.05))[:n]


def drip_bubble(rng, freq, seconds=0.06, rise=0.6, tau=0.018):
    """A bubble pinched off by a falling drop: it rings at its Minnaert
    frequency (about 3260 / radius in mm, Hz) and rises as it nears the surface."""
    t = timeline(seconds)
    pitch = freq * (1.0 + rise) ** (t / seconds)
    return np.sin(2 * np.pi * np.cumsum(pitch) / SR) * exp_decay(seconds, tau, 0.0005)


# ---------------------------------------------------------------- stereo and loops

def place_stereo(x, position):
    """Mono to stereo with constant power: -1 is left, 0 centre, 1 right."""
    p = float(np.clip(position, -1.0, 1.0))
    return np.column_stack([x * np.sqrt(0.5 * (1.0 - p)), x * np.sqrt(0.5 * (1.0 + p))])


def fold_loop(x, seconds):
    """Make a loop `seconds` long from events placed in it: whatever rings
    past the end is added back onto the start, so tails cross the seam."""
    n = samples(seconds)
    out = np.array(x[:n], dtype=float, copy=True)
    for start in range(n, len(x), n):
        part = x[start:start + n]
        out[:len(part)] += part
    return out


def blend_loop(x, seconds, overlap):
    """Make a seamless loop from a steady texture rendered `overlap` seconds
    longer than the loop: the overhang fades out across the head while the
    head fades in (equal power for uncorrelated noise)."""
    n, m = samples(seconds), samples(overlap)
    if len(x) < n + m:
        raise ValueError('render the texture at least loop + overlap long')
    w = (np.arange(m) + 0.5) / m
    if x.ndim == 2:
        w = w[:, None]
    out = np.array(x[:n], dtype=float, copy=True)
    out[:m] = x[:m] * np.sqrt(w) + x[n:n + m] * np.sqrt(1.0 - w)
    return out
