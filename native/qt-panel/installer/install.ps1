# install.ps1 — dependency-free installer fallback (no Inno Setup needed).
# Copies the deployed build to %LOCALAPPDATA%\WidgetPanel, makes a Start-Menu
# shortcut, and optionally enables autostart. Run build.ps1 -Deploy first.
#
#   powershell -ExecutionPolicy Bypass -File installer\install.ps1 [-Autostart] [-Uninstall]
#   powershell -ExecutionPolicy Bypass -File installer\install.ps1 -RestoreBackup

param(
    [switch]$Autostart,
    [switch]$Uninstall,
    [switch]$RestoreBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DeploymentBackup.ps1')
if ($RestoreBackup -and $Uninstall) { throw 'Choose either -RestoreBackup or -Uninstall.' }

$root    = Split-Path $PSScriptRoot -Parent
$releaseSrc = Join-Path $root 'build\release'
$legacySrc  = Join-Path $root 'build\nmake-release'
$src     = if (Test-Path (Join-Path $releaseSrc 'qt-panel.exe')) {
    $releaseSrc
} else {
    $legacySrc
}
$dest    = Join-Path $env:LOCALAPPDATA 'WidgetPanel'
$exe     = Join-Path $dest 'qt-panel.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Widget Panel.lnk'
$runKey  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

if ($Uninstall) {
    Get-Process -Name 'qt-panel' -ErrorAction SilentlyContinue | Stop-Process -Force
    if (Test-Path $dest)      { Remove-Item -Recurse -Force $dest }
    if (Test-Path $startMenu) { Remove-Item -Force $startMenu }
    Remove-ItemProperty -Path $runKey -Name 'qt-panel' -ErrorAction SilentlyContinue
    Write-Host 'Widget Panel uninstalled.' -ForegroundColor Green
    return
}

if ($RestoreBackup) {
    if (-not (Test-Path -LiteralPath "$exe.bak" -PathType Leaf)) {
        throw "No deployed executable backup found at $exe.bak"
    }
    Get-Process -Name 'qt-panel' -ErrorAction SilentlyContinue | Stop-Process -Force
    Restore-DeployedExecutable -Executable $exe
    Write-Host "Executable restored. Launch: $exe" -ForegroundColor Green
    return
}

if (-not (Test-Path (Join-Path $src 'qt-panel.exe'))) {
    Write-Error "Deployed build not found at $src. Run: build.ps1 -Deploy"
}

Write-Host "Installing to $dest ..." -ForegroundColor Cyan
# Abort before stopping the application if its rollback copy cannot be saved.
Save-DeployedExecutable -Executable $exe -IncomingExecutable (Join-Path $src 'qt-panel.exe')
Get-Process -Name 'qt-panel' -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Force $dest | Out-Null
# Development diagnostics are not part of the installed application.
$testArtifacts = @('qt-panel-tests.exe', 'qt-panel-tests.pdb', 'Qt6Test.dll', 'Qt6Testd.dll')
Get-ChildItem -LiteralPath $src |
    Where-Object { $_.Name -notin ($testArtifacts + @('tests', 'Testing', 'backups')) -and
                  $_.Name -notlike '*.bak' -and $_.Name -notlike '*.pending' } |
    Copy-Item -Recurse -Force -Destination $dest
foreach ($name in $testArtifacts) {
    $oldArtifact = Join-Path $dest $name
    if (Test-Path -LiteralPath $oldArtifact -PathType Leaf) {
        Remove-Item -LiteralPath $oldArtifact -Force
    }
}

# Runtime control is resolved relative to the installed executable. Keep the
# lightweight Starvis launchers beside deployed builds so login startup can
# reconcile local reasoning, vision, ASR, and TTS without the source tree.
$scriptsSource = Join-Path $root 'scripts'
$scriptsDestination = Join-Path $dest 'scripts'
New-Item -ItemType Directory -Force $scriptsDestination | Out-Null
Get-ChildItem -LiteralPath $scriptsSource -File |
    Where-Object { $_.Extension -in @('.ps1', '.py') } |
    Copy-Item -Destination $scriptsDestination -Force

# Start-Menu shortcut.
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($startMenu)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.Description = 'Widget Panel'
$lnk.Save()

if ($Autostart) {
    Set-ItemProperty -Path $runKey -Name 'qt-panel' -Value "`"$exe`""
    Write-Host 'Autostart enabled.' -ForegroundColor Green
}

Write-Host "Installed. Launch: $exe" -ForegroundColor Green
