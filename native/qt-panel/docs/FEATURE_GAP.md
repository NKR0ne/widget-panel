# qt-panel Feature Gap Ledger

This is the source-based parity ledger for the native Qt rewrite. "Implemented"
means the code path exists in `native/qt-panel`; "partial" means source exists
but parity, controls, or runtime validation are incomplete.

## Build And Stall Control

| Area | Status | Notes |
|---|---|---|
| Documented build flow | Implemented | `build.ps1` defaults to NMake, supports `-Tests`, reuses compatible CMake state, keeps test support sticky to avoid `-Tests`/`-Deploy` QML regeneration, excludes tests from normal builds, skips the phony Qt QML target when app inputs are unchanged, provides `-Reconfigure`, and delegates `-Run` to bounded `launch.ps1`. A post-test no-op release invocation completed in 2.9 seconds on 2026-07-12. |
| Pre-build cleanup | Implemented | `kill-build-processes.ps1` clears Qt/MSVC build tools and `qt-panel` while preserving the Electron-owned `taskbar-btn` and `brave-host` helpers unless `-IncludeRuntimeHelpers` is requested. |
| PowerShell PATH normalization | Implemented | `build.ps1` normalizes duplicate `Path`/`PATH` inherited by this environment. |
| Build and smoke deadlines | Implemented | Native commands have explicit configure/build/test deadlines. `launch.ps1 -ExitAfterMs` waits for the real process, force-stops it after a bounded grace period, and propagates non-zero exits. |

## Shell And Panel

| Area | Status | Notes |
|---|---|---|
| Left-edge native panel | Implemented | Frameless/tool/topmost Qt window with native controller. |
| Slide/fade choreography | Implemented | QML slide and native hide callback are wired. |
| Pin/unpin and blur-hide guard | Implemented | Controller exposes pin, modal guard, focus policy. |
| Resize handle and persisted width | Implemented | Native controller handles drag resize. |
| Helper TCP protocol | Implemented | AppBar helper integration uses the existing port/protocol. |
| Windows startup ownership | Implemented | The Electron and standalone-helper login entries were removed on 2026-07-11. Deployed builds register `qt-panel.exe` directly; undeployed development builds register the hidden `launch.ps1` bootstrap so Qt DLL/plugin discovery survives a cold login. Existing enabled entries self-migrate. |
| Brave-host web island | Implemented | QML toolbar, controller methods, navigation, loading/error/ready state, timeout feedback, CDP script execution, and wide-panel browser-space reservation exist. |
| Runtime polish validation | Partial | Isolated D3D11 startup plus compact/wide screenshot and geometry checks passed on 2026-07-10. The diagnostics island focus/z-order probe still needs an interactive regression pass. |

## Widget Framework

| Area | Status | Notes |
|---|---|---|
| Expandable column layout | Implemented | Uses saved `wp-config.columns`, `wp-col-widths`, and `wp-base-columns`; the header exposes a persisted 3-6 column stepper and fits the native window after each change. |
| Stage modes | Implemented | Dedicated News, Station, and Direct workspaces use the full stage width and honor the shared active-widget selection. |
| Drag between columns | Implemented | Drops update saved column assignment. |
| In-column ordering | Implemented | Native drag/drop now updates both `wp-config.columns` and `wp-config.activeIds`, matching Electron's persisted order. |
| Widget selection screen | Implemented | `ManageWidgetsModal` is now instantiated from the header grid button and opens on the current mode. |
| Widget enable/disable | Implemented | Mode-aware selector writes `wp-config.activeIds`, covers Base/News/Station/Direct, and preserves disabled categories. |
| OPML import | Implemented | Native OPML import updates categories and active category ids. |
| Widget height persistence | Implemented | Resizable widgets persist `wp-<id>-height`. |
| Card collapse persistence | Implemented | Tapping a draggable title region toggles the Electron-compatible `wp-expanded` state without restoring overlay drag handles. |
| Global refresh | Implemented | Header refresh updates weather, stocks, market calendars, news, and Microsoft Graph; Direct also force-resolves live feeds. Camera authentication is intentionally excluded. |

## Mode-By-Mode Gap Analysis

