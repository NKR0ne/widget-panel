param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('enable', 'disable')]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptsRoot = $PSScriptRoot
$lms = 'C:\Users\nicol\.lmstudio\bin\lms.exe'
$reasoningPort = 1234
$speechPort = 1235

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

function Stop-StarvisSpeechRuntime {
    $process = Get-ListeningProcess -Port $speechPort
    if ($null -eq $process) {
        return
    }
    $command = [string]$process.CommandLine
    if ($process.Name -notmatch '^python(?:w)?\.exe$' `
            -or $command -notlike '*starvis-voice-runtime.py*') {
        throw "Port $speechPort is owned by a process that is not the Starvis speech runtime."
    }
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

function Stop-StarvisFallbackRuntime {
    $process = Get-ListeningProcess -Port $reasoningPort
    if ($null -eq $process) {
        return
    }
    $command = [string]$process.CommandLine
    if ($process.Name -match '^llama-server\.exe$' `
            -and ($command -like '*starvis-local*' `
                  -or $command -like '*Qwen3VL-8B-Instruct*')) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    }
}

function Wait-StarvisSpeechRuntime {
    $deadline = (Get-Date).AddSeconds(35)
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$speechPort/health" `
                -TimeoutSec 2
            if ($health.status -eq 'ok') {
                return
            }
        } catch { }
        Start-Sleep -Milliseconds 750
    }
    throw 'Starvis speech runtime did not become healthy within 35 seconds.'
}

if ($Action -eq 'enable') {
    & (Join-Path $scriptsRoot 'start-starvis-runtime.ps1')
    & (Join-Path $scriptsRoot 'start-starvis-voice-runtime.ps1')
    Wait-StarvisSpeechRuntime
    Write-Output 'Starvis local reasoning and speech runtimes started.'
    exit 0
}

Stop-StarvisSpeechRuntime

if (Test-Path -LiteralPath $lms) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $lms unload 'starvis-local' 2>$null
    $unloadExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($unloadExitCode -ne 0) {
        Write-Verbose 'LM Studio did not have a loaded starvis-local model.'
    }
}

# LM Studio owns its shared server, so only unload our model there. The
# dedicated llama.cpp fallback can be terminated when it owns the port.
Stop-StarvisFallbackRuntime
Write-Output 'Starvis local models stopped; GPU memory released.'
