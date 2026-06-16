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
| Timeout wrappers | Avoid | Do not use `Start-Process` timeout wrappers here; this shell can throw before launching because of duplicate environment keys. |

## Shell And Panel

| Area | Status | Notes |
|---|---|---|
| Left-edge native panel | Implemented | Frameless/tool/topmost Qt window with native controller. |
| Slide/fade choreography | Implemented | QML slide and native hide callback are wired. |
| Pin/unpin and blur-hide guard | Implemented | Controller exposes pin, modal guard, focus policy. |
| Resize handle and persisted width | Implemented | Native controller handles drag resize. |
| Helper TCP protocol | Implemented | AppBar helper integration uses the existing port/protocol. |
| Brave-host web island | Implemented | QML toolbar, controller methods, navigation, loading/error/ready state, timeout feedback, CDP script execution, and wide-panel browser-space reservation exist. |
| Runtime polish validation | Partial | Native diagnostics now include a shell island probe for focus/z-order checks. Still needs screenshot/runtime regression pass. |

## Widget Framework

| Area | Status | Notes |
|---|---|---|
| Six-column layout | Implemented | Uses saved `wp-config.columns`, `wp-col-widths`, and `wp-base-columns`. |
| Stage modes | Implemented | Base/news/monitor/live modes exist. |
| Drag between columns | Implemented | Drops update saved column assignment. |
| In-column ordering | Implemented | Native drag/drop now updates both `wp-config.columns` and `wp-config.activeIds`, matching Electron's persisted order. |
| Widget selection screen | Implemented | `ManageWidgetsModal` is now instantiated from the header grid button and opens on the current mode. |
| Widget enable/disable | Implemented | Mode-aware selector writes `wp-config.activeIds`, covers Base/News/Station/Direct, and preserves disabled categories. |
| OPML import | Implemented | Native OPML import updates categories and active category ids. |
| Widget height persistence | Implemented | Resizable widgets persist `wp-<id>-height`. |

## Mode-By-Mode Gap Analysis

### Base Panel

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Entry shell | Implemented | Native left-edge shell, pin, blur-hide, resize, persisted width, opacity, settings, diagnostics, and helper integration are present. | Screenshot/focus pass with pinned and unpinned states. |
| Column layout | Implemented | Six-column saved layout, base-column count, per-column widths, drag/drop, in-column ordering, and widget height persistence exist. | Verify narrow/wide width presets, reorder persistence, and no text clipping. |
| Widget selection | Implemented | Header grid button opens a mode-aware selector. Base tab covers core cards and writes `wp-config.activeIds`. | Verify disabled base cards stay hidden after restart and do not reappear when modes switch. |
| Card inventory | Partial | Native cards exist for clock, weather, traffic, stocks, calendar, agenda, mail, todo, Starvis, camera, PressReader, news, live feed tiles, and workstation tiles. | Runtime pass with real credentials/devices is still required for Graph, camera, PressReader, Starvis, TradingView, Finnhub, and telemetry. |
| Reader escalation | Partial | News cards can open the native `ReaderOverlay`; the overlay can request an archived version and open the article beside the panel. | Native reader lacks Electron's robust parser stack, image gallery, parse attempts, source mode labels, launch animation, and progress details. |
| Web escalation | Partial | Native cards can open a Brave-host sidecar island with address, refresh, external open, close, loading/error state, timeout feedback, and CDP script hooks. | Does not yet match Electron's in-panel zoom card semantics, live zoom playback controls, or all TradingView/PressReader specialized zoom flows. |
| Visual density | Partial | Card shells and layout are native and generally aligned with the panel direction. | Need card-by-card screenshot comparison for compact copy, badge overflow, hover states, and long localized labels. |

### News Mode

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Mode switching | Implemented | Native expands the panel via `Panel.fitMode("news", ...)`, lays news categories across stage columns, toggles the active mode button back to Base, closes any open island before the transition, and rolls back if native geometry does not apply. | Runtime screenshot pass should confirm width restoration across repeated Base/News switches. |
| Category selection | Implemented | News selector tab lists RSS/OPML categories and preserves disabled categories in `activeIds`. | Validate large OPML imports, duplicate labels, empty categories, and restart persistence. |
| News feed cards | Implemented | Category cards render selected feed items and now support native carousel cards with hero image, one-story rotation, dots, prev/next controls, persisted per-category height, and carousel settings defaulting on. | Needs runtime feed validation for slow/broken feeds, high-volume categories, item de-dupe behavior, and stale cache recovery. |
| News matrix | Implemented | Native has both the `NewsStage3D` headline ring card and a modal `NewsMatrixOverlay` opened from each news category card, with configured feed chips, source fallback chips, story tiles, close behavior, and article handoff into `ReaderOverlay`. | Runtime validate matrix launch from several categories, empty/loading states, and reader handoff z-order. |
| Article reader | Partial | Native reader overlay opens direct and archived articles. | Missing Electron launch ghost, progress bar, reader source label, image gallery, parse diagnostics, paywall/challenge messaging, and robust parser fallbacks. |
| Layout behavior | Partial | News mode uses full stage columns and round-robins categories. | Need screenshot pass for many categories, very long titles, narrow panel width, and carousel/no-carousel modes. |

