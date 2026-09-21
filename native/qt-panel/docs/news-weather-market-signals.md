# News read state, official weather alerts and watchlist signals

## News

`NewsReadState` is independent of notification acknowledgement and the news-briefing backlog.
Canonical HTTP URLs discard fragments and common tracking parameters; meaningful query parameters remain.
An article shared by categories has one persistent read state in `wp-news-read-state`.
The first successful snapshot for each category establishes a read baseline. Later arrivals are unread.
Empty/error placeholder feeds never establish that baseline.

Cards, matrix thumbnails and Reading show unread indicators. The filter is shared and persisted.
Carousel exposes a labeled Non lus switch; read faces are subdued, unread faces retain an accent stripe and brighter headline.
Reading has no aggregate category. Its last selected category persists in `wp-news-reading-category`.
Category rows support drag-and-drop with a drop indicator. Both views use the same stored `wp-config.categories` order.
Reordering preserves fetched articles and pending feed state; feed callbacks resolve by category label, not old position.
Controls mark a single story, category or current selection read; a single story can be marked unread again.
Five continuous seconds of a successfully loaded article visible in the Reading pane marks it read.
Switching articles, closing/hiding the pane or panel, changing modes, or reloading resets that dwell timer.
Loading, errors, paywalls and summary-only fallback do not count toward the timer.
Rotation and image hydration never mark read. The actively opened story stays in the filtered rail until closed.

## Official Canadian weather alerts

Source: https://api.weather.gc.ca/collections/weather-alerts
ECCC documentation: https://eccc-msc.github.io/open-data/msc-data/alerts/readme_alerts-datamart_en/

No key required. Every five minutes, request a bounding box around the configured weather location,
then perform point-in-polygon matching (including holes and MultiPolygon) locally. French text is preferred.
Follow pagination before publishing an authoritative snapshot. Reject incomplete/error responses and
retain unexpired previous data with a stale status. Expire locally each minute. Successful empty snapshots,
explicit cancellations and expiration remove active alerts and title-strip notifications.
Changing locations invalidates in-flight results. Alerts appear above the forecast, with expandable official text.
An unavailable check is not an all-clear. Forecast-change notifications remain separate from official ECCC warnings.

## Ranked watchlist movers

`MarketInsights` polls deduplicated symbols from all imported user watchlists, excluding built-in indices.
Requests are sequential, spaced 1.5 seconds apart; a background pass runs every ten minutes.
Ranking is descending absolute percentage change from the preceding daily close, with deterministic symbol ties.
Data older than four days, invalid timezones, future timestamps and missing prices are excluded.
The exchange timezone determines the session date, never the desktop's midnight.
Every row displays the actual quote time and timezone. Old/closed-session quotes are explicitly labelled.
The title strip highlights up to three threshold-qualified movers and up to three volume signals,
deduplicated per symbol and exchange session. This is a watchlist ranking, not a market-wide trending claim.

## Provider evaluation and limits

* Yahoo chart: already used by qt-panel. Verified `range=3mo&interval=1d` supplies exchange timezone,
  quote time and daily OHLCV. Reused without a new key. This is an undocumented consumer endpoint,
  not an exchange-entitled real-time SLA. Failure is reported; unsupported symbols are not invented.
* Volume: current session's cumulative volume divided by the preceding 20 completed session volumes.
  Two times the mean is highlighted. It is NOT time-of-day-normalized relative volume; early-session
  readings are conservative, and no ratio is shown without 20 valid baseline sessions.
* Finnhub company news: optional on-demand related headlines, using the existing `finnhub-key` vault entry.
  Official schema: https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/api/openapi.yaml
  Provider scope is North American companies. Keys are sent in the `X-Finnhub-Token` header, not URLs.
  Fifteen-minute per-symbol caching and a two-second request throttle limit quota usage.
  Missing key, coverage/entitlement errors and quota failures have explicit statuses. Article timestamps
  and sources are shown; headlines are possible context, never asserted causes of a price move.
* Alpha Vantage: https://www.alphavantage.co/documentation/
  Evaluated but not added: top gainers/losers default to end-of-day and real-time/delayed entitlements
  are separate. A new key and potentially paid entitlement add no benefit to the current watchlist path.
* True intraday normalized unusual volume remains dependent on a licensed intraday historical provider.
  No paid subscription or new account was provisioned, and no automatic LLM causal explanation is generated.

## Validation

C++ tests cover canonical duplicate URLs, category baseline, hydration/restart persistence, failed reader loads,
polygons/holes, explicit cancellations, empty snapshots, expiry, volume baselines, ranking/deduplication,
and UTC midnight on New York/Tokyo exchanges. QML tests exercise real carousel wrap without marking read,
Reading filters/current-story retention, weather notification removal, and market session deduplication.
Release validation uses both windowed and composition hosts. No camera frames or private articles are sent to a new provider.
