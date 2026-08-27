param([int]$Port = 1235)

$python = 'M:\LLModels\starvis-runtime\Scripts\python.exe'
$server = Join-Path $PSScriptRoot 'starvis-voice-runtime.py'
$asr = 'M:\LLModels\Qwen3-ASR-1.7B\config.json'
$tts = 'M:\LLModels\Qwen3-TTS-12Hz-1.7B-CustomVoice\config.json'

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { return }
} catch { }

if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $server) `
        -or !(Test-Path -LiteralPath $asr) -or !(Test-Path -LiteralPath $tts)) {
    throw 'Starvis local speech runtime or model files are missing.'
}

$env:STARVIS_SPEECH_PORT = [string]$Port
$env:STARVIS_SPEECH_DEVICE = 'auto'
# The global model power button is now the explicit GPU release boundary. Keep
# Dylan and the other Qwen voices resident so a briefing cannot lose CUDA to a
# later workload and unexpectedly fall back to slow CPU synthesis.
$env:STARVIS_SPEECH_MODEL_IDLE_SECONDS = '0'
$env:STARVIS_SPEECH_PREWARM_TTS = '1'

$logRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'qt-panel'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Process -FilePath $python -ArgumentList @($server) `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'starvis-voice-runtime.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'starvis-voice-runtime.err.log')
