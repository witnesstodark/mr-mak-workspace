"""Tests for pack_sprites.py with synthetic frames (no Blender needed)."""
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location('pack_sprites', Path(__file__).with_name('pack_sprites.py'))
pack_sprites = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack_sprites)


class PackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pack-sprites-test-')
        self.out = Path(self.temp.name)
        directions, frames = ['down', 'right', 'up'], [1, 4, 7]
        files = {'color': {}, 'normal': {}}
        for d_index, direction in enumerate(directions):
            for pass_name, suffix in (('color', ''), ('normal', '_n')):
                paths = []
                for f_index in range(len(frames)):
                    rel = 'frames/walk/%s/walk_%s_%02d%s.png' % (direction, direction, f_index, suffix)
                    (self.out / rel).parent.mkdir(parents=True, exist_ok=True)
                    colour = (40 * d_index, 60 * f_index, 128 if suffix else 0, 255)
                    Image.new('RGBA', (16, 20), colour).save(self.out / rel)
                    paths.append(rel)
                files[pass_name][direction] = paths
        manifest = {'canvas': [16, 20], 'pixels_per_unit': 16, 'pivot': [8, 18], 'camera': {'elevation': 35.0},
                    'suffixes': {'color': '', 'normal': '_n'},
                    'directions': [{'name': d, 'turn_deg': 90.0 * i} for i, d in enumerate(directions)],
                    'clips': {'walk': {'frames': frames, 'fps': 8, 'loop': True, 'events': {'contact': [0, 2]},
                                       'files': files}}, 'warnings': []}
        (self.out / 'sprites.json').write_text(json.dumps(manifest), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_sheets_have_a_row_per_direction_and_a_column_per_frame(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            pack_sprites.main([str(self.out), '--previews', '--scale', '2'])
        report = json.loads(buffer.getvalue())
        with Image.open(self.out / 'sheets/walk.png') as sheet:
            self.assertEqual(sheet.size, (48, 60))
            self.assertEqual(sheet.getpixel((16 + 2, 20 + 2)), (40, 60, 0, 255))  # row right, frame 1
        layout = json.loads((self.out / 'sheets/walk.json').read_text(encoding='utf-8'))
        cell = layout['frames'][5]
        self.assertEqual((cell['direction'], cell['frame'], cell['scene_frame']), ('right', 2, 7))
        self.assertEqual((cell['x'], cell['y'], cell['w'], cell['h']), (32, 20, 16, 20))
        self.assertEqual((layout['fps'], layout['events'], layout['pivot']), (8, {'contact': [0, 2]}, [8, 18]))
        self.assertEqual([d['name'] for d in layout['directions']], ['down', 'right', 'up'])
        normal = json.loads((self.out / 'sheets/walk_n.json').read_text(encoding='utf-8'))
        self.assertEqual(normal['pass'], 'normal')
        self.assertTrue((self.out / 'previews/walk_up.gif').is_file())
        self.assertTrue((self.out / 'previews/walk_contact.png').is_file())
        self.assertEqual(len([w for w in report['written'] if 'sheet' in w]), 2)


if __name__ == '__main__':
    unittest.main()
