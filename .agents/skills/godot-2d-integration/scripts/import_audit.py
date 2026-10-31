#!/usr/bin/env python3
"""Audit a Godot 4 project's texture imports and 2D display settings.

Reads `*.import` files and `project.godot` only; never changes the project.
Texture problems (exit 1) for --expect pixel:
  - compress/mode other than Lossless (0) or VRAM Uncompressed (3)
  - mipmaps/generate=true
  - process/size_limit > 0 (silently downscales)
  - a non-integer svg/scale
Warnings (exit 0):
  - process/fix_alpha_border=false
Project findings are reported with Godot's defaults filled in: texture filter,
2D snapping, stretch mode/aspect/scale mode, viewport size and renderer.
Godot 4 has no per-file texture filter import option; filtering comes from the
project default or each CanvasItem's texture_filter.
"""
import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path

IMAGE_EXTENSIONS = {'.png', '.svg', '.webp', '.jpg', '.jpeg', '.bmp', '.tga', '.exr', '.hdr', '.dds', '.ktx'}
COMPRESS_MODES = {0: 'Lossless', 1: 'Lossy', 2: 'VRAM Compressed', 3: 'VRAM Uncompressed', 4: 'Basis Universal'}
FILTERS = {0: 'Nearest', 1: 'Linear', 2: 'Nearest Mipmap', 3: 'Linear Mipmap'}

PROJECT_DEFAULTS = {
    'rendering/textures/canvas_textures/default_texture_filter': 1,
    'rendering/2d/snap/snap_2d_transforms_to_pixel': False,
    'rendering/2d/snap/snap_2d_vertices_to_pixel': False,
    'display/window/stretch/mode': 'disabled',
    'display/window/stretch/aspect': 'keep',
    'display/window/stretch/scale_mode': 'fractional',
    'display/window/size/viewport_width': 1152,
    'display/window/size/viewport_height': 648,
    'rendering/renderer/rendering_method': 'forward_plus',
}


def parse_value(text):
    """Convert a Godot config value to Python where simple; keep the rest as text."""
    text = text.strip()
    if text in ('true', 'false'):
        return text == 'true'
    if re.fullmatch(r'-?\d+', text):
        return int(text)
    if re.fullmatch(r'-?\d+\.\d*(e-?\d+)?', text):
        return float(text)
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    return text


def read_config(path):
    """Flatten a Godot ConfigFile into {'section/key': value} (multi-line values kept raw)."""
    values, section, pending = {}, '', None
    for raw in Path(path).read_text(encoding='utf-8', errors='replace').splitlines():
        line = raw.strip()
        if pending is not None:
            key, buffer = pending
            buffer.append(line)
            if line in ('}', ']', ')') or line.endswith('}') or line.endswith(']'):
                values[key] = '\n'.join(buffer)
                pending = None
            continue
        if not line or line.startswith(';'):
            continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
            continue
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        full = '%s/%s' % (section, key.strip()) if section else key.strip()
        if value.strip() in ('{', '['):
            pending = (full, [value.strip()])
            continue
        values[full] = parse_value(value)
    return values


def audit_texture(params, expect):
    problems, warnings = [], []
    mode = params.get('compress/mode', 0)
    if expect == 'pixel':
        if mode not in (0, 3):
            problems.append('compress/mode=%s (%s); use Lossless (0) for pixel art'
                            % (mode, COMPRESS_MODES.get(mode, 'unknown')))
        if params.get('mipmaps/generate') is True:
            problems.append('mipmaps/generate=true; 2D pixel art should not use mipmaps')
        if isinstance(params.get('process/size_limit'), int) and params['process/size_limit'] > 0:
            problems.append('process/size_limit=%d downscales the texture' % params['process/size_limit'])
        scale = params.get('svg/scale')
        if isinstance(scale, (int, float)) and float(scale) != int(float(scale)):
            problems.append('svg/scale=%s is not an integer' % scale)
        if params.get('process/fix_alpha_border') is False:
            warnings.append('process/fix_alpha_border=false (harmless with nearest filtering, '
                            'causes dark fringes with linear filtering)')
    return problems, warnings


def audit_project(root, expect):
    path = root / 'project.godot'
    if not path.is_file():
        raise SystemExit('%s has no project.godot' % root)
    config = read_config(path)
    settings = {}
    for key, default in PROJECT_DEFAULTS.items():
        settings[key] = config.get(key, default)
    settings['rendering/textures/canvas_textures/default_texture_filter_name'] = \
        FILTERS.get(settings['rendering/textures/canvas_textures/default_texture_filter'], 'unknown')
    for key in ('display/window/size/window_width_override', 'display/window/size/window_height_override'):
        if key in config:
            settings[key] = config[key]
    warnings = []
    if expect == 'pixel':
        if settings['rendering/textures/canvas_textures/default_texture_filter'] != 0:
            warnings.append('default_texture_filter is %s; Nearest (0) keeps pixel art sharp'
                            % settings['rendering/textures/canvas_textures/default_texture_filter_name'])
        if settings['display/window/stretch/mode'] == 'disabled':
            warnings.append('stretch mode is disabled; the base resolution will not scale with the window')
        if settings['display/window/stretch/scale_mode'] != 'integer':
            warnings.append('stretch scale_mode is %s; integer avoids uneven pixel sizes at non-integer '
                            'window scales (with letterboxing)' % settings['display/window/stretch/scale_mode'])
        if settings['display/window/stretch/mode'] == 'canvas_items' and \
                not settings['rendering/2d/snap/snap_2d_transforms_to_pixel']:
            warnings.append('canvas_items stretch without snap_2d_transforms_to_pixel lets sprites sit '
                            'between art pixels when scaled; consider snapping or viewport stretch')
    return {'config': str(path), 'settings': settings, 'warnings': warnings}


def find_imports(root, pattern, include_addons):
    for path in sorted(root.rglob('*.import')):
        relative = path.relative_to(root).as_posix()
        if relative.startswith('.godot/') or (not include_addons and relative.startswith('addons/')):
            continue
        source = relative[:-len('.import')]
        if Path(source).suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if pattern and not fnmatch.fnmatch(source, pattern):
            continue
        yield path, source


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('project', metavar='PROJECT_DIR')
    parser.add_argument('--path-glob', help='only audit sources matching this glob, e.g. "assets/**"')
    parser.add_argument('--expect', choices=('pixel', 'any'), default='pixel',
                        help='pixel: flag settings that blur or alter pixel art (default)')
    parser.add_argument('--include-addons', action='store_true', help='also audit textures under addons/')
    args = parser.parse_args(argv)
    root = Path(args.project)
    project = audit_project(root, args.expect)
    textures, problem_count = [], 0
    for path, source in find_imports(root, args.path_glob, args.include_addons):
        config = read_config(path)
        importer = config.get('remap/importer')
        params = {k[len('params/'):]: v for k, v in config.items() if k.startswith('params/')}
        if importer not in ('texture', None):
            continue
        problems, warnings = audit_texture(params, args.expect)
        problem_count += len(problems)
        if problems or warnings:
            textures.append({'source': source, 'problems': problems, 'warnings': warnings})
    audited = sum(1 for _ in find_imports(root, args.path_glob, args.include_addons))
    report = {'command': 'import_audit', 'project': str(root), 'expect': args.expect,
              'textures_audited': audited, 'textures_with_problems': sum(1 for t in textures if t['problems']),
              'pass': problem_count == 0, 'project_settings': project, 'textures': textures}
    print(json.dumps(report))
    return 0 if problem_count == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
