#pragma once
#include <QDirIterator>
#include <QElapsedTimer>
#include <QFileInfo>
#include <QSet>
#include <QThread>
#include <QUrl>
#include <QVariantMap>
#include <algorithm>

namespace qtpanel::MediaLibrary {
inline QString kind(const QString& path)
{
    const auto extension = QFileInfo(path).suffix().toLower();
    static const QSet<QString> audio{"mp3", "flac", "m4a", "aac", "wav", "wma", "ogg", "opus", "aiff", "aif", "alac"};
    static const QSet<QString> video{"mp4", "mkv", "mov", "avi", "wmv", "m4v", "webm", "mpeg", "mpg"};
    return audio.contains(extension) ? QStringLiteral("audio")
        : video.contains(extension) ? QStringLiteral("video") : QString();
}
inline QVariantMap scan(const QStringList& folders, int limit = 10000, int budgetMs = 5000)
{
    QVariantList items;
    QSet<QString> seen;
    QStringList missing;
    bool truncated = false;
    QElapsedTimer timer;
    timer.start();
    for (const auto& folder : folders) {
        if (!QFileInfo(folder).isDir()) { missing.append(folder); continue; }
        QDirIterator it(folder, QDir::Files | QDir::NoSymLinks | QDir::Readable, QDirIterator::Subdirectories);
        while (it.hasNext()) {
            if (QThread::currentThread()->isInterruptionRequested()) return {};
            if (items.size() >= limit || timer.elapsed() >= budgetMs) { truncated = true; break; }
            it.next();
            const auto info = it.fileInfo();
            const auto type = kind(info.fileName());
            if (type.isEmpty()) continue;
            const auto path = info.canonicalFilePath();
            if (path.isEmpty() || seen.contains(path.toCaseFolded())) continue;
            seen.insert(path.toCaseFolded());
            items.append(QVariantMap{{"url", QUrl::fromLocalFile(path).toString()},
                {"title", info.completeBaseName()}, {"folder", info.dir().dirName()},
                {"kind", type}, {"format", info.suffix().toUpper()}});
        }
        if (truncated) break;
    }
    std::sort(items.begin(), items.end(), [](const QVariant& a, const QVariant& b) {
        return QString::localeAwareCompare(a.toMap().value("title").toString(), b.toMap().value("title").toString()) < 0;
    });
    return {{"items", items}, {"truncated", truncated}, {"missing", missing}};
}
}
