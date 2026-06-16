#pragma once

#include <QObject>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>

namespace qtpanel {

class HttpClient;

// Native reader mode: fetches an article page and extracts title, byline,
// hero image, body paragraphs, fallback diagnostics, and article images.
class ReaderService : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QVariantMap article READ article NOTIFY articleChanged)

public:
    explicit ReaderService(HttpClient* http, QObject* parent = nullptr);

    bool busy() const { return m_busy; }
    QVariantMap article() const { return m_article; }

    // Seed values come from the news item so the overlay can render
    // immediately while the fetch runs.
    Q_INVOKABLE void open(const QString& url, const QString& seedTitle = {},
                          const QString& seedSource = {}, const QString& seedImage = {},
                          const QString& seedSummary = {});
    // Wayback Machine fallback for paywalled/unreadable pages: availability
    // API → raw `id_` replay, run through the same extractor.
    Q_INVOKABLE void openArchive(const QString& url);
    Q_INVOKABLE void close();

    // Pure parser entry used by regression tests and future diagnostics.
    static QVariantMap extractArticleHtml(const QString& html, const QString& url);

signals:
    void busyChanged();
    void articleChanged();
    void opened();
    void failed(const QString& error);

private:
    void resolveArchiveAvailability(quint64 serial, const QString& originalUrl,
                                    const QStringList& variants, int index,
                                    QVariantList attempts);
    void resolveArchiveCdx(quint64 serial, const QString& originalUrl,
                           const QStringList& variants, int variantIndex, int endpointIndex,
                           QVariantList attempts);
    void openArchiveReplay(quint64 serial, const QString& originalUrl,
                           const QString& replayUrl, QVariantList attempts);
    void tryJinaReader(quint64 serial, const QString& originalUrl,
                       const QString& seedTitle, const QString& seedSource,
                       const QString& seedImage, QVariantMap fallbackArticle,
                       QVariantList attempts, int index);
    void tryPublisherFeedFallback(quint64 serial, const QString& originalUrl,
                                  const QString& seedTitle, const QString& seedSource,
                                  const QString& seedImage, QVariantMap fallbackArticle,
                                  QVariantList attempts, int feedIndex);

    HttpClient* m_http = nullptr;
    bool m_busy = false;
    QVariantMap m_article;
    quint64 m_requestSerial = 0;
};

} // namespace qtpanel
