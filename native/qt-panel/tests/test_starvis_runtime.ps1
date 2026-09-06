$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/starvis-llama-runtime.ps1')
$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$script:processes = @(
    [pscustomobject]@{ ProcessId=11; ExecutablePath=$server; CommandLine='llama-server --alias starvis-vision --port 1236'; CreationDate=[DateTime]::Now.AddMinutes(-2) },
    [pscustomobject]@{ ProcessId=12; ExecutablePath=$server; CommandLine='llama-server --alias starvis-vision --port 1236'; CreationDate=[DateTime]::Now },
    [pscustomobject]@{ ProcessId=13; ExecutablePath=$server; CommandLine='llama-server --alias starvis-vision-other --port 1236'; CreationDate=[DateTime]::Now },
    [pscustomobject]@{ ProcessId=14; ExecutablePath='C:\Other\llama-server.exe'; CommandLine='llama-server --alias starvis-vision --port 1236'; CreationDate=[DateTime]::Now }
)
$script:stopped = @()
$script:listener = [pscustomobject]@{ OwningProcess=11 }
$script:ready = $true
$script:starts = 0
function Get-CimInstance { param($Filter, $ErrorAction) $script:processes }
function Get-NetTCPConnection { param($State, $LocalPort, $ErrorAction) $script:listener }
function Stop-Process { param($Id, [switch]$Force, $ErrorAction) $script:stopped += $Id }
function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    if (!$script:ready) { throw 'Loading' }
    if ($Uri -like '*/models') { return @{ data=@(@{ id='starvis-vision' }) } }
    return @{ status='ok' }
}
function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, [switch]$PassThru, $WorkingDirectory, $RedirectStandardOutput, $RedirectStandardError)
    $script:starts++
    $script:ready=$true
    return [pscustomobject]@{ Id=20; HasExited=$false }
}
function Assert($Condition, $Message) { if (!$Condition) { throw $Message } }
$matches = @(Get-StarvisLlamaProcesses -Server $server -Alias starvis-vision -Port 1236)
Assert ($matches.Count -eq 2) 'Ownership matching included unrelated processes.'
Start-StarvisLlamaServer -Server $server -Alias starvis-vision -Port 1236 -BuildArguments { throw 'Already running' }
Assert ($script:stopped.Count -eq 1 -and $script:stopped[0] -eq 12) 'Did not preserve the listener and remove only its duplicate.'
Assert ($script:starts -eq 0) 'Started a duplicate model.'
$script:processes=@()
$script:listener=$null
$script:ready=$false
Start-StarvisLlamaServer -Server $server -Alias starvis-vision -Port 1236 -BuildArguments { @('--alias','starvis-vision') }
Assert ($script:starts -eq 1) 'Cold startup did not launch exactly one process.'
$script:listener=[pscustomobject]@{ OwningProcess=999 }
$script:ready=$false
$rejected=$false
try { Start-StarvisLlamaServer -Server $server -Alias starvis-vision -Port 1236 -BuildArguments { @() } }
catch { $rejected=$_.Exception.Message -like '*another application*' }
Assert $rejected 'An unrelated listener was not protected.'
Assert ($script:starts -eq 1) 'Attempted to start on an occupied port.'
# Parsing launchers does not run real model processes.
Get-ChildItem (Join-Path $PSScriptRoot '../scripts') -Filter '*starvis*.ps1' | ForEach-Object {
    $tokens=$null; $errors=$null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    Assert ($errors.Count -eq 0) "Invalid PowerShell: $($_.Name)"
}
Write-Output 'Starvis runtime ownership, duplicate, cold-start and occupied-port checks passed.'
