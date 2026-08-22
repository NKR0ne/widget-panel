#include "HttpClient.h"

#include "TextFix.h"

#include <QAuthenticator>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

#include <memory>

namespace qtpanel {

namespace {
constexpr int kTimeoutMs = 15000;
const char kUserAgent[] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
} // namespace

HttpClient::HttpClient(QObject* parent)
    : QObject(parent)
{
    m_nam.setTransferTimeout(kTimeoutMs);

    // Digest/basic challenges (cameras) are answered per-reply. Qt re-emits
    // this when the answer is refused, so each reply is answered exactly once
    // — otherwise wrong credentials spin in an auth loop.
    connect(&m_nam, &QNetworkAccessManager::authenticationRequired, this,
            [this](QNetworkReply* reply, QAuthenticator* authenticator) {
        const auto credentials = m_authCredentials.constFind(reply);
        if (credentials == m_authCredentials.cend() || m_authAnswered.contains(reply))
            return;
        m_authAnswered.insert(reply);
        authenticator->setUser(credentials->first);
        authenticator->setPassword(credentials->second);
    });
}

void HttpClient::registerAuth(QNetworkReply* reply, const QString& user, const QString& password)
{
    m_authCredentials.insert(reply, {user, password});
    connect(reply, &QNetworkReply::destroyed, this, [this, reply] {
        m_authCredentials.remove(reply);
        m_authAnswered.remove(reply);
    });
}

void HttpClient::getJson(const QUrl& url, QObject* context, JsonCallback callback)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    QNetworkReply* reply = m_nam.get(request);
    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            callback({}, reply->errorString());
            return;
        }
        QJsonParseError parseError{};
        const QJsonDocument doc = QJsonDocument::fromJson(reply->readAll(), &parseError);
        if (parseError.error != QJsonParseError::NoError) {
            callback({}, parseError.errorString());
            return;
        }
        callback(doc, QString());
    });
}

void HttpClient::getText(const QUrl& url, QObject* context, TextCallback callback,
                         const QString& accept)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    if (!accept.isEmpty())
        request.setRawHeader("Accept", accept.toLatin1());
    request.setRawHeader("Cache-Control", "no-cache");
    QNetworkReply* reply = m_nam.get(request);
    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            callback({}, reply->errorString());
            return;
        }
        const QString contentType =
            reply->header(QNetworkRequest::ContentTypeHeader).toString();
        callback(TextFix::decodeHttpText(reply->readAll(), contentType), QString());
    });
}

void HttpClient::postForm(const QUrl& url, const QUrlQuery& form, QObject* context,
                          JsonStatusCallback callback)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    request.setHeader(QNetworkRequest::ContentTypeHeader,
                      QStringLiteral("application/x-www-form-urlencoded"));
    QNetworkReply* reply =
        m_nam.post(request, form.toString(QUrl::FullyEncoded).toUtf8());
    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        if (reply->error() != QNetworkReply::NoError && status == 0) {
            callback({}, 0, reply->errorString());
            return;
        }
        callback(doc, status, QString());
    });
}

void HttpClient::requestJsonAuth(const QByteArray& verb, const QUrl& url,
                                 const QString& bearerToken, const QByteArray& jsonBody,
                                 QObject* context, JsonStatusCallback callback,
                                 const QList<QPair<QByteArray, QByteArray>>& extraHeaders)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    if (!bearerToken.isEmpty())
        request.setRawHeader("Authorization", "Bearer " + bearerToken.toUtf8());
    if (!jsonBody.isEmpty())
        request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    for (const auto& header : extraHeaders)
        request.setRawHeader(header.first, header.second);

    QNetworkReply* reply = m_nam.sendCustomRequest(request, verb, jsonBody);
    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        if (reply->error() != QNetworkReply::NoError && status == 0) {
            callback({}, 0, reply->errorString());
            return;
        }
        callback(doc, status, QString());
    });
}

void HttpClient::postForBytes(const QUrl& url, const QString& bearerToken,
                              const QByteArray& jsonBody, QObject* context,
                              BytesCallback callback)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("Authorization", "Bearer " + bearerToken.toUtf8());
    QNetworkReply* reply = m_nam.post(request, jsonBody);
    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError && status == 0) {
            callback({}, 0, reply->errorString());
            return;
        }
        callback(reply->readAll(), status, QString());
    });
}

