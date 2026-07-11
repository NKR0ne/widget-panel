# Launches qt-panel.exe detached with the Qt runtime on PATH, then reports liveness.

param(
    [ValidateSet('debug', 'release')]
    [string]$Config = 'release',
    [ValidateSet('Ninja', 'NMake')]
    [string]$Generator = 'NMake',
    [string]$QtDir = 'C:\Qt\6.10.3\msvc2022_64',
    [switch]$NoHelper,
    [string]$Profile = '',
    [int]$ExitAfterMs = 0,
    [ValidateSet('auto', 'vulkan', 'd3d11')]
    [string]$Renderer = 'auto',
    [ValidateSet('base', 'news', 'monitor', 'live')]
    [string]$StartMode = 'base',
    [switch]$DiagFitMode,
    [int]$StartupCheckSeconds = 4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$buildName = if ($Generator -eq 'NMake') { "nmake-$Config" } else { $Config }
$exe = Join-Path $root "build\$buildName\qt-panel.exe"

if (-not (Test-Path $exe)) {
    Write-Error "qt-panel.exe not found at: $exe"
}

$pathValue = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
if ([string]::IsNullOrEmpty($pathValue)) {
    $pathValue = [System.Environment]::GetEnvironmentVariable('PATH', 'Process')
}
[System.Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[System.Environment]::SetEnvironmentVariable('Path', "$QtDir\bin;$pathValue", 'Process')

$args = @()
if ($NoHelper) {
    $args += '--no-helper'
}
if (-not [string]::IsNullOrWhiteSpace($Profile)) {
    $args += @('--profile', $Profile)
}
if ($ExitAfterMs -gt 0) {
    $args += @('--exit-after-ms', $ExitAfterMs)
}
$args += @('--renderer', $Renderer)
$args += @('--start-mode', $StartMode)
if ($DiagFitMode) {
    $args += '--diag-fitmode'
}

if ($args.Count -gt 0) {
    $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList $args -PassThru -WindowStyle Hidden
} else {
    $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru -WindowStyle Hidden
}
Start-Sleep -Seconds $StartupCheckSeconds

Write-Host ("STARTED_PID={0}" -f $proc.Id)
$live = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($live) {
    $live | Select-Object ProcessName,Id,Responding,CPU,StartTime,Path
    if ($ExitAfterMs -gt 0) {
        $boundedWaitMs = $ExitAfterMs + 10000
        if (-not $proc.WaitForExit($boundedWaitMs)) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Write-Error "qt-panel did not exit within the bounded smoke deadline"
        }
        Write-Host ("EXIT_CODE={0}" -f $proc.ExitCode)
        if ($proc.ExitCode -ne 0) {
            Write-Error "qt-panel bounded run failed with exit code $($proc.ExitCode)"
        }
    }
    exit 0
}

Write-Error "qt-panel exited during startup. Check %APPDATA%\qt-panel\qt-panel.log"
