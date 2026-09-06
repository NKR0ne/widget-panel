param(
    [Parameter(Mandatory = $true)][string]$Runner,
    [Parameter(Mandatory = $true)][string]$InputDir
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $InputDir 'results.txt'
$env:QT_QUICK_BACKEND = 'software'
$fonts = Join-Path $InputDir 'fonts'
New-Item -ItemType Directory -Path $fonts -Force | Out-Null
foreach ($font in @('segoeui.ttf', 'segoeuib.ttf', 'SegoeIcons.ttf')) {
    $source = Join-Path "$env:WINDIR/Fonts" $font
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $fonts -Force }
}
$env:QT_QPA_FONTDIR = $fonts
# qmltestrunner is a GUI executable on Windows; capture its explicit QtTest log.
$arguments = '-input "{0}" -import "{0}" -platform offscreen -o "{1},txt"' -f $InputDir, $log
$process = Start-Process -FilePath $Runner -ArgumentList $arguments -WorkingDirectory $InputDir -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(30000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'News reading QML tests exceeded 30 seconds.'
}
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log }
exit $process.ExitCode
