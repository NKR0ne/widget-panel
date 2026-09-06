# Camera analysis recovery - 2026-09-06

## Failure

Camera analytics were firing correctly, but local classification consistently
exceeded the 120-second timeout. The live vision process used `-ngl 0` plus
CPU-only projector, operation and KV-cache flags. Two Starvis reasoning processes
were also loaded. Total GPU usage before recovery was approximately 9,051 MiB.

The existing alert policy intentionally records an unverified camera event as a
notice with "analyse indisponible" rather than silently dropping a perimeter alarm.

## Correction

- Shared, named startup mutex covers both model launch and readiness, preventing
  a second launch while a model is still loading. Readiness has a 75-second limit.
- Ownership checks require the exact executable, alias and port. Duplicate cleanup
  preserves the listening instance; unrelated programs and LM Studio are untouched.
- Vision starts before reasoning and reserves GPU memory first. Reasoning offloads
  only as many layers as the remaining memory budget permits.
- Camera vision requests have a 30-second deadline, independent of network activity.
  Explicit cancellation remains cancellation; a deadline is reported as failure.
- Only one local vision request runs at a time, preventing queued stale frames.
- Closing an operation also aborts its outstanding HTTP request.

Automatic cloud retry was not added. The user explicitly chose local-only camera
analysis. The existing `allowCloudVision` setting was changed from true to false
with Qt Panel stopped, then the app was restarted to apply that privacy choice.

## Verification

- Release build and all three CTest suites passed: core, News QML and runtime scripts.
- New tests cover deadline versus cancellation, busy-request rejection, duplicate
  cleanup, exact process ownership, cold start and protection of unrelated listeners.
- Runtime: one vision server (`-ngl 99`), one reasoning server (`-ngl 8`). Repeating
  the reasoning launcher reused the process. GPU usage was approximately 8,870 MiB.
- Synthetic vision fixture: 3.399 seconds. Both shape counts were correct; the tiny
  text label was misread. This is a latency check, not a claim of perfect recognition.
- Warm perimeter-schema request: 0.68 seconds; valid JSON, no person, no threat.
  Both requests stayed on localhost. No live-camera/cloud accuracy claim is made.
- Installed executable matched the release hash, startup points to the installed
  executable, and Qt Panel confirmed all local services ready after restart.

Tradeoff: reasoning now performs more CPU work to keep camera verification responsive.
Other GPU-heavy applications can still reduce available capacity; unavailable analysis
must continue to produce an honest, unverified warning rather than a fabricated result.
