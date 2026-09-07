#include "MediaCatalog.h"
#include "MediaLibrary.h"
#include <QCryptographicHash>
#include <QImage>
#include <QDateTime>
#include <QSettings>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QUuid>
#include <QXmlStreamReader>
#include <Windows.h>
#include <ShlObj.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.FileProperties.h>
#include <winrt/Windows.Storage.Streams.h>

namespace qtpanel::MediaCatalog {
namespace {
QUrl localUrl(const QString& text, const QString& base = {})
{
    const auto value = text.trimmed();
    QUrl url(value);
    if (url.isLocalFile()) return QUrl::fromLocalFile(QDir::cleanPath(url.toLocalFile()));
    if (QDir::isAbsolutePath(value)) return QUrl::fromLocalFile(QDir::cleanPath(value));
    if (url.scheme().isEmpty() && !value.isEmpty())
        return QUrl::fromLocalFile(QDir(base).absoluteFilePath(value));
    return {};
}
QString key(const QString& url) { return QDir::cleanPath(QUrl(url).toLocalFile()).toCaseFolded(); }
QVariantMap itemFor(const QUrl& url)
{
    const QFileInfo info(url.toLocalFile());
    return {{"url", url.toString()}, {"title", info.completeBaseName()},
        {"folder", info.dir().dirName()}, {"album", info.dir().dirName()},
        {"albumId", "folder:" + info.absolutePath().toCaseFolded()}, {"artist", QString()},
        {"kind", MediaLibrary::kind(info.fileName())}, {"format", info.suffix().toUpper()}};
}
template<class T> auto bounded(T operation)
{
    if (operation.wait_for(std::chrono::seconds(2)) == winrt::Windows::Foundation::AsyncStatus::Started) {
        operation.Cancel();
        throw winrt::hresult_error(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
    }
    return operation.GetResults();
}
QString coverFor(const QVariantMap& track, const QString& cacheDirectory)
{
    using namespace winrt::Windows::Storage;
    using namespace winrt::Windows::Storage::FileProperties;
    using namespace winrt::Windows::Storage::Streams;
    const QFileInfo info(QUrl(track.value("url").toString()).toLocalFile());
    const auto hash = QCryptographicHash::hash((info.absoluteFilePath() + QString::number(info.lastModified().toMSecsSinceEpoch())).toUtf8(), QCryptographicHash::Sha256).toHex();
    const auto output = QDir(cacheDirectory).filePath(QString::fromLatin1(hash) + ".jpg");
    if (QFileInfo::exists(output)) return QUrl::fromLocalFile(output).toString();
    QImage image;
    for (const auto* filename : {"cover.jpg", "folder.jpg", "front.jpg", "cover.png", "folder.png"}) {
        image.load(info.dir().filePath(QString::fromLatin1(filename)));
        if (!image.isNull()) break;
    }
    if (image.isNull()) {
        try {
            const auto file = bounded(StorageFile::GetFileFromPathAsync(QDir::toNativeSeparators(info.absoluteFilePath()).toStdWString()));
            const auto thumb = bounded(file.GetThumbnailAsync(ThumbnailMode::MusicView, 256, ThumbnailOptions::None));
            if (thumb && thumb.Type() == ThumbnailType::Image && thumb.Size() > 0 && thumb.Size() <= 8 * 1024 * 1024) {
                const auto bytes = bounded(thumb.ReadAsync(Buffer(static_cast<uint32_t>(thumb.Size())), static_cast<uint32_t>(thumb.Size()), InputStreamOptions::None));
                image = QImage::fromData(bytes.data(), static_cast<int>(bytes.Length()));
            }
        } catch (const winrt::hresult_error&) { /* A cover is optional; playback remains available. */ }
    }
    if (image.isNull()) return {};
    QDir().mkpath(cacheDirectory);
    if (!image.scaled(320, 320, Qt::KeepAspectRatio, Qt::SmoothTransformation).save(output, "JPG", 88)) return {};
    return QUrl::fromLocalFile(output).toString();
}
}

QStringList windowsFolders()
{
    QStringList folders{QStandardPaths::writableLocation(QStandardPaths::MusicLocation)};
    QFile file(QDir(qEnvironmentVariable("APPDATA")).filePath("Microsoft/Windows/Libraries/Music.library-ms"));
    if (!file.open(QIODevice::ReadOnly)) return folders;
    QXmlStreamReader xml(&file);
    while (!xml.atEnd()) {
        xml.readNext();
        if (!xml.isStartElement() || xml.name() != QLatin1String("url")) continue;
        const auto location = xml.readElementText();
        if (location.startsWith("knownfolder:", Qt::CaseInsensitive)) {
            GUID id{};
            PWSTR path = nullptr;
            const auto guid = location.mid(12).toStdWString();
            if (SUCCEEDED(CLSIDFromString(guid.c_str(), &id)) && SUCCEEDED(SHGetKnownFolderPath(id, KF_FLAG_DONT_VERIFY, nullptr, &path))) {
                folders.append(QDir::fromNativeSeparators(QString::fromWCharArray(path)));
                CoTaskMemFree(path);
            }
        } else {
            const auto url = localUrl(location);
            if (url.isLocalFile()) folders.append(url.toLocalFile());
        }
    }
    folders.removeAll(QString());
    folders.removeDuplicates();
    return folders;
}

QVariantMap readPlaylist(const QString& path)
{
    QFile file(path);
    QVariantList items;
    if (!file.open(QIODevice::ReadOnly) || file.size() > 4 * 1024 * 1024)
        return {{"error", "Playlist introuvable ou trop volumineuse."}};
    const auto data = file.readAll();
    const QFileInfo info(path);
    const auto extension = info.suffix().toLower();
    auto append = [&](const QString& source) {
        const auto url = localUrl(source, info.absolutePath());
        if (items.size() < 10000 && url.isLocalFile() && MediaLibrary::kind(url.toLocalFile()) == "audio")
            items.append(itemFor(url));
    };
    if (extension == "m3u" || extension == "m3u8") {
        for (auto line : QString::fromUtf8(data).split('\n')) {
            line.remove(QChar(0xfeff));
            if (!line.trimmed().startsWith('#')) append(line);
        }
    } else if (extension == "pls") {
        QSettings ini(path, QSettings::IniFormat);
        ini.beginGroup("playlist");
        for (int i = 1; i <= qMin(10000, ini.value("NumberOfEntries").toInt()); ++i)
            append(ini.value("File" + QString::number(i)).toString());
    } else if (extension == "wpl" || extension == "zpl" || extension == "xspf") {
        QXmlStreamReader xml(data);
        while (!xml.atEnd()) {
            xml.readNext();
            if (!xml.isStartElement()) continue;
            if (xml.name() == QLatin1String("media")) append(xml.attributes().value("src").toString());
            else if (xml.name() == QLatin1String("location")) append(xml.readElementText());
        }
        if (xml.hasError()) return {{"error", "Playlist XML invalide."}};
    } else return {{"error", "Format de playlist non pris en charge."}};
    return {{"id", QUrl::fromLocalFile(info.absoluteFilePath()).toString()}, {"title", info.completeBaseName()},
        {"items", items}, {"count", items.size()}, {"source", "Fichier"}};
}

QVariantMap readModernDatabase(const QString& path)
{
    QVariantMap result;
    if (!QFileInfo::exists(path)) return result;
    const auto connection = "media-catalog-" + QUuid::createUuid().toString();
    {
        auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
        db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=500");
        db.setDatabaseName(path);
        if (!db.open()) result["warning"] = "Catalogue Media Player indisponible; dossiers locaux utilises.";
        else {
            db.exec("PRAGMA query_only=ON");
            db.transaction();
            QVariantList tracks, playlists;
            QSqlQuery query(db);
            // Do not use the app's private UNICODE indexes/collation. All writes are disabled.
            if (query.exec("SELECT t.Uri,t.Title,a.Title,r.Name,t.AlbumId,t.TrackNumber,t.DiscNumber,t.Duration "
                           "FROM Track t NOT INDEXED LEFT JOIN Album a NOT INDEXED ON a.Id=t.AlbumId "
                           "LEFT JOIN Artist r NOT INDEXED ON r.Id=a.ArtistId "
                           "WHERE COALESCE(t.IsMarkedForDeletion,0)=0 LIMIT 10000")) {
                while (query.next()) {
                    const auto url = localUrl(query.value(0).toString());
                    if (!url.isLocalFile() || MediaLibrary::kind(url.toLocalFile()) != "audio") continue;
                    auto item = itemFor(url);
                    if (!query.value(1).toString().isEmpty()) item["title"] = query.value(1);
                    if (!query.value(2).toString().isEmpty()) item["album"] = query.value(2);
                    item["artist"] = query.value(3);
                    if (!query.value(4).isNull()) item["albumId"] = "player:" + query.value(4).toString();
                    item["trackNumber"] = query.value(5); item["discNumber"] = query.value(6);
                    item["duration"] = query.value(7).toLongLong() / 10000000.0;
                    tracks.append(item);
                }
                result["items"] = tracks;
            } else result["warning"] = "Catalogue Media Player incompatible; dossiers locaux utilises.";
            if (query.exec("SELECT Id,Uri,Title FROM Playlist NOT INDEXED WHERE COALESCE(IsMarkedForDeletion,0)=0 LIMIT 1000")) {
                while (query.next()) {
                    const auto url = localUrl(query.value(1).toString());
                    QVariantMap playlist;
                    if (url.isLocalFile() && QFileInfo::exists(url.toLocalFile())) playlist = readPlaylist(url.toLocalFile());
                    if (!playlist.contains("items")) {
                        QVariantList entries;
                        QSqlQuery entry(db);
                        entry.prepare("SELECT Source,Title FROM PlaylistEntry NOT INDEXED WHERE PlaylistId=? ORDER BY Id LIMIT 10000");
                        entry.addBindValue(query.value(0));
                        if (entry.exec()) while (entry.next()) {
                            const auto source = localUrl(entry.value(0).toString());
                            if (source.isLocalFile() && MediaLibrary::kind(source.toLocalFile()) == "audio") {
                                auto item = itemFor(source);
                                if (!entry.value(1).toString().isEmpty()) item["title"] = entry.value(1);
                                entries.append(item);
                            }
                        }
                        playlist = {{"items", entries}, {"count", entries.size()}};
                    }
                    playlist["id"] = "player-playlist:" + query.value(0).toString();
                    playlist["title"] = query.value(2);
                    playlist["source"] = "Media Player";
                    playlist["file"] = url.toString();
                    playlists.append(playlist);
                }
            }
            result["playlists"] = playlists;
            db.rollback();
            db.close();
        }
    }
    QSqlDatabase::removeDatabase(connection);
    return result;
}

QVariantMap load(const QStringList& folders, const QStringList& playlistFiles, const QString& database,
                 const QString& cacheDirectory, const std::function<void(const QVariantMap&)>& progress)
{
    auto scan = MediaLibrary::scan(folders);
    const auto catalog = readModernDatabase(database);
    QHash<QString, QVariantMap> metadata;
    for (const auto& track : catalog.value("items").toList()) metadata.insert(key(track.toMap().value("url").toString()), track.toMap());
    QVariantList tracks, albums;
    QHash<QString, int> albumIndex;
    for (const auto& value : scan.value("items").toList()) {
        const auto url = value.toMap().value("url").toString();
        if (MediaLibrary::kind(QUrl(url).toLocalFile()) != "audio") continue;
        auto item = metadata.value(key(url), itemFor(QUrl(url)));
        const auto id = item.value("albumId").toString();
        if (!albumIndex.contains(id)) {
            albumIndex.insert(id, albums.size());
            albums.append(QVariantMap{{"id", id}, {"title", item.value("album")}, {"artist", item.value("artist")}, {"artwork", ""}, {"count", 0}});
        }
        auto album = albums[albumIndex[id]].toMap();
        album["count"] = album.value("count").toInt() + 1;
        albums[albumIndex[id]] = album;
        tracks.append(item);
    }
    auto playlists = catalog.value("playlists").toList();
    QSet<QString> knownPlaylists;
    for (const auto& value : playlists) {
        const auto url = value.toMap().value("file").toString();
        if (!url.isEmpty()) knownPlaylists.insert(key(url));
    }
    QStringList files = playlistFiles;
    QElapsedTimer enumeration; enumeration.start();
    for (const auto& folder : folders) {
        QDirIterator it(folder, {"*.wpl", "*.m3u", "*.m3u8", "*.pls", "*.xspf", "*.zpl"}, QDir::Files | QDir::NoSymLinks, QDirIterator::Subdirectories);
        while (it.hasNext() && files.size() < 1000 && enumeration.elapsed() < 2000 && !QThread::currentThread()->isInterruptionRequested()) files.append(it.next());
    }
    files.removeDuplicates();
    for (const auto& file : files) {
        const auto fileKey = key(QUrl::fromLocalFile(file).toString());
        if (knownPlaylists.contains(fileKey)) continue;
        knownPlaylists.insert(fileKey);
        const auto playlist = readPlaylist(file);
        if (playlist.contains("items")) playlists.append(playlist);
    }
    QVariantMap result{{"items", tracks}, {"albums", albums}, {"playlists", playlists},
        {"truncated", scan.value("truncated")}, {"missing", scan.value("missing")}, {"warning", catalog.value("warning")}};
    if (progress) progress(result);
    bool apartment = false;
    try { winrt::init_apartment(winrt::apartment_type::multi_threaded); apartment = true; } catch (const winrt::hresult_error&) {}
    QElapsedTimer timer; timer.start();
    QHash<QString, QString> covers;
    for (const auto& value : tracks) {
        if (QThread::currentThread()->isInterruptionRequested() || timer.elapsed() > 15000) break;
        const auto track = value.toMap();
        const auto id = track.value("albumId").toString();
        if (!covers.contains(id)) covers.insert(id, coverFor(track, cacheDirectory));
    }
    if (apartment) winrt::uninit_apartment();
    for (auto& value : tracks) { auto item = value.toMap(); item["artwork"] = covers.value(item.value("albumId").toString()); value = item; }
    for (auto& value : albums) { auto item = value.toMap(); item["artwork"] = covers.value(item.value("id").toString()); value = item; }
    result["items"] = tracks; result["albums"] = albums;
    return result;
}
}
