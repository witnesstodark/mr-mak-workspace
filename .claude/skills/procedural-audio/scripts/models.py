"""Example sound models: generic, grounded game sounds built from dsp.py.

Each model is `make(seed, **settings)` and returns mono (1-D) or stereo
([n, 2]) samples at 48 kHz, unnormalised: render.py trims and masters them.
Copy one as the start of a project's own model and keep its physics: what
touches what, for how long, and what rings afterwards.
"""
import numpy as np

import instruments
import score as scores
from dsp import (blank, blend_loop, butter_band, butter_low, crackle, db_gain, drip_bubble, fade_tail, fold_loop,
                 fracture, friction, hiss, impact, individual, low_body, material, mix_into, peak_normalise,
                 place_stereo, polish, rebounds, ring, samples, stack, swish, timeline)

# Mode tables: material(f0, ratios, tau0, damping, fall). `individual` makes each object its own.
SOLID_DOOR = material(95, [1, 1.78, 2.6, 3.65, 4.9, 6.6, 8.8, 11.7, 15.3, 20.0], 0.1, 0.75, 0.86)
BOARD = material(205, [1, 2.3, 3.85, 5.7, 8.0, 10.9, 14.4], 0.055, 0.8, 0.82)
FLOORBOARDS = material(72, [1, 1.9, 3.1, 4.75, 7.1, 10.4, 14.8], 0.075, 0.7, 0.84)
BLADE_STEEL = material(1150, [1, 2.24, 3.36, 4.75, 6.3, 8.0], 0.42, 0.9, 0.78)
IRON_BAND = material(860, [1, 1.67, 2.41, 3.33, 4.4, 5.7], 0.13, 0.7, 0.8)
FLAGSTONE = material(1300, [1, 1.68, 2.5, 3.45, 4.55], 0.016, 0.85, 0.72)
WINDOW_GLASS = material(600, [1, 2.27, 3.8, 5.55, 7.6, 9.85, 12.3], 0.1, 0.45, 0.88)
THIN_COIN = material(4100, [1, 1.66, 2.33, 2.9], 0.36, 1.0, 0.7)


def struck(rng, table, contact_s, seconds, scale=1.0, spread=0.05, rough=0.0, damp=1.0):
    """One object from a table, struck by a contact lasting `contact_s`."""
    freqs, taus, amps = table
    return impact(rng, contact_s, individual(rng, freqs, spread, scale), taus * damp, amps, seconds, rough)


# ---------------------------------------------------------------- impacts

def door_knock(seed, knocks=3, force=1.0):
    """Knuckles rapping a solid wooden door: each rap is a soft, short contact
    that rings the door's low modes, with the dry tick of bone on wood, and
    moves the door a little in its frame. People knock in a loose rhythm and
    lean into the last rap."""
    rng = np.random.default_rng(seed)
    beat = rng.uniform(0.13, 0.19)
    out = blank(beat * knocks + 0.7)
    at = 0.01
    for i in range(knocks):
        strength = force * (rng.uniform(0.75, 0.9) if i < knocks - 1 else 1.0)
        door = peak_normalise(struck(rng, SOLID_DOOR, rng.uniform(0.0015, 0.0021), 0.5, damp=0.6,
                                     scale=rng.uniform(0.95, 1.05)))
        bone = peak_normalise(hiss(rng, 0.006, 1800, 5000, 0.0008, attack=0.0002))
        frame = peak_normalise(low_body(rng.uniform(62, 72), 0.035, 0.15))
        mix_into(out, stack(door, bone * 0.12, frame * 0.35) * strength, at)
        at += beat * (rng.uniform(0.9, 1.05) if i < knocks - 2 else rng.uniform(1.0, 1.25))
    return polish(out)


