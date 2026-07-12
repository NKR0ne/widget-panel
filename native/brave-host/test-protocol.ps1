param(
    [int]$TimeoutSeconds = 35
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Send-Message {
    param($Writer, [hashtable]$Message)
    $Writer.WriteLine(($Message | ConvertTo-Json -Compress -Depth 8))
}

function Read-Message {
    param($Reader, [string]$ExpectedType, [int]$DeadlineMs = 10000)
    $deadline = [DateTime]::UtcNow.AddMilliseconds($DeadlineMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $line = $Reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $message = $line | ConvertFrom-Json
            if ($message.type -eq 'error') { throw "brave-host: $($message.msg)" }
            if ($message.type -eq $ExpectedType) { return $message }
        } catch [System.IO.IOException] {
            continue
        }
    }
    throw "Timed out waiting for brave-host message '$ExpectedType'."
}

$root = $PSScriptRoot
$exe = Resolve-Path (Join-Path $root '..\bin\brave-host.exe')
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 47322)
$client = $null
$helper = $null
$writer = $null

try {
    $listener.Start()
    $helper = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
    $accept = $listener.AcceptTcpClientAsync()
    if (-not $accept.Wait([Math]::Min($TimeoutSeconds, 10) * 1000)) {
        throw 'brave-host did not connect to the protocol listener.'
    }
    $client = $accept.Result
    $stream = $client.GetStream()
    $stream.ReadTimeout = 1000
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.UTF8Encoding]::new($false))
    $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
    $writer.AutoFlush = $true

    [void](Read-Message $reader 'ready' 5000)
    $firstHtml = '<html><head><title>CDP Probe</title></head><body><h1 id="probe">ready</h1></body></html>'
    $firstUrl = 'data:text/html,' + [Uri]::EscapeDataString($firstHtml)
    Send-Message $writer @{ type = 'open'; hwnd = 0; url = $firstUrl; x = 120; y = 120; w = 720; h = 520 }
    [void](Read-Message $reader 'ready' ($TimeoutSeconds * 1000))

    Send-Message $writer @{ type = 'state' }
    $state = Read-Message $reader 'state' 12000
    if (-not $state.payload.available -or $state.payload.title -ne 'CDP Probe') {
        throw "Unexpected initial state: $($state | ConvertTo-Json -Compress -Depth 8)"
    }

    Send-Message $writer @{
        type = 'eval'
        id = 'protocol-eval-1'
        script = "document.getElementById('probe').textContent='mutated'; document.title='CDP Mutated'; 'ok'"
    }
    $evaluation = Read-Message $reader 'eval' 12000
    if ($evaluation.id -ne 'protocol-eval-1' -or -not $evaluation.ok -or
        $evaluation.payload.result.result.value -ne 'ok') {
        throw "Unexpected eval result: $($evaluation | ConvertTo-Json -Compress -Depth 12)"
    }
    Send-Message $writer @{
        type = 'eval'
        id = 'protocol-eval-error'
        script = "throw new Error('expected protocol failure')"
    }
    $failedEvaluation = Read-Message $reader 'eval' 12000
    if ($failedEvaluation.id -ne 'protocol-eval-error' -or $failedEvaluation.ok -or
        $failedEvaluation.error -ne 'island script failed') {
        throw "Unexpected eval failure: $($failedEvaluation | ConvertTo-Json -Compress -Depth 12)"
    }
    Send-Message $writer @{ type = 'state' }
    $mutated = Read-Message $reader 'state' 12000
    if ($mutated.payload.title -ne 'CDP Mutated') {
        throw "Runtime.evaluate did not mutate the page: $($mutated | ConvertTo-Json -Compress -Depth 8)"
    }

    Send-Message $writer @{ type = 'cookies' }
    $cookies = Read-Message $reader 'cookies' 12000
    if ($null -eq $cookies.payload.result.cookies) {
        throw 'Cookie response did not include result.cookies.'
    }

    $secondHtml = '<html><head><title>CDP Second</title></head><body>second</body></html>'
    $secondUrl = 'data:text/html,' + [Uri]::EscapeDataString($secondHtml)
    Send-Message $writer @{ type = 'navigate'; url = $secondUrl }
    [void](Read-Message $reader 'ready' 12000)
    Start-Sleep -Milliseconds 500
    Send-Message $writer @{ type = 'state' }
    $second = Read-Message $reader 'state' 12000
    if ($second.payload.title -ne 'CDP Second' -or -not $second.payload.canGoBack) {
        throw "Navigation history was not reported: $($second | ConvertTo-Json -Compress -Depth 8)"
    }

    Send-Message $writer @{ type = 'back' }
    [void](Read-Message $reader 'ready' 12000)
    Start-Sleep -Milliseconds 500
    Send-Message $writer @{ type = 'state' }
    $back = Read-Message $reader 'state' 12000
    if ($back.payload.title -ne 'CDP Probe') {
        throw "Back navigation failed: $($back | ConvertTo-Json -Compress -Depth 8)"
    }

    Send-Message $writer @{ type = 'close' }
    Write-Host 'PASS brave-host protocol: state, correlated eval, cookies, navigate, and back.' -ForegroundColor Green
} finally {
    if ($writer) {
        try {
            Send-Message $writer @{ type = 'close' }
            Start-Sleep -Milliseconds 500
        } catch {}
    }
    if ($client) { $client.Close() }
    $listener.Stop()
    if ($helper -and -not $helper.HasExited) {
        Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue
        [void]$helper.WaitForExit(3000)
    }
}
