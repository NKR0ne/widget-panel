#include "StocksModel.h"

#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QDateTime>
#include <QDebug>
#include <QHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>
#include <QSharedPointer>
#include <QTime>
#include <QTimeZone>
#include <QUrl>
#include <QUrlQuery>

#include <algorithm>
#include <limits>

namespace qtpanel {

namespace {
constexpr int kPollMs = 60000;
constexpr int kEventsRefreshMs = 6 * 60 * 60 * 1000;

const QStringList kEarningsColumns{
    QStringLiteral("name"),
    QStringLiteral("description"),
    QStringLiteral("earnings_release_next_date"),
    QStringLiteral("earnings_release_next_calendar_date"),
    QStringLiteral("revenue_forecast_next_fq"),
    QStringLiteral("earnings_per_share_forecast_next_fq"),
    QStringLiteral("fundamental_currency_code"),
    QStringLiteral("market"),
    QStringLiteral("exchange"),
    QStringLiteral("logoid"),
};

const QStringList kHeatmapPeriods{
    QStringLiteral("change"),
    QStringLiteral("Perf.W"),
    QStringLiteral("Perf.1M"),
    QStringLiteral("Perf.3M"),
    QStringLiteral("Perf.6M"),
    QStringLiteral("Perf.YTD"),
    QStringLiteral("Perf.Y"),
};

const QStringList kTradingViewColors{
    QStringLiteral("red"),
    QStringLiteral("orange"),
    QStringLiteral("yellow"),
    QStringLiteral("green"),
    QStringLiteral("blue"),
    QStringLiteral("purple"),
    QStringLiteral("aqua"),
    QStringLiteral("gray"),
};

// Map a TradingView symbol ("NASDAQ:NVDA") to a Yahoo ticker.
QString yahooFromTv(const QString& s, const QString& y) {
    if (!y.isEmpty())
        return y;
    const int colon = s.indexOf(QLatin1Char(':'));
    return colon >= 0 ? s.mid(colon + 1) : s;
}

QString finnhubSymbolFromTicker(QString ticker)
{
    ticker = ticker.trimmed().toUpper();
    if (ticker.startsWith(QLatin1Char('^')) || ticker.isEmpty())
        return {};
    ticker.replace(QLatin1Char('-'), QLatin1Char('.'));
    return ticker;
}

QString normalizeTvSymbol(const QString& value)
{
    const QString text = value.trimmed().toUpper();
    return text.contains(QLatin1Char(':')) ? text : QString();
}

QString displayTicker(const QString& symbol)
{
    const int colon = symbol.indexOf(QLatin1Char(':'));
    return colon >= 0 ? symbol.mid(colon + 1) : symbol;
}

QString normalizedListName(const QString& name)
{
    return name.trimmed().toLower();
}

bool isDefaultWatchlistName(const QString& name)
{
    return normalizedListName(name) == QLatin1String("liste de surveillance");
}

bool isGenericWatchlistName(const QString& name)
{
    const QString n = normalizedListName(name);
    return n == QLatin1String("liste de surveillance") || n == QLatin1String("watchlist");
}

bool isSurveillanceListName(const QString& name)
{
    return normalizedListName(name) == QLatin1String("surveillance");
}

int columnIndex(const QStringList& columns, const QString& name)
{
    return columns.indexOf(name);
}

QJsonValue tvCell(const QJsonObject& row, const QStringList& columns, const QString& name)
{
    const int idx = columnIndex(columns, name);
    if (idx < 0)
        return {};
    const QJsonArray d = row.value(QLatin1String("d")).toArray();
    return idx < d.size() ? d.at(idx) : QJsonValue();
}

double nullableNumber(const QJsonValue& value)
{
    if (value.isDouble())
        return value.toDouble();
    bool ok = false;
    const double n = value.toString().toDouble(&ok);
    return ok ? n : 0.0;
}

QString isoFromTradingViewDate(const QJsonValue& value)
{
    if (value.isNull() || value.isUndefined())
        return {};
    if (value.isDouble()) {
        const qint64 seconds = static_cast<qint64>(value.toDouble());
        return seconds > 0 ? QDateTime::fromSecsSinceEpoch(seconds).toString(Qt::ISODate) : QString();
    }
    const QString text = value.toString().trimmed();
    if (text.isEmpty())
        return {};
    const QDateTime parsed = QDateTime::fromString(text, Qt::ISODate);
    if (parsed.isValid())
        return parsed.toString(Qt::ISODate);
    const QDate date = QDate::fromString(text, Qt::ISODate);
    return date.isValid() ? QDateTime(date, QTime(0, 0),
                                      QTimeZone::fromSecondsAheadOfUtc(0)).toString(Qt::ISODate)
                          : QString();
}

qint64 eventSortTime(const QVariantMap& row)
{
    const QString date = row.value(QStringLiteral("date")).toString();
    const QDateTime parsed = QDateTime::fromString(date, Qt::ISODate);
    return parsed.isValid() ? parsed.toSecsSinceEpoch() : std::numeric_limits<qint64>::max();
}

QString normalizedHeatmapPeriod(const QString& value)
{
    return kHeatmapPeriods.contains(value) ? value : QStringLiteral("change");
}

QString colorTitle(const QString& color)
{
    if (color.isEmpty())
        return QStringLiteral("Watchlist");
    QString out = color;
    out[0] = out.at(0).toUpper();
    return out;
}

QJsonArray normalizeTvSymbols(const QJsonValue& raw)
{
    QJsonArray out;
    if (!raw.isArray())
        return out;

    QSet<QString> seen;
    for (const QJsonValue& value : raw.toArray()) {
        QString symbol;
        QString display;
        QString yahoo;
        if (value.isString()) {
            symbol = value.toString().trimmed();
            if (symbol.startsWith(QLatin1String("###")))
                continue;
            display = displayTicker(symbol);
        } else if (value.isObject()) {
            const QJsonObject obj = value.toObject();
            symbol = obj.value(QLatin1String("id")).toString();
            if (symbol.isEmpty())
                symbol = obj.value(QLatin1String("s")).toString();
            if (symbol.isEmpty())
                symbol = obj.value(QLatin1String("symbol")).toString();
            symbol = symbol.trimmed();
            display = obj.value(QLatin1String("description")).toString();
            if (display.isEmpty())
                display = obj.value(QLatin1String("d")).toString();
            if (display.isEmpty())
                display = obj.value(QLatin1String("name")).toString();
            yahoo = obj.value(QLatin1String("y")).toString();
        }
        if (symbol.isEmpty() || symbol.startsWith(QLatin1String("###")) || seen.contains(symbol))
            continue;
        seen.insert(symbol);
        if (display.isEmpty())
            display = displayTicker(symbol);
        QJsonObject entry{{QStringLiteral("s"), symbol}, {QStringLiteral("d"), display}};
        if (!yahoo.isEmpty())
            entry.insert(QStringLiteral("y"), yahoo);
        out.append(entry);
    }
    return out;
}

QJsonArray listsArrayFromDocument(const QJsonDocument& doc)
{
    if (doc.isArray())
        return doc.array();
    const QJsonObject obj = doc.object();
    const QStringList candidates{
        QStringLiteral("lists"),
        QStringLiteral("data"),
        QStringLiteral("watchlists"),
        QStringLiteral("activeLists"),
        QStringLiteral("payload"),
        QStringLiteral("results"),
    };
    for (const QString& key : candidates) {
        const QJsonValue value = obj.value(key);
        if (value.isArray())
            return value.toArray();
    }
    return {};
}

bool appendNormalizedList(QJsonArray& out, const QString& id, const QString& name,
                          const QJsonValue& symbolsValue)
{
    const QJsonArray symbols = normalizeTvSymbols(symbolsValue);
    if (symbols.isEmpty())
        return false;
    out.append(QJsonObject{
        {QStringLiteral("id"), id},
        {QStringLiteral("name"), name.isEmpty() ? QStringLiteral("Watchlist") : name},
        {QStringLiteral("symbols"), symbols},
    });
    return true;
}

struct WatchlistRefreshState {
    int pending = 0;
    QJsonArray lists;
};
} // namespace

StocksModel::StocksModel(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                         QObject* parent)
    : QAbstractListModel(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_http(http)
{
    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key == QLatin1String("wp-tv-lists-cache"))
            reloadLists();
        else if (key == QLatin1String("wp-market-provider"))
            refresh();
    });
    loadLists();
    m_pollTimer.setInterval(kPollMs);
    connect(&m_pollTimer, &QTimer::timeout, this, &StocksModel::refresh);
    m_pollTimer.start();
    m_eventsTimer.setInterval(kEventsRefreshMs);
    connect(&m_eventsTimer, &QTimer::timeout, this, [this] {
        refreshEarnings();
        refreshIpos();
    });
    m_eventsTimer.start();
    refresh();
    refreshEarnings();
    refreshIpos();
}