def blade_on_shield(seed, near_rim=None):
    """A sword striking a wooden round shield with an iron rim: the boards
    thud, the blade rings (held, so damped), and the rim clangs when the blow
    lands near it. Blade and boards share one contact: the edge meeting the
    leather-faced wood."""
    rng = np.random.default_rng(seed)
    rim = rng.uniform(0.0, 1.0) if near_rim is None else float(near_rim)
    out = blank(0.9)
    edge = rng.uniform(0.0007, 0.001)
    boards = peak_normalise(struck(rng, BOARD, edge, 0.5, scale=rng.uniform(0.8, 0.95), rough=0.2))
    mass = peak_normalise(low_body(rng.uniform(95, 120), 0.04, 0.2))
    blade = peak_normalise(struck(rng, BLADE_STEEL, edge, 0.7, damp=0.55))
    band = peak_normalise(struck(rng, IRON_BAND, 0.0003, 0.6))
    mix_into(out, stack(boards * (1.0 - 0.4 * rim), mass * 0.35), 0.0)
    mix_into(out, blade * db_gain(-6), 0.0)
    mix_into(out, band * db_gain(-16 + 10 * rim), 0.0)
    mix_into(out, peak_normalise(hiss(rng, 0.05, 2500, 9000, 0.012, attack=0.002)) * db_gain(-20),
             rng.uniform(0.002, 0.006))
    mix_into(out, peak_normalise(crackle(rng, 0.08, 220, 1800, 7000, fade=0.03)) * db_gain(-22), 0.003)
    return polish(out)


def footstep(seed, surface='gravel', weight=1.0):
    """A soft-soled boot: the heel lands, the toe follows a moment later at
    about half the force. The ground does the rest: gravel crunches as stones
    shift, floorboards ring low and now and then creak, flagstones knock dryly."""
    rng = np.random.default_rng(seed)
    out = blank(0.45)
    for at, part in ((0.0, 1.0), (rng.uniform(0.07, 0.1), rng.uniform(0.45, 0.6))):
        s = part * weight
        mix_into(out, peak_normalise(hiss(rng, 0.05, 150, 2500, 0.012, attack=0.003)) * 0.5 * s, at)
        if surface == 'gravel':
            mix_into(out, peak_normalise(crackle(rng, 0.12, 900, 1200, 7000, grain=0.0006, fade=0.035)) * 0.9 * s,
                     at + 0.002)
            mix_into(out, peak_normalise(hiss(rng, 0.08, 120, 900, 0.02, attack=0.004)) * 0.35 * s, at)
        elif surface == 'wood':
            mix_into(out, peak_normalise(struck(rng, FLOORBOARDS, 0.006, 0.3, scale=rng.uniform(1.4, 1.7))) * 0.8 * s,
                     at)
            if at == 0.0 and rng.random() < 0.35:
                slips = np.linspace(rng.uniform(140, 200), rng.uniform(220, 320), 64)
                creak = friction(rng, 0.12, slips, individual(rng, [700, 1450, 2300]), [0.02, 0.012, 0.008])
                mix_into(out, peak_normalise(creak) * 0.15, 0.04)
        elif surface == 'stone':
            mix_into(out, peak_normalise(struck(rng, FLAGSTONE, 0.0015, 0.08, rough=0.3)) * 0.6 * s, at)
            mix_into(out, peak_normalise(crackle(rng, 0.05, 300, 2500, 9000, fade=0.015)) * 0.3 * s, at + 0.003)
        else:
            raise ValueError('surface is gravel, wood or stone')
    return polish(out)


def sack_drop(seed):
    """A full sack dropped on floorboards: a long, soft contact moves the
    floor's low modes, the sacking slaps, the contents shift and settle, and
    it rocks once."""
    rng = np.random.default_rng(seed)
    out = blank(0.9)
    mix_into(out, peak_normalise(struck(rng, FLOORBOARDS, rng.uniform(0.012, 0.018), 0.6)), 0.0)
    mix_into(out, peak_normalise(low_body(rng.uniform(55, 65), 0.06, 0.25)) * 0.5, 0.0)
    mix_into(out, peak_normalise(hiss(rng, 0.08, 250, 3500, 0.016, attack=0.003)) * db_gain(-4), 0.0)
    mix_into(out, peak_normalise(crackle(rng, 0.35, 700, 300, 2500, grain=0.001, fade=0.08)) * db_gain(-8), 0.01)
    mix_into(out, peak_normalise(struck(rng, FLOORBOARDS, 0.02, 0.4)) * db_gain(-14), rng.uniform(0.08, 0.12))
    return polish(out)


