# Vendored WindowsAppSDK runtime (self-contained)

12 MB of binaries checked into the repo, deliberately. This is what lets a fresh
clone build and run the composition backdrop path with **nothing installed on the
machine** — no WindowsAppSDK runtime, no bootstrapper, no DDLM, no MSIX.

## Why this is here rather than a dependency

The normal unpackaged route is `MddBootstrapInitialize`, which resolves a
*framework package* registered on the system. On a machine that has only ever run
packaged WinAppSDK apps there is no DDLM registered, and it fails `0x80670016` —
which is exactly what happened here, on both 1.5 and 1.8. Installing the runtime
would fix it, but then "clone and rebuild" produces an app that does not run.

Self-contained deployment removes the dependency instead: the runtime DLLs sit
beside the exe and the activatable classes resolve through a registration-free
WinRT manifest embedded in the binary.

## Provenance

Extracted from `Microsoft.WindowsAppRuntime.1.5.msix` (an ordinary zip) inside
the NuGet package `microsoft.windowsappsdk/1.5.240627000`, under
`tools\Msix\win10-x64\`. The two manifests are copied verbatim from the package's
`manifests\` folder. Nothing here is hand-written or modified.

## Why these 15 DLLs

The MSIX carries 33 DLLs (48.6 MB). The set here is the union of two lists, and
neither one alone is sufficient:

- **Declared** by the activation manifests (10) — these host activatable classes.
  Four of them are never actually loaded on this path.
- **Loaded** at runtime, observed from the live process's module list (11) — five
  of these are plain link-time dependencies that appear in no manifest at all:
  `dwmcorei.dll`, `marshal.dll`, `Microsoft.InputStateManager.dll`,
  `Microsoft.Internal.FrameworkUdk.dll`, `Microsoft.UI.Composition.OSSupport.dll`.

Trimming to just the manifest-declared 10 fails at `Compositor` construction with
`0x8007007E` (module not found), so do not "tidy" this list by reading the
manifests alone. To re-derive it, run the spike from a directory holding the full
extraction and enumerate the process's loaded modules.

## Regenerating

`native/composition-spike/build-spike.ps1` extracts the MSIX and merges the
manifests automatically when the NuGet package is present. This folder is the
committed snapshot of that output so the package is not required.

## Version

WindowsAppSDK 1.5.240627000, win10-x64. Note that 1.5's `DesktopAcrylicController`
has a teardown defect: if its update thread decides to close the controller, it
joins itself and fail-fasts the process with `0xC0000409`. Attaching the backdrop
only *after* the host window is on screen avoids that path.