void StocksModel::loadLists()
{
    const int previous = m_current;
    beginResetModel();
    m_lists.clear();

    // Built-in "Marchés" overview (explicit Yahoo tickers).
    List markets;
    markets.name = QStringLiteral("Marchés");
    const struct { const char* tv; const char* y; const char* d; } overview[] = {
        {"SP:SPX", "^GSPC", "S&P 500"}, {"DJ:DJI", "^DJI", "Dow Jones"},
        {"NASDAQ:IXIC", "^IXIC", "NASDAQ"}, {"TVC:NI225", "^N225", "Nikkei 225"},
        {"TVC:UKX", "^FTSE", "FTSE 100"}, {"XETR:DAX", "^GDAXI", "DAX"},
        {"EURONEXT:PX1", "^FCHI", "CAC 40"}, {"TSX:TSX", "^GSPTSE", "S&P/TSX"},
    };
    for (const auto& e : overview)
        markets.rows.append({QString::fromUtf8(e.d), QLatin1String(e.tv),
                             QLatin1String(e.y), 0, 0, 0, 0, {}, false});
    m_lists.append(markets);

    // User TradingView watchlists from the cached session.
    const QString rawCache = m_settings->get(QStringLiteral("wp-tv-lists-cache")).toString();
    const QJsonArray lists = QJsonDocument::fromJson(rawCache.toUtf8()).array();
    for (const QJsonValue& lv : lists) {
        const QJsonObject lo = lv.toObject();
        const QString name = lo.value(QLatin1String("name")).toString();
        // Skip TradingView's default unnamed watchlist (matches the Electron filter).
        if (name.isEmpty() || name == QLatin1String("Liste de surveillance"))
            continue;
        List list;
        list.name = name;
        for (const QJsonValue& sv : lo.value(QLatin1String("symbols")).toArray()) {
            const QJsonObject so = sv.toObject();
            const QString s = so.value(QLatin1String("s")).toString();
            if (s.isEmpty())
                continue;
            const QString display = so.value(QLatin1String("d")).toString();
            list.rows.append({display.isEmpty() ? s : display,
                              normalizeTvSymbol(s),
                              yahooFromTv(s, so.value(QLatin1String("y")).toString()),
                              0, 0, 0, 0, {}, false});
        }
        if (!list.rows.isEmpty())
            m_lists.append(list);
    }

    if (m_lists.isEmpty()) {
        m_current = 0;
    } else {
        const int saved = m_settings->getInt(QStringLiteral("wp-tv-list-idx"), previous);
        m_current = std::clamp(saved, 0, static_cast<int>(m_lists.size()) - 1);
    }

    endResetModel();
    emit listsChanged();
    if (m_current != previous)
        emit currentListChanged();
    emit countChanged();
    emit heatmapRowsChanged();
    qInfo() << "[stocks]" << m_lists.size() << "lists";
}

