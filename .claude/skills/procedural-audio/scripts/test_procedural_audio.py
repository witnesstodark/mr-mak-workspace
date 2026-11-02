"""Tests for the procedural audio scripts: determinism, loudness, loops, no clipping, scores and instruments."""
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / ('%s.py' % name))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


dsp = load('dsp')
instruments = load('instruments')
score = load('score')
master = load('master')
catalogue = load('catalogue')
render = load('render')
CATALOGUE = str(HERE / 'example_catalogue.py')
SR = dsp.SR


def run(*argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = render.main([str(a) for a in argv])
    return code, json.loads(buffer.getvalue())


def pitch(x, lo=80.0, hi=1500.0):
    """Fundamental by autocorrelation of a steady middle stretch."""
    seg = x[int(0.1 * SR):int(0.4 * SR)]
    seg = seg - seg.mean()
    acf = np.correlate(seg, seg, 'full')[len(seg) - 1:]
    a, b = int(SR / hi), int(SR / lo)
    lag = a + int(np.argmax(acf[a:b]))
    y0, y1, y2 = acf[lag - 1], acf[lag], acf[lag + 1]
    return SR / (lag + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2))


class RenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='procedural-audio-test-')
        cls.out = Path(cls.temp.name) / 'a'
        cls.code, cls.report = run('render', '--catalogue', CATALOGUE, '--out', cls.out, '--jobs', 1, '--check',
                                   '--page', '--only', 'knock_door', 'menu_tick', 'amb_fire_loop', 'cue_alert',
                                   'music_tavern_loop')
        cls.manifest = json.loads((cls.out / 'manifest.json').read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_the_example_renders_without_problems(self):
        self.assertEqual(self.code, 0, self.report['problems'])
        self.assertEqual(self.report['events'], 5)

    def test_same_seed_same_bytes_and_new_seed_new_take(self):
        again = Path(self.temp.name) / 'b'
        run('render', '--catalogue', CATALOGUE, '--out', again, '--jobs', 2, '--only', 'knock_door', 'cue_alert')
        for stem in ('knock_door', 'cue_alert'):
            first = self.manifest['events'][stem]['files']
            for entry in first:
                self.assertEqual((again / entry['file']).read_bytes(), (self.out / entry['file']).read_bytes())
            self.assertNotEqual(first[0]['sha256'], first[1]['sha256'])
            self.assertNotEqual(first[0]['seed'], first[1]['seed'])

    def test_loudness_within_tolerance_and_no_clipping_measured_from_the_files(self):
        for stem, info in self.manifest['events'].items():
            for entry in info['files']:
                x, rate, _ = master.audio_tool.read_wav(self.out / entry['file'])
                m = master.audio_tool.measure(x, rate)
                level = m['integrated_lufs'] if info['loop'] else m['max_momentary_lufs']
                self.assertLessEqual(abs(level - info['target_lufs']), render.TOLERANCE_DB, (stem, level))
                self.assertLessEqual(m['true_peak_dbtp'], master.CEILING, stem)
                self.assertEqual(m['clipped_samples'], 0, stem)
                self.assertEqual((rate, x.shape[1]), (48000, info['channels']))

    def test_loops_repeat_without_a_seam(self):
        for stem in ('amb_fire_loop', 'music_tavern_loop'):
            entry = self.manifest['events'][stem]['files'][0]
            x, _, _ = master.audio_tool.read_wav(self.out / entry['file'])
            twice = np.vstack([x, x])
            steps = np.abs(np.diff(twice, axis=0)).max(axis=1)
            seam_step = steps[len(x) - 1]
            self.assertLessEqual(seam_step, np.percentile(steps, 99.9), stem)
            self.assertLess(entry['seam']['jump_ratio'], render.SEAM_JUMP_RATIO)
            self.assertLess(abs(entry['seam']['level_step_db']),
                            entry['seam']['usual_step_db'] + render.SEAM_LEVEL_MARGIN_DB)
        tempo, beats = 112.0, 16
        music = self.manifest['events']['music_tavern_loop']['files'][0]
        self.assertAlmostEqual(music['length_s'], beats * 60.0 / tempo, places=3)

    def test_one_shots_start_on_the_attack_and_end_at_zero(self):
        entry = self.manifest['events']['knock_door']['files'][0]
        x, _, _ = master.audio_tool.read_wav(self.out / entry['file'])
        m = master.audio_tool.measure(x, SR)
        self.assertLessEqual(m['leading_silence_ms'], 2.0)
        self.assertLess(np.abs(x[-1]).max(), 1e-3)
        self.assertLess(np.abs(x[0]).max(), 1e-3)

    def test_verdicts_stick_to_their_take_and_lapse_when_it_changes(self):
        code, report = run('mark', 'knock_door', '--take', 2, '--verdict', 'accepted', '--note', 'good', '--out', self.out)
        manifest = json.loads((self.out / 'manifest.json').read_text(encoding='utf-8'))
        files = manifest['events']['knock_door']['files']
        self.assertEqual([f['status'] for f in files], ['candidate', 'accepted', 'candidate'])
        reviews = json.loads((self.out / 'reviews.json').read_text(encoding='utf-8'))
        reviews['knock_door']['2']['model'] = 'models.door_knock(knocks=2)'
        render.apply_reviews(manifest, reviews)
        self.assertTrue(manifest['events']['knock_door']['files'][1]['status'].startswith('candidate'))

    def test_page_has_a_player_per_take(self):
        page = (self.out / 'listen.html').read_text(encoding='utf-8')
        takes = sum(len(info['files']) for info in self.manifest['events'].values())
        self.assertEqual(page.count('<audio'), takes)
        self.assertIn('src="impact/knock_door_01.wav"', page)


class MasteringTests(unittest.TestCase):
    def test_gain_only_reports_the_shortfall_instead_of_limiting(self):
        rng = np.random.default_rng(1)
        x = np.zeros(SR)
        x[100:160] = rng.uniform(-1, 1, 60)  # a sharp click: all peak, little loudness
        x[2000:] += 0.001 * rng.standard_normal(SR - 2000)
        y, report = master.normalise(x, -10.0, 'momentary')
        self.assertFalse(report['target_reached'])
        self.assertGreater(report['shortfall_db'], 0)
        self.assertLessEqual(20 * np.log10(master.audio_tool.true_peak(y[:, None])), master.CEILING)
        ratio = y[x != 0] / x[x != 0]
        np.testing.assert_allclose(ratio, ratio[0])  # one gain for every sample

    def test_trim_keeps_the_attack_and_fades_both_ends(self):
        tone = np.sin(2 * np.pi * 300 * np.arange(SR // 2) / SR) * 0.5
        x = np.concatenate([np.zeros(SR // 10), tone, np.zeros(SR // 10)])
        y = master.trim(x)
        self.assertLess(len(y), len(x) - SR // 10)
        self.assertLessEqual(np.argmax(np.abs(y) > 0.01), int(0.002 * SR))
        self.assertEqual(y[0], 0.0)
        self.assertLess(abs(y[-1]), 1e-6)

    def test_crossfade_loop_and_wrap_are_continuous(self):
        rng = np.random.default_rng(4)
        texture = dsp.butter_low(rng.standard_normal(SR * 3), 2000)
        loop = dsp.blend_loop(texture, 2.0, 0.5)
        self.assertEqual(len(loop), 2 * SR)
        self.assertLess(master.seam(loop)['jump_ratio'], 1.0)
        events = np.zeros(SR * 3)
        events[int(1.9 * SR):int(1.9 * SR) + 4800] = np.hanning(4800)
        wrapped = dsp.fold_loop(events, 2.0)
        self.assertAlmostEqual(wrapped.sum(), events.sum())

    def test_seam_check_catches_a_texture_cut_without_blending(self):
        rng = np.random.default_rng(7)
        fading = dsp.butter_low(rng.standard_normal(SR * 2), 2000) * np.linspace(1.0, 0.3, SR * 2)
        report = master.seam(fading)
        self.assertGreater(abs(report['level_step_db']), report['usual_step_db'] + render.SEAM_LEVEL_MARGIN_DB)


class ScoreTests(unittest.TestCase):
    TEXT = """
    tempo 120   # two beats a second
    track lead flute pan=0.2 velocity=0.7
      C4:1 r:1/2 F#4+A4:1.5@0.9 | Bb3:1
    track beat drum
      low:1 high:1/2 rim:1/2
    """

    def test_parse_reads_notes_chords_rests_sharps_and_velocity(self):
        parsed = score.parse(self.TEXT)
        lead, beat = parsed['tracks']
        self.assertEqual(parsed['tempo'], 120.0)
        self.assertEqual(lead['notes'][1], (1.5, 1.5, ['F#4', 'A4'], 0.9))
        self.assertEqual(lead['notes'][2][0], 3.0)
        self.assertEqual(lead['beat'], 4.0)
        self.assertEqual([n[2][0] for n in beat['notes']], ['low', 'high', 'rim'])
        self.assertEqual(score.describe(self.TEXT)['seconds'], 2.0)

    def test_errors_name_the_line(self):
        for text, words in (('track a banjo\n  C4:1', 'instruments'), ('track a reed\n  C4-1', 'line 2'),
                            ('track a drum\n  boom:1', 'drum hit'), ('C4:1', 'before any track'),
                            ('track a reed\n  H4:1', 'not a note')):
            with self.assertRaises(score.ScoreError) as raised:
                score.parse(text)
            self.assertIn(words, str(raised.exception))

    def test_one_shot_rings_out_and_loop_is_exact(self):
        rng = np.random.default_rng(3)
        shot = score.render(self.TEXT, rng)
        self.assertEqual(shot.shape[1], 2)
        self.assertGreater(len(shot), 2.0 * SR)
        looped = score.render(self.TEXT, np.random.default_rng(3), loop=True)
        self.assertEqual(len(looped), 2 * SR)

    def test_note_names(self):
        self.assertAlmostEqual(instruments.note_freq('A4'), 440.0)
        self.assertAlmostEqual(instruments.note_freq('C4'), 261.626, places=2)
        self.assertAlmostEqual(instruments.note_freq('Bb3'), instruments.note_freq('A#3'))
        self.assertAlmostEqual(instruments.note_freq('69'), 440.0)


class InstrumentTests(unittest.TestCase):
    def test_pitched_instruments_sound_their_note(self):
        for name in ('pluck', 'reed', 'bowed', 'flute', 'mallet'):
            x = instruments.INSTRUMENTS[name](np.random.default_rng(5), 220.0, 0.6, 0.8)
            self.assertAlmostEqual(pitch(x), 220.0, delta=220.0 * 0.01, msg=name)
            self.assertLessEqual(np.abs(x).max(), 1.0)

    def test_bell_has_its_prime_and_hum(self):
        x = instruments.bell(np.random.default_rng(5), 440.0, 1.0)
        spectrum = np.abs(np.fft.rfft(x[:SR]))
        freqs = np.fft.rfftfreq(SR, 1 / SR)
        for f in (220.0, 440.0, 880.0):
            band = (freqs > f * 0.98) & (freqs < f * 1.02)
            self.assertGreater(spectrum[band].max(), spectrum.max() * 0.1, f)

    def test_drum_rim_is_brighter_than_the_middle(self):
        def centroid(x):
            power = np.abs(np.fft.rfft(x)) ** 2
            return float((np.fft.rfftfreq(len(x), 1 / SR) * power).sum() / power.sum())
        low = instruments.drum(np.random.default_rng(2), 'low')
        high = instruments.drum(np.random.default_rng(2), 'high')
        self.assertGreater(centroid(high), centroid(low) * 1.5)


class CatalogueTests(unittest.TestCase):
    def test_example_catalogue_covers_sounds_cues_and_loops(self):
        events = render.load_catalogue(CATALOGUE)
        kinds = [e.category for e in events.values()]
        self.assertGreaterEqual(len([k for k in kinds if k not in ('cue', 'music', 'ambience', 'interface')]), 12)
        self.assertGreaterEqual(kinds.count('cue'), 3)
        self.assertTrue(any(e.loop and e.category == 'music' for e in events.values()))
        seeds = [e.seed(k) for e in events.values() for k in range(1, e.takes + 1)]
        self.assertEqual(len(seeds), len(set(seeds)))

    def test_check_finds_duplicates_and_bad_targets(self):
        make = lambda seed: np.zeros(10)
        events = [catalogue.Event('a_b', make, 1, -20, 'x'), catalogue.Event('a_b', make, 1, -3, 'y')]
        problems = catalogue.check(events)
        self.assertEqual(len(problems), 2)
        with self.assertRaises(ValueError):
            catalogue.Event('Bad Stem', make, 1, -20, 'x')


if __name__ == '__main__':
    unittest.main()
