import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

spec = importlib.util.spec_from_file_location('pixel_fit', Path(__file__).with_name('pixel_fit.py'))
pixel_fit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixel_fit)

PALETTE = np.array([(31, 20, 36), (90, 168, 60), (214, 162, 52), (70, 96, 207),
                    (246, 220, 116), (168, 34, 46)], np.uint8)


def art(size=24, seed=3):
    """Random art with irregular runs, like real sprites (no hidden coarser grid)."""
    rng = np.random.RandomState(seed)
    indices = rng.randint(0, len(PALETTE), (size, size))
    repeat = rng.rand(size, size) < 0.45
    for y in range(size):
        for x in range(1, size):
            if repeat[y, x]:
                indices[y, x] = indices[y, x - 1]
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[:, :, :3] = PALETTE[indices]
    rgba[:, :, 3] = 255
    return rgba, indices


def upscale(rgba, scale):
    """Nearest upscale with a non-integer scale, as an image generator might."""
    height, width = rgba.shape[:2]
    out_w, out_h = int(width * scale), int(height * scale)
    xs = np.minimum((np.arange(out_w) / scale).astype(int), width - 1)
    ys = np.minimum((np.arange(out_h) / scale).astype(int), height - 1)
    return rgba[ys][:, xs]


def run(argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = pixel_fit.main(argv)
    return code, json.loads(buffer.getvalue())


class PixelFitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pixel-fit-test-')
        self.base = Path(self.temp.name)
        self.palette = self.base / 'pal.hex'
        self.palette.write_text('\n'.join('%02x%02x%02x' % tuple(c) for c in PALETTE) + '\n', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def noisy(self, scale):
        original, _ = art()
        big = upscale(original, scale)
        image = Image.fromarray(big, 'RGBA').convert('RGB').filter(ImageFilter.GaussianBlur(0.8))
        noise = np.random.RandomState(7).randint(-6, 7, (image.height, image.width, 3))
        noisy = np.clip(np.array(image).astype(int) + noise, 0, 255).astype(np.uint8)
        path = self.base / 'generated.png'
        Image.fromarray(noisy, 'RGB').save(path)
        return original, path

    def test_detects_non_integer_scale_through_blur_and_noise(self):
        _, path = self.noisy(6.3)
        code, report = run(['detect', str(path)])
        self.assertEqual(code, 0)
        self.assertAlmostEqual(report['scale'], 6.3, delta=0.05)
        self.assertEqual(report['true_size'], [24, 24])

    def test_fit_auto_with_palette_recovers_original(self):
        original, path = self.noisy(6.3)
        out = self.base / 'fit.png'
        code, report = run(['fit', str(path), '--scale', 'auto', '--palette', str(self.palette), '--out', str(out)])
        self.assertEqual(code, 0)
        self.assertEqual(report['true_size'], [24, 24])
        result = np.array(Image.open(out))
        self.assertTrue(np.array_equal(result, original))

    def test_fit_clean_integer_upscale_by_size(self):
        original, _ = art()
        path = self.base / 'clean.png'
        Image.fromarray(upscale(original, 4), 'RGBA').save(path)
        out = self.base / 'clean_fit.png'
        code, report = run(['fit', str(path), '--size', '24x24', '--out', str(out)])
        self.assertTrue(np.array_equal(np.array(Image.open(out)), original))
        self.assertEqual(report['colours'], len(PALETTE))

    def test_quantize_maps_to_palette_with_hard_alpha(self):
        rgba = np.zeros((2, 2, 4), np.uint8)
        rgba[0, 0] = (95, 160, 66, 255)
        rgba[0, 1] = (250, 225, 120, 200)
        rgba[1, 0] = (10, 10, 10, 40)
        path = self.base / 'q.png'
        Image.fromarray(rgba, 'RGBA').save(path)
        out = self.base / 'q_out.png'
        run(['quantize', str(path), '--palette', str(self.palette), '--out', str(out)])
        result = np.array(Image.open(out))
        self.assertEqual(tuple(result[0, 0]), (90, 168, 60, 255))
        self.assertEqual(tuple(result[0, 1]), (246, 220, 116, 255))
        self.assertEqual(result[1, 0, 3], 0)

    def test_upscale_is_exact_nearest(self):
        original, _ = art(8)
        path = self.base / 'u.png'
        Image.fromarray(original, 'RGBA').save(path)
        out = self.base / 'u4.png'
        run(['upscale', str(path), '--scale', '4', '--out', str(out)])
        big = np.array(Image.open(out))
        self.assertEqual(big.shape, (32, 32, 4))
        self.assertTrue(np.array_equal(big[::4, ::4], original))

    def test_palette_formats_agree(self):
        gpl = self.base / 'pal.gpl'
        gpl.write_text('GIMP Palette\nName: test\nColumns: 4\n#\n' +
                       '\n'.join('%d %d %d\tc%d' % (r, g, b, i) for i, (r, g, b) in enumerate(PALETTE.tolist())),
                       encoding='utf-8')
        png = self.base / 'pal.png'
        Image.fromarray(PALETTE.reshape(1, -1, 3), 'RGB').save(png)
        for path in (self.palette, gpl, png):
            self.assertTrue(np.array_equal(pixel_fit.load_palette(path), PALETTE), str(path))


if __name__ == '__main__':
    unittest.main()