# ---------------------------------------------------------------- breaking

def crate_break(seed):
    """A wooden crate smashed: the blow rings the boards, the fibres tear in a
    rapid run of cracks, and loose boards fall and bounce on the floor."""
    rng = np.random.default_rng(seed)
    out = blank(1.6)
    mix_into(out, peak_normalise(struck(rng, BOARD, 0.0012, 0.4, scale=0.9, rough=0.3)) * 0.8, 0.0)
    mix_into(out, peak_normalise(low_body(rng.uniform(80, 95), 0.05, 0.2)) * 0.4, 0.0)
    mix_into(out, peak_normalise(fracture(rng, 0.12, 40, 700, 7000, BOARD)) * db_gain(-4), 0.004)
    mix_into(out, peak_normalise(crackle(rng, 0.3, 400, 1500, 7000, fade=0.08)) * db_gain(-10), 0.01)
    for _ in range(rng.integers(3, 6)):
        size = rng.uniform(1.2, 2.0)
        for t, s in rebounds(rng, rng.uniform(0.05, 0.12), 0.45, 4, at=rng.uniform(0.15, 0.45),
                             strength=rng.uniform(0.3, 0.6)):
            mix_into(out, peak_normalise(struck(rng, BOARD, 0.0015, 0.2, scale=size)) * s, t)
    return polish(out)


def glass_break(seed):
    """A window pane shattering: one ring as it cracks, then the shards fall,
    each a tiny glassy ring, bouncing and tinkling to a stop."""
    rng = np.random.default_rng(seed)
    out = blank(1.8)
    mix_into(out, peak_normalise(struck(rng, WINDOW_GLASS, 0.0004, 0.4)) * 0.7, 0.0)
    mix_into(out, peak_normalise(fracture(rng, 0.05, 60, 2000, 12000, WINDOW_GLASS)) * db_gain(-5), 0.001)
    for _ in range(rng.integers(14, 22)):
        size = rng.uniform(1.8, 4.5)
        for t, s in rebounds(rng, rng.uniform(0.03, 0.08), 0.5, 4, at=rng.uniform(0.12, 0.7),
                             strength=rng.uniform(0.15, 0.45)):
            shard = struck(rng, WINDOW_GLASS, 0.0002, 0.12, scale=size, spread=0.12, damp=0.4)
            mix_into(out, peak_normalise(shard) * s, t)
    return polish(out, high=15000.0)


# ---------------------------------------------------------------- air and mechanisms

def weapon_swing(seed, weapon='sword', speed=1.0):
    """A weapon swung through the air: the rush rises and falls with the
    head's speed; a sword's thin edge whistles faintly, a staff pushes more air."""
    rng = np.random.default_rng(seed)
    if weapon == 'sword':
        out = swish(rng, 0.42 / speed, 350, 2400 * speed, peak=rng.uniform(0.38, 0.48), whistle=0.25, weight=0.4)
    elif weapon == 'staff':
        out = swish(rng, 0.5 / speed, 200, 1300 * speed, peak=rng.uniform(0.4, 0.5), width=0.9, weight=1.0)
    else:
        raise ValueError('weapon is sword or staff')
    return polish(out)


def bow_shot(seed):
    """Loosing an arrow: the string snaps forward and thrums, the limbs knock
    against the hand, and the arrow hisses away."""
    rng = np.random.default_rng(seed)
    out = blank(0.6)
    f = rng.uniform(95, 115)
    k = np.arange(1, 9)
    mix_into(out, peak_normalise(ring(f * k, 0.12 / np.sqrt(k), 1.0 / k, 0.4)) * 0.8, 0.0)
    mix_into(out, peak_normalise(struck(rng, BOARD, 0.0008, 0.15, scale=1.5)) * 0.5, 0.001)
    mix_into(out, peak_normalise(hiss(rng, 0.01, 2000, 8000, 0.002)) * 0.3, 0.0)
    mix_into(out, peak_normalise(swish(rng, 0.25, 900, 4200, peak=0.15, width=0.5)) * db_gain(-8), 0.01)
    return polish(out)


