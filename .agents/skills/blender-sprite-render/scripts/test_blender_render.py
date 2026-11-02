"""A real headless render of the built-in test figure. Needs Blender: set
BLENDER to its executable, or have `blender` on PATH or in a standard
install folder; otherwise the test is skipped."""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent


def find_blender():
    candidates = [os.environ.get('BLENDER'), shutil.which('blender')]
    candidates += sorted(glob.glob(r'C:\Program Files\Blender Foundation\Blender *\blender.exe'), reverse=True)
    candidates += ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/snap/bin/blender']
    return next((c for c in candidates if c and Path(c).is_file()), None)


BLENDER = find_blender()
CONFIG = {'directions': ['down', 'right'], 'passes': ['color', 'normal', 'depth', 'shadow'],
          'clips': {'walk': {'start': 25, 'end': 37, 'step': 12, 'fps': 8, 'loop': True,
                             'events': {'contact': [25, 37]}}}}


def rgba(path):
    with Image.open(path) as image:
        return np.asarray(image.convert('RGBA')).astype(int)


@unittest.skipIf(BLENDER is None, 'Blender not found (set BLENDER)')
class BlenderRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='blender-sprite-test-')
        base = Path(cls.temp.name)
        (base / 'config.json').write_text(json.dumps(CONFIG), encoding='utf-8')
        cls.out = base / 'out'
        cls.result = subprocess.run(
            [BLENDER, '-b', '--factory-startup', '--python-exit-code', '1', '-P', str(HERE / 'render_sprites.py'),
             '--', '--demo', '--config', str(base / 'config.json'), '--out', str(cls.out)],
            capture_output=True, text=True, timeout=900)
        cls.manifest = json.loads((cls.out / 'sprites.json').read_text(encoding='utf-8')) \
            if (cls.out / 'sprites.json').is_file() else None

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_render_finishes_with_every_file(self):
        self.assertEqual(self.result.returncode, 0, self.result.stdout[-2000:] + self.result.stderr[-2000:])
        self.assertIsNotNone(self.manifest)
        self.assertEqual(self.manifest['renders'], 4 * 2 * 2)
        files = self.manifest['clips']['walk']['files']
        for pass_name in CONFIG['passes']:
            for direction in CONFIG['directions']:
                for rel in files[pass_name][direction]:
                    self.assertTrue((self.out / rel).is_file(), rel)
        self.assertEqual(self.manifest['clips']['walk']['events'], {'contact': [0, 1]})
        self.assertTrue(self.manifest['blender'].startswith(('4.', '5.')))

    def test_pivot_and_feet_sit_on_the_anchor(self):
        self.assertEqual(self.manifest['pivot_projected'], [float(v) for v in self.manifest['pivot']])
        colour = rgba(self.out / self.manifest['clips']['walk']['files']['color']['down'][0])
        rows = np.flatnonzero((colour[..., 3] > 128).any(axis=1))
        self.assertLessEqual(abs(rows[-1] - self.manifest['pivot'][1]), 4)
        self.assertEqual(colour.shape[:2], (self.manifest['canvas'][1], self.manifest['canvas'][0]))
        self.assertEqual(self.manifest['warnings'], [])

    def test_normal_map_faces_the_viewer_with_green_up_and_red_right(self):
        normal = rgba(self.out / self.manifest['clips']['walk']['files']['normal']['down'][0])
        solid = normal[..., 3] > 250
        self.assertGreater(normal[solid][:, 2].mean(), 170)  # most surfaces face the camera
        cols = np.flatnonzero(solid.any(axis=0))
        middle = (cols[0] + cols[-1]) / 2.0
        left = normal[:, :int(middle)][solid[:, :int(middle)]][:, 0].mean()
        right = normal[:, int(middle) + 1:][solid[:, int(middle) + 1:]][:, 0].mean()
        self.assertLess(left, right)

    def test_shadow_is_separate_and_partly_transparent(self):
        shadow = rgba(self.out / self.manifest['clips']['walk']['files']['shadow']['down'][0])
        colour = rgba(self.out / self.manifest['clips']['walk']['files']['color']['down'][0])
        self.assertGreater((shadow[..., 3] > 0).sum(), 20)
        self.assertLessEqual(shadow[..., 3].max(), round(255 * 0.5) + 1)
        self.assertEqual(colour[0, 0, 3], 0)  # no ground in the colour pass

    def test_sheets_pack_from_the_render(self):
        result = subprocess.run([sys.executable, str(HERE / 'pack_sprites.py'), str(self.out)], capture_output=True,
                                text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        width, height = self.manifest['canvas']
        with Image.open(self.out / 'sheets/walk.png') as sheet:
            self.assertEqual(sheet.size, (2 * width, 2 * height))


if __name__ == '__main__':
    unittest.main()
