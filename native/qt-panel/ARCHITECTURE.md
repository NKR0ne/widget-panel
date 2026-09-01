# qt-panel — Native Application Architecture

## Implemented architecture memory (2026-08-26)

This section is the operational source of truth for the current application.
The inventory, target design, and migration phases below remain useful history,
but they do not override this implemented topology.

### Runtime topology

```text
Windows sign-in
  -> launch.ps1 / QtPanel autostart
     -> qt-panel.exe (single instance)
        -> shell host: Windows Composition + Desktop Acrylic
           or windowed QQuickWindow fallback
        -> Qt Quick/QML scene (RHI: Vulkan preferred, D3D11 fallback)
        -> persistent domain services exposed as QtPanel.Native singletons
        -> two persistent QtWebEngine profiles
        -> taskbar-btn.exe helper over TCP 127.0.0.1:47321

Starvis runtime task
  -> llama-server.exe on 127.0.0.1:1234
     -> Qwen3-VL-8B-Instruct Q4_K_M + Q8 vision projector
        (alias starvis-local, 8192 context, CUDA offload, Flash Attention)
```

The shell has two supported hosts. `CompositionPanelHost` renders the QML scene
with `QQuickRenderControl` into a Windows composition tree backed by Desktop
Acrylic. The fallback path loads `Main.qml` into a normal `QQuickWindow`.
`PanelWindowController` and `PanelSurfaceTarget` keep geometry, show/hide,
focus, pinning, resize, WebEngine spotlight, and autostart behavior identical
across both hosts. `FocusPolicy`, `WinShellIntegration`, `WorkAreaWatcher`, and
`HelperServer` own Windows-specific policy outside QML.

### UI workspaces and cards

`PanelSurface.qml` owns the application modes and delegates layout to
`PanelColumns.qml`. The four top-level workspaces are:

- **Panneau (`base`)** — persisted 3–6 column dashboard. Cards are selected,
  ordered, moved, and resized independently through the widget manager.
- **Nouvelles (`news`)** — four persisted sub-workspaces: **Cartes** (matrix and
  endless randomized five-second carousel), **Lecture** (categories, article
  list, native article reader), **TV** (live-feed stage), and **Presse**
  (PressReader spotlight). Each resizable sub-workspace remembers its own width
  and column count; Lecture keeps its own three-pane proportions.
- **Performance (`monitor`)** — full-width Windows Task Manager-style CPU, GPU,
  RAM, disk, and network telemetry. The lightweight named-pipe subscription is
  kept warm whenever these cards are configured so transitions do not wait for
  a new snapshot.
- **Starvis (`starvis`)** — full-width assistant, voice, vision, sentry, briefing,
  and activity workspace. Starvis services remain alive when the stage is not
  visible.

The Base card registry currently includes clock, calendar, weather, traffic,
markets, Outlook agenda/mail/to-do, Starvis, direct camera, legacy camera, and
five workstation cards. QML owns presentation and interaction only; each live
domain is backed by a long-lived C++ service singleton.

### Service and data layer

`main.cpp` is the composition root. It creates `SettingsStore`, `SecretVault`,
`HttpClient`, and the domain services once, registers them in
`QtPanel.Native`, and then starts the selected shell host. The service graph is:

| Domain | Native owner | External boundary |
|---|---|---|
| Weather and traffic | `WeatherService`, QML traffic map | Open-Meteo; TomTom tiles/data |
| Markets | `StocksModel` | Yahoo/Finnhub/TradingView; persisted authenticated WebEngine session |
| News and reading | `NewsService`, `ReaderService` | RSS/OPML, article extraction, archive fallback |
| Microsoft | `MsGraphService` | Graph OAuth PKCE, mail, agenda, to-do |
| Live media | `LiveFeedService` | direct HLS and resolved YouTube live feeds; Qt Multimedia |
| PressReader | `PressReaderService` | isolated persistent WebEngine profile and bounded automation |
| Camera and sentry | `DirectCameraClient`, `HikvisionEventClient`, `SentryService` | always-warm RTSP decode, device/local motion events, frame analysis |
| Performance | `WorkstationClient` | `\\.\pipe\WorkstationMonitorTelemetry` at 1 Hz |
| Diagnostics | `DiagnosticsService` | health/status aggregation without blocking the UI |

`QmlNetworkFactory` provides QML network access where a rendered surface needs
it. Secrets are stored in Windows Credential Manager through `SecretVault`;
non-secret layout and behavior state is JSON in
`%APPDATA%\qt-panel\settings.json`. First-run migration imports compatible
`widget-panel` settings.

### Browser and media surfaces

Authenticated or site-dependent content is embedded, never reparented from an
external browser. The general `qt-panel-island` profile serves TradingView,
mail links, and explicit web detail views. The isolated
`qt-panel-pressreader` profile owns PressReader cookies, cache, and permissions.
Both profiles are disk-backed and share the panel's spotlight geometry in QML.
Native content stays native: article reading uses QML, traffic uses an
interactive map, live streams use Qt Multimedia where possible, and the direct
camera keeps a dedicated FFmpeg RTSP-over-TCP decoder warm even while its card
is hidden. Raw fixed-size frames cross the child-process boundary into a
`QVideoSink`, isolating network/demux failures from the Qt UI process.

### Starvis local AI architecture

`StarvisService` is the single reasoning and vision gateway. The default local
provider uses the OpenAI-compatible loopback endpoint at `127.0.0.1:1234` with
one Qwen3-VL 8B model for streamed chat, bounded function-tool loops, image
classification, and gallery comparison. Health polling gates requests and the
Anthropic implementation remains an optional provider fallback. Context is
assembled from weather, markets, news, and workstation services rather than
from visible widgets. `SentryService` subscribes continuously to direct-camera
frames/events, invokes Starvis vision only when policy requires it, maintains
cooldowns and alert state, and reports its badge count through the taskbar
helper. Immediate speech output uses Windows SAPI; Qwen ASR/TTS models remain
optional isolated runtimes because loading them beside the vision model exceeds
the target 10 GB VRAM budget.

### Operational invariants

1. Services that drive alerts, camera readiness, badges, or transition latency
   are resident independently of QML visibility.
2. The UI thread never performs network, model, pipe, or media blocking work.
3. Web authentication state belongs to QtPanel profiles; external browsers are
   used only for explicit external-open commands.
4. Mode, sub-mode, column, card, and width persistence are separate concerns;
   one workspace must not overwrite another workspace's layout.
5. Every release validation starts with `kill-build-processes.ps1`, then uses a
   bounded release build and Qt tests, followed by diagnostics in both
   composition and windowed hosts.
6. The direct camera and Starvis sentry stay responsive while hidden; display
   loaders may unload, but their C++ providers may not.

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
