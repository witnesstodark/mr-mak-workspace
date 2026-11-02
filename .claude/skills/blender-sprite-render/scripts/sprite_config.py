"""Sprite render settings and the camera geometry behind them, without Blender.

render_sprites.py (inside Blender) and pack_sprites.py (plain Python) both
read a JSON config through this module, so its rules are tested without
Blender. Every key is optional; DEFAULTS shows them all.

Screen conventions: canvas pixels count from the top-left corner; the
subject's ground point (its origin) lands on `anchor`; directions are named
as the player sees them on screen, `down` facing the viewer.
"""
import copy
import json
import math
from pathlib import Path

VIEWS = {
    # name: (camera elevation above the ground in degrees, camera azimuth in degrees)
    'side': (0.0, 0.0),
    'three-quarter': (35.0, 0.0),
    'top-down': (90.0, 0.0),
    'isometric': (30.0, 45.0),  # 2:1 pixel-art dimetric: ground diamonds twice as wide as tall
}
DIRECTION_ANGLES = {  # screen facing -> turn of the subject about the vertical axis, counter-clockwise from above
    'down': 0.0, 'down_right': 45.0, 'right': 90.0, 'up_right': 135.0,
    'up': 180.0, 'up_left': 225.0, 'left': 270.0, 'down_left': 315.0,
}
DIRECTION_SETS = {1: ['down'], 2: ['right', 'left'], 4: ['down', 'right', 'up', 'left'],
                  8: ['down', 'down_right', 'right', 'up_right', 'up', 'up_left', 'left', 'down_left']}
ENGINES = {'eevee': 'BLENDER_EEVEE', 'cycles': 'CYCLES', 'workbench': 'BLENDER_WORKBENCH'}
LOOKS = ('realistic', 'toon', 'pixel')
PASSES = ('color', 'normal', 'depth', 'shadow')

DEFAULTS = {
    'subject': None,              # object or collection to turn; None: every object that is not a camera or light
    'canvas': [64, 64],           # frame size in pixels
    'pixels_per_unit': 32.0,      # screen pixels per Blender unit, across the screen
    'anchor': None,               # [x, y] pixel of the ground point; default: bottom centre, 4 px up
    'view': 'three-quarter',
    'elevation': None,            # degrees; overrides the view's elevation
    'azimuth': None,              # degrees; overrides the view's azimuth
    'directions': 4,              # 1, 2, 4, 8 or a list of names
    'engine': 'eevee',
    'look': 'realistic',
    'samples': 16,
    'toon': {'bands': 3, 'shadow': 0.45, 'outline': 'hull', 'outline_px': 1.0, 'outline_color': '#1a1c2c'},
    'light': {'azimuth': -45.0, 'elevation': 50.0, 'strength': 3.0, 'ambient': 0.3, 'soft': 2.0},
    'passes': ['color'],
    'shadow_opacity': 0.5,        # alpha of a full shadow in the shadow pass
    'use_scene_lights': False,    # keep the file's own lights as well as the sprite sun
    'clips': {'still': {'start': 1, 'end': 1, 'step': 1, 'fps': 1, 'loop': False}},
}


class ConfigError(ValueError):
    pass


def _merge(base, extra):
    out = copy.deepcopy(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict) and key != 'clips':
            out[key] = _merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def load(path_or_dict):
    """Read and validate a config; returns a complete dict."""
    raw = path_or_dict
    if not isinstance(raw, dict):
        raw = json.loads(Path(path_or_dict).read_text(encoding='utf-8')) if path_or_dict else {}
    unknown = sorted(set(raw) - set(DEFAULTS))
    if unknown:
        raise ConfigError('unknown config keys: %s' % ', '.join(unknown))
    cfg = _merge(DEFAULTS, raw)
    width, height = cfg['canvas']
    if width < 1 or height < 1:
        raise ConfigError('canvas must be positive')
    if cfg['anchor'] is None:
        cfg['anchor'] = [width / 2.0, height - 4.0]
    if cfg['pixels_per_unit'] <= 0:
        raise ConfigError('pixels_per_unit must be positive')
    if cfg['view'] not in VIEWS:
        raise ConfigError('view is one of %s' % ', '.join(VIEWS))
    if cfg['engine'] not in ENGINES:
        raise ConfigError('engine is one of %s' % ', '.join(ENGINES))
    if cfg['look'] not in LOOKS:
        raise ConfigError('look is one of %s' % ', '.join(LOOKS))
    if not 0.0 < float(cfg['shadow_opacity']) <= 1.0:
        raise ConfigError('shadow_opacity must be above 0 and at most 1')
    bad = [p for p in cfg['passes'] if p not in PASSES]
    if bad or 'color' not in cfg['passes']:
        raise ConfigError('passes are color (always) plus any of normal, depth, shadow; got %s' % cfg['passes'])
    cfg['directions'] = direction_names(cfg['directions'])
    for name, clip in cfg['clips'].items():
        clip_frames(name, clip)
    return cfg


