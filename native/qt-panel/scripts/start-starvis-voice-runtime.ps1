param([int]$Port = 1235)

$nemo = 'M:\LLModels\NeMoSpeech\bin\nemo-speech.exe'
$parakeet = 'M:\LLModels\Parakeet-TDT-0.6B-v3\parakeet-tdt-0.6b-v3.q8_0.gguf'
$python = 'M:\LLModels\starvis-runtime\Scripts\python.exe'
$server = Join-Path $PSScriptRoot 'starvis-asr-runtime.py'
$asr = 'M:\LLModels\Qwen3-ASR-1.7B\config.json'

function Test-StarvisAsrReady {
    foreach ($path in @('ready', 'health')) {
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/$path" -TimeoutSec 2
            if ($status.ready -eq $true) { return $true }
            if ($status.status -in @('ok', 'ready') `
                    -and ($null -eq $status.asrReady -or $status.asrReady)) {
                return $true
            }
        } catch { }
    }
    return $false
}

if (Test-StarvisAsrReady) { return }

$logRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'qt-panel'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if ((Test-Path -LiteralPath $nemo) -and (Test-Path -LiteralPath $parakeet)) {
    Start-Process -FilePath $nemo -ArgumentList @(
        'serve',
        '--asr-model', $parakeet,
        '--host', '127.0.0.1',
        '--port', [string]$Port,
        '--threads', '4',
        '--no-ui'
    ) -WorkingDirectory (Split-Path -Parent $nemo) -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logRoot 'starvis-parakeet-runtime.out.log') `
        -RedirectStandardError (Join-Path $logRoot 'starvis-parakeet-runtime.err.log')
    return
}

if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $server) `
        -or !(Test-Path -LiteralPath $asr)) {
    throw 'Neither the Starvis Parakeet runtime nor the Qwen ASR fallback is installed.'
}

$env:STARVIS_ASR_PORT = [string]$Port
$env:STARVIS_ASR_DEVICE = 'auto'

Start-Process -FilePath $python -ArgumentList @($server) `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'starvis-asr-runtime.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'starvis-asr-runtime.err.log')