QStringList StocksModel::listNames() const
{
    QStringList names;
    for (const List& l : m_lists)
        names << l.name;
    return names;
}

QVariantList StocksModel::heatmapRows() const
{
    QVariantList out;
    if (m_lists.isEmpty())
        return out;

    const List& source = m_lists.first();
    out.reserve(source.rows.size());
    for (const Row& row : source.rows) {
        out.append(QVariantMap{
            {QStringLiteral("display"), row.display},
            {QStringLiteral("ticker"), row.tvSymbol.isEmpty() ? row.ticker : displayTicker(row.tvSymbol)},
            {QStringLiteral("tvSymbol"), row.tvSymbol},
            {QStringLiteral("price"), row.price},
            {QStringLiteral("change"), row.change},
            {QStringLiteral("pct"), row.pct},
            {QStringLiteral("hasData"), row.hasData},
            {QStringLiteral("up"), row.change >= 0},
        });
    }
    return out;
}

void StocksModel::setList(int index)
{
    if (index < 0 || index >= m_lists.size() || index == m_current)
        return;
    beginResetModel();
    m_current = index;
    endResetModel();
    m_settings->set(QStringLiteral("wp-tv-list-idx"), index);
    emit currentListChanged();
    emit countChanged();
    refresh();
}

void StocksModel::reloadLists()
{
    loadLists();
    refresh();
    refreshEarnings();
}

