# qt-panel — Native Rewrite Architecture

> Current implementation note (2026-07-12): the original migration proposal
> below used an external `brave-host` island to avoid QtWebEngine. Runtime
> evidence showed that reparented Brave was less reliable for PressReader and
> TradingView. The implemented architecture now embeds `QtWebEngineQuick` in the
> Qt scene, uses one persistent profile per qt-panel profile, and keeps browser
> state, scripts, and cookies behind `PanelWindowController`. This note and the
> implementation override remaining historical Brave references in diagrams.

Target: rewrite the Electron `widget-panel` as a native C++20 Windows app using
**Qt 6 Quick/QML on the Qt RHI with Vulkan preferred (D3D11 fallback)**, built with
**CMake + Ninja + MSVC**, dependencies via **vcpkg**, living in `native/qt-panel/`
alongside the Electron app (which remains the behavioral reference until parity).

---

## 1. What exists today (inventory of behavior to preserve)

### 1.1 Shell behavior (Electron `main.js`, ~5,000 lines)
- Frameless, transparent sidebar window pinned to the **left edge** of the primary
  monitor, inset by `PANEL_GAP = 10px`, full work-area height, `alwaysOnTop`,
  `skipTaskbar`, Windows **acrylic** background material.
- **Show/hide choreography**: window fade (DWM opacity) synchronized with an
  in-scene slide animation (`PANEL_SLIDE_MS = 390`); renderer signals
  `panel-hide-done` so the window hides only after the slide lands; fallback
  timeout `+160ms`.
- **Pin/unpin**: pinned panel stays up at reduced window opacity
  (`wp-pinned-opacity`, default 0.25) and drops out of the focus-steal game.
- **Blur-to-hide** with heuristics: debounce after toggle (200ms) and after
  browser-open (500ms); suppressed while a modal, reader zoom, or embedded
  browser is open; 150ms delayed re-check of focus.
- **Panel geometry modes** (`base`, `news`, `monitor`, `live`): base width is the
  sum of visible column widths (6 columns: `left, monitor, mid, feed, right, aux`,
  defaults 220/220/240/260/260/260 + dividers); stage modes expand to full
  work-area width. Geometry changes set a 700ms lock that suppresses blur-hide.
- **Manual resize**: drag handle; main process polls the cursor at 16ms so the
  drag works past the window edge; persists `wp-width`.
- Disables Windows native widgets/taskbar widgets via registry on startup.

### 1.2 Native helper
- **`taskbar-btn.exe` + `taskbar-hook.dll`** (injected into Explorer): registers a
  left-edge **AppBar** strip (18px) with a pill toggle button; layered color-key
  transparency; a mouse hook detects click-outside and reports it. IPC with the
  app: **TCP `127.0.0.1:47321`, newline-delimited JSON** —
  app→helper `{type:"badge"|"state"|"hwnd"}`, helper→app
  `{type:"ready"|"toggle"|"clickoutside"}`. Cold-start: the button can launch the
  app (reads `panel.path`).

### 1.3 Widgets (renderer, React — `App.jsx` is a 443KB monolith plus per-widget modules)
| Widget | Data source | Notes |
|---|---|---|
| News (Feedly OPML categories) | RSS fetched in main (`rss-fetch`, encoding-sniffing), reader-mode article fetch + archive fallback | Includes a three.js/troika "NewsMatrixStage" 3D headline stage; article reader card with launch-ghost animation |
| Weather | Open-Meteo (no key) | |
| Traffic | TomTom (key) | |
| Stocks | Finnhub, Yahoo `v8/finance/chart`, TradingView scanner (earnings/IPO), TV watchlists via browser-login, TV heatmap embeds | 51KB component; heatmap popup rerouting |
| Calendar / Clock | local | |
| Outlook Agenda / Mail / To-Do | Microsoft Graph, OAuth **PKCE** flow + token refresh in main | badge count → taskbar overlay + helper |
| Starvis (AI command center) | OpenAI Responses API (chat, briefing, TTS, web search opt-in), agent mode with **tool loop ≤3**, action approval queue (persisted, redacted), sandboxed workspace read/grep/git tools, context bus (weather/stocks/news/workstation snapshots with freshness windows) | |
| Camera | Milestone XProtect Mobile SDK — push `VideoConnection`, frames delivered as JPEG blobs | trickiest port; WebSocket path deliberately avoided in current code |
| Euronews + 5 live TV cards (Bloomberg, Radio-Canada, France 24, CBC, LCN) | direct **HLS** `.m3u8` (hls.js) and YouTube live HLS extracted in main; some via `<webview>` embeds | per-feed session/header spoofing in main |
| Workstation CPU/GPU/RAM/Disk/Network | **Named pipe `\\.\pipe\WorkstationMonitorTelemetry`** (WorkstationMonitor app), JSON request/response, 1s poll, heartbeat | sibling repo `WorkstationMonitor` |