### Base Panel

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Entry shell | Implemented | Native left-edge shell, pin, blur-hide, resize, persisted width, opacity, settings, diagnostics, and helper integration are present. | Screenshot/focus pass with pinned and unpinned states. |
| Column layout | Implemented | Six-column saved layout, base-column count, per-column widths, drag/drop, in-column ordering, and widget height persistence exist. | Verify narrow/wide width presets, reorder persistence, and no text clipping. |
| Widget selection | Implemented | Header grid button opens a mode-aware selector. Base tab covers core cards and writes `wp-config.activeIds`. | Verify disabled base cards stay hidden after restart and do not reappear when modes switch. |
| Card inventory | Partial | Native cards exist for the full fixed Electron inventory plus native direct-camera and news-stage cards. Clock, weather, traffic, calendar, Agenda, Mail, To Do, Camera, and Markets/Stocks have received depth-first passes. | PressReader, Starvis, Finnhub credentials, and specialized zoom flows still need deeper runtime validation. |
| Reader escalation | Implemented | News cards open the native `ReaderOverlay`, which supports direct/feed/publisher/Jina/archive attempts, progress and source state, image inspection, parse diagnostics, and Brave/external escalation. | Runtime validate fallback ordering and blocked publishers; Electron's launch ghost is intentionally not a native parity requirement. |
| Web escalation | Partial | Native cards can open a Brave-host sidecar island with address, refresh, external open, close, loading/error state, timeout feedback, and CDP script hooks. | Does not yet match Electron's in-panel zoom card semantics, live zoom playback controls, or all TradingView/PressReader specialized zoom flows. |
| Visual density | Partial | Card shells and layout are native and generally aligned with the panel direction. | Need card-by-card screenshot comparison for compact copy, badge overflow, hover states, and long localized labels. |

### News Mode

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Mode switching | Implemented | Native expands the panel via `Panel.fitMode("news", ...)`, lays news categories across stage columns, toggles the active mode button back to Base, closes any open island before the transition, and rolls back if native geometry does not apply. | Runtime screenshot pass should confirm width restoration across repeated Base/News switches. |
| Category selection | Implemented | News selector tab lists RSS/OPML categories and preserves disabled categories in `activeIds`. | Validate large OPML imports, duplicate labels, empty categories, and restart persistence. |
| News feed cards | Implemented | Category cards render selected feed items and now support native carousel cards with hero image, one-story rotation, dots, prev/next controls, persisted per-category height, and carousel settings defaulting on. | Needs runtime feed validation for slow/broken feeds, high-volume categories, item de-dupe behavior, and stale cache recovery. |
| News matrix | Implemented | Native has both the `NewsStage3D` headline ring card and a modal `NewsMatrixOverlay` opened from each news category card, with configured feed chips, source fallback chips, story tiles, close behavior, and article handoff into `ReaderOverlay`. | Runtime validate matrix launch from several categories, empty/loading states, and reader handoff z-order. |
| Article reader | Implemented | Native reader opens direct and archived articles with feed-summary, publisher-feed, Jina, and archive fallbacks; source/progress/attempt state, paywall/challenge feedback, and full image inspection are present. | Runtime validate each fallback against representative publishers and tune extraction fixtures from failures. |
| Layout behavior | Implemented | Dedicated News uses a category rail plus an adaptive 1-5 column card grid. A 15-category D3D11 run at 2174x1166 confirmed five balanced columns on 2026-07-11. | Continue runtime coverage for very long titles, broken feeds, and carousel-disabled mode. |

### Station Mode

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Mode switching | Implemented | Native expands to station/monitor mode, shows monitor-focused columns, toggles the active mode button back to Base, and rolls back if native geometry does not apply. | Confirm label consistency: UI says "Station", internal mode is `monitor`; screenshot repeated switches. |
| Workstation cards | Implemented | CPU, GPU, memory, disk, and network cards are in the native registry and selector, with graph/detail tabs, history charts, GPU engine graphs, VRAM/shared-memory graphs, RAM bandwidth, disk activity, network throughput, and richer metric rows. | Validate against a live WorkstationMonitor pipe, including reconnect, stale state, and service restart. |
| Telemetry activation | Implemented | Native activates the pipe only when workstation cards are visible. | Confirm mode changes deactivate unused telemetry and do not leak pipe subscriptions. |
| Supporting cards | Implemented | Station has a scrollable Clock/Weather/Stocks rail that honors widget selection and collapses completely when no support cards are enabled. | Continue density tuning from daily use. |
| Monitor stage parity | Implemented | Dedicated native Station uses the Electron 2-primary plus 3-secondary telemetry hierarchy, selector-aware card visibility, live/stale status, and full-width responsive packing. | Alert-priority tuning and longer reconnect testing remain. |
| Selector coverage | Implemented | Station selector tab covers station-specific cards. | Verify hide all/enable all and per-card toggles persist independently from Base mode. |