### Station Mode

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Mode switching | Implemented | Native expands to station/monitor mode, shows monitor-focused columns, toggles the active mode button back to Base, and rolls back if native geometry does not apply. | Confirm label consistency: UI says "Station", internal mode is `monitor`; screenshot repeated switches. |
| Workstation cards | Implemented | CPU, GPU, memory, disk, and network cards are in the native registry and selector, with graph/detail tabs, history charts, GPU engine graphs, VRAM/shared-memory graphs, RAM bandwidth, disk activity, network throughput, and richer metric rows. | Validate against a live WorkstationMonitor pipe, including reconnect, stale state, and service restart. |
| Telemetry activation | Implemented | Native activates the pipe only when workstation cards are visible. | Confirm mode changes deactivate unused telemetry and do not leak pipe subscriptions. |
| Supporting cards | Partial | Station mode includes supporting weather, clock, and stocks columns. | Compare against Electron monitor-stage composition and make any missing support widgets intentional. |
| Monitor stage parity | Partial | Native currently composes cards in `PanelColumns` and the cards now include the Electron advanced graph/detail views. Electron still has a distinct monitor stage path. | Need visual parity review for grouping, density, alert priority, and stage-level affordances. |
| Selector coverage | Implemented | Station selector tab covers station-specific cards. | Verify hide all/enable all and per-card toggles persist independently from Base mode. |

### Direct Mode

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Mode switching | Implemented | Native expands to Direct/live mode, round-robins enabled live feeds across the stage, toggles the active mode button back to Base, and rolls back if native geometry does not apply. | Runtime screenshot repeated Base/Direct switches with and without an island open. |
| Feed selection | Implemented | Direct selector tab lists live feed widgets and now filters visible live feeds by `activeIds`. | Verify disabled feeds stay hidden after restart and after Base/News/Station round trips. |
| Playback | Partial | Native uses Qt Multimedia for direct HLS feeds, treats YouTube feeds as browser-backed Brave island feeds with watch-page and compact embed actions, shows source badges, exposes failure details, and has manual plus automatic retry/error states for HLS feeds. | Needs feed-by-feed runtime validation, long-run stability, reconnect behavior, and unsupported-format handling. |
| Audio policy | Partial | Native has a single-audio owner path and muted default tiles. | Verify handoff across multiple live tiles, mode exit mute behavior, and failure recovery. |
| Live zoom | Partial | Native exposes zoom/open controls for every tile, opens YouTube feeds through normal watch URLs with a compact embed fallback in the Brave island, and opens direct HLS in a lightweight hls.js island. | Runtime validation must decide whether the sidecar island fully replaces an in-panel zoom card for live playback diagnostics. |
| Stage visuals | Partial | Native uses general panel columns for Direct mode. | Compare against Electron `LiveFeedGrid` sizing, badges, controls, and stage-level density. |

## Lightweight Reader Parser Gap Analysis

