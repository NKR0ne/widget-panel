# Shared by both launchers: model loading itself must be inside the lock.
function Get-StarvisLlamaProcesses {
    param([string]$Server, [string]$Alias, [int]$Port)
    $aliasPattern = '(?:^|\s)--alias\s+"?' + [regex]::Escape($Alias) + '"?(?=\s|$)'
    $portPattern = '(?:^|\s)--port\s+' + $Port + '(?=\s|$)'
    Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" -ErrorAction Stop |
        Where-Object { $_.ExecutablePath -eq $Server -and
            $_.CommandLine -match $aliasPattern -and $_.CommandLine -match $portPattern }
}

function Get-StarvisFreeVram {
    try {
        return [int]((& nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>$null |
            Select-Object -First 1).Trim())
    } catch { return 0 }
}

function Start-StarvisLlamaServer {
    param([string]$Server, [string]$Alias, [int]$Port, [scriptblock]$BuildArguments)
    $mutex = New-Object System.Threading.Mutex($false, 'Local\WidgetPanel.Starvis.LlamaStartup')
    $locked = $false
    $started = $null
    try {
        try { $locked = $mutex.WaitOne(90000) }
        catch [System.Threading.AbandonedMutexException] { $locked = $true }
        if (!$locked) { throw 'Another Starvis model launch exceeded 90 seconds.' }
        $owned = @(Get-StarvisLlamaProcesses -Server $Server -Alias $Alias -Port $Port)
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1
        # Keep the listening copy, or the oldest in-flight loader. Remove only
        # exact Starvis executable/alias/port matches, never user-managed models.
        $keep = $owned | Sort-Object CreationDate | Select-Object -First 1
        if ($listener) {
            $listeningCopy = $owned | Where-Object { $_.ProcessId -eq $listener.OwningProcess } |
                Select-Object -First 1
            if ($listeningCopy) { $keep = $listeningCopy }
        }
        foreach ($process in $owned) {
            if ($keep -and $process.ProcessId -ne $keep.ProcessId) {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
                Write-Output "Removed duplicate $Alias process $($process.ProcessId)."
            }
        }
        if (!$keep) {
            try {
                $models = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/models" -TimeoutSec 2
                if ($models.data | Where-Object { $_.id -eq $Alias }) { return }
            } catch { }
            if ($listener) { throw "Port $Port belongs to another application; it was left untouched." }
            $arguments = @(& $BuildArguments)
            $logRoot = Join-Path $env:APPDATA 'qt-panel'
            New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
            $started = Start-Process -FilePath $Server -ArgumentList $arguments -WindowStyle Hidden -PassThru `
                -WorkingDirectory (Split-Path $Server) `
                -RedirectStandardOutput (Join-Path $logRoot "$Alias-runtime.out.log") `
                -RedirectStandardError (Join-Path $logRoot "$Alias-runtime.err.log")
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(75)
        do {
            if ($started -and $started.HasExited) { throw "$Alias exited during model loading." }
            try {
                $models = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/models" -TimeoutSec 2
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
                if ($health.status -eq 'ok' -and ($models.data | Where-Object { $_.id -eq $Alias })) {
                    Write-Output "$Alias is ready on port $Port."
                    return
                }
            } catch { }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        throw "$Alias did not become ready within 75 seconds."
    } catch {
        if ($started -and !$started.HasExited) { Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue }
        throw
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
