#include "StocksModel.h"

#include "core/HttpClient.h"
#include "core/SettingsStore.h"

#include <QDateTime>
#include <QDebug>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QUrl>

namespace qtpanel {

namespace {
constexpr int kPollMs = 60000;

// Map a TradingView symbol ("NASDAQ:NVDA") to a Yahoo ticker.
QString yahooFromTv(const QString& s, const QString& y) {
    if (!y.isEmpty())
        return y;
    const int colon = s.indexOf(QLatin1Char(':'));
    return colon >= 0 ? s.mid(colon + 1) : s;
}
} // namespace

StocksModel::StocksModel(SettingsStore* settings, HttpClient* http, QObject* parent)
    : QAbstractListModel(parent)
    , m_settings(settings)
    , m_http(http)
{
    loadLists();
    m_pollTimer.setInterval(kPollMs);
    connect(&m_pollTimer, &QTimer::timeout, this, &StocksModel::refresh);
    m_pollTimer.start();
    refresh();
    refreshIpos();
}

void StocksModel::loadLists()
{
    m_lists.clear();

    // Built-in "Marchés" overview (explicit Yahoo tickers).
    List markets;
    markets.name = QStringLiteral("Marchés");
    const struct { const char* y; const char* d; } overview[] = {
        {"^GSPC", "S&P 500"}, {"^DJI", "Dow Jones"}, {"^IXIC", "NASDAQ"},
        {"^N225", "Nikkei 225"}, {"^FTSE", "FTSE 100"}, {"^GDAXI", "DAX"},
        {"^FCHI", "CAC 40"}, {"^GSPTSE", "S&P/TSX"},
    };
    for (const auto& e : overview)
        markets.rows.append({QString::fromUtf8(e.d), QLatin1String(e.y), 0, 0, 0, 0, {}, false});
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
                              yahooFromTv(s, so.value(QLatin1String("y")).toString()),
                              0, 0, 0, 0, {}, false});
        }
        if (!list.rows.isEmpty())
            m_lists.append(list);
    }

    emit listsChanged();
    qInfo() << "[stocks]" << m_lists.size() << "lists";
}

QStringList StocksModel::listNames() const
{
    QStringList names;
    for (const List& l : m_lists)
        names << l.name;
    return names;
}

void StocksModel::setList(int index)
{
    if (index < 0 || index >= m_lists.size() || index == m_current)
        return;
    beginResetModel();
    m_current = index;
    endResetModel();
    emit currentListChanged();
    emit countChanged();
    refresh();
}

void StocksModel::refresh()
{
    if (m_current < 0 || m_current >= m_lists.size())
        return;
    for (int i = 0; i < m_lists[m_current].rows.size(); ++i)
        fetchRow(m_current, i);
}

void StocksModel::fetchRow(int listIndex, int rowIndex)
{
    if (listIndex >= m_lists.size() || rowIndex >= m_lists[listIndex].rows.size())
        return;
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
        if (row < 0 || !error.isEmpty())
            return;

        const QJsonObject result = doc.object().value(QLatin1String("chart")).toObject()
            .value(QLatin1String("result")).toArray().at(0).toObject();
        const QJsonObject meta = result.value(QLatin1String("meta")).toObject();
        if (meta.isEmpty())
            return;
        Row& entry = m_lists[listIndex].rows[row];
        entry.price = meta.value(QLatin1String("regularMarketPrice")).toDouble();
        entry.prevClose = meta.value(QLatin1String("chartPreviousClose"))
            .toDouble(meta.value(QLatin1String("previousClose")).toDouble());
        entry.change = entry.price - entry.prevClose;
        entry.pct = entry.prevClose != 0.0 ? entry.change / entry.prevClose * 100.0 : 0.0;
        entry.closes.clear();
        const QJsonArray closes = result.value(QLatin1String("indicators")).toObject()
            .value(QLatin1String("quote")).toArray().at(0).toObject()
            .value(QLatin1String("close")).toArray();
        for (const QJsonValue& v : closes)
            if (v.isDouble())
                entry.closes.append(v.toDouble());
        entry.hasData = true;
        emit dataChanged(index(row), index(row));
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
                const QJsonArray d = rv.toObject().value(QLatin1String("d")).toArray();
                if (d.size() < 5)
                    continue;
                const qint64 t = static_cast<qint64>(d.at(2).toDouble());
                out.append(QVariantMap{
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
    }
    return {};
}

QHash<int, QByteArray> StocksModel::roleNames() const
{
    return {
        {DisplayRole, "display"}, {TickerRole, "ticker"}, {PriceRole, "price"},
        {ChangeRole, "change"}, {PctRole, "pct"}, {ClosesRole, "closes"},
        {PrevCloseRole, "prevClose"}, {HasDataRole, "hasData"}, {UpRole, "up"},
    };
}

} // namespace qtpanel
