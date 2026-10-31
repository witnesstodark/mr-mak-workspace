import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('palette', Path(__file__).with_name('palette.py'))
palette = importlib.util.module_from_spec(spec)
spec.loader.exec_module(palette)


def run(argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = palette.main(argv)
    return code, json.loads(buffer.getvalue())


class PaletteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='palette-test-')
        self.base = Path(self.temp.name)
        self.pal = self.base / 'base.hex'
        self.pal.write_text('#1f1424\n2f7a3e\n5aa83c\n; comment\na5d454\n', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def image(self, name, pixels):
        path = self.base / name
        Image.fromarray(np.array(pixels, np.uint8), 'RGBA').save(path)
        return path

    def test_check_passes_clean_art(self):
        path = self.image('ok.png', [[(31, 20, 36, 255), (47, 122, 62, 255)],
                                     [(47, 122, 62, 255), (0, 0, 0, 0)]])
        code, report = run(['check', str(path), '--palette', str(self.pal)])
        self.assertEqual(code, 0)
        self.assertTrue(report['pass'])
        self.assertEqual(report['files'][0]['colours'], 2)

    def test_check_fails_off_palette_and_semi(self):
        path = self.image('bad.png', [[(31, 20, 36, 255), (1, 2, 3, 255)],
                                      [(47, 122, 62, 120), (0, 0, 0, 0)]])
        code, report = run(['check', str(path), '--palette', str(self.pal)])
        self.assertEqual(code, 1)
        result = report['files'][0]
        self.assertEqual(result['off_palette'], 1)
        self.assertEqual(result['off_palette_samples'][0], [1, 0, '#010203'])
        self.assertEqual(result['semi_transparent'], 1)
        code, report = run(['check', str(path), '--palette', str(self.pal), '--allow-semi'])
        self.assertEqual(report['files'][0]['failures'], ['off-palette pixels'])

    def test_isolated_pixel_warning(self):
        g, d = (47, 122, 62, 255), (31, 20, 36, 255)
        path = self.image('dot.png', [[g, g, g], [g, d, g], [g, g, g]])
        code, report = run(['check', str(path), '--palette', str(self.pal)])
        self.assertEqual(code, 0)
        self.assertEqual(report['files'][0]['isolated_pixels_warning'], 1)

    def test_extract_orders_by_frequency(self):
        a, b = (10, 20, 30, 255), (200, 100, 0, 255)
        path = self.image('e.png', [[a, b, b], [b, a, (0, 0, 0, 0)]])
        out = self.base / 'e.hex'
        code, report = run(['extract', str(path), '--out', str(out)])
        self.assertEqual(out.read_text(encoding='utf-8').split(), ['c86400', '0a141e'])

    def test_swap_index_to_index(self):
        target = self.base / 'night.hex'
        target.write_text('000000\n111111\n222222\n333333\n', encoding='utf-8')
        path = self.image('s.png', [[(47, 122, 62, 255), (165, 212, 84, 255), (9, 9, 9, 255)]])
        out = self.base / 's_night.png'
        code, report = run(['swap', str(path), '--from', str(self.pal), '--to', str(target), '--out', str(out)])
        result = np.array(Image.open(out))
        self.assertEqual(tuple(result[0, 0, :3]), (17, 17, 17))
        self.assertEqual(tuple(result[0, 1, :3]), (51, 51, 51))
        self.assertEqual(tuple(result[0, 2, :3]), (9, 9, 9), 'colours outside --from are untouched')
        self.assertEqual(report['unmapped_opaque_pixels'], 1)

    def test_swap_rejects_length_mismatch(self):
        short = self.base / 'short.hex'
        short.write_text('000000\n', encoding='utf-8')
        path = self.image('s.png', [[(47, 122, 62, 255)]])
        with self.assertRaises(SystemExit):
            run(['swap', str(path), '--from', str(self.pal), '--to', str(short), '--out', str(self.base / 'x.png')])

    def test_swap_with_json_map(self):
        mapping = self.base / 'map.json'
        mapping.write_text('{"#2f7a3e": "#ff0000"}', encoding='utf-8')
        path = self.image('s.png', [[(47, 122, 62, 255)]])
        out = self.base / 'm.png'
        run(['swap', str(path), '--map', str(mapping), '--out', str(out)])
        self.assertEqual(tuple(np.array(Image.open(out))[0, 0, :3]), (255, 0, 0))

    def test_strip_convert_and_swatch(self):
        strip = self.base / 'strip.png'
        run(['strip', str(self.pal), '--out', str(strip)])
        with Image.open(strip) as image:
            self.assertEqual(image.size, (4, 1))
        gpl = self.base / 'base.gpl'
        run(['convert', str(self.pal), '--out', str(gpl)])
        self.assertEqual(palette.load_palette(gpl), palette.load_palette(self.pal))
        self.assertEqual(palette.load_palette(strip), palette.load_palette(self.pal))
        code, report = run(['swatch', str(self.pal), str(gpl), '--out', str(self.base / 'sw.png'), '--labels'])
        self.assertEqual(code, 0)
        self.assertEqual(len(report['palettes']), 2)


if __name__ == '__main__':
    unittest.main()
