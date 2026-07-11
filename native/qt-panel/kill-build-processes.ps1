# kill-build-processes.ps1 - clears stale qt-panel build processes before Ninja runs.
#
# This is intentionally narrow: it targets the native Qt panel build chain and
# the qt-panel executable that can lock the linker output. Each matched process
# is stopped as a process tree so generated child cmd.exe helpers are cleared too.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File kill-build-processes.ps1

param(
    [switch]$Quiet,
    [switch]$SkipCompilerTools,
    [switch]$IncludeRuntimeHelpers
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$names = @(
    'cmake',
    'ninja',
    'nmake',
    'qt-panel'
)

# The Electron app uses the same helper binaries. Do not terminate them during
# a normal Qt build; opt in only for a standalone Qt runtime reset.
if ($IncludeRuntimeHelpers) {
    $names += @(
        'taskbar-btn',
        'brave-host'
    )
}

if (-not $SkipCompilerTools) {
    $names += @(
        'cl',
        'link',
        'moc',
        'mt',
        'qmlformat',
        'qmlimportscanner',
        'qmlcachegen',
        'qmltyperegistrar',
        'rcc',
        'qsb',
        'rc',
        'uic',
        'windeployqt'
    )
}

$currentPid = $PID
$targets = @()
foreach ($name in $names) {
    $targets += Get-Process -Name $name -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -ne $currentPid }
}

$targets = @($targets | Sort-Object Id -Unique)

if ($targets.Count -eq 0) {
    if (-not $Quiet) {
        Write-Host 'No stale qt-panel build processes found.' -ForegroundColor DarkGray
    }
    exit 0
}

if (-not $Quiet) {
    Write-Host 'Stopping stale qt-panel build processes:' -ForegroundColor Yellow
    $targets | ForEach-Object {
        Write-Host ("  {0} ({1})" -f $_.ProcessName, $_.Id) -ForegroundColor Yellow
    }
}

foreach ($proc in $targets) {
    & taskkill.exe /F /T /PID $proc.Id *> $null
    if ($LASTEXITCODE -ne 0) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 250

$remaining = @()
foreach ($name in $names) {
    $remaining += Get-Process -Name $name -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -ne $currentPid }
}
$remaining = @($remaining | Sort-Object Id -Unique)

if ($remaining.Count -gt 0) {
    Write-Warning 'Some build processes are still alive after Stop-Process:'
    $remaining | ForEach-Object {
        Write-Warning ("  {0} ({1})" -f $_.ProcessName, $_.Id)
    }
    exit 1
}

exit 0
