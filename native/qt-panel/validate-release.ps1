# Runs the release build and bounded windowed/composition validation matrix.

param(
    [ValidateRange(30, 1800)]
    [int]$BuildTimeoutSeconds = 240,
    [ValidateRange(1, 15)]
    [int]$StartupCheckSeconds = 3,
    [switch]$SkipBuild,
    [switch]$RelaunchDefault,
    [switch]$WindowedDefault
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$powershell = Join-Path $PSHOME 'powershell.exe'

function Invoke-CheckedScript {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @()
    )

    & $powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$([IO.Path]::GetFileName($Script)) failed with exit code $LASTEXITCODE"
    }
}

$killScript = Join-Path $root 'kill-build-processes.ps1'
$buildScript = Join-Path $root 'build.ps1'
$launchScript = Join-Path $root 'launch.ps1'

Invoke-CheckedScript -Script $killScript

try {
    if (-not $SkipBuild) {
        Invoke-CheckedScript -Script $buildScript -Arguments @(
            '-Config', 'release',
            '-Generator', 'NMake',
            '-BuildTimeoutSeconds', "$BuildTimeoutSeconds",
            '-Tests',
            '-SkipKill'
        )
    }

    $cases = @(
        [pscustomobject]@{
            Name = 'windowed-base'
            HostArgs = @('-NoComposition')
            Mode = 'base'
            ExitAfterMs = 12500
            PressReader = $false
        },
        [pscustomobject]@{
            Name = 'windowed-monitor'
            HostArgs = @('-NoComposition')
            Mode = 'monitor'
            ExitAfterMs = 7500
            PressReader = $false
        },
        [pscustomobject]@{
            Name = 'windowed-live'
            HostArgs = @('-NoComposition')
            Mode = 'live'
            ExitAfterMs = 13500
            PressReader = $false
        },
        [pscustomobject]@{
            Name = 'windowed-news-web'
            HostArgs = @('-NoComposition')
            Mode = 'news'
            ExitAfterMs = 10500
            PressReader = $true
        },
        [pscustomobject]@{
            Name = 'composition-base'
            HostArgs = @('-Composition')
            Mode = 'base'
            ExitAfterMs = 12500
            PressReader = $false
        },
        [pscustomobject]@{
            Name = 'composition-monitor'
            HostArgs = @('-Composition')
            Mode = 'monitor'
            ExitAfterMs = 7500
            PressReader = $false
        },
        [pscustomobject]@{
            Name = 'composition-live'
            HostArgs = @('-Composition')
            Mode = 'live'
            ExitAfterMs = 13500
            PressReader = $false
        },
        [pscustomobject]@{
            Name = 'composition-news-web'
            HostArgs = @('-Composition')
            Mode = 'news'
            ExitAfterMs = 10500
            PressReader = $true
        }
    )

    foreach ($case in $cases) {
        Write-Host ("=== VALIDATE {0} ===" -f $case.Name)
        $arguments = @(
            '-Config', 'release',
            '-Generator', 'NMake',
            '-NoHelper',
            '-Profile', "matrix-$($case.Name)",
            '-StartMode', $case.Mode,
            '-DiagFitMode',
            '-ExitAfterMs', "$($case.ExitAfterMs)",
            '-StartupCheckSeconds', "$StartupCheckSeconds"
        ) + $case.HostArgs
        if ($case.PressReader) {
            $arguments += '-DiagPressReader'
        }
        Invoke-CheckedScript -Script $launchScript -Arguments $arguments
        Write-Host ("PASS {0}" -f $case.Name)
    }
} finally {
    # A failed diagnostic must not leave Qt, WebEngine, or compiler processes
    # alive to interfere with the next build.
    Invoke-CheckedScript -Script $killScript
}

if ($RelaunchDefault) {
    $hostArgument = if ($WindowedDefault) { '-NoComposition' } else { '-Composition' }
    Invoke-CheckedScript -Script $launchScript -Arguments @(
        '-Config', 'release',
        '-Generator', 'NMake',
        $hostArgument,
        '-StartMode', 'base',
        '-StartupCheckSeconds', '5'
    )
}

Write-Host 'Release validation matrix passed.'