QNetworkReply* HttpClient::postSse(const QUrl& url,
                                   const QList<QPair<QByteArray, QByteArray>>& headers,
                                   const QByteArray& jsonBody, QObject* context,
                                   SseEventCallback onEvent, SseDoneCallback onDone,
                                   int idleTimeoutMs)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setRawHeader("Accept", "text/event-stream");
    for (const auto& header : headers)
        request.setRawHeader(header.first, header.second);
    // The manager-wide 15 s transfer timeout would abort a reasoning model
    // that streams nothing while it thinks; the idle watchdog below replaces it.
    request.setTransferTimeout(0);

    QNetworkReply* reply = m_nam.post(request, jsonBody);

    auto* watchdog = new QTimer(reply);
    watchdog->setSingleShot(true);
    watchdog->setInterval(idleTimeoutMs);
    connect(watchdog, &QTimer::timeout, reply, &QNetworkReply::abort);
    watchdog->start();

    auto buffer = std::make_shared<QByteArray>();
    connect(reply, &QNetworkReply::readyRead, context,
            [reply, watchdog, buffer, onEvent] {
        watchdog->start(); // any bytes reset the inactivity clock
        buffer->append(reply->readAll());
        // Frames are separated by a blank line; fields are "event:"/"data:".
        for (;;) {
            int end = buffer->indexOf("\n\n");
            int sepLen = 2;
            const int endCrlf = buffer->indexOf("\r\n\r\n");
            if (endCrlf >= 0 && (end < 0 || endCrlf < end)) {
                end = endCrlf;
                sepLen = 4;
            }
            if (end < 0)
                break;
            const QByteArray frame = buffer->left(end);
            buffer->remove(0, end + sepLen);

            QString eventName;
            QByteArrayList dataLines;
            for (QByteArray line : frame.split('\n')) {
                if (line.endsWith('\r'))
                    line.chop(1);
                if (line.startsWith("event:"))
                    eventName = QString::fromUtf8(line.mid(6).trimmed());
                else if (line.startsWith("data:"))
                    dataLines.append(line.mid(5).trimmed());
            }
            if (!dataLines.isEmpty() || !eventName.isEmpty())
                onEvent(eventName, dataLines.join('\n'));
        }
    });

    connect(reply, &QNetworkReply::finished, context,
            [reply, buffer, onDone = std::move(onDone)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        // On a non-2xx the body is a plain JSON error, not SSE frames. The
        // readyRead handler has already pulled it into `buffer` (it contains
        // no frame separator, so it was never emitted) — surface it so
        // callers can extract the provider's message.
        QString error;
        if (reply->error() != QNetworkReply::NoError || status < 200 || status >= 300) {
            error = reply->error() == QNetworkReply::OperationCanceledError
                ? QStringLiteral("aborted")
                : reply->error() != QNetworkReply::NoError
                    ? reply->errorString()
                    : QStringLiteral("HTTP %1").arg(status);
            QByteArray tail = *buffer + reply->readAll();
            if (!tail.isEmpty())
                error += QStringLiteral(" — ") + QString::fromUtf8(tail.left(600));
        }
        onDone(status, error);
    });

    return reply;
}

QNetworkReply* HttpClient::getStreamAuth(const QUrl& url, const QString& user,
                                         const QString& password, QObject* context,
                                         ChunkCallback onChunk, SseDoneCallback onDone,
                                         int idleTimeoutMs)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    request.setRawHeader("Connection", "keep-alive");
    request.setTransferTimeout(0); // the stream is meant to stay open

    QNetworkReply* reply = m_nam.get(request);
    // Credentials never go on the wire unchallenged; they are supplied only
    // when the camera answers 401 with its digest challenge.
    registerAuth(reply, user, password);

    auto* watchdog = new QTimer(reply);
    watchdog->setSingleShot(true);
    watchdog->setInterval(idleTimeoutMs);
    connect(watchdog, &QTimer::timeout, reply, &QNetworkReply::abort);
    watchdog->start();

    connect(reply, &QNetworkReply::readyRead, context, [reply, watchdog, onChunk] {
        watchdog->start();
        const QByteArray chunk = reply->readAll();
        if (!chunk.isEmpty())
            onChunk(chunk);
    });
    connect(reply, &QNetworkReply::finished, context, [reply, onDone = std::move(onDone)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        QString error;
        if (reply->error() != QNetworkReply::NoError)
            error = reply->error() == QNetworkReply::OperationCanceledError
                ? QStringLiteral("aborted") : reply->errorString();
        onDone(status, error);
    });
    return reply;
}

void HttpClient::getBytesAuth(const QUrl& url, const QString& user, const QString& password,
                              QObject* context, BytesCallback callback)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    QNetworkReply* reply = m_nam.get(request);
    registerAuth(reply, user, password);

    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError && status == 0) {
            callback({}, 0, reply->errorString());
            return;
        }
        callback(reply->readAll(), status, QString());
    });
}

void HttpClient::requestBytesAuth(const QByteArray& verb, const QUrl& url, const QString& user,
                                  const QString& password, const QByteArray& body,
                                  const QByteArray& contentType, QObject* context,
                                  BytesCallback callback)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QLatin1String(kUserAgent));
    if (!body.isEmpty())
        request.setHeader(QNetworkRequest::ContentTypeHeader, QString::fromLatin1(contentType));
    QNetworkReply* reply = m_nam.sendCustomRequest(request, verb, body);
    registerAuth(reply, user, password);

    connect(reply, &QNetworkReply::finished, context,
            [reply, callback = std::move(callback)] {
        reply->deleteLater();
        const int status =
            reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() != QNetworkReply::NoError && status == 0) {
            callback({}, 0, reply->errorString());
            return;
        }
        callback(reply->readAll(), status, QString());
    });
}

} // namespace qtpanel
