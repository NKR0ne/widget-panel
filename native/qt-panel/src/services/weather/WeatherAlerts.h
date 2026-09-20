#pragma once
#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QUrl>

namespace qtpanel {
class SettingsStore;
class HttpClient;
class WeatherAlerts : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList alerts READ alerts NOTIFY updated)
    Q_PROPERTY(QString status READ status NOTIFY updated)
    Q_PROPERTY(bool stale READ stale NOTIFY updated)
public:
    WeatherAlerts(SettingsStore*, HttpClient*, QObject* parent = nullptr);
    QVariantList alerts() const { return m_alerts; }
    QString status() const { return m_status; }
    bool stale() const { return m_stale; }
    Q_INVOKABLE void refresh();
    static bool contains(const QVariantMap& geometry, double lon, double lat);
    static QVariantList activeFeatures(const QVariantList&, double lon, double lat, qint64 now);
signals:
    void updated();
private:
    void page(const QUrl&, int generation, int pages = 0);
    void expire();
    SettingsStore* m_settings;
    HttpClient* m_http;
    QTimer m_poll, m_expiry;
    QVariantList m_alerts, m_pending;
    QString m_status;
    bool m_stale = true, m_busy = false;
    int m_generation = 0;
    double m_lat = 0, m_lon = 0;
};
}
