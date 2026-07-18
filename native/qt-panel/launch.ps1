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
    [switch]$DiagPressReader,
    [string]$DiagIslandUrl = '',
    [int]$StartupCheckSeconds = 4,
    [switch]$Startup,
    [ValidateRange(0, 60)]
    [int]$StartupDelaySeconds = 8,
    [ValidateRange(1, 5)]
    [int]$StartupAttempts = 3,
    [ValidateRange(0, 30)]
    [int]$StartupRetryDelaySeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$buildName = if ($Generator -eq 'NMake') { "nmake-$Config" } else { $Config }
$exe = Join-Path $root "build\$buildName\qt-panel.exe"

function Write-StartupEvent {
    param([string]$Message)
    if (-not $Startup) {
        return
    }
    try {
        $dataDir = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'qt-panel'
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fff'), $Message
        Add-Content -LiteralPath (Join-Path $dataDir 'startup-launch.log') -Value $line
    } catch {
        # Startup diagnostics must never prevent the panel from launching.
    }
}

if (-not (Test-Path $exe)) {
    Write-StartupEvent "Executable missing: $exe"
    Write-Error "qt-panel.exe not found at: $exe"
}

if ($Startup) {
    Write-StartupEvent "Login bootstrap started for $exe"
    $explorerDeadline = (Get-Date).AddSeconds(30)
    $explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue |
        Select-Object -First 1
    while ($null -eq $explorer -and (Get-Date) -lt $explorerDeadline) {
        Start-Sleep -Seconds 1
        $explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }
    if ($StartupDelaySeconds -gt 0) {
        Start-Sleep -Seconds $StartupDelaySeconds
    }
    $StartupCheckSeconds = [Math]::Max($StartupCheckSeconds, 8)

    $existing = Get-Process -Name qt-panel -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $exe } |
        Select-Object -First 1
    if ($null -ne $existing) {
        Write-StartupEvent "Panel already running; pid=$($existing.Id)"
        exit 0
    }
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
if ($DiagPressReader) {
    $args += '--diag-pressreader'
}
if (-not [string]::IsNullOrWhiteSpace($DiagIslandUrl)) {
    $args += @('--diag-island-url', $DiagIslandUrl)
}

$attemptLimit = if ($Startup) { $StartupAttempts } else { 1 }
for ($attempt = 1; $attempt -le $attemptLimit; $attempt++) {
    Write-StartupEvent "Launch attempt $attempt of $attemptLimit"
    try {
        if ($args.Count -gt 0) {
            $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList $args -PassThru -WindowStyle Hidden
        } else {
            $proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru -WindowStyle Hidden
        }
    } catch {
        Write-StartupEvent "Launch attempt $attempt failed: $($_.Exception.Message)"
        if ($attempt -eq $attemptLimit) {
            throw
        }
        Start-Sleep -Seconds $StartupRetryDelaySeconds
        continue
    }

    Start-Sleep -Seconds $StartupCheckSeconds
    Write-Host ("STARTED_PID={0}" -f $proc.Id)
    $live = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($live) {
        Write-StartupEvent "Launch stable after check; pid=$($proc.Id)"
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
    Write-StartupEvent "Launch attempt $attempt exited early with code $($proc.ExitCode)"
    if ($attempt -lt $attemptLimit) {
        Start-Sleep -Seconds $StartupRetryDelaySeconds
        continue
    }

    $startupError = ("qt-panel exited during startup with code {0}. Check " +
        "%APPDATA%\qt-panel\qt-panel.log") -f $proc.ExitCode
    Write-Error $startupError
}
