#include "OpenAiCompatibleVisionBackend.h"

#include <QBuffer>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QTimer>

namespace qtpanel {

namespace {

QJsonObject imagePart(const QImage& source)
{
    if (source.isNull())
        return {};
    QImage image = source;
    if (image.width() > 1280 || image.height() > 1280)
        image = image.scaled(1280, 1280, Qt::KeepAspectRatio, Qt::SmoothTransformation);
    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    if (!image.save(&buffer, "JPEG", 72))
        return {};
    return {
        {QStringLiteral("type"), QStringLiteral("image_url")},
        {QStringLiteral("image_url"), QJsonObject{
            {QStringLiteral("url"), QStringLiteral("data:image/jpeg;base64,")
                 + QString::fromLatin1(bytes.toBase64())},
        }},
    };
}

QString responseText(const QJsonObject& payload)
{
    const QJsonArray choices = payload.value(QStringLiteral("choices")).toArray();
    if (choices.isEmpty())
        return {};
    const QJsonValue content = choices.first().toObject()
                                   .value(QStringLiteral("message")).toObject()
                                   .value(QStringLiteral("content"));
    if (content.isString())
        return content.toString().trimmed();
    QString text;
    for (const QJsonValue& value : content.toArray()) {
        const QJsonObject part = value.toObject();
        if (part.value(QStringLiteral("type")).toString() == QLatin1String("text"))
            text += part.value(QStringLiteral("text")).toString();
    }
    return text.trimmed();
}

QString errorMessage(const QJsonObject& payload)
{
    const QJsonValue error = payload.value(QStringLiteral("error"));
    return error.isObject()
        ? error.toObject().value(QStringLiteral("message")).toString()
        : error.toString();
}

QJsonObject extractJsonObject(const QString& text)
{
    const int start = text.indexOf(QLatin1Char('{'));
    const int end = text.lastIndexOf(QLatin1Char('}'));
    if (start < 0 || end <= start)
        return {};
    return QJsonDocument::fromJson(text.mid(start, end - start + 1).toUtf8()).object();
}

} // namespace

OpenAiCompatibleVisionBackend::OpenAiCompatibleVisionBackend(QObject* parent)
    : VisionBackend(parent)
{
}

BackendDescriptor OpenAiCompatibleVisionBackend::descriptor() const
{
    return {
        QStringLiteral("openai-compatible-vision"),
        QStringLiteral("OpenAI-compatible vision"),
        m_endpoint,
        m_model,
        m_available,
        false,
        false,
        {{QStringLiteral("protocol"), QStringLiteral("chat-completions-multimodal")}},
    };
}

void OpenAiCompatibleVisionBackend::configure(const QString& endpoint,
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

void OpenAiCompatibleVisionBackend::setAvailable(bool available)
{
    if (m_available == available)
        return;
    m_available = available;
    emit availabilityChanged();
}

QString OpenAiCompatibleVisionBackend::chatCompletionsUrl() const
{
    return m_endpoint + QStringLiteral("/chat/completions");
}

BackendOperation* OpenAiCompatibleVisionBackend::analyze(const VisionRequest& request,
                                                          QObject* owner)
{
    auto* operation = new BackendOperation(QStringLiteral("vision"),
                                           QStringLiteral("openai-compatible"),
                                           owner ? owner : this);
    // The local vision server has one slot. Do not build an invisible queue
    // of stale camera frames behind an already-running analysis.
    for (auto* reply : m_network.findChildren<QNetworkReply*>()) {
        if (!reply->isFinished()) {
            QTimer::singleShot(0, operation, [operation] {
                operation->fail(QStringLiteral("Local vision is busy."));
            });
            return operation;
        }
    }
    if (request.images.isEmpty() || request.images.constFirst().isNull()) {
        QTimer::singleShot(0, operation, [operation] {
            operation->fail(QStringLiteral("No image was provided for vision analysis."));
        });
        return operation;
    }

    const QString selectedModel = request.model.trimmed().isEmpty()
        ? m_model : request.model.trimmed();
    if (selectedModel.isEmpty()) {
        QTimer::singleShot(0, operation, [operation] {
            operation->fail(QStringLiteral("Vision model is not configured."));
        });
        return operation;
    }

    QJsonArray content;
    for (qsizetype i = 0; i < request.images.size(); ++i) {
        const QString label = i < request.imageLabels.size()
            ? request.imageLabels.at(i).trimmed() : QString();
        if (!label.isEmpty()) {
            content.append(QJsonObject{
                {QStringLiteral("type"), QStringLiteral("text")},
                {QStringLiteral("text"), label},
            });
        }
        const QJsonObject part = imagePart(request.images.at(i));
        if (!part.isEmpty())
            content.append(part);
    }
    content.append(QJsonObject{
        {QStringLiteral("type"), QStringLiteral("text")},
        {QStringLiteral("text"), request.prompt},
    });

    const QJsonObject body{
        {QStringLiteral("model"), selectedModel},
        {QStringLiteral("messages"), QJsonArray{QJsonObject{
            {QStringLiteral("role"), QStringLiteral("user")},
            {QStringLiteral("content"), content},
        }}},
        {QStringLiteral("max_tokens"), request.maxTokens},
        {QStringLiteral("temperature"), 0.1},
        {QStringLiteral("stream"), false},
        {QStringLiteral("chat_template_kwargs"), QJsonObject{
            {QStringLiteral("enable_thinking"), request.reasoning},
        }},
    };

    QNetworkRequest networkRequest{QUrl(chatCompletionsUrl())};
    networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
                             QStringLiteral("application/json"));
    const int timeoutMs = qBound(1, request.timeoutMs, 120000);
    networkRequest.setTransferTimeout(timeoutMs);
    if (!m_bearerToken.isEmpty())
        networkRequest.setRawHeader("Authorization", "Bearer " + m_bearerToken.toUtf8());
    QNetworkReply* reply = m_network.post(
        networkRequest, QJsonDocument(body).toJson(QJsonDocument::Compact));

    operation->start();
    QPointer<BackendOperation> guard(operation);
    connect(reply, &QNetworkReply::finished, operation,
            [guard, reply, selectedModel] {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QByteArray bytes = reply->readAll();
        const QJsonObject payload = QJsonDocument::fromJson(bytes).object();
        const QString transportError = reply->error() == QNetworkReply::NoError
            ? QString() : reply->errorString();
        const bool aborted = reply->error() == QNetworkReply::OperationCanceledError;
        const bool deadlineExpired = reply->property("visionDeadlineExpired").toBool();
        reply->deleteLater();
        if (!guard)
            return;
        if (guard->cancellationRequested() || (aborted && !deadlineExpired)) {
            guard->acknowledgeCancelled();
            return;
        }
        if (deadlineExpired) {
            guard->fail(QStringLiteral("Local vision deadline exceeded."));
            return;
        }
        if (status < 200 || status >= 300 || !transportError.isEmpty()) {
            const QString detail = errorMessage(payload);
            guard->fail(!detail.isEmpty() ? detail
                : !transportError.isEmpty() ? transportError
                : QStringLiteral("Vision request failed (%1).").arg(status));
            return;
        }
        const QString raw = responseText(payload);
        if (raw.isEmpty()) {
            guard->fail(QStringLiteral("The vision model returned no analysis."));
            return;
        }
        guard->appendText(raw);
        guard->complete({
            {QStringLiteral("text"), raw},
            {QStringLiteral("json"), extractJsonObject(raw).toVariantMap()},
            {QStringLiteral("model"), selectedModel},
        });
    });

    const QPointer<QNetworkReply> replyGuard(reply);
    auto* deadline = new QTimer(reply);
    deadline->setSingleShot(true);
    connect(deadline, &QTimer::timeout, reply, [replyGuard] {
        if (replyGuard && !replyGuard->isFinished()) {
            replyGuard->setProperty("visionDeadlineExpired", true);
            replyGuard->abort();
        }
    });
    deadline->start(timeoutMs);
    connect(operation, &QObject::destroyed, reply, [replyGuard] {
        if (replyGuard && !replyGuard->isFinished())
            replyGuard->abort();
    });
    operation->addCancellationHandler([replyGuard] {
        if (replyGuard)
            replyGuard->abort();
    });
    return operation;
}

} // namespace qtpanel
