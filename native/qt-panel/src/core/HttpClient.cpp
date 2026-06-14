#include "HttpClient.h"

#include "TextFix.h"

#include <QNetworkReply>
#include <QNetworkRequest>

namespace qtpanel {

namespace {
constexpr int kTimeoutMs = 15000;
const char kUserAgent[] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
} // namespace

HttpClient::HttpClient(QObject* parent)
    : QObject(parent)
{
    m_nam.setTransferTimeout(kTimeoutMs);
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

} // namespace qtpanel
