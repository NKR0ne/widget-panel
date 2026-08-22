#pragma once

#include <QJsonObject>
#include <QObject>
#include <QTimer>
#include <QVariant>

namespace qtpanel {

// Flat key/value JSON store, compatible with the Electron app's electron-store
// keyspace (wp-* keys). On first run it can import the legacy config.json
// wholesale so the user's layout and preferences carry over.
class SettingsStore : public QObject {
    Q_OBJECT

public:
    explicit SettingsStore(QString filePath, QObject* parent = nullptr);

    // Directory holding settings.json — the per-profile data dir, which is
    // where services put files that must survive a restart.
    QString dataDir() const;
    ~SettingsStore() override;

    // Returns true when legacy data was imported (only happens on an empty store).
    bool importLegacyIfEmpty(const QString& legacyConfigPath);

    Q_INVOKABLE QVariant get(const QString& key, const QVariant& fallback = {}) const;
    Q_INVOKABLE void set(const QString& key, const QVariant& value);
    Q_INVOKABLE void remove(const QString& key);

    // Tolerates values stored as strings (the Electron store mixes types,
    // e.g. wp-pinned-opacity is a string).
    double getDouble(const QString& key, double fallback) const;
    int getInt(const QString& key, int fallback) const;

public slots:
    void flush();

signals:
    // Lets QML bindings react to store writes (Q_INVOKABLE get() alone is
    // not notifiable).
    void changed(const QString& key);

private:
    void load();
    void scheduleSave();

    QString m_path;
    QJsonObject m_data;
    QTimer m_saveTimer;
    bool m_dirty = false;
};

} // namespace qtpanel
