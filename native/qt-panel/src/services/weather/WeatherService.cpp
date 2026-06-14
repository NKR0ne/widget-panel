#include "WeatherService.h"

#include "core/HttpClient.h"
#include "core/SettingsStore.h"
#include "core/TextFix.h"

#include <QDateTime>
#include <QDebug>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocale>
#include <QUrl>

namespace qtpanel {

namespace {

constexpr int kPollMinutes = 15;

// Port of renderer/widgets/weather/weather.format.js wmo().
struct WmoInfo {
    QString label;
    QString emoji;
};

WmoInfo wmo(int code)
{
    if (code == 0)  return {QStringLiteral("Dégagé"), QStringLiteral("☀️")};
    if (code <= 2)  return {QStringLiteral("Partiellement nuageux"), QStringLiteral("⛅")};
    if (code == 3)  return {QStringLiteral("Couvert"), QStringLiteral("☁️")};
    if (code <= 49) return {QStringLiteral("Brouillard"), QStringLiteral("🌫")};
    if (code <= 59) return {QStringLiteral("Bruine"), QStringLiteral("🌦")};
    if (code <= 69) return {QStringLiteral("Pluie"), QStringLiteral("🌧")};
    if (code <= 79) return {QStringLiteral("Neige"), QStringLiteral("❄️")};
    if (code <= 84) return {QStringLiteral("Averses"), QStringLiteral("🌧")};
    if (code <= 94) return {QStringLiteral("Orage"), QStringLiteral("⛈")};
    return {QStringLiteral("Tempête"), QStringLiteral("🌩")};
}

} // namespace

WeatherService::WeatherService(SettingsStore* settings, HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_http(http)
{
    m_pollTimer.setInterval(kPollMinutes * 60 * 1000);
    connect(&m_pollTimer, &QTimer::timeout, this, &WeatherService::refresh);
    m_pollTimer.start();
    refresh();
}

QVariantMap WeatherService::location() const
{
    // Stored as a JSON *string* by the Electron app; tolerate a map too.
    const QVariant raw = m_settings->get(QStringLiteral("wp-location"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {
        {QStringLiteral("name"), QStringLiteral("Québec, Quebec")},
        {QStringLiteral("lat"), 46.81228},
        {QStringLiteral("lon"), -71.21454},
        {QStringLiteral("timezone"), QStringLiteral("America/Toronto")},
    };
}

void WeatherService::refresh()
{
    if (m_fetching)
        return;
    m_fetching = true;

    const QVariantMap loc = location();
    m_locationName = TextFix::repairMojibake(loc.value(QStringLiteral("name")).toString());

    // Same query as renderer/widgets/weather/weather.service.js buildWeatherUrl().
    QUrl url(QStringLiteral("https://api.open-meteo.com/v1/forecast"));
    url.setQuery(QStringLiteral(
        "latitude=%1&longitude=%2"
        "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
        "&hourly=temperature_2m,weather_code"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
        "precipitation_sum,wind_speed_10m_max"
        "&timezone=%3&forecast_days=14")
        .arg(loc.value(QStringLiteral("lat")).toDouble())
        .arg(loc.value(QStringLiteral("lon")).toDouble())
        .arg(QString::fromUtf8(QUrl::toPercentEncoding(
            loc.value(QStringLiteral("timezone")).toString()))));

    m_http->getJson(url, this, [this](const QJsonDocument& doc, const QString& error) {
        m_fetching = false;
        if (!error.isEmpty()) {
            m_error = error;
            qWarning() << "[weather] fetch failed:" << error;
            emit updated();
            return;
        }
        m_error.clear();
        applyPayload(doc.object().toVariantMap());
    });
}

void WeatherService::searchLocation(const QString& query)
{
    if (query.trimmed().isEmpty())
        return;
    QUrl url(QStringLiteral("https://geocoding-api.open-meteo.com/v1/search"));
    url.setQuery(QStringLiteral("name=%1&count=6&language=fr&format=json")
                     .arg(QString::fromUtf8(QUrl::toPercentEncoding(query.trimmed()))));
    m_http->getJson(url, this, [this](const QJsonDocument& doc, const QString& error) {
        if (!error.isEmpty()) {
            emit locationResults({});
            return;
        }
        QVariantList out;
        for (const QJsonValue& v : doc.object().value(QLatin1String("results")).toArray()) {
            const QJsonObject r = v.toObject();
            QStringList parts{r.value(QLatin1String("name")).toString()};
            if (!r.value(QLatin1String("admin1")).toString().isEmpty())
                parts << r.value(QLatin1String("admin1")).toString();
            if (!r.value(QLatin1String("country")).toString().isEmpty())
                parts << r.value(QLatin1String("country")).toString();
            out.append(QVariantMap{
                {QStringLiteral("name"), parts.join(QStringLiteral(", "))},
                {QStringLiteral("lat"), r.value(QLatin1String("latitude")).toDouble()},
                {QStringLiteral("lon"), r.value(QLatin1String("longitude")).toDouble()},
                {QStringLiteral("timezone"), r.value(QLatin1String("timezone")).toString()},
            });
        }
        emit locationResults(out);
    });
}

void WeatherService::setLocation(const QString& name, double lat, double lon,
                                 const QString& timezone)
{
    const QJsonObject loc{
        {QStringLiteral("name"), name},
        {QStringLiteral("lat"), lat},
        {QStringLiteral("lon"), lon},
        {QStringLiteral("timezone"), timezone.isEmpty() ? QStringLiteral("auto") : timezone},
    };
    m_settings->set(QStringLiteral("wp-location"),
                    QString::fromUtf8(QJsonDocument(loc).toJson(QJsonDocument::Compact)));
    refresh();
}

void WeatherService::applyPayload(const QVariantMap& payload)
{
    const QLocale locale(QStringLiteral("fr_CA"));

    const QVariantMap current = payload.value(QStringLiteral("current")).toMap();
    const int code = current.value(QStringLiteral("weather_code")).toInt();
    const WmoInfo info = wmo(code);
    m_current = {
        {QStringLiteral("tempC"), current.value(QStringLiteral("temperature_2m"))},
        {QStringLiteral("apparentC"), current.value(QStringLiteral("apparent_temperature"))},
        {QStringLiteral("humidityPct"), current.value(QStringLiteral("relative_humidity_2m"))},
        {QStringLiteral("windKmh"), current.value(QStringLiteral("wind_speed_10m"))},
        {QStringLiteral("code"), code},
        {QStringLiteral("label"), info.label},
        {QStringLiteral("emoji"), info.emoji},
    };

    // Next 12 hours from now.
    m_hourly.clear();
    const QVariantMap hourly = payload.value(QStringLiteral("hourly")).toMap();
    const QVariantList times = hourly.value(QStringLiteral("time")).toList();
    const QVariantList temps = hourly.value(QStringLiteral("temperature_2m")).toList();
    const QVariantList codes = hourly.value(QStringLiteral("weather_code")).toList();
    const QDateTime now = QDateTime::currentDateTime();
    for (int i = 0; i < times.size() && m_hourly.size() < 12; ++i) {
        const QDateTime t = QDateTime::fromString(times.at(i).toString(), Qt::ISODate);
        if (!t.isValid() || t < now.addSecs(-3600))
            continue;
        const WmoInfo hourInfo = wmo(codes.value(i).toInt());
        m_hourly.append(QVariantMap{
            {QStringLiteral("hour"), QStringLiteral("%1h").arg(t.time().hour())},
            {QStringLiteral("tempC"), temps.value(i)},
            {QStringLiteral("emoji"), hourInfo.emoji},
        });
    }

    // Next 5 days.
    m_daily.clear();
    const QVariantMap daily = payload.value(QStringLiteral("daily")).toMap();
    const QVariantList days = daily.value(QStringLiteral("time")).toList();
    const QVariantList dCodes = daily.value(QStringLiteral("weather_code")).toList();
    const QVariantList maxes = daily.value(QStringLiteral("temperature_2m_max")).toList();
    const QVariantList mins = daily.value(QStringLiteral("temperature_2m_min")).toList();
    const QVariantList precip = daily.value(QStringLiteral("precipitation_probability_max")).toList();
    for (int i = 0; i < days.size() && m_daily.size() < 14; ++i) {
        const QDate day = QDate::fromString(days.at(i).toString(), Qt::ISODate);
        if (!day.isValid())
            continue;
        const WmoInfo dayInfo = wmo(dCodes.value(i).toInt());
        m_daily.append(QVariantMap{
            {QStringLiteral("day"), i == 0 ? QStringLiteral("Auj.")
                                           : locale.dayName(day.dayOfWeek(), QLocale::ShortFormat)},
            {QStringLiteral("emoji"), dayInfo.emoji},
            {QStringLiteral("label"), dayInfo.label},
            {QStringLiteral("maxC"), maxes.value(i)},
            {QStringLiteral("minC"), mins.value(i)},
            {QStringLiteral("precipPct"), precip.value(i)},
        });
    }

    m_ready = true;
    emit updated();
    qInfo() << "[weather]" << m_locationName
            << m_current.value(QStringLiteral("tempC")).toDouble() << "°C,"
            << m_hourly.size() << "hourly," << m_daily.size() << "daily";
}

} // namespace qtpanel
