#include "OpenAiCompatibleLLMBackend.h"

#include "core/HttpClient.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QPointer>
#include <QTimer>

namespace qtpanel {

namespace {

QString textValue(const QJsonValue& value)
{
    if (value.isString())
        return value.toString();
    QString text;
    for (const QJsonValue& partValue : value.toArray()) {
        const QJsonObject part = partValue.toObject();
        const QString type = part.value(QStringLiteral("type")).toString();
        if (type == QLatin1String("text") || type == QLatin1String("output_text"))
            text += part.value(QStringLiteral("text")).toString();
    }
    return text;
}

QString reasoningValue(const QJsonObject& delta)
{
    QString reasoning = textValue(delta.value(QStringLiteral("reasoning_content")));
    if (reasoning.isEmpty())
        reasoning = textValue(delta.value(QStringLiteral("reasoning")));
    if (!reasoning.isEmpty())
        return reasoning;

    for (const QJsonValue& detailValue : delta.value(QStringLiteral("reasoning_details")).toArray()) {
        const QJsonObject detail = detailValue.toObject();
        reasoning += detail.value(QStringLiteral("text")).toString();
        if (reasoning.isEmpty())
            reasoning += detail.value(QStringLiteral("content")).toString();
    }
    return reasoning;
}

QString providerError(const QString& error)
{
    const int jsonStart = error.indexOf(QLatin1Char('{'));
    if (jsonStart < 0)
        return error;
    const QJsonObject payload = QJsonDocument::fromJson(error.mid(jsonStart).toUtf8()).object();
    const QJsonValue detail = payload.value(QStringLiteral("error"));
    const QString message = detail.isObject()
        ? detail.toObject().value(QStringLiteral("message")).toString()
        : detail.toString();
    return message.isEmpty() ? error : message;
}

} // namespace

OpenAiCompatibleLLMBackend::OpenAiCompatibleLLMBackend(HttpClient* http, QObject* parent)
    : LLMBackend(parent)
    , m_http(http)
{
}

BackendDescriptor OpenAiCompatibleLLMBackend::descriptor() const
{
    return {
        QStringLiteral("openai-compatible-local"),
        QStringLiteral("LM Studio"),
        m_endpoint,
        m_defaultModel,
        m_available,
        false,
        true,
        {{QStringLiteral("protocol"), QStringLiteral("openai-chat-completions")}},
    };
}

void OpenAiCompatibleLLMBackend::configure(const QString& endpoint,
                                           const QString& defaultModel,
                                           const QString& bearerToken)
{
    QString normalized = endpoint.trimmed();
    while (normalized.endsWith(QLatin1Char('/')))
        normalized.chop(1);
    if (!normalized.isEmpty())
        m_endpoint = normalized;
    m_defaultModel = defaultModel.trimmed();
    m_bearerToken = bearerToken;
}

void OpenAiCompatibleLLMBackend::setAvailable(bool available)
{
    if (m_available == available)
        return;
    m_available = available;
    emit availabilityChanged();
}

QString OpenAiCompatibleLLMBackend::chatCompletionsUrl() const
{
    return m_endpoint + QStringLiteral("/chat/completions");
}

BackendOperation* OpenAiCompatibleLLMBackend::generate(const LlmRequest& request,
                                                        QObject* owner)
{
    auto* operation = new BackendOperation(QStringLiteral("llm"),
                                           QStringLiteral("lm-studio"),
                                           owner ? owner : this);
    if (!m_http) {
        QTimer::singleShot(0, operation, [operation] {
            operation->fail(QStringLiteral("HTTP client unavailable."));
        });
        return operation;
    }

    const QString selectedModel = request.model.trimmed().isEmpty()
        ? m_defaultModel : request.model.trimmed();
    if (selectedModel.isEmpty()) {
        QTimer::singleShot(0, operation, [operation] {
            operation->fail(QStringLiteral("LM Studio model is not configured."));
        });
        return operation;
    }

    QJsonObject body{
        {QStringLiteral("model"), selectedModel},
        {QStringLiteral("messages"), request.messages},
        {QStringLiteral("max_tokens"), request.maxTokens},
        {QStringLiteral("stream"), true},
        {QStringLiteral("stream_options"),
         QJsonObject{{QStringLiteral("include_usage"), true}}},
        {QStringLiteral("chat_template_kwargs"),
         QJsonObject{{QStringLiteral("enable_thinking"), request.reasoning}}},
    };
    if (request.temperature > 0.0)
        body.insert(QStringLiteral("temperature"), request.temperature);
    if (!request.tools.isEmpty()) {
        body.insert(QStringLiteral("tools"), request.tools);
        body.insert(QStringLiteral("tool_choice"), QStringLiteral("auto"));
    }

    QList<QPair<QByteArray, QByteArray>> headers;
    if (!m_bearerToken.isEmpty())
        headers.append({QByteArrayLiteral("Authorization"),
                        QByteArrayLiteral("Bearer ") + m_bearerToken.toUtf8()});

    operation->start();
    QPointer<BackendOperation> guard(operation);
    QNetworkReply* reply = m_http->postSse(
        QUrl(chatCompletionsUrl()), headers,
        QJsonDocument(body).toJson(QJsonDocument::Compact), operation,
        [guard](const QString&, const QByteArray& data) {
            if (!guard || data == QByteArrayLiteral("[DONE]")
                || guard->cancellationRequested()) {
                return;
            }
            QJsonParseError parseError;
            const QJsonObject payload = QJsonDocument::fromJson(data, &parseError).object();
            if (parseError.error != QJsonParseError::NoError)
                return;

            const QJsonObject usage = payload.value(QStringLiteral("usage")).toObject();
            if (!usage.isEmpty()) {
                guard->setProperty("promptTokens",
                                   usage.value(QStringLiteral("prompt_tokens")).toInt());
                guard->setProperty("completionTokens",
                                   usage.value(QStringLiteral("completion_tokens")).toInt());
            }

            const QJsonArray choices = payload.value(QStringLiteral("choices")).toArray();
            if (choices.isEmpty())
                return;
            const QJsonObject delta = choices.first().toObject()
                                          .value(QStringLiteral("delta")).toObject();
            const QString reasoning = reasoningValue(delta);
            if (!reasoning.isEmpty())
                guard->appendThinking(reasoning);
            const QString text = textValue(delta.value(QStringLiteral("content")));
            if (!text.isEmpty())
                guard->appendText(text);
        },
        [guard, selectedModel](int status, const QString& error) {
            if (!guard)
                return;
            if (guard->cancellationRequested() || error == QLatin1String("aborted")) {
                guard->acknowledgeCancelled();
                return;
            }
            if (status < 200 || status >= 300 || !error.isEmpty()) {
                guard->fail(error.isEmpty()
                    ? QStringLiteral("LM Studio request failed (%1).").arg(status)
                    : providerError(error));
                return;
            }
            guard->complete({
                {QStringLiteral("text"), guard->text()},
                {QStringLiteral("thinking"), guard->thinking()},
                {QStringLiteral("model"), selectedModel},
                {QStringLiteral("promptTokens"), guard->property("promptTokens")},
                {QStringLiteral("completionTokens"), guard->property("completionTokens")},
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