### 1.4 Cross-cutting
- Settings/state: `electron-store` JSON (`wp-*` keys: width, column widths/count,
  columns assignment, opacity, card opacity, pinned opacity, location, API keys,
  news carousel, starvis config…).
- Secrets currently in plaintext store / `.env` (OpenAI key, TomTom, Finnhub,
  Graph tokens, PressReader auth).
- Sound service (UI feedback), system accent/window color theming, autostart,
  single-instance, renderer log funnel.

---

## 2. Target architecture

### 2.1 Process model

```
┌────────────────────────────────────────────────────────────┐
│ qt-panel.exe (C++20, Qt 6.8+)                              │
│                                                            │
│  UI thread: QML engine + Qt Quick scenegraph control       │
│  Render thread: RHI → Vulkan (D3D11 fallback)              │
│  Worker pool: services (network, parsing, pipes)           │
│                                                            │
│  shell/   core/   services/   models/   qml/               │
└──────┬──────────────┬──────────────────┬───────────────────┘
       │ TCP 47321    │ \\.\pipe\Work…   │ stdio JSON-lines
┌──────▼─────┐ ┌──────▼──────────┐ ┌─────▼────────┐
│taskbar-btn │ │WorkstationMonitor│
│ + hook.dll │ │ (existing C#)    │
└────────────┘ └──────────────────┘ └──────────────┘
```

The taskbar helper protocol remains verbatim. Browser content is part of the Qt
process model through `QtWebEngineQuick`; Chromium renderers remain sandboxed
child processes managed by Qt.

### 2.2 Module layout

```
native/qt-panel/
├── CMakeLists.txt              # top-level; CMakePresets.json for MSVC+Ninja
├── vcpkg.json                  # manifest (non-Qt deps)
├── ARCHITECTURE.md             # this file
├── docs/RUNNING.md
├── src/
│   ├── main.cpp                # graphics API selection, single-instance, engine boot
│   ├── shell/                  # Win32 + window management (no QML knowledge)
│   │   ├── PanelWindowController   # geometry modes, native-window slide, pin
│   │   ├── WinShellIntegration     # DWM backdrop (acrylic/mica), rounded corners,
│   │   │                           # WS_EX_TOOLWINDOW (skip taskbar), topmost, DPI
│   │   ├── HelperClient            # TCP 47321 client (toggle/badge/state/hwnd)
│   │   ├── PanelWindowController   # WebEngine island state and geometry
│   │   ├── WorkAreaWatcher         # monitor/work-area/DPI change tracking
│   │   └── FocusPolicy             # blur-to-hide heuristics (port of main.js rules)
│   ├── core/
│   │   ├── SettingsStore           # JSON-backed, wp-* key compatible, imports
│   │   │                           # the electron-store config.json on first run
│   │   ├── SecretVault             # Windows Credential Manager (DPAPI) — replaces
│   │   │                           # plaintext keys; one-time migration
│   │   ├── HttpClient              # QNetworkAccessManager wrapper: retries, decode
│   │   │                           # (charset sniffing port of decodeHttpText)
│   │   ├── JsonRpcLineChannel      # shared newline-JSON framing (helpers, pipe)
│   │   ├── Log                     # rotating file + qDebug sink
│   │   └── Scheduler               # poll cadences, freshness windows
│   ├── services/                   # one QObject per domain, each on worker thread
│   │   ├── weather/  traffic/  stocks/   (Finnhub, Yahoo, TradingView scanner)
│   │   ├── news/                   # OPML, RSS, reader-mode extraction (port of
│   │   │                           # reader-fetch + archive fallback), favicon cache
│   │   ├── msgraph/                # OAuth PKCE (loopback redirect via QTcpServer
│   │   │                           # + system browser), token refresh, agenda/mail/todo
│   │   ├── starvis/                # OpenAI Responses client (SSE streaming), TTS,
│   │   │                           # tool loop + action policy/approval queue,
│   │   │                           # context bus (C++ port of starvisContext)
│   │   ├── live/                   # HLS URL resolution incl. YouTube player-response
│   │   │                           # extraction (port from main.js)
│   │   ├── camera/                 # XProtect Mobile client: HTTP push connection,
│   │   │                           # frame header parse → QVideoFrame/QImage
│   │   └── workstation/            # named-pipe client (QLocalSocket), 1s poll,
│   │                               # heartbeat, stale detection
│   ├── models/                     # QAbstractListModel/QObject view-models only;
│   │                               # no QML type touches a service directly
│   └── widgets/
│       └── registry.h/.cpp         # widget metadata: id, label, column, service,
│                                   # QML url — the C++ side of the widget contract
├── qml/
│   ├── Main.qml                    # PanelWindow root
│   ├── theme/  Theme.qml           # singleton: design tokens (palette, type ramp,
│   │           Motion.qml          # radii, elevation) + motion spec (durations,
│   │                               # easing curves) — single source of truth
│   ├── shell/  PanelSurface.qml    # fixed glass stack, content, edge handle
│   │           ColumnLayoutHost.qml# 6-column layout, drag-reorder, stage modes
│   │           WidgetHost.qml      # entrance/exit transitions, reorder animation
│   ├── components/                 # GlassCard, Skeleton, Badge, Sparkline,
│   │                               # AnimatedNumber, Marquee, IconButton, Modal
│   ├── effects/                    # .qsb-compiled shaders: backdrop blur boost,
│   │                               # specular edge, depth shadow, noise grain,
│   │                               # card hover parallax (Vulkan SPIR-V via qsb)
│   └── widgets/
│       ├── clock/ calendar/ weather/ traffic/ stocks/ news/
│       ├── microsoft/ starvis/ workstation/ live/ euronews/ camera/
│       └── (one qt_add_qml_module per widget)
└── tests/                          # QtTest: services (mocked HTTP), models, policy
```

