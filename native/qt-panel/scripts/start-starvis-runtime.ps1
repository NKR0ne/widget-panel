param([int]$Port = 1234)

$server = 'M:\LLModels\llama.cpp-b10516-cuda12\llama-server.exe'
$model = 'M:\LLModels\empero-ai\Qwen3.8-9B-Distill-GGUF\Qwen3.8-9B-Q5_K_M.gguf'

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { exit 0 }
} catch { }

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $model)) {
    exit 2
}

$arguments = @(
    '-m', $model,
    '--alias', 'starvis-local',
    '--host', '127.0.0.1',
    '--port', $Port,
    '-c', '8192',
    '-ngl', '99',
    '--parallel', '1'
)

Start-Process -FilePath $server -ArgumentList $arguments `
    -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden
