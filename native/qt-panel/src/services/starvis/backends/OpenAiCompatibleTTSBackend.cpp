#include "OpenAiCompatibleTTSBackend.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QTimer>

namespace qtpanel {

OpenAiCompatibleTTSBackend::OpenAiCompatibleTTSBackend(QObject* parent)
    : TTSBackend(parent)
{
}

BackendDescriptor OpenAiCompatibleTTSBackend::descriptor() const
{
    return {
        QStringLiteral("openai-compatible-tts"),
        QStringLiteral("OpenAI-compatible TTS"),
        m_endpoint,
        m_model,
        m_available,
        false,
        false,
        {{QStringLiteral("responseFormat"), m_responseFormat}},
    };
}

void OpenAiCompatibleTTSBackend::configure(const QString& endpoint,
                                            const QString& model,
                                            const QString& bearerToken,
                                            const QString& responseFormat)
{
    QString normalized = endpoint.trimmed();
    while (normalized.endsWith(QLatin1Char('/')))
        normalized.chop(1);
    if (!normalized.isEmpty())
        m_endpoint = normalized;
    m_model = model.trimmed();
    m_bearerToken = bearerToken;
    const QString format = responseFormat.trimmed().toLower();
    m_responseFormat = format.isEmpty() ? QStringLiteral("wav") : format;
}

void OpenAiCompatibleTTSBackend::setAvailable(bool available)
{
    if (m_available == available)
        return;
    m_available = available;
    emit availabilityChanged();
}

QString OpenAiCompatibleTTSBackend::speechUrl() const
{
    return m_endpoint + QStringLiteral("/audio/speech");
}

BackendOperation* OpenAiCompatibleTTSBackend::synthesize(const TtsRequest& request,
                                                          QObject* owner)
{
    auto* operation = new BackendOperation(QStringLiteral("tts"),
                                           QStringLiteral("openai-compatible"),
                                           owner ? owner : this);
    const QString text = request.text.trimmed();
    if (text.isEmpty()) {
        QTimer::singleShot(0, operation, [operation] {
            operation->fail(QStringLiteral("No text was provided for speech synthesis."));
        });
        return operation;
    }

    const QString model = request.options.value(QStringLiteral("model"), m_model).toString();
    const QString format = request.options.value(QStringLiteral("responseFormat"),
                                                  m_responseFormat).toString().toLower();
    QJsonObject body{
        {QStringLiteral("model"), model},
        {QStringLiteral("voice"), request.voice},
        {QStringLiteral("input"), text},
        {QStringLiteral("response_format"), format},
    };
    const QString instructions = request.options.value(QStringLiteral("instructions")).toString();
    if (!instructions.isEmpty())
        body.insert(QStringLiteral("instructions"), instructions);
    if (request.options.contains(QStringLiteral("speed")))
        body.insert(QStringLiteral("speed"), request.options.value(QStringLiteral("speed")).toDouble());
    if (request.options.contains(QStringLiteral("language")))
        body.insert(QStringLiteral("language"), request.options.value(QStringLiteral("language")).toString());
    if (request.options.contains(QStringLiteral("exaggeration")))
        body.insert(QStringLiteral("exaggeration"),
                    request.options.value(QStringLiteral("exaggeration")).toDouble());
    if (request.options.contains(QStringLiteral("cfgWeight")))
        body.insert(QStringLiteral("cfg_weight"),
                    request.options.value(QStringLiteral("cfgWeight")).toDouble());

    QNetworkRequest networkRequest{QUrl(speechUrl())};
    networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
                             QStringLiteral("application/json"));
    networkRequest.setTransferTimeout(request.options.value(QStringLiteral("timeoutMs"),
                                                             60000).toInt());
    if (!m_bearerToken.isEmpty())
        networkRequest.setRawHeader("Authorization", "Bearer " + m_bearerToken.toUtf8());
    QNetworkReply* reply = m_network.post(
        networkRequest, QJsonDocument(body).toJson(QJsonDocument::Compact));

    operation->start();
    QPointer<BackendOperation> guard(operation);
    connect(reply, &QNetworkReply::finished, operation,
            [guard, reply, format, model, voice = request.voice] {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QByteArray bytes = reply->readAll();
        const QString transportError = reply->error() == QNetworkReply::NoError
            ? QString() : reply->errorString();
        const bool aborted = reply->error() == QNetworkReply::OperationCanceledError;
        reply->deleteLater();
        if (!guard)
            return;
        if (guard->cancellationRequested() || aborted) {
            guard->acknowledgeCancelled();
            return;
        }
        if (status < 200 || status >= 300 || !transportError.isEmpty() || bytes.isEmpty()) {
            QString detail;
            const QJsonObject body = QJsonDocument::fromJson(bytes).object();
            const QJsonValue errorValue = body.value(QStringLiteral("error"));
            if (errorValue.isObject())
                detail = errorValue.toObject().value(QStringLiteral("message")).toString();
            else
                detail = errorValue.toString();
            guard->fail(!detail.isEmpty() ? detail
                : !transportError.isEmpty() ? transportError
                : QStringLiteral("Speech synthesis failed (%1).").arg(status));
            return;
        }
        guard->complete({
            {QStringLiteral("audio"), bytes},
            {QStringLiteral("format"), format},
            {QStringLiteral("model"), model},
            {QStringLiteral("voice"), voice},
        });
    });

    const QPointer<QNetworkReply> replyGuard(reply);
    operation->addCancellationHandler([replyGuard] {
        if (replyGuard)
            replyGuard->abort();
    });
    return operation;
}

} // namespace qtpanel
