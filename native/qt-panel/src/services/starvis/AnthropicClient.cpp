#include "AnthropicClient.h"

#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QBuffer>
#include <QDebug>
#include <QJsonDocument>

#include <memory>

namespace qtpanel {

namespace {

const char kDefaultBaseUrl[] = "https://api.anthropic.com";
const char kAnthropicVersion[] = "2023-06-01";

// Accumulates one in-flight assistant message from SSE deltas, faithfully
// enough that the finished content array can be echoed back in a tool loop
// (thinking blocks keep their signatures, tool_use keeps its id).
struct StreamState {
    QJsonArray content;
    int currentIndex = -1;
    QJsonObject currentBlock;
    QString currentText;      // text or thinking accumulation
    QString currentSignature; // thinking signature_delta accumulation
    QString currentJson;      // tool_use input_json_delta accumulation
    QString stopReason;
    int inputTokens = 0;
    int outputTokens = 0;
    QString apiError;
};

} // namespace

AnthropicClient::AnthropicClient(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                                 QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_http(http)
{
}

QString AnthropicClient::apiKey() const
{
    return m_vault->get(QStringLiteral("starvis-anthropic-key")).trimmed();
}

QString AnthropicClient::baseUrl() const
{
    QVariantMap cfg;
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-provider"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            cfg = doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        cfg = raw.toMap();
    }
    QString url = cfg.value(QStringLiteral("anthropicBaseUrl")).toString().trimmed();
    if (url.isEmpty())
        url = QLatin1String(kDefaultBaseUrl);
    while (url.endsWith(QLatin1Char('/')))
        url.chop(1);
    return url;
}

QNetworkReply* AnthropicClient::streamMessage(const QString& model, const QString& system,
                                              const QJsonArray& messages, const QJsonArray& tools,
                                              int maxTokens, QObject* context,
                                              StreamCallbacks callbacks)
{
    QJsonObject body{
        {QStringLiteral("model"), model},
        {QStringLiteral("max_tokens"), qBound(256, maxTokens, 32000)},
        {QStringLiteral("stream"), true},
        {QStringLiteral("messages"), messages},
    };
    if (!system.isEmpty())
        body.insert(QStringLiteral("system"), system);
    if (!tools.isEmpty())
        body.insert(QStringLiteral("tools"), tools);

    auto state = std::make_shared<StreamState>();

    auto onEvent = [state, callbacks](const QString& event, const QByteArray& data) {
        const QJsonObject payload = QJsonDocument::fromJson(data).object();
        const QString type = !event.isEmpty()
            ? event : payload.value(QLatin1String("type")).toString();

        if (type == QLatin1String("message_start")) {
            state->inputTokens = payload.value(QLatin1String("message")).toObject()
                                     .value(QLatin1String("usage")).toObject()
                                     .value(QLatin1String("input_tokens")).toInt();
            if (callbacks.onStart)
                callbacks.onStart();
            if (callbacks.onUsage)
                callbacks.onUsage(state->inputTokens, state->outputTokens);
            return;
        }
        if (type == QLatin1String("content_block_start")) {
            state->currentIndex = payload.value(QLatin1String("index")).toInt();
            state->currentBlock = payload.value(QLatin1String("content_block")).toObject();
            state->currentText.clear();
            state->currentSignature.clear();
            state->currentJson.clear();
            return;
        }
        if (type == QLatin1String("content_block_delta")) {
            const QJsonObject delta = payload.value(QLatin1String("delta")).toObject();
            const QString deltaType = delta.value(QLatin1String("type")).toString();
            if (deltaType == QLatin1String("text_delta")) {
                const QString text = delta.value(QLatin1String("text")).toString();
                state->currentText += text;
                if (callbacks.onTextDelta)
                    callbacks.onTextDelta(text);
            } else if (deltaType == QLatin1String("thinking_delta")) {
                const QString thinking = delta.value(QLatin1String("thinking")).toString();
                state->currentText += thinking;
                if (callbacks.onThinkingDelta)
                    callbacks.onThinkingDelta(thinking);
            } else if (deltaType == QLatin1String("signature_delta")) {
                state->currentSignature += delta.value(QLatin1String("signature")).toString();
            } else if (deltaType == QLatin1String("input_json_delta")) {
                state->currentJson += delta.value(QLatin1String("partial_json")).toString();
            }
            return;
        }
        if (type == QLatin1String("content_block_stop")) {
            QJsonObject block = state->currentBlock;
            const QString blockType = block.value(QLatin1String("type")).toString();
            if (blockType == QLatin1String("text")) {
                block.insert(QStringLiteral("text"), state->currentText);
            } else if (blockType == QLatin1String("thinking")) {
                block.insert(QStringLiteral("thinking"), state->currentText);
                if (!state->currentSignature.isEmpty())
                    block.insert(QStringLiteral("signature"), state->currentSignature);
            } else if (blockType == QLatin1String("tool_use")) {
                block.insert(QStringLiteral("input"),
                             state->currentJson.isEmpty()
                                 ? QJsonObject()
                                 : QJsonDocument::fromJson(state->currentJson.toUtf8()).object());
            }
            state->content.append(block);
            state->currentBlock = {};
            return;
        }
        if (type == QLatin1String("message_delta")) {
            const QJsonObject delta = payload.value(QLatin1String("delta")).toObject();
            if (delta.contains(QLatin1String("stop_reason")))
                state->stopReason = delta.value(QLatin1String("stop_reason")).toString();
            state->outputTokens = payload.value(QLatin1String("usage")).toObject()
                                      .value(QLatin1String("output_tokens")).toInt();
            if (callbacks.onUsage)
                callbacks.onUsage(state->inputTokens, state->outputTokens);
            return;
        }
        if (type == QLatin1String("error")) {
            state->apiError = payload.value(QLatin1String("error")).toObject()
                                  .value(QLatin1String("message")).toString();
            if (state->apiError.isEmpty())
                state->apiError = QString::fromUtf8(data.left(400));
            return;
        }
        // message_stop / ping: nothing to do.
    };

    auto onDone = [state, callbacks](int status, const QString& error) {
        QString finalError = state->apiError;
        if (finalError.isEmpty() && !error.isEmpty()) {
            // Extract the provider's message from the raw error body if present.
            const int brace = error.indexOf(QLatin1Char('{'));
            if (brace >= 0) {
                const QJsonObject obj =
                    QJsonDocument::fromJson(error.mid(brace).toUtf8()).object();
                finalError = obj.value(QLatin1String("error")).toObject()
                                 .value(QLatin1String("message")).toString();
            }
            if (finalError.isEmpty())
                finalError = error;
        }
        if (finalError.isEmpty() && (status < 200 || status >= 300))
            finalError = QStringLiteral("Anthropic request failed (%1)").arg(status);
        if (callbacks.onFinished)
            callbacks.onFinished(state->content, state->stopReason, finalError);
    };

    return m_http->postSse(
        QUrl(baseUrl() + QStringLiteral("/v1/messages")),
        {{QByteArrayLiteral("x-api-key"), apiKey().toUtf8()},
         {QByteArrayLiteral("anthropic-version"), QByteArray(kAnthropicVersion)}},
        QJsonDocument(body).toJson(QJsonDocument::Compact), context,
        std::move(onEvent), std::move(onDone));
}

QJsonObject AnthropicClient::imageBlock(const QImage& image, int maxDim, int jpegQuality)
{
    QImage scaled = image;
    if (scaled.width() > maxDim || scaled.height() > maxDim)
        scaled = scaled.scaled(maxDim, maxDim, Qt::KeepAspectRatio, Qt::SmoothTransformation);

    QByteArray jpeg;
    QBuffer buffer(&jpeg);
    buffer.open(QIODevice::WriteOnly);
    scaled.save(&buffer, "JPEG", jpegQuality);

    return QJsonObject{
        {QStringLiteral("type"), QStringLiteral("image")},
        {QStringLiteral("source"), QJsonObject{
            {QStringLiteral("type"), QStringLiteral("base64")},
            {QStringLiteral("media_type"), QStringLiteral("image/jpeg")},
            {QStringLiteral("data"), QString::fromLatin1(jpeg.toBase64())},
        }},
    };
}

void AnthropicClient::classifyImage(const QImage& image, const QString& prompt,
                                    const QString& model, QObject* context,
                                    ClassifyCallback callback)
{
    classifyWithGallery({}, image, prompt, model, context, std::move(callback));
}

void AnthropicClient::classifyWithGallery(const QVector<QPair<QString, QImage>>& gallery,
                                          const QImage& probe, const QString& prompt,
                                          const QString& model, QObject* context,
                                          ClassifyCallback callback)
{
    if (probe.isNull()) {
        callback({}, {}, QStringLiteral("empty image"));
        return;
    }

    QJsonArray content;
    // References first, each announced by name, so the model can attribute a
    // match to a label rather than describing a stranger.
    for (const auto& entry : gallery) {
        if (entry.second.isNull())
            continue;
        content.append(QJsonObject{
            {QStringLiteral("type"), QStringLiteral("text")},
            {QStringLiteral("text"), QStringLiteral("Référence — ") + entry.first},
        });
        content.append(imageBlock(entry.second, 400, 70));
    }
    if (!gallery.isEmpty()) {
        content.append(QJsonObject{
            {QStringLiteral("type"), QStringLiteral("text")},
            {QStringLiteral("text"), QStringLiteral("Image à analyser :")},
        });
    }

    const QJsonObject imgBlock = imageBlock(probe);
    content.append(imgBlock);
    content.append(QJsonObject{
        {QStringLiteral("type"), QStringLiteral("text")},
        {QStringLiteral("text"), prompt},
    });

    const int imageBytes = imgBlock.value(QLatin1String("source")).toObject()
                               .value(QLatin1String("data")).toString().size() * 3 / 4;
    qInfo() << "[starvis.anthropic] image escalation:" << imageBytes << "bytes to" << model
            << "with" << gallery.size() << "reference(s)";

    const QJsonArray messages{QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), content},
    }};

    auto text = std::make_shared<QString>();
    StreamCallbacks callbacks;
    callbacks.onTextDelta = [text](const QString& t) { *text += t; };
    callbacks.onFinished = [text, callback](const QJsonArray&, const QString& stopReason,
                                            const QString& error) {
        if (!error.isEmpty()) {
            callback({}, *text, error);
            return;
        }
        if (stopReason == QLatin1String("refusal")) {
            callback({}, *text, QStringLiteral("model refused the request"));
            return;
        }
        // Strict-JSON prompt; tolerate fences or prose around the object.
        const int start = text->indexOf(QLatin1Char('{'));
        const int end = text->lastIndexOf(QLatin1Char('}'));
        QJsonObject parsed;
        if (start >= 0 && end > start)
            parsed = QJsonDocument::fromJson(text->mid(start, end - start + 1).toUtf8()).object();
        callback(parsed, *text, QString());
    };

    streamMessage(model, QString(), messages, {}, 1024, context, std::move(callbacks));
}

} // namespace qtpanel
