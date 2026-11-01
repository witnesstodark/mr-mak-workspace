import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('tiles', Path(__file__).with_name('tiles.py'))
tiles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tiles)

TILE, Q = 32, 16
COLOURS = {'preview': (0, 0, 0), 'inner': (255, 255, 0), 'outer': (255, 0, 0),
           'h_edge': (0, 255, 0), 'v_edge': (0, 0, 255), 'fill': (255, 255, 255)}
KIND = {}
for q in ((0, 0), (1, 0), (0, 1), (1, 1)):
    KIND[q] = 'preview'
for q in ((2, 0), (3, 0), (2, 1), (3, 1)):
    KIND[q] = 'inner'
for q in ((0, 2), (3, 2), (0, 5), (3, 5)):
    KIND[q] = 'outer'
for q in ((1, 2), (2, 2), (1, 5), (2, 5)):
    KIND[q] = 'h_edge'
for q in ((0, 3), (0, 4), (3, 3), (3, 4)):
    KIND[q] = 'v_edge'
for q in ((1, 3), (2, 3), (1, 4), (2, 4)):
    KIND[q] = 'fill'


def template():
    """Each quarter is coloured by piece type, with a parity marker at its (1, 1) pixel."""
    image = np.zeros((3 * TILE, 2 * TILE, 4), np.uint8)
    for (qx, qy), kind in KIND.items():
        image[qy * Q:(qy + 1) * Q, qx * Q:(qx + 1) * Q] = COLOURS[kind] + (255,)
        image[qy * Q + 1, qx * Q + 1] = (10 + 100 * (qx % 2), 10 + 100 * (qy % 2), 77, 255)
    return Image.fromarray(image, 'RGBA')


