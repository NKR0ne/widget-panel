#include "MarketInsights.h"
#include "StocksModel.h"
#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include <QDateTime>
#include <QTimeZone>
#include <QJsonArray>
#include <QUrlQuery>
#include <QSet>
#include <algorithm>
#include <cmath>

namespace qtpanel {
QVariantMap MarketInsights::parseChart(const QJsonObject& result, const QVariantMap& symbol, qint64 now)
{
    const auto meta = result.value("meta").toObject();
    const qint64 time = meta.value("regularMarketTime").toVariant().toLongLong();
    const double price = meta.value("regularMarketPrice").toDouble();
    QTimeZone zone(meta.value("exchangeTimezoneName").toString().toUtf8());
    if (!zone.isValid() || time <= 0 || time > now + 300 || price <= 0 || !std::isfinite(price)) return {};
    const auto quoted = QDateTime::fromSecsSinceEpoch(time, zone);
    const auto session = quoted.date();
    const auto timestamps = result.value("timestamp").toArray();
    const auto quotes = result.value("indicators").toObject().value("quote").toArray();
    if (quotes.isEmpty()) return {};
    const auto closes = quotes[0].toObject().value("close").toArray();
    const auto volumes = quotes[0].toObject().value("volume").toArray();
    double previousClose = 0, volumeSum = 0;
    int volumeCount = 0;
    QSet<QDate> dates;
    // Daily candles are ordered oldest first. Exclude the current session from the baseline.
    for (int i = timestamps.size() - 1; i >= 0; --i) {
        const auto day = QDateTime::fromSecsSinceEpoch(timestamps[i].toVariant().toLongLong(), zone).date();
        if (day >= session || dates.contains(day)) continue;
        dates.insert(day);
        if (previousClose <= 0 && i < closes.size() && closes[i].toDouble() > 0) previousClose = closes[i].toDouble();
        if (volumeCount < 20 && i < volumes.size() && volumes[i].isDouble() && volumes[i].toDouble() >= 0) {
            volumeSum += volumes[i].toDouble(); ++volumeCount;
        }
    }
    if (previousClose <= 0) return {};
    auto row = symbol;
    row["price"] = price; row["percent"] = (price - previousClose) / previousClose * 100;
    row["quoteTime"] = time; row["session"] = session.toString(Qt::ISODate);
    row["timezone"] = QString::fromUtf8(zone.id());
    row["asOf"] = quoted.toString("yyyy-MM-dd HH:mm t");
    row["source"] = "Yahoo Finance"; row["stale"] = now - time > 30 * 60;
    row["relativeVolume"] = volumeCount == 20 && volumeSum > 0 && meta.value("regularMarketVolume").isDouble()
        ? QVariant(meta.value("regularMarketVolume").toDouble() / (volumeSum / 20)) : QVariant();
    row["volumeLabel"] = QStringLiteral("Volume de s\u00e9ance / moyenne 20 s\u00e9ances (non ajust\u00e9 \u00e0 l'heure)");
    return row;
}
QVariantList MarketInsights::rank(const QVariantList& values, qint64 now)
{
    QVariantList rows;
    QSet<QString> seen;
    for (const auto& value : values) {
        const auto row = value.toMap();
        const auto symbol = row.value("symbol").toString();
        const auto time = row.value("quoteTime").toLongLong();
        if (symbol.isEmpty() || seen.contains(symbol) || time <= 0 || now - time > 4 * 86400 || time > now + 300
                || !std::isfinite(row.value("percent").toDouble())) continue;
        seen.insert(symbol); rows.append(row);
    }
    std::sort(rows.begin(), rows.end(), [](const QVariant& a, const QVariant& b) {
        const auto x = a.toMap(), y = b.toMap();
        const auto xp = std::abs(x.value("percent").toDouble()), yp = std::abs(y.value("percent").toDouble());
        return xp == yp ? x.value("symbol").toString() < y.value("symbol").toString() : xp > yp;
    });
    return rows;
}
MarketInsights::MarketInsights(StocksModel* stocks, HttpClient* http, SecretVault* vault, QObject* parent)
    : QObject(parent), m_stocks(stocks), m_http(http), m_vault(vault)
{
    m_poll.setInterval(10 * 60 * 1000);
    connect(&m_poll, &QTimer::timeout, this, &MarketInsights::refresh); m_poll.start();
    connect(stocks, &StocksModel::listsChanged, this, [this] {
        ++m_generation; m_busy = false; m_movers.clear(); refresh();
    });
    QTimer::singleShot(2500, this, &MarketInsights::refresh);
}
void MarketInsights::refresh()
{
    if (m_busy) return;
    m_queue = m_stocks->watchlistSymbols(); m_pending.clear(); m_failures = 0;
    m_consecutiveErrors = 0; m_total = m_queue.size();
    if (m_queue.isEmpty()) { m_movers.clear(); m_status = QStringLiteral("Aucune liste de surveillance"); emit updated(); return; }
    m_busy = true; m_status = QStringLiteral("Actualisation des tendances..."); emit updated(); next(++m_generation);
}
void MarketInsights::next(int generation)
{
    if (generation != m_generation) return;
    if (m_queue.isEmpty()) {
        m_busy = false;
        m_movers = rank(m_pending, QDateTime::currentSecsSinceEpoch());
        m_status = QStringLiteral("%1 titres - Yahoo Finance - %2%3").arg(m_movers.size())
            .arg(QDateTime::currentDateTime().toString("HH:mm"))
            .arg(m_failures ? QStringLiteral(" - %1 indisponibles").arg(m_failures) : QString());
        emit updated(); emit refreshed(); return;
    }
    const auto symbol = m_queue.takeFirst().toMap();
    QUrl url(QString("https://query1.finance.yahoo.com/v8/finance/chart/%1").arg(QString::fromUtf8(QUrl::toPercentEncoding(symbol.value("ticker").toString()))));
    url.setQuery("range=3mo&interval=1d");
    m_http->getJson(url, this, [this, generation, symbol](const QJsonDocument& doc, const QString& error) {
        if (generation != m_generation) return;
        const auto result = doc.object().value("chart").toObject().value("result").toArray();
        const auto row = error.isEmpty() && !result.isEmpty()
            ? parseChart(result[0].toObject(), symbol, QDateTime::currentSecsSinceEpoch()) : QVariantMap();
        if (row.isEmpty()) ++m_failures; else m_pending.append(row);
        m_consecutiveErrors = error.isEmpty() ? 0 : m_consecutiveErrors + 1;
        if (m_consecutiveErrors >= 3) {
            m_failures += m_queue.size(); m_queue.clear();
        }
        m_movers = rank(m_pending, QDateTime::currentSecsSinceEpoch());
        m_status = QStringLiteral("Tendances : %1 / %2 titres v\u00e9rifi\u00e9s").arg(m_total - m_queue.size()).arg(m_total);
        emit updated();
        QTimer::singleShot(1500, this, [this, generation] { next(generation); });
    });
}
void MarketInsights::loadNews(const QString& symbol)
{
    const auto generation = ++m_newsGeneration;
    m_headlines.clear();
    const auto now = QDateTime::currentMSecsSinceEpoch();
    if (m_newsFetched.contains(symbol) && now - m_newsFetched[symbol] < 15 * 60000) {
        m_headlines = m_newsCache[symbol]; m_newsStatus = symbol + QStringLiteral(" - actualit\u00e9s Finnhub (cache 15 min)"); emit newsChanged(); return;
    }
    const auto key = m_vault->get("finnhub-key").trimmed();
    if (key.isEmpty()) { m_newsStatus = QStringLiteral("Cl\u00e9 Finnhub requise dans Param\u00e8tres / March\u00e9s"); emit newsChanged(); return; }
    QVariantMap found;
    for (const auto& value : m_stocks->watchlistSymbols()) if (value.toMap().value("symbol") == symbol) found = value.toMap();
    const auto exchange = symbol.section(':',0,0);
    if (found.isEmpty() || !(exchange == "NASDAQ" || exchange == "NYSE" || exchange == "AMEX" || exchange == "TSX" || exchange == "TSXV")) {
        m_newsStatus = QStringLiteral("Actualit\u00e9s Finnhub : soci\u00e9t\u00e9s nord-am\u00e9ricaines uniquement"); emit newsChanged(); return;
    }
    if (now - m_lastNewsRequest < 2000) { m_newsStatus = QStringLiteral("Veuillez patienter deux secondes"); emit newsChanged(); return; }
    m_lastNewsRequest = now;
    QString ticker = symbol.section(':', 1);
    if (exchange == "TSX") ticker += ".TO";
    if (exchange == "TSXV") ticker += ".V";
    QUrl url("https://finnhub.io/api/v1/company-news"); QUrlQuery query;
    const auto today = QDateTime::currentDateTimeUtc().date();
    query.addQueryItem("symbol", ticker); query.addQueryItem("from", today.addDays(-3).toString(Qt::ISODate));
    query.addQueryItem("to", today.toString(Qt::ISODate)); url.setQuery(query);
    m_newsStatus = symbol + QStringLiteral(" - recherche d'actualit\u00e9s..."); emit newsChanged();
    m_http->requestJsonAuth("GET", url, {}, {}, this,
        [this, generation, symbol](const QJsonDocument& doc, int status, const QString& error) {
            if (generation != m_newsGeneration) return;
            if (status != 200 || !error.isEmpty() || !doc.isArray()) {
                m_newsStatus = QStringLiteral("Actualit\u00e9s indisponibles (Finnhub HTTP %1, cl\u00e9 / quota / couverture)").arg(status); emit newsChanged(); return;
            }
            QVariantList headlines; QSet<QString> seen;
            for (const auto& value : doc.array()) {
                const auto item = value.toObject(); const QUrl link(item.value("url").toString());
                const qint64 date = item.value("datetime").toVariant().toLongLong();
                if ((link.scheme() != "https" && link.scheme() != "http") || item.value("headline").toString().isEmpty()
                    || seen.contains(link.toString()) || date <= 0 || date > QDateTime::currentSecsSinceEpoch() + 300) continue;
                seen.insert(link.toString());
                headlines.append(QVariantMap{{"title", item.value("headline").toString()}, {"link", link.toString()},
                    {"source", item.value("source").toString()}, {"published", date * 1000}});
            }
            std::sort(headlines.begin(), headlines.end(), [](const QVariant& a, const QVariant& b) { return a.toMap().value("published").toLongLong() > b.toMap().value("published").toLongLong(); });
            if (headlines.size() > 10) headlines = headlines.mid(0,10);
            m_headlines = headlines; m_newsCache[symbol] = headlines; m_newsFetched[symbol] = QDateTime::currentMSecsSinceEpoch();
            m_newsStatus = symbol + (headlines.isEmpty() ? QStringLiteral(" - aucune actualit\u00e9 disponible") : QStringLiteral(" - actualit\u00e9s associ\u00e9es, causalit\u00e9 non confirm\u00e9e"));
            emit newsChanged();
        }, {{"X-Finnhub-Token", key.toUtf8()}});
}
}
