import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location('tighten', Path(__file__).with_name('tighten.py'))
tighten = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tighten)

RATE = 48000


def burst(seconds, freq=300.0, amp=0.5):
    t = np.arange(int(seconds * RATE)) / RATE
    return (amp * np.sin(2 * np.pi * freq * t) * np.hanning(len(t)) ** 0.2)[:, None]


def gap(seconds, noise=0.0):
    n = int(seconds * RATE)
    return (np.random.default_rng(1).normal(0, noise, n) if noise else np.zeros(n))[:, None]


class TightenTests(unittest.TestCase):
    def test_long_pause_is_cut_to_the_kept_gap(self):
        x = np.vstack([gap(0.1), burst(0.2), gap(0.5), burst(0.2), gap(0.1)])
        y, removed = tighten.tighten(x, RATE)
        self.assertEqual(len(removed), 1)
        self.assertAlmostEqual(removed[0], 0.5 - 0.08, delta=0.011)
        self.assertEqual(len(y), len(x) - int(round(removed[0] * RATE)))
        # The leading and trailing silence are left for the trim.
        np.testing.assert_array_equal(y[:int(0.1 * RATE)], x[:int(0.1 * RATE)])
        np.testing.assert_array_equal(y[-int(0.1 * RATE):], x[-int(0.1 * RATE):])

    def test_short_pauses_and_quiet_breath_noise_below_threshold_are_kept(self):
        x = np.vstack([burst(0.2), gap(0.1, noise=1e-4), burst(0.2)])
        y, removed = tighten.tighten(x, RATE)
        self.assertEqual(removed, [])
        np.testing.assert_array_equal(y, x)

    def test_join_has_no_click(self):
        x = np.vstack([burst(0.2), gap(0.6, noise=1e-3), burst(0.2)])
        y, removed = tighten.tighten(x, RATE)
        self.assertEqual(len(removed), 1)
        steps = np.abs(np.diff(y[:, 0]))
        self.assertLess(steps.max(), np.abs(np.diff(x[:, 0])).max() + 1e-9)

    def test_cli_writes_same_format_and_refuses_to_overwrite(self):
        with tempfile.TemporaryDirectory(prefix='tighten-test-') as temp:
            base = Path(temp)
            source = base / 'line_01.wav'
            stereo = np.repeat(np.vstack([burst(0.2), gap(0.4), burst(0.2)]), 2, axis=1)
            tighten.write_wav(source, stereo, RATE, 3)
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                tighten.main([str(source), '--out', str(base / 'tight')])
            report = json.loads(buffer.getvalue())['files'][0]
            self.assertLess(report['after_s'], report['before_s'] - 0.3)
            y, rate, width = tighten.read_wav(base / 'tight/line_01.wav')
            self.assertEqual((rate, width, y.shape[1]), (RATE, 3, 2))
            with self.assertRaises(SystemExit):
                tighten.main([str(source), '--out', str(base)])


if __name__ == '__main__':
    unittest.main()
