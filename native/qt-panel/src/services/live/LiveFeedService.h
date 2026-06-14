#pragma once

#include <QHash>
#include <QObject>
#include <QSet>

namespace qtpanel {

class HttpClient;

// Resolves live TV feeds to playable HLS manifests: direct .m3u8 feeds pass
// through, YouTube live channels go through the watch-page extraction the
// Electron main process used (ytInitialPlayerResponse → hlsManifestUrl).
// Also owns the audio policy: at most one unmuted feed at a time.
class LiveFeedService : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString audioFeedId READ audioFeedId NOTIFY audioFeedIdChanged)

public:
    explicit LiveFeedService(HttpClient* http, QObject* parent = nullptr);

    QString audioFeedId() const { return m_audioFeedId; }

    Q_INVOKABLE void resolve(const QString& feedId, bool force = false);
    Q_INVOKABLE QString title(const QString& feedId) const;
    // Pass an empty id to mute everything.
    Q_INVOKABLE void requestAudio(const QString& feedId);
    // Player state breadcrumbs into the app log (diagnostics only).
    Q_INVOKABLE void notePlayback(const QString& feedId, const QString& state);

signals:
    void audioFeedIdChanged();
    void feedResolved(const QString& feedId, const QString& hlsUrl);
    void feedFailed(const QString& feedId, const QString& error);

private:
    struct Feed {
        QString id;
        QString title;
        bool youtube = false;
        QString source; // YouTube video id, or the direct HLS URL
    };
    struct Resolved {
        QString hlsUrl;
        qint64 resolvedAtMs = 0;
    };

    const Feed* feedById(const QString& feedId) const;
    void resolveYouTube(const Feed& feed);

    HttpClient* m_http = nullptr;
    QList<Feed> m_feeds;
    QHash<QString, Resolved> m_cache;
    QSet<QString> m_pending;
    QString m_audioFeedId;
};

} // namespace qtpanel
