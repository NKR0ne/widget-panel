# Builds the Phase 0 composition spike.
#
# Deliberately not CMake: this is a throwaway feasibility probe and a direct
# cl.exe invocation iterates faster on the compile errors that matter here.
# If the spike succeeds, the codegen step below is what moves into the real
# build; the rest of this script does not.

param(
    # Proves the vendored tree is genuinely sufficient: blanks the NuGet path so
    # any lingering dependency on the package fails loudly instead of silently
    # working on this machine and breaking on a fresh clone.
    [switch]$NoPackage
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$build    = Join-Path $root 'build'
$pkg      = if ($NoPackage) { 'C:\nonexistent-package' }
            else { "$env:USERPROFILE\.nuget\packages\microsoft.windowsappsdk\1.5.240627000" }
$vendor   = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'winappsdk-runtime'
# Everything the build needs -- winmd for codegen, headers, manifests, runtime
# DLLs -- is committed under native/winappsdk-runtime. The NuGet package is only
# a fallback for regenerating that folder.
$useVendor = Test-Path (Join-Path $vendor 'x64\wuceffectsi.dll')
$winmdRoot = if ($useVendor) { Join-Path $vendor 'winmd' } else { Join-Path $pkg 'lib' }
$includeDir = if ($useVendor) { Join-Path $vendor 'include' } else { Join-Path $pkg 'include' }
$sdkBin   = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
$cppwinrt = Join-Path $sdkBin 'cppwinrt.exe'
$generated = Join-Path $build 'winrt-generated'

New-Item -ItemType Directory -Force $build | Out-Null

# --- 1. Generate C++/WinRT projections -------------------------------------
# Needs all three winmd folders plus `local` (the Windows SDK metadata):
# uap10.0 alone fails with "Microsoft.UI.Dispatching.DispatcherQueue could not
# be found" because Microsoft.UI.winmd lives in the 18362 folder.
if (-not (Test-Path (Join-Path $generated 'winrt\Microsoft.UI.Composition.SystemBackdrops.h'))) {
    Write-Host 'Generating C++/WinRT projections...' -ForegroundColor Cyan
    & $cppwinrt `
        -in "$winmdRoot\uap10.0" `
        -in "$winmdRoot\uap10.0.18362" `
        -in "$winmdRoot\uap10.0.17763" `
        -in local `
        -out $generated
    if ($LASTEXITCODE -ne 0) { throw "cppwinrt failed ($LASTEXITCODE)" }
} else {
    Write-Host 'Projections already generated.' -ForegroundColor DarkGray
}

# --- 2. Import the MSVC environment ----------------------------------------
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found at $vcvars" }
cmd /c "`"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
}

# --- 3. Extract the self-contained runtime from the package's MSIX ----------
# This is what makes "clone and rebuild" work with nothing installed: the
# runtime payload ships inside the NuGet package, so it can be vendored.
$vendored = Join-Path (Split-Path -Parent $root) 'winappsdk-runtime'
$runtime = Join-Path $build 'runtime'

# Prefer the committed runtime: it is the whole point of the self-contained
# route that a fresh clone needs neither the NuGet package nor an install.
if (Test-Path (Join-Path $vendored 'x64\wuceffectsi.dll')) {
    Write-Host 'Using vendored WindowsAppSDK runtime.' -ForegroundColor DarkGray
    New-Item -ItemType Directory -Force $runtime | Out-Null
    Copy-Item (Join-Path $vendored 'x64\*.dll') $runtime -Force
    $manifestDir = Join-Path $vendored 'manifests'
} elseif (-not (Test-Path $pkg)) {
    throw "no vendored runtime at $vendored and no NuGet package at $pkg"
} else {
    $manifestDir = Join-Path $pkg 'manifests'
}

if (-not (Test-Path (Join-Path $runtime 'Microsoft.WindowsAppRuntime.dll'))) {
    Write-Host 'Extracting WindowsAppRuntime MSIX...' -ForegroundColor Cyan
    $msix = "$pkg\tools\Msix\win10-x64\Microsoft.WindowsAppRuntime.1.5.msix"
    $zip  = Join-Path $build 'runtime.zip'
    Copy-Item $msix $zip -Force              # Expand-Archive insists on .zip
    if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $runtime -Force
    Remove-Item $zip -Force
}
$dllCount = (Get-ChildItem $runtime -Filter '*.dll' -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "runtime DLLs extracted: $dllCount" -ForegroundColor DarkGray

# --- 4. Merge the registration-free WinRT activation manifests --------------
# Foundation + InteractiveExperiences cover Microsoft.UI.Composition / Content.
# WinUI's manifest is not needed — there is no XAML in this spike.
$mt = Join-Path $sdkBin 'mt.exe'
$merged = Join-Path $build 'spike.manifest'
Write-Host 'Merging activation manifests...' -ForegroundColor Cyan
& $mt -nologo `
    -manifest "$manifestDir\Microsoft.WindowsAppSdk.Foundation.manifest" `
              "$manifestDir\Microsoft.InteractiveExperiences.manifest" `
    -out:$merged
if ($LASTEXITCODE -ne 0) { throw "mt.exe manifest merge failed ($LASTEXITCODE)" }

# mt.exe emits a stray <file name=""> when merging these two. An empty name is
# invalid SxS, and the loader rejects the whole assembly for it: the exe dies at
# CreateProcess with "the side-by-side configuration is incorrect" before a
# single line of main() runs. Drop it, and verify every remaining payload is
# actually staged, since a <file> naming a missing DLL fails the same opaque way.
[xml]$mx = Get-Content $merged
$nsm = New-Object System.Xml.XmlNamespaceManager($mx.NameTable)
$nsm.AddNamespace('a', 'urn:schemas-microsoft-com:asm.v1')
$dropped = 0
foreach ($n in @($mx.SelectNodes('//a:file', $nsm))) {
    if ([string]::IsNullOrWhiteSpace($n.GetAttribute('name'))) {
        $n.ParentNode.RemoveChild($n) | Out-Null; $dropped++
    }
}
if ($dropped) { $mx.Save($merged); Write-Host "dropped $dropped nameless <file> element(s)" -ForegroundColor DarkGray }

$declared = @($mx.SelectNodes('//a:file', $nsm) | ForEach-Object { $_.GetAttribute('name') })
$absent = @($declared | Where-Object { -not (Test-Path (Join-Path $runtime $_)) })
if ($absent.Count) { throw "manifest declares DLLs not in the runtime payload: $($absent -join ', ')" }
Write-Host "manifest declares $($declared.Count) payload DLLs, all present" -ForegroundColor DarkGray

# --- 5. Compile -------------------------------------------------------------
Write-Host 'Compiling...' -ForegroundColor Cyan
Push-Location $build
try {
    & cl.exe /nologo /std:c++20 /EHsc /W3 /DUNICODE /D_UNICODE `
        /I"$generated" /I"$includeDir" `
        (Join-Path $root 'composition_spike.cpp') `
        /Fe:composition-spike.exe `
        /link WindowsApp.lib user32.lib ole32.lib
    $compileExit = $LASTEXITCODE
} finally { Pop-Location }
if ($compileExit -ne 0) { throw "compile failed ($compileExit)" }

# --- 6. Embed the manifest and stage the runtime beside the exe -------------
& $mt -nologo -manifest $merged "-outputresource:$(Join-Path $build 'composition-spike.exe');#1"
if ($LASTEXITCODE -ne 0) { throw "mt.exe embed failed ($LASTEXITCODE)" }
Copy-Item (Join-Path $runtime '*.dll') $build -Force

Write-Host "built: $(Join-Path $build 'composition-spike.exe')" -ForegroundColor Green