### 2.3 Rendering & "elite UI" strategy

- `QQuickWindow::setGraphicsApi(QSGRendererInterface::Vulkan)` at boot, with a
  capability probe → fall back to `Direct3D11` (and log which path is active;
  surface it in Settings → About).
- All custom shaders authored once in Vulkan-style GLSL, compiled offline with
  **qsb** into `.qsb` bundles (SPIR-V + HLSL + GLSL) so effects are identical on
  the fallback path.
- **Glass system**: real translucency comes from DWM
  (`DWMWA_SYSTEMBACKDROP_TYPE = DWMSBT_TRANSIENTWINDOW` acrylic, like today's
  `backgroundMaterial: 'acrylic'`), then in-scene depth is layered on top:
  adjustable per-card `MultiEffect` shadows, pointer-local keylines, a shared
  system-accent specular pool, and static dither to kill banding without
  temporal shimmer. Card opacity, lighting strength, surface lighting, and
  shadow depth stay user-tunable (`wp-card-opacity`, `wp-lighting-strength`,
  `wp-surface-lighting`, and `wp-shadow-depth`).
- **Motion spec** (Motion.qml): one easing vocabulary (e.g. emphasized
  `[0.2, 0.0, 0, 1]`, exit `[0.3, 0, 0.8, 0.15]`), durations
  90/210/300/390ms.
  The shell moves the complete acrylic window for the 390ms panel transition,
  so DWM material and content travel as one surface. The helper-side timing
  assumptions (350ms state notify, +160ms hide fallback) remain unchanged.
- Entrance/exit: widgets animate via `WidgetHost` (translate + scale 0.97→1 +
  opacity, staggered per card); column reorders use displaced transitions;
  workspace changes use a short fade/translate reveal, and browser spotlights
  enter from their source-column edge. The native shell remains responsible
  for moving and resizing the complete acrylic window.
- 3D headline stage (NewsMatrixStage) → **Qt Quick 3D** scene embedded in the
  news widget; text via `Text` items rendered to texture or Qt Quick 3D's
  distance-field text (replaces three.js + troika).
- High-refresh correctness: animations driven by the scenegraph clock; no timers
  for visual motion; `QSG_RENDER_LOOP=threaded` (default on Windows/Vulkan).

### 2.4 Video strategy (the #1 migration risk)

