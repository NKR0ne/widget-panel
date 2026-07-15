# build.ps1 - builds qt-panel.exe with VS 18 Build Tools + Qt 6.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1                # release
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Config debug
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Tests
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Deploy -Run
#   powershell -ExecutionPolicy Bypass -File kill-build-processes.ps1  # cleanup only

param(
    [ValidateSet('debug', 'release')]
    [string]$Config = 'release',
    [string]$QtDir = 'C:\Qt\6.10.3\msvc2022_64',
    [ValidateSet('Ninja', 'NMake')]
    [string]$Generator = 'Ninja',
    [int]$BuildTimeoutSeconds = 180,
    [switch]$Tests,
    [switch]$Deploy,
    [switch]$Run,
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

Write-Host 'Configuring...' -ForegroundColor Cyan
$generatorName = if ($Generator -eq 'NMake') { 'NMake Makefiles' } else { 'Ninja' }
Invoke-NativeCommand -FilePath $CMAKE -Arguments @(
    '-S', $root,
    '-B', $build,
    '-G', $generatorName,
    "-DCMAKE_BUILD_TYPE=$buildType",
    "-DCMAKE_PREFIX_PATH=$qtPrefix",
    "-DQTPANEL_BUILD_TESTS=$(if ($Tests) { 'ON' } else { 'OFF' })"
) -WorkingDirectory $root -TimeoutSeconds 90

Write-Host 'Building...' -ForegroundColor Cyan
if ($Generator -eq 'NMake') {
    Invoke-NativeCommand -FilePath $NMAKE -Arguments @('/nologo') -WorkingDirectory $build -TimeoutSeconds $BuildTimeoutSeconds
} else {
    Invoke-NativeCommand -FilePath $CMAKE -Arguments @('--build', $build) -WorkingDirectory $root -TimeoutSeconds $BuildTimeoutSeconds
}

$exe = Join-Path $build 'qt-panel.exe'
if (-not (Test-Path $exe)) { Write-Error "Build succeeded but exe not at: $exe" }

if ($Tests) {
    Write-Host 'Testing...' -ForegroundColor Cyan
    Invoke-NativeCommand -FilePath $CTEST -Arguments @(
        '--test-dir', $build,
        '--output-on-failure'
    ) -WorkingDirectory $root -TimeoutSeconds 90
}

if ($Deploy) {
    Write-Host 'Deploying Qt runtime...' -ForegroundColor Cyan
    Invoke-NativeCommand -FilePath "$QtDir\bin\windeployqt.exe" -Arguments @('--qmldir', (Join-Path $root 'qml'), $exe) -WorkingDirectory $root -TimeoutSeconds 120
}

Write-Host ''
Write-Host "qt-panel.exe ready: $exe" -ForegroundColor Green

if ($Run) { & $exe }
