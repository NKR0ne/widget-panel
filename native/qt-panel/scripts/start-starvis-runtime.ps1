param([int]$Port = 1234)

$ErrorActionPreference = 'Stop'
$alias = 'starvis-local'
$baseUrl = "http://127.0.0.1:$Port"
$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$reasoningModel = 'M:\LLModels\Qwen3-4B-GGUF\Qwen3-4B-Q5_K_M.gguf'
. (Join-Path $PSScriptRoot 'starvis-llama-runtime.ps1')

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $reasoningModel)) {
    throw 'Starvis reasoning runtime or model is missing.'
}

Start-StarvisLlamaServer -Server $server -Alias $alias -Port $Port -BuildArguments {
$free = Get-StarvisFreeVram
# Vision has already reserved its budget. Keep headroom for Qt and the desktop.
$layers = if ($free -ge 4500) { 99 } elseif ($free -ge 2800) { 16 } elseif ($free -ge 1800) { 8 } else { 0 }
$arguments = @(
    '-m', $reasoningModel,
    '--alias', $alias,
    '--host', '127.0.0.1',
    '--port', $Port,
    '-c', '8192',
    '-ngl', $layers,
    '--parallel', '1',
    '--flash-attn', 'on',
    '--cache-type-k', 'q8_0',
    '--cache-type-v', 'q8_0',
    '--metrics'
)

if ($layers -eq 0) { $arguments += @('--no-op-offload', '--no-kv-offload') }
$arguments
}
