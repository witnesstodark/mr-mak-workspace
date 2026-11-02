"""Tests for sprite_config.py: settings, directions, clips and the camera geometry (no Blender needed)."""
import importlib.util
import math
import unittest
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location('sprite_config', Path(__file__).with_name('sprite_config.py'))
sc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sc)


def euler_xyz(rx, ry, rz):
    """Blender's XYZ Euler as a rotation matrix (X applied first)."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    x = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return z @ y @ x


def project(cfg, point):
    """Where an orthographic Blender camera built from sc.camera() shows a
    world point, in canvas pixels from the top-left."""
    cam = sc.camera(cfg)
    width, height = cfg['canvas']
    longest = max(width, height)
    rotation = euler_xyz(*cam['rotation'])
    right, up = rotation @ [1, 0, 0], rotation @ [0, 1, 0]
    offset = np.asarray(point, float) - cam['location']
    u = offset @ right / cam['ortho_scale'] - cam['shift_x']
    v = offset @ up / cam['ortho_scale'] - cam['shift_y']
    return width / 2.0 + u * longest, height / 2.0 - v * longest


class ConfigTests(unittest.TestCase):
    def test_defaults_fill_everything_and_anchor_sits_at_the_bottom_centre(self):
        cfg = sc.load({'canvas': [64, 80]})
        self.assertEqual(cfg['anchor'], [32.0, 76.0])
        self.assertEqual(cfg['directions'], ['down', 'right', 'up', 'left'])
        self.assertEqual(cfg['light']['ambient'], 0.3)
        cfg = sc.load({'light': {'elevation': 70}})
        self.assertEqual((cfg['light']['elevation'], cfg['light']['azimuth']), (70, -45.0))

    def test_bad_settings_are_named(self):
        for bad, words in (({'colour': 1}, 'unknown'), ({'view': 'oblique'}, 'view'), ({'engine': 'luxcore'}, 'engine'),
                           ({'passes': ['normal']}, 'color'), ({'directions': 3}, 'directions'),
                           ({'directions': ['down', 'down']}, 'each once'), ({'shadow_opacity': 0}, 'shadow_opacity'),
                           ({'clips': {'walk': {'start': 5, 'end': 1}}}, 'walk')):
            with self.assertRaises(sc.ConfigError) as raised:
                sc.load(bad)
            self.assertIn(words, str(raised.exception))

    def test_directions_turn_the_subject_counter_clockwise_and_follow_the_camera(self):
        cfg = sc.load({'directions': 8})
        self.assertEqual([sc.facing(cfg, d) for d in cfg['directions']], [0, 45, 90, 135, 180, 225, 270, 315])
        iso = sc.load({'view': 'isometric'})
        self.assertEqual(sc.facing(iso, 'down'), 45.0)
        self.assertEqual(sc.load({'directions': 2})['directions'], ['right', 'left'])

    def test_the_reference_example_config_is_valid(self):
        path = Path(__file__).resolve().parent.parent / 'references' / 'example-config.json'
        cfg = sc.load(path)
        self.assertEqual(len(cfg['directions']), 8)
        self.assertEqual(sc.clip_events('attack', cfg['clips']['attack']), {'hit': [4]})

    def test_clip_frames_and_events(self):
        clip = {'start': 25, 'end': 48, 'step': 3, 'events': {'contact': [25, 37], 'hit': 31}}
        self.assertEqual(sc.clip_frames('walk', clip), list(range(25, 49, 3)))
        self.assertEqual(sc.clip_events('walk', clip), {'contact': [0, 4], 'hit': [2]})
        with self.assertRaises(sc.ConfigError):
            sc.clip_events('walk', dict(clip, events={'contact': [26]}))
        self.assertEqual(sc.frame_name('walk', 'down_left', 3, '_n'), 'walk_down_left_03_n.png')


class CameraTests(unittest.TestCase):
    def test_ground_point_lands_on_the_anchor_in_every_view(self):
        for view in sc.VIEWS:
            for canvas, anchor in (([64, 64], [32, 60]), ([48, 80], [20, 70]), ([96, 40], [50, 35])):
                cfg = sc.load({'view': view, 'canvas': canvas, 'anchor': anchor})
                x, y = project(cfg, (0, 0, 0))
                self.assertAlmostEqual(x, anchor[0], places=6, msg=view)
                self.assertAlmostEqual(y, anchor[1], places=6, msg=view)

    def test_scale_is_pixels_per_unit_with_the_view_foreshortening(self):
        ppu = 32.0
        side = sc.load({'view': 'side', 'pixels_per_unit': ppu})
        self.assertAlmostEqual(project(side, (1, 0, 0))[0] - project(side, (0, 0, 0))[0], ppu)
        self.assertAlmostEqual(project(side, (0, 0, 0))[1] - project(side, (0, 0, 1))[1], ppu)
        top = sc.load({'view': 'top-down', 'pixels_per_unit': ppu})
        self.assertAlmostEqual(project(top, (0, 0, 0))[1] - project(top, (0, 1, 0))[1], ppu)
        three = sc.load({'view': 'three-quarter', 'pixels_per_unit': ppu})
        cam = sc.camera(three)
        rise = project(three, (0, 0, 0))[1] - project(three, (0, 0, 1))[1]
        depth = project(three, (0, 0, 0))[1] - project(three, (0, 1, 0))[1]
        self.assertAlmostEqual(rise, ppu * math.cos(math.radians(cam['elevation'])), places=6)
        self.assertAlmostEqual(depth, ppu * math.sin(math.radians(cam['elevation'])), places=6)

    def test_isometric_ground_diamond_is_twice_as_wide_as_tall(self):
        iso = sc.load({'view': 'isometric'})
        corners = {c: project(iso, (c[0], c[1], 0)) for c in ((0, 0), (1, 0), (0, 1), (1, 1))}
        # Seen along the diagonal, (0, 0) and (1, 1) are the left and right
        # points of the tile's diamond, (1, 0) and (0, 1) its top and bottom.
        width = abs(corners[(1, 1)][0] - corners[(0, 0)][0])
        height = abs(corners[(0, 1)][1] - corners[(1, 0)][1])
        self.assertAlmostEqual(width / height, 2.0, places=2)

    def test_camera_looks_at_the_subject(self):
        for view in sc.VIEWS:
            cam = sc.camera(sc.load({'view': view}))
            forward = euler_xyz(*cam['rotation']) @ [0, 0, -1]
            to_origin = -np.asarray(cam['location']) / np.linalg.norm(cam['location'])
            np.testing.assert_allclose(forward, to_origin, atol=1e-9)


if __name__ == '__main__':
    unittest.main()