def door_creak(seed, seconds=1.4):
    """A wooden door swinging on a dry hinge: the hinge pin sticks and slips,
    each slip ringing the hinge and the door's edge. The slip rate follows the
    door's speed, which is the creak's rising and falling pitch."""
    rng = np.random.default_rng(seed)
    t = timeline(seconds)
    motion = np.sin(np.pi * t / seconds) ** 0.7 * (1.0 + 0.15 * np.sin(2 * np.pi * rng.uniform(1.5, 3.0) * t))
    slips = rng.uniform(25, 40) + rng.uniform(200, 300) * motion ** 1.3
    creak = friction(rng, seconds, slips, individual(rng, [640, 1210, 1790, 2650, 3550]),
                     [0.011, 0.0085, 0.0065, 0.005, 0.0038], jitter=0.2)
    out = peak_normalise(peak_normalise(creak) * (0.3 + 0.7 * motion))
    mix_into(out, peak_normalise(low_body(rng.uniform(60, 70), 0.05, 0.2)) * 0.15, seconds * 0.9)
    return polish(fade_tail(out, 0.08))


def key_in_lock(seed):
    """A key turned in an iron lock: it rattles against the wards, the bolt
    gives with two clicks and a dull thunk, and a small spring rings."""
    rng = np.random.default_rng(seed)
    out = blank(0.8)
    for _ in range(rng.integers(3, 6)):
        tap = struck(rng, IRON_BAND, 0.0002, 0.03, scale=2.2, damp=0.15)
        mix_into(out, peak_normalise(tap) * rng.uniform(0.1, 0.25), rng.uniform(0.0, 0.16))
    turn = rng.uniform(0.2, 0.26)
    for at, s in ((turn, 0.6), (turn + rng.uniform(0.05, 0.08), 1.0)):
        mix_into(out, peak_normalise(struck(rng, IRON_BAND, 0.00015, 0.06, scale=2.5, damp=0.3)) * s, at)
    mix_into(out, peak_normalise(low_body(rng.uniform(170, 200), 0.02, 0.08)) * 0.6, turn + 0.07)
    mix_into(out, peak_normalise(ring([rng.uniform(2900, 3300)], [0.12], [1.0], 0.3)) * 0.05, turn + 0.07)
    return polish(out)


def coins(seed, count=3):
    """Small coins dropped into a palm: each strikes another and rings, thin
    metal discs with a high, inharmonic chime; the palm muffles the landing."""
    rng = np.random.default_rng(seed)
    out = blank(0.25 + 0.09 * count + 0.4)
    at = 0.0
    for _ in range(count):
        clink = struck(rng, THIN_COIN, 0.0002, 0.4, scale=rng.uniform(0.85, 1.1), spread=0.06)
        mix_into(out, peak_normalise(clink) * rng.uniform(0.5, 1.0), at)
        mix_into(out, peak_normalise(hiss(rng, 0.02, 400, 3000, 0.004)) * 0.2, at)
        at += rng.uniform(0.05, 0.11)
    return polish(out, high=15000.0)


def water_drip(seed, drops=1):
    """A drop falling into still water: a tiny splash, then a bubble ringing
    and rising in pitch as it forms."""
    rng = np.random.default_rng(seed)
    out = blank(0.35 * drops + 0.1)
    for i in range(drops):
        at = 0.005 + i * rng.uniform(0.25, 0.35)
        mix_into(out, peak_normalise(hiss(rng, 0.004, 2000, 9000, 0.0006)) * 0.15, at)
        radius_mm = rng.uniform(2.2, 4.0)
        mix_into(out, peak_normalise(drip_bubble(rng, 3260.0 / radius_mm, 0.07, rise=rng.uniform(0.4, 0.9))),
                 at + 0.003)
    return polish(out)


