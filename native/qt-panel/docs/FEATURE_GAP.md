# qt-panel Feature Gap Ledger

This is the source-based parity ledger for the native Qt rewrite. "Implemented"
means the code path exists in `native/qt-panel`; "partial" means source exists
but parity, controls, or runtime validation are incomplete.

## Build And Stall Control

| Area | Status | Notes |
|---|---|---|
| Documented build flow | Implemented | `build.ps1` matches `docs/RUNNING.md`: cleanup, vcvars, CMake configure, CMake build, optional deploy/run. |
| Pre-build cleanup | Implemented | `kill-build-processes.ps1` clears Qt/MSVC build tools, `qt-panel`, and `qmlformat` process trees. |
| PowerShell PATH normalization | Implemented | `build.ps1` normalizes duplicate `Path`/`PATH` inherited by this environment. |
| Guarded test build | Implemented | `build.ps1 -Tests` enables the Qt test target and runs CTest under the same cleanup and process-tree timeouts. |
| Timeout wrappers | Avoid | Do not use `Start-Process` timeout wrappers here; this shell can throw before launching because of duplicate environment keys. |

## Shell And Panel

| Area | Status | Notes |
|---|---|---|
| Left-edge native panel | Implemented | Frameless/tool/topmost Qt window with native controller. |
| Slide/fade choreography | Implemented | QML slide and native hide callback are wired. |
| Pin/unpin and blur-hide guard | Implemented | Controller exposes pin, modal guard, focus policy. |
| Resize handle and persisted width | Implemented | Native controller handles drag resize. |
| Helper TCP protocol | Implemented | AppBar helper integration uses the existing port/protocol. |
| Browser spotlight | Implemented | Native browser shell is clipped to a QML card spanning columns 4-6, with address, back/forward/reload, external-open, close, and live geometry synchronization. |
| Vulkan/D3D11 selection | Implemented | A header-independent Vulkan instance probe runs before QML; D3D11 is selected explicitly when Vulkan cannot initialize. |
| Runtime polish validation | Partial | Needs build/run screenshots and focus/z-order regression pass. |

## Widget Framework

| Area | Status | Notes |
|---|---|---|
| Six-column layout | Implemented | Uses saved `wp-config.columns`, `wp-col-widths`, and `wp-base-columns`. |
| Stage modes | Implemented | Base/news/monitor/live modes exist. |
| Drag between columns | Implemented | Drops update saved column assignment. |
| In-column ordering | Implemented | Native drag/drop now updates both `wp-config.columns` and `wp-config.activeIds`, matching Electron's persisted order. |
| Widget enable/disable | Implemented | Manage modal writes `wp-config.activeIds` and preserves disabled categories. |
| OPML import | Implemented | Native OPML import updates categories and active category ids. |
| Widget height persistence | Implemented | Resizable widgets persist `wp-<id>-height`. |

## Widgets And Services

| Area | Status | Notes |
|---|---|---|
| Clock/calendar/weather | Implemented | Native QML/services exist. |
| Traffic | Implemented | TomTom raster tiles, zoom/theme controls, key from Vault. Hot-reloads key changes. |
| Stocks | Partial | Yahoo quote model, watchlists cache, IPO, heatmap island. Finnhub-specific parity and earnings calendar remain to verify/port. |
| News | Implemented | OPML/RSS, category cards/carousel, archive hook, and 3D source exist. News mode now keeps categories in column 1, shows the selected category's full article list in columns 2-3, and reads the selected article in columns 4-6 without a modal overlay. |
| Microsoft agenda/mail/todo | Implemented | Graph PKCE, token refresh, calendars, mail read, todo complete/list selection. Needs live OAuth validation. |
| Live feeds | Partial | Qt Multimedia HLS and YouTube resolver exist. Needs runtime feed validation and fallback decisions for embed-only feeds. |
| Workstation telemetry | Implemented | Named-pipe client exists and is now activated by visible workstation cards. Needs external service runtime validation. |
| Camera | Implemented | Direct RTSP camera card, protected authentication attempts, credential vault, and runtime playback have been validated. |
| PressReader | Partial | Native card opens Brave-host catalog island. Auth/session parity remains to validate. |
| Starvis | Partial | Native Responses chat/briefing/TTS/action queue/tool policy source exists. Needs advanced settings UI and runtime API validation. |

## Settings And Secrets

| Area | Status | Notes |
|---|---|---|
| Legacy settings import | Implemented | Imports Electron `%APPDATA%/widget-panel/config.json` on first run. |
| Vault migration | Implemented | Moves known secrets into Windows Credential Manager. |
| Settings sheet | Partial | Covers opacities, location, core keys, Graph client, Starvis model/TTS/base URL/workspace, camera server/id, carousel, columns, sound, autostart. |
| Advanced service settings | Partial | Starvis and camera connection controls are native. PressReader auth automation and richer market settings still need native controls. |

## Highest-Value Next Work

1. Expand Settings for Starvis advanced config and camera/PressReader credentials.
2. Runtime validate Microsoft OAuth, live feeds, WorkstationMonitor pipe, and camera.
3. Port/verify remaining stocks parity: Finnhub paths, earnings calendar, TradingView watchlist refresh.
4. Keep using the elevated NMake fallback when the sandbox blocks Qt child processes or Ninja wedges after generation.
