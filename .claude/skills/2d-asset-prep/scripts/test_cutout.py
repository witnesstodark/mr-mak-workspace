import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('cutout', Path(__file__).with_name('cutout.py'))
cutout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutout)


def run(argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = cutout.main(argv)
    return code, json.loads(buffer.getvalue())


class CutoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cutout-test-')
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def save(self, name, array):
        path = self.base / name
        Image.fromarray(array.astype(np.uint8), 'RGBA').save(path)
        return path

    def ring_on_magenta(self):
        """Magenta background, a blue ring with a magenta hole inside."""
        image = np.zeros((20, 20, 4), np.uint8)
        image[:] = (255, 0, 255, 255)
        image[4:16, 4:16] = (20, 40, 200, 255)
        image[8:12, 8:12] = (255, 0, 255, 255)
        return image

    def test_flood_keeps_enclosed_key_colour(self):
        source = self.save('ring.png', self.ring_on_magenta())
        code, report = run(['key', str(source), '--out', str(self.base / 'out')])
        self.assertEqual(code, 0)
        self.assertEqual(report['files'][0]['key'], '#ff00ff')
        result = np.array(Image.open(self.base / 'out/ring.png'))
        self.assertEqual(result[0, 0, 3], 0)
        self.assertEqual(result[10, 10, 3], 255, 'the enclosed hole is not connected to the border')
        self.assertEqual(result[5, 5, 3], 255)

    def test_global_mode_removes_enclosed_key_colour(self):
        source = self.save('ring.png', self.ring_on_magenta())
        run(['key', str(source), '--out', str(self.base / 'out'), '--mode', 'global'])
        result = np.array(Image.open(self.base / 'out/ring.png'))
        self.assertEqual(result[10, 10, 3], 0)

    def test_defringe_and_hard_alpha_leave_no_semi_transparency(self):
        image = self.ring_on_magenta()
        image[3, 4:16] = (200, 10, 240, 255)  # a magenta-tinted edge
        source = self.save('soft.png', image)
        code, report = run(['key', str(source), '--out', str(self.base / 'out'),
                            '--defringe', '--hard-alpha'])
        self.assertEqual(code, 0)
        self.assertEqual(report['files'][0]['semi_transparent'], 0)
        self.assertGreater(report['files'][0]['defringed_pixels'], 0)
        result = np.array(Image.open(self.base / 'out/soft.png'))
        self.assertTrue(set(np.unique(result[:, :, 3])) <= {0, 255})

    def test_refuses_to_overwrite_input(self):
        source = self.save('ring.png', self.ring_on_magenta())
        with self.assertRaises(SystemExit):
            run(['key', str(source), '--out', str(self.base)])

    def frames(self):
        """Two frames of a 4x6 figure that moves one pixel to the right."""
        paths = []
        for index, x in enumerate((5, 6)):
            image = np.zeros((16, 16, 4), np.uint8)
            image[6:12, x:x + 4] = (200, 100, 50, 255)
            paths.append(self.save('f%d.png' % index, image))
        return paths

    def test_shared_trim_keeps_relative_motion(self):
        paths = self.frames()
        code, report = run(['trim', *map(str, paths), '--out', str(self.base / 't'), '--shared'])
        self.assertEqual(code, 0)
        self.assertEqual(report['shared_bbox'], [5, 6, 10, 12])
        a = np.array(Image.open(self.base / 't/f0.png'))
        b = np.array(Image.open(self.base / 't/f1.png'))
        self.assertEqual(a.shape, (6, 5, 4))
        self.assertEqual(a[0, 0, 3], 255)
        self.assertEqual(b[0, 0, 3], 0, 'the second frame keeps its one-pixel shift')
        self.assertTrue((self.base / 't/trim.json').is_file())

    def test_canvas_places_bottom_centre_pivot_on_anchor(self):
        image = np.zeros((30, 30, 4), np.uint8)
        image[10:20, 3:7] = (10, 200, 10, 255)  # 4 wide, 10 tall
        source = self.save('hero.png', image)
        code, report = run(['trim', str(source), '--out', str(self.base / 'c'), '--canvas', '48x64'])
        self.assertEqual(code, 0)
        result = np.array(Image.open(self.base / 'c/hero.png'))
        ys, xs = np.nonzero(result[:, :, 3])
        self.assertEqual(ys.max(), 63, 'feet sit on the bottom row')
        self.assertEqual((xs.min() + xs.max() + 1) / 2.0, 24.0, 'even content is centred on x = W/2')
        self.assertEqual(report['files'][0]['pivot'], [23, 63])

    def test_canvas_clipping_fails_without_allow_clip(self):
        image = np.zeros((80, 10, 4), np.uint8)
        image[0:80, 2:8] = 255
        source = self.save('tall.png', image)
        with contextlib.redirect_stderr(io.StringIO()):
            code, report = run(['trim', str(source), '--out', str(self.base / 'c'), '--canvas', '16x16'])
        self.assertEqual(code, 1)
        self.assertIn(str(source), report['clipped'])

    def test_alpha_binarizes(self):
        image = np.zeros((4, 4, 4), np.uint8)
        image[..., :3] = 90
        image[..., 3] = [[0, 64, 127, 128], [200, 255, 255, 255], [10, 10, 10, 10], [255, 0, 0, 0]]
        source = self.save('soft.png', image)
        code, report = run(['alpha', str(source), '--out', str(self.base / 'a')])
        self.assertEqual(report['files'][0]['semi_transparent_before'], 8)
        result = np.array(Image.open(self.base / 'a/soft.png'))
        self.assertEqual(int((result[:, :, 3] == 255).sum()), 6)


if __name__ == '__main__':
    unittest.main()
