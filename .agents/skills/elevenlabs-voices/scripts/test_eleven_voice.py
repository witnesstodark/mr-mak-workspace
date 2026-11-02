"""Tests for eleven_voice.py against a local fake server: no network, no key."""
import base64
import contextlib
import importlib.util
import io
import json
import math
import os
import struct
import tempfile
import threading
import unittest
import urllib.parse
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('eleven_voice', Path(__file__).with_name('eleven_voice.py'))
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)

FAKE_KEY = 'test-key-0123456789-not-a-real-key'
PREVIEW = ('A plain preview line for judging the voice itself, long enough for the design endpoint, '
           'which wants at least a hundred characters.')


def pcm(seconds, rate, freq=220.0):
    n = int(seconds * rate)
    return b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n))


class FakeElevenLabs:
    """Just enough of the API for the client: state, a request log and failure switches."""

    def __init__(self):
        self.calls = []
        self.used, self.limit = 1000, 100000
        self.slots_used, self.slot_limit = 3, 30
        self.rejected_formats = {'pcm_48000'}
        self.drop_next_post = False
        self.voices = {'premade1': {'voice_id': 'premade1', 'name': 'Narrator', 'category': 'premade'}}
        self.counter = 0
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, payload, content_type='application/json', headers=None):
                body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

            def handle_any(self, method):
                parts = urllib.parse.urlsplit(self.path)
                query = dict(urllib.parse.parse_qsl(parts.query))
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                server.calls.append({'method': method, 'path': parts.path, 'query': query, 'body': body,
                                     'key': self.headers.get('xi-api-key')})
                if self.headers.get('xi-api-key') != FAKE_KEY:
                    return self.reply(401, {'detail': {'status': 'invalid_api_key', 'message': 'bad key'}})
                if method == 'POST' and server.drop_next_post:
                    server.drop_next_post = False
                    self.close_connection = True
                    self.connection.shutdown(2)
                    return None
                return server.route(self, method, parts.path, query, body)

            def do_GET(self):
                self.handle_any('GET')

            def do_POST(self):
                self.handle_any('POST')

            def do_DELETE(self):
                self.handle_any('DELETE')

        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = 'http://127.0.0.1:%d' % self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def posts(self, path_start=''):
        return [c for c in self.calls if c['method'] == 'POST' and c['path'].startswith(path_start)]

    def format_ok(self, handler, query):
        fmt = query.get('output_format', 'mp3_44100_128')
        if fmt in self.rejected_formats:
            handler.reply(403, {'detail': {'status': 'output_format_not_allowed',
                                           'message': 'Your subscription does not include this output format.'}})
            return None
        return int(fmt.split('_')[1])

    def route(self, h, method, path, query, body):
        if method == 'GET' and path == '/v1/user/subscription':
            return h.reply(200, {'tier': 'creator', 'status': 'active', 'character_count': self.used,
                                 'character_limit': self.limit, 'voice_slots_used': self.slots_used,
                                 'voice_limit': self.slot_limit, 'next_character_count_reset_unix': 1800000000})
        if method == 'GET' and path == '/v1/models':
            return h.reply(200, [
                {'model_id': 'eleven_v4', 'name': 'Eleven v4', 'can_do_text_to_speech': True,
                 'maximum_text_length_per_request': 10000, 'model_rates': {'character_cost_multiplier': 1.0}},
                {'model_id': 'eleven_ttv_v3', 'name': 'Voice design v3', 'can_do_text_to_speech': False}])
        if method == 'GET' and path == '/v2/voices':
            voices = list(self.voices.values())
            if query.get('voice_type') == 'personal':
                voices = [v for v in voices if v['category'] == 'generated']
            return h.reply(200, {'voices': voices, 'has_more': False, 'total_count': len(voices),
                                 'next_page_token': None})
        if method == 'GET' and path == '/v1/history':
            return h.reply(200, {'history': [], 'has_more': False})
        if method == 'POST' and path == '/v1/text-to-voice/design':
            rate = self.format_ok(h, query)
            if rate is None:
                return None
            self.used += len(body.get('text') or 'x' * 200)
            previews = [{'audio_base_64': base64.b64encode(pcm(0.2, rate, 200 + 40 * i)).decode(),
                         'generated_voice_id': 'gen_%s_%d' % (body['seed'], i), 'media_type': 'audio/pcm',
                         'duration_secs': 0.2, 'language': 'en'} for i in range(3)]
            return h.reply(200, {'previews': previews, 'text': body.get('text')})
        if method == 'POST' and path == '/v1/text-to-voice':
            self.counter += 1
            self.slots_used += 1
            voice_id = 'voice_%d' % self.counter
            self.voices[voice_id] = {'voice_id': voice_id, 'name': body['voice_name'], 'category': 'generated'}
            return h.reply(200, {'voice_id': voice_id})
        if method == 'POST' and path.startswith('/v1/text-to-speech/'):
            rate = self.format_ok(h, query)
            if rate is None:
                return None
            if path.rsplit('/', 1)[1] not in self.voices:
                return h.reply(404, {'detail': {'status': 'voice_not_found', 'message': 'voice not found'}})
            self.used += len(body['text'])
            return h.reply(200, pcm(0.3, rate), 'audio/pcm',
                           {'character-cost': str(len(body['text'])), 'request-id': 'req_%d' % len(self.calls)})
        if method == 'DELETE' and path.startswith('/v1/voices/'):
            voice_id = path.rsplit('/', 1)[1]
            if self.voices.pop(voice_id, None) is None:
                return h.reply(404, {'detail': {'status': 'voice_not_found', 'message': 'no such voice'}})
            self.slots_used -= 1
            return h.reply(200, {'status': 'ok'})
        return h.reply(404, {'detail': 'unknown route %s %s' % (method, path)})


class ElevenVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='eleven-voice-test-')
        self.dir = Path(self.temp.name) / 'voices'
        self.server = FakeElevenLabs()
        self.env = patch.dict(os.environ, {'ELEVENLABS_API_KEY': FAKE_KEY, 'ELEVENLABS_BASE_URL': self.server.url})
        self.env.start()
        self.sleep = patch.object(ev, 'SLEEP', lambda seconds: None)
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()
        self.env.stop()
        self.server.stop()
        self.temp.cleanup()

    def run_cli(self, *argv):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = ev.main([str(a) for a in argv])
        self.output = buffer.getvalue()
        self.assertNotIn(FAKE_KEY, self.output)
        return code, json.loads(self.output)

    def manifest(self):
        text = (self.dir / 'manifest.json').read_text(encoding='utf-8')
        self.assertNotIn(FAKE_KEY, text)
        return json.loads(text)

    def design(self, name='town_guard', **extra):
        args = ['design', name, '--dir', self.dir, '--description',
                'English, Northern accent. Male, 40s. Studio-quality recording. A tired town guard. Gruff.',
                '--text', PREVIEW, '--seed', 1101]
        for k, v in extra.items():
            args += ['--' + k.replace('_', '-'), v]
        return self.run_cli(*args)

    # -- read-only

    def test_check_reports_credits_slots_and_models(self):
        code, report = self.run_cli('check', '--dir', self.dir)
        self.assertEqual(report['credits']['remaining'], 99000)
        self.assertEqual(report['voice_slots'], {'used': 3, 'limit': 30, 'free': 27})
        self.assertEqual([m['model_id'] for m in report['models']], ['eleven_v4', 'eleven_ttv_v3'])
        self.assertEqual(len(self.manifest()['checks']), 1)
        self.assertTrue(all(c['method'] == 'GET' for c in self.server.calls))
        self.assertTrue(all(c['key'] == FAKE_KEY for c in self.server.calls))

    def test_missing_key_and_foreign_host_send_nothing(self):
        with patch.dict(os.environ, {'ELEVENLABS_API_KEY': ''}):
            with self.assertRaises(SystemExit):
                self.run_cli('check')
        with patch.dict(os.environ, {'ELEVENLABS_BASE_URL': 'https://collector.example.com'}):
            with self.assertRaises(SystemExit):
                self.run_cli('check')
        self.assertEqual(self.server.calls, [])

    # -- design and save

    def test_design_falls_back_to_an_allowed_format_and_records_everything(self):
        code, report = self.design()
        self.assertEqual(report['format'], 'pcm_32000')
        self.assertEqual(len(report['previews']), 3)
        with wave.open(str(self.dir / report['previews'][1]['file']), 'rb') as w:
            self.assertEqual((w.getframerate(), w.getnchannels(), w.getsampwidth()), (32000, 1, 2))
        entry = self.manifest()['designs']['town_guard']
        self.assertEqual(entry['status'], 'done')
        self.assertEqual(entry['request']['seed'], 1101)
        self.assertEqual(entry['cost'], {'credits': len(PREVIEW), 'source': 'subscription count before and after'})
        self.assertEqual([p['candidate'] for p in entry['previews']], ['a', 'b', 'c'])

    def test_design_rerun_sends_nothing_and_a_changed_request_is_refused(self):
        self.design()
        posts = len(self.server.posts())
        code, report = self.design()
        self.assertEqual(report['skipped'], 'already recorded')
        self.assertEqual(len(self.server.posts()), posts)
        with self.assertRaises(SystemExit):
            self.design(guidance_scale=3)
        self.assertEqual(len(self.server.posts()), posts)

    def test_design_checks_preview_length_before_any_request(self):
        with self.assertRaises(SystemExit) as raised:
            self.run_cli('design', 'x', '--dir', self.dir, '--description', 'a voice', '--text', 'Too short.')
        self.assertIn('100 to 1000', str(raised.exception))
        self.assertEqual(self.server.calls, [])

    def test_save_records_voice_and_refuses_without_free_slots(self):
        self.design()
        code, report = self.run_cli('save', 'town_guard', '--candidate', 'b', '--dir', self.dir, '--trial')
        self.assertTrue(report['voice_id'].startswith('voice_'))
        body = self.server.posts('/v1/text-to-voice')[-1]['body']
        self.assertEqual(body['generated_voice_id'], 'gen_1101_1')
        self.server.slots_used = self.server.slot_limit
        with self.assertRaises(SystemExit) as raised:
            self.run_cli('save', 'town_guard', '--candidate', 'c', '--dir', self.dir)
        self.assertIn('voice slots', str(raised.exception))

    # -- speak

    def test_speak_takes_have_their_own_seeds_and_reruns_only_add_missing_takes(self):
        code, report = self.run_cli('speak', 'narrator_hello', '--dir', self.dir, '--voice-id', 'premade1',
                                    '--text', '[curious] Hm?', '--takes', 2, '--seed', 40)
        self.assertEqual([t['seed'] for t in report['written']], [40, 41])
        self.assertEqual(report['credits'], 2 * len('[curious] Hm?'))
        take = self.manifest()['lines']['narrator_hello']['takes'][0]
        self.assertEqual((take['format'], take['request_id'] is not None), ('pcm_32000', True))
        with wave.open(str(self.dir / take['file']), 'rb') as w:
            self.assertAlmostEqual(w.getnframes() / w.getframerate(), 0.3, places=2)
        before = len(self.server.posts('/v1/text-to-speech'))
        code, report = self.run_cli('speak', 'narrator_hello', '--dir', self.dir, '--voice-id', 'premade1',
                                    '--text', '[curious] Hm?', '--takes', 3, '--seed', 40)
        sent = self.server.posts('/v1/text-to-speech')[before:]
        self.assertEqual([c['body']['seed'] for c in sent if c['query']['output_format'] == 'pcm_32000'], [42])
        with self.assertRaises(SystemExit):
            self.run_cli('speak', 'narrator_hello', '--dir', self.dir, '--voice-id', 'premade1',
                         '--text', '[curious] Hm? Who goes there?', '--takes', 3, '--seed', 40)

    def test_speak_respects_the_credit_budget(self):
        with self.assertRaises(SystemExit) as raised:
            self.run_cli('speak', 'long', '--dir', self.dir, '--voice-id', 'premade1', '--text', 'x' * 50,
                         '--takes', 3, '--max-credits', 100)
        self.assertIn('--max-credits', str(raised.exception))
        self.assertEqual(self.server.posts(), [])

    def test_unknown_outcome_blocks_a_resend_until_retry_unknown(self):
        self.server.rejected_formats = set()
        self.server.drop_next_post = True
        args = ['speak', 'hey', '--dir', self.dir, '--voice-id', 'premade1', '--text', 'Hey!', '--takes', 1]
        with self.assertRaises(SystemExit) as raised:
            self.run_cli(*args)
        self.assertIn('unknown', str(raised.exception))
        self.assertEqual(self.manifest()['lines']['hey']['takes'][0]['status'], 'unknown')
        with self.assertRaises(SystemExit):
            self.run_cli(*args)
        self.assertEqual(len(self.server.posts()), 1)
        code, report = self.run_cli(*args, '--retry-unknown')
        self.assertEqual(len(report['written']), 1)
        self.assertEqual(self.manifest()['lines']['hey']['takes'][0]['status'], 'done')

    def test_dry_run_sends_nothing(self):
        code, report = self.run_cli('speak', 'hey', '--dir', self.dir, '--voice-id', 'premade1', '--text', 'Hey!',
                                    '--dry-run')
        self.assertTrue(report['dry_run'])
        self.assertEqual(self.server.calls, [])
        self.assertFalse((self.dir / 'manifest.json').exists())

    # -- cleanup and review

    def test_delete_trials_only_and_unrecorded_ids_need_a_flag(self):
        self.design()
        self.run_cli('save', 'town_guard', '--candidate', 'a', '--dir', self.dir, '--trial')
        self.run_cli('save', 'town_guard', '--candidate', 'b', '--dir', self.dir)
        code, report = self.run_cli('delete', '--trials', '--dir', self.dir)
        self.assertEqual([r['name'] for r in report['results']], ['town_guard_a'])
        voices = self.manifest()['voices']
        self.assertIn('deleted_at', voices['town_guard_a'])
        self.assertNotIn('deleted_at', voices['town_guard_b'])
        with self.assertRaises(SystemExit):
            self.run_cli('delete', 'premade1', '--dir', self.dir)
        self.assertNotIn('/v1/voices/premade1', [c['path'] for c in self.server.calls])
        with self.assertRaises(SystemExit):
            self.run_cli('speak', 'gone', '--dir', self.dir, '--voice', 'town_guard_a', '--text', 'Hey!')

    def test_page_and_verdicts(self):
        self.design()
        self.run_cli('speak', 'hey', '--dir', self.dir, '--voice-id', 'premade1', '--text', 'Hey!', '--takes', 2)
        self.run_cli('mark', 'town_guard', '--dir', self.dir, '--candidate', 'b', '--verdict', 'chosen')
        self.run_cli('mark', 'hey', '--dir', self.dir, '--take', 2, '--verdict', 'accepted', '--note', 'clear')
        code, report = self.run_cli('page', '--dir', self.dir)
        page = Path(report['output']).read_text(encoding='utf-8')
        self.assertEqual(page.count('<audio'), 5)
        self.assertIn('src="previews/town_guard_b.wav"', page)
        self.assertIn('src="takes/hey_02.wav"', page)
        self.assertIn('accepted: clear', page)


class ToolTests(unittest.TestCase):
    def test_error_messages_are_short_and_carry_no_headers(self):
        body = json.dumps({'detail': [{'loc': ['body', 'text'], 'msg': 'too short', 'type': 'value_error'}]}).encode()
        self.assertEqual(ev.error_message(body), 'body.text: too short')

    def test_default_seed_is_stable(self):
        self.assertEqual(ev.default_seed('town_guard_alert'), ev.default_seed('town_guard_alert'))
        self.assertNotEqual(ev.default_seed('a'), ev.default_seed('b'))


if __name__ == '__main__':
    unittest.main()