def interface(seed, kind='tick'):
    """Interface sounds played on a little tuned wooden bar with a felt
    mallet: a tick, a two-note accept rising a fourth, a muted deny falling a third."""
    rng = np.random.default_rng(seed)
    out = blank(0.5)
    note = instruments.note_freq
    if kind == 'tick':
        mix_into(out, instruments.mallet(rng, rng.uniform(1050, 1150), 0.02, 0.6, muted=True), 0.0)
    elif kind == 'accept':
        mix_into(out, instruments.mallet(rng, note('G5'), 0.05, 0.7), 0.0)
        mix_into(out, instruments.mallet(rng, note('C6'), 0.05, 0.8), 0.065)
    elif kind == 'deny':
        mix_into(out, instruments.mallet(rng, note('E4'), 0.05, 0.8, muted=True), 0.0)
        mix_into(out, instruments.mallet(rng, note('C4'), 0.05, 0.8, muted=True), 0.1)
    else:
        raise ValueError('kind is tick, accept or deny')
    return out


# ---------------------------------------------------------------- loops

def fire_loop(seed, seconds=6.0):
    """A wood fire as a seamless loop: the low roar of hot gas swelling and
    sinking, the crackle of fibres splitting, and now and then a pop of sap.
    The steady roar blends over the seam; the crackles and pops fold over it."""
    rng = np.random.default_rng(seed)
    overlap = 1.0
    n = samples(seconds + overlap)
    swell = butter_low(rng.normal(size=n), 0.8, 1)
    swell = 0.6 + 0.4 * (swell - swell.min()) / max(np.ptp(swell), 1e-9)
    roar = peak_normalise(butter_low(rng.normal(size=n), 260.0) * swell) * 0.5
    air = butter_band(rng.normal(size=n), 2500, 7000) * 0.03 * swell
    bed = blend_loop(roar + air, seconds, overlap)
    events = blank(seconds + 1.0)
    mix_into(events, peak_normalise(crackle(rng, seconds, 22, 900, 6000, grain=0.0009)) * 0.7, 0.0)
    for at in np.sort(rng.uniform(0, seconds, rng.integers(3, 6))):
        pop = hiss(rng, 0.05, 600, 4000, 0.008) + ring([rng.uniform(500, 900)], [0.01], [0.6], 0.05)
        mix_into(events, peak_normalise(pop) * rng.uniform(0.5, 0.9), at)
    return polish(bed + fold_loop(events, seconds), low=40.0)


def rain_loop(seed, seconds=8.0):
    """Steady rain on a roof and puddles, in stereo, as a seamless loop: a wash
    of countless distant drops on each side and nearer single drops that tick
    or ring as bubbles, scattered across the field."""
    rng = np.random.default_rng(seed)
    overlap = 1.5
    n = samples(seconds + overlap)
    wash = np.column_stack([butter_band(rng.normal(size=n), 500, 7000) for _ in range(2)])
    swell = butter_low(rng.normal(size=n), 0.3, 1)
    swell = 0.85 + 0.15 * (swell - swell.min()) / max(np.ptp(swell), 1e-9)
    bed = blend_loop(wash * swell[:, None] * 0.25, seconds, overlap)
    near = np.zeros((samples(seconds + 0.5), 2))
    for at in np.sort(rng.uniform(0, seconds, int(seconds * 14))):
        if rng.random() < 0.35:
            drop = drip_bubble(rng, rng.uniform(900, 1800), 0.05, rise=rng.uniform(0.3, 0.8), tau=0.012)
        else:
            drop = hiss(rng, 0.012, 1500, 9000, 0.0015)
        mix_into(near, place_stereo(peak_normalise(drop) * rng.uniform(0.05, 0.25), rng.uniform(-0.9, 0.9)), at)
    return polish(bed + fold_loop(near, seconds), low=60.0)


# ---------------------------------------------------------------- music

def cue(seed, score, loop=None):
    """A musical cue from a score (see score.py), played by the modelled
    instruments in stereo."""
    return scores.render(score, np.random.default_rng(seed), loop=loop)