### Direct Mode

| Feature | Native Status | Electron Parity / Gap | Next Validation |
|---|---|---|---|
| Mode switching | Implemented | Native expands to Direct/live mode, round-robins enabled live feeds across the stage, toggles the active mode button back to Base, and rolls back if native geometry does not apply. | Runtime screenshot repeated Base/Direct switches with and without an island open. |
| Feed selection | Implemented | Direct selector tab lists live feed widgets and now filters visible live feeds by `activeIds`. | Verify disabled feeds stay hidden after restart and after Base/News/Station round trips. |
| Playback | Partial | Native uses Qt Multimedia for direct HLS feeds, treats YouTube feeds as browser-backed Brave island feeds with watch-page and compact embed actions, shows source badges, exposes failure details, and now applies bounded resolution/playback-start guards plus capped exponential recovery. LCN and Euronews reached `playing` in an isolated D3D11 Direct run on 2026-07-12; all current YouTube provider probes returned `Video unavailable` and cleanly exposed browser fallback. | Needs long-run stability, forced reconnect, unsupported-format, and real Brave playback validation. |
| Audio policy | Partial | Native has a single-audio owner path and muted default tiles, rejects unknown owners, and releases ownership when a card fails or is destroyed. | Verify live handoff across multiple tiles and browser-island audio behavior. |
| Live zoom | Partial | Native exposes zoom/open controls for every tile, opens YouTube feeds through normal watch URLs with a compact embed fallback in the Brave island, and opens direct HLS in a lightweight hls.js island. | Runtime validation must decide whether the sidecar island fully replaces an in-panel zoom card for live playback diagnostics. |
| Stage visuals | Implemented | Dedicated Direct uses the Electron two-column feed hierarchy, shared refresh/mute controls, active-feed filtering, and an empty state. | Continue control-density tuning from daily use. |

## Lightweight Reader Parser Gap Analysis

| Feature | Native Status | Electron Feature / Gap | Next Validation |
|---|---|---|---|
| Direct article fetch | Implemented | Native fetches the article URL and extracts title, image, byline, and paragraphs. | Validate with common sources, slow sources, redirects, encoding variants, and missing metadata. |
| Candidate scoring | Implemented | Native now scores content-attribute/article/main/body candidates by priority, paragraph count, and text length. | Validate against real publisher pages before calling parser parity done. |
| Noise stripping | Implemented | Native strips script/style/chrome and repeated class/id/role noise, inline promotions, and related-content tails. Hostile-markup regression coverage is present. | Expand the fixture corpus from real publisher failures. |
| Paragraph extraction | Implemented | Native extracts paragraphs, headings, list items, blockquotes, hard-stop sections, inline sponsored modules, duplicates, and bounded block/character budgets. Structural-block regression coverage is present. | Validate high-value publishers and tune false positives from evidence. |
| Plain-text fallback | Implemented | Native now converts cleaned HTML into readable lines when paragraph extraction is too thin. | Validate with nonstandard publisher templates. |
| Image extraction | Implemented | Native resolves relative/protocol-relative URLs, filters chrome/tracking images, deduplicates up to five article images, shows thumbnails, and opens a full image viewer. Regression coverage verifies filtering and URL handling. | Runtime validate lazy-image conventions not represented by `src`, `data-src`, or `data-original`. |
| Jina reader proxy | Partial | Native now tries Jina reader markdown when direct extraction is too thin and no seed-summary fallback was used, with markdown paragraph/image parsing and attempt diagnostics. | Runtime validate source coverage, privacy expectations, and retry/failure copy. |
| Paywall and bot detection | Implemented | Native detects common paywall and bot/security challenge text/classes and surfaces distinct reader messages. | Expand detection corpus from runtime failures. |
| Publisher feed fallback | Implemented | Native now checks Bloomberg and EETimes RSS feeds for the matching article URL before Jina and can show the publisher feed description as reader content. | Runtime validate exact URL matching and feed coverage on blocked publisher articles. |
| Seed fallback | Implemented | Native now passes RSS descriptions into the reader and can show a feed-summary article when direct fetch fails or extraction is thinner than the seed summary. | Validate against blocked and timeout-prone feeds during runtime testing. |
| Archive fallback | Partial | Native now tries Wayback availability across canonical host/protocol variants, FT content canonical URLs, CDX endpoints, and raw `id_` replay. | Validate failed-replay fallback behavior and archive parsing quality on real blocked publishers. |
| Attempt diagnostics | Implemented | Native records direct, feed-summary, publisher-feed, Jina proxy, and archive attempts with bytes, paragraph count, fallback, paywall, challenge, URL, and errors, and exposes them in the reader. | Runtime validation should tune how much detail is shown for successful reads. |
| Reader native UI | Implemented | The overlay has source labels, paragraph/image counters, thumbnails, full image viewer, paywall/challenge copy, parse attempts, progress, archive, external open, and Brave island actions. | Final visual-density and long-content validation remains; Electron-specific launch choreography is intentionally excluded. |

