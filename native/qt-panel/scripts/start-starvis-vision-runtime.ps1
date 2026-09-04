param([int]$Port = 1236, [int]$GpuLayers = -1)

$ErrorActionPreference = 'Stop'
$alias = 'starvis-vision'
$baseUrl = "http://127.0.0.1:$Port"
$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$model = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\Qwen3VL-8B-Instruct-Q4_K_M.gguf'
$projector = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf'

try {
    $models = Invoke-RestMethod -Uri "$baseUrl/v1/models" -TimeoutSec 2
    if ($models.data | Where-Object { $_.id -eq $alias }) { return }
} catch { }

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $model) `
        -or !(Test-Path -LiteralPath $projector)) {
    throw 'Starvis vision runtime or model files are missing.'
}

if ($GpuLayers -lt 0) {
    $freeVramMb = 0
    try {
        $freeVramMb = [int]((& nvidia-smi --query-gpu=memory.free `
            --format=csv,noheader,nounits 2>$null | Select-Object -First 1).Trim())
    } catch { }
    # Reasoning has priority on the 10 GB GPU. Keep vision on CPU when the
    # active model leaves too little headroom for a reliable partial offload.
    $GpuLayers = if ($freeVramMb -ge 6500) { 24 } `
                 elseif ($freeVramMb -ge 3500) { 8 } `
                 else { 0 }
}

$arguments = @(
    '-m', $model, '--mmproj', $projector, '--alias', $alias,
    '--host', '127.0.0.1', '--port', $Port, '-c', '4096',
    '-ngl', $GpuLayers, '--parallel', '1', '--flash-attn', 'on',
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--metrics'
)
if ($GpuLayers -eq 0) {
    $arguments += @('--no-mmproj-offload', '--no-op-offload', '--no-kv-offload')
}

$logRoot = Join-Path $env:APPDATA 'qt-panel'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Process -FilePath $server -ArgumentList $arguments `
    -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'starvis-vision-runtime.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'starvis-vision-runtime.err.log')