void StocksModel::refreshWatchlists()
{
    if (m_watchlistsRefreshing)
        return;

    QString cookieHeader = m_settings->get(QStringLiteral("wp-tv-cookies")).toString();
    const QString sessionId = m_settings->get(QStringLiteral("wp-tv-session")).toString();
    if (cookieHeader.isEmpty() && !sessionId.isEmpty())
        cookieHeader = QStringLiteral("sessionid=") + sessionId;
    if (cookieHeader.isEmpty()) {
        m_watchlistsStatus = QStringLiteral("TradingView login required");
        emit watchlistsRefreshChanged();
        return;
    }

    m_watchlistsRefreshing = true;
    m_watchlistsStatus = QStringLiteral("Updating TradingView lists");
    emit watchlistsRefreshChanged();

    const QList<QPair<QByteArray, QByteArray>> headers{
        {"Cookie", cookieHeader.toUtf8()},
        {"Accept", "application/json,text/plain,*/*"},
        {"X-Requested-With", "XMLHttpRequest"},
        {"Referer", "https://www.tradingview.com/"},
    };
    auto state = QSharedPointer<WatchlistRefreshState>::create();

    const auto complete = [this, state] {
        --state->pending;
        if (state->pending > 0)
            return;

        m_watchlistsRefreshing = false;
        if (state->lists.isEmpty()) {
            m_watchlistsStatus = QStringLiteral("No TradingView lists found");
            emit watchlistsRefreshChanged();
            qWarning() << "[stocks] TradingView watchlist refresh returned no lists";
            return;
        }

        const QString payload = QString::fromUtf8(QJsonDocument(state->lists).toJson(QJsonDocument::Compact));
        m_settings->set(QStringLiteral("wp-tv-lists-cache"), payload);
        m_settings->set(QStringLiteral("wp-tv-lists-cache-at"),
                        QString::number(QDateTime::currentMSecsSinceEpoch()));
        m_watchlistsStatus = QStringLiteral("Updated %1 TradingView lists").arg(state->lists.size());
        emit watchlistsRefreshChanged();
        qInfo() << "[stocks] refreshed TradingView watchlists:" << state->lists.size();
    };

    const auto requestListById = [this, state, headers, complete](const QString& id,
                                                                  const QString& name) {
        if (id.isEmpty())
            return;
        ++state->pending;
        m_http->requestJsonAuth("GET",
            QUrl(QStringLiteral("https://www.tradingview.com/api/v1/symbols_list/custom/%1/")
                     .arg(QString::fromUtf8(QUrl::toPercentEncoding(id)))),
            QString(), {}, this,
            [state, id, name, complete](const QJsonDocument& doc, int status, const QString&) {
                if (status >= 200 && status < 300) {
                    appendNormalizedList(state->lists, id, name,
                                         doc.object().value(QLatin1String("symbols")));
                }
                complete();
            }, headers);
    };

    ++state->pending;
    m_http->requestJsonAuth("GET",
        QUrl(QStringLiteral("https://www.tradingview.com/api/v1/symbols_list/custom/")),
        QString(), {}, this,
        [state, requestListById, complete](const QJsonDocument& doc, int status, const QString&) {
            if (status >= 200 && status < 300) {
                for (const QJsonValue& value : listsArrayFromDocument(doc)) {
                    const QJsonObject obj = value.toObject();
                    const QString id = obj.value(QLatin1String("id")).toVariant().toString();
                    QString name = obj.value(QLatin1String("name")).toString();
                    if (name.isEmpty())
                        name = obj.value(QLatin1String("listName")).toString();
                    const bool added = appendNormalizedList(state->lists, id, name,
                                                           obj.value(QLatin1String("symbols")));
                    if (!added && !id.isEmpty())
                        requestListById(id, name);
                }
            }
            complete();
        }, headers);

    for (const QString& color : kTradingViewColors) {
        ++state->pending;
        m_http->requestJsonAuth("GET",
            QUrl(QStringLiteral("https://www.tradingview.com/api/v1/symbols_list/colored/%1/")
                     .arg(color)),
            QString(), {}, this,
            [state, color, complete](const QJsonDocument& doc, int status, const QString&) {
                if (status >= 200 && status < 300) {
                    const QJsonObject obj = doc.object();
                    QString name = obj.value(QLatin1String("name")).toString().trimmed();
                    if (name.isEmpty())
                        name = obj.value(QLatin1String("title")).toString().trimmed();
                    if (name.isEmpty())
                        name = colorTitle(color);
                    appendNormalizedList(state->lists, QStringLiteral("colored_") + color, name,
                                         obj.value(QLatin1String("symbols")));
                }
                complete();
            }, headers);
    }
}

void StocksModel::refresh()
{
    if (m_current < 0 || m_current >= m_lists.size())
        return;
    for (int i = 0; i < m_lists[m_current].rows.size(); ++i)
        fetchRow(m_current, i);
}

QStringList StocksModel::earningsSymbols() const
{
    const List* chosen = nullptr;
    for (const List& list : m_lists) {
        if (isSurveillanceListName(list.name)) {
            chosen = &list;
            break;
        }
    }
    if (!chosen) {
        for (const List& list : m_lists) {
            if (!isDefaultWatchlistName(list.name) && isGenericWatchlistName(list.name)) {
                chosen = &list;
                break;
            }
        }
    }
    if (!chosen) {
        for (const List& list : m_lists) {
            if (isGenericWatchlistName(list.name)) {
                chosen = &list;
                break;
            }
        }
    }
    if (!chosen) {
        for (const List& list : m_lists) {
            if (!list.rows.isEmpty()) {
                chosen = &list;
                break;
            }
        }
    }
    if (!chosen)
        return {};

    QStringList out;
    QSet<QString> seen;
    for (const Row& row : chosen->rows) {
        const QString symbol = normalizeTvSymbol(row.tvSymbol);
        if (symbol.isEmpty() || seen.contains(symbol))
            continue;
        seen.insert(symbol);
        out << symbol;
    }
    return out;
}

