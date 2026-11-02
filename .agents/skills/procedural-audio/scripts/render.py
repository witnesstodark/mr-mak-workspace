#!/usr/bin/env python3
"""Render a catalogue of modelled sounds to WAV files, the same bytes every time.

Subcommands
  render  every event's takes: model, trim, loudness under the true-peak
          ceiling, WAV; then manifest.json, and optionally review sheets
          and a listening page; --check fails on any technical problem
  list    the catalogue's events, models, targets and seeds
  mark    record the owner's verdict on a take (kept in reviews.json)
  page    rebuild the listening page from the manifest

Files go to <out>/<category>/<stem>_<NN>.wav. The manifest records each
take's seed, model call, SHA-256 and measurements. A take is a candidate
until the owner's verdict is recorded with `mark`; a verdict lapses when
the take's seed or model call changes. Prints one JSON report.
"""
import argparse
import contextlib
import hashlib
import html
import importlib.util
import io
import json
import os
import platform
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402
import scipy  # noqa: E402

import catalogue as catalogue_parts  # noqa: E402
import master  # noqa: E402

TOLERANCE_DB = 0.5
SEAM_JUMP_RATIO = 2.0
SEAM_LEVEL_MARGIN_DB = 1.5  # over the loop's own 95th-percentile frame-to-frame change
_CATALOGUES = {}


def load_catalogue(path):
    path = str(Path(path).resolve())
    if path not in _CATALOGUES:
        folder = str(Path(path).parent)
        if folder not in sys.path:
            sys.path.insert(0, folder)
        spec = importlib.util.spec_from_file_location('sound_catalogue', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        events = getattr(module, 'EVENTS', None)
        if not events:
            raise SystemExit('%s defines no EVENTS list' % path)
        problems = catalogue_parts.check(events)
        if problems:
            raise SystemExit('catalogue problems: %s' % '; '.join(problems))
        _CATALOGUES[path] = {e.stem: e for e in events}
    return _CATALOGUES[path]


def selected(stem, words):
    """No words selects everything; otherwise stems containing any word."""
    return not words or any(word in stem for word in words)


def as_channels(x, channels):
    x = np.asarray(x, np.float64)
    if channels == 2 and x.ndim == 1:
        return np.stack([x, x], axis=1) * np.sqrt(0.5)
    if channels == 1 and x.ndim == 2:
        return x.mean(axis=1)
    return x


def render_take(catalogue_path, stem, take, out, bits):
    event = load_catalogue(catalogue_path)[stem]
    seed = event.seed(take)
    raw = as_channels(event.make(seed, **event.params), event.channels)
    y, gain = master.master(raw, event.target, loop=event.loop)
    data = master.encode(y, bits, seed)
    target = Path(out) / event.category / event.file_name(take)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    samples, _, _ = master.audio_tool.read_wav(target)
    m = master.audio_tool.measure(samples, master.SR)
    level = m['integrated_lufs'] if event.loop else m['max_momentary_lufs']
    entry = {'take': take, 'seed': seed, 'file': '%s/%s' % (event.category, event.file_name(take)),
             'sha256': hashlib.sha256(data).hexdigest(), 'length_s': m['duration_s'], 'loudness_lufs': level,
             'true_peak_dbtp': m['true_peak_dbtp'], 'clipped_samples': m['clipped_samples'],
             'dc_offset': m['dc_offset'], 'gain_db': gain['gain_db'], 'target_reached': gain['target_reached'],
             'shortfall_db': gain['shortfall_db']}
    if event.loop:
        entry['seam'] = master.seam(samples)
    return entry


def problems_of(event, entry):
    found = []
    if entry['loudness_lufs'] is None or abs(entry['loudness_lufs'] - event.target) > TOLERANCE_DB:
        found.append('loudness %s LUFS, target %.1f%s' % (entry['loudness_lufs'], event.target,
                     ' (short by %.1f dB at the ceiling)' % entry['shortfall_db'] if entry['shortfall_db'] else ''))
    if entry['clipped_samples']:
        found.append('clipping')
    if entry['true_peak_dbtp'] is not None and entry['true_peak_dbtp'] > master.CEILING:
        found.append('true peak %.2f dBTP' % entry['true_peak_dbtp'])
    if entry['dc_offset'] > 0.01:
        found.append('dc offset')
    seam = entry.get('seam')
    if seam and (seam['jump_ratio'] > SEAM_JUMP_RATIO
                 or abs(seam['level_step_db']) > seam['usual_step_db'] + SEAM_LEVEL_MARGIN_DB):
        found.append('loop seam (jump x%.2f, level step %.1f dB where %.1f is usual)'
                     % (seam['jump_ratio'], seam['level_step_db'], seam['usual_step_db']))
    return found


def reviews_path(out):
    return Path(out) / 'reviews.json'


def load_reviews(out):
    path = reviews_path(out)
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}