| Feature | Native Status | Electron Feature / Gap | Next Validation |
|---|---|---|---|
| Direct article fetch | Implemented | Native fetches the article URL and extracts title, image, byline, and paragraphs. | Validate with common sources, slow sources, redirects, encoding variants, and missing metadata. |
| Candidate scoring | Implemented | Native now scores content-attribute/article/main/body candidates by priority, paragraph count, and text length. | Validate against real publisher pages before calling parser parity done. |
| Noise stripping | Partial | Native now strips page chrome and repeated class/id/role noise before extraction. Electron still has a larger cleanup corpus. | Add fixtures for paywalled, syndicated, and hostile markup pages. |
| Paragraph extraction | Partial | Native now extracts paragraphs, headings, list items, blockquotes, hard-stop sections, inline sponsored modules, duplicates, and max block/char budgets. | Compare against Electron on high-value publishers and tune false positives. |
| Plain-text fallback | Implemented | Native now converts cleaned HTML into readable lines when paragraph extraction is too thin. | Validate with nonstandard publisher templates. |
| Image extraction | Partial | Native now returns up to five filtered article images and shows extra thumbnails in the overlay. | Full Electron-style image gallery overlay remains open. |
| Jina reader proxy | Partial | Native now tries Jina reader markdown when direct extraction is too thin and no seed-summary fallback was used, with markdown paragraph/image parsing and attempt diagnostics. | Runtime validate source coverage, privacy expectations, and retry/failure copy. |
| Paywall and bot detection | Implemented | Native detects common paywall and bot/security challenge text/classes and surfaces distinct reader messages. | Expand detection corpus from runtime failures. |
| Publisher feed fallback | Implemented | Native now checks Bloomberg and EETimes RSS feeds for the matching article URL before Jina and can show the publisher feed description as reader content. | Runtime validate exact URL matching and feed coverage on blocked publisher articles. |
| Seed fallback | Implemented | Native now passes RSS descriptions into the reader and can show a feed-summary article when direct fetch fails or extraction is thinner than the seed summary. | Validate against blocked and timeout-prone feeds during runtime testing. |
| Archive fallback | Partial | Native now tries Wayback availability across canonical host/protocol variants, FT content canonical URLs, CDX endpoints, and raw `id_` replay. | Validate failed-replay fallback behavior and archive parsing quality on real blocked publishers. |
| Attempt diagnostics | Partial | Native now records direct, feed-summary, publisher-feed, Jina proxy, and archive parse attempts with bytes, paragraph count, fallback, paywall, challenge, URL, and error flags, and shows them on reader failures. | Runtime validation should tune which attempt rows are shown outside failure states. |
| Reader UI parity | Partial | Native overlay now has source mode labels, paragraph/image counters, clickable thumbnails, full image viewer, paywall/challenge copy, parse attempts, progress strip, archive, external open, and Brave island open. | Missing Electron's launch ghost animation and final card-by-card visual tuning. |

## Zoomed Area / Web Island Gap Analysis

| Feature | Native Status | Electron Feature / Gap | Next Validation |
|---|---|---|---|
| Core zoom surface | Partial | Native opens URLs in a Brave-host sidecar island controlled by `PanelWindowController`, reserves browser space in wide modes, and exposes loading/ready/error/title/current-URL state. | Electron has an in-panel `BrowserIslandCard` zoom area with launch animation, richer progress, diagnostics, webview state, and specialized content flows. Decide whether native sidecar is the final replacement or whether an in-panel zoom card must be ported. |
| Toolbar/navigation | Partial | Native QML toolbar supports back, forward, reload, address entry, external open, close, actual URL/title polling, status badge, error text, loading indicator, and timeout feedback. | Electron tracks loading progress and content flavor metadata more deeply. |
| Launch affordances | Partial | Native cards open the island from traffic, reader articles, PressReader, normal/failed live feeds, stock/event/IPO rows, stock row `TV` buttons, the TradingView heatmap launcher, heatmap tiles, and the separate direct IP camera card. | Runtime validation still needs to prove every island launch path is reliable. |
| Live zoom | Partial | Direct mode now exposes a zoom button for every tile; YouTube feeds open normal watch URLs with a compact embed fallback in the Brave island, and direct HLS feeds open a lightweight hls.js video island. | Runtime validation must confirm YouTube watch/embed playback and hls.js loading/playback in Brave, then decide if an in-panel native zoom card is still required. |
| TradingView heatmap drilldown | Partial | Native opens TradingView chart URLs from each stock row, exposes explicit row `TV` zoom buttons, shows a native overview-backed heatmap preview, opens the TradingView heatmap data URL from a visible Heatmap tab launcher, and captures/syncs cookies. | Runtime validation must confirm Brave sidecar click-through/drilldown behavior and whether native toolbar return controls are sufficient. |
| PressReader automation | Partial | Native opens the catalog island, migrates credentials to Vault, and injects login/start-reading scripts through CDP. | Electron has richer guardrails, cooldowns, auth-state UI, manual-login flow, dark-mode recolor, and interaction tracking. Native needs live validation and missing user feedback states. |
| Microsoft auth/browser | Partial | Native Graph PKCE exists through settings/service paths. | Electron can surface Microsoft auth in the zoom/browser card. Native needs validation that auth handoff is clear and recoverable without the Electron zoom card. |
| Diagnostics | Partial | Native diagnostics can probe the shell island, show island URL/title/status/error, distinguish direct camera from XProtect, open the direct camera URL without credential retries, and report service hooks. | Native should expose enough island/playback errors for runtime debugging without tailing logs. |
| Traffic zoomed map | Partial | Native traffic card renders TomTom raster tiles with +/- zoom, theme controls, a 3x3 slippy tile layer, drag-pan with persisted center, and opens Google Maps in the island. | Gesture parity is intentionally held while the native UI direction settles; runtime tile/key validation remains. |