void StocksModel::refreshEarnings()
{
    const QStringList symbols = earningsSymbols();
    if (symbols.isEmpty()) {
        m_earnings = {};
        emit earningsChanged();
        return;
    }

    const QJsonObject body{
        {QStringLiteral("symbols"), QJsonObject{
            {QStringLiteral("tickers"), QJsonArray::fromStringList(symbols)},
            {QStringLiteral("query"), QJsonObject{{QStringLiteral("types"), QJsonArray{}}}},
        }},
        {QStringLiteral("columns"), QJsonArray::fromStringList(kEarningsColumns)},
        {QStringLiteral("range"), QJsonArray{0, qMax(50, symbols.size())}},
    };
    const QList<QPair<QByteArray, QByteArray>> headers{
        {"Origin", "https://www.tradingview.com"},
        {"Referer", "https://www.tradingview.com/"},
    };
    m_http->requestJsonAuth("POST",
        QUrl(QStringLiteral("https://scanner.tradingview.com/global/scan?label-product=calendar-earnings")),
        QString(), QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this, symbols](const QJsonDocument& doc, int status, const QString&) {
            if (status < 200 || status >= 300)
                return;

            QHash<QString, QVariantMap> bySymbol;
            for (const QJsonValue& rv : doc.object().value(QLatin1String("data")).toArray()) {
                const QJsonObject row = rv.toObject();
                const QString symbol = normalizeTvSymbol(row.value(QLatin1String("s")).toString());
                if (symbol.isEmpty())
                    continue;
                const QString ticker = tvCell(row, kEarningsColumns, QStringLiteral("name"))
                                           .toString(displayTicker(symbol));
                QString date = isoFromTradingViewDate(
                    tvCell(row, kEarningsColumns, QStringLiteral("earnings_release_next_date")));
                if (date.isEmpty()) {
                    date = isoFromTradingViewDate(
                        tvCell(row, kEarningsColumns, QStringLiteral("earnings_release_next_calendar_date")));
                }
                bySymbol.insert(symbol, QVariantMap{
                    {QStringLiteral("source"), QStringLiteral("TradingView")},
                    {QStringLiteral("symbol"), symbol},
                    {QStringLiteral("ticker"), ticker},
                    {QStringLiteral("name"),
                     tvCell(row, kEarningsColumns, QStringLiteral("description")).toString(ticker)},
                    {QStringLiteral("date"), date},
                    {QStringLiteral("dateUnavailable"), date.isEmpty()},
                    {QStringLiteral("revenueAverage"),
                     nullableNumber(tvCell(row, kEarningsColumns, QStringLiteral("revenue_forecast_next_fq")))},
                    {QStringLiteral("epsForecast"),
                     nullableNumber(tvCell(row, kEarningsColumns, QStringLiteral("earnings_per_share_forecast_next_fq")))},
                    {QStringLiteral("currency"),
                     tvCell(row, kEarningsColumns, QStringLiteral("fundamental_currency_code")).toString(QStringLiteral("USD"))},
                    {QStringLiteral("exchange"),
                     tvCell(row, kEarningsColumns, QStringLiteral("exchange")).toString(symbol.section(QLatin1Char(':'), 0, 0))},
                });
            }

            QList<QVariantMap> rows;
            for (const QString& symbol : symbols) {
                if (bySymbol.contains(symbol)) {
                    rows.append(bySymbol.value(symbol));
                } else {
                    const QString ticker = displayTicker(symbol);
                    rows.append(QVariantMap{
                        {QStringLiteral("source"), QStringLiteral("TradingView")},
                        {QStringLiteral("symbol"), symbol},
                        {QStringLiteral("ticker"), ticker},
                        {QStringLiteral("name"), ticker},
                        {QStringLiteral("date"), QString()},
                        {QStringLiteral("dateUnavailable"), true},
                        {QStringLiteral("revenueAverage"), 0.0},
                        {QStringLiteral("epsForecast"), 0.0},
                        {QStringLiteral("currency"), QString()},
                        {QStringLiteral("exchange"), symbol.section(QLatin1Char(':'), 0, 0)},
                    });
                }
            }
            std::sort(rows.begin(), rows.end(), [](const QVariantMap& a, const QVariantMap& b) {
                return eventSortTime(a) < eventSortTime(b);
            });

            QVariantList out;
            for (const QVariantMap& row : rows)
                out.append(row);
            m_earnings = out;
            emit earningsChanged();
            qInfo() << "[stocks] earnings calendar:" << out.size() << "entries";
        }, headers);
}

