import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('normals', Path(__file__).with_name('normals.py'))
normals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normals)


def disc():
    image = np.zeros((21, 21, 4), np.uint8)
    ys, xs = np.mgrid[0:21, 0:21]
    inside = (xs - 10) ** 2 + (ys - 10) ** 2 <= 64
    image[inside] = (150, 150, 150, 255)
    return image


class NormalTests(unittest.TestCase):
    def test_bevel_points_outward_with_green_up(self):
        result = normals.normal_map(disc(), 'bevel', bevel=3, green='up')
        top, bottom = result[3, 10], result[17, 10]
        left, right = result[10, 3], result[10, 17]
        self.assertGreater(int(top[1]), 128, 'top edge faces up: green above 128')
        self.assertLess(int(bottom[1]), 128)
        self.assertLess(int(left[0]), 128, 'left edge faces left: red below 128')
        self.assertGreater(int(right[0]), 128)
        self.assertEqual(tuple(result[10, 10]), (128, 128, 255), 'flat interior')
        self.assertEqual(tuple(result[0, 0]), (128, 128, 255), 'transparent pixels are flat')

    def test_green_down_inverts_only_green(self):
        up = normals.normal_map(disc(), 'bevel', bevel=3, green='up').astype(int)
        down = normals.normal_map(disc(), 'bevel', bevel=3, green='down').astype(int)
        self.assertTrue(np.array_equal(up[:, :, 0], down[:, :, 0]))
        inside = disc()[:, :, 3] > 0
        self.assertTrue(np.all(np.abs(up[:, :, 1][inside] + down[:, :, 1][inside] - 255) <= 1))

    def test_luminance_mode_raises_bright_pixels(self):
        image = np.zeros((9, 9, 4), np.uint8)
        image[:, :] = (60, 60, 60, 255)
        image[:, 5:] = (220, 220, 220, 255)
        result = normals.normal_map(image, 'luminance')
        self.assertLess(int(result[4, 4, 0]), 128, 'slope rising to the right faces left')

    def test_cli_writes_suffixed_files(self):
        with tempfile.TemporaryDirectory(prefix='normals-test-') as folder:
            source = Path(folder) / 'rock.png'
            Image.fromarray(disc(), 'RGBA').save(source)
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                code = normals.main([str(source), '--out', str(Path(folder) / 'n'), '--mode', 'both'])
            self.assertEqual(code, 0)
            report = json.loads(buffer.getvalue())
            with Image.open(report['files'][0]['output']) as image:
                self.assertEqual(image.mode, 'RGB')
                self.assertEqual(image.size, (21, 21))
            self.assertTrue(report['files'][0]['output'].endswith('rock_n.png'))


if __name__ == '__main__':
    unittest.main()
