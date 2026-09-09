param([Parameter(Mandatory = $true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$Executable = (Resolve-Path -LiteralPath $Executable).Path
foreach ($hostMode in @('windowed', 'composition')) {
    $profile = 'radio-startup-' + $hostMode + '-' + [guid]::NewGuid().ToString('N')
    $directory = Join-Path $env:APPDATA "qt-panel/profiles/$profile"
    New-Item -ItemType Directory -Path $directory | Out-Null
    $station = @{id='test';name='Radio startup test';url='https://radio.invalid/test';frequency='98.1 FM';codec='MP3'}
    $config = @{categories=@();activeIds=@('radio');modeActiveIds=@{base=@('radio')};columns=@{radio='left'}}
    $settings = @{
        'wp-config'=($config | ConvertTo-Json -Depth 10 -Compress)
        'wp-radio-cache'=(ConvertTo-Json -InputObject @($station) -Compress)
        'wp-radio-height'=500
        'wp-radio-favorites'=(ConvertTo-Json -InputObject @($station) -Compress)
        'wp-radio-favorites-mode'=$true
        'wp-pinned'=$true
        'wp-base-columns'=3
        'wp-starvis-local-models-enabled'=$false
    }
    [System.IO.File]::WriteAllText((Join-Path $directory 'settings.json'),
        ($settings | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
    $modeFlag = if ($hostMode -eq 'composition') { '--composition' } else { '--no-composition' }
    $process = Start-Process -FilePath $Executable -WorkingDirectory (Split-Path $Executable) -WindowStyle Hidden -PassThru `
        -ArgumentList @('--profile', $profile, '--no-helper', $modeFlag, '--exit-after-ms', '5000')
    if (-not $process.WaitForExit(20000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$hostMode startup exceeded 20 seconds. Logs: $directory"
    }
    $log = [System.IO.File]::ReadAllText((Join-Path $directory 'qt-panel.log'))
    if ($process.ExitCode -ne 0 -or $log -notmatch '\[startup\] ready' -or
        $log -notmatch '\[startup\] exiting cleanly' -or
        $log -match '(TypeError|ReferenceError|Cannot assign|failed to load component)') {
        throw "$hostMode startup failed (exit $($process.ExitCode)). Logs: $directory"
    }
    Write-Host "$hostMode radio startup passed. Logs: $directory"
}
