#pragma once
#include <QVariantMap>
#include <QStringList>
#include <functional>

namespace qtpanel::MediaCatalog {
QStringList windowsFolders();
QVariantMap readModernDatabase(const QString& path);
QVariantMap readPlaylist(const QString& path);
QVariantMap load(const QStringList& folders, const QStringList& playlistFiles,
                 const QString& database, const QString& cacheDirectory,
                 const std::function<void(const QVariantMap&)>& progress = {});
}
