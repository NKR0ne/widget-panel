#include "SettingsStore.h"

#include <QDebug>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QSaveFile>

namespace qtpanel {

SettingsStore::SettingsStore(QString filePath, QObject* parent)
    : QObject(parent)
    , m_path(std::move(filePath))
{
    m_saveTimer.setSingleShot(true);
    m_saveTimer.setInterval(500);
    connect(&m_saveTimer, &QTimer::timeout, this, &SettingsStore::flush);
    load();
}

QString SettingsStore::dataDir() const
{
    return QFileInfo(m_path).absolutePath();
}

SettingsStore::~SettingsStore()
{
    flush();
}

void SettingsStore::load()
{
    QFile file(m_path);
    if (!file.open(QIODevice::ReadOnly))
        return;
    QJsonParseError error{};
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError) {
        qWarning() << "[settings] parse error in" << m_path << ":" << error.errorString();
        return;
    }
    m_data = doc.object();
    qInfo() << "[settings] loaded" << m_data.size() << "keys from" << m_path;
}

bool SettingsStore::importLegacyIfEmpty(const QString& legacyConfigPath)
{
    if (!m_data.isEmpty())
        return false;
    QFile file(legacyConfigPath);
    if (!file.open(QIODevice::ReadOnly))
        return false;
    QJsonParseError error{};
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !doc.isObject()) {
        qWarning() << "[settings] legacy import failed:" << error.errorString();
        return false;
    }
    m_data = doc.object();
    m_dirty = true;
    flush();
    qInfo() << "[settings] imported" << m_data.size() << "keys from" << legacyConfigPath;
    return true;
}

QVariant SettingsStore::get(const QString& key, const QVariant& fallback) const
{
    const auto it = m_data.constFind(key);
    if (it == m_data.constEnd() || it->isNull() || it->isUndefined())
        return fallback;
    return it->toVariant();
}

void SettingsStore::set(const QString& key, const QVariant& value)
{
    m_data.insert(key, QJsonValue::fromVariant(value));
    scheduleSave();
    emit changed(key);
}

void SettingsStore::remove(const QString& key)
{
    if (m_data.contains(key)) {
        m_data.remove(key);
        scheduleSave();
        emit changed(key);
    }
}

double SettingsStore::getDouble(const QString& key, double fallback) const
{
    bool ok = false;
    const double value = get(key).toDouble(&ok);
    return ok ? value : fallback;
}

int SettingsStore::getInt(const QString& key, int fallback) const
{
    bool ok = false;
    const int value = get(key).toInt(&ok);
    return ok ? value : fallback;
}

void SettingsStore::scheduleSave()
{
    m_dirty = true;
    m_saveTimer.start();
}

void SettingsStore::flush()
{
    if (!m_dirty)
        return;
    m_saveTimer.stop();
    QSaveFile file(m_path);
    if (!file.open(QIODevice::WriteOnly)) {
        qWarning() << "[settings] cannot write" << m_path << ":" << file.errorString();
        return;
    }
    file.write(QJsonDocument(m_data).toJson(QJsonDocument::Indented));
    if (file.commit())
        m_dirty = false;
    else
        qWarning() << "[settings] commit failed for" << m_path;
}

} // namespace qtpanel
