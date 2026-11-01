import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('import_audit', Path(__file__).with_name('import_audit.py'))
import_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_audit)

PROJECT = '''config_version=5

[application]

config/name="Demo"
config/features=PackedStringArray("4.7", "GL Compatibility")

[display]

window/size/viewport_width=480
window/size/viewport_height=270
window/stretch/mode="viewport"
window/stretch/scale_mode="integer"

[rendering]

textures/canvas_textures/default_texture_filter=0
renderer/rendering_method="gl_compatibility"
'''

IMPORT = '''[remap]

importer="texture"
type="CompressedTexture2D"
uid="uid://demo"
path="res://.godot/imported/x.ctex"
metadata={
"vram_texture": false
}

[deps]

source_file="res://%s"

[params]

compress/mode=%d
mipmaps/generate=%s
process/fix_alpha_border=true
process/size_limit=0
detect_3d/compress_to=1
%s
'''


class ImportAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='import-audit-test-')
        self.root = Path(self.temp.name)
        (self.root / 'project.godot').write_text(PROJECT, encoding='utf-8')
        (self.root / 'assets').mkdir()
        (self.root / 'addons').mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def add(self, source, mode=0, mipmaps='false', extra=''):
        (self.root / source).parent.mkdir(parents=True, exist_ok=True)
        (self.root / (source + '.import')).write_text(IMPORT % (source, mode, mipmaps, extra), encoding='utf-8')

    def run_audit(self, *extra):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = import_audit.main([str(self.root), *extra])
        return code, json.loads(buffer.getvalue())

    def test_clean_pixel_project_passes(self):
        self.add('assets/hero.png')
        code, report = self.run_audit()
        self.assertEqual(code, 0)
        self.assertEqual(report['textures_audited'], 1)
        settings = report['project_settings']
        self.assertEqual(settings['settings']['display/window/stretch/scale_mode'], 'integer')
        self.assertEqual(settings['settings']['rendering/renderer/rendering_method'], 'gl_compatibility')
        self.assertEqual(settings['warnings'], [])

    def test_lossy_mipmapped_and_fractional_svg_fail(self):
        self.add('assets/lossy.png', mode=1)
        self.add('assets/mips.png', mipmaps='true')
        self.add('assets/icon.svg', extra='svg/scale=1.5')
        self.add('assets/ok.svg', extra='svg/scale=2.0')
        code, report = self.run_audit()
        self.assertEqual(code, 1)
        flagged = {t['source']: t['problems'] for t in report['textures']}
        self.assertEqual(set(flagged), {'assets/lossy.png', 'assets/mips.png', 'assets/icon.svg'})

    def test_glob_and_addons_filtering(self):
        self.add('addons/plugin/icon.png', mode=2)
        self.add('ui/menu.png', mode=1)
        code, report = self.run_audit('--path-glob', 'assets/**')
        self.assertEqual(code, 0)
        self.assertEqual(report['textures_audited'], 0)
        code, report = self.run_audit('--include-addons', '--path-glob', 'addons/**')
        self.assertEqual(code, 1)

    def test_project_defaults_and_warnings(self):
        (self.root / 'project.godot').write_text('config_version=5\n\n[display]\n\nwindow/stretch/mode="canvas_items"\n',
                                                 encoding='utf-8')
        code, report = self.run_audit()
        settings = report['project_settings']
        self.assertEqual(settings['settings']['rendering/textures/canvas_textures/default_texture_filter_name'],
                         'Linear')
        self.assertEqual(len(settings['warnings']), 3)
        self.assertEqual(code, 0, 'project warnings alone do not fail')

    def test_missing_project_is_an_error(self):
        (self.root / 'project.godot').unlink()
        with self.assertRaises(SystemExit):
            self.run_audit()


if __name__ == '__main__':
    unittest.main()
