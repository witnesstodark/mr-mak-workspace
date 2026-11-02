#!/usr/bin/env python3
"""Pack rendered sprite frames into sheets with JSON, plus review previews.

  python pack_sprites.py build/hero [--previews] [--scale 4]

Reads <out>/sprites.json from render_sprites.py. For each clip and pass it
writes <out>/sheets/<clip><suffix>.png: one row per direction in the
manifest's order, one column per frame, every cell the full canvas. The
packing is 2d-asset-prep's `sheet.py pack`, so cells carry the same x, y,
w and h fields; the JSON beside each sheet adds the clip, pass, fps, loop,
events (frame indices), pivot and each cell's direction and frame.
--previews adds a GIF per clip and direction at the clip's speed and a
contact sheet per clip under <out>/previews/. Prints a JSON report.
"""
import argparse
import contextlib
import importlib.util
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_sheet_tool():
    for candidate in (HERE / 'sheet.py', HERE.parent.parent / '2d-asset-prep' / 'scripts' / 'sheet.py'):
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location('sheet_tool', candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise SystemExit('pack_sprites.py needs 2d-asset-prep/scripts/sheet.py beside this skill '
                     '(copy both skills, or put sheet.py in this scripts folder)')


def run_tool(tool, argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = tool.main([str(a) for a in argv])
    if code:
        raise SystemExit('sheet.py %s failed' % argv[0])
    return json.loads(buffer.getvalue().strip().splitlines()[-1])


def pack(out, previews=False, scale=4):
    out = Path(out)
    manifest = json.loads((out / 'sprites.json').read_text(encoding='utf-8'))
    tool = load_sheet_tool()
    width, height = manifest['canvas']
    directions = [d['name'] for d in manifest['directions']]
    written = []
    for clip_name, clip in manifest['clips'].items():
        columns = len(clip['frames'])
        for pass_name, by_direction in clip['files'].items():
            frames = [out / path for direction in directions for path in by_direction[direction]]
            sheet = out / 'sheets' / ('%s%s.png' % (clip_name, manifest['suffixes'][pass_name]))
            run_tool(tool, ['pack', *frames, '--out', sheet, '--columns', columns, '--cell', '%dx%d' % (width, height)])
            layout = json.loads(sheet.with_suffix('.json').read_text(encoding='utf-8'))
            for entry in layout['frames']:
                row, column = divmod(entry['index'], columns)
                entry.update(direction=directions[row], frame=column, scene_frame=clip['frames'][column])
            layout.update(clip=clip_name, **{'pass': pass_name}, fps=clip['fps'], loop=clip['loop'],
                          events=clip['events'], pivot=manifest['pivot'],
                          directions=[{'name': d, 'row': i} for i, d in enumerate(directions)],
                          pixels_per_unit=manifest['pixels_per_unit'], view=manifest['camera'])
            sheet.with_suffix('.json').write_text(json.dumps(layout, indent=2) + '\n', encoding='utf-8')
            written.append({'sheet': str(sheet), 'clip': clip_name, 'pass': pass_name,
                            'size': layout['size'], 'rows': len(directions), 'columns': columns})
        if previews:
            colour = clip['files']['color']
            for direction in directions:
                gif = out / 'previews' / ('%s_%s.gif' % (clip_name, direction))
                run_tool(tool, ['preview', *[out / p for p in colour[direction]], '--out', gif,
                                '--fps', clip['fps'], '--scale', scale])
                written.append({'preview': str(gif)})
            contact = out / 'previews' / ('%s_contact.png' % clip_name)
            run_tool(tool, ['contact', *[out / p for d in directions for p in colour[d]], '--out', contact,
                            '--columns', columns, '--scale', scale])
            written.append({'contact': str(contact)})
    return {'command': 'pack', 'out': str(out), 'written': written, 'warnings': manifest.get('warnings', [])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('out', help='the render folder holding sprites.json')
    parser.add_argument('--previews', action='store_true', help='GIF per clip and direction, contact sheet per clip')
    parser.add_argument('--scale', type=int, default=4, help='integer zoom of the previews')
    args = parser.parse_args(argv)
    print(json.dumps(pack(args.out, args.previews, args.scale), indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
