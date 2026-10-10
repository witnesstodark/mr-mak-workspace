$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$dictationRoot = Join-Path $taskRoot '.cache/dictation'
$dictationPython = Join-Path $dictationRoot 'venv/Scripts/python.exe'
New-Item -ItemType Directory -Force $dictationRoot | Out-Null
python -m venv (Join-Path $dictationRoot 'venv')
if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
& $dictationPython -m pip install 'faster-whisper==1.2.1' 'av==16.1.0'
if ($LASTEXITCODE -ne 0) { throw 'Whisper dependency installation failed.' }
& $dictationPython -c "from faster_whisper.utils import download_model; import sys; download_model('small', output_dir=sys.argv[1])" (Join-Path $dictationRoot 'model')
if ($LASTEXITCODE -ne 0) { throw 'Whisper model download failed.' }
Write-Output 'Local Whisper is ready. Restarting Mr. Mak is not part of this setup.'
