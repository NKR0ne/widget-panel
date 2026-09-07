# Integrated Windows Media Player Card

## Playback

The Media Player card owns a Windows.Media.Playback.MediaPlayer and
MediaPlaybackList inside qt-panel. It does not launch Microsoft.ZuneMusic,
wmplayer.exe, ActiveX, or an external/default application. This is native Windows
audio playback with a Qt interface, not an embedding of Microsoft's application.

Lecture provides artwork, title/artist/album, play/pause/stop, position, previous/
next, shuffle and repeat-one/repeat-all. Volume is adjusted through Windows,
without a separate volume control in the card. The queue runs
independently of card visibility and mode switches. Playback does not start at
login. Starvis speech temporarily mutes this player's output without replacing
its selected volume. The Windows playback list handles sequencing and media keys.

## Ambient Windows Library

The current Windows account is used automatically; no additional sign-in:
- Registered Music.library-ms locations, including known/public Music folders.
- Previously selected Qt Panel folders, with persistent exclusions when removed.
- Read-only Media Player catalog import from the current user's
  Microsoft.ZuneMusic LocalState/MediaPlayer.db.
- Album and artist metadata, track/disc ordering, and existing playlists.
- WPL, ZPL, M3U/M3U8, PLS and XSPF playlists found in the folders or imported
  explicitly. File-backed playlists supply their original order and duplicates.
- Local cover files and Windows music thumbnails, cached in the Qt profile.

Media Player's database is opened read-only with query_only enabled. Its private
schema is not an official synchronization contract: incompatible/missing tables
fall back to folder browsing with a status message. Qt Panel never writes to
Media Player's database, library definitions, music files or original playlists.
Removed folders are excluded only from the Qt card.

Catalog and Windows-library definition timestamps are checked every 15 seconds.
Changes trigger background refresh without restarting playback. Cached catalog
content appears immediately at startup, followed by refreshed data and covers.
Albums without local artwork retain an explicit placeholder; no cover lookup is
sent to an online service.

## Implementation

WindowsMediaService is exposed as WinMedia. The playback engine runs on an MTA
worker, the catalog on a separate worker; no media loading occurs on the UI
thread. Engine state is sampled every 400 ms. Media failure callbacks use a
shared synchronized error state, without touching QML from Windows callbacks.

MediaCatalog reads SQLite through Qt SQL and parses playlists/library XML through
structured parsers. It ignores remote playlist entries. Folder scans, result
counts, playlist sizes and cover passes are bounded; unavailable filesystem
operations themselves can take longer. Thumbnails have two-second operation
deadlines. Partial catalog results are published before cover extraction.

Music is the scope of this card. It does not recreate Microsoft's video UI,
cloud account features, catalog editing, or playlist write-back.

## Validation

Run build.ps1 -Tests -BuildTimeoutSeconds 180. The build automatically stages
Qt6Sql and its SQLite driver when missing. Tests cover library classification and
bounds, playlist ordering/remote rejection, unchanged source database bytes,
QML controls, seeking, album/playlist selection and compact/tall screenshots.

Test builds also deploy the test executable's own Qt runtime, including Qt6Test,
so direct diagnostics do not require Qt on PATH. Installers exclude test binaries
and remove those accidentally shipped by older installations.

Opt-in live tests use silent audio at zero music volume:

```powershell
$env:QT_PANEL_TEST_LOCAL_PLAYER = '1'
.\build\release\qt-panel-tests.exe mediaNativePlayerIntegration mediaAmbientCatalogIntegration
Remove-Item Env:QT_PANEL_TEST_LOCAL_PLAYER
```

The native test checks pause, seek, queue selection, end-of-track advancement,
repeat-one and music duck/restore. The ambient test reads the current user's
catalog, extracts local covers into a temporary test cache, and never starts
the Microsoft Media Player application.