void StocksModel::fetchRow(int listIndex, int rowIndex)
{
    if (listIndex >= m_lists.size() || rowIndex >= m_lists[listIndex].rows.size())
        return;
    if (marketProvider() == QLatin1String("finnhub")) {
        fetchFinnhubRow(listIndex, rowIndex);
        return;
    }
    const QString ticker = m_lists[listIndex].rows[rowIndex].ticker;
    QUrl url(QStringLiteral("https://query1.finance.yahoo.com/v8/finance/chart/%1")
                 .arg(QString::fromUtf8(QUrl::toPercentEncoding(ticker))));
    url.setQuery(QStringLiteral("range=1d&interval=5m"));

    m_http->getJson(url, this, [this, listIndex, ticker](const QJsonDocument& doc, const QString& error) {
        if (listIndex != m_current || listIndex >= m_lists.size())
            return; // user switched lists; drop stale result
        int row = -1;
        for (int i = 0; i < m_lists[listIndex].rows.size(); ++i)
            if (m_lists[listIndex].rows[i].ticker == ticker) { row = i; break; }
        if (row < 0)
            return;
        if (!error.isEmpty()) {
            if (marketProvider() == QLatin1String("auto"))
                fetchFinnhubRow(listIndex, row);
            return;
        }

        const QJsonArray results = doc.object().value(QLatin1String("chart")).toObject()
            .value(QLatin1String("result")).toArray();
        if (results.isEmpty()) {
            if (marketProvider() == QLatin1String("auto"))
                fetchFinnhubRow(listIndex, row);
            return;
        }
        const QJsonObject result = results.at(0).toObject();
        const QJsonObject meta = result.value(QLatin1String("meta")).toObject();
        if (meta.isEmpty()) {
            if (marketProvider() == QLatin1String("auto"))
                fetchFinnhubRow(listIndex, row);
            return;
        }
        Row& entry = m_lists[listIndex].rows[row];
        entry.price = meta.value(QLatin1String("regularMarketPrice")).toDouble();
        entry.prevClose = meta.value(QLatin1String("chartPreviousClose"))
            .toDouble(meta.value(QLatin1String("previousClose")).toDouble());
        entry.change = entry.price - entry.prevClose;
        entry.pct = entry.prevClose != 0.0 ? entry.change / entry.prevClose * 100.0 : 0.0;
        entry.closes.clear();
        const QJsonArray quotes = result.value(QLatin1String("indicators")).toObject()
            .value(QLatin1String("quote")).toArray();
        const QJsonArray closes = quotes.isEmpty()
            ? QJsonArray()
            : quotes.at(0).toObject().value(QLatin1String("close")).toArray();
        for (const QJsonValue& v : closes)
            if (v.isDouble())
                entry.closes.append(v.toDouble());
        entry.hasData = true;
        emit dataChanged(index(row), index(row));
        if (listIndex == 0)
            emit heatmapRowsChanged();
    });
}

QString StocksModel::marketProvider() const
{
    const QString raw = m_settings->get(QStringLiteral("wp-market-provider"),
                                        QStringLiteral("auto")).toString().trimmed().toLower();
    if (raw == QLatin1String("yahoo") || raw == QLatin1String("finnhub"))
        return raw;
    return QStringLiteral("auto");
}