def apply_reviews(manifest, reviews):
    for stem, info in manifest['events'].items():
        for entry in info['files']:
            review = reviews.get(stem, {}).get(str(entry['take']))
            if not review:
                entry['status'] = 'candidate'
            elif review['seed'] == entry['seed'] and review['model'] == info['model']:
                entry['status'] = review['verdict']
                entry['review'] = {k: review[k] for k in ('verdict', 'note', 'at')}
            else:
                entry['status'] = 'candidate (changed since the owner\'s verdict)'


def write_json(path, value):
    temporary = Path(str(path) + '.tmp')
    temporary.write_text(json.dumps(value, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def command_render(args):
    events = load_catalogue(args.catalogue)
    chosen = [e for e in events.values() if selected(e.stem, args.only)]
    if not chosen:
        raise SystemExit('no events match --only %s' % ' '.join(args.only))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    source = str(Path(args.catalogue).resolve())
    work = [(e.stem, k) for e in chosen for k in range(1, e.takes + 1)]
    entries = {}
    if args.jobs > 1:
        with ProcessPoolExecutor(max_workers=args.jobs) as executor:
            pending = {executor.submit(render_take, source, stem, k, str(out), args.bits): (stem, k)
                       for stem, k in work}
            for future in as_completed(pending):
                entries[pending[future]] = future.result()
    else:
        for stem, k in work:
            entries[(stem, k)] = render_take(source, stem, k, str(out), args.bits)
    done = {e.stem: [entries[(e.stem, k)] for k in range(1, e.takes + 1)] for e in chosen}
    manifest_file = out / 'manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8')) if args.only and manifest_file.is_file() \
        else {'events': {}}
    for e in chosen:
        manifest['events'][e.stem] = {'category': e.category, 'describe': e.describe, 'model': e.call(),
                                      'takes': e.takes, 'target_lufs': e.target, 'measure': e.measure,
                                      'loop': e.loop, 'channels': e.channels, 'files': done[e.stem]}
    manifest['events'] = dict(sorted(manifest['events'].items()))
    manifest.update({'catalogue': Path(args.catalogue).name, 'rendered': datetime.now(timezone.utc).replace(
        microsecond=0).isoformat(), 'format': 'WAV 48 kHz %d-bit' % args.bits, 'ceiling_dbtp': master.CEILING,
        'tolerance_db': TOLERANCE_DB,
        'made_with': {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__}})
    apply_reviews(manifest, load_reviews(out))
    write_json(manifest_file, manifest)
    report = {'command': 'render', 'out': str(out), 'events': len(chosen), 'files': len(work), 'problems': []}
    for e in chosen:
        for entry in done[e.stem]:
            for problem in problems_of(e, entry):
                report['problems'].append('%s take %d: %s' % (e.stem, entry['take'], problem))
    if args.sheets:
        sheets = out / 'sheets'
        for e in chosen:
            files = [str(out / entry['file']) for entry in done[e.stem]]
            with contextlib.redirect_stdout(io.StringIO()):
                master.audio_tool.main(['sheet', *files, '--out', str(sheets / (e.stem + '.png')), '--labels',
                                        '--width', '760', '--row-height', '120'])
        report['sheets'] = str(sheets)
    if args.page:
        report['page'] = str(write_page(out, manifest, args.title))
    print(json.dumps(report, indent=1))
    return 1 if args.check and report['problems'] else 0


def command_list(args):
    events = load_catalogue(args.catalogue)
    print(json.dumps({'command': 'list', 'events': [
        {'stem': e.stem, 'category': e.category, 'model': e.call(), 'takes': e.takes, 'target_lufs': e.target,
         'measure': e.measure, 'loop': e.loop, 'channels': e.channels,
         'seeds': [e.seed(k) for k in range(1, e.takes + 1)]} for e in events.values()]}, indent=1))
    return 0


def command_mark(args):
    out = Path(args.out)
    manifest = json.loads((out / 'manifest.json').read_text(encoding='utf-8'))
    info = manifest['events'].get(args.stem)
    entry = next((f for f in (info or {}).get('files', []) if f['take'] == args.take), None)
    if entry is None:
        raise SystemExit('no take %d of %s in the manifest' % (args.take, args.stem))
    reviews = load_reviews(out)
    reviews.setdefault(args.stem, {})[str(args.take)] = {
        'verdict': args.verdict, 'note': args.note, 'seed': entry['seed'], 'model': info['model'],
        'at': datetime.now(timezone.utc).replace(microsecond=0).isoformat()}
    write_json(reviews_path(out), reviews)
    apply_reviews(manifest, reviews)
    write_json(out / 'manifest.json', manifest)
    print(json.dumps({'command': 'mark', 'stem': args.stem, 'take': args.take, 'status': args.verdict}))
    return 0


def command_page(args):
    out = Path(args.out)
    manifest = json.loads((out / 'manifest.json').read_text(encoding='utf-8'))
    print(json.dumps({'command': 'page', 'page': str(write_page(out, manifest, args.title))}))
    return 0


# ---------------------------------------------------------------- listening page

