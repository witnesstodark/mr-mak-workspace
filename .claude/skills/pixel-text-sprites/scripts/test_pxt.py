import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('pxt', Path(__file__).with_name('pxt.py'))
pxt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pxt)

EXAMPLE = Path(__file__).resolve().parent.parent / 'references/example.pxt'

SMALL = """\
palette base
  . transparent
  r #ff0000
  b #0000ff80
palette alt
  r #00ff00

sprite arrow 3x2
  anim go 0-1,first fps=4 once
  frame first
    r..
    rrb
  frame from=0 flip=h
"""


def run(argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = pxt.main(argv)
    return code, json.loads(buffer.getvalue())


class PxtTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pxt-test-')
        self.base = Path(self.temp.name)
        self.source = self.base / 'src/small.pxt'
        self.source.parent.mkdir()
        self.source.write_text(SMALL, encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_render_writes_sheet_manifest_and_variant(self):
        out = self.base / 'out'
        code, report = run(['render', str(self.source), '--out', str(out)])
        self.assertEqual(code, 0)
        self.assertEqual([w['palette'] for w in report['written']], ['base', 'alt'])
        sheet = np.array(Image.open(out / 'arrow.png'))
        self.assertEqual(sheet.shape, (2, 6, 4))
        self.assertEqual(tuple(sheet[0, 0]), (255, 0, 0, 255))
        self.assertEqual(tuple(sheet[1, 2]), (0, 0, 255, 128))
        self.assertEqual(tuple(sheet[0, 1]), (0, 0, 0, 0))
        # Second frame is the first mirrored.
        self.assertEqual(tuple(sheet[0, 5]), (255, 0, 0, 255))
        self.assertEqual(tuple(sheet[1, 3]), (0, 0, 255, 128))
        alt = np.array(Image.open(out / 'arrow.alt.png'))
        self.assertEqual(tuple(alt[0, 0]), (0, 255, 0, 255))
        manifest = json.loads((out / 'arrow.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['anims']['go'], {'frames': [0, 1, 0], 'fps': 4.0, 'loop': False})
        self.assertEqual(manifest['frames'][1]['x'], 3)

    def test_previews_are_integer_scaled(self):
        out = self.base / 'out'
        code, report = run(['render', str(self.source), '--out', str(out), '--scale', '4',
                            '--variants', 'base', '--columns', '1', '--padding', '1'])
        self.assertEqual(code, 0)
        self.assertIn('arrow.go.gif', report['written'][0]['files'])
        with Image.open(out / 'arrow.x4.png') as preview:
            self.assertEqual(preview.size, (5 * 4, 8 * 4))

    def test_check_reports_bad_row_with_line_number(self):
        bad = self.base / 'src/bad.pxt'
        bad.write_text(SMALL.replace('rrb', 'rrbr'), encoding='utf-8')
        code, report = run(['check', str(bad)])
        self.assertEqual(code, 1)
        self.assertIn('bad.pxt:12', report['error'])

    def test_unknown_key_is_an_error(self):
        bad = self.base / 'src/bad.pxt'
        bad.write_text(SMALL.replace('rrb', 'rzb'), encoding='utf-8')
        code, report = run(['check', str(bad)])
        self.assertEqual(code, 1)
        self.assertIn('z', report['error'])

    def test_import_round_trips(self):
        out = self.base / 'out'
        run(['render', str(self.source), '--out', str(out), '--variants', 'base'])
        imported = self.base / 'again/arrow.pxt'
        code, report = run(['import', str(out / 'arrow.png'), '--out', str(imported),
                            '--cell', '3x2', '--keys-from', str(self.source)])
        self.assertEqual((code, report['frames']), (0, 2))
        self.assertIn('    r..', imported.read_text(encoding='utf-8'))
        again = self.base / 'out2'
        run(['render', str(imported), '--out', str(again)])
        self.assertTrue(np.array_equal(np.array(Image.open(out / 'arrow.png')),
                                       np.array(Image.open(again / 'arrow.png'))))

    def test_shift_moves_pixels_and_fills_transparent(self):
        text = SMALL.replace('frame from=0 flip=h', 'frame from=0 shift=1,1')
        doc = pxt.parse_text(text)
        grid = pxt.build(doc)[0]['grids'][1]
        self.assertEqual([''.join(r) for r in grid], ['...', '.r.'])

    def test_refuses_output_next_to_input(self):
        with self.assertRaises(SystemExit):
            pxt.main(['render', str(self.source), '--out', str(self.source.parent)])

    def test_example_file_is_valid(self):
        code, report = run(['check', str(EXAMPLE)])
        self.assertEqual(code, 0, report)
        self.assertEqual(report['palettes'], ['base', 'poison'])


if __name__ == '__main__':
    unittest.main()
