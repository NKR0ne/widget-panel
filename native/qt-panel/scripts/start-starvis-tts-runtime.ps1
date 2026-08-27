param([int]$Port = 1237)

$ErrorActionPreference = 'Stop'
$python = 'M:\LLModels\starvis-piper-runtime\Scripts\python.exe'
$server = Join-Path $PSScriptRoot 'starvis-fast-tts-runtime.py'
$tom = 'M:\LLModels\Piper\fr_FR-tom-medium.onnx'
$upmc = 'M:\LLModels\Piper\fr_FR-upmc-medium.onnx'

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok' -and $health.ttsReady) { return }
} catch { }

if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $server) `
        -or !(Test-Path -LiteralPath $tom) -or !(Test-Path -LiteralPath $upmc)) {
    throw 'Starvis Piper runtime or French voice files are missing.'
}

$env:STARVIS_TTS_PORT = [string]$Port
$logRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'qt-panel'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Process -FilePath $python -ArgumentList @($server) `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'starvis-tts-runtime.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'starvis-tts-runtime.err.log')