void StocksModel::fetchFinnhubRow(int listIndex, int rowIndex)
{
    if (!m_vault || listIndex >= m_lists.size() || rowIndex >= m_lists[listIndex].rows.size())
        return;
    const QString key = m_vault->get(QStringLiteral("finnhub-key")).trimmed();
    if (key.isEmpty())
        return;
    const QString ticker = m_lists[listIndex].rows[rowIndex].ticker;
    const QString symbol = finnhubSymbolFromTicker(ticker);
    if (symbol.isEmpty())
        return;

    QUrl url(QStringLiteral("https://finnhub.io/api/v1/quote"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("symbol"), symbol);
    query.addQueryItem(QStringLiteral("token"), key);
    url.setQuery(query);

    m_http->getJson(url, this, [this, listIndex, symbol](const QJsonDocument& doc, const QString& error) {
        if (listIndex != m_current || listIndex >= m_lists.size() || !error.isEmpty())
            return;
        int row = -1;
        for (int i = 0; i < m_lists[listIndex].rows.size(); ++i) {
            if (finnhubSymbolFromTicker(m_lists[listIndex].rows[i].ticker) == symbol) {
                row = i;
                break;
            }
        }
        if (row < 0)
            return;

        const QJsonObject obj = doc.object();
        const double price = obj.value(QLatin1String("c")).toDouble();
        const double prevClose = obj.value(QLatin1String("pc")).toDouble();
        if (price <= 0 || prevClose <= 0)
            return;

        Row& entry = m_lists[listIndex].rows[row];
        entry.price = price;
        entry.prevClose = prevClose;
        entry.change = obj.value(QLatin1String("d")).toDouble(price - prevClose);
        entry.pct = obj.value(QLatin1String("dp")).toDouble(
            prevClose != 0.0 ? entry.change / prevClose * 100.0 : 0.0);
        if (entry.closes.isEmpty()) {
            entry.closes.append(prevClose);
            entry.closes.append(price);
        }
        entry.hasData = true;
        emit dataChanged(index(row), index(row));
        if (listIndex == 0)
            emit heatmapRowsChanged();
    });
}

// IPO calendar via the public TradingView scanner (no auth).
void StocksModel::refreshIpos()
{
    const qint64 from = (QDateTime::currentSecsSinceEpoch() - 24 * 3600);
    const qint64 to = (QDateTime::currentSecsSinceEpoch() + 120LL * 24 * 3600);
    const QJsonObject body{
        {QStringLiteral("preset"), QStringLiteral("ipo_calendar")},
        {QStringLiteral("columns"), QJsonArray{QStringLiteral("name"), QStringLiteral("description"),
            QStringLiteral("ipo_offer_time"), QStringLiteral("ipo_price_range_usd"),
            QStringLiteral("exchange")}},
        {QStringLiteral("filter"), QJsonArray{QJsonObject{
            {QStringLiteral("left"), QStringLiteral("ipo_offer_time")},
            {QStringLiteral("operation"), QStringLiteral("in_range")},
            {QStringLiteral("right"), QJsonArray{from, to}}}}},
        {QStringLiteral("range"), QJsonArray{0, 40}},
    };
    const QList<QPair<QByteArray, QByteArray>> headers{
        {"Origin", "https://www.tradingview.com"},
        {"Referer", "https://www.tradingview.com/"},
    };
    m_http->requestJsonAuth("POST",
        QUrl(QStringLiteral("https://scanner.tradingview.com/global/scan?label-product=calendar-ipo")),
        QString(), QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this](const QJsonDocument& doc, int status, const QString&) {
            if (status < 200 || status >= 300)
                return;
            QVariantList out;
            for (const QJsonValue& rv : doc.object().value(QLatin1String("data")).toArray()) {
                const QJsonObject row = rv.toObject();
                const QJsonArray d = row.value(QLatin1String("d")).toArray();
                if (d.size() < 5)
                    continue;
                const qint64 t = static_cast<qint64>(d.at(2).toDouble());
                const QString symbol = normalizeTvSymbol(row.value(QLatin1String("s")).toString());
                out.append(QVariantMap{
                    {QStringLiteral("symbol"), symbol},
                    {QStringLiteral("ticker"), symbol.isEmpty() ? d.at(0).toString() : displayTicker(symbol)},
                    {QStringLiteral("name"), d.at(0).toString()},
                    {QStringLiteral("desc"), d.at(1).toString()},
                    {QStringLiteral("date"), QDateTime::fromSecsSinceEpoch(t).toString(QStringLiteral("d MMM"))},
                    {QStringLiteral("priceRange"), d.at(3).toString()},
                    {QStringLiteral("exchange"), d.at(4).toString()},
                });
            }
            m_ipos = out;
            emit iposChanged();
            qInfo() << "[stocks] IPO calendar:" << out.size() << "entries";
        }, headers);
}