## Zoomed Area / Web Island Gap Analysis

| Feature | Native Status | Electron Feature / Gap | Next Validation |
|---|---|---|---|
| Core zoom surface | Implemented | The native direction uses a Brave-host sidecar controlled by `PanelWindowController`, with reserved mode space, a dedicated persistent island profile, deterministic process cleanup, and CDP-backed URL/title/readiness/history/error state. | Site-specific authentication and playback remain runtime concerns; an Electron-style in-panel webview is intentionally not required. |
| Toolbar/navigation | Implemented | Native QML supports state-aware Back/Forward, reload, address entry, external open, close, URL/title polling, readiness/error status, loading feedback, and timeout handling. Disabled history controls now reflect CDP navigation state. | Continue visual-density tuning from daily use. |
| Launch affordances | Partial | Native cards open the island from traffic, reader articles, PressReader, normal/failed live feeds, stock/event/IPO rows, stock row `TV` buttons, the TradingView heatmap launcher, heatmap tiles, and the separate direct IP camera card. | Runtime validation still needs to prove every island launch path is reliable. |
| Live zoom | Partial | Direct mode now exposes a zoom button for every tile; YouTube feeds open normal watch URLs with a compact embed fallback in the Brave island, and direct HLS feeds open a lightweight hls.js video island. | Runtime validation must confirm YouTube watch/embed playback and hls.js loading/playback in Brave, then decide if an in-panel native zoom card is still required. |
| TradingView heatmap drilldown | Partial | Native opens chart and heatmap paths, accepts cookies only from exact TradingView domains, automatically syncs after capture, and refreshes existing-session watchlists every 60 seconds without resetting unchanged models. Existing-session refresh loaded two lists on 2026-07-12. | Runtime validation must still confirm a fresh TradingView sign-in/capture and real heatmap/chart drilldown. |
| PressReader automation | Implemented | Native opens the catalog island, keeps credentials in Vault, injects/reinjects login and start-reading scripts through the now-validated CDP evaluation protocol, submits once per page signature, pauses around trusted user interaction, and exposes pause/resume/manual modes. | Live credential/session validation remains; dark-mode page recoloring is presentation rather than a functional parity blocker. |
| Microsoft auth/browser | Implemented | Native Graph PKCE now opens inside the Brave island, validates OAuth `state`, closes the island after a successful callback, supports explicit cancellation, and surfaces token, callback-port, timeout, provider, and code-exchange errors in the Microsoft cards. Invalid refresh credentials are cleared so the user can recover through interactive sign-in. | Existing-token startup loaded agenda, mail, and To Do successfully on 2026-07-11. A fresh-account interactive sign-in still needs credentialed runtime validation without disturbing the working profile. |
| Diagnostics | Implemented | Native diagnostics expose island URL/title/status/error and service probes. `native/brave-host/test-protocol.ps1` performs a bounded real-browser check of state, evaluation, cookies, navigation, Back, and cleanup; it passed on 2026-07-11. | Extend site-specific diagnostics only when runtime failures show missing evidence. |
| Traffic zoomed map | Implemented | Native traffic uses the Electron CARTO/Esri base sources, optional TomTom overlay, four persisted themes, 3x3 drag-pan, persisted zoom, local-only center movement, and Google Maps island escalation. The base map remains usable without a TomTom key. | Gesture additions remain intentionally deferred while the native UI direction settles. |

## Widgets And Services

| Area | Status | Notes |
|---|---|---|
| Clock/calendar/weather | Implemented | Clock restores the animated analog face; Calendar has month/year navigation and today reset; Weather has current/hourly detail plus a persisted-height, scrollable 14-day table with precipitation, wind, and ranges. |
| Traffic | Implemented | CARTO/Esri base maps, optional TomTom flow tiles, exact Electron theme set, local drag-pan, persisted zoom/theme, and key hot reload are native. |
| Stocks | Implemented | Yahoo quote model with stable-ID watchlist persistence, list-order-safe Earnings/IPO/Heatmap tabs, RSI/previous-close rows, Finnhub provider/auto fallback, strict-domain TradingView cookie capture with automatic/periodic sync, unchanged-cache suppression, chart zoom paths, earnings + IPO calendars, and a native heatmap preview/full heatmap launcher. A normal-profile run refreshed two existing-session lists and loaded 30 earnings plus 24 IPO rows without QML errors on 2026-07-12. Fresh login, Finnhub, and live heatmap drilldown remain credentialed runtime checks. |
| News | Implemented | OPML/RSS, category cards, carousel, reader overlay, archive hook, feed-aware matrix overlay, and 3D stage source exist. Carousel settings hot-reload. |
| Microsoft agenda/mail/todo | Implemented | Graph PKCE/token refresh, correct all-calendar exclusion, one-month grouped/resizable Agenda, 50-message scrollable Mail with read/delete/junk actions, and To Do list selection/create/complete are native. A normal-profile run loaded 45 events and 50 messages without QML warnings on 2026-07-11. |
| Live feeds | Partial | Qt Multimedia HLS handles direct feeds; YouTube feeds use browser-backed Brave island playback when native manifest extraction is unavailable, with primary watch-page and compact embed actions. The catalog now matches the Electron Bloomberg and France 24 IDs; every tile has bounded startup/recovery, zoom, source, failure, and manual retry paths. LCN and Euronews played successfully in an isolated Direct run on 2026-07-12. Needs long-run and Brave YouTube playback validation. |
| Workstation telemetry | Implemented | Named-pipe client exists, is activated by visible workstation cards, and is covered by diagnostics state. Needs external service runtime validation. |
| Camera | Partial | XProtect client/card now include bounded 30-second requests, generation-safe command/frame/reconnect cancellation, thread-safe image handoff, a 10-second first-frame and 30-second stale-frame watchdog, GetItems discovery/picker, and credential fallback only for explicit code-15 rejection. Rejected credentials are cleared after the bounded sequence, and a login type is persisted only after stream access succeeds. The separate `camera-direct` card remains strictly manual and never probes device credentials. An isolated credential-free startup passed on 2026-07-12. | Needs end-to-end XProtect gateway validation and manual runtime validation of the direct camera island. |
| PressReader | Implemented | Native card opens the configurable Brave-host catalog island, migrates login to Vault, exposes URL/login controls, reinjects guarded auto-login/start-reading automation across navigation, pauses around user interaction, supports pause/resume/manual mode, and has diagnostics/open hooks. Build and startup validation passed on 2026-07-11; live credential/session validation remains. |
| Starvis | Implemented | Native Responses chat/briefing/TTS, local context, Web permission retry/deny, read-only agent tools, persisted approval queue, recent outcomes, execution gate, protected-path policy, revalidation at approval, commit execution, and two-step push approval are present with model/base URL/TTS/workspace controls. Startup was clean with a configured service on 2026-07-11. Live chat/TTS and deliberately staged action execution still need credentialed runtime validation. |

## Settings And Secrets

| Area | Status | Notes |
|---|---|---|
| Legacy settings import | Implemented | Imports Electron `%APPDATA%/widget-panel/config.json` on first run. |
| Vault migration | Implemented | Moves known secrets into Windows Credential Manager. |
| Settings sheet | Implemented | Covers opacities, location, core keys, Graph client, Starvis model/TTS/base URL/workspace/execution, camera connection/discovery, PressReader credentials/URL, TradingView session actions, market provider, diagnostics, carousel, columns, sound, autostart. |
| Advanced service settings | Implemented | Starvis, camera, PressReader, TradingView session, market provider, and runtime diagnostics controls are native. |

## Highest-Value Next Work

1. Runtime test reader fallback ordering: direct parser, feed summary, publisher feed, Jina proxy, and archive CDX/replay on real blocked publishers.
2. Runtime test camera gateway, PressReader, Starvis chat/TTS and deliberately staged approval actions, TradingView session capture, Finnhub quotes, and long-run live/audio behavior with real credentials/devices.
3. Run shell screenshots/focus/z-order regression with the diagnostics island probe open.
4. Continue depth-first runtime audits: Markets/Stocks, XProtect and direct camera, PressReader, Starvis action staging, then specialized zoom behavior.
5. Keep build and launch validation on the documented incremental NMake scripts with isolated profiles and bounded exits; use `-Reconfigure` only when required.
