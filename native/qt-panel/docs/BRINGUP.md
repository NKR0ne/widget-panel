# Native Qt Panel Bring-Up

Use the Qt worktree independently from the Electron checkout:

```powershell
cd C:\Users\nicol\source\repos\widget-panel-qt\native\qt-panel
```

## Build and test

`build.ps1` clears stale Qt/MSVC build processes before configuring. NMake is
the default because it is the stable generator for this toolchain. Normal
cleanup deliberately leaves Electron's `taskbar-btn` and `brave-host` running.
Use `kill-build-processes.ps1 -IncludeRuntimeHelpers` only for a standalone Qt
runtime reset.

After the first configure, `build.ps1` reuses a compatible CMake build tree so
ordinary C++ and QML edits do not invalidate every generated QML cache object.
It automatically configures again when the generator, configuration, Qt path,
source tree, or test option changes. Pass `-Reconfigure` to force that step.
When application inputs are unchanged, the script skips Qt's phony QML target;
`-Tests` then builds only `qt-panel-tests`. The verified no-op test path takes
about four seconds on the documented workstation instead of rebuilding all QML.

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Tests
```

The release executable is written to:

```text
build\nmake-release\qt-panel.exe
```

## Embedded browser island

The Qt rewrite uses `QtWebEngineQuick` directly. It does not launch or reparent
Brave. The disk-backed browser profile is stored below the selected qt-panel
profile as `webengine` and `webengine-cache`, so authenticated sessions survive
restarts while remaining isolated from personal browsers.

For an undeployed build, always use `launch.ps1`. It points WebEngine at the Qt
SDK subprocess, resources, locales, QML modules, and DLLs. `build.ps1 -Deploy`
copies those dependencies beside the executable for startup and direct launch.
The embedded surface provides native navigation controls, persistent cookies,
forced dark mode, same-view popup handling, script callbacks, and bounded
renderer-process recovery.

## Isolated smoke run

The smoke profile does not import or modify the Electron configuration. The
helper is fully disabled, so Electron may continue owning port 47321.

```powershell
powershell -ExecutionPolicy Bypass -File .\launch.ps1 `
  -NoHelper -Profile smoke -ExitAfterMs 12000
```

The launcher returns after its startup liveness check. The Qt process exits at
the requested deadline, then the launcher reports its real exit code. Review:

```text
%APPDATA%\qt-panel\profiles\smoke\qt-panel.log
```

A successful smoke run contains `[startup] QML root attached`,
`[helper] disabled by --no-helper`, and `[startup] ready`, with no QML root
creation error.
Successful bounded runs also print `EXIT_CODE=0` and log
`[startup] exiting cleanly`.

An embedded-page diagnostic can reserve the full browser area and save
`diag-web-island.png` below the isolated profile:

```powershell
powershell -ExecutionPolicy Bypass -File .\launch.ps1 `
  -NoHelper -Profile web-smoke -DiagFitMode `
  -DiagIslandUrl https://example.com -ExitAfterMs 12000
```

Renderer selection defaults to `auto`, which selects the reliable Windows
D3D11 RHI backend. Use `-Renderer vulkan` only for an intentional Vulkan test
on a machine with a working Vulkan runtime.

Fresh profiles start with three Base columns. Restored widths are clamped to
the configured column layout, preventing six cards from being squeezed into a
legacy 720px window during startup.

`-DiagFitMode` pins its isolated profile at full opacity so focus loss cannot
turn regression screenshots into empty window grabs.

## Interactive run

```powershell
powershell -ExecutionPolicy Bypass -File .\launch.ps1 `
  -NoHelper -Profile development
```

Omit `-NoHelper` only when the Electron app and its taskbar helper are stopped.
The default profile continues to import the legacy Electron configuration on
first run; named profiles never import it.

## Build, test, and smoke in one command

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1 `
  -Tests -Run -NoHelper -Profile smoke -ExitAfterMs 12000
```
