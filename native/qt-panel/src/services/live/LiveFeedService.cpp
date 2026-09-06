#include "LiveFeedService.h"

#include "core/HttpClient.h"

#include <QDateTime>
#include <QDebug>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrl>
#include <QUrlQuery>
#include <QUuid>

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

bool isRestrictedPlayback(const QString& reason)
{
    static const QRegularExpression restrictedRe(
        QStringLiteral("restricted mode|blocked by your administrator|"
                       "network administrator|administrator has restricted|restricted by"),
        QRegularExpression::CaseInsensitiveOption);
    return restrictedRe.match(reason).hasMatch();
}

} // namespace

LiveFeedService::LiveFeedService(HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_http(http)
{
    // Provider-native transport avoids browser policy and network Restricted
    // Mode. YouTube ids remain available as fallbacks for dynamic providers.
    m_feeds = {
        {QStringLiteral("live-bloomberg"), QStringLiteral("Bloomberg Live"),
         Transport::DirectHls,
         QStringLiteral("https://www.bloomberg.com/media-manifest/streams/us.m3u8"),
         QStringLiteral("https://www.bloomberg.com/live/us-btv"),
         QStringLiteral("QB5BNdBFujE")},
        {QStringLiteral("live-radio-canada"), QStringLiteral("Radio-Canada.info"),
         Transport::PlutoSession,
         QStringLiteral("62cc1e1e0d0611000837dc1d"),
         QStringLiteral("https://pluto.tv/ca/live-tv/62cc1e1e0d0611000837dc1d"), {}},
        {QStringLiteral("live-france24"), QStringLiteral("France 24"),
         Transport::DirectHls,
         QStringLiteral("https://live.france24.com/hls/live/2037218/"
                        "F24_EN_HI_HLS/master_2300.m3u8"),
         QStringLiteral("https://www.france24.com/en/live"),
         QStringLiteral("HvZt-nh9sGg")},
        {QStringLiteral("live-cbc-news"), QStringLiteral("CBC News"),
         Transport::MediaValidation,
         QStringLiteral("https://services.radio-canada.ca/media/validation/v2?"
                        "appCode=medianetlive&idMedia=15717&tech=hls&output=json"),
         QStringLiteral("https://www.cbc.ca/player/play/video/9.4766516"),
         QStringLiteral("5vfaDsMhCF4")},
        {QStringLiteral("live-lcn"), QStringLiteral("LCN"), Transport::DirectHls,
         QStringLiteral("https://tvalive.akamaized.net/hls/live/2014213/tvan01/tvan01.m3u8"),
         QStringLiteral("https://www.qub.ca/tvaplus/tva/en-direct"), {}},
        {QStringLiteral("euronews"), QStringLiteral("Euronews"), Transport::DirectHls,
         QStringLiteral("https://dash4.antik.sk/live/test_euronews/playlist.m3u8"),
         QStringLiteral("https://www.euronews.com/live"), {}},
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
    return feed->transport == Transport::YouTube
        ? QStringLiteral("YouTube") : QStringLiteral("HLS");
}

QString LiveFeedService::videoId(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    if (!feed)
        return {};
    return feed->transport == Transport::YouTube
        ? feed->source : feed->youtubeFallbackId;
}

bool LiveFeedService::isYouTube(const QString& feedId) const
{
    const Feed* feed = feedById(feedId);
    return feed && feed->transport == Transport::YouTube;
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
    if (feed->transport == Transport::YouTube) {
        return QStringLiteral("https://www.youtube.com/watch?v=%1").arg(
            QString::fromUtf8(QUrl::toPercentEncoding(feed->source)));
    }
    return feed->webUrl.isEmpty() ? feed->source : feed->webUrl;
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

void LiveFeedService::prepareShutdown()
{
    if (m_shuttingDown)
        return;
    m_shuttingDown = true;
    m_pending.clear();
    for (const Feed& feed : m_feeds)
        m_resolveGenerations.insert(feed.id, m_resolveGenerations.value(feed.id) + 1);
    requestAudio(QString());
    emit shutdownRequested();
    qInfo() << "[live] multimedia shutdown requested";
}

void LiveFeedService::cancelResolve(const QString& feedId)
{
    if (!isKnownFeed(feedId))
        return;
    const bool wasPending = m_pending.remove(feedId);
    m_resolveGenerations.insert(feedId, m_resolveGenerations.value(feedId) + 1);
    if (wasPending)
        qInfo() << "[live]" << feedId << "resolution cancelled";
}

bool LiveFeedService::openDetail(const QString& feedId, const QString& hlsUrl)
{
    const Feed* feed = feedById(feedId);
    if (!feed || feed->transport == Transport::YouTube)
        return false;
    QString target = hlsUrl.trimmed();
    if (target.isEmpty() && feed->transport == Transport::DirectHls)
        target = feed->source;
    if (target.isEmpty())
        return false;
    const QUrl url(target);
    if (!url.isValid()
        || (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https")))
        return false;

    requestAudio(QString());
    m_detailOpen = true;
    m_detailFeedId = feedId;
    m_detailUrl = url.toString();
    emit detailChanged();
    qInfo() << "[live] native detail opened" << feedId << QUrl(m_detailUrl).host();
    return true;
}

void LiveFeedService::closeDetail()
{
    if (!m_detailOpen)
        return;
    if (m_audioFeedId == m_detailFeedId)
        requestAudio(QString());
    const QString feedId = m_detailFeedId;
    m_detailOpen = false;
    m_detailFeedId.clear();
    m_detailUrl.clear();
    emit detailChanged();
    qInfo() << "[live] native detail closed" << feedId;
}

void LiveFeedService::resolve(const QString& feedId, bool force)
{
    if (m_shuttingDown)
        return;
    const Feed* feed = feedById(feedId);
    if (!feed) {
        emit feedFailed(feedId, QStringLiteral("unknown feed"));
        return;
    }

    if (feed->transport == Transport::DirectHls) {
        qInfo() << "[live]" << feedId << "direct HLS:" << QUrl(feed->source).host();
        emit feedResolved(feedId, feed->source);
        return;
    }

    if (feed->transport == Transport::MediaValidation || feed->transport == Transport::PlutoSession) {
        if (!force && m_pending.contains(feedId))
            return;
        const quint64 generation = m_resolveGenerations.value(feedId) + 1;
        m_resolveGenerations.insert(feedId, generation);
        m_pending.insert(feedId);
        if (feed->transport == Transport::PlutoSession)
            resolvePluto(*feed, generation);
        else
            resolveMediaValidation(*feed, generation);
        return;
    }

    const auto restricted = m_restrictedFeeds.constFind(feedId);
    if (restricted != m_restrictedFeeds.constEnd()) {
        emit feedRestricted(feedId, restricted.value());
        return;
    }

    const auto cached = m_cache.constFind(feedId);
    if (!force && cached != m_cache.constEnd()
        && QDateTime::currentMSecsSinceEpoch() - cached->resolvedAtMs < kYouTubeCacheMs) {
        emit feedResolved(feedId, cached->hlsUrl);
        return;
    }
    if (!force && m_pending.contains(feedId))
        return;
    const quint64 generation = m_resolveGenerations.value(feedId) + 1;
    m_resolveGenerations.insert(feedId, generation);
    m_pending.insert(feedId);
    resolveYouTube(*feed, generation);
}

QString LiveFeedService::plutoManifestUrl(const QJsonDocument& session, const QString& channelId)
{
    const auto root = session.object();
    const QString token = root.value(QStringLiteral("sessionToken")).toString();
    const QString params = root.value(QStringLiteral("stitcherParams")).toString();
    const QUrl server(root.value(QStringLiteral("servers")).toObject()
                          .value(QStringLiteral("stitcher")).toString());
    if (token.isEmpty() || params.isEmpty() || !server.isValid()
        || server.scheme() != QLatin1String("https")
        || !server.host().endsWith(QLatin1String(".pluto.tv")))
        return {};
    for (const auto& value : root.value(QStringLiteral("EPG")).toArray()) {
        const auto channel = value.toObject();
        if (channel.value(QStringLiteral("id")).toString() != channelId)
            continue;
        const auto stitched = channel.value(QStringLiteral("stitched")).toObject();
        auto sources = stitched.value(QStringLiteral("paths")).toArray();
        if (sources.isEmpty())
            sources.append(QJsonObject{{QStringLiteral("type"), QStringLiteral("hls")},
                {QStringLiteral("path"), stitched.value(QStringLiteral("path"))}});
        for (const auto& source : sources) {
            const auto entry = source.toObject();
            if (entry.value(QStringLiteral("type")).toString() != QLatin1String("hls"))
                continue;
            const QString path = entry.value(QStringLiteral("path")).toString();
            if (!path.startsWith(QStringLiteral("/stitch/hls/channel/") + channelId + QLatin1Char('/'))
                || path.contains(QStringLiteral("..")) || path.contains(QLatin1Char('?'))
                || path.contains(QLatin1Char('#')) || !path.endsWith(QLatin1String(".m3u8")))
                continue;
            QUrl url(server);
            url.setPath(QStringLiteral("/v2") + path);
            // Unsigned catalog URLs can play a service notice with HTTP 200.
            // Use the issued session and forward its JWT to child playlists.
            QUrlQuery query(params);
            query.removeAllQueryItems(QStringLiteral("jwt"));
            query.addQueryItem(QStringLiteral("jwt"), token);
            query.removeAllQueryItems(QStringLiteral("includeExtendedEvents"));
            query.addQueryItem(QStringLiteral("includeExtendedEvents"), QStringLiteral("true"));
            query.removeAllQueryItems(QStringLiteral("masterJWTPassthrough"));
            query.addQueryItem(QStringLiteral("masterJWTPassthrough"), QStringLiteral("true"));
            url.setQuery(query);
            return url.toString();
        }
    }
    return {};
}

void LiveFeedService::resolvePluto(const Feed& feed, quint64 generation)
{
    const QString feedId = feed.id;
    const QString channelId = feed.source;
    QUrl bootstrap(QStringLiteral("https://boot.pluto.tv/v4/start"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("appName"), QStringLiteral("web"));
    query.addQueryItem(QStringLiteral("appVersion"), QStringLiteral("1.0.0"));
    query.addQueryItem(QStringLiteral("deviceVersion"), QStringLiteral("131.0"));
    query.addQueryItem(QStringLiteral("deviceModel"), QStringLiteral("web"));
    query.addQueryItem(QStringLiteral("deviceMake"), QStringLiteral("chrome"));
    query.addQueryItem(QStringLiteral("deviceType"), QStringLiteral("web"));
    query.addQueryItem(QStringLiteral("clientID"), QUuid::createUuid().toString(QUuid::WithoutBraces));
    query.addQueryItem(QStringLiteral("clientModelNumber"), QStringLiteral("1.0.0"));
    query.addQueryItem(QStringLiteral("channelSlug"), channelId);
    bootstrap.setQuery(query);
    m_http->getJson(bootstrap, this,
        [this, feedId, channelId, generation](const QJsonDocument& doc, const QString& error) {
            if (m_resolveGenerations.value(feedId) != generation)
                return;
            m_pending.remove(feedId);
            const QString manifest = error.isEmpty() ? plutoManifestUrl(doc, channelId) : QString();
            if (manifest.isEmpty()) {
                emit feedFailed(feedId, error.isEmpty()
                    ? QStringLiteral("Session de lecture Radio-Canada Info indisponible") : error);
                return;
            }
            qInfo() << "[live]" << feedId << "Pluto session manifest host:" << QUrl(manifest).host();
            emit feedResolved(feedId, manifest);
        });
}

void LiveFeedService::resolveMediaValidation(const Feed& feed, quint64 generation)
{
    const QString feedId = feed.id;
    m_http->getJson(QUrl(feed.source), this,
                    [this, feedId, generation](const QJsonDocument& doc,
                                               const QString& error) {
        if (m_resolveGenerations.value(feedId) != generation) {
            qInfo() << "[live]" << feedId << "ignored stale provider response";
            return;
        }

        const Feed* feed = feedById(feedId);
        const QString manifest = doc.object().value(QLatin1String("url")).toString();
        const QUrl manifestUrl(manifest);
        if (error.isEmpty() && manifestUrl.isValid()
            && (manifestUrl.scheme() == QLatin1String("http")
                || manifestUrl.scheme() == QLatin1String("https"))) {
            m_pending.remove(feedId);
            qInfo() << "[live]" << feedId << "provider manifest host:"
                    << manifestUrl.host();
            emit feedResolved(feedId, manifest);
            return;
        }

        if (feed && !feed->youtubeFallbackId.isEmpty()) {
            qWarning() << "[live]" << feedId
                       << "provider resolution failed; trying YouTube fallback:"
                       << (error.isEmpty() ? QStringLiteral("manifest unavailable") : error);
            resolveYouTube(*feed, generation);
            return;
        }

        m_pending.remove(feedId);
        emit feedFailed(feedId, error.isEmpty()
            ? QStringLiteral("Provider stream unavailable") : error);
    });
}

void LiveFeedService::resolveYouTube(const Feed& feed, quint64 generation)
{
    const QString videoId = feed.transport == Transport::YouTube
        ? feed.source : feed.youtubeFallbackId;
    if (videoId.isEmpty()) {
        m_pending.remove(feed.id);
        emit feedFailed(feed.id, QStringLiteral("YouTube fallback unavailable"));
        return;
    }
    // bpctr/has_verified skip the content-warning interstitials.
    const QUrl watchUrl(QStringLiteral(
        "https://www.youtube.com/watch?v=%1&bpctr=9999999999&has_verified=1").arg(videoId));
    const QString feedId = feed.id;

    m_http->getText(watchUrl, this,
                    [this, feedId, watchUrl, generation](const QString& html,
                                                         const QString& error) {
        if (m_resolveGenerations.value(feedId) != generation) {
            qInfo() << "[live]" << feedId << "ignored stale watch-page response";
            return;
        }
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
            {QStringLiteral("videoId"), feed->transport == Transport::YouTube
                 ? feed->source : feed->youtubeFallbackId},
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
            [this, feedId, generation](const QJsonDocument& doc, int status,
                                       const QString& postError) {
                if (m_resolveGenerations.value(feedId) != generation) {
                    qInfo() << "[live]" << feedId << "ignored stale player response";
                    return;
                }
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
                if (isRestrictedPlayback(reason)) {
                    const QString message = reason.isEmpty()
                        ? QStringLiteral("Unavailable on this network") : reason;
                    m_restrictedFeeds.insert(feedId, message);
                    emit feedRestricted(feedId, message);
                    return;
                }
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
