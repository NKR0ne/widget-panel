#pragma once

#include <QHash>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QObject>
#include <QSet>
#include <QUrl>
#include <QUrlQuery>

#include <functional>

namespace qtpanel {

// Shared async HTTP client for the data services. All requests carry the same
// browser-like User-Agent the Electron main process used (Yahoo rejects the
// default Qt UA).
class HttpClient : public QObject {
    Q_OBJECT

public:
    explicit HttpClient(QObject* parent = nullptr);
    ~HttpClient() override;

    using JsonCallback = std::function<void(const QJsonDocument& doc, const QString& error)>;
    // status is the HTTP status code (0 on transport error).
    using JsonStatusCallback = std::function<void(const QJsonDocument& doc, int status, const QString& error)>;
    using TextCallback = std::function<void(const QString& text, const QString& error)>;

    // Callbacks fire on the GUI thread; they are dropped if `context` dies.
    void getJson(const QUrl& url, QObject* context, JsonCallback callback);

    // Charset-sniffed text fetch (header charset → XML declaration → UTF-8
    // with windows-1252 artifact fallback) — for RSS/HTML bodies.
    void getText(const QUrl& url, QObject* context, TextCallback callback,
                 const QString& accept = QString());

    // application/x-www-form-urlencoded POST (OAuth token endpoint).
    void postForm(const QUrl& url, const QUrlQuery& form, QObject* context,
                  JsonStatusCallback callback);

    // Bearer-authorized JSON request; verb is "GET", "PATCH", "POST", ...
    void requestJsonAuth(const QByteArray& verb, const QUrl& url, const QString& bearerToken,
                         const QByteArray& jsonBody, QObject* context, JsonStatusCallback callback,
                         const QList<QPair<QByteArray, QByteArray>>& extraHeaders = {});

    using BytesCallback = std::function<void(const QByteArray& bytes, int status, const QString& error)>;

    // Bearer-authorized JSON POST returning the raw response body (audio, …).
    QNetworkReply* postForBytes(const QUrl& url, const QString& bearerToken,
                                const QByteArray& jsonBody, QObject* context,
                                BytesCallback callback, int timeoutMs = 15000);

    // `event` is the SSE event name ("" when the frame has none), `data` the
    // joined data: payload of one frame.
    using SseEventCallback = std::function<void(const QString& event, const QByteArray& data)>;
    using SseDoneCallback = std::function<void(int status, const QString& error)>;

    // Streaming JSON POST for text/event-stream responses (Anthropic Messages,
    // …). The global transfer timeout does not apply — a reasoning model can
    // legitimately stay silent past 15 s — instead an inactivity watchdog
    // aborts after `idleTimeoutMs` without bytes. Returns the reply so the
    // caller can abort() to cancel; it is owned by the client and deletes
    // itself after onDone.
    QNetworkReply* postSse(const QUrl& url,
                           const QList<QPair<QByteArray, QByteArray>>& headers,
                           const QByteArray& jsonBody, QObject* context,
                           SseEventCallback onEvent, SseDoneCallback onDone,
                           int idleTimeoutMs = 90000);

    using ChunkCallback = std::function<void(const QByteArray& chunk)>;

    // Long-lived GET with HTTP digest/basic auth, delivering body bytes as they
    // arrive (camera alert streams are multipart/mixed and never finish).
    // Same timeout treatment as postSse; abort() the reply to stop.
    QNetworkReply* getStreamAuth(const QUrl& url, const QString& user, const QString& password,
                                 QObject* context, ChunkCallback onChunk, SseDoneCallback onDone,
                                 int idleTimeoutMs = 120000);

    // One-shot authenticated GET returning the whole body (camera snapshots).
    void getBytesAuth(const QUrl& url, const QString& user, const QString& password,
                      QObject* context, BytesCallback callback);

    // Authenticated request with a body (camera configuration writes).
    void requestBytesAuth(const QByteArray& verb, const QUrl& url, const QString& user,
                          const QString& password, const QByteArray& body,
                          const QByteArray& contentType, QObject* context,
                          BytesCallback callback);

private:
    // Per-reply credentials for the shared manager's authenticationRequired.
    void registerAuth(QNetworkReply* reply, const QString& user, const QString& password);

    QNetworkAccessManager m_nam;
    QHash<QNetworkReply*, QPair<QString, QString>> m_authCredentials;
    QSet<QNetworkReply*> m_authAnswered;
};

} // namespace qtpanel
