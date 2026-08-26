#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QImage>
#include <QObject>
#include <QVariantList>
#include <QVector>

#include <functional>

class QAudioOutput;
class QMediaPlayer;
class QNetworkReply;

namespace qtpanel {

class AnthropicClient;
class HttpClient;
class ModelResolver;
class SentryService;
class SpeechService;
class StarvisState;
class VoiceSession;
class NewsService;
class SecretVault;
class SettingsStore;
class StocksModel;
class WeatherService;
class WorkstationClient;

// Native Starvis chat, briefing, speech, context injection, vision, and gated
// agent actions. The default provider is the local OpenAI-compatible Qwen3-VL
// runtime; Anthropic and OpenAI remain explicit cloud alternatives.
class StarvisService : public QObject {
    Q_OBJECT
    Q_MOC_INCLUDE("services/starvis/StarvisState.h")
    Q_MOC_INCLUDE("services/starvis/VoiceSession.h")
    Q_PROPERTY(bool configured READ configured NOTIFY configuredChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(bool speaking READ speaking NOTIFY speakingChanged)
    Q_PROPERTY(QString model READ model NOTIFY configuredChanged)
    Q_PROPERTY(QString provider READ provider NOTIFY configuredChanged)
    Q_PROPERTY(QVariantList pendingActions READ pendingActions NOTIFY actionsChanged)
    Q_PROPERTY(QVariantList recentActions READ recentActions NOTIFY actionsChanged)
    Q_PROPERTY(bool executionEnabled READ executionEnabled WRITE setExecutionEnabled NOTIFY executionEnabledChanged)
    Q_PROPERTY(qtpanel::StarvisState* state READ state CONSTANT)
    Q_PROPERTY(qtpanel::VoiceSession* voice READ voice CONSTANT)

public:
    StarvisService(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                   WeatherService* weather, StocksModel* stocks,
                   NewsService* news, WorkstationClient* workstation,
                   SpeechService* speech, QObject* parent = nullptr);

    bool configured() const;
    bool busy() const { return m_busy; }
    QString model() const;
    // Explicit provider selection: "local", "anthropic", or "openai".
    QString provider() const;

    // history: [{role: "user"|"assistant", text: string}, ...]
    bool speaking() const;

    // allowAgent enables the tool loop (read-only workspace tools + web search
    // + action proposals). Mutating proposals go to the approval queue.
    Q_INVOKABLE void chat(const QString& message, const QVariantList& history,
                          bool allowInternet = false, bool allowAgent = false);
    Q_INVOKABLE void briefing();
    Q_INVOKABLE void cancelChat();
    // Cloud TTS when an OpenAI key is stored, otherwise the offline Windows
    // voice — spoken alerts must not depend on a cloud key being present.
    Q_INVOKABLE void speak(const QString& text);
    Q_INVOKABLE void stopSpeaking();
    // True when speech can be produced by either path.
    Q_INVOKABLE bool canSpeak() const;
    // Runtime, capability, voice, endpoint, and model details for settings.
    Q_INVOKABLE QVariantMap providerStatus() const;
    Q_INVOKABLE void refreshModel();

    using ClassifyCallback = std::function<void(const QJsonObject& result,
                                                const QString& rawText,
                                                const QString& error)>;
    bool visionConfigured() const;
    void classifyImage(const QImage& image, const QString& prompt,
                       QObject* context, ClassifyCallback callback);
    void classifyWithGallery(const QVector<QPair<QString, QImage>>& gallery,
                             const QImage& probe, const QString& prompt,
                             QObject* context, ClassifyCallback callback);

    // The Anthropic client is shared with SentryService (vision escalation).
    AnthropicClient* anthropic() const { return m_anthropic; }
    StarvisState* state() const { return m_state; }
    VoiceSession* voice() const { return m_voice; }
    // Set once at startup; used by check_cameras and greetings.
    void setSentry(SentryService* sentry) { m_sentry = sentry; }

    // Local snapshots served to the Realtime voice tools without a round-trip.
    QString voiceToolSnapshot(const QString& tool) const;
    // One-shot Claude turn (no tool loop) for voice delegation and greetings.
    void askClaude(const QString& question, QObject* context,
                   std::function<void(const QString& answer, const QString& error)> callback);

    QVariantList pendingActions() const;
    QVariantList recentActions() const;
    bool executionEnabled() const;
    void setExecutionEnabled(bool enabled);
    Q_INVOKABLE void approveAction(const QString& id);
    Q_INVOKABLE void rejectAction(const QString& id);

signals:
    void configuredChanged();
    void busyChanged();
    void speakingChanged();
    void actionsChanged();
    void executionEnabledChanged();
    void replyReceived(const QString& text, const QString& model, int latencyMs);
    void chatFailed(const QString& error);
    // Streaming (Anthropic path). replyStarted opens a turn, replyDelta
    // appends text, replyReceived still closes it with the full text.
    void replyStarted();
    void replyDelta(const QString& text);
    void thinkingDelta(const QString& text);
    // Session-cumulative, cost is a family-table estimate in USD.
    void usageUpdated(int inputTokens, int outputTokens, double estCostUsd);

private:
    void post(const QString& userMessage, const QVariantList& history,
              bool allowInternet, bool allowAgent);
    void postLocal(const QString& userMessage, const QVariantList& history,
                   bool allowAgent);
    void runLocalTurn(const QJsonArray& messages, bool allowAgent,
                      int loop, qint64 started);
    QJsonArray localTools() const;
    // Tool loop: runs the request, executes read-only tool calls, re-posts up
    // to kMaxToolLoops times; queues any mutating proposals.
    void runAgentTurn(const QJsonArray& input, bool allowInternet, int loop, qint64 started);
    QJsonArray agentTools() const;
    // Anthropic path (streaming; used whenever the Anthropic key exists).
    void postAnthropic(const QString& userMessage, const QVariantList& history,
                       bool allowInternet, bool allowAgent);
    void runAnthropicTurn(const QJsonArray& messages, bool allowInternet, bool allowAgent,
                          int loop, qint64 started);
    QJsonArray anthropicTools() const;
    QString anthropicKey() const;
    QString executeReadOnlyTool(const QString& name, const QJsonObject& args, bool& handled);
    void queueAction(const QString& name, const QJsonObject& args);
    QVariantMap evaluatePolicy(const QVariantMap& action) const;
    void persistActions();
    void loadActions();
    QString workspaceRoot() const;
    bool resolveInWorkspace(const QString& rel, QString& absOut) const;

    QString apiKey() const;
    QVariantMap config() const;
    QString buildContextBlock() const;
    void setBusy(bool busy);
    void probeLocalBackend();
    void classifyLocalContent(const QJsonArray& content, QObject* context,
                              ClassifyCallback callback);

    static constexpr int kMaxToolLoops = 3;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    HttpClient* m_http = nullptr;
    WeatherService* m_weather = nullptr;
    StocksModel* m_stocks = nullptr;
    NewsService* m_news = nullptr;
    WorkstationClient* m_workstation = nullptr;
    AnthropicClient* m_anthropic = nullptr;
    ModelResolver* m_modelResolver = nullptr;
    StarvisState* m_state = nullptr;
    VoiceSession* m_voice = nullptr;
    SentryService* m_sentry = nullptr;
    SpeechService* m_speech = nullptr;
    QNetworkReply* m_activeStream = nullptr;
    QString m_pendingText;      // streamed text of the in-flight turn
    int m_turnInputTokens = 0;  // usage of the current message, folded into…
    int m_turnOutputTokens = 0;
    qint64 m_sessionInputTokens = 0;  // …session totals when the turn ends
    qint64 m_sessionOutputTokens = 0;
    bool m_busy = false;
    bool m_localBackendReady = false;
    QMediaPlayer* m_ttsPlayer = nullptr;
    QAudioOutput* m_ttsAudio = nullptr;
    QVariantList m_actions; // newest first; each: {id,type,summary,detail,status,verdict,reason,severity}
};

} // namespace qtpanel
