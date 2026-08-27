param([int]$Port = 1234)

$ErrorActionPreference = 'Stop'
$alias = 'starvis-local'
$baseUrl = "http://127.0.0.1:$Port"
$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$reasoningModel = 'M:\LLModels\Qwen3-4B-GGUF\Qwen3-4B-Q5_K_M.gguf'

function Test-StarvisModel {
    try {
        $models = Invoke-RestMethod -Uri "$baseUrl/v1/models" -TimeoutSec 3
        return [bool]($models.data | Where-Object { $_.id -eq $alias })
    } catch {
        return $false
    }
}

if (Test-StarvisModel) { exit 0 }

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $reasoningModel)) {
    exit 2
}

$arguments = @(
    '-m', $reasoningModel,
    '--alias', $alias,
    '--host', '127.0.0.1',
    '--port', $Port,
    '-c', '8192',
    '-ngl', '99',
    '--parallel', '1',
    '--flash-attn', 'on',
    '--cache-type-k', 'q8_0',
    '--cache-type-v', 'q8_0',
    '--metrics'
)

Start-Process -FilePath $server -ArgumentList $arguments `
    -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden
