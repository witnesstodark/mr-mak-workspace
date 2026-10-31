import contextlib
import importlib.util
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

spec = importlib.util.spec_from_file_location('audio_tool', Path(__file__).with_name('audio_tool.py'))
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def sine(freq, seconds, rate, amplitude, channels=1):
    t = np.arange(int(seconds * rate)) / rate
    x = amplitude * np.sin(2 * np.pi * freq * t)
    return np.repeat(x[:, None], channels, axis=1)


def run(*argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = tool.main([str(a) for a in argv])
    return code, json.loads(buffer.getvalue())


class AudioToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='audio-tool-test-')
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def wav(self, name, samples, rate=48000, bits=16):
        path = self.base / name
        path.write_bytes(tool.wav_bytes(samples, rate, bits))
        return path

    # -- loudness

    def test_k_weighting_matches_bs1770_48k_coefficients(self):
        (sb, sa), (hb, ha) = tool.k_weighting(48000)
        np.testing.assert_allclose(sb, [1.53512485958697, -2.69169618940638, 1.19839281085285], atol=1e-8)
        np.testing.assert_allclose(sa, [1.0, -1.69065929318241, 0.73248077421585], atol=1e-8)
        np.testing.assert_allclose(hb, [1.0, -2.0, 1.0])
        np.testing.assert_allclose(ha, [1.0, -1.99004745483398, 0.99007225036621], atol=1e-8)

    def test_sine_loudness_at_48k_and_44k(self):
        for rate in (48000, 44100):
            full = tool.loudness(sine(997, 5, rate, 1.0), rate)['integrated_lufs']
            quiet = tool.loudness(sine(1000, 5, rate, 0.1), rate)['integrated_lufs']
            self.assertAlmostEqual(full, -3.01, delta=0.05)
            self.assertAlmostEqual(quiet, -23.0, delta=0.1)

    def test_stereo_ebu_case(self):
        # EBU Tech 3341 case 1: stereo 1 kHz sine at -23 dBFS per channel reads -23.0 LUFS.
        x = sine(1000, 20, 48000, 10 ** (-23 / 20), channels=2)
        self.assertAlmostEqual(tool.loudness(x, 48000)['integrated_lufs'], -23.0, delta=0.1)

    def test_gating_ignores_silence(self):
        # 27 full tone blocks plus 3 partial blocks (75/50/25 %) pass the gates; the
        # 10 s of silence does not (ungated it would read about -29.4 LUFS).
        x = np.vstack([sine(1000, 3, 48000, 0.1), np.zeros((48000 * 10, 1))])
        expected = -23.01 + 10 * np.log10(28.5 / 30)
        self.assertAlmostEqual(tool.loudness(x, 48000)['integrated_lufs'], expected, delta=0.05)

    def test_short_sound_is_padded_to_one_block(self):
        report = tool.loudness(sine(1000, 0.1, 48000, 0.5), 48000)
        self.assertTrue(report['padded'])
        self.assertIsNotNone(report['max_momentary_lufs'])

    def test_true_peak_exceeds_sample_peak_for_intersample_sine(self):
        rate = 48000
        t = np.arange(rate) / rate
        x = (0.9 * np.sin(2 * np.pi * (rate / 4) * t + np.pi / 4))[:, None]
        self.assertGreater(tool.true_peak(x), np.abs(x).max() + 0.05)

    # -- WAV I/O

    def test_24_bit_round_trip(self):
        x = sine(440, 0.1, 48000, 0.5)
        path = self.wav('a.wav', x, bits=24)
        y, rate, info = tool.read_wav(path)
        self.assertEqual((rate, info['bits']), (48000, 24))
        np.testing.assert_allclose(y, x, atol=1.5 / 8388608)

    def test_float_and_extensible_wav_are_read(self):
        x = sine(440, 0.05, 48000, 0.25).astype('<f4')
        payload = x.tobytes()
        fmt = struct.pack('<HHIIHHHHIH14s', 0xFFFE, 1, 48000, 48000 * 4, 4, 32, 22, 32, 4, 3, b'\x00' * 14)
        data = b'WAVE' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(payload)) + payload
        path = self.base / 'float.wav'
        path.write_bytes(b'RIFF' + struct.pack('<I', len(data)) + data)
        y, rate, info = tool.read_wav(path)
        self.assertEqual(info['encoding'], 'float')
        np.testing.assert_allclose(y, x, atol=1e-7)

    def test_pcm2wav_round_trip(self):
        x = np.round(sine(440, 0.1, 48000, 0.5)[:, 0] * 32768).astype('<i2')
        raw = self.base / 'take.pcm'
        raw.write_bytes(x.tobytes())
        code, report = run('pcm2wav', raw, '--out', self.base / 'take.wav', '--rate', 48000)
        self.assertEqual((code, report['bits']), (0, 16))
        y, rate, _ = tool.read_wav(self.base / 'take.wav')
        np.testing.assert_array_equal(np.round(y[:, 0] * 32768).astype(np.int16), x)

    def test_non_wav_without_ffmpeg_names_the_alternative(self):
        path = self.base / 'take.mp3'
        path.write_bytes(b'ID3not really audio')
        with patch.object(tool.shutil, 'which', return_value=None):
            with self.assertRaises(SystemExit) as raised:
                tool.load_audio(path)
        self.assertIn('PCM', str(raised.exception))

    # -- commands

    def test_analyze_check_flags_clipping_and_leading_silence(self):
        x = np.vstack([np.zeros((4800, 1)), np.clip(sine(200, 0.3, 48000, 1.5), -1, 1)])
        code, report = run('analyze', self.wav('loud.wav', x), '--check')
        self.assertEqual(code, 1)
        flags = report['files'][0]['flags']
        self.assertIn('clipping', flags)
        self.assertIn('leading silence over 30 ms', flags)

    def test_analyze_counts_separate_sounds(self):
        burst = sine(800, 0.1, 48000, 0.5)
        gap = np.zeros((int(0.3 * 48000), 1))
        code, report = run('analyze', self.wav('takes.wav', np.vstack([burst, gap, burst, gap, burst])))
        self.assertEqual(report['files'][0]['segments'], 3)
        self.assertTrue(report['files'][0]['multiple_sounds'])

    def test_split_writes_one_file_per_take_with_exact_samples(self):
        burst = sine(800, 0.1, 48000, 0.5)
        gap = np.zeros((int(0.3 * 48000), 1))
        source = self.wav('takes.wav', np.vstack([gap, burst, gap, burst * 0.5, gap]))
        code, report = run('split', source, '--out', self.base / 'split')
        self.assertEqual(len(report['takes']), 2)
        first, _, _ = tool.read_wav(report['takes'][0]['file'])
        original, _, _ = tool.read_wav(source)
        start = int(round(report['takes'][0]['start_s'] * 48000))
        np.testing.assert_array_equal(first, original[start:start + len(first)])

    def test_process_trims_fades_and_respects_ceiling(self):
        x = np.vstack([np.zeros((9600, 1)), sine(300, 0.5, 48000, 0.2), np.zeros((9600, 1))])
        source = self.wav('quiet.wav', x)
        code, report = run('process', source, '--out', self.base / 'out', '--trim', '--normalize', 'momentary',
                           '--target', '0', '--ceiling', '-1')
        entry = report['files'][0]
        self.assertFalse(entry['normalize']['target_reached'])
        self.assertLessEqual(entry['true_peak_dbtp'], -0.95)
        self.assertLess(entry['duration_s'], 0.52)
        self.assertLessEqual(entry['leading_silence_ms'], tool.PREROLL_MS + 0.5)
        y, _, _ = tool.read_wav(entry['output'])
        self.assertLess(abs(y[0, 0]), 1e-3)
        self.assertLess(abs(y[-1, 0]), 1e-3)

    def test_process_reaches_integrated_target_when_headroom_allows(self):
        source = self.wav('tone.wav', sine(1000, 2, 48000, 0.05))
        code, report = run('process', source, '--out', self.base / 'out', '--normalize', 'integrated',
                           '--target', '-20', '--fade-in-ms', '0', '--fade-out-ms', '0')
        entry = report['files'][0]
        self.assertTrue(entry['normalize']['target_reached'])
        self.assertAlmostEqual(entry['integrated_lufs'], -20.0, delta=0.15)

    def test_process_resamples_and_refuses_to_overwrite_input(self):
        source = self.wav('tone.wav', sine(1000, 0.5, 44100, 0.3), rate=44100)
        code, report = run('process', source, '--out', self.base / 'out', '--rate', 48000)
        self.assertEqual(report['files'][0]['rate'], 48000)
        with self.assertRaises(SystemExit):
            run('process', source, '--out', self.base)

    def test_loop_reduces_seam_discontinuity(self):
        rate = 48000
        rng = np.random.default_rng(3)
        noise = np.convolve(rng.normal(0, 0.2, rate * 2), np.ones(8) / 8, mode='same')
        ramp = np.linspace(0.2, 1.0, len(noise))
        source = self.wav('rain.wav', (noise * ramp)[:, None])
        code, report = run('loop', source, '--out', self.base / 'rain_loop.wav', '--crossfade-ms', 200)
        self.assertAlmostEqual(report['loop_length_s'], 1.8, delta=0.01)
        self.assertLess(report['seam_after']['sample_jump'], report['seam_before']['sample_jump'] + 1e-9)
        self.assertLess(report['seam_after']['spectral_difference_db'], report['seam_before']['spectral_difference_db'])

    def test_sheet_has_one_row_per_file(self):
        a = self.wav('a.wav', sine(500, 0.4, 48000, 0.5))
        b = self.wav('b.wav', sine(5000, 1.2, 44100, 0.2, channels=2), rate=44100)
        code, report = run('sheet', a, b, '--out', self.base / 'sheet.png', '--width', 600, '--row-height', 120,
                           '--labels')
        self.assertEqual(report['size'], [600, 240])
        self.assertTrue((self.base / 'sheet.png').is_file())


if __name__ == '__main__':
    unittest.main()
