# Installs the pinned FFmpeg runtime used by the direct RTSP-over-TCP camera.
# The binary is downloaded from the Windows build provider linked by ffmpeg.org,
# verified by SHA-256, and kept out of Git under runtime/ffmpeg.

param(
    [string]$Version = '8.1.2',
    [string]$ExpectedSha256 = 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageName = "ffmpeg-$Version-essentials_build.zip"
$downloadUrl = "https://www.gyan.dev/ffmpeg/builds/packages/$packageName"
$runtimeDir = Join-Path $PSScriptRoot 'runtime\ffmpeg'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("qt-panel-ffmpeg-" + [guid]::NewGuid())
$archivePath = Join-Path $temporaryRoot $packageName
$extractPath = Join-Path $temporaryRoot 'extract'

try {
    New-Item -ItemType Directory -Force $temporaryRoot | Out-Null
    Write-Host "Downloading FFmpeg $Version..." -ForegroundColor Cyan
    & curl.exe -L --fail --retry 2 --connect-timeout 15 --max-time 600 `
        -o $archivePath $downloadUrl
    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg download failed with exit code $LASTEXITCODE"
    }

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "FFmpeg archive checksum mismatch. Expected $ExpectedSha256, got $actualHash"
    }

    Write-Host 'Extracting verified FFmpeg runtime...' -ForegroundColor Cyan
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    $ffmpeg = Get-ChildItem -LiteralPath $extractPath -Recurse -Filter ffmpeg.exe |
        Select-Object -First 1
    if (-not $ffmpeg) {
        throw 'The verified archive did not contain ffmpeg.exe'
    }

    New-Item -ItemType Directory -Force $runtimeDir | Out-Null
    Copy-Item -LiteralPath $ffmpeg.FullName -Destination (Join-Path $runtimeDir 'ffmpeg.exe') -Force
    Set-Content -LiteralPath (Join-Path $runtimeDir 'VERSION.txt') `
        -Value "FFmpeg $Version essentials; SHA-256 $actualHash" -Encoding ascii
    Write-Host "FFmpeg installed at $runtimeDir" -ForegroundColor Green
} finally {
    if (Test-Path $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
