# Builds the Phase 3 spike: Qt Quick rendered into a composition surface, with
# DesktopAcrylicController behind it.
#
# Reuses the C++/WinRT projections and the vendored runtime from the Phase 0
# spike rather than duplicating either. No moc step: this deliberately declares
# no Q_OBJECT type, so a direct cl.exe invocation is enough.

param(
    [string]$QtDir = 'C:\Qt\6.10.3\msvc2022_64'
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$native    = Split-Path -Parent $root
$build     = Join-Path $root 'build'
$vendor    = Join-Path $native 'winappsdk-runtime'
$phase0    = Join-Path $native 'composition-spike\build'
$generated = Join-Path $phase0 'winrt-generated'
$sdkBin    = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
$mt        = Join-Path $sdkBin 'mt.exe'

if (-not (Test-Path "$QtDir\lib\Qt6Quick.lib")) { throw "Qt 6 not found at $QtDir" }
if (-not (Test-Path (Join-Path $generated 'winrt\Microsoft.UI.Composition.SystemBackdrops.h'))) {
    throw "C++/WinRT projections missing. Run ..\composition-spike\build-spike.ps1 first."
}

New-Item -ItemType Directory -Force $build | Out-Null

# --- MSVC environment -------------------------------------------------------
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found at $vcvars" }
cmd /c "`"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
}

# --- runtime + activation manifest (same self-contained story as Phase 0) ---
Copy-Item (Join-Path $vendor 'x64\*.dll') $build -Force
$merged = Join-Path $build 'spike.manifest'
& $mt -nologo `
    -manifest "$vendor\manifests\Microsoft.WindowsAppSdk.Foundation.manifest" `
              "$vendor\manifests\Microsoft.InteractiveExperiences.manifest" `
    -out:$merged
if ($LASTEXITCODE -ne 0) { throw "mt.exe merge failed ($LASTEXITCODE)" }

# mt.exe emits a nameless <file>; invalid SxS, and the process dies before main.
[xml]$mx = Get-Content $merged
$nsm = New-Object System.Xml.XmlNamespaceManager($mx.NameTable)
$nsm.AddNamespace('a', 'urn:schemas-microsoft-com:asm.v1')
$dropped = 0
foreach ($n in @($mx.SelectNodes('//a:file', $nsm))) {
    if ([string]::IsNullOrWhiteSpace($n.GetAttribute('name'))) {
        $n.ParentNode.RemoveChild($n) | Out-Null; $dropped++
    }
}
if ($dropped) { $mx.Save($merged) }

# --- compile ----------------------------------------------------------------
$qtInc = @(
    "$QtDir\include", "$QtDir\include\QtCore", "$QtDir\include\QtGui",
    "$QtDir\include\QtQml", "$QtDir\include\QtQuick",
    "$QtDir\include\QtWebEngineQuick", "$QtDir\include\QtWebEngineCore"
) | ForEach-Object { "/I`"$_`"" }

Write-Host 'Compiling...' -ForegroundColor Cyan
Push-Location $build
try {
    $args = @(
        # /Zc:__cplusplus is mandatory for Qt: without it MSVC reports C++98 in
        # __cplusplus and Qt refuses to compile at all.
        '/nologo', '/std:c++20', '/Zc:__cplusplus', '/permissive-',
        '/EHsc', '/W3', '/MD', '/O2',
        '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN',
        "/I`"$generated`"", "/I`"$vendor\include`""
    ) + $qtInc + @(
        "`"$(Join-Path $root 'qt_composition_spike.cpp')`"",
        '/Fe:qt-composition-spike.exe',
        '/link', "/LIBPATH:`"$QtDir\lib`"",
        'Qt6Core.lib', 'Qt6Gui.lib', 'Qt6Qml.lib', 'Qt6Quick.lib', 'Qt6WebEngineQuick.lib',
        'WindowsApp.lib', 'user32.lib', 'ole32.lib', 'd3d11.lib', 'dxgi.lib'
    )
    $line = "cl.exe " + ($args -join ' ')
    $out = cmd /c "$line 2>&1"
    $compileExit = $LASTEXITCODE
    $out | Where-Object { $_ -match ': error|: fatal error' } | Select-Object -First 20
} finally { Pop-Location }
if ($compileExit -ne 0) { throw "compile failed ($compileExit)" }

& $mt -nologo -manifest $merged "-outputresource:$(Join-Path $build 'qt-composition-spike.exe');#1"
if ($LASTEXITCODE -ne 0) { throw "mt.exe embed failed ($LASTEXITCODE)" }

Copy-Item (Join-Path $root 'main.qml') $build -Force
Copy-Item (Join-Path $root 'main-web.qml') $build -Force

# --- Qt runtime beside the exe ----------------------------------------------
# WebEngine needs far more than the core DLLs -- QtWebEngineProcess.exe, ICU
# data and the .pak resources -- so checking only for Qt6Core.dll would skip the
# redeploy that adding WebEngine requires, and --web would fail at runtime.
if (-not (Test-Path (Join-Path $build 'Qt6Core.dll')) -or
    -not (Test-Path (Join-Path $build 'QtWebEngineProcess.exe'))) {
    Write-Host 'Deploying Qt runtime...' -ForegroundColor Cyan
    & "$QtDir\bin\windeployqt.exe" --qmldir $root (Join-Path $build 'qt-composition-spike.exe') | Out-Null
}

Write-Host "built: $(Join-Path $build 'qt-composition-spike.exe')" -ForegroundColor Green
