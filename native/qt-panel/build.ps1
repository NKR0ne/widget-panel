# build.ps1 - builds qt-panel.exe with VS 18 Build Tools + Qt 6.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1                # release
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Config debug
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Reconfigure   # force CMake
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Deploy -Run
#   powershell -ExecutionPolicy Bypass -File kill-build-processes.ps1  # cleanup only

param(
    [ValidateSet('debug', 'release')]
    [string]$Config = 'release',
    [string]$QtDir = 'C:\Qt\6.10.3\msvc2022_64',
    [ValidateSet('Ninja', 'NMake')]
    [string]$Generator = 'NMake',
    [int]$BuildTimeoutSeconds = 600,
    [switch]$Deploy,
    [switch]$Run,
    [switch]$NoHelper,
    [string]$Profile = '',
    [int]$ExitAfterMs = 0,
    [ValidateSet('auto', 'vulkan', 'd3d11')]
    [string]$Renderer = 'auto',
    [ValidateSet('base', 'news', 'monitor', 'live')]
    [string]$StartMode = 'base',
    [switch]$DiagFitMode,
    [string]$DiagIslandUrl = '',
    [switch]$Tests,
    [switch]$Reconfigure,
    [switch]$SkipKill
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Set-ProcessPath {
    param([Parameter(Mandatory = $true)][string]$Value)
    # The Codex/PowerShell process can inherit both Path and PATH. That breaks
    # Start-Process and Env: enumeration on Windows, so keep one canonical key.
    [System.Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [System.Environment]::SetEnvironmentVariable('Path', $Value, 'Process')
}

function Quote-ProcessArgument {
    param([string]$Value)
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & taskkill.exe /F /T /PID $ProcessId 1>$null 2>$null
        if ($LASTEXITCODE -ne 0) {
            Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
        }
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $PSScriptRoot,
        [int]$TimeoutSeconds = 120,
        [switch]$NoTimeout
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FilePath
    $psi.Arguments = ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' '
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError = $false

    Write-Host ("RUN {0} {1}" -f $FilePath, $psi.Arguments) -ForegroundColor DarkGray
    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    [void]$proc.Start()

    if ($NoTimeout) {
        $proc.WaitForExit()
    } elseif (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
        Write-Warning "Command timed out after $TimeoutSeconds seconds; killing process tree $($proc.Id)."
        Stop-ProcessTree $proc.Id
        Start-Sleep -Milliseconds 250
        throw "Timed out: $FilePath $($psi.Arguments)"
    }

    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) {
        throw "Command failed ($($proc.ExitCode)): $FilePath $($psi.Arguments)"
    }
}

$initialPath = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
if ([string]::IsNullOrEmpty($initialPath)) {
    $initialPath = [System.Environment]::GetEnvironmentVariable('PATH', 'Process')
}
if (-not [string]::IsNullOrEmpty($initialPath)) {
    Set-ProcessPath $initialPath
}

$VS_ROOT   = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools'
$CMAKE     = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$CTEST     = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe"
$NINJA_DIR = "$VS_ROOT\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja"
$VCVARS    = "$VS_ROOT\VC\Auxiliary\Build\vcvars64.bat"
$NMAKE     = Get-ChildItem -Path "$VS_ROOT\VC\Tools\MSVC" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin\Hostx64\x64\nmake.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

foreach ($tool in @($CMAKE, $CTEST, $VCVARS)) {
    if (-not (Test-Path $tool)) { Write-Error "Not found: $tool" }
}
if ($Generator -eq 'Ninja' -and -not (Test-Path "$NINJA_DIR\ninja.exe")) {
    Write-Error "Not found: $NINJA_DIR\ninja.exe"
}
if ($Generator -eq 'NMake' -and ([string]::IsNullOrEmpty($NMAKE) -or -not (Test-Path $NMAKE))) {
    Write-Error "nmake.exe not found below $VS_ROOT\VC\Tools\MSVC"
}
if (-not (Test-Path "$QtDir\lib\cmake\Qt6")) {
    Write-Error "Qt 6 not found at $QtDir (pass -QtDir or install via aqtinstall)"
}

$root      = $PSScriptRoot
$buildName = if ($Generator -eq 'NMake') { "nmake-$Config" } else { $Config }
$build     = Join-Path $root "build\$buildName"
$buildType = if ($Config -eq 'debug') { 'Debug' } else { 'Release' }
$qtPrefix  = $QtDir -replace '\\', '/'

# C++/WinRT projections for the composition backdrop path, generated from the
# winmd committed under native/winappsdk-runtime. Vendored rather than restored
# so a fresh clone builds with no NuGet package and nothing installed -- see
# that folder's README for why the bootstrapper route was not usable here.
$vendorSdk  = Join-Path (Split-Path -Parent $root) 'winappsdk-runtime'
$winrtOut   = Join-Path $build 'winrt-generated'
$cppwinrt   = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\cppwinrt.exe'
if ((Test-Path $vendorSdk) -and
    -not (Test-Path (Join-Path $winrtOut 'winrt\Microsoft.UI.Composition.SystemBackdrops.h'))) {
    if (-not (Test-Path $cppwinrt)) { Write-Error "cppwinrt.exe not found at $cppwinrt" }
    Write-Host 'Generating C++/WinRT projections...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Force $winrtOut | Out-Null
    # `local` is the Windows SDK metadata; without it Microsoft.UI types that
    # reference Windows.* fail to resolve.
    & $cppwinrt -in "$vendorSdk\winmd\uap10.0" `
                -in "$vendorSdk\winmd\uap10.0.18362" `
                -in "$vendorSdk\winmd\uap10.0.17763" `
                -in local -out $winrtOut
    if ($LASTEXITCODE -ne 0) { Write-Error "cppwinrt failed ($LASTEXITCODE)" }
}

if (-not $SkipKill) {
    Write-Host 'Clearing stale qt-panel build processes...' -ForegroundColor Cyan
    & (Join-Path $root 'kill-build-processes.ps1') -Quiet
    if ($LASTEXITCODE -ne 0) { Write-Error 'Could not clear stale build processes' }
}

Write-Host 'Loading MSVC environment...' -ForegroundColor Cyan
$vcvarsEnv = cmd /c "`"$VCVARS`" > nul 2>&1 && set"
if ($LASTEXITCODE -ne 0 -or -not $vcvarsEnv) {
    Write-Error "Failed to load MSVC environment from: $VCVARS"
}
$vcvarsPath = $null
foreach ($line in $vcvarsEnv) {
    if ($line -match '^([^=]+)=(.*)$') {
        if ($Matches[1] -ieq 'PATH') {
            $vcvarsPath = $Matches[2]
        } else {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}
if (-not [string]::IsNullOrEmpty($vcvarsPath)) {
    Set-ProcessPath $vcvarsPath
}
$currentPath = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
if ($Generator -eq 'Ninja') {
    Set-ProcessPath "$NINJA_DIR;$QtDir\bin;$currentPath"
} else {
    Set-ProcessPath "$QtDir\bin;$currentPath"
}

# Wipe a stale cache that still points at a compiler removed by a VS update.
$cacheFile = Join-Path $build 'CMakeCache.txt'
if (Test-Path $cacheFile) {
    $cached = Select-String -Path $cacheFile -Pattern '^CMAKE_CXX_COMPILER:[^=]*=(.+)$' |
        Select-Object -First 1
    if ($cached -and -not (Test-Path $cached.Matches[0].Groups[1].Value)) {
        Write-Host 'Stale CMake cache (old MSVC toolset) - reconfiguring from scratch' -ForegroundColor Yellow
        Remove-Item -Recurse -Force $build
    } else {
        $badSdkTool = Select-String -Path $cacheFile -Pattern '^(CMAKE_MT|CMAKE_RC_COMPILER):[^=]*=.*NOTFOUND$' |
            Select-Object -First 1
        if ($badSdkTool) {
            Write-Host 'Stale CMake cache (missing Windows SDK tool) - reconfiguring from scratch' -ForegroundColor Yellow
            Remove-Item -Recurse -Force $build
        }
    }
}

$generatorName = if ($Generator -eq 'NMake') { 'NMake Makefiles' } else { 'Ninja' }
$testsValue = if ($Tests) { 'ON' } else { 'OFF' }
# Once a build tree has test support, keep it enabled. Flipping this option
# between `-Tests` and `-Deploy` regenerates every Qt QML cache unit.
if (-not $Tests -and (Test-Path $cacheFile)) {
    $cachedTests = Select-String -Path $cacheFile -Pattern '^QTPANEL_BUILD_TESTS:BOOL=(ON|OFF)$' |
        Select-Object -First 1
    if ($cachedTests -and $cachedTests.Matches[0].Groups[1].Value -eq 'ON') {
        $testsValue = 'ON'
    }
}
$rootPrefix = $root -replace '\\', '/'
$requiredCacheValues = @{
    'CMAKE_BUILD_TYPE' = $buildType
    'CMAKE_GENERATOR' = $generatorName
    'CMAKE_HOME_DIRECTORY' = $rootPrefix
    'CMAKE_PREFIX_PATH' = $qtPrefix
    'QTPANEL_BUILD_TESTS' = $testsValue
}
$needsConfigure = $Reconfigure -or -not (Test-Path $cacheFile)
if (-not $needsConfigure) {
    $cacheText = Get-Content -Raw $cacheFile
    foreach ($entry in $requiredCacheValues.GetEnumerator()) {
        $pattern = '(?m)^{0}:[^=]*={1}\r?$' -f [regex]::Escape($entry.Key), [regex]::Escape($entry.Value)
        if ($cacheText -notmatch $pattern) {
            $needsConfigure = $true
            Write-Host "CMake option changed: $($entry.Key)" -ForegroundColor Yellow
            break
        }
    }
}

if ($needsConfigure) {
    Write-Host 'Configuring...' -ForegroundColor Cyan
    $configureArgs = @(
        '-S', $root,
        '-B', $build,
        '-G', $generatorName,
        "-DCMAKE_BUILD_TYPE=$buildType",
        "-DCMAKE_PREFIX_PATH=$qtPrefix",
        "-DQTPANEL_BUILD_TESTS=$testsValue"
    )
    Invoke-NativeCommand -FilePath $CMAKE -Arguments $configureArgs -WorkingDirectory $root -TimeoutSeconds 90
} else {
    Write-Host 'CMake configuration unchanged; reusing the existing build tree.' -ForegroundColor DarkGray
}

$exe = Join-Path $build 'qt-panel.exe'
$appInputPaths = @(
    (Join-Path $root 'src'),
    (Join-Path $root 'qml'),
    (Join-Path $root 'CMakeLists.txt')
)
$latestAppInput = Get-ChildItem -Path $appInputPaths -Recurse -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
$appNeedsBuild = $needsConfigure -or -not (Test-Path $exe) -or
    ($latestAppInput -and $latestAppInput.LastWriteTime -gt (Get-Item $exe).LastWriteTime)

if ($appNeedsBuild) {
    Write-Host 'Building application...' -ForegroundColor Cyan
    if ($Generator -eq 'NMake') {
        Invoke-NativeCommand -FilePath $NMAKE -Arguments @('/nologo') -WorkingDirectory $build -TimeoutSeconds $BuildTimeoutSeconds
    } else {
        Invoke-NativeCommand -FilePath $CMAKE -Arguments @('--build', $build) -WorkingDirectory $root -TimeoutSeconds $BuildTimeoutSeconds
    }
} else {
    Write-Host 'Application inputs unchanged; build is up to date.' -ForegroundColor DarkGray
}

if ($Tests) {
    Write-Host 'Building tests...' -ForegroundColor Cyan
    if ($Generator -eq 'NMake') {
        Invoke-NativeCommand -FilePath $NMAKE -Arguments @('/nologo', 'qt-panel-tests') -WorkingDirectory $build -TimeoutSeconds $BuildTimeoutSeconds
    } else {
        Invoke-NativeCommand -FilePath $CMAKE -Arguments @('--build', $build, '--target', 'qt-panel-tests') -WorkingDirectory $root -TimeoutSeconds $BuildTimeoutSeconds
    }
}

if (-not (Test-Path $exe)) { Write-Error "Build succeeded but exe not at: $exe" }

# A build directory can hold a perfectly good exe with no Qt runtime beside it,
# and nothing says so. That combination fails in ways that do not point at the
# cause: launched directly it reports a missing Qt DLL, and launched with Qt on
# PATH it starts but writes no log and never produces --diag captures. Deploy
# automatically when the runtime is absent; windeployqt is idempotent and only
# costs time the first time.
$runtimeMissing = -not (Test-Path (Join-Path $build 'Qt6Core.dll'))
if ($runtimeMissing -and -not $Deploy) {
    Write-Host 'Qt runtime missing next to the exe - deploying (use -Deploy to silence this).' -ForegroundColor Yellow
}
if ($Deploy -or $runtimeMissing) {
    Write-Host 'Deploying Qt runtime...' -ForegroundColor Cyan
    Invoke-NativeCommand -FilePath "$QtDir\bin\windeployqt.exe" -Arguments @('--qmldir', (Join-Path $root 'qml'), $exe) -WorkingDirectory $root -TimeoutSeconds 120
}

if ($Tests) {
    Write-Host 'Testing...' -ForegroundColor Cyan
    Invoke-NativeCommand -FilePath $CTEST -Arguments @(
        '--test-dir', $build,
        '--output-on-failure',
        '-C', $buildType
    ) -WorkingDirectory $root -TimeoutSeconds 180
}

Write-Host ''
Write-Host "qt-panel.exe ready: $exe" -ForegroundColor Green

if ($Run) {
    $launchArgs = @(
        '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $root 'launch.ps1'),
        '-Config', $Config,
        '-Generator', $Generator,
        '-QtDir', $QtDir,
        '-Renderer', $Renderer,
        '-StartMode', $StartMode
    )
    if ($NoHelper) { $launchArgs += '-NoHelper' }
    if (-not [string]::IsNullOrWhiteSpace($Profile)) {
        $launchArgs += @('-Profile', $Profile)
    }
    if ($ExitAfterMs -gt 0) {
        $launchArgs += @('-ExitAfterMs', $ExitAfterMs)
    }
    if ($DiagFitMode) { $launchArgs += '-DiagFitMode' }
    if (-not [string]::IsNullOrWhiteSpace($DiagIslandUrl)) {
        $launchArgs += @('-DiagIslandUrl', $DiagIslandUrl)
    }
    & powershell.exe @launchArgs
    if ($LASTEXITCODE -ne 0) { Write-Error 'qt-panel launch failed' }
}