def quadrant_kinds(atlas, index):
    column, row = index % 8, index // 8
    kinds = {}
    for name, offset in (('TL', (0, 0)), ('TR', (1, 0)), ('BL', (0, 1)), ('BR', (1, 1))):
        x = column * TILE + offset[0] * Q
        y = row * TILE + offset[1] * Q
        colour = tuple(atlas[y + 8, x + 8, :3])
        kinds[name] = next(k for k, c in COLOURS.items() if c == colour)
        marker = tuple(atlas[y + 1, x + 1, :3])
        kinds[name + '_parity'] = ((marker[0] - 10) // 100, (marker[1] - 10) // 100)
    return kinds


class BlobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tiles-test-')
        self.base = Path(self.temp.name)
        self.template = self.base / 'grass_a2.png'
        template().save(self.template)
        out = self.base / 'grass_blob.png'
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            tiles.main(['blob', str(self.template), '--tile', '32', '--out', str(out),
                        '--json', str(self.base / 'map.json'), '--godot-tres', str(self.base / 'grass.tres'),
                        '--texture-res', 'res://tiles/grass_blob.png', '--terrain-name', 'Grass'])
        self.report = json.loads(buffer.getvalue())
        self.atlas = np.array(Image.open(out))
        self.map = json.loads((self.base / 'map.json').read_text(encoding='utf-8'))
        self.by_mask = {t['mask']: t['index'] for t in self.map['tiles']}

    def tearDown(self):
        self.temp.cleanup()

    def kinds(self, *names):
        mask = sum(tiles.BITS[n] for n in names)
        return quadrant_kinds(self.atlas, self.by_mask[mask])

    def test_forty_seven_tiles_in_an_eight_by_six_atlas(self):
        self.assertEqual(self.report['tiles'], 47)
        self.assertEqual(self.atlas.shape[:2], (6 * TILE, 8 * TILE))
        self.assertEqual(self.atlas[5 * TILE + 8, 7 * TILE + 8, 3], 0, 'slot 47 is empty')
        self.assertEqual(self.map['tiles'][0]['mask'], 0)
        self.assertEqual(self.map['tiles'][-1]['mask'], 255)

    def test_piece_selection(self):
        isolated = self.kinds()
        self.assertEqual({isolated[k] for k in ('TL', 'TR', 'BL', 'BR')}, {'outer'})
        full = self.kinds(*tiles.ORDER)
        self.assertEqual({full[k] for k in ('TL', 'TR', 'BL', 'BR')}, {'fill'})
        corridor = self.kinds('N', 'S')
        self.assertEqual({corridor[k] for k in ('TL', 'TR', 'BL', 'BR')}, {'v_edge'})
        row = self.kinds('E', 'W')
        self.assertEqual({row[k] for k in ('TL', 'TR', 'BL', 'BR')}, {'h_edge'})
        cross = self.kinds('N', 'E', 'S', 'W')
        self.assertEqual({cross[k] for k in ('TL', 'TR', 'BL', 'BR')}, {'inner'})
        corner = self.kinds('E', 'S', 'SE')  # top-left corner of a patch
        self.assertEqual((corner['TL'], corner['TR'], corner['BL'], corner['BR']),
                         ('outer', 'h_edge', 'v_edge', 'fill'))

    def test_quarters_keep_their_position_parity(self):
        expected = {'TL': (0, 0), 'TR': (1, 0), 'BL': (0, 1), 'BR': (1, 1)}
        for index in range(47):
            kinds = quadrant_kinds(self.atlas, index)
            for name, parity in expected.items():
                self.assertEqual(kinds[name + '_parity'], parity, 'tile %d %s' % (index, name))

    def test_corner_bits_require_both_sides(self):
        self.assertEqual(tiles.reduce_mask(tiles.BITS['NE'] | tiles.BITS['N']), tiles.BITS['N'])
        self.assertEqual(len(tiles.blob_masks()), 47)

    def test_godot_resource_lists_peering_bits(self):
        text = (self.base / 'grass.tres').read_text(encoding='utf-8')
        self.assertIn('[ext_resource type="Texture2D" path="res://tiles/grass_blob.png" id="1_atlas"]', text)
        self.assertIn('terrain_set_0/terrain_0/name = "Grass"', text)
        full = self.map['tiles'][-1]
        key = '%d:%d/0' % tuple(full['atlas'])
        for bit in tiles.GODOT_BITS.values():
            self.assertIn('%s/terrains_peering_bit/%s = 0' % (key, bit), text)
        self.assertNotIn('0:0/0/terrains_peering_bit', text, 'the isolated tile has no peering bits')

    def test_wrong_template_size_is_rejected(self):
        bad = self.base / 'bad.png'
        Image.new('RGBA', (64, 64)).save(bad)
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()):
                tiles.main(['blob', str(bad), '--tile', '32', '--out', str(self.base / 'x.png')])


class SeamTests(unittest.TestCase):
    def run_json(self, argv):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = tiles.main(argv)
        return code, json.loads(buffer.getvalue())

    def test_seamless_and_seamed_tiles(self):
        with tempfile.TemporaryDirectory(prefix='seams-test-') as folder:
            x = np.arange(16)
            wave = (np.sin(2 * np.pi * x / 16) * 40 + 120).astype(np.uint8)
            seamless = np.zeros((16, 16, 4), np.uint8)
            seamless[:, :, 0] = wave[None, :]
            seamless[:, :, 1] = wave[:, None]
            seamless[:, :, 3] = 255
            ramp = seamless.copy()
            ramp[:, :, 0] = (x * 12).astype(np.uint8)[None, :]
            good, bad = Path(folder) / 'good.png', Path(folder) / 'bad.png'
            Image.fromarray(seamless, 'RGBA').save(good)
            Image.fromarray(ramp, 'RGBA').save(bad)
            code, report = self.run_json(['seams', str(good), str(bad), '--threshold', '20', '--strict'])
            self.assertEqual(code, 1)
            good_stats, bad_stats = report['tiles']
            self.assertLess(good_stats['left_right']['ratio'], 1.5)
            self.assertGreater(bad_stats['left_right']['ratio'], 1.5)
            self.assertEqual(good_stats['left_right']['mismatched_pixels'], 0)
            code, report = self.run_json(['preview', str(good), '--out', str(Path(folder) / 'p.png'),
                                          '--repeat', '3', '--scale', '2', '--grid'])
            self.assertEqual(report['size'], [96, 96])


if __name__ == '__main__':
    unittest.main()
