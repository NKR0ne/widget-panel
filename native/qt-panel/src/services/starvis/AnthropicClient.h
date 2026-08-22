#pragma once

#include <QImage>
#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QVector>

#include <functional>

class QNetworkReply;

namespace qtpanel {

class HttpClient;
class SecretVault;
class SettingsStore;

// Streaming client for the Anthropic Messages API. Owns nothing about the
// conversation: callers pass complete `messages`/`tools` arrays and receive
// deltas plus the final assistant content blocks (thinking/tool_use included,
// unmodified, so a tool loop can echo them back verbatim).
//
// Sampling and thinking parameters are deliberately never sent: the current
// top models reject them, and omitting `thinking` means adaptive thinking —
// this is what keeps the client valid for whatever ModelResolver picks next.
class AnthropicClient : public QObject {
    Q_OBJECT

public:
    AnthropicClient(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                    QObject* parent = nullptr);

    bool configured() const { return !apiKey().isEmpty(); }

    struct StreamCallbacks {
        std::function<void()> onStart;
        std::function<void(const QString& text)> onTextDelta;
        std::function<void(const QString& thinking)> onThinkingDelta;
        std::function<void(int inputTokens, int outputTokens)> onUsage;
        // error empty on success; content = full assistant content blocks;
        // stopReason: end_turn | tool_use | max_tokens | refusal | ...
        std::function<void(const QJsonArray& content, const QString& stopReason,
                           const QString& error)> onFinished;
    };

    // Returns the reply for cancellation (abort()); owned by HttpClient.
    QNetworkReply* streamMessage(const QString& model, const QString& system,
                                 const QJsonArray& messages, const QJsonArray& tools,
                                 int maxTokens, QObject* context, StreamCallbacks callbacks);

    // One-shot vision helper for sentry/greeting: sends the image plus a
    // prompt that must ask for strict JSON, returns the parsed object (or an
    // empty one + the raw text when the model didn't comply).
    using ClassifyCallback = std::function<void(const QJsonObject& result, const QString& rawText,
                                                const QString& error)>;
    void classifyImage(const QImage& image, const QString& prompt, const QString& model,
                       QObject* context, ClassifyCallback callback);

    // Same, with labelled reference images sent before the probe image — used
    // to recognise known people by comparison rather than by a face database.
    void classifyWithGallery(const QVector<QPair<QString, QImage>>& gallery,
                             const QImage& probe, const QString& prompt,
                             const QString& model, QObject* context,
                             ClassifyCallback callback);

    static QJsonObject imageBlock(const QImage& image, int maxDim = 1280, int jpegQuality = 70);

private:
    QString apiKey() const;
    QString baseUrl() const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    HttpClient* m_http = nullptr;
};

} // namespace qtpanel
