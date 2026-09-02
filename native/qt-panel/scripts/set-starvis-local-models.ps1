param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('enable', 'disable')]
    [string]$Action,

    [Parameter(Position = 1)]
    [ValidateSet('all', 'hybrid')]
    [string]$Profile = 'all'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptsRoot = $PSScriptRoot
$lms = 'C:\Users\nicol\.lmstudio\bin\lms.exe'
$reasoningPort = 1234
$asrPort = 1235
$visionPort = 1236
$ttsPort = 1237

function Get-ListeningProcess {
    param([int]$Port)
    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $Port `
            -ErrorAction Stop | Select-Object -First 1
        if ($null -ne $connection) {
            return Get-CimInstance Win32_Process -Filter `
                ("ProcessId = {0}" -f $connection.OwningProcess) -ErrorAction Stop
        }
    } catch { }
    return $null
}

function Stop-StarvisPythonRuntime {
    param([int]$Port, [string[]]$ScriptNames)
    $process = Get-ListeningProcess -Port $Port
    if ($null -eq $process) {
        return
    }
    $command = [string]$process.CommandLine
    $legacyAsr = $Port -eq $asrPort -and $command -like '*starvis-voice-runtime.py*'
    $expectedScript = $false
    foreach ($scriptName in $ScriptNames) {
        $expectedScript = $expectedScript -or $command -like "*$scriptName*"
    }
    if ($process.Name -notmatch '^python(?:w)?\.exe$' `
            -or (!$expectedScript -and !$legacyAsr)) {
        throw "Port $Port is owned by a process that is not the expected Starvis runtime."
    }
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

function Stop-StarvisAsrRuntime {
    $process = Get-ListeningProcess -Port $asrPort
    if ($null -eq $process) {
        return
    }
    $command = [string]$process.CommandLine
    $pythonRuntime = $process.Name -match '^python(?:w)?\.exe$' `
        -and ($command -like '*starvis-asr-runtime.py*' `
             -or $command -like '*starvis-voice-runtime.py*')
    $nemoRuntime = $process.Name -eq 'nemo-speech.exe' `
        -and $command -like '*serve*' `
        -and $command -like '*parakeet-tdt-0.6b-v3*'
    if (!$pythonRuntime -and !$nemoRuntime) {
        throw "Port $asrPort is not owned by an expected Starvis ASR runtime."
    }
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

function Stop-StarvisLlamaRuntime {
    param([int]$Port, [string]$Alias, [switch]$IgnoreUnexpectedOwner)
    $process = Get-ListeningProcess -Port $Port
    if ($null -eq $process) {
        return
    }
    $command = [string]$process.CommandLine
    if ($process.Name -match '^llama-server\.exe$' `
            -and $command -like "*$Alias*") {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } elseif ($null -ne $process) {
        if ($IgnoreUnexpectedOwner) {
            return
        }
        throw "Port $Port is not owned by the expected Starvis llama runtime."
    }
}

function Wait-StarvisHealth {
    param([int]$Port, [string]$Capability)
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($Capability -eq 'asrReady') {
            try {
                $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/ready" `
                    -TimeoutSec 2
                if ($ready.ready -eq $true `
                        -or $ready.status -in @('ok', 'ready')) {
                    return
                }
            } catch { }
        }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" `
                -TimeoutSec 2
            if ($health.status -eq 'ok' -and $health.$Capability) {
                return
            }
        } catch { }
        Start-Sleep -Milliseconds 750
    }
    throw "Starvis $Capability runtime did not become healthy within 60 seconds."
}

if ($Action -eq 'enable') {
    if ($Profile -eq 'all') {
        & (Join-Path $scriptsRoot 'start-starvis-runtime.ps1')
        & (Join-Path $scriptsRoot 'start-starvis-voice-runtime.ps1')
        Wait-StarvisHealth -Port $asrPort -Capability 'asrReady'
    } else {
        Stop-StarvisAsrRuntime
        if (Test-Path -LiteralPath $lms) {
            $previousErrorAction = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & $lms unload 'starvis-local' 2>$null
            $ErrorActionPreference = $previousErrorAction
        }
        Stop-StarvisLlamaRuntime -Port $reasoningPort -Alias 'starvis-local' `
            -IgnoreUnexpectedOwner
    }
    & (Join-Path $scriptsRoot 'start-starvis-vision-runtime.ps1')
    & (Join-Path $scriptsRoot 'start-starvis-tts-runtime.ps1')
    Wait-StarvisHealth -Port $ttsPort -Capability 'ttsReady'
    Write-Output $(if ($Profile -eq 'all') {
        'Starvis reasoning, vision, ASR, and TTS runtimes started.'
    } else {
        'Starvis hybrid runtime started: local vision and TTS; reasoning and ASR released.'
    })
    exit 0
}

Stop-StarvisAsrRuntime
Stop-StarvisPythonRuntime -Port $ttsPort -ScriptNames @(
    'starvis-fast-tts-runtime.py',
    'starvis-chatterbox-tts-runtime.py'
)
if (Test-Path -LiteralPath $lms) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # The LM Studio server is user-managed; release only the Starvis model.
    & $lms unload 'starvis-local' 2>$null
    $ErrorActionPreference = $previousErrorAction
}
Stop-StarvisLlamaRuntime -Port $reasoningPort -Alias 'starvis-local' `
    -IgnoreUnexpectedOwner
Stop-StarvisLlamaRuntime -Port $visionPort -Alias 'starvis-vision'
Write-Output 'Starvis local models stopped; GPU memory released.'
