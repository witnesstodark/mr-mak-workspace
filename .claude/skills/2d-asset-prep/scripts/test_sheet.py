import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('sheet', Path(__file__).with_name('sheet.py'))
sheet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sheet)


def run(argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = sheet.main(argv)
    return code, json.loads(buffer.getvalue())


class SheetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sheet-test-')
        self.base = Path(self.temp.name)
        self.paths = []
        for index in range(5):
            image = np.zeros((8, 6, 4), np.uint8)
            image[2:6, 1:5] = (40 * index, 100, 200, 255)
            path = self.base / ('walk_%d.png' % (index if index != 4 else 10))
            Image.fromarray(image, 'RGBA').save(path)
            self.paths.append(path)

    def tearDown(self):
        self.temp.cleanup()

    def test_pack_then_slice_round_trips(self):
        out = self.base / 'out/walk.png'
        code, report = run(['pack', *map(str, self.paths), '--out', str(out), '--columns', '3'])
        self.assertEqual(code, 0)
        self.assertEqual(report['size'], [18, 16])
        manifest = json.loads(out.with_suffix('.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['frames'][4]['x'], 6)
        self.assertEqual(manifest['frames'][4]['y'], 8)
        code, report = run(['slice', str(out), '--cell', '6x8', '--out', str(self.base / 'cut'), '--skip-empty'])
        self.assertEqual(report['written'], 5)
        self.assertEqual(report['skipped_empty'], 1)
        for index, path in enumerate(self.paths):
            original = np.array(Image.open(path))
            cut = np.array(Image.open(self.base / ('cut/walk_%03d.png' % index)))
            self.assertTrue(np.array_equal(original, cut))

    def test_natural_name_order(self):
        out = self.base / 'named.png'
        shuffled = [self.paths[4], self.paths[1], self.paths[0]]
        run(['pack', *map(str, shuffled), '--out', str(out), '--order', 'name'])
        manifest = json.loads(out.with_suffix('.json').read_text(encoding='utf-8'))
        self.assertEqual([f['name'] for f in manifest['frames']], ['walk_0', 'walk_1', 'walk_10'])

    def test_padding_and_extrude(self):
        out = self.base / 'pad.png'
        run(['pack', str(self.paths[0]), '--out', str(out), '--cell', '6x8', '--padding', '2', '--extrude', '1'])
        packed = np.array(Image.open(out))
        self.assertEqual(packed.shape[:2], (12, 10))
        self.assertTrue(np.array_equal(packed[5, 1], packed[5, 2]), 'left edge extruded by one pixel')
        self.assertEqual(packed[5, 0, 3], 0, 'outer padding stays transparent')

    def test_oversized_frame_is_an_error(self):
        with self.assertRaises(SystemExit):
            run(['pack', str(self.paths[0]), '--out', str(self.base / 'x.png'), '--cell', '4x4'])

    def test_preview_gif_frames_and_scale(self):
        out = self.base / 'walk.gif'
        code, report = run(['preview', *map(str, self.paths[:4]), '--out', str(out), '--scale', '3', '--fps', '10'])
        self.assertEqual(code, 0)
        with Image.open(out) as gif:
            self.assertEqual(gif.size, (18, 24))
            self.assertEqual(gif.n_frames, 4)
            self.assertEqual(gif.info['duration'], 100)
            gif.seek(1)
            pixel = gif.convert('RGB').getpixel((6, 9))
        self.assertEqual(pixel, (40, 100, 200), 'colours survive exactly')

    def test_preview_from_sheet_range(self):
        out = self.base / 'sheet.png'
        run(['pack', *map(str, self.paths), '--out', str(out)])
        code, report = run(['preview', '--sheet', str(out), '--cell', '6x8', '--frames', '1-3',
                            '--out', str(self.base / 'part.gif'), '--background', 'none'])
        self.assertEqual(report['frames'], 3)

    def test_contact_sheet(self):
        out = self.base / 'contact.png'
        code, report = run(['contact', *map(str, self.paths), '--out', str(out), '--columns', '5',
                            '--grid', '--labels'])
        self.assertEqual(code, 0)
        self.assertEqual(report['size'], [5 * 24 + 6 * 8, 32 + 12 + 16])


if __name__ == '__main__':
    unittest.main()
