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
    [string]$DiagIslandUrl = '',
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
$qmlImportPath = [System.Environment]::GetEnvironmentVariable('QML2_IMPORT_PATH', 'Process')
$sdkQmlPath = Join-Path $QtDir 'qml'
if ([string]::IsNullOrEmpty($qmlImportPath)) {
    [System.Environment]::SetEnvironmentVariable('QML2_IMPORT_PATH', $sdkQmlPath, 'Process')
} else {
    [System.Environment]::SetEnvironmentVariable(
        'QML2_IMPORT_PATH', "$sdkQmlPath;$qmlImportPath", 'Process')
}

# WebEngine resolves its sandboxed subprocess relative to the application by
# default, not from PATH. Point undeployed development builds at the Qt SDK;
# windeployqt places the same executable beside deployed builds.
$deployedWebEngineProcess = Join-Path (Split-Path $exe) 'QtWebEngineProcess.exe'
$sdkWebEngineProcess = Join-Path $QtDir 'bin\QtWebEngineProcess.exe'
if (Test-Path $deployedWebEngineProcess) {
    [System.Environment]::SetEnvironmentVariable(
        'QTWEBENGINEPROCESS_PATH', $deployedWebEngineProcess, 'Process')
} elseif (Test-Path $sdkWebEngineProcess) {
    [System.Environment]::SetEnvironmentVariable(
        'QTWEBENGINEPROCESS_PATH', $sdkWebEngineProcess, 'Process')
} else {
    Write-Error "QtWebEngineProcess.exe not found beside the app or below: $QtDir"
}

$deployedResources = Join-Path (Split-Path $exe) 'resources'
$sdkResources = Join-Path $QtDir 'resources'
$webEngineResources = if (Test-Path (Join-Path $deployedResources 'qtwebengine_resources.pak')) {
    $deployedResources
} else {
    $sdkResources
}
[System.Environment]::SetEnvironmentVariable(
    'QTWEBENGINE_RESOURCES_PATH', $webEngineResources, 'Process')

$deployedLocales = Join-Path (Split-Path $exe) 'translations\qtwebengine_locales'
$sdkLocales = Join-Path $QtDir 'translations\qtwebengine_locales'
$webEngineLocales = if (Test-Path $deployedLocales) { $deployedLocales } else { $sdkLocales }
[System.Environment]::SetEnvironmentVariable(
    'QTWEBENGINE_LOCALES_PATH', $webEngineLocales, 'Process')

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
if (-not [string]::IsNullOrWhiteSpace($DiagIslandUrl)) {
    $args += @('--diag-island-url', $DiagIslandUrl)
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

$proc.WaitForExit()
$startupError = ("qt-panel exited during startup with code {0}. Check " +
    "%APPDATA%\qt-panel\qt-panel.log") -f $proc.ExitCode
Write-Error $startupError