STYLE = """
:root{--bg:#f7f6f2;--fg:#1d1d1f;--muted:#66656b;--card:#fff;--line:#dedcd5;--ok:#2f6d62;--warn:#a2561b}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#ececee;--muted:#a1a1aa;--card:#222226;--line:#34343a;--ok:#7cc4b5;--warn:#e7a46a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h2{margin:40px 0 4px;text-transform:capitalize}
h3{margin:24px 0 2px}.meta,.lead{color:var(--muted)}.meta{font-size:13px}code{font-size:12px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:10px;margin:10px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;min-width:0}
audio{width:100%;height:36px;display:block;margin:4px 0}img{width:100%;height:auto;border-radius:8px;margin-top:8px}
.ok{color:var(--ok)}.warn{color:var(--warn)}
"""


def write_page(out, manifest, title):
    out = Path(out)
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
             'content="width=device-width,initial-scale=1"><title>%s</title><style>%s</style></head><body><main>'
             % (html.escape(title), STYLE),
             '<h1>%s</h1><p class="lead">Every take, modelled and rendered from its seed. The numbers and sheets '
             'catch technical faults; only your listening accepts a take.</p>' % html.escape(title)]
    by_category = {}
    for stem, info in manifest['events'].items():
        by_category.setdefault(info['category'], []).append((stem, info))
    for category, items in by_category.items():
        parts.append('<h2>%s</h2>' % html.escape(category))
        for stem, info in items:
            parts.append('<h3>%s</h3><div>%s</div><div class="meta">target %.1f LUFS (%s), %s, '
                         '<code>%s</code></div>' % (
                             html.escape(stem), html.escape(info['describe']), info['target_lufs'], info['measure'],
                             'stereo' if info['channels'] == 2 else 'mono', html.escape(info['model'])))
            parts.append('<div class="grid">')
            for f in info['files']:
                state = f.get('status', 'candidate')
                css = 'ok' if state in ('accepted', 'chosen') else 'meta'
                reached = '' if f['target_reached'] else ' <span class="warn">short by %.1f dB</span>' % f['shortfall_db']
                seam = (' seam x%.2f / %.1f dB' % (f['seam']['jump_ratio'], f['seam']['level_step_db'])
                        if f.get('seam') else '')
                parts.append('<div class="card"><strong>Take %d</strong><audio controls preload="none" src="%s">'
                             '</audio><div class="meta">seed %d, %.2f s, %s LUFS, %s dBTP%s%s</div>'
                             '<div class="%s">%s%s</div></div>' % (
                                 f['take'], html.escape(f['file'], quote=True), f['seed'], f['length_s'],
                                 f['loudness_lufs'], f['true_peak_dbtp'], reached, seam, css, html.escape(state),
                                 ': ' + html.escape(f['review']['note']) if f.get('review', {}).get('note') else ''))
            parts.append('</div>')
            sheet = out / 'sheets' / (stem + '.png')
            if sheet.is_file():
                parts.append('<img loading="lazy" alt="Waveform and spectrogram of %s" src="sheets/%s.png">'
                             % (html.escape(stem), html.escape(stem, quote=True)))
    parts.append('<p class="meta">%s. Rendered %s with %s.</p></main></body></html>\n' % (
        html.escape(manifest.get('format', '')), html.escape(manifest.get('rendered', '')),
        html.escape(', '.join('%s %s' % kv for kv in manifest.get('made_with', {}).items()))))
    page = out / 'listen.html'
    page.write_text('\n'.join(parts), encoding='utf-8')
    return page


# ---------------------------------------------------------------- CLI

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('render', help='render takes, manifest, sheets and page')
    p.add_argument('--catalogue', required=True, help='a Python file defining EVENTS')
    p.add_argument('--out', required=True)
    p.add_argument('--only', nargs='*', default=[], help='events whose stems contain any of these words')
    p.add_argument('--bits', type=int, choices=[16, 24], default=16)
    p.add_argument('--jobs', type=int, default=max(1, min(6, (os.cpu_count() or 2) - 1)))
    p.add_argument('--sheets', action='store_true', help='a waveform and spectrogram sheet per event')
    p.add_argument('--page', action='store_true', help='write <out>/listen.html')
    p.add_argument('--check', action='store_true', help='exit 1 when any take has a technical problem')
    p.add_argument('--title', default='Sound candidates')
    p = sub.add_parser('list', help="the catalogue's events")
    p.add_argument('--catalogue', required=True)
    p = sub.add_parser('mark', help="record the owner's verdict on a take")
    p.add_argument('stem')
    p.add_argument('--take', type=int, required=True)
    p.add_argument('--verdict', required=True, help='accepted, rejected, redo ...')
    p.add_argument('--note')
    p.add_argument('--out', required=True)
    p = sub.add_parser('page', help='rebuild the listening page')
    p.add_argument('--out', required=True)
    p.add_argument('--title', default='Sound candidates')
    return parser


COMMANDS = {'render': command_render, 'list': command_list, 'mark': command_mark, 'page': command_page}


def main(argv=None):
    args = build_parser().parse_args(argv)
    return COMMANDS[args.command](args)


if __name__ == '__main__':
    sys.exit(main())
