#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QVariantList>

class QAudioOutput;
class QMediaPlayer;

namespace qtpanel {

class HttpClient;
class NewsService;
class SecretVault;
class SettingsStore;
class StocksModel;
class WeatherService;
class WorkstationClient;

// Native Starvis chat, briefing, speech, context injection, and gated agent
// actions against the OpenAI Responses API.
class StarvisService : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool configured READ configured NOTIFY configuredChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(bool speaking READ speaking NOTIFY speakingChanged)
    Q_PROPERTY(QString model READ model NOTIFY configuredChanged)
    Q_PROPERTY(QVariantList pendingActions READ pendingActions NOTIFY actionsChanged)
    Q_PROPERTY(QVariantList recentActions READ recentActions NOTIFY actionsChanged)
    Q_PROPERTY(bool executionEnabled READ executionEnabled WRITE setExecutionEnabled NOTIFY executionEnabledChanged)

public:
    StarvisService(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                   WeatherService* weather, StocksModel* stocks,
                   NewsService* news, WorkstationClient* workstation,
                   QObject* parent = nullptr);

    bool configured() const;
    bool busy() const { return m_busy; }
    QString model() const;

    // history: [{role: "user"|"assistant", text: string}, ...]
    bool speaking() const;

    // allowAgent enables the tool loop (read-only workspace tools + web search
    // + action proposals). Mutating proposals go to the approval queue.
    Q_INVOKABLE void chat(const QString& message, const QVariantList& history,
                          bool allowInternet = false, bool allowAgent = false);
    Q_INVOKABLE void briefing();
    Q_INVOKABLE void speak(const QString& text);
    Q_INVOKABLE void stopSpeaking();

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

private:
    void post(const QString& userMessage, const QVariantList& history,
              bool allowInternet, bool allowAgent);
    // Tool loop: runs the request, executes read-only tool calls, re-posts up
    // to kMaxToolLoops times; queues any mutating proposals.
    void runAgentTurn(const QJsonArray& input, bool allowInternet, int loop, qint64 started);
    QJsonArray agentTools() const;
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

    static constexpr int kMaxToolLoops = 3;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    HttpClient* m_http = nullptr;
    WeatherService* m_weather = nullptr;
    StocksModel* m_stocks = nullptr;
    NewsService* m_news = nullptr;
    WorkstationClient* m_workstation = nullptr;
    bool m_busy = false;
    QMediaPlayer* m_ttsPlayer = nullptr;
    QAudioOutput* m_ttsAudio = nullptr;
    QVariantList m_actions; // newest first; each: {id,type,summary,detail,status,verdict,reason,severity}
};

} // namespace qtpanel
