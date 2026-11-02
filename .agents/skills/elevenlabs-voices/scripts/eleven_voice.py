#!/usr/bin/env python3
"""Design, save and speak ElevenLabs voices, recording every paid step.

Subcommands
  check    plan, credits, voice slots and models (read-only)
  list     voices in the account (read-only)
  history  recent text-to-speech generations (read-only)
  design   candidate voices from a description: one preview WAV per candidate
  save     save one candidate as a voice in the account (uses a voice slot)
  speak    speak a line in takes, one request and one WAV per take
  delete   delete saved voices (manifest names, recorded IDs or --trials)
  mark     record the owner's verdict on a candidate or a take
  page     a listening page with native audio players, from the manifest

Standard library only. The key comes from ELEVENLABS_API_KEY and is never
printed or written. Paid steps are written to <dir>/manifest.json before the
request is sent and again after it returns. A finished step is skipped on
later runs, so running a command twice costs nothing extra. A step whose outcome is
unknown (a timeout, a dropped connection) blocks itself: look for it with
`history`, then rerun with --retry-unknown only if it was not generated.
Every command prints one JSON report.
"""
import argparse
import base64
import html
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
import zlib
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_BASE = 'https://api.elevenlabs.io'
DESIGN_MODEL = 'eleven_ttv_v3'
SPEECH_MODEL = 'eleven_v4'
FORMATS = ['pcm_48000', 'pcm_32000']  # preference order; a plan that refuses one gets the next
LETTERS = 'abcdefghij'
RETRY_STATUS = {409, 429, 500, 502, 503, 504}
RETRIES = 3
SLEEP = time.sleep  # replaced in tests
TIMEOUT = 180


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__('HTTP %s: %s' % (status, message))
        self.status = status
        self.message = message


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def emit(report, code=0):
    print(json.dumps(report, indent=1))
    return code


# ---------------------------------------------------------------- HTTP

def api_key():
    key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
    if not key:
        raise SystemExit('ELEVENLABS_API_KEY is not set. Set it in the environment of the shell '
                         'that runs this script; never put it in a file in the project.')
    return key


def base_url():
    """The API host: ElevenLabs' own (any *.elevenlabs.io, for the regional
    servers) or a local test server. Anything else would receive the key."""
    base = os.environ.get('ELEVENLABS_BASE_URL', '').strip().rstrip('/') or DEFAULT_BASE
    parts = urllib.parse.urlsplit(base)
    host = (parts.hostname or '').lower()
    local = host in ('127.0.0.1', 'localhost', '::1')
    if not ((parts.scheme == 'https' and (host == 'elevenlabs.io' or host.endswith('.elevenlabs.io')))
            or (local and parts.scheme in ('http', 'https'))):
        raise SystemExit('ELEVENLABS_BASE_URL must be an https://*.elevenlabs.io host (or a local test server)')
    return base


