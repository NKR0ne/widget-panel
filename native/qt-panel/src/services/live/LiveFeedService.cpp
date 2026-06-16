#include "LiveFeedService.h"

#include "core/HttpClient.h"

#include <QDateTime>
#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrl>

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

    m_http->getText(watchUrl, this, [this, feedId](const QString& html, const QString& error) {
        m_pending.remove(feedId);
        if (!error.isEmpty()) {
            qWarning() << "[live]" << feedId << "watch page failed:" << error;
            emit feedFailed(feedId, error);
            return;
        }
        const QString hlsUrl = extractHlsManifestUrl(html);
        if (hlsUrl.isEmpty()) {
            qWarning() << "[live]" << feedId << "no HLS manifest in player response";
            emit feedFailed(feedId, QStringLiteral("No HLS manifest exposed by YouTube"));
            return;
        }
        m_cache.insert(feedId, {hlsUrl, QDateTime::currentMSecsSinceEpoch()});
        qInfo() << "[live]" << feedId << "manifest host:" << QUrl(hlsUrl).host();
        emit feedResolved(feedId, hlsUrl);
    }, QStringLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
}

} // namespace qtpanel
