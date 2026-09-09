Set-StrictMode -Version Latest

function Copy-VerifiedExecutable {
    param([string]$Source, [string]$Destination)
    $expected = (Get-FileHash -LiteralPath $Source -Algorithm SHA256 -ErrorAction Stop).Hash
    $pending = "$Destination.pending"
    Copy-Item -LiteralPath $Source -Destination $pending -Force -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash -ne $expected) {
        throw "Backup verification failed: $pending"
    }
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        [System.IO.File]::Replace($pending, $Destination, [NullString]::Value)
    } else {
        Move-Item -LiteralPath $pending -Destination $Destination -ErrorAction Stop
    }
}

function Save-DeployedExecutable {
    param([string]$Executable, [string]$IncomingExecutable)
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return }
    $currentHash = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256 -ErrorAction Stop).Hash
    $incomingHash = (Get-FileHash -LiteralPath $IncomingExecutable -Algorithm SHA256 -ErrorAction Stop).Hash
    # Reinstalling the same build must not replace an older rollback point.
    if ($currentHash -eq $incomingHash) { return }

    $directory = Join-Path (Split-Path $Executable -Parent) 'backups'
    New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff')
    $archive = Join-Path $directory "qt-panel-$stamp.exe.bak"
    Copy-VerifiedExecutable -Source $Executable -Destination $archive
    Copy-VerifiedExecutable -Source $archive -Destination "$Executable.bak"

    $history = @(Get-ChildItem -LiteralPath $directory -File |
        Where-Object { $_.Name -match '^qt-panel-\d{8}-\d{6}-\d{7}\.exe\.bak$' } |
        Sort-Object Name -Descending)
    foreach ($old in ($history | Select-Object -Skip 5)) {
        Remove-Item -LiteralPath $old.FullName -Force -ErrorAction Stop
    }
    Write-Host "Previous executable verified and backed up to $Executable.bak" -ForegroundColor DarkGray
}

function Restore-DeployedExecutable {
    param([string]$Executable)
    $backup = "$Executable.bak"
    if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
        throw "No deployed executable backup found at $backup"
    }
    Copy-VerifiedExecutable -Source $backup -Destination $Executable
}