def error_message(body):
    """A short reason from an error body, without echoing request headers."""
    try:
        data = json.loads(body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return body[:200].decode('utf-8', 'replace')
    detail = data.get('detail', data) if isinstance(data, dict) else data
    if isinstance(detail, dict):
        return str(detail.get('message') or detail.get('status') or detail)[:300]
    if isinstance(detail, list):
        return '; '.join('%s: %s' % ('.'.join(str(p) for p in d.get('loc', [])), d.get('msg', ''))
                         for d in detail if isinstance(d, dict))[:300]
    return str(detail)[:300]


def http(method, path, body=None, query=None):
    """One request with retries on busy or failing servers. Returns (bytes,
    lower-cased headers); raises ApiError for an error response. Network
    errors propagate: the caller decides whether the outcome is unknown."""
    url = base_url() + path
    if query:
        url += '?' + urllib.parse.urlencode(query, doseq=True)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = {'xi-api-key': api_key(), 'Accept': '*/*'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    for attempt in range(RETRIES + 1):
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                return response.read(), {k.lower(): v for k, v in response.headers.items()}
        except urllib.error.HTTPError as error:
            payload = error.read()
            if error.code in RETRY_STATUS and attempt < RETRIES:
                SLEEP(2.0 * 2 ** attempt)
                continue
            raise ApiError(error.code, error_message(payload)) from None


def get_json(path, query=None):
    blob, _ = http('GET', path, query=query)
    return json.loads(blob.decode('utf-8'))


# ---------------------------------------------------------------- manifest

def manifest_path(folder):
    return Path(folder) / 'manifest.json'


def load(folder):
    path = manifest_path(folder)
    if path.is_file():
        return json.loads(path.read_text(encoding='utf-8'))
    return {'version': 1, 'created': now(), 'designs': {}, 'voices': {}, 'lines': {}, 'checks': []}


def store(folder, manifest):
    path = manifest_path(folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def default_seed(name):
    """Stable per name, so a rerun and a new take ask for the same voice."""
    return zlib.crc32(name.encode('utf-8')) % 1000000


def blocked(entry, retry_unknown):
    """Refuse to resend a step that may already have been paid for."""
    if entry.get('status') in ('pending', 'unknown') and not retry_unknown:
        raise SystemExit('%s was sent at %s and its outcome is unknown. Check `history` (speech) or the '
                         'account (designs); rerun with --retry-unknown only if nothing was generated.'
                         % (entry.get('label', 'this step'), entry.get('sent_at')))


# ---------------------------------------------------------------- account

def subscription():
    s = get_json('/v1/user/subscription')
    used, limit = s.get('character_count', 0), s.get('character_limit', 0)
    reset = s.get('next_character_count_reset_unix')
    return {'tier': s.get('tier'), 'status': s.get('status'),
            'credits': {'used': used, 'limit': limit, 'remaining': max(0, limit - used),
                        'resets_at': datetime.fromtimestamp(reset, timezone.utc).isoformat() if reset else None},
            'voice_slots': {'used': s.get('voice_slots_used'), 'limit': s.get('voice_limit'),
                            'free': (s.get('voice_limit') or 0) - (s.get('voice_slots_used') or 0)}}


def models():
    result = []
    for m in get_json('/v1/models'):
        rates = m.get('model_rates') or {}
        result.append({'model_id': m.get('model_id'), 'name': m.get('name'),
                       'tts': bool(m.get('can_do_text_to_speech')),
                       'max_chars': m.get('maximum_text_length_per_request'),
                       'cost_multiplier': rates.get('character_cost_multiplier', m.get('token_cost_factor'))})
    return result


def budget(estimate, account, max_credits):
    if max_credits is not None and estimate > max_credits:
        raise SystemExit('estimated %d credits is more than --max-credits %d' % (estimate, max_credits))
    if estimate > account['credits']['remaining']:
        raise SystemExit('estimated %d credits but only %d remain this period'
                         % (estimate, account['credits']['remaining']))


def cost_of(headers, before):
    """Credits a request used: its character-cost header, or else the change in
    the subscription's count (which other use of the account can disturb)."""
    if headers.get('character-cost') not in (None, ''):
        return {'credits': int(float(headers['character-cost'])), 'source': 'character-cost header'}, before
    after = subscription()['credits']['used']
    return {'credits': after - before, 'source': 'subscription count before and after'}, after


# ---------------------------------------------------------------- audio files

def is_pcm(blob, media_type=''):
    if 'mpeg' in media_type or 'mp3' in media_type:
        return False
    if blob[:3] == b'ID3' or blob[:2] in (b'\xff\xfb', b'\xff\xf3', b'\xff\xf2'):
        return False
    return blob[:4] != b'RIFF' and 'ogg' not in media_type and 'opus' not in media_type


def save_audio(path_without_suffix, blob, fmt, media_type=''):
    """Raw 16-bit mono PCM is wrapped as WAV; WAV and compressed formats are
    kept as they came. Returns (path, seconds or None, pcm?)."""
    rate = int(fmt.split('_')[1]) if fmt.startswith(('pcm_', 'wav_')) else None
    path_without_suffix.parent.mkdir(parents=True, exist_ok=True)
    if blob[:4] == b'RIFF':
        path = path_without_suffix.with_suffix('.wav')
        path.write_bytes(blob)
        with wave.open(str(path), 'rb') as w:
            return path, round(w.getnframes() / w.getframerate(), 3), True
    if rate and is_pcm(blob, media_type):
        path = path_without_suffix.with_suffix('.wav')
        with wave.open(str(path), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(blob[:len(blob) - len(blob) % 2])
        return path, round(len(blob) / 2 / rate, 3), True
    suffix = '.mp3' if 'mp3' in fmt or 'mpeg' in media_type or not is_pcm(blob, media_type) else '.bin'
    path = path_without_suffix.with_suffix(suffix)
    path.write_bytes(blob)
    return path, None, False


def with_format(method, path, body, formats):
    """Send with each output format in turn until the plan accepts one."""
    last = None
    for fmt in formats:
        try:
            blob, headers = http(method, path, body=body, query={'output_format': fmt})
            return blob, headers, fmt
        except ApiError as error:
            text = error.message.lower()
            if error.status == 403 or (error.status in (400, 422) and any(
                    w in text for w in ('format', 'tier', 'plan', 'subscription'))):
                last = error
                continue
            raise
    raise last


def relative(path, folder):
    return Path(os.path.relpath(path, folder)).as_posix()


# ---------------------------------------------------------------- read-only commands

def command_check(args):
    account = subscription()
    report = {'command': 'check', 'checked_at': now()}
    report.update(account)
    report['models'] = [m for m in models() if m['tts'] or 'ttv' in (m['model_id'] or '')]
    own = get_json('/v2/voices', {'voice_type': 'personal', 'page_size': 1, 'include_total_count': 'true'})
    report['own_voices'] = own.get('total_count')
    if args.dir:
        manifest = load(args.dir)
        manifest['checks'] = (manifest.get('checks', []) + [{
            'at': report['checked_at'], 'tier': account['tier'], 'credits': account['credits'],
            'voice_slots': account['voice_slots']}])[-20:]
        store(args.dir, manifest)
    return emit(report)


def command_list(args):
    recorded = {}
    if args.dir and manifest_path(args.dir).is_file():
        recorded = {v['voice_id']: k for k, v in load(args.dir)['voices'].items() if v.get('voice_id')}
    voices, token = [], None
    while len(voices) < args.limit:
        query = {'page_size': min(100, args.limit - len(voices))}
        if args.type:
            query['voice_type'] = args.type
        if args.search:
            query['search'] = args.search
        if token:
            query['next_page_token'] = token
        page = get_json('/v2/voices', query)
        for v in page.get('voices', []):
            voices.append({'voice_id': v.get('voice_id'), 'name': v.get('name'), 'category': v.get('category'),
                           'created_unix': v.get('created_at_unix'), 'in_manifest': recorded.get(v.get('voice_id'))})
        token = page.get('next_page_token')
        if not page.get('has_more') or not token:
            break
    return emit({'command': 'list', 'count': len(voices), 'voices': voices})


def command_history(args):
    query = {'page_size': args.limit, 'source': 'TTS'}
    if args.voice:
        query['voice_id'] = resolve_voice(args.dir, args.voice) if args.dir else args.voice
    if args.since:
        since = args.since
        query['date_after_unix'] = int(since) if since.isdigit() else int(datetime.fromisoformat(since).timestamp())
    page = get_json('/v1/history', query)
    items = [{'history_item_id': h.get('history_item_id'), 'request_id': h.get('request_id'),
              'voice_id': h.get('voice_id'), 'model_id': h.get('model_id'), 'text': h.get('text'),
              'date': datetime.fromtimestamp(h['date_unix'], timezone.utc).isoformat() if h.get('date_unix') else None,
              'credits': (h.get('character_count_change_to') or 0) - (h.get('character_count_change_from') or 0),
              'state': h.get('state')} for h in page.get('history', [])]
    return emit({'command': 'history', 'items': items, 'has_more': page.get('has_more')})


# ---------------------------------------------------------------- paid commands

def command_design(args):
    folder = Path(args.dir)
    text = None if args.auto_text else (args.text or '').strip()
    if not args.description.strip():
        raise SystemExit('--description is empty')
    if not args.auto_text and not 100 <= len(text) <= 1000:
        raise SystemExit('the preview --text must be 100 to 1000 characters (it is %d); or use --auto-text'
                         % len(text or ''))
    body = {'voice_description': args.description.strip(), 'model_id': args.model,
            'seed': args.seed if args.seed is not None else default_seed(args.name)}
    if text:
        body['text'] = text
    else:
        body['auto_generate_text'] = True
    for field, value in (('guidance_scale', args.guidance_scale), ('loudness', args.loudness),
                         ('quality', args.quality)):
        if value is not None:
            body[field] = value
    estimate = len(text) if text else 300
    if args.dry_run:
        return emit({'command': 'design', 'dry_run': True, 'name': args.name, 'request': body,
                     'formats': args.formats, 'estimated_credits': estimate})
    manifest = load(folder)
    entry = manifest['designs'].get(args.name)
    if entry:
        if entry['request'] != body:
            raise SystemExit('design %s is recorded with a different request; use a new name such as %s_r2'
                             % (args.name, args.name))
        if entry.get('status') == 'done':
            return emit({'command': 'design', 'name': args.name, 'skipped': 'already recorded',
                         'previews': entry['previews']})
        blocked(entry, args.retry_unknown)
    account = subscription()
    budget(estimate, account, args.max_credits)
    entry = {'label': 'design %s' % args.name, 'status': 'pending', 'sent_at': now(), 'request': body,
             'formats_tried': args.formats}
    manifest['designs'][args.name] = entry
    store(folder, manifest)
    try:
        blob, headers, fmt = with_format('POST', '/v1/text-to-voice/design', body, args.formats)
    except ApiError as error:
        entry.update(status='failed', error=str(error))
        store(folder, manifest)
        raise SystemExit('design failed: %s' % error)
    except Exception as error:
        entry.update(status='unknown', error=type(error).__name__)
        store(folder, manifest)
        raise SystemExit('design %s: the outcome is unknown (%s); it may have been charged'
                         % (args.name, type(error).__name__))
    result = json.loads(blob.decode('utf-8'))
    previews = []
    for i, p in enumerate(result.get('previews', [])):
        audio = base64.b64decode(p['audio_base_64'])
        path, seconds, pcm = save_audio(folder / 'previews' / ('%s_%s' % (args.name, LETTERS[i])), audio, fmt,
                                        p.get('media_type', ''))
        previews.append({'candidate': LETTERS[i], 'file': relative(path, folder),
                         'generated_voice_id': p.get('generated_voice_id'),
                         'duration_s': p.get('duration_secs', seconds), 'language': p.get('language'), 'pcm': pcm})
    cost, _ = cost_of(headers, account['credits']['used'])
    entry.update(status='done', returned_at=now(), format=fmt, text=result.get('text'),
                 request_id=headers.get('request-id'), cost=cost, previews=previews)
    store(folder, manifest)
    return emit({'command': 'design', 'name': args.name, 'format': fmt, 'cost': cost, 'previews': previews})


def command_save(args):
    folder = Path(args.dir)
    manifest = load(folder)
    design = manifest['designs'].get(args.design)
    if not design or design.get('status') != 'done':
        raise SystemExit('no finished design called %s in the manifest' % args.design)
    preview = next((p for p in design['previews'] if p['candidate'] == args.candidate), None)
    if not preview:
        raise SystemExit('design %s has no candidate %s' % (args.design, args.candidate))
    key = args.name or '%s_%s' % (args.design, args.candidate)
    entry = manifest['voices'].get(key)
    if entry and entry.get('generated_voice_id') != preview['generated_voice_id']:
        raise SystemExit('voice %s is recorded from another candidate; choose another --name' % key)
    if entry and entry.get('status') == 'done':
        return emit({'command': 'save', 'name': key, 'skipped': 'already saved', 'voice_id': entry['voice_id']})
    if entry:
        blocked(entry, args.retry_unknown)
    body = {'voice_name': args.voice_name or key, 'voice_description': design['request']['voice_description'],
            'generated_voice_id': preview['generated_voice_id']}
    if args.dry_run:
        return emit({'command': 'save', 'dry_run': True, 'name': key, 'request': body})
    account = subscription()
    if account['voice_slots']['limit'] is not None and account['voice_slots']['free'] <= 0:
        raise SystemExit('no free voice slots (%s of %s used); delete unused voices first'
                         % (account['voice_slots']['used'], account['voice_slots']['limit']))
    entry = {'label': 'save %s' % key, 'status': 'pending', 'sent_at': now(), 'design': args.design,
             'candidate': args.candidate, 'generated_voice_id': preview['generated_voice_id'],
             'voice_name': body['voice_name'], 'trial': args.trial}
    manifest['voices'][key] = entry
    store(folder, manifest)
    try:
        blob, headers = http('POST', '/v1/text-to-voice', body=body)
    except ApiError as error:
        entry.update(status='failed', error=str(error))
        store(folder, manifest)
        raise SystemExit('save failed: %s' % error)
    except Exception as error:
        entry.update(status='unknown', error=type(error).__name__)
        store(folder, manifest)
        raise SystemExit('save %s: the outcome is unknown (%s); check `list` before retrying'
                         % (key, type(error).__name__))
    entry.update(status='done', saved_at=now(), voice_id=json.loads(blob.decode('utf-8'))['voice_id'])
    store(folder, manifest)
    return emit({'command': 'save', 'name': key, 'voice_id': entry['voice_id'], 'trial': args.trial,
                 'voice_slots_before': account['voice_slots']})


def resolve_voice(folder, name):
    if folder and manifest_path(folder).is_file():
        voice = load(folder)['voices'].get(name)
        if voice:
            if voice.get('status') != 'done' or voice.get('deleted_at'):
                raise SystemExit('voice %s is not available (status %s%s)'
                                 % (name, voice.get('status'), ', deleted' if voice.get('deleted_at') else ''))
            return voice['voice_id']
    return name


def speech_settings(args):
    settings = {}
    for field, value in (('stability', args.stability), ('similarity_boost', args.similarity_boost),
                         ('style', args.style), ('speed', args.speed)):
        if value is not None:
            settings[field] = value
    return settings or None


def command_speak(args):
    folder = Path(args.dir)
    text = args.text.strip()
    if not text:
        raise SystemExit('--text is empty')
    voice_id = args.voice_id or resolve_voice(folder, args.voice)
    base = args.seed if args.seed is not None else default_seed(args.key)
    if base + args.takes - 1 > 4294967295:
        raise SystemExit('--seed is too large')
    request = {'voice': args.voice or args.voice_id, 'voice_id': voice_id, 'text': text, 'model_id': args.model,
               'voice_settings': speech_settings(args), 'language_code': args.language_code, 'seed': base}
    if args.dry_run:
        return emit({'command': 'speak', 'dry_run': True, 'key': args.key, 'request': request, 'takes': args.takes,
                     'estimated_credits': len(text) * args.takes})
    manifest = load(folder)
    line = manifest['lines'].get(args.key)
    if line and line['request'] != request:
        raise SystemExit('line %s is recorded with a different request; use a new key such as %s_r2'
                         % (args.key, args.key))
    if not line:
        line = manifest['lines'][args.key] = {'request': request, 'takes': []}
    done = {t['take']: t for t in line['takes']}
    todo = [k for k in range(1, args.takes + 1) if done.get(k, {}).get('status') != 'done']
    for k in todo:
        if k in done:
            blocked(done[k], args.retry_unknown)
    if not todo:
        return emit({'command': 'speak', 'key': args.key, 'skipped': 'all takes recorded', 'takes': line['takes']})
    account = subscription()
    model = next((m for m in models() if m['model_id'] == args.model), None)
    if model is None or not model['tts']:
        raise SystemExit('model %s is not a text-to-speech model in this account; see `check`' % args.model)
    if model['max_chars'] and len(text) > model['max_chars']:
        raise SystemExit('the text is %d characters; %s takes at most %d' % (len(text), args.model, model['max_chars']))
    estimate = int(round(len(text) * len(todo) * float(model['cost_multiplier'] or 1.0)))
    budget(estimate, account, args.max_credits)
    used = account['credits']['used']
    written = []
    for k in todo:
        body = {'text': text, 'model_id': args.model, 'seed': base + k - 1}
        if request['voice_settings']:
            body['voice_settings'] = request['voice_settings']
        if args.language_code:
            body['language_code'] = args.language_code
        take = {'label': 'line %s take %d' % (args.key, k), 'take': k, 'seed': body['seed'], 'status': 'pending',
                'sent_at': now()}
        line['takes'] = [t for t in line['takes'] if t['take'] != k] + [take]
        line['takes'].sort(key=lambda t: t['take'])
        store(folder, manifest)
        try:
            blob, headers, fmt = with_format('POST', '/v1/text-to-speech/%s' % urllib.parse.quote(voice_id, safe=''),
                                             body, args.formats)
        except ApiError as error:
            take.update(status='failed', error=str(error))
            store(folder, manifest)
            raise SystemExit('take %d failed: %s' % (k, error))
        except Exception as error:
            take.update(status='unknown', error=type(error).__name__)
            store(folder, manifest)
            raise SystemExit('line %s take %d: the outcome is unknown (%s); check `history --since %s`'
                             % (args.key, k, type(error).__name__, take['sent_at']))
        path, seconds, pcm = save_audio(folder / 'takes' / ('%s_%02d' % (args.key, k)), blob, fmt,
                                        headers.get('content-type', ''))
        cost, used = cost_of(headers, used)
        take.update(status='done', returned_at=now(), format=fmt, file=relative(path, folder), duration_s=seconds,
                    pcm=pcm, request_id=headers.get('request-id'), cost=cost)
        store(folder, manifest)
        written.append(take)
    return emit({'command': 'speak', 'key': args.key, 'written': written,
                 'credits': sum(t['cost']['credits'] for t in written)})


def command_delete(args):
    manifest = load(args.dir) if args.dir and manifest_path(args.dir).is_file() else None
    by_id = {v.get('voice_id'): k for k, v in (manifest or {}).get('voices', {}).items() if v.get('voice_id')}
    targets = []
    if args.trials:
        if not manifest:
            raise SystemExit('--trials needs --dir with a manifest')
        targets += [k for k, v in manifest['voices'].items()
                    if v.get('trial') and v.get('status') == 'done' and not v.get('deleted_at')]
    for target in args.targets:
        if manifest and target in manifest['voices']:
            targets.append(target)
        elif target in by_id:
            targets.append(by_id[target])
        elif args.unrecorded:
            targets.append(target)
        else:
            raise SystemExit('%s is not a voice in the manifest; pass --unrecorded to delete a voice this '
                             'workflow did not make' % target)
    plan = []
    for target in dict.fromkeys(targets):
        entry = manifest['voices'].get(target) if manifest else None
        plan.append((target, entry['voice_id'] if entry else target, entry))
    if args.dry_run:
        return emit({'command': 'delete', 'dry_run': True, 'would_delete': [
            {'name': t, 'voice_id': v} for t, v, _ in plan]})
    results = []
    for name, voice_id, entry in plan:
        try:
            http('DELETE', '/v1/voices/%s' % urllib.parse.quote(voice_id, safe=''))
            status = 'deleted'
        except ApiError as error:
            status = 'not found' if error.status == 404 else str(error)
        if entry is not None and status in ('deleted', 'not found'):
            entry['deleted_at'] = now()
        results.append({'name': name, 'voice_id': voice_id, 'result': status})
    if manifest:
        store(args.dir, manifest)
    failed = [r for r in results if r['result'] not in ('deleted', 'not found')]
    return emit({'command': 'delete', 'results': results}, 1 if failed else 0)


def command_mark(args):
    folder = Path(args.dir)
    manifest = load(folder)
    verdict = {'verdict': args.verdict, 'note': args.note, 'at': now()}
    if args.target in manifest['designs']:
        if not args.candidate:
            raise SystemExit('a design needs --candidate')
        item = next((p for p in manifest['designs'][args.target]['previews'] if p['candidate'] == args.candidate), None)
    elif args.target in manifest['lines']:
        if not args.take:
            raise SystemExit('a line needs --take')
        item = next((t for t in manifest['lines'][args.target]['takes'] if t['take'] == args.take), None)
    else:
        raise SystemExit('%s is neither a design nor a line in the manifest' % args.target)
    if item is None:
        raise SystemExit('no such candidate or take')
    item['review'] = verdict
    store(folder, manifest)
    return emit({'command': 'mark', 'target': args.target, 'review': verdict})


# ---------------------------------------------------------------- listening page

PAGE_STYLE = """
:root{--bg:#f7f6f2;--fg:#1d1d1f;--muted:#66656b;--card:#fff;--line:#dedcd5;--accent:#2f6d62}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#ececee;--muted:#a1a1aa;--card:#222226;--line:#34343a;--accent:#7cc4b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px}h2{margin:36px 0 8px}
.lead,.meta{color:var(--muted)}.meta{font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
.card h3{margin:0 0 6px;font-size:15px}.text{font-family:ui-monospace,Consolas,monospace;font-size:13px;overflow-wrap:anywhere}
audio{width:100%;height:36px;margin:6px 0 0;display:block}.review{color:var(--accent);font-weight:600;font-size:13px}
blockquote{margin:6px 0;padding:6px 12px;border-left:3px solid var(--line);color:var(--muted);font-size:13px}
"""


def player(src, label=None):
    title = '<div class="meta">%s</div>' % html.escape(label) if label else ''
    return '%s<audio controls preload="none" src="%s"></audio>' % (title, html.escape(src, quote=True))


def review_note(item):
    review = item.get('review')
    if not review:
        return '<div class="meta">candidate: not yet reviewed</div>'
    return '<div class="review">%s%s</div>' % (html.escape(review['verdict']),
                                              ': ' + html.escape(review['note']) if review.get('note') else '')


def command_page(args):
    folder = Path(args.dir)
    manifest = load(folder)
    out = Path(args.out) if args.out else folder / 'listen.html'
    base = out.parent
    processed = Path(args.processed) if args.processed else None
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title><style>%s</style>'
             '</head><body><main>' % (html.escape(args.title), PAGE_STYLE),
             '<h1>%s</h1><p class="lead">Every candidate and take with its settings. Only your listening '
             'accepts a voice or a take.</p>' % html.escape(args.title)]
    designs = {k: v for k, v in manifest['designs'].items() if v.get('status') == 'done'}
    if designs:
        parts.append('<h2>Voice candidates</h2>')
    for name, d in designs.items():
        r = d['request']
        parts.append('<h3>%s</h3><blockquote>%s</blockquote><div class="meta">%s, seed %s, %s, %s credits</div>'
                     % (html.escape(name), html.escape(r['voice_description']), html.escape(r['model_id']),
                        r.get('seed'), html.escape(d.get('format', '')), d.get('cost', {}).get('credits')))
        parts.append('<div class="text">%s</div><div class="grid">' % html.escape(d.get('text') or ''))
        for p in d['previews']:
            saved = [k for k, v in manifest['voices'].items()
                     if v.get('generated_voice_id') == p['generated_voice_id'] and v.get('status') == 'done'
                     and not v.get('deleted_at')]
            parts.append('<div class="card"><h3>Candidate %s</h3>%s%s%s</div>' % (
                p['candidate'], player(relative(folder / p['file'], base)),
                '<div class="meta">saved as %s</div>' % html.escape(', '.join(saved)) if saved else '',
                review_note(p)))
        parts.append('</div>')
    lines = {k: v for k, v in manifest['lines'].items() if any(t.get('status') == 'done' for t in v['takes'])}
    if lines:
        parts.append('<h2>Lines</h2>')
    for key, line in lines.items():
        r = line['request']
        settings = ', '.join('%s %s' % kv for kv in (r.get('voice_settings') or {}).items()) or 'default settings'
        parts.append('<h3>%s</h3><div class="text">%s</div><div class="meta">voice %s, %s, %s</div><div class="grid">'
                     % (html.escape(key), html.escape(r['text']), html.escape(str(r['voice'])),
                        html.escape(r['model_id']), html.escape(settings)))
        for t in line['takes']:
            if t.get('status') != 'done':
                continue
            cell = [player(relative(folder / t['file'], base), 'original')]
            if processed is not None and (processed / Path(t['file']).name).is_file():
                cell.append(player(relative(processed / Path(t['file']).name, base), 'processed'))
            parts.append('<div class="card"><h3>Take %d</h3>%s<div class="meta">seed %s, %s s, %s credits</div>%s</div>'
                         % (t['take'], ''.join(cell), t['seed'], t.get('duration_s'),
                            t.get('cost', {}).get('credits'), review_note(t)))
        parts.append('</div>')
    parts.append('</main></body></html>\n')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(parts), encoding='utf-8')
    return emit({'command': 'page', 'output': str(out), 'designs': len(designs), 'lines': len(lines)})


# ---------------------------------------------------------------- CLI

def formats(value):
    items = [v.strip() for v in value.split(',') if v.strip()]
    if not items:
        raise argparse.ArgumentTypeError('give at least one output format')
    return items


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0],
                                     epilog='The key is read from ELEVENLABS_API_KEY only.')
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('check', help='plan, credits, voice slots and models (read-only)')
    p.add_argument('--dir', help='work folder: also record this check in its manifest')

    p = sub.add_parser('list', help='voices in the account (read-only)')
    p.add_argument('--type', default='personal',
                   help='voice_type filter: personal (default), default, workspace, saved, non-default ...; "" for all')
    p.add_argument('--search')
    p.add_argument('--limit', type=int, default=100)
    p.add_argument('--dir', help='work folder: mark the voices this workflow made')

    p = sub.add_parser('history', help='recent text-to-speech generations (read-only)')
    p.add_argument('--voice', help='manifest voice name (with --dir) or voice ID')
    p.add_argument('--since', help='ISO date-time or Unix seconds')
    p.add_argument('--limit', type=int, default=20)
    p.add_argument('--dir')

    p = sub.add_parser('design', help='candidate voices from a description (paid)')
    p.add_argument('name', help='a short name for this design attempt, such as town_guard')
    p.add_argument('--dir', required=True, help='work folder for the manifest, previews and takes')
    p.add_argument('--description', required=True)
    p.add_argument('--text', help='preview text, 100 to 1000 characters')
    p.add_argument('--auto-text', action='store_true', help='let ElevenLabs write the preview text')
    p.add_argument('--seed', type=int, help='default: derived from the name')
    p.add_argument('--model', default=DESIGN_MODEL)
    p.add_argument('--guidance-scale', type=float, help='higher follows the description more closely')
    p.add_argument('--loudness', type=float, help='-1 to 1; 0 is about -24 LUFS')
    p.add_argument('--quality', type=float, help='higher: better quality, less variety')
    p.add_argument('--formats', type=formats, default=FORMATS, help='comma-separated, tried in order')
    p.add_argument('--max-credits', type=int, help='refuse when the estimate is higher')
    p.add_argument('--retry-unknown', action='store_true')
    p.add_argument('--dry-run', action='store_true', help='print the request; no network')

    p = sub.add_parser('save', help='save a candidate as a voice (uses a voice slot)')
    p.add_argument('design')
    p.add_argument('--candidate', required=True, help='a, b, c ...')
    p.add_argument('--dir', required=True)
    p.add_argument('--name', help='manifest name of the voice (default <design>_<candidate>)')
    p.add_argument('--voice-name', help='name shown in the account (default: the manifest name)')
    p.add_argument('--trial', action='store_true', help='saved only to compare; `delete --trials` removes it')
    p.add_argument('--retry-unknown', action='store_true')
    p.add_argument('--dry-run', action='store_true')

    p = sub.add_parser('speak', help='speak a line in takes (paid)')
    p.add_argument('key', help='a stable name for the line, such as town_guard_alert')
    p.add_argument('--dir', required=True)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--voice', help='manifest voice name')
    group.add_argument('--voice-id', help='any voice ID in the account, such as a premade voice')
    p.add_argument('--text', required=True, help='the line, with audio tags such as [whispers]')
    p.add_argument('--model', default=SPEECH_MODEL)
    p.add_argument('--takes', type=int, default=3, help='total takes wanted; recorded ones are kept')
    p.add_argument('--seed', type=int, help='first take\'s seed; take N uses seed + N - 1')
    p.add_argument('--stability', type=float)
    p.add_argument('--similarity-boost', type=float)
    p.add_argument('--style', type=float)
    p.add_argument('--speed', type=float)
    p.add_argument('--language-code')
    p.add_argument('--formats', type=formats, default=FORMATS)
    p.add_argument('--max-credits', type=int)
    p.add_argument('--retry-unknown', action='store_true')
    p.add_argument('--dry-run', action='store_true')

    p = sub.add_parser('delete', help='delete saved voices from the account')
    p.add_argument('targets', nargs='*', help='manifest voice names or recorded voice IDs')
    p.add_argument('--dir')
    p.add_argument('--trials', action='store_true', help='every voice saved with --trial and not yet deleted')
    p.add_argument('--unrecorded', action='store_true', help='allow IDs that are not in the manifest')
    p.add_argument('--dry-run', action='store_true')

    p = sub.add_parser('mark', help="record the owner's verdict on a candidate or take")
    p.add_argument('target', help='design name or line key')
    p.add_argument('--dir', required=True)
    p.add_argument('--candidate')
    p.add_argument('--take', type=int)
    p.add_argument('--verdict', required=True, help='for example chosen, accepted, rejected, redo')
    p.add_argument('--note')

    p = sub.add_parser('page', help='listening page from the manifest')
    p.add_argument('--dir', required=True)
    p.add_argument('--out', help='default: <dir>/listen.html')
    p.add_argument('--processed', help='folder of edited takes with the same file names, shown beside the originals')
    p.add_argument('--title', default='Voice candidates and takes')
    return parser


COMMANDS = {'check': command_check, 'list': command_list, 'history': command_history, 'design': command_design,
            'save': command_save, 'speak': command_speak, 'delete': command_delete, 'mark': command_mark,
            'page': command_page}


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.command == 'speak' and args.takes < 1:
        raise SystemExit('--takes must be at least 1')
    try:
        return COMMANDS[args.command](args)
    except ApiError as error:
        raise SystemExit(str(error))
    except (urllib.error.URLError, OSError) as error:
        raise SystemExit('network error: %s' % getattr(error, 'reason', type(error).__name__))


if __name__ == '__main__':
    sys.exit(main())
