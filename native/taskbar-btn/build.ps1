# build.ps1  —  builds taskbar-btn.exe using VS 2025 Build Tools (folder 18)
# Uses the Ninja generator so it is not tied to a specific VS version string.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$VS_ROOT = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools'
$CMAKE   = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$NINJA   = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
$VCVARS  = "$VS_ROOT\VC\Auxiliary\Build\vcvars64.bat"

foreach ($tool in @($CMAKE, $NINJA, $VCVARS)) {
    if (-not (Test-Path $tool)) { Write-Error "Not found: $tool"; exit 1 }
}

$root  = $PSScriptRoot
$build = Join-Path $root 'build'
$bin   = Join-Path $root '..\bin'

New-Item -ItemType Directory -Force $build | Out-Null
New-Item -ItemType Directory -Force $bin   | Out-Null

# ── Load MSVC environment from vcvars64.bat ───────────────────────────────────
Write-Host 'Loading MSVC environment...' -ForegroundColor Cyan
$vcvarsEnv = cmd /c "`"$VCVARS`" > nul 2>&1 && set"
foreach ($line in $vcvarsEnv) {
    if ($line -match '^([^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}

# Add Ninja to PATH for this session
$env:PATH = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;" + $env:PATH

# ── CMake configure (Ninja — no VS generator version dependency) ──────────────
Write-Host 'Configuring...' -ForegroundColor Cyan
& $CMAKE -S $root -B $build `
    -G Ninja `
    -DCMAKE_BUILD_TYPE=Release `
    -DCMAKE_C_COMPILER="$VS_ROOT\VC\Tools\MSVC\14.50.35717\bin\Hostx64\x64\cl.exe" `
    -DCMAKE_CXX_COMPILER="$VS_ROOT\VC\Tools\MSVC\14.50.35717\bin\Hostx64\x64\cl.exe"

if ($LASTEXITCODE -ne 0) { Write-Error 'CMake configure failed'; exit 1 }

# ── Build ─────────────────────────────────────────────────────────────────────
Write-Host 'Building...' -ForegroundColor Cyan
& $CMAKE --build $build --config Release

if ($LASTEXITCODE -ne 0) { Write-Error 'Build failed'; exit 1 }

$out = Join-Path $bin 'taskbar-btn.exe'
if (Test-Path $out) {
    Write-Host ''
    Write-Host "taskbar-btn.exe ready: $out" -ForegroundColor Green
} else {
    Write-Error "Build succeeded but exe not at: $out"
}
