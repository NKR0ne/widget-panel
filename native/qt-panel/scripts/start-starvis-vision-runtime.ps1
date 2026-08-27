param([int]$Port = 1236, [int]$GpuLayers = 24)

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

$arguments = @(
    '-m', $model, '--mmproj', $projector, '--alias', $alias,
    '--host', '127.0.0.1', '--port', $Port, '-c', '4096',
    '-ngl', $GpuLayers, '--parallel', '1', '--flash-attn', 'on',
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--metrics'
)
Start-Process -FilePath $server -ArgumentList $arguments `
    -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden
