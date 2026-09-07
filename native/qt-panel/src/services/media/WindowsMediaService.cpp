#include "WindowsMediaService.h"
#include "MediaLibrary.h"
#include "MediaCatalog.h"
#include "core/SettingsStore.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QSaveFile>
#include <QMutex>
#include <QMutexLocker>
#include <QDebug>
#include <QDateTime>
#include <cmath>
#include <memory>
#include <Windows.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Media.Core.h>
#include <winrt/Windows.Media.Playback.h>
#include <winrt/Windows.Storage.Streams.h>

namespace qtpanel {
namespace {
using namespace winrt::Windows::Media;
using namespace winrt::Windows::Media::Core;
using namespace winrt::Windows::Media::Playback;
QString qs(const winrt::hstring& text) { return QString::fromWCharArray(text.c_str()); }
QString databasePath() {
    return QDir(qEnvironmentVariable("LOCALAPPDATA")).filePath("Packages/Microsoft.ZuneMusic_8wekyb3d8bbwe/LocalState/MediaPlayer.db");
}
struct PlaybackEvents { QMutex mutex; QString error; };
}

class WindowsMediaWorker : public QObject {
public:
    bool initialized = false;
    MediaPlayer player{nullptr};
    MediaPlaybackList list{nullptr};
    QVariantList tracks;
    double volume = 0.5;
    bool ducked = false, stopped = false;
    int repeat = 0;
    std::shared_ptr<PlaybackEvents> events = std::make_shared<PlaybackEvents>();
    MediaPlayer::MediaFailed_revoker failed;
    MediaPlaybackList::ItemFailed_revoker itemFailed;
    ~WindowsMediaWorker() override {
        failed.revoke(); itemFailed.revoke();
        if (player) { player.Pause(); player.Source(nullptr); player.Close(); }
        list = nullptr; player = nullptr;
        if (initialized) winrt::uninit_apartment();
    }
    void initialize() {
        if (player) return;
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        initialized = true;
        player = MediaPlayer();
        player.AutoPlay(false);
        player.Volume(ducked ? 0 : volume);
        failed = player.MediaFailed(winrt::auto_revoke, [state = events](const auto&, const MediaPlayerFailedEventArgs& args) {
            QMutexLocker lock(&state->mutex);
            state->error = "Lecture indisponible : " + qs(args.ErrorMessage());
        });
    }
    void setQueue(const QVariantList& items, int index) {
        initialize();
        MediaPlaybackList next;
        next.MaxPlayedItemsToKeepOpen(1);
        for (const auto& value : items) {
            const auto track = value.toMap();
            MediaPlaybackItem item(MediaSource::CreateFromUri(winrt::Windows::Foundation::Uri(track.value("url").toString().toStdWString())));
            const auto display = item.GetDisplayProperties();
            display.Type(MediaPlaybackType::Music);
            display.MusicProperties().Title(track.value("title").toString().toStdWString());
            display.MusicProperties().Artist(track.value("artist").toString().toStdWString());
            display.MusicProperties().AlbumTitle(track.value("album").toString().toStdWString());
            const QUrl cover(track.value("artwork").toString());
            if (cover.isLocalFile()) display.Thumbnail(winrt::Windows::Storage::Streams::RandomAccessStreamReference::CreateFromUri(winrt::Windows::Foundation::Uri(cover.toString().toStdWString())));
            item.ApplyDisplayProperties(display);
            next.Items().Append(item);
        }
        next.StartingItem(next.Items().GetAt(static_cast<uint32_t>(index)));
        next.AutoRepeatEnabled(repeat == 2);
        itemFailed.revoke();
        itemFailed = next.ItemFailed(winrt::auto_revoke, [state = events](const auto&, const MediaPlaybackItemFailedEventArgs&) {
            QMutexLocker lock(&state->mutex);
            state->error = "Fichier indisponible ou format audio non pris en charge par Windows.";
        });
        { QMutexLocker lock(&events->mutex); events->error.clear(); }
        tracks = items; list = next; stopped = false;
        player.Source(list); player.Play();
    }
    QVariantMap snapshot() {
        if (!player || !list || tracks.isEmpty()) return {{"connected", false}, {"volume", volume * 100}, {"engine", "Windows natif"}};
        const auto session = player.PlaybackSession();
        const auto index = list.CurrentItemIndex();
        auto result = index < tracks.size() ? tracks[static_cast<int>(index)].toMap() : QVariantMap{};
        const auto status = session.PlaybackState();
        const bool playing = status == MediaPlaybackState::Playing;
        const bool loading = status == MediaPlaybackState::Opening || status == MediaPlaybackState::Buffering;
        result.insert({{"connected", true}, {"engine", "Windows natif"}, {"playing", playing}, {"loading", loading},
            {"stopped", stopped}, {"canPlay", !playing && !loading}, {"canPause", playing}, {"canStop", true},
            {"canNext", tracks.size() > 1}, {"canPrevious", tracks.size() > 1}, {"canSeek", session.CanSeek()},
            {"canShuffle", tracks.size() > 1}, {"canRepeat", true}, {"shuffle", list.ShuffleEnabled()},
            {"repeat", repeat}, {"start", 0}, {"end", session.NaturalDuration().count() / 10000000.0},
            {"position", session.Position().count() / 10000000.0}, {"queueIndex", index < tracks.size() ? static_cast<int>(index) : -1},
            {"volume", volume * 100}, {"ducked", ducked}});
        { QMutexLocker lock(&events->mutex); result["error"] = events->error; }
        return result;
    }
    bool execute(const QString& action, double value, const QVariantList& items) {
        if (action == "volume") { volume = qBound(0.0, value / 100, 1.0); if (player) player.Volume(ducked ? 0 : volume); return true; }
        if (action == "duck") { ducked = value != 0; if (player) player.Volume(ducked ? 0 : volume); return true; }
        if (action == "queue") { setQueue(items, static_cast<int>(value)); return true; }
        if (!player || !list) return false;
        if (action == "play") { player.Play(); stopped = false; }
        else if (action == "pause") player.Pause();
        else if (action == "stop") { player.Pause(); player.PlaybackSession().Position(std::chrono::seconds(0)); stopped = true; }
        else if (action == "seek") {
            const double end = player.PlaybackSession().NaturalDuration().count() / 10000000.0;
            player.PlaybackSession().Position(winrt::Windows::Foundation::TimeSpan(static_cast<int64_t>(qBound(0.0, value, end) * 10000000)));
        }
        else if (action == "next") { list.MoveNext(); player.Play(); stopped = false; }
        else if (action == "previous") {
            if (player.PlaybackSession().Position() > std::chrono::seconds(3)) player.PlaybackSession().Position(std::chrono::seconds(0));
            else list.MovePrevious();
        }
        else if (action == "index") { if (value < 0 || value >= tracks.size()) return false; list.MoveTo(static_cast<uint32_t>(value)); player.Play(); stopped = false; }
        else if (action == "shuffle") list.ShuffleEnabled(value != 0);
        else if (action == "repeat") {
            repeat = qBound(0, static_cast<int>(value), 2);
            player.IsLoopingEnabled(repeat == 1); list.AutoRepeatEnabled(repeat == 2);
        }
        else return false;
        return true;
    }
};

WindowsMediaService::WindowsMediaService(SettingsStore* settings, QObject* parent)
    : QObject(parent), m_settings(settings), m_worker(new WindowsMediaWorker), m_scanner(new QObject)
{
    m_folders = settings->get("wp-media-folders").toStringList();
    m_worker->volume = qBound(0.0, settings->getDouble("wp-media-volume", 50) / 100, 1.0);
    m_worker->moveToThread(&m_thread); m_scanner->moveToThread(&m_scanThread);
    connect(&m_thread, &QThread::finished, m_worker, &QObject::deleteLater);
    connect(&m_scanThread, &QThread::finished, m_scanner, &QObject::deleteLater);
    m_thread.start(); m_scanThread.start();
    QFile cache(QDir(settings->dataDir()).filePath("media-catalog.json"));
    if (cache.open(QIODevice::ReadOnly) && cache.size() < 32 * 1024 * 1024) {
        const auto data = QJsonDocument::fromJson(cache.readAll()).object();
        m_library = data.value("items").toArray().toVariantList(); m_albums = data.value("albums").toArray().toVariantList();
        m_playlists = data.value("playlists").toArray().toVariantList();
    }
    m_poll.setInterval(400); connect(&m_poll, &QTimer::timeout, this, &WindowsMediaService::refresh); m_poll.start();
    QTimer::singleShot(0, this, &WindowsMediaService::refresh); QTimer::singleShot(0, this, &WindowsMediaService::scanLibrary);
    auto* changes = new QTimer(this);
    changes->setInterval(15000);
    connect(changes, &QTimer::timeout, this, [this, signature = QString()]() mutable {
        QString next;
        const QStringList paths{databasePath(), databasePath() + "-wal", QDir(qEnvironmentVariable("APPDATA")).filePath("Microsoft/Windows/Libraries/Music.library-ms")};
        for (const auto& path : paths) next += QString::number(QFileInfo(path).lastModified().toMSecsSinceEpoch()) + ':';
        if (!signature.isEmpty() && next != signature) scanLibrary();
        signature = next;
    });
    if (settings->get("wp-media-auto-library", true).toBool()) changes->start();
}
WindowsMediaService::~WindowsMediaService()
{
    m_poll.stop(); m_scanThread.requestInterruption(); m_scanThread.quit(); m_thread.quit(); m_thread.wait(); m_scanThread.wait();
}
void WindowsMediaService::refresh()
{
    if (m_pending || m_busy) return;
    m_pending = true;
    QMetaObject::invokeMethod(m_worker, [this] {
        QVariantMap result; QString error;
        try { result = m_worker->snapshot(); } catch (const winrt::hresult_error& e) { error = qs(e.message()); }
        QMetaObject::invokeMethod(this, [this, result, error] {
            m_pending = false;
            const auto reported = error.isEmpty() ? result.value("error").toString() : error;
            const bool changed = m_playback != result || (!reported.isEmpty() && reported != m_error);
            if (!reported.isEmpty()) m_error = reported;
            m_playback = result; if (changed) emit playbackChanged();
        }, Qt::QueuedConnection);
    }, Qt::QueuedConnection);
}
void WindowsMediaService::dispatch(const QString& action, double value, const QVariantList& items)
{
    if (m_busy || !std::isfinite(value)) return;
    m_busy = true; m_error.clear(); emit playbackChanged();
    QMetaObject::invokeMethod(m_worker, [this, action, value, items] {
        QString error;
        try { if (!m_worker->execute(action, value, items)) error = "Commande indisponible."; } catch (const winrt::hresult_error& e) { error = qs(e.message()); }
        QMetaObject::invokeMethod(this, [this, action, items, error] {
            m_busy = false; m_error = error; if (action == "queue" && error.isEmpty()) m_queue = items;
            emit playbackChanged(); refresh();
        }, Qt::QueuedConnection);
    }, Qt::QueuedConnection);
}
void WindowsMediaService::command(const QString& action, double value)
{
    if (action == "volume" && std::isfinite(value)) m_settings->set("wp-media-volume", qBound(0.0, value, 100.0));
    dispatch(action, value);
}
void WindowsMediaService::setDucked(bool ducked)
{
    QMetaObject::invokeMethod(m_worker, [this, ducked] {
        try { m_worker->execute("duck", ducked ? 1 : 0, {}); } catch (const winrt::hresult_error&) {}
    }, Qt::QueuedConnection);
}
void WindowsMediaService::playFile(const QUrl& file)
{
    for (const auto& value : m_library) if (QUrl(value.toMap().value("url").toString()) == file) { playItems({value}); return; }
    playItems({QVariantMap{{"url", file.toString()}, {"title", QFileInfo(file.toLocalFile()).completeBaseName()}}});
}
void WindowsMediaService::playItems(const QVariantList& items, int index)
{
    if (m_busy) return;
    QVariantList valid; int start = 0;
    QHash<QString, QVariantMap> metadata;
    for (const auto& value : m_library) metadata.insert(QUrl(value.toMap().value("url").toString()).toLocalFile().toCaseFolded(), value.toMap());
    for (int i = 0; i < items.size() && valid.size() < 5000; ++i) {
        auto item = items[i].toMap(); const QUrl file(item.value("url").toString());
        if (!file.isLocalFile() || MediaLibrary::kind(file.toLocalFile()) != "audio") continue;
        const auto catalogTrack = metadata.value(file.toLocalFile().toCaseFolded());
        if (!catalogTrack.isEmpty()) item = catalogTrack;
        if (i < index) ++start;
        if (item.value("title").toString().isEmpty()) item["title"] = QFileInfo(file.toLocalFile()).completeBaseName();
        valid.append(item);
    }
    if (valid.isEmpty()) { m_error = "Aucun fichier audio local dans cette selection."; emit playbackChanged(); return; }
    dispatch("queue", qBound(0, start, static_cast<int>(valid.size()) - 1), valid);
}
void WindowsMediaService::playAlbum(const QString& id)
{
    QVariantList tracks;
    for (const auto& value : m_library) if (value.toMap().value("albumId").toString() == id) tracks.append(value);
    std::stable_sort(tracks.begin(), tracks.end(), [](const auto& a, const auto& b) {
        const auto x = a.toMap(), y = b.toMap();
        if (x.value("discNumber").toInt() != y.value("discNumber").toInt()) return x.value("discNumber").toInt() < y.value("discNumber").toInt();
        return x.value("trackNumber").toInt() < y.value("trackNumber").toInt();
    });
    playItems(tracks);
}
void WindowsMediaService::playPlaylist(const QString& id)
{
    for (const auto& value : m_playlists) if (value.toMap().value("id").toString() == id) { playItems(value.toMap().value("items").toList()); return; }
}
void WindowsMediaService::importPlaylist(const QUrl& file)
{
    if (!file.isLocalFile()) return;
    auto files = m_settings->get("wp-media-playlist-files").toStringList();
    if (!files.contains(file.toLocalFile())) { files.append(file.toLocalFile()); m_settings->set("wp-media-playlist-files", files); }
    scanLibrary();
}
void WindowsMediaService::scanLibrary()
{
    if (m_scanning) { m_rescan = true; return; }
    m_scanning = true; emit libraryChanged();
    const auto cache = QDir(m_settings->dataDir()).filePath("media-covers");
    const auto excluded = m_settings->get("wp-media-excluded-folders").toStringList();
    const auto playlists = m_settings->get("wp-media-playlist-files").toStringList();
    const bool discover = m_settings->get("wp-media-auto-library", true).toBool();
    QMetaObject::invokeMethod(m_scanner, [this, folders = m_folders, cache, excluded, playlists, discover]() mutable {
        if (discover) folders.append(MediaCatalog::windowsFolders());
        QStringList normalized;
        for (const auto& folder : folders) {
            const auto path = QDir::cleanPath(QDir::fromNativeSeparators(folder));
            if (!excluded.contains(path, Qt::CaseInsensitive) && !normalized.contains(path, Qt::CaseInsensitive)) normalized.append(path);
        }
        auto publish = [this, normalized](const QVariantMap& data, bool finished) {
            QMetaObject::invokeMethod(this, [this, normalized, data, finished] {
                if (m_folders != normalized) { m_folders = normalized; emit foldersChanged(); }
                m_library = data.value("items").toList(); m_albums = data.value("albums").toList(); m_playlists = data.value("playlists").toList();
                m_libraryStatus = data.value("warning").toString();
                if (data.value("truncated").toBool()) m_libraryStatus = "Bibliotheque partielle : limite de temps ou de fichiers atteinte.";
                else if (!data.value("missing").toStringList().isEmpty()) m_libraryStatus = "Certains dossiers sont indisponibles.";
                if (finished) {
                    m_scanning = false;
                    QSaveFile file(QDir(m_settings->dataDir()).filePath("media-catalog.json"));
                    if (file.open(QIODevice::WriteOnly)) { file.write(QJsonDocument(QJsonObject::fromVariantMap(data)).toJson(QJsonDocument::Compact)); file.commit(); }
                }
                emit libraryChanged(); if (finished && m_rescan) { m_rescan = false; scanLibrary(); }
            }, Qt::QueuedConnection);
        };
        const auto result = MediaCatalog::load(normalized, playlists, discover ? databasePath() : QString(), cache,
            [publish](const QVariantMap& partial) { publish(partial, false); });
        publish(result, true);
    }, Qt::QueuedConnection);
}
void WindowsMediaService::saveFolders() { m_settings->set("wp-media-folders", m_folders); emit foldersChanged(); scanLibrary(); }
void WindowsMediaService::addFolder(const QUrl& folder)
{
    if (!folder.isLocalFile()) return;
    const auto path = QDir::cleanPath(folder.toLocalFile());
    auto excluded = m_settings->get("wp-media-excluded-folders").toStringList();
    excluded.removeIf([&](const QString& value) { return value.compare(path, Qt::CaseInsensitive) == 0; });
    m_settings->set("wp-media-excluded-folders", excluded);
    if (!m_folders.contains(path, Qt::CaseInsensitive)) { m_folders.append(path); saveFolders(); }
}
void WindowsMediaService::removeFolder(const QString& folder)
{
    auto excluded = m_settings->get("wp-media-excluded-folders").toStringList();
    excluded.append(QDir::cleanPath(folder)); excluded.removeDuplicates(); m_settings->set("wp-media-excluded-folders", excluded);
    if (m_folders.removeAll(folder)) saveFolders();
}
}
