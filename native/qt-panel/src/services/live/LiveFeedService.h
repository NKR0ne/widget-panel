#pragma once

#include <QHash>
#include <QObject>
#include <QSet>
#include <QStringList>

namespace qtpanel {

class HttpClient;

// Resolves live TV feeds to playable HLS manifests. Provider-native HLS is
// preferred, short-lived Media Validation URLs are resolved on demand, and
// YouTube remains an explicit fallback for providers without a native stream.
// Also owns the audio policy: at most one unmuted feed at a time.
class LiveFeedService : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString audioFeedId READ audioFeedId NOTIFY audioFeedIdChanged)
    Q_PROPERTY(bool detailOpen READ detailOpen NOTIFY detailChanged)
    Q_PROPERTY(QString detailFeedId READ detailFeedId NOTIFY detailChanged)
    Q_PROPERTY(QString detailUrl READ detailUrl NOTIFY detailChanged)

public:
    explicit LiveFeedService(HttpClient* http, QObject* parent = nullptr);

    QString audioFeedId() const { return m_audioFeedId; }
    bool detailOpen() const { return m_detailOpen; }
    QString detailFeedId() const { return m_detailFeedId; }
    QString detailUrl() const { return m_detailUrl; }

    Q_INVOKABLE void resolve(const QString& feedId, bool force = false);
    Q_INVOKABLE void cancelResolve(const QString& feedId);
    Q_INVOKABLE bool openDetail(const QString& feedId, const QString& hlsUrl = QString());
    Q_INVOKABLE void closeDetail();
    Q_INVOKABLE QStringList feedIds() const;
    Q_INVOKABLE QString title(const QString& feedId) const;
    Q_INVOKABLE QString sourceLabel(const QString& feedId) const;
    Q_INVOKABLE QString webUrl(const QString& feedId) const;
    Q_INVOKABLE QString videoId(const QString& feedId) const;
    Q_INVOKABLE QString embedUrl(const QString& feedId) const;
    Q_INVOKABLE bool isYouTube(const QString& feedId) const;
    Q_INVOKABLE bool isKnownFeed(const QString& feedId) const;
    Q_INVOKABLE void prepareShutdown();
    // Pass an empty id to mute everything.
    Q_INVOKABLE void requestAudio(const QString& feedId);
    // Player state breadcrumbs into the app log (diagnostics only).
    Q_INVOKABLE void notePlayback(const QString& feedId, const QString& state);

signals:
    void audioFeedIdChanged();
    void detailChanged();
    void feedResolved(const QString& feedId, const QString& hlsUrl);
    void feedFailed(const QString& feedId, const QString& error);
    void feedRestricted(const QString& feedId, const QString& reason);
    void shutdownRequested();

private:
    enum class Transport {
        DirectHls,
        MediaValidation,
        YouTube,
    };

    struct Feed {
        QString id;
        QString title;
        Transport transport = Transport::DirectHls;
        QString source; // Direct HLS URL, Media Validation URL, or YouTube id
        QString webUrl;
        QString youtubeFallbackId;
    };
    struct Resolved {
        QString hlsUrl;
        qint64 resolvedAtMs = 0;
    };

    const Feed* feedById(const QString& feedId) const;
    void resolveMediaValidation(const Feed& feed, quint64 generation);
    void resolveYouTube(const Feed& feed, quint64 generation);

    HttpClient* m_http = nullptr;
    QList<Feed> m_feeds;
    QHash<QString, Resolved> m_cache;
    QSet<QString> m_pending;
    QHash<QString, quint64> m_resolveGenerations;
    QHash<QString, QString> m_restrictedFeeds;
    QString m_audioFeedId;
    bool m_detailOpen = false;
    bool m_shuttingDown = false;
    QString m_detailFeedId;
    QString m_detailUrl;
};

} // namespace qtpanel
