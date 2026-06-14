#pragma once

#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QObject>
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
    void postForBytes(const QUrl& url, const QString& bearerToken, const QByteArray& jsonBody,
                      QObject* context, BytesCallback callback);

private:
    QNetworkAccessManager m_nam;
};

} // namespace qtpanel
