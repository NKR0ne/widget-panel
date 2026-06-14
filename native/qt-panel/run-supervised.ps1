# Runs one native build command with a hard timeout and process-tree cleanup.

param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$ArgumentLine = '',
    [string]$WorkingDirectory = $PSScriptRoot,
    [int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pathValue = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
if ([string]::IsNullOrEmpty($pathValue)) {
    $pathValue = [System.Environment]::GetEnvironmentVariable('PATH', 'Process')
}
if (-not [string]::IsNullOrEmpty($pathValue)) {
    [System.Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [System.Environment]::SetEnvironmentVariable('Path', $pathValue, 'Process')
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $FilePath
$psi.WorkingDirectory = $WorkingDirectory
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $false
$psi.RedirectStandardError = $false
function Quote-ProcessArgument {
    param([string]$Value)
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}
if (-not [string]::IsNullOrWhiteSpace($ArgumentLine)) {
    $psi.Arguments = $ArgumentLine
} else {
    if ($ArgumentList.Count -eq 1 -and $ArgumentList[0].Contains(',')) {
        $ArgumentList = $ArgumentList[0].Split(',')
    }
    $psi.Arguments = ($ArgumentList | ForEach-Object { Quote-ProcessArgument $_ }) -join ' '
}

$proc = [System.Diagnostics.Process]::new()
$proc.StartInfo = $psi
$proc.EnableRaisingEvents = $true

Write-Host ("RUN {0} {1}" -f $FilePath, $psi.Arguments)
[void]$proc.Start()

if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    Write-Warning "Command timed out after $TimeoutSeconds seconds; killing process tree $($proc.Id)."
    & taskkill.exe /F /T /PID $proc.Id 2>$null | Out-Null
    Start-Sleep -Milliseconds 250
    exit 124
}

$proc.WaitForExit()
Write-Host "EXIT $($proc.ExitCode)"
exit $proc.ExitCode