QString StocksModel::heatmapUrl(const QString& blockColor, const QString& layout) const
{
    const QString safeLayout = (layout == QLatin1String("width-scroll")
                                || layout == QLatin1String("height-fit"))
        ? layout
        : QStringLiteral("fit");
    const QString safeBlockColor = normalizedHeatmapPeriod(blockColor);
    const int baseWidth = 768;
    const int baseHeight = safeLayout == QLatin1String("height-fit") ? 1180 : 1024;
    const QString overflow = safeLayout == QLatin1String("width-scroll")
        ? QStringLiteral("auto")
        : QStringLiteral("hidden");
    const QString cacheKey = QString::number(QDateTime::currentMSecsSinceEpoch());

    QString html = QString::fromUtf8(R"(<!DOCTYPE html>
<html style="margin:0;padding:0;width:100%;height:100%;background:#0a0a0c">
<head><meta charset="utf-8"><style>
html{margin:0;padding:0;width:100%;height:100%;background:#0a0a0c}
body{margin:0;padding:0;width:100vw;min-width:100vw;min-height:100vh;background:#0a0a0c;overflow:__OVERFLOW__}
#wrap{position:relative;width:100vw;min-height:100vh;overflow:visible;background:#0a0a0c}
#scaled{position:absolute;top:0;left:0;width:__BASE_WIDTH__px;height:__BASE_HEIGHT__px;transform-origin:0 0}
.tradingview-widget-container,.tradingview-widget-container__widget{width:__BASE_WIDTH__px;height:__BASE_HEIGHT__px}
iframe{pointer-events:auto}
.tradingview-widget-copyright{display:none}
</style></head>
<body>
<div id="wrap">
  <div id="scaled">
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js?wp=__CACHE_KEY__" async>
      {
        "dataSource": "SPX500",
        "blockSize": "market_cap_basic",
        "blockColor": "__BLOCK_COLOR__",
        "grouping": "sector",
        "isTransparent": true,
        "locale": "en",
        "symbolUrl": "https://www.tradingview.com/chart/?symbol={tvprosymbol}",
        "colorTheme": "dark",
        "width": "100%",
        "height": "100%",
        "hasTopBar": false,
        "isDataSetEnabled": false,
        "isZoomEnabled": true,
        "hasSymbolTooltip": true,
        "isMonoSize": false
      }
      </script>
    </div>
  </div>
</div>
<script>
function fit(){
  var wrap=document.getElementById('wrap');
  var scaled=document.getElementById('scaled');
  if(!wrap||!scaled)return;
  var layout='__LAYOUT__';
  var baseW=__BASE_WIDTH__;
  var baseH=__BASE_HEIGHT__;
  var width=Math.max(320,wrap.clientWidth||window.innerWidth||baseW);
  var height=Math.max(360,wrap.clientHeight||window.innerHeight||baseH);
  var s=layout==='width-scroll'?width/baseW:Math.min(width/baseW,height/baseH);
  if(layout==='height-fit')s=Math.min(height/baseH,width/baseW);
  var nextW=Math.max(320,Math.floor(baseW*s));
  var nextH=Math.max(426,Math.floor(baseH*s));
  var tx=layout==='width-scroll'?0:Math.max(0,Math.floor((width-nextW)/2));
  var ty=layout==='width-scroll'?0:Math.max(0,Math.floor((height-nextH)/2));
  scaled.style.width=baseW+'px';
  scaled.style.height=baseH+'px';
  scaled.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';
  if(layout==='width-scroll'){
    document.documentElement.style.height='auto';
    document.body.style.height=nextH+'px';
    wrap.style.height=nextH+'px';
  }else{
    document.documentElement.style.height='100vh';
    document.body.style.height='100vh';
    wrap.style.height='100vh';
  }
}
fit();
window.addEventListener('resize',fit);
new ResizeObserver(fit).observe(document.getElementById('wrap'));
</script>
</body>
</html>)");

    html.replace(QStringLiteral("__OVERFLOW__"), overflow);
    html.replace(QStringLiteral("__BASE_WIDTH__"), QString::number(baseWidth));
    html.replace(QStringLiteral("__BASE_HEIGHT__"), QString::number(baseHeight));
    html.replace(QStringLiteral("__CACHE_KEY__"), cacheKey);
    html.replace(QStringLiteral("__BLOCK_COLOR__"), safeBlockColor);
    html.replace(QStringLiteral("__LAYOUT__"), safeLayout);

    return QStringLiteral("data:text/html;charset=utf-8,")
        + QString::fromLatin1(QUrl::toPercentEncoding(html));
}

int StocksModel::rowCount(const QModelIndex& parent) const
{
    if (parent.isValid() || m_current < 0 || m_current >= m_lists.size())
        return 0;
    return static_cast<int>(m_lists[m_current].rows.size());
}

QVariant StocksModel::data(const QModelIndex& index, int role) const
{
    if (!index.isValid() || m_current >= m_lists.size()
        || index.row() >= m_lists[m_current].rows.size())
        return {};
    const Row& row = m_lists[m_current].rows.at(index.row());
    switch (role) {
    case DisplayRole:   return row.display;
    case TickerRole:    return row.ticker;
    case PriceRole:     return row.price;
    case ChangeRole:    return row.change;
    case PctRole:       return row.pct;
    case ClosesRole:    return row.closes;
    case PrevCloseRole: return row.prevClose;
    case HasDataRole:   return row.hasData;
    case UpRole:        return row.change >= 0;
    case TvSymbolRole:  return row.tvSymbol;
    }
    return {};
}

QHash<int, QByteArray> StocksModel::roleNames() const
{
    return {
        {DisplayRole, "display"}, {TickerRole, "ticker"}, {PriceRole, "price"},
        {ChangeRole, "change"}, {PctRole, "pct"}, {ClosesRole, "closes"},
        {PrevCloseRole, "prevClose"}, {HasDataRole, "hasData"}, {UpRole, "up"},
        {TvSymbolRole, "tvSymbol"},
    };
}

} // namespace qtpanel
