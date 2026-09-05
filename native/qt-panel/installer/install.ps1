# install.ps1 — dependency-free installer fallback (no Inno Setup needed).
# Copies the deployed build to %LOCALAPPDATA%\WidgetPanel, makes a Start-Menu
# shortcut, and optionally enables autostart. Run build.ps1 -Deploy first.
#
#   powershell -ExecutionPolicy Bypass -File installer\install.ps1 [-Autostart] [-Uninstall]

param(
    [switch]$Autostart,
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

if (-not (Test-Path (Join-Path $src 'qt-panel.exe'))) {
    Write-Error "Deployed build not found at $src. Run: build.ps1 -Deploy"
}

Write-Host "Installing to $dest ..." -ForegroundColor Cyan
Get-Process -Name 'qt-panel' -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $src '*') $dest

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
