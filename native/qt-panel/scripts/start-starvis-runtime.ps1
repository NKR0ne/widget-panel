param([int]$Port = 1234)

$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$model = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\Qwen3VL-8B-Instruct-Q4_K_M.gguf'
$visionProjector = 'M:\LLModels\Qwen3-VL-8B-Instruct-GGUF\mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf'

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { exit 0 }
} catch { }

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $model) `
        -or !(Test-Path -LiteralPath $visionProjector)) {
    exit 2
}

$arguments = @(
    '-m', $model,
    '--mmproj', $visionProjector,
    '--alias', 'starvis-local',
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