def direction_names(spec):
    if isinstance(spec, int):
        if spec not in DIRECTION_SETS:
            raise ConfigError('directions is 1, 2, 4, 8 or a list of names')
        return list(DIRECTION_SETS[spec])
    names = list(spec)
    unknown = [n for n in names if n not in DIRECTION_ANGLES]
    if unknown or not names or len(set(names)) != len(names):
        raise ConfigError('direction names are %s, each once' % ', '.join(DIRECTION_ANGLES))
    return names


def angles(cfg):
    """Camera elevation and azimuth in degrees."""
    elevation, azimuth = VIEWS[cfg['view']]
    if cfg['elevation'] is not None:
        elevation = float(cfg['elevation'])
    if cfg['azimuth'] is not None:
        azimuth = float(cfg['azimuth'])
    if not 0.0 <= elevation <= 90.0:
        raise ConfigError('elevation must be 0 to 90 degrees')
    return elevation, azimuth


def facing(cfg, direction):
    """Turn of the subject in degrees about +Z for a screen direction. The
    subject's front is -Y (Blender's front view), so turn 0 faces a camera
    looking along +Y; the camera's azimuth is added so names stay on screen."""
    return (DIRECTION_ANGLES[direction] + angles(cfg)[1]) % 360.0


def camera(cfg, distance=50.0):
    """Orthographic camera settings that put the ground point on the anchor
    pixel at the given scale. Returns location, rotation (radians, XYZ) and
    lens settings, plus how the view foreshortens the ground and heights."""
    width, height = cfg['canvas']
    ax, ay = cfg['anchor']
    elevation, azimuth = angles(cfg)
    e, a = math.radians(elevation), math.radians(azimuth)
    # Looking along +Y rotated by the azimuth, tilted down by the elevation.
    location = (distance * math.cos(e) * math.sin(a), -distance * math.cos(e) * math.cos(a), distance * math.sin(e))
    rotation = (math.pi / 2.0 - e, 0.0, a)
    longest = float(max(width, height))
    return {
        'location': location, 'rotation': rotation, 'ortho_scale': longest / cfg['pixels_per_unit'],
        'shift_x': (width / 2.0 - ax) / longest, 'shift_y': (ay - height / 2.0) / longest,
        'ground_depth_scale': round(math.sin(e), 4), 'height_scale': round(math.cos(e), 4),
        'elevation': elevation, 'azimuth': azimuth,
    }


def clip_frames(name, clip):
    """Scene frames a clip samples: start to end inclusive, every `step`."""
    try:
        start, end, step = int(clip['start']), int(clip['end']), int(clip.get('step', 1))
    except (KeyError, TypeError, ValueError):
        raise ConfigError('clip %s needs integer start and end (and optional step)' % name)
    if end < start or step < 1:
        raise ConfigError('clip %s: end must not precede start, and step must be at least 1' % name)
    return list(range(start, end + 1, step))


def clip_events(name, clip):
    """Gameplay events as indices into the sampled frames, for example
    {"contact": [0, 4]}. An event on a frame the step skips is an error:
    choose a step that lands on it."""
    frames = clip_frames(name, clip)
    out = {}
    for event, at in (clip.get('events') or {}).items():
        indices = []
        for frame in ([at] if isinstance(at, int) else at):
            if frame not in frames:
                raise ConfigError('clip %s event %s at frame %s is not a sampled frame (%s)'
                                  % (name, event, frame, frames))
            indices.append(frames.index(frame))
        out[event] = indices
    return out


def frame_name(clip, direction, index, suffix=''):
    return '%s_%s_%02d%s.png' % (clip, direction, index, suffix)


PASS_SUFFIX = {'color': '', 'normal': '_n', 'depth': '_d', 'shadow': '_s'}
