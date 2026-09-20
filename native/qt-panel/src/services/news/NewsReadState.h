#pragma once
#include <QObject>
#include <QVariantMap>
#include <QVariantList>
#include <QSet>

namespace qtpanel {
class SettingsStore;
class NewsReadState : public QObject {
    Q_OBJECT
    Q_PROPERTY(int revision READ revision NOTIFY changed)
public:
    explicit NewsReadState(SettingsStore* settings, QObject* parent = nullptr);
    int revision() const { return m_revision; }
    Q_INVOKABLE static QString keyFor(const QVariantMap& item);
    Q_INVOKABLE bool isUnread(const QVariantMap& item) const;
    Q_INVOKABLE void setRead(const QVariantMap& item, bool read = true);
    Q_INVOKABLE int unreadCount(const QVariantList& items) const;
    Q_INVOKABLE void markAllRead(const QVariantList& items);
    void observe(const QString& category, const QVariantList& items);
    void readerCompleted(const QVariantMap& article, bool busy);
signals:
    void changed();
private:
    void save();
    SettingsStore* m_settings;
    QVariantMap m_items;
    QSet<QString> m_categories;
    int m_revision = 0;
};
}
