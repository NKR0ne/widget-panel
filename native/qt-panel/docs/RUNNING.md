# Running qt-panel

## Prerequisites
- **VS 18 Build Tools** at `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools`
  (MSVC 14.50+, bundled CMake + Ninja — same toolchain as `native/taskbar-btn`).
- **Qt 6.10.3 MSVC x64** at `C:\Qt\6.10.3\msvc2022_64`. Installed via:
  ```
  python -m pip install --user aqtinstall
  python -m aqt install-qt windows desktop 6.10.3 win64_msvc2022_64 -O C:\Qt ^
      -m qtmultimedia qtquick3d qtshadertools qtimageformats qtquicktimeline qtnetworkauth qtwebsockets ^
         qtwebengine qtwebchannel qtpositioning qtpdf qtserialport
  ```

## Build
```powershell
powershell -ExecutionPolicy Bypass -File build.ps1               # release
powershell -ExecutionPolicy Bypass -File build.ps1 -Config debug
powershell -ExecutionPolicy Bypass -File build.ps1 -Deploy -Run  # + windeployqt + launch
powershell -ExecutionPolicy Bypass -File build.ps1 -Generator NMake # fallback if Ninja wedges
powershell -ExecutionPolicy Bypass -File launch.ps1              # launch existing build
powershell -ExecutionPolicy Bypass -File kill-build-processes.ps1 # cleanup only
```
Output: `build\nmake-release\qt-panel.exe`. Without `-Deploy`, use `launch.ps1`;
it configures the Qt DLL, QML import, WebEngine process, resource, and locale
paths from `C:\Qt\6.10.3\msvc2022_64`. A deployed build is self-contained.
`build.ps1` runs `kill-build-processes.ps1` before every build by default and
wraps configure/build/deploy commands with a hard timeout that kills the native
process tree. Pass `-SkipKill` only when you intentionally need to preserve
another Qt/MSVC build.

## Stall recovery
- If a build or Qt tool invocation is interrupted, run
  `powershell -ExecutionPolicy Bypass -File kill-build-processes.ps1` before the
  next attempt. It clears the Qt/MSVC build chain, `qt-panel.exe`,
  `taskbar-btn.exe`, `brave-host.exe`, and `qmlformat`.
- If cleanup reports access denied for a deployed helper, rerun cleanup from an
  elevated shell. A surviving helper can relaunch or lock the panel exe during a
  build.
- Avoid `Start-Process`-based timeout wrappers in this environment. The shell can
  inherit duplicate `Path`/`PATH` variables, which makes PowerShell process
  launching and `Env:` enumeration throw. `build.ps1` normalizes the process-local
  PATH before loading `vcvars64.bat`.

## Behavior
- Left-edge acrylic sidebar, 10px gap inset, work-area height, always-on-top,
  no taskbar button. Slide-in/out at 390ms, synchronized window hide.
- Pin (header pin button): panel stays up at `wp-pinned-opacity` and ignores
  focus loss. Unpinned: clicking outside hides the panel (same debounce rules
  as the Electron app).
- Right-edge drag handle resizes; width persists to `wp-width`.
- Authenticated and site-dependent pages use an embedded Qt WebEngine surface
  with persistent cookies/cache, native navigation chrome, forced dark mode,
  same-view popups, bounded renderer recovery, and explicit external-open.
- Renderer: Vulkan when available, else D3D11 — shown as a badge in the header.
- **Helper integration**: listens on TCP 127.0.0.1:47321 for `taskbar-btn.exe`
  (the Explorer AppBar pill). If the Electron app is running it owns that port;
  qt-panel retries every 5s and works standalone meanwhile. Pass `--no-helper`
  to skip auto-spawning the helper.
- Settings: `%APPDATA%\qt-panel\settings.json`. On first run, imports the
  Electron `%APPDATA%\widget-panel\config.json` (layout, widths, opacities…).
- Log: `%APPDATA%\qt-panel\qt-panel.log`.

## Second instance
Launching `qt-panel.exe` again toggles the running panel (single-instance
socket) and exits.
