param([int]$Port = 1236, [int]$GpuLayers = -1)

$ErrorActionPreference = 'Stop'
$alias = 'starvis-vision'
$baseUrl = "http://127.0.0.1:$Port"
$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$model = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\Qwen3VL-8B-Instruct-Q4_K_M.gguf'
$projector = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf'
. (Join-Path $PSScriptRoot 'starvis-llama-runtime.ps1')

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $model) `
        -or !(Test-Path -LiteralPath $projector)) {
    throw 'Starvis vision runtime or model files are missing.'
}

Start-StarvisLlamaServer -Server $server -Alias $alias -Port $Port -BuildArguments {
if ($GpuLayers -lt 0) {
    $freeVramMb = Get-StarvisFreeVram
    # Camera verification is latency-sensitive; reserve its GPU budget first.
    $GpuLayers = if ($freeVramMb -ge 7000) { 99 } `
                 elseif ($freeVramMb -ge 5500) { 24 } `
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

$arguments
}
