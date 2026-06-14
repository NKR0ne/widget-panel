# Launches qt-panel.exe detached with the Qt runtime on PATH, then reports liveness.

param(
    [ValidateSet('debug', 'release')]
    [string]$Config = 'release',
    [ValidateSet('Ninja', 'NMake')]
    [string]$Generator = 'NMake',
    [string]$QtDir = 'C:\Qt\6.10.3\msvc2022_64',
    [switch]$NoHelper
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

if ($args.Count -gt 0) {
    $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList $args -PassThru -WindowStyle Hidden
} else {
    $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru -WindowStyle Hidden
}
Start-Sleep -Seconds 4

Write-Host ("STARTED_PID={0}" -f $proc.Id)
$live = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($live) {
    $live | Select-Object ProcessName,Id,Responding,CPU,StartTime,Path
    exit 0
}

Write-Error "qt-panel exited during startup. Check %APPDATA%\qt-panel\qt-panel.log"
