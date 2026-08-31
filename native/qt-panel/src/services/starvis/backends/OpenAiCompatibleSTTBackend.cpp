#include "OpenAiCompatibleSTTBackend.h"

#include <QBuffer>
#include <QDataStream>
#include <QHttpMultiPart>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QTimer>

namespace qtpanel {

OpenAiCompatibleSTTBackend::OpenAiCompatibleSTTBackend(QObject* parent)
    : STTBackend(parent)
{
}

BackendDescriptor OpenAiCompatibleSTTBackend::descriptor() const
{
    return {
        QStringLiteral("openai-compatible-stt"),
        QStringLiteral("OpenAI-compatible STT"),
        m_endpoint,
        m_model,
        m_available,
        false,
        false,
        {{QStringLiteral("protocol"), QStringLiteral("audio-transcriptions")}},
    };
}

void OpenAiCompatibleSTTBackend::configure(const QString& endpoint,
                                           const QString& model,
                                           const QString& bearerToken)
{
    QString normalized = endpoint.trimmed();
    while (normalized.endsWith(QLatin1Char('/')))
        normalized.chop(1);
    if (!normalized.isEmpty())
        m_endpoint = normalized;
    m_model = model.trimmed();
    m_bearerToken = bearerToken;
}

void OpenAiCompatibleSTTBackend::setAvailable(bool available)
{
    if (m_available == available)
        return;
    m_available = available;
    emit availabilityChanged();
}

QString OpenAiCompatibleSTTBackend::transcriptionUrl() const
{
    return m_endpoint + QStringLiteral("/audio/transcriptions");
}

QByteArray OpenAiCompatibleSTTBackend::pcmToWav(const SttRequest& request)
{
    QByteArray wav;
    QBuffer buffer(&wav);
    buffer.open(QIODevice::WriteOnly);
    QDataStream stream(&buffer);
    stream.setByteOrder(QDataStream::LittleEndian);
    const quint16 channels = static_cast<quint16>(qBound(1, request.channels, 8));
    const quint32 sampleRate = static_cast<quint32>(qBound(8000, request.sampleRate, 192000));
    const quint16 bytesPerSample = 2;
    stream.writeRawData("RIFF", 4);
    stream << quint32(36 + request.pcm.size());
    stream.writeRawData("WAVEfmt ", 8);
    stream << quint32(16) << quint16(1) << channels << sampleRate
           << quint32(sampleRate * channels * bytesPerSample)
           << quint16(channels * bytesPerSample) << quint16(16);
    stream.writeRawData("data", 4);
    stream << quint32(request.pcm.size());
    stream.writeRawData(request.pcm.constData(), request.pcm.size());
    return wav;
}

BackendOperation* OpenAiCompatibleSTTBackend::transcribe(const SttRequest& request,
                                                          QObject* owner)
{
    auto* operation = new BackendOperation(QStringLiteral("stt"),
                                           QStringLiteral("openai-compatible"),
                                           owner ? owner : this);
    if (request.pcm.isEmpty()) {
        QTimer::singleShot(0, operation, [operation] {
            operation->fail(QStringLiteral("No microphone audio was captured."));
        });
        return operation;
    }

    auto* multipart = new QHttpMultiPart(QHttpMultiPart::FormDataType);
    QHttpPart audioPart;
    audioPart.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("audio/wav"));
    audioPart.setHeader(QNetworkRequest::ContentDispositionHeader,
                        QStringLiteral("form-data; name=\"file\"; filename=\"voice.wav\""));
    audioPart.setBody(pcmToWav(request));
    multipart->append(audioPart);

    const QString selectedModel = request.model.trimmed().isEmpty()
        ? m_model : request.model.trimmed();
    if (!selectedModel.isEmpty()) {
        QHttpPart modelPart;
        modelPart.setHeader(QNetworkRequest::ContentDispositionHeader,
                            QStringLiteral("form-data; name=\"model\""));
        modelPart.setBody(selectedModel.toUtf8());
        multipart->append(modelPart);
    }
    if (!request.detectLanguage && !request.language.trimmed().isEmpty()) {
        QHttpPart languagePart;
        languagePart.setHeader(QNetworkRequest::ContentDispositionHeader,
                               QStringLiteral("form-data; name=\"language\""));
        languagePart.setBody(request.language.trimmed().toUtf8());
        multipart->append(languagePart);
    }
    QHttpPart formatPart;
    formatPart.setHeader(QNetworkRequest::ContentDispositionHeader,
                         QStringLiteral("form-data; name=\"response_format\""));
    formatPart.setBody("json");
    multipart->append(formatPart);

    QNetworkRequest networkRequest{QUrl(transcriptionUrl())};
    networkRequest.setTransferTimeout(300000);
    if (!m_bearerToken.isEmpty())
        networkRequest.setRawHeader("Authorization", "Bearer " + m_bearerToken.toUtf8());
    QNetworkReply* reply = m_network.post(networkRequest, multipart);
    multipart->setParent(reply);

    operation->start();
    QPointer<BackendOperation> guard(operation);
    connect(reply, &QNetworkReply::finished, operation, [guard, reply, selectedModel] {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QByteArray bytes = reply->readAll();
        const QJsonObject body = QJsonDocument::fromJson(bytes).object();
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
        if (status < 200 || status >= 300 || !transportError.isEmpty()) {
            const QJsonValue errorValue = body.value(QStringLiteral("error"));
            const QString detail = errorValue.isObject()
                ? errorValue.toObject().value(QStringLiteral("message")).toString()
                : errorValue.toString();
            guard->fail(!detail.isEmpty() ? detail
                : !transportError.isEmpty() ? transportError
                : QStringLiteral("Transcription request failed (%1).").arg(status));
            return;
        }
        const QString transcript = body.value(QStringLiteral("text")).toString().trimmed();
        if (transcript.isEmpty()) {
            guard->fail(QStringLiteral("The speech recognizer returned no text."));
            return;
        }
        const QString language = body.value(QStringLiteral("language")).toString();
        guard->appendTranscript(transcript, true);
        guard->complete({
            {QStringLiteral("text"), transcript},
            {QStringLiteral("language"), language},
            {QStringLiteral("model"), body.value(QStringLiteral("model"))
                                          .toString(selectedModel)},
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
