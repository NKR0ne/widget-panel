Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$VS_ROOT = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools'
$CMAKE   = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$NINJA   = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
$VCVARS  = "$VS_ROOT\VC\Auxiliary\Build\vcvars64.bat"

# Auto-detect the newest MSVC toolset — VS updates change this directory name.
$MSVC_DIR = Get-ChildItem "$VS_ROOT\VC\Tools\MSVC" -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $MSVC_DIR) { Write-Error "No MSVC toolset under $VS_ROOT\VC\Tools\MSVC"; exit 1 }
$CL = Join-Path $MSVC_DIR.FullName 'bin\Hostx64\x64\cl.exe'

foreach ($tool in @($CMAKE, $NINJA, $VCVARS, $CL)) {
    if (-not (Test-Path $tool)) { Write-Error "Not found: $tool"; exit 1 }
}

$root  = $PSScriptRoot
$build = Join-Path $root 'build'
$bin   = Join-Path $root '..\bin'

New-Item -ItemType Directory -Force $build | Out-Null
New-Item -ItemType Directory -Force $bin   | Out-Null

# Wipe a stale cache that still points at a compiler removed by a VS update.
$cacheFile = Join-Path $build 'CMakeCache.txt'
if (Test-Path $cacheFile) {
    $cached = Select-String -Path $cacheFile -Pattern '^CMAKE_CXX_COMPILER:[^=]*=(.+)$' |
        Select-Object -First 1
    if ($cached -and -not (Test-Path $cached.Matches[0].Groups[1].Value)) {
        Write-Host 'Stale CMake cache (old MSVC toolset) - reconfiguring from scratch' -ForegroundColor Yellow
        Remove-Item -Recurse -Force $build
        New-Item -ItemType Directory -Force $build | Out-Null
    }
}

Write-Host 'Loading MSVC environment...' -ForegroundColor Cyan
$vcvarsEnv = cmd /c "`"$VCVARS`" > nul 2>&1 && set"
foreach ($line in $vcvarsEnv) {
    if ($line -match '^([^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$env:PATH = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;" + $env:PATH

Write-Host 'Configuring...' -ForegroundColor Cyan
& $CMAKE -S $root -B $build `
    -G Ninja `
    -DCMAKE_BUILD_TYPE=Release `
    -DCMAKE_C_COMPILER="$CL" `
    -DCMAKE_CXX_COMPILER="$CL"

if ($LASTEXITCODE -ne 0) { Write-Error 'CMake configure failed'; exit 1 }

Write-Host 'Building...' -ForegroundColor Cyan
& $CMAKE --build $build --config Release

if ($LASTEXITCODE -ne 0) { Write-Error 'Build failed'; exit 1 }

$out = Join-Path $bin 'brave-host.exe'
if (Test-Path $out) {
    Write-Host ''
    Write-Host "brave-host.exe ready: $out" -ForegroundColor Green
} else {
    Write-Error "Build succeeded but exe not at: $out"
}
