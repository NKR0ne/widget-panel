$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../installer/DeploymentBackup.ps1')
$directory = Join-Path ([System.IO.Path]::GetTempPath()) ('qt-panel-backup-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$installed = Join-Path $directory 'qt-panel.exe'
$incoming = Join-Path $directory 'incoming.exe'
function Assert-Equal($actual, $expected, [string]$message) {
    if ($actual -ne $expected) { throw $message }
}
try {
    [System.IO.File]::WriteAllText($incoming, 'new')
    Save-DeployedExecutable $installed $incoming
    Assert-Equal (Test-Path "$installed.bak") $false 'First install should not invent a backup'
    [System.IO.File]::WriteAllText($installed, 'old')
    Save-DeployedExecutable $installed $incoming
    Assert-Equal ([System.IO.File]::ReadAllText("$installed.bak")) 'old' 'Old executable was not saved'
    Copy-Item -LiteralPath $incoming -Destination $installed -Force
    Save-DeployedExecutable $installed $incoming
    Assert-Equal ([System.IO.File]::ReadAllText("$installed.bak")) 'old' 'Identical reinstall destroyed rollback'
    Restore-DeployedExecutable $installed
    Assert-Equal ([System.IO.File]::ReadAllText($installed)) 'old' 'Restore failed'
    Assert-Equal ([System.IO.File]::ReadAllText("$installed.bak")) 'old' 'Restore consumed backup'
    for ($i = 0; $i -lt 7; $i++) {
        [System.IO.File]::WriteAllText($installed, "build-$i")
        Save-DeployedExecutable $installed $incoming
    }
    Assert-Equal @(Get-ChildItem (Join-Path $directory 'backups') -Filter '*.bak').Count 5 'History is not bounded'
    Assert-Equal ([System.IO.File]::ReadAllText("$installed.bak")) 'build-6' 'Newest rollback was not retained'
    $failed = $false
    try { Save-DeployedExecutable $installed (Join-Path $directory 'missing.exe') } catch { $failed = $true }
    Assert-Equal $failed $true 'Missing source must fail before overwriting backup'
    Assert-Equal ([System.IO.File]::ReadAllText("$installed.bak")) 'build-6' 'Failed backup changed rollback'
    Write-Host 'Deployment backup tests passed.'
} finally {
    $resolved = [System.IO.Path]::GetFullPath($directory)
    $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolved -Leaf) -like 'qt-panel-backup-test-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