## Widgets And Services

| Area | Status | Notes |
|---|---|---|
| Clock/calendar/weather | Implemented | Native QML/services exist. |
| Traffic | Implemented | TomTom raster tiles, 3x3 drag-pan layer with persisted center, zoom/theme controls, key from Vault. Hot-reloads key changes. |
| Stocks | Implemented | Yahoo quote model with persisted watchlist tab, RSI/previous-close rows, Finnhub provider/auto fallback, TradingView login/cookie capture/sync/forget UX, explicit stock/event/IPO chart zoom paths, watchlist cache refresh, earnings + IPO calendars, overview-backed native heatmap preview, and visible heatmap period/open controls. Runtime validation with real TradingView/Finnhub sessions remains. |
| News | Implemented | OPML/RSS, category cards, carousel, reader overlay, archive hook, feed-aware matrix overlay, and 3D stage source exist. Carousel settings hot-reload. |
| Microsoft agenda/mail/todo | Implemented | Graph PKCE, token refresh, calendars, mail read, todo complete/list selection, and diagnostics refresh hook exist. Needs live OAuth validation. |
| Live feeds | Partial | Qt Multimedia HLS handles direct feeds; YouTube feeds use browser-backed Brave island playback instead of unreliable native HLS extraction, with primary watch-page and compact embed actions. Every tile has a zoom action, source badge, failure detail, manual retry for HLS feeds, direct HLS zoom uses a lightweight hls.js page, and diagnostics treat YouTube as browser-backed while force-resolving HLS feeds. Needs broader runtime feed validation. |
| Workstation telemetry | Implemented | Named-pipe client exists, is activated by visible workstation cards, and is covered by diagnostics state. Needs external service runtime validation. |
| Camera | Partial | XProtect client/card exist with native server/id/user/password/login-type settings, reconnect/forget, stale-frame watchdog reconnect, GetItems discovery, discovered-camera picker, selected camera persistence, diagnostics discovery hook, and a direct-camera diagnostics launcher. A separate `camera-direct` card opens `wp-camera-direct-url` (default `http://ipcam1.local/doc/page/preview.asp`) in the Brave island and intentionally leaves authentication manual to avoid lockout-prone device retries. Needs end-to-end gateway validation and runtime island validation for the direct camera page. |
| PressReader | Partial | Native card opens configurable Brave-host catalog island, migrates saved login to Vault, exposes URL/login controls, injects auto-login/start-reading automation through brave-host CDP, has pause/resume guardrails with diagnostics, and has diagnostics/open hooks. Needs live credential/session validation. |
| Starvis | Partial | Native Responses chat/briefing/TTS/action queue/tool policy source exists with model/base URL/TTS/workspace/execution controls and diagnostics readiness row. Needs runtime API validation and any remaining prompt/tool parity audit. |

## Settings And Secrets

| Area | Status | Notes |
|---|---|---|
| Legacy settings import | Implemented | Imports Electron `%APPDATA%/widget-panel/config.json` on first run. |
| Vault migration | Implemented | Moves known secrets into Windows Credential Manager. |
| Settings sheet | Implemented | Covers opacities, location, core keys, Graph client, Starvis model/TTS/base URL/workspace/execution, camera connection/discovery, PressReader credentials/URL, TradingView session actions, market provider, diagnostics, carousel, columns, sound, autostart. |
| Advanced service settings | Implemented | Starvis, camera, PressReader, TradingView session, market provider, and runtime diagnostics controls are native. |

## Highest-Value Next Work

1. Runtime test reader fallback ordering: direct parser, feed summary, publisher feed, Jina proxy, and archive CDX/replay on real blocked publishers.
2. Runtime test Microsoft OAuth, live feeds, WorkstationMonitor pipe, camera gateway, PressReader, Starvis API calls, TradingView session capture, and Finnhub quotes with real credentials/devices.
3. Run shell screenshots/focus/z-order regression with the diagnostics island probe open.
4. Audit the remaining Electron renderer-only affordances card-by-card after runtime testing to catch any interaction-level parity gaps.
5. Keep using the elevated NMake fallback when the sandbox blocks Qt child processes or Ninja wedges after generation.
