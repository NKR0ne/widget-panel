#include "LiveFeedService.h"

#include "core/HttpClient.h"

#include <QDateTime>
#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrl>
#include <QUrlQuery>

namespace qtpanel {

namespace {

// YouTube manifests are session-bound and expire; re-resolve after 30 min.
constexpr qint64 kYouTubeCacheMs = 30 * 60 * 1000;

// Port of main.js extractBalancedJson(): finds the JSON object that follows
// `marker`, tracking brace depth through strings/escapes.
QString extractBalancedJson(const QString& text, const QString& marker)
{
    const qsizetype markerIndex = text.indexOf(marker);
    if (markerIndex < 0)
        return {};
    const qsizetype start = text.indexOf(QLatin1Char('{'), markerIndex);
    if (start < 0)
        return {};
    int depth = 0;
    bool inString = false;
    bool escape = false;
    for (qsizetype i = start; i < text.size(); ++i) {
        const QChar ch = text.at(i);
        if (inString) {
            if (escape)
                escape = false;
            else if (ch == QLatin1Char('\\'))
                escape = true;
            else if (ch == QLatin1Char('"'))
                inString = false;
            continue;
        }
        if (ch == QLatin1Char('"')) {
            inString = true;
        } else if (ch == QLatin1Char('{')) {
            ++depth;
        } else if (ch == QLatin1Char('}')) {
            if (--depth == 0)
                return text.mid(start, i - start + 1);
        }
    }
    return {};
}

QString extractHlsManifestUrl(const QString& html)
{
    const QString json = extractBalancedJson(html, QStringLiteral("ytInitialPlayerResponse"));
    if (!json.isEmpty()) {
        const QJsonDocument doc = QJsonDocument::fromJson(json.toUtf8());
        const QString url = doc.object()
            .value(QLatin1String("streamingData")).toObject()
            .value(QLatin1String("hlsManifestUrl")).toString();
        if (!url.isEmpty())
            return url;
    }
    // Fallback: bare regex, like the Electron extractor.
    static const QRegularExpression manifestRe(
        QStringLiteral("\"hlsManifestUrl\"\\s*:\\s*\"([^\"]+)\""));
    QString url = manifestRe.match(html).captured(1);
    url.replace(QLatin1String("\\u0026"), QLatin1String("&"));
    url.replace(QLatin1String("\\/"), QLatin1String("/"));
    return url;
}

QString youtubeConfigValue(const QString& html, const QString& key)
{
    const QRegularExpression pattern(
        QStringLiteral("\"") + QRegularExpression::escape(key)
        + QStringLiteral("\"\\s*:\\s*\"([^\"]+)\""));
    return pattern.match(html).captured(1);
}

} // namespace

LiveFeedService::LiveFeedService(HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_http(http)
{
    // Port of LIVE_FEEDS in renderer/widgets/live/LiveFeedGrid.jsx +
    // EURONEWS_HLS_URL from euronews.constants.js.
    m_feeds = {
        {QStringLiteral("live-bloomberg"), QStringLiteral("Bloomberg Live"), true,
         QStringLiteral("iEpJwprxDdk")},
        {QStringLiteral("live-radio-canada"), QStringLiteral("Radio-Canada.info"), true,
         QStringLiteral("oacvZh5Rmcg")},
        {QStringLiteral("live-france24"), QStringLiteral("France 24"), true,
         QStringLiteral("HvZt-nh9sGg")},
        {QStringLiteral("live-cbc-news"), QStringLiteral("CBC News"), true,
         QStringLiteral("5vfaDsMhCF4")},
        {QStringLiteral("live-lcn"), QStringLiteral("LCN"), false,
         QStringLiteral("https://tvalive.akamaized.net/hls/live/2014213/tvan01/tvan01.m3u8")},
        {QStringLiteral("euronews"), QStringLiteral("Euronews"), false,
         QStringLiteral("https://dash4.antik.sk/live/test_euronews/playlist.m3u8")},
    };
}

const LiveFeedService::Feed* LiveFeedService::feedById(const QString& feedId) const
{
    for (const Feed& feed : m_feeds) {
        if (feed.id == feedId)
            return &feed;
    }
    return nullptr;
}

QString LiveFeedService::title(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    return feed ? feed->title : feedId;
}

QString LiveFeedService::sourceLabel(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    if (!feed)
        return {};
    return feed->youtube ? QStringLiteral("YouTube") : QStringLiteral("HLS");
}

QString LiveFeedService::videoId(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    return (feed && feed->youtube) ? feed->source : QString();
}

bool LiveFeedService::isYouTube(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    return feed ? feed->youtube : false;
}

bool LiveFeedService::isKnownFeed(const QString& feedId) const
{
    return feedById(feedId) != nullptr;
}

QString LiveFeedService::embedUrl(const QString& feedId) const
{
    const QString id = videoId(feedId);
    if (id.isEmpty())
        return webUrl(feedId);
    return QStringLiteral("https://www.youtube.com/embed/%1"
                          "?autoplay=1&mute=1&controls=1&playsinline=1"
                          "&rel=0&modestbranding=1&iv_load_policy=3"
                          "&enablejsapi=1")
        .arg(QString::fromUtf8(QUrl::toPercentEncoding(id)));
}

QStringList LiveFeedService::feedIds() const
{
    QStringList ids;
    ids.reserve(m_feeds.size());
    for (const Feed& feed : m_feeds)
        ids.push_back(feed.id);
    return ids;
}

QString LiveFeedService::webUrl(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    if (!feed)
        return {};
    if (feed->youtube) {
        return QStringLiteral("https://www.youtube.com/watch?v=%1").arg(
            QString::fromUtf8(QUrl::toPercentEncoding(feed->source)));
    }
    return feed->source;
}

void LiveFeedService::requestAudio(const QString& feedId)
{
    if (!feedId.isEmpty() && !isKnownFeed(feedId)) {
        qWarning() << "[live] ignoring audio request for unknown feed" << feedId;
        return;
    }
    if (m_audioFeedId == feedId)
        return;
    m_audioFeedId = feedId;
    emit audioFeedIdChanged();
    qInfo() << "[live] audio →" << (feedId.isEmpty() ? QStringLiteral("(muted)") : feedId);
}

void LiveFeedService::notePlayback(const QString& feedId, const QString& state)
{
    qInfo() << "[live]" << feedId << "playback:" << state;
}

void LiveFeedService::resolve(const QString& feedId, bool force)
{
    const Feed* feed = feedById(feedId);
    if (!feed) {
        emit feedFailed(feedId, QStringLiteral("unknown feed"));
        return;
    }

    if (!feed->youtube) {
        qInfo() << "[live]" << feedId << "direct HLS:" << QUrl(feed->source).host();
        emit feedResolved(feedId, feed->source);
        return;
    }

    const auto cached = m_cache.constFind(feedId);
    if (!force && cached != m_cache.constEnd()
        && QDateTime::currentMSecsSinceEpoch() - cached->resolvedAtMs < kYouTubeCacheMs) {
        emit feedResolved(feedId, cached->hlsUrl);
        return;
    }
    if (m_pending.contains(feedId))
        return;
    m_pending.insert(feedId);
    resolveYouTube(*feed);
}

void LiveFeedService::resolveYouTube(const Feed& feed)
{
    // bpctr/has_verified skip the content-warning interstitials.
    const QUrl watchUrl(QStringLiteral(
        "https://www.youtube.com/watch?v=%1&bpctr=9999999999&has_verified=1").arg(feed.source));
    const QString feedId = feed.id;

    m_http->getText(watchUrl, this, [this, feedId, watchUrl](const QString& html, const QString& error) {
        if (!error.isEmpty()) {
            m_pending.remove(feedId);
            qWarning() << "[live]" << feedId << "watch page failed:" << error;
            emit feedFailed(feedId, error);
            return;
        }
        const QString hlsUrl = extractHlsManifestUrl(html);
        if (!hlsUrl.isEmpty()) {
            m_pending.remove(feedId);
            m_cache.insert(feedId, {hlsUrl, QDateTime::currentMSecsSinceEpoch()});
            qInfo() << "[live]" << feedId << "watch-page manifest host:"
                    << QUrl(hlsUrl).host();
            emit feedResolved(feedId, hlsUrl);
            return;
        }

        const QString apiKey = youtubeConfigValue(html, QStringLiteral("INNERTUBE_API_KEY"));
        const QString clientVersion = youtubeConfigValue(
            html, QStringLiteral("INNERTUBE_CLIENT_VERSION"));
        const Feed* feed = feedById(feedId);
        if (apiKey.isEmpty() || clientVersion.isEmpty() || !feed) {
            m_pending.remove(feedId);
            qWarning() << "[live]" << feedId << "YouTube player configuration unavailable";
            emit feedFailed(feedId, QStringLiteral("YouTube requires browser playback"));
            return;
        }

        const QJsonObject client{
            {QStringLiteral("clientName"), QStringLiteral("WEB")},
            {QStringLiteral("clientVersion"), clientVersion},
            {QStringLiteral("hl"), QStringLiteral("en")},
            {QStringLiteral("gl"), QStringLiteral("CA")},
        };
        const QJsonObject body{
            {QStringLiteral("context"), QJsonObject{
                 {QStringLiteral("client"), client}
             }},
            {QStringLiteral("videoId"), feed->source},
            {QStringLiteral("contentCheckOk"), true},
            {QStringLiteral("racyCheckOk"), true},
        };
        QUrl playerUrl(QStringLiteral("https://www.youtube.com/youtubei/v1/player"));
        QUrlQuery query;
        query.addQueryItem(QStringLiteral("key"), apiKey);
        query.addQueryItem(QStringLiteral("prettyPrint"), QStringLiteral("false"));
        playerUrl.setQuery(query);

        m_http->requestJsonAuth(
            QByteArrayLiteral("POST"), playerUrl, {},
            QJsonDocument(body).toJson(QJsonDocument::Compact), this,
            [this, feedId](const QJsonDocument& doc, int status, const QString& postError) {
                m_pending.remove(feedId);
                const QJsonObject root = doc.object();
                const QString manifest = root.value(QLatin1String("streamingData"))
                    .toObject().value(QLatin1String("hlsManifestUrl")).toString();
                if (!manifest.isEmpty()) {
                    m_cache.insert(feedId, {manifest, QDateTime::currentMSecsSinceEpoch()});
                    qInfo() << "[live]" << feedId << "player-api manifest host:"
                            << QUrl(manifest).host();
                    emit feedResolved(feedId, manifest);
                    return;
                }
                const QJsonObject playability = root.value(
                    QLatin1String("playabilityStatus")).toObject();
                const QString reason = playability.value(QLatin1String("reason")).toString();
                qWarning() << "[live]" << feedId << "player API unavailable"
                           << status << postError << reason;
                emit feedFailed(feedId, reason.isEmpty()
                    ? QStringLiteral("YouTube requires browser playback") : reason);
            },
            {
                {QByteArrayLiteral("Origin"), QByteArrayLiteral("https://www.youtube.com")},
                {QByteArrayLiteral("Referer"), watchUrl.toString().toUtf8()},
                {QByteArrayLiteral("X-YouTube-Client-Name"), QByteArrayLiteral("1")},
                {QByteArrayLiteral("X-YouTube-Client-Version"), clientVersion.toUtf8()},
            });
    }, QStringLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
}

} // namespace qtpanel
