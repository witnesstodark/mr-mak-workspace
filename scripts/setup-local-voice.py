"""Optional local voice setup. Run explicitly with Python 3.10-3.12; no app restart."""
import argparse
import functools
import hashlib
import os
from pathlib import Path
import platform
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import venv

WHISPER = 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/'
KOKORO = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/'
MODELS = {
    'dictation': [
        ('model/config.json', WHISPER + 'config.json', 2370, 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828'),
        ('model/tokenizer.json', WHISPER + 'tokenizer.json', 2203239, 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab'),
        ('model/vocabulary.txt', WHISPER + 'vocabulary.txt', 459861, '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913'),
        ('model/model.bin', WHISPER + 'model.bin', 483546902, '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671'),
    ],
    'read-aloud': [
        ('kokoro-v1.0.int8.onnx', KOKORO + 'kokoro-v1.0.int8.onnx', 114119327, 'ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c'),
        ('voices-v1.0.bin', KOKORO + 'voices-v1.0.bin', 28214398, 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'),
    ],
}
PACKAGES = {'dictation': ['faster-whisper==1.2.1', 'av==16.1.0'], 'read-aloud': ['kokoro-onnx==0.6.1']}

def python_path(root, windows=os.name == 'nt'):
    return root / 'venv' / ('Scripts/python.exe' if windows else 'bin/python')

def verified(file, size, digest):
    if not file.is_file() or file.stat().st_size != size:
        return False
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest() == digest

def download(file, url, size, digest, opener=urllib.request.urlopen):
    if verified(file, size, digest):
        return
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + '.part')
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'MrMak-LocalVoice-Setup'})
        with opener(request, timeout=120) as response, temporary.open('wb') as output:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > size:
                    raise RuntimeError('Unexpected download size: ' + file.name)
                output.write(chunk)
        if not verified(temporary, size, digest):
            raise RuntimeError('Incomplete or changed model download: ' + file.name)
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)

# On Apple Silicon the pinned wheels start at av 16.1.0 (macOS 14) and onnxruntime (macOS 13);
# below that pip falls back to a source build that fails.
MACOS_MINIMUM = {'dictation': (14, 0), 'read-aloud': (13, 0)}

def macos_too_old(feature, version=None, machine=None):
    if sys.platform != 'darwin' or (machine or platform.machine()) != 'arm64':
        return None
    version = version or platform.mac_ver()[0] or '0'
    minimum = MACOS_MINIMUM[feature]
    if tuple(int(part) for part in version.split('.')[:2]) >= minimum:
        return None
    return f'Local {feature} needs macOS {minimum[0]} or later on Apple Silicon; this Mac runs macOS {version}.'

SUPPORTED = 'import sys; sys.exit(not (3, 10) <= sys.version_info[:2] <= (3, 12))'

def macos_python():
    """A Python 3.10-3.12 on this Mac: plain python3 is usually 3.9 (Xcode) or 3.13+ (Homebrew)."""
    names = ['python3.12', 'python3.11', 'python3.10']
    found = [shutil.which(name) for name in names]
    found += [f'{prefix}/bin/{name}' for name in names for prefix in ('/opt/homebrew', '/usr/local')]
    if shutil.which('uv'):
        uv = subprocess.run(['uv', 'python', 'find', '>=3.10,<3.13'], capture_output=True, text=True)
        found.append(uv.stdout.strip() if uv.returncode == 0 else None)
    for candidate in filter(None, found):
        if os.access(candidate, os.X_OK) and subprocess.run([candidate, '-c', SUPPORTED], capture_output=True).returncode == 0:
            return candidate
    return None

def tls_context():
    context = ssl.create_default_context()
    # python.org macOS builds trust no CA until 'Install Certificates.command' runs; use the system bundle then.
    if sys.platform == 'darwin' and not context.cert_store_stats()['x509_ca'] and os.path.exists('/etc/ssl/cert.pem'):
        context.load_verify_locations('/etc/ssl/cert.pem')
    return context

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('feature', choices=MODELS)
    args = parser.parse_args()
    if too_old := macos_too_old(args.feature):
        parser.error(too_old)
    if not (3, 10) <= sys.version_info[:2] <= (3, 12):
        if sys.platform == 'darwin' and not os.environ.get('MRMAK_VOICE_SETUP_REEXEC'):
            candidate = macos_python()
            if candidate:
                print(f'Python {sys.version.split()[0]} is not supported; using {candidate}.', flush=True)
                os.environ['MRMAK_VOICE_SETUP_REEXEC'] = '1'
                os.execv(candidate, [candidate, str(Path(__file__).resolve()), *sys.argv[1:]])
        hint = ''
        if sys.platform == 'darwin':
            hint = (' On macOS: brew install python@3.12 (or uv python install 3.12), then run'
                    f' python3.12 scripts/setup-local-voice.py {args.feature} (plain python3 also finds it).')
        parser.error(f'Use Python 3.10-3.12 (3.12 recommended) for the pinned local voice packages; this is {sys.version.split()[0]}.' + hint)
    root = Path(__file__).resolve().parent.parent / '.cache' / args.feature
    root.mkdir(parents=True, exist_ok=True)
    python = python_path(root)
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(root / 'venv')
    # Fail fast with 'no matching distribution' instead of a long source build on a Mac.
    binary = ['--only-binary', 'av,onnxruntime,ctranslate2'] if sys.platform == 'darwin' else []
    subprocess.run([str(python), '-m', 'pip', 'install', *binary, *PACKAGES[args.feature]], check=True)
    opener = functools.partial(urllib.request.urlopen, context=tls_context())
    for name, url, size, digest in MODELS[args.feature]:
        print('Verifying ' + name, flush=True)
        try:
            download(root / name, url, size, digest, opener)
        except urllib.error.URLError as error:
            if sys.platform == 'darwin' and isinstance(error.reason, ssl.SSLCertVerificationError):
                sys.exit('TLS certificate verification failed. With the python.org installer, run'
                         ' "Install Certificates.command" in /Applications/Python 3.12, or use Homebrew python@3.12; then rerun.')
            raise
    if args.feature == 'dictation':
        probe = 'from faster_whisper import WhisperModel; import sys; WhisperModel(sys.argv[1], device="cpu", compute_type="int8", local_files_only=True)'
        subprocess.run([str(python), '-c', probe, str(root / 'model')], check=True)
    else:
        probe = 'from kokoro_onnx import Kokoro; import sys; Kokoro(sys.argv[1],sys.argv[2])'
        subprocess.run([str(python), '-c', probe, str(root / 'kokoro-v1.0.int8.onnx'), str(root / 'voices-v1.0.bin')], check=True)
    print('Local voice is ready. Refresh Phone settings to select it. No app restart performed.')

if __name__ == '__main__':
    main()
