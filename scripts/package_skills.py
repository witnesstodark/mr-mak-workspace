"""Build and verify a portable skill archive from an explicit resource list."""

import argparse
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
SKILLS = (
    '2d-asset-prep', '2d-production-routing', '3d-production-routing', 'blender-game-animation', 'character-sheet-pipeline',
    'fal-ai-generation', 'feature-handoff', 'game-animation-integration',
    'game-audio-workflow', 'game-level-design', 'game-ui-workflow',
    'game-vfx-workflow', 'gameplay-visual-review', 'godot-2d-integration',
    'higgsfield-workflow',
    'image-reference-workflow', 'img2threejs', 'materials-to-game',
    'motion-reference-workflow', 'pixel-art-workflow', 'pixel-text-sprites', 'plan',
    'sound-effects-workflow', 'sprite-animation-workflow', 'tileset-workflow', 'vector-graphics-workflow',
    'video-watch', 'voice-dictation-setup', 'workspace-authoring',
)
SUPPORT = (
    'docs/skills.md', 'processes/creative-production.md',
    'processes/workspace-authoring.md', 'knowledge/video-watch.md',
    'knowledge/voice-dictation.md', 'scripts/video-watch/extract.py',
    'scripts/video-watch/requirements.txt', 'workspace/_shared/report.css',
    'workspace/_shared/report.js', 'workspace/_shared/examples.css', 'LICENSE',
)
EXCLUDED = {'.git', '.cache', '__pycache__', 'node_modules', '.venv'}
FORBIDDEN = {'.env', 'auth.json', 'credentials.json', 'tokens.json', 'token.json',
             'job.json', 'result.json', 'upload.json', 'settings.local.json'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def collect():
    payload = {}
    for skill in SKILLS:
        folder = ROOT / '.agents/skills' / skill
        if not (folder / 'SKILL.md').is_file():
            raise ValueError(f'Missing skill: {skill}')
        for file in sorted(folder.rglob('*')):
            if file.is_symlink():
                raise ValueError(f'Pack resources must be real files: {file}')
            if not file.is_file():
                continue
            if file.name in FORBIDDEN or file.name.startswith('.env.'):
                raise ValueError(f'Local state must not be packaged: {file.name}')
            parts = file.relative_to(folder).parts
            if any(part.startswith('.') for part in parts) or EXCLUDED.intersection(parts) or file.suffix in {'.pyc', '.pyo'}:
                continue
            relative = file.relative_to(ROOT).as_posix()
            data = file.read_bytes()
            mirror = relative.replace('.agents/', '.claude/', 1)
            if (ROOT / mirror).read_bytes() != data:
                raise ValueError(f'Claude mirror differs: {mirror}; run npm run skills:sync')
            payload[relative] = data
            payload[mirror] = data
    for relative in SUPPORT:
        payload[relative] = (ROOT / relative).read_bytes()
    payload['SKILLS-README.md'] = (ROOT / 'docs/skills-pack.md').read_bytes()
    payload['THIRD_PARTY_NOTICES.md'] = (
        '# Skill pack notices\n\n'
        'Original workflow documentation uses the included MIT licence.\n'
        'img2threejs retains its Apache-2.0 licence and notices in each agent\n'
        'skill folder. Source: https://github.com/img2threejs/img2threejs.\n\n'
        'Named tools and providers are separate products. This pack does not\n'
        'include their accounts, applications, models or services.\n'
    ).encode('utf-8')
    return payload


def verify(archive):
    # Extract outside the repository: local author files cannot hide missing resources.
    with tempfile.TemporaryDirectory(prefix='mrmak-skills-check-') as temporary:
        base = Path(temporary).resolve()
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            if len(names) != len(set(names)):
                raise ValueError('Duplicate archive entries')
            for name in names:
                if '\\' in name or not (base / name).resolve().is_relative_to(base):
                    raise ValueError(f'Unsafe archive entry: {name}')
            bundle.extractall(base)
        manifest = json.loads((base / 'manifest.json').read_text(encoding='utf-8'))
        if manifest['skills'] != list(SKILLS):
            raise ValueError('Manifest must describe all selected skills')
        if set(names) != set(manifest['files']) | {'manifest.json'}:
            raise ValueError('Manifest does not match archive entries')
        for relative, expected in manifest['files'].items():
            if digest((base / relative).read_bytes()) != expected:
                raise ValueError(f'Checksum mismatch: {relative}')
        for skill in SKILLS:
            first = base / '.agents/skills' / skill
            second = base / '.claude/skills' / skill
            for file in first.rglob('*'):
                if file.is_file() and file.read_bytes() != (second / file.relative_to(first)).read_bytes():
                    raise ValueError(f'Extracted skill mirrors differ: {skill}')
        # Resolve instructional links for original skills and references. Upstream
        # img2threejs retains its own larger documentation and optional integrations.
        for owner in ['.agents', '.claude']:
            for skill in SKILLS:
                if skill == 'img2threejs':
                    continue
                for file in (base / owner / 'skills' / skill).rglob('*.md'):
                    text = file.read_text(encoding='utf-8')
                    if re.search(r'[\u0400-\u04ff]|[A-Z]:[\\/]Users[\\/]', text):
                        raise ValueError(f'Nonportable authored instructions: {file.relative_to(base)}')
                    for match in re.finditer(r'\]\(([^\s)]+)\)', text):
                        link = match.group(1).strip('<>')
                        if re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', link) or link.startswith('#'):
                            continue
                        target = (file.parent / unquote(link.split('#')[0])).resolve()
                        if not target.is_relative_to(base) or not target.exists():
                            raise ValueError(f'Missing portable reference: {file.relative_to(base)} -> {link}')
        for relative in SUPPORT:
            if not (base / relative).is_file():
                raise ValueError(f'Missing support file: {relative}')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Destination ZIP (default: .cache/releases/)')
    parser.add_argument('--check', type=Path, help='Verify an already built archive instead')
    args = parser.parse_args()
    if args.check:
        manifest = verify(args.check)
        print(f"Verified {manifest['version']}: {len(manifest['skills'])} skills, {len(manifest['files'])} payload files")
        return
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    output = (args.output or ROOT / '.cache/releases' / f'Mr-Mak-Skills-{version}.zip').resolve()
    if output.suffix.lower() != '.zip':
        parser.error('--output must name a ZIP file')
    payload = collect()
    manifest = {'version': version, 'skills': list(SKILLS),
                'files': {name: digest(data) for name, data in sorted(payload.items())}}
    payload['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode('utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Write a temporary file so failed validation cannot replace an existing package.
    with tempfile.TemporaryDirectory(prefix='mrmak-skills-build-', dir=output.parent) as staging:
        candidate = Path(staging) / output.name
        with zipfile.ZipFile(candidate, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for name, data in sorted(payload.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(info, data)
        verify(candidate)
        candidate.replace(output)
    print(json.dumps({'path': str(output), 'version': version, 'skills': len(SKILLS),
                      'files': len(payload), 'sha256': digest(output.read_bytes())}, indent=2))


if __name__ == '__main__':
    main()
