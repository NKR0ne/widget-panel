#include "WeatherAlerts.h"
#include "core/HttpClient.h"
#include "core/SettingsStore.h"
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QUrlQuery>
#include <cmath>

namespace qtpanel {
namespace {
bool ringContains(const QVariantList& ring, double x, double y)
{
    bool inside = false;
    if (ring.size() < 4) return false;
    for (qsizetype i = 0, j = ring.size() - 1; i < ring.size(); j = i++) {
        const auto a = ring[i].toList(), b = ring[j].toList();
        if (a.size() < 2 || b.size() < 2) return false;
        const double ax = a[0].toDouble(), ay = a[1].toDouble();
        const double bx = b[0].toDouble(), by = b[1].toDouble();
        const double cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
        if (std::abs(cross) < 1e-10 && x >= qMin(ax,bx) && x <= qMax(ax,bx)
                && y >= qMin(ay,by) && y <= qMax(ay,by)) return true;
        if ((ay > y) != (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax)
            inside = !inside;
    }
    return inside;
}
bool polygonContains(const QVariantList& rings, double lon, double lat)
{
    if (rings.isEmpty() || !ringContains(rings[0].toList(), lon, lat)) return false;
    for (qsizetype i = 1; i < rings.size(); ++i)
        if (ringContains(rings[i].toList(), lon, lat)) return false;
    return true;
}
qint64 timestamp(const QVariant& value) { return QDateTime::fromString(value.toString(), Qt::ISODateWithMs).toMSecsSinceEpoch(); }
}
bool WeatherAlerts::contains(const QVariantMap& geometry, double lon, double lat)
{
    const auto coordinates = geometry.value("coordinates").toList();
    if (geometry.value("type") == "Polygon") return polygonContains(coordinates, lon, lat);
    if (geometry.value("type") == "MultiPolygon")
        for (const auto& polygon : coordinates) if (polygonContains(polygon.toList(), lon, lat)) return true;
    return false;
}
QVariantList WeatherAlerts::activeFeatures(const QVariantList& features, double lon, double lat, qint64 now)
{
    QMap<QString, QVariantMap> latest;
    for (const auto& value : features) {
        const auto feature = value.toMap(), p = feature.value("properties").toMap();
        if (!contains(feature.value("geometry").toMap(), lon, lat)) continue;
        const QString key = p.value("feature_id").toString() + ":" + p.value("alert_code").toString();
        if (key == ":") continue;
        const qint64 issued = timestamp(p.value("publication_datetime"));
        if (latest.contains(key) && latest[key].value("issued").toLongLong() > issued) continue;
        const auto state = p.value("status_en").toString().toLower();
        latest[key] = {{"key", key}, {"issued", issued}, {"expires", timestamp(p.value("expiration_datetime"))},
            {"title", p.value("alert_name_fr", p.value("alert_name_en"))},
            {"area", p.value("feature_name_fr", p.value("feature_name_en"))},
            {"text", p.value("alert_text_fr", p.value("alert_text_en"))},
            {"warning", p.value("alert_type") == "warning"},
            {"cancelled", state.contains("cancel") || state.contains("ended")},
            {"source", "Environnement Canada"}};
    }
    QVariantList result;
    for (const auto& alert : latest)
        if (!alert.value("cancelled").toBool() && alert.value("expires").toLongLong() > now) result.append(alert);
    return result;
}
WeatherAlerts::WeatherAlerts(SettingsStore* settings, HttpClient* http, QObject* parent)
    : QObject(parent), m_settings(settings), m_http(http)
{
    m_poll.setInterval(5 * 60 * 1000);
    connect(&m_poll, &QTimer::timeout, this, &WeatherAlerts::refresh);
    m_poll.start();
    m_expiry.setInterval(60000);
    connect(&m_expiry, &QTimer::timeout, this, &WeatherAlerts::expire);
    m_expiry.start();
    connect(settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key != "wp-location") return;
        ++m_generation; m_busy = false; m_alerts.clear(); refresh();
    });
    QTimer::singleShot(0, this, &WeatherAlerts::refresh);
}
void WeatherAlerts::refresh()
{
    if (m_busy) return;
    const auto raw = m_settings->get("wp-location");
    const auto loc = raw.metaType().id() == QMetaType::QString
        ? QJsonDocument::fromJson(raw.toString().toUtf8()).object().toVariantMap() : raw.toMap();
    m_lat = loc.value("lat", 46.81228).toDouble();
    m_lon = loc.value("lon", -71.21454).toDouble();
    m_busy = true; m_pending.clear();
    m_status = QStringLiteral("V\u00e9rification des alertes ECCC..."); emit updated();
    QUrl url("https://api.weather.gc.ca/collections/weather-alerts/items");
    QUrlQuery query;
    query.addQueryItem("f", "json"); query.addQueryItem("limit", "100");
    query.addQueryItem("bbox", QString("%1,%2,%3,%4").arg(m_lon-0.001,0,'f',6).arg(m_lat-0.001,0,'f',6)
                       .arg(m_lon+0.001,0,'f',6).arg(m_lat+0.001,0,'f',6));
    url.setQuery(query); page(url, ++m_generation);
}
void WeatherAlerts::page(const QUrl& url, int generation, int pages)
{
    m_http->getJson(url, this, [this, generation, pages, url](const QJsonDocument& doc, const QString& error) {
        if (generation != m_generation) return;
        const auto root = doc.object();
        if (!error.isEmpty() || root.value("type") != "FeatureCollection" || !root.value("features").isArray()) {
            m_busy = false; m_stale = true;
            m_status = QStringLiteral("Alertes ECCC indisponibles - derni\u00e8res donn\u00e9es conserv\u00e9es");
            expire(); emit updated(); return;
        }
        m_pending += root.value("features").toArray().toVariantList();
        for (const auto& link : root.value("links").toArray()) {
            if (link.toObject().value("rel") != "next") continue;
            QUrl next = url.resolved(QUrl(link.toObject().value("href").toString()));
            if (pages >= 20 || next.host() != "api.weather.gc.ca" || next.scheme() != "https") {
                m_busy = false; m_stale = true; m_status = QStringLiteral("Alertes ECCC : r\u00e9ponse incompl\u00e8te"); emit updated(); return;
            }
            QUrlQuery query(next); query.removeAllQueryItems("f"); query.addQueryItem("f", "json"); next.setQuery(query);
            page(next, generation, pages + 1); return;
        }
        m_alerts = activeFeatures(m_pending, m_lon, m_lat, QDateTime::currentMSecsSinceEpoch());
        m_pending.clear(); m_busy = false; m_stale = false;
        m_status = QStringLiteral("ECCC - v\u00e9rifi\u00e9 \u00e0 %1").arg(QDateTime::currentDateTime().toString("HH:mm"));
        emit updated();
    });
}
void WeatherAlerts::expire()
{
    const auto now = QDateTime::currentMSecsSinceEpoch();
    const auto before = m_alerts.size();
    m_alerts.removeIf([now](const QVariant& item) { return item.toMap().value("expires").toLongLong() <= now; });
    if (before != m_alerts.size()) emit updated();
}
}
