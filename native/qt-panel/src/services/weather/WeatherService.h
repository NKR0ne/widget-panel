#pragma once

#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

namespace qtpanel {

class HttpClient;
class SettingsStore;

// Open-Meteo forecast for the wp-location stored by the Electron app
// ({name, lat, lon, timezone} as a JSON string). No API key required.
class WeatherService : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool ready READ ready NOTIFY updated)
    Q_PROPERTY(QString error READ error NOTIFY updated)
    Q_PROPERTY(QString locationName READ locationName NOTIFY updated)
    Q_PROPERTY(QVariantMap current READ current NOTIFY updated)
    Q_PROPERTY(QVariantList hourly READ hourly NOTIFY updated)
    Q_PROPERTY(QVariantList daily READ daily NOTIFY updated)

public:
    WeatherService(SettingsStore* settings, HttpClient* http, QObject* parent = nullptr);

    bool ready() const { return m_ready; }
    QString error() const { return m_error; }
    QString locationName() const { return m_locationName; }
    QVariantMap current() const { return m_current; }
    QVariantList hourly() const { return m_hourly; }
    QVariantList daily() const { return m_daily; }

    Q_INVOKABLE void refresh();
    // Geocoding search for the settings location editor (Open-Meteo).
    Q_INVOKABLE void searchLocation(const QString& query);
    // Persist a chosen location and re-fetch.
    Q_INVOKABLE void setLocation(const QString& name, double lat, double lon,
                                 const QString& timezone);

signals:
    void updated();
    void locationResults(const QVariantList& results);

private:
    void applyPayload(const QVariantMap& payload);
    QVariantMap location() const;

    SettingsStore* m_settings = nullptr;
    HttpClient* m_http = nullptr;
    QTimer m_pollTimer;
    bool m_ready = false;
    bool m_fetching = false;
    QString m_error;
    QString m_locationName;
    QVariantMap m_current;
    QVariantList m_hourly;
    QVariantList m_daily;
};

} // namespace qtpanel