| Source | Today | Native plan |
|---|---|---|
| Direct HLS (Euronews, LCN/TVA, others) | hls.js in Chromium | **Qt Multimedia (FFmpeg backend)** → `MediaPlayer` + `VideoOutput`; zero-copy into the scenegraph. FFmpeg via Qt's bundled backend |
| YouTube live (Bloomberg, France 24, CBC…) | main.js extracts HLS manifest from player response | Port extractor to `services/live`; play resulting HLS via Qt Multimedia. Keep the existing per-feed header/cookie session tricks in `HttpClient` |
| Feeds that only work as web embeds | `<webview>` with CSS surgery | Use the embedded `WebEngineView` only as an explicit fallback; direct feeds remain native Qt Multimedia |
| Camera (Milestone XProtect) | XPMobileSDK push connection, JPEG frames | C++ client in `services/camera`: login + RequestStream over HTTPS, parse push multipart/frame headers, feed `QVideoSink` (effectively MJPEG). The current code already avoids the WebSocket path, which makes the C++ port *simpler* than the JS workaround |

QtWebEngine is included for authenticated and site-dependent content. Reader
mode stays fully native; the browser island is an escalation path rather than
the default article renderer. The persistent profile provides cookie continuity
without sharing or reparenting a personal browser window.

PressReader has a separate disk-backed WebEngine profile and a dedicated
columns 4-6 spotlight. Its service owns session/authentication policy even when
the optional Base card is disabled. Named diagnostic profiles never submit
stored credentials automatically; proxy/catalog DOM adapters are bounded and
versioned resources rather than long-running scripts embedded in a card.

### 2.5 Threading model

- UI thread: QML, models, input. Never blocks on I/O.
- Each service lives on a worker `QThread` (or uses `QtConcurrent` for parse
  jobs); results cross to models via queued signals carrying value types
  (structs registered with the meta-type system).
- Pipe/TCP clients (`workstation`, helper) are event-driven on
  their own thread with the shared `JsonRpcLineChannel` framing.
- Starvis SSE streaming: incremental tokens emitted as signals → QML appends;
  TTS audio via `QAudioSink` on the audio thread.

### 2.6 Settings, secrets, migration

- `SettingsStore` reads/writes the same logical keys (`wp-width`,
  `wp-columns`, `wp-card-opacity`…) in
  `%APPDATA%/qt-panel/settings.json`; on first run it imports
  `%APPDATA%/widget-panel/config.json` (electron-store) so the user's layout,
  OPML categories, watchlists, and locations carry over.
- Secrets (OpenAI, TomTom, Finnhub, Graph refresh token, PressReader) migrate
  one-way into **Windows Credential Manager**; the JSON keeps only non-secret
  config. This fixes a real weakness of the current app.
- Starvis action queue keeps its persistence shape (50 max, redacted command
  details, 7-day retention) so policies remain auditable.

### 2.7 Widget contract (the extensibility win)

A widget = one folder providing:
1. `Widget.qml` — visual, receives a `model` context property; declares
   `preferredColumn`, `minHeight`, `supportsStage`.
2. A view-model (`QAbstractListModel`/`QObject`) — UI-shaped state only.
3. A service — data acquisition, registered with `Scheduler` cadence +
   freshness window (these become the Starvis context freshness inputs too).
4. One line in `widgets/registry.cpp` (id, label, color, column default —
   mirrors today's `renderer/config/widgets.js` `SYS` table).

The Starvis context bus subscribes to services, not widgets, so AI context
works even when a widget is hidden — same as today's design intent.

---

## 3. Build & tooling

- **Toolchain**: MSVC v143+, C++20 (`/std:c++20 /utf-8 /W4`), CMake ≥3.27 with
  `CMakePresets.json` (`debug`, `release`, `relwithdebinfo`), Ninja.
- **Qt 6.8 LTS+** (Quick, QuickControls2, Multimedia, Quick3D, Network,
  Concurrent, ShaderTools). Installed via aqtinstall or Qt online installer;
  path supplied through `CMAKE_PREFIX_PATH` in the preset.
- **vcpkg manifest** for the rest: `pugixml` (OPML/RSS), `gumbo` or
  `lexbor` (reader-mode HTML), `zlib`, test deps. (TLS/HTTP/JSON come from Qt.)
- `qt_add_qml_module` per widget → compiled QML (qmlcachegen), `qt_add_shaders`
  for `.qsb`.
- CI gate (and the "build must compile before completion" rule): `cmake
  --preset release && cmake --build --preset release && ctest --preset release`.
- Deploy: `windeployqt --qml-dir qml`, helpers copied beside the exe
  (`native/bin` layout preserved so `taskbar-btn` cold-start `panel.path`
  keeps working).

---

## 4. Phased migration plan

Each phase ends green: compiles, runs, and the listed acceptance checks pass.
The Electron app stays untouched and runnable throughout.

**Phase 0 — Shell skeleton (foundation, highest fidelity bar)**
Panel window with acrylic backdrop, gap inset, work-area sizing, native-window
slide-in/out at 390ms, pin/unpin with pinned opacity, blur-to-hide policy
port, helper TCP client (toggle/badge/state/hwnd/clickoutside), geometry modes
+ drag resize, settings import, single instance, autostart.
*Accept: toggling from the AppBar pill is indistinguishable from the Electron
panel; no z-order or focus regressions; Vulkan active in the About box.*

**Phase 1 — Theme + widget framework + simple widgets**
Theme/Motion singletons, GlassCard/WidgetHost/column layout with reorder,
Clock, Calendar, Weather, Workstation (named-pipe client), Stocks (Yahoo
sparklines + Finnhub quotes).
*Accept: 6-column layout matches saved `wp-columns`; workstation cards update
at 1Hz with stale handling; entrance animations at 120Hz without jank.*

**Phase 2 — News + reader + Microsoft Graph**
OPML categories, RSS with charset sniffing, news cards + carousel, native
reader with archive fallback and launch-ghost transition, Graph PKCE auth,
Agenda/Mail/To-Do, unread badge → helper + overlay.
*Accept: same feeds render with same article cleanup quality on a sample set;
OAuth round-trips without embedded browser.*

**Phase 3 — Live video**
Qt Multimedia HLS for direct feeds + Euronews; YouTube HLS extractor port;
live grid with audio policy (one unmuted feed); embedded Qt WebEngine island for
explicit site fallbacks and TradingView heatmap/watchlist login.
*Accept: 5 live cards playing simultaneously with lower CPU than Electron
(measure both).*

**Phase 4 — Starvis + Camera**
Responses API streaming chat/briefing/TTS, context bus wired to all services,
agent tool loop with action approval UI, capability report; direct Hikvision
camera analytics and workstation webcam presence. The native sentry service is
always resident: event subscriptions survive panel and mode visibility changes,
and a heartbeat watchdog rebuilds silent camera streams.
*Accept: briefing renders from fresh context; action policy blocks the same
commands as today (unit-tested against the JS policy table); camera shows live
frames.*

**Phase 5 — Polish ("extreme polish" pass)**
Shader effects (specular edges, grain, hover parallax, depth), Quick 3D news
stage, sound design hookup, stage-mode transitions, settings UI, perf budget
enforcement (frame time HUD behind a dev flag), installer.
*Accept: no animation tied to timers; GPU frame time < 4ms typical on the dev
box; cold start < 1s to first frame.*

---

## 5. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| HLS feeds that depend on Chromium-only header/cookie behavior | High | Keep direct playback native; expose an explicit embedded-browser fallback only where site behavior requires it |
| XProtect camera protocol subtleties | High | The JS code documents the working path (push VideoConnection, no WS); implement against the same Milestone mobile gateway; phase-4 so nothing blocks on it |
| Vulkan driver quirks on user GPUs | Medium | RHI fallback to D3D11 is one line; shaders are qsb multi-target |
| Acrylic behavior differences (DWM vs Electron's backgroundMaterial) | Medium | Same underlying API (`DWMWA_SYSTEMBACKDROP_TYPE`); Phase 0 acceptance is a visual A/B |
| TradingView watchlist "browser login" flow | Medium | Use the persistent Qt WebEngine profile and capture exact-domain cookies directly from its cookie store |
| Reader-mode extraction parity | Medium | Port the existing cleanup heuristics + `scripts/test-reader-cleanup.cjs` corpus as C++ unit tests |
| Scope creep from the 443KB `App.jsx` | High | The widget registry table (§2.7) is the parity checklist; anything not in it is explicitly post-parity |

## 6. Explicit non-goals (v1)

- No cross-platform support (Win32 integration is the point).
- No plugin ABI for third-party widgets yet — the contract is internal until
  the registry stabilizes.
- PressReader integration uses its own persistent Qt WebEngine profile;
  credentials remain in the Windows vault and automation remains bounded.
- The Electron app is not modified; it is retired only after Phase 5 parity.
