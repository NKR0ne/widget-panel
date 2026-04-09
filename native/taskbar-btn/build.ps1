# build.ps1 — builds taskbar-btn.exe using MSVC (via vswhere) or falls back to
# whatever cmake generator is available.
#
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root  = $PSScriptRoot
$build = Join-Path $root "build"

# ── Locate MSBuild / cmake ────────────────────────────────────────────────────
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsPath) {
        $vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
        Write-Host "Using MSVC from: $vsPath"
    }
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Write-Error "cmake not found. Install it from https://cmake.org/download/ and re-run."
    exit 1
}

# ── Configure ─────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force $build | Out-Null

if ($vcvars -and (Test-Path $vcvars)) {
    # Use MSVC via Visual Studio generator
    & cmake -S $root -B $build -A x64 2>&1 | Write-Host
} else {
    # Fall back to default generator (MinGW, Ninja, etc.)
    & cmake -S $root -B $build 2>&1 | Write-Host
}

# ── Build ─────────────────────────────────────────────────────────────────────
& cmake --build $build --config Release 2>&1 | Write-Host

$out = Join-Path $root "..\bin\taskbar-btn.exe"
if (Test-Path $out) {
    Write-Host ""
    Write-Host "Build successful: $out" -ForegroundColor Green
} else {
    Write-Error "Build failed — taskbar-btn.exe not found at expected path."
}
