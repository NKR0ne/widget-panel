#pragma once

#include <QObject>
#include <QVariantMap>

namespace qtpanel {

class HttpClient;

// Native reader mode: fetches an article page and extracts title, byline,
// hero image, and body paragraphs. First-pass extraction (article/p density
// heuristics); the full Electron cleanup corpus lands as parity tests later.
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
                          const QString& seedSource = {}, const QString& seedImage = {});
    // Wayback Machine fallback for paywalled/unreadable pages: availability
    // API → raw `id_` replay, run through the same extractor.
    Q_INVOKABLE void openArchive(const QString& url);
    Q_INVOKABLE void close();

signals:
    void busyChanged();
    void articleChanged();
    void opened();
    void failed(const QString& error);

private:
    static QVariantMap extract(const QString& html, const QString& url);

    HttpClient* m_http = nullptr;
    bool m_busy = false;
    QVariantMap m_article;
    quint64 m_requestSerial = 0;
};

} // namespace qtpanel
