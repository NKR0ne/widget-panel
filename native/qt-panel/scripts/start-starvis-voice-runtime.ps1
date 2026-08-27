param([int]$Port = 1235)

$python = 'M:\LLModels\starvis-runtime\Scripts\python.exe'
$server = Join-Path $PSScriptRoot 'starvis-asr-runtime.py'
$asr = 'M:\LLModels\Qwen3-ASR-1.7B\config.json'

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { return }
} catch { }

if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $server) `
        -or !(Test-Path -LiteralPath $asr)) {
    throw 'Starvis local ASR runtime or model files are missing.'
}

$env:STARVIS_ASR_PORT = [string]$Port
$env:STARVIS_ASR_DEVICE = 'auto'

$logRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'qt-panel'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Process -FilePath $python -ArgumentList @($server) `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'starvis-asr-runtime.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'starvis-asr-runtime.err.log')
