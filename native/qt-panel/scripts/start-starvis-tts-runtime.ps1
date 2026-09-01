param(
    [int]$Port = 1237,
    [ValidateSet('', 'piper', 'chatterbox')]
    [string]$Engine = ''
)

$ErrorActionPreference = 'Stop'
$piperPython = 'M:\LLModels\starvis-piper-runtime\Scripts\python.exe'
$piperServer = Join-Path $PSScriptRoot 'starvis-fast-tts-runtime.py'
$chatterboxPython = 'M:\LLModels\starvis-chatterbox-runtime\Scripts\python.exe'
$chatterboxServer = Join-Path $PSScriptRoot 'starvis-chatterbox-tts-runtime.py'
$tom = 'M:\LLModels\Piper\fr_FR-tom-medium.onnx'
$upmc = 'M:\LLModels\Piper\fr_FR-upmc-medium.onnx'

function Get-ConfiguredEngine {
    if ($Engine) { return $Engine }
    try {
        $settingsPath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) `
            'qt-panel\settings.json'
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        $voice = $settings.'wp-starvis-voice'
        if ($voice -is [string]) { $voice = $voice | ConvertFrom-Json }
        if ($voice.localTtsEngine -in @('piper', 'chatterbox')) {
            return [string]$voice.localTtsEngine
        }
    } catch { }
    return 'piper'
}

$selectedEngine = Get-ConfiguredEngine
$expectedProvider = if ($selectedEngine -eq 'chatterbox') {
    'Chatterbox Multilingual V3'
} else { 'Piper' }

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok' -and $health.ttsReady `
            -and $health.provider -eq $expectedProvider) { return }
} catch { }

$connection = Get-NetTCPConnection -State Listen -LocalPort $Port `
    -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $connection) {
    $process = Get-CimInstance Win32_Process -Filter `
        ("ProcessId = {0}" -f $connection.OwningProcess)
    $known = $process.Name -match '^python(?:w)?\.exe$' -and `
        ($process.CommandLine -like '*starvis-fast-tts-runtime.py*' -or `
         $process.CommandLine -like '*starvis-chatterbox-tts-runtime.py*')
    if (!$known) { throw "Port $Port is not owned by a recognized Starvis TTS runtime." }
    Stop-Process -Id $process.ProcessId -Force
}

$env:STARVIS_TTS_PORT = [string]$Port
$logRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'qt-panel'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if ($selectedEngine -eq 'chatterbox') {
    if (!(Test-Path -LiteralPath $chatterboxPython) `
            -or !(Test-Path -LiteralPath $chatterboxServer)) {
        throw 'Starvis Chatterbox runtime is not installed.'
    }
    $env:HF_HOME = 'M:\LLModels\Chatterbox\cache'
    $env:HF_HUB_DISABLE_XET = '1'
    $env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
    $env:STARVIS_CHATTERBOX_DEVICE = 'auto'
    $env:STARVIS_CHATTERBOX_MODEL_DIR = 'M:\LLModels\Chatterbox\model-v3'
    $python = $chatterboxPython
    $server = $chatterboxServer
} else {
    if (!(Test-Path -LiteralPath $piperPython) -or !(Test-Path -LiteralPath $piperServer) `
            -or !(Test-Path -LiteralPath $tom) -or !(Test-Path -LiteralPath $upmc)) {
        throw 'Starvis Piper runtime or French voice files are missing.'
    }
    $python = $piperPython
    $server = $piperServer
}

Start-Process -FilePath $python -ArgumentList @($server) `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'starvis-tts-runtime.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'starvis-tts-runtime.err.log')
