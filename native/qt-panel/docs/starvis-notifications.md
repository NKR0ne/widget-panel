# Starvis notifications

The application-wide Notifications singleton subscribes to existing services.
It is instantiated by PanelSurface and continues collecting while modes change
or the panel is hidden. No language model is involved in notification rules.

The header rotates unread entries every 10 seconds, pauses on hover/focus and
opens a persistent, bounded history from the bell. Read status and source
preferences are stored in SettingsStore. Camera announcements and sustained
performance pressure have priority. Quiet hours suppress routine header entries
between 22:00 and 07:00 without discarding history or changing camera speech.

## Sources

- News: successful category results establish a baseline. Subsequent arrivals
  are grouped by category. Image enrichment updates do not create new entries.
- CPU/GPU/RAM: 95 percent for 30 seconds by default. Rearm after 30 seconds below
  85 percent. Missing/stale telemetry resets the timing. Performance monitoring
  keeps telemetry active even without monitor cards configured.
- Weather: existing Open-Meteo condition changes or a five-degree temperature
  change. These are not official weather warnings or nowcast predictions.
- Markets: threshold-crossing daily changes from the currently polled market
  list, including a selected watchlist. The provider's quote timestamp is shown;
  deduplication uses the quote session date and symbol. This is a mover notice,
  not a claim of social popularity. No additional quote polling is introduced.
- Camera: Sentry emits voiceAnnouncementRequested immediately after requesting
  actual-event speech. This means speech was requested, not proof that an audio
  device played it successfully. Test announcements are excluded. Snapshot and
  local-only vision settings are unchanged.

## News briefing

The card's news briefing command summarizes pending titles and RSS excerpts
using the user's configured Starvis provider. Local requests use the same
bounded direct-answer path as the existing daily briefing. Sources are treated
as untrusted text and no web/tools are enabled. This is an excerpt-based digest,
not a claim that full articles were read.

Up to 40 articles are submitted per request. Only those keys are removed after
a successful response; new arrivals, cancellation and errors retain pending
work. First use can summarize the existing feed baseline. Pending content is
bounded to the most recent 500 articles, and per-category seen keys to 1,000.
The last successful text is persisted and can be replayed with the speaker
button. Camera images are never included in a news briefing.

## Validation

NotificationRules QML tests cover sustained load, hysteresis, duplicate alerts,
short spikes, missing metrics, article identity and arrivals during briefing.
The release build and existing suite must pass before installation. Application
startup is checked in both composition and windowed hosts. Live speech and
model response quality depend on the configured services and require runtime
validation with those services available.

Optional Windows system toasts and additional voice announcements are not part
of this in-panel release. Existing camera speech remains under Sentry settings.
