param([int]$Port = 1234)

$ErrorActionPreference = 'Stop'
$alias = 'starvis-local'
$baseUrl = "http://127.0.0.1:$Port"
$lms = 'C:\Users\nicol\.lmstudio\bin\lms.exe'
$reasoningModel = 'M:\LLModels\LMStudio\empero-ai\Qwen3.8-9B-Distill-GGUF\Qwen3.8-9B-Q5_K_M.gguf'
$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$fallbackModel = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\Qwen3VL-8B-Instruct-Q4_K_M.gguf'
$visionProjector = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf'

function Test-StarvisModel {
    try {
        $models = Invoke-RestMethod -Uri "$baseUrl/v1/models" -TimeoutSec 3
        return [bool]($models.data | Where-Object { $_.id -eq $alias })
    } catch {
        return $false
    }
}

if (Test-StarvisModel) { exit 0 }

if ((Test-Path -LiteralPath $lms) -and (Test-Path -LiteralPath $reasoningModel)) {
    & $lms server start --port $Port
    if ($LASTEXITCODE -eq 0) {
        & $lms load 'qwen3.8-9b-distill' --gpu 0.4 --context-length 8192 `
            --parallel 1 --identifier $alias --yes
        if ($LASTEXITCODE -eq 0 -and (Test-StarvisModel)) { exit 0 }
    }
    & $lms server stop 2>$null
}

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $fallbackModel) `
        -or !(Test-Path -LiteralPath $visionProjector)) {
    exit 2
}

$arguments = @(
    '-m', $fallbackModel,
    '--mmproj', $visionProjector,
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
