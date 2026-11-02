"""An example catalogue: generic sounds, musical cues and loops, with example
loudness targets. A project copies this file, keeps its own targets from its
sound contract and lists its own events.

    python render.py render --catalogue example_catalogue.py --out build/audio --sheets --page
"""
import models
from catalogue import Event

# Example targets in LUFS. One-shots are measured by their maximum momentary
# loudness (400 ms windows), loops by gated integrated loudness. A sharp edge or a
# heavy, low thud peaks high for its loudness (K-weighting discounts bass), so
# those events sit a little under their category instead of being limited.
IMPACT, BREAK, AIR, FOLEY, QUIET, FOOT = -18.0, -17.0, -22.0, -24.0, -28.0, -26.0
UI, CUE, AMBIENCE, MUSIC = -24.0, -20.0, -30.0, -23.0

VICTORY = """
tempo 126
track lead reed pan=0.15 velocity=0.85
  G4:1/2 C5:1/2 E5:1/2 G5:1 E5:1/2 | G5:3
track harmony bowed pan=-0.2 gain=-7 velocity=0.6
  r:3/2 C4+E4:1 C4+G4:1/2 | B3+D4+G4:1 C4+E4+G4:2
track chords pluck pan=-0.35 strum=0.02 velocity=0.7
  C3+G3+C4+E4:3/2 C3+G3+C4+E4:1 C3+G3+C4+E4:1/2 | G2+D3+G3+B3:1 C3+G3+C4+E4:2
track beat drum velocity=0.8
  low:1/2 high:1/2 high:1/2 low:1 high:1/2 | low:1 low:2
"""

ALERT = """
tempo 96
track pluck pluck pan=-0.15
  E4:1/4@0.6 A4:1/4@0.7 C5:1/4@0.8 E5:3/2@0.9
track drone bowed pan=0.2 gain=-9 velocity=0.5
  A3+E4:9/4
track beat drum
  low:1/2@0.9 r:1/4 rim:1/4@0.6 low:5/4@0.7
"""

QUEST = """
tempo 110
track bar mallet pan=-0.1 velocity=0.75
  C5:1/4 E5:1/4 G5:1/4 C6:5/4
track bell bell pan=0.15 gain=-5 velocity=0.7
  r:3/4 C5:2
track chord pluck pan=-0.3 gain=-7 strum=0.015 velocity=0.6
  r:3/4 C3+G3+C4+E4:5/4
"""

DEFEAT = """
tempo 66
track low bowed pan=-0.15 velocity=0.7
  A3:1 G3:1 F3:1 E3:2
track high flute pan=0.2 gain=-6 velocity=0.55
  C5:1 B4:1 A4:1 G#4:2
track beat drum velocity=0.6
  low:3 low:2@0.45
"""

TAVERN = """
tempo 112
loop 16
humanize 0.004
track chords pluck pan=-0.3 strum=0.018 velocity=0.65
  A2:1 A3+C4+E4:1/2 A3+C4+E4:1/2 E3:1 A3+C4+E4:1 |
  G2:1 G3+B3+D4:1/2 G3+B3+D4:1/2 D3:1 G3+B3+D4:1 |
  F2:1 F3+A3+C4:1/2 F3+A3+C4:1/2 C3:1 F3+A3+C4:1 |
  E2:1 E3+G#3+B3:1/2 E3+G#3+B3:1/2 B2:1 E3+G#3+B3:1
track melody flute pan=0.25 gain=-3 velocity=0.7
  E5:1 C5:1/2 D5:1/2 E5:1 A4:1 | D5:1 B4:1/2 C5:1/2 D5:1 G4:1 |
  C5:1 A4:1/2 B4:1/2 C5:1 F4:1 | B4:1 G#4:1/2 A4:1/2 B4:2
track beat drum velocity=0.7 gain=-2
  low:1 high:1/2 high:1/2 low:1/2 low:1/2 high:1 | low:1 high:1/2 high:1/2 low:1/2 low:1/2 high:1 |
  low:1 high:1/2 high:1/2 low:1/2 low:1/2 high:1 | low:1 high:1/2 high:1/2 low:1/2 rim:1/2 high:1
"""

EVENTS = [
    # Impacts and bodies
    Event('knock_door', models.door_knock, 3, IMPACT - 2, 'Knuckles knocking three times on a solid wooden door',
          {'knocks': 3}, category='impact'),
    Event('hit_shield_sword', models.blade_on_shield, 3, IMPACT - 1, 'A sword striking a wooden shield with an iron rim',
          category='impact'),
    Event('drop_sack_wood', models.sack_drop, 3, IMPACT - 4, 'A full sack dropped on a wooden floor',
          category='impact'),
    # Footsteps
    Event('step_gravel_boot', models.footstep, 3, FOOT, 'A soft boot stepping on gravel', {'surface': 'gravel'},
          category='footsteps'),
    Event('step_boards_boot', models.footstep, 3, FOOT, 'A soft boot stepping on floorboards', {'surface': 'wood'},
          category='footsteps'),
    Event('step_flagstone_boot', models.footstep, 3, FOOT, 'A soft boot stepping on flagstones',
          {'surface': 'stone'}, category='footsteps'),
    # Breaking
    Event('break_crate', models.crate_break, 3, BREAK, 'A wooden crate smashed apart, boards falling',
          category='break'),
    Event('break_glass', models.glass_break, 3, BREAK, 'A window pane shattering, shards tinkling down',
          category='break'),
    # Air
    Event('swing_sword', models.weapon_swing, 3, AIR, 'A sword swung through the air', {'weapon': 'sword'},
          category='air'),
    Event('swing_staff', models.weapon_swing, 3, AIR, 'A wooden staff swung through the air', {'weapon': 'staff'},
          category='air'),
    Event('arrow_loose', models.bow_shot, 3, AIR, 'A bow loosed: string thrum and arrow hiss', category='air'),
    # Foley and mechanisms
    Event('door_creak', models.door_creak, 3, FOLEY, 'A wooden door creaking open on a dry hinge',
          category='foley'),
    Event('lock_key_turn', models.key_in_lock, 3, FOLEY, 'A key turned in an iron lock', category='foley'),
    Event('coins_pickup', models.coins, 3, FOLEY, 'A few small coins dropped into a palm', {'count': 3},
          category='foley'),
    Event('water_drip', models.water_drip, 3, QUIET, 'A drop falling into still water', category='foley'),
    # Interface (stereo, centred)
    Event('menu_tick', models.interface, 2, UI - 2, 'Moving between buttons: a small muted wooden bar',
          {'kind': 'tick'}, channels=2, category='interface'),
    Event('menu_accept', models.interface, 2, UI, 'Accepting a choice: two rising wooden-bar notes',
          {'kind': 'accept'}, channels=2, category='interface'),
    Event('menu_deny', models.interface, 2, UI, 'A choice that is not allowed: two muted, falling notes',
          {'kind': 'deny'}, channels=2, category='interface'),
    # Musical cues (stereo)
    Event('cue_victory', models.cue, 2, CUE, 'A short victory fanfare: reed lead over plucked chords and a hand drum',
          {'score': VICTORY}, channels=2, category='cue'),
    Event('cue_alert', models.cue, 2, CUE, 'A tense rising sting when someone notices you', {'score': ALERT},
          channels=2, category='cue'),
    Event('cue_quest_complete', models.cue, 2, CUE, 'A bright arpeggio and bell for a finished task',
          {'score': QUEST}, channels=2, category='cue'),
    Event('cue_defeat', models.cue, 2, CUE, 'A slow falling phrase for a lost fight', {'score': DEFEAT},
          channels=2, category='cue'),
    # Loops
    Event('amb_fire_loop', models.fire_loop, 1, AMBIENCE + 4, 'A wood fire burning, seamless 6 s loop',
          {'seconds': 6.0}, loop=True, category='ambience'),
    Event('amb_rain_loop', models.rain_loop, 1, AMBIENCE, 'Steady rain on a roof and puddles, seamless 8 s loop',
          {'seconds': 8.0}, loop=True, channels=2, category='ambience'),
    Event('music_tavern_loop', models.cue, 1, MUSIC, 'A four-bar tavern tune for plucked strings, flute and drum, seamless',
          {'score': TAVERN, 'loop': True}, loop=True, channels=2, category='music'),
]
