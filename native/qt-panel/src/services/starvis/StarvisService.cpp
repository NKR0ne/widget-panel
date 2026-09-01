#include "StarvisService.h"

#include "AnthropicClient.h"
#include "ModelResolver.h"
#include "backends/BackendOperation.h"
#include "backends/OpenAiCompatibleLLMBackend.h"
#include "backends/OpenAiCompatibleTTSBackend.h"
#include "backends/OpenAiCompatibleVisionBackend.h"
#include "SentryService.h"
#include "StarvisState.h"
#include "VoiceSession.h"
#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"
#include "core/SpeechService.h"
#include "services/news/NewsService.h"
#include "services/stocks/StocksModel.h"
#include "services/weather/WeatherService.h"
#include "services/workstation/WorkstationClient.h"

#include <QAudioOutput>
#include <QAudioDevice>
#include <QCoreApplication>
#include <QDateTime>
#include <QDebug>
#include <QDesktopServices>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMediaPlayer>
#include <QMediaDevices>
#include <QNetworkReply>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTimer>
#include <QUrl>
#include <QUuid>
#include <QtEndian>

#include <memory>

#ifdef Q_OS_WIN
#include <windows.h>
#include <mmsystem.h>
#endif

namespace qtpanel {

namespace {

const char kDefaultModel[] = "gpt-5.6-terra";
const char kDefaultFrontierModel[] = "gpt-5.6-sol";
const char kDefaultBaseUrl[] = "https://api.openai.com/v1";

// STARVIS_SYSTEM_PROMPT from main.js; native agent tools are appended per request.
const char kSystemPrompt[] =
    "You are Starvis, an embedded assistant inside the Widget Panel desktop app.\n"
    "Default behavior is ChatGPT-like: answer naturally, reason clearly, and adapt to the user. "
    "Avoid theatrical command-center roleplay unless the user asks for that style.\n"
    "Be concise by default, but give complete technical answers when the task requires detail.\n"
    "Use supplied local widget-panel context when relevant. Treat it as a bounded local snapshot, "
    "not full filesystem or renderer access.\n"
    "For dashboard/report requests, synthesize. Do not dump every metric or headline unless asked.\n"
    "For news, group related headlines into themes and implications; mention only the most "
    "important examples.\n"
    "If the user asks for current, live, scheduled, price, weather, sports, news, or other "
    "time-sensitive data that is not present in local context and web search is disabled, reply "
    "exactly: INTERNET_PERMISSION_REQUEST: I need web access to check that live data. "
    "May I fetch it?";

// Port of extractResponseText(): first output_text inside a message item.
QString extractResponseText(const QJsonObject& payload)
{
    const QJsonArray output = payload.value(QLatin1String("output")).toArray();
    for (const QJsonValue& itemValue : output) {
        const QJsonObject item = itemValue.toObject();
        if (item.value(QLatin1String("type")).toString() != QLatin1String("message"))
            continue;
        const QJsonArray content = item.value(QLatin1String("content")).toArray();
        for (const QJsonValue& partValue : content) {
            const QJsonObject part = partValue.toObject();
            if (part.value(QLatin1String("type")).toString() == QLatin1String("output_text"))
                return part.value(QLatin1String("text")).toString();
        }
    }
    return {};
}

bool supportsTemperature(const QString& model)
{
    // Reasoning model families reject the temperature parameter.
    return !(model.startsWith(QLatin1String("gpt-5"))
             || model.startsWith(QLatin1String("o1"))
             || model.startsWith(QLatin1String("o3"))
             || model.startsWith(QLatin1String("o4")));
}

bool isLocalBaseUrl(const QString& value)
{
    const QUrl url(value);
    const QString host = url.host().toLower();
    return host == QLatin1String("127.0.0.1")
        || host == QLatin1String("localhost")
        || host == QLatin1String("::1");
}

// One place for the trailing-slash-tolerant base URL (was three copies).
QString normalizedOpenAiBaseUrl(const QVariantMap& cfg)
{
    QString url = cfg.value(QStringLiteral("baseUrl")).toString().trimmed();
    if (url.isEmpty())
        url = QLatin1String(kDefaultBaseUrl);
    while (url.endsWith(QLatin1Char('/')))
        url.chop(1);
    return url;
}

QImage scaledVisionImage(const QImage& source, int maxDim = 1280)
{
    if (source.isNull())
        return {};
    if (source.width() <= maxDim && source.height() <= maxDim)
        return source;
    return source.scaled(maxDim, maxDim, Qt::KeepAspectRatio, Qt::SmoothTransformation);
}

QString textForSpeech(QString text)
{
    text.replace(QStringLiteral("\r\n"), QStringLiteral("\n"));
    text.replace(QRegularExpression(QStringLiteral("```[\\s\\S]*?```")), QStringLiteral(" "));
    text.replace(QRegularExpression(QStringLiteral("!\\[([^\\]]*)\\]\\([^\\)]*\\)")),
                 QStringLiteral("\\1"));
    text.replace(QRegularExpression(QStringLiteral("\\[([^\\]]+)\\]\\([^\\)]*\\)")),
                 QStringLiteral("\\1"));
    text.replace(QRegularExpression(QStringLiteral("https?://\\S+"),
                                    QRegularExpression::CaseInsensitiveOption),
                 QStringLiteral(" "));
    text.replace(QRegularExpression(QStringLiteral("`([^`]*)`")), QStringLiteral("\\1"));
    text.replace(QRegularExpression(QStringLiteral("(?m)^\\s{0,3}#{1,6}\\s*")),
                 QString());
    text.replace(QRegularExpression(QStringLiteral("(?m)^\\s*(?:[-*+]|•)\\s+")),
                 QString());
    text.replace(QRegularExpression(QStringLiteral("(?m)^\\s*\\d+[.)]\\s+")),
                 QString());
    text.replace(QRegularExpression(QStringLiteral("<[^>]+>")), QStringLiteral(" "));

    text.replace(QRegularExpression(QStringLiteral("(-?\\d+(?:[.,]\\d+)?)\\s*°\\s*C\\b"),
                                    QRegularExpression::CaseInsensitiveOption),
                 QStringLiteral("\\1 degrés Celsius"));
    text.replace(QRegularExpression(QStringLiteral("(-?\\d+(?:[.,]\\d+)?)\\s*%")),
                 QStringLiteral("\\1 pour cent"));
    text.replace(QRegularExpression(QStringLiteral("\\$\\s*(\\d+(?:[.,]\\d+)?)")),
                 QStringLiteral("\\1 dollars"));
    text.replace(QRegularExpression(QStringLiteral("(\\d+(?:[.,]\\d+)?)\\s*\\$")),
                 QStringLiteral("\\1 dollars"));
    text.replace(QRegularExpression(QStringLiteral("(\\d+(?:[.,]\\d+)?)\\s*€")),
                 QStringLiteral("\\1 euros"));
    text.replace(QStringLiteral("&"), QStringLiteral(" et "));
    text.replace(QStringLiteral("↑"), QStringLiteral(" en hausse "));
    text.replace(QStringLiteral("↓"), QStringLiteral(" en baisse "));
    text.replace(QRegularExpression(QStringLiteral("\\s+[|/]\\s+")), QStringLiteral(", "));
    text.replace(QRegularExpression(QStringLiteral("[*_~]+")), QString());
    text.replace(QRegularExpression(QStringLiteral("[{}\\[\\]<>|]")), QStringLiteral(" "));
    text.replace(QRegularExpression(QStringLiteral("[\\p{So}\\p{Sk}\\x{FE0F}]")),
                 QStringLiteral(" "));
    text.replace(QRegularExpression(QStringLiteral("[ \\t]+")), QStringLiteral(" "));
    text.replace(QRegularExpression(QStringLiteral(" *\\n+ *")), QStringLiteral(". "));
    text.replace(QRegularExpression(QStringLiteral("(?:[.?!,:;]\\s*){2,}")),
                 QStringLiteral(". "));
    return text.trimmed();
}

} // namespace

StarvisService::StarvisService(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                               WeatherService* weather, StocksModel* stocks,
                               NewsService* news, WorkstationClient* workstation,
                               SpeechService* speech, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_http(http)
    , m_weather(weather)
    , m_stocks(stocks)
    , m_news(news)
    , m_workstation(workstation)
    , m_speech(speech)
{
    m_anthropic = new AnthropicClient(settings, vault, http, this);
    m_modelResolver = new ModelResolver(settings, vault, http, this);
    m_localLlmBackend = new OpenAiCompatibleLLMBackend(http, this);
    m_localVisionBackend = new OpenAiCompatibleVisionBackend(this);
    m_ttsBackend = new OpenAiCompatibleTTSBackend(this);
    m_state = new StarvisState(this);
    m_voice = new VoiceSession(settings, vault, this, this);
    connect(m_voice, &VoiceSession::cloudUsageIncurred, this,
            &StarvisService::recordCloudCharge);
    connect(m_modelResolver, &ModelResolver::modelChanged,
            this, &StarvisService::configuredChanged);
    connect(this, &StarvisService::busyChanged, m_state,
            [this] { m_state->setReasoning(m_busy); });
    connect(this, &StarvisService::speakingChanged, m_state,
            [this] { m_state->setSpeaking(speaking()); });
    connect(this, &StarvisService::replyDelta, m_state,
            [this](const QString& text) { m_state->noteTextDelta(text.size()); });
    connect(this, &StarvisService::usageUpdated, m_state, &StarvisState::setUsage);

    loadActions();
    m_lastProvider = provider();
    setProperty("starvisLocalTtsEngine",
                voiceConfig().value(QStringLiteral("localTtsEngine"),
                                    QStringLiteral("piper")).toString().trimmed().toLower());
    connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
        if (key == QLatin1String("starvis-openai-key")
            || key == QLatin1String("starvis-anthropic-key")
            || key == QLatin1String("starvis-groq-key"))
            emit configuredChanged();
    });
    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key == QLatin1String("wp-starvis-config")
            || key == QLatin1String("wp-starvis-provider")) {
            emit configuredChanged();
            probeLocalBackend();
            const QString selected = provider();
            if (selected != m_lastProvider) {
                m_lastProvider = selected;
                if (localModelsEnabled() && !m_localModelsTransitioning) {
                    m_localModelsTransitioning = true;
                    emit localModelsStateChanged();
                    runLocalRuntimeAction(true);
                }
            }
        } else if (key == QLatin1String("wp-starvis-voice")) {
            const QString selectedEngine = voiceConfig()
                .value(QStringLiteral("localTtsEngine"), QStringLiteral("piper"))
                .toString().trimmed().toLower();
            const QString previousEngine = property("starvisLocalTtsEngine").toString();
            if (selectedEngine != previousEngine) {
                setProperty("starvisLocalTtsEngine", selectedEngine);
                if (localModelsEnabled() && !m_localModelsTransitioning) {
                    stopSpeaking();
                    m_localTtsReady = false;
                    m_localModelsTransitioning = true;
                    emit localModelsStateChanged();
                    runLocalRuntimeAction(true);
                }
            }
        }
    });
    auto* healthTimer = new QTimer(this);
    healthTimer->setInterval(10000);
    connect(healthTimer, &QTimer::timeout, this, &StarvisService::probeLocalBackend);
    healthTimer->start();
    QTimer::singleShot(0, this, &StarvisService::probeLocalBackend);
    QTimer::singleShot(1500, this, [this] {
        if (!localModelsEnabled() && !m_localModelsTransitioning) {
            m_localModelsTransitioning = true;
            emit localModelsStateChanged();
            runLocalRuntimeAction(false);
        } else if (localModelsEnabled() && provider() != QLatin1String("local")
                   && !m_localModelsTransitioning) {
            m_localModelsTransitioning = true;
            emit localModelsStateChanged();
            runLocalRuntimeAction(true);
        }
    });
    qInfo() << "[starvis]" << (configured()
                                   ? QStringLiteral("configured (%1), model: %2")
                                         .arg(provider(), model())
                                   : QStringLiteral("no API key stored"));
}

QString StarvisService::apiKey() const
{
    return m_vault->get(QStringLiteral("starvis-openai-key")).trimmed();
}

QString StarvisService::anthropicKey() const
{
    return m_vault->get(QStringLiteral("starvis-anthropic-key")).trimmed();
}

QString StarvisService::groqKey() const
{
    return m_vault->get(QStringLiteral("starvis-groq-key")).trimmed();
}

bool StarvisService::configured() const
{
    return provider() == QLatin1String("local")
        || !anthropicKey().isEmpty() || !apiKey().isEmpty();
}

bool StarvisService::localModelsEnabled() const
{
    return m_settings->get(QStringLiteral("wp-starvis-local-models-enabled"), true).toBool();
}

QString StarvisService::localRuntimeScriptPath() const
{
    const QDir appDir(QCoreApplication::applicationDirPath());
    const QStringList candidates{
        appDir.filePath(QStringLiteral("scripts/set-starvis-local-models.ps1")),
        appDir.filePath(QStringLiteral("../../scripts/set-starvis-local-models.ps1")),
    };
    for (const QString& candidate : candidates) {
        const QFileInfo file(candidate);
        if (file.isFile())
            return file.absoluteFilePath();
    }
    return {};
}

void StarvisService::setLocalModelsEnabled(bool enabled)
{
    if (localModelsEnabled() == enabled || m_localModelsTransitioning)
        return;

    m_settings->set(QStringLiteral("wp-starvis-local-models-enabled"), enabled);
    m_settings->flush();
    m_localModelsTransitioning = true;
    emit localModelsStateChanged();

    if (!enabled) {
        cancelChat();
        setBusy(false);
        stopSpeaking();
        if (m_voice)
            m_voice->stop();
        if (m_localBackendReady || m_localVisionReady || m_localAsrReady || m_localTtsReady) {
            m_localBackendReady = m_localVisionReady = m_localAsrReady = m_localTtsReady = false;
            emit configuredChanged();
        }
    }

    runLocalRuntimeAction(enabled);
}

void StarvisService::runLocalRuntimeAction(bool enabled)
{
    const QString script = localRuntimeScriptPath();
    if (script.isEmpty()) {
        qWarning() << "[starvis] local model runtime control script was not found";
        m_localModelsTransitioning = false;
        emit localModelsStateChanged();
        emit chatFailed(QStringLiteral("Contrôle des modèles locaux introuvable."));
        return;
    }

    auto* process = new QProcess(this);
    process->setProcessChannelMode(QProcess::MergedChannels);
    connect(process, &QProcess::finished, this,
            [this, process, enabled](int exitCode, QProcess::ExitStatus status) {
        const QString output = QString::fromLocal8Bit(process->readAll()).trimmed();
        process->deleteLater();
        m_localModelsTransitioning = false;
        emit localModelsStateChanged();
        if (status != QProcess::NormalExit || exitCode != 0) {
            qWarning() << "[starvis] local model runtime action failed:" << output;
            emit chatFailed(enabled
                ? QStringLiteral("Le démarrage des modèles locaux a échoué.")
                : QStringLiteral("L'arrêt des modèles locaux a échoué."));
            return;
        }
        qInfo() << "[starvis] local models" << (enabled ? "enabled" : "disabled")
                << output;
        if (enabled)
            QTimer::singleShot(250, this, &StarvisService::probeLocalBackend);
        else
            emit configuredChanged();
    });
    QStringList arguments{QStringLiteral("-NoProfile"), QStringLiteral("-WindowStyle"),
                          QStringLiteral("Hidden"), QStringLiteral("-ExecutionPolicy"),
                          QStringLiteral("Bypass"), QStringLiteral("-File"), script,
                          enabled ? QStringLiteral("enable") : QStringLiteral("disable")};
    if (enabled)
        arguments << (provider() == QLatin1String("local")
                          ? QStringLiteral("all") : QStringLiteral("hybrid"));
    process->start(QStringLiteral("powershell.exe"), arguments);
    if (!process->waitForStarted(3000)) {
        qWarning() << "[starvis] could not start local model runtime action:"
                   << process->errorString();
        process->deleteLater();
        m_localModelsTransitioning = false;
        emit localModelsStateChanged();
        emit chatFailed(QStringLiteral("Impossible de lancer le contrôle des modèles locaux."));
    }
}

QString StarvisService::provider() const
{
    const QVariantMap cfg = config();
    const QString selected = cfg.value(QStringLiteral("provider")).toString().trimmed().toLower();
    if (selected == QLatin1String("local")
        || (selected.isEmpty() && isLocalBaseUrl(normalizedOpenAiBaseUrl(cfg))))
        return QStringLiteral("local");
    if (selected == QLatin1String("openai"))
        return QStringLiteral("openai");
    return anthropicKey().isEmpty() ? QStringLiteral("openai") : QStringLiteral("anthropic");
}

QVariantMap StarvisService::providerStatus() const
{
    const QString activeProvider = provider();
    const bool local = activeProvider == QLatin1String("local");
    const QString configuredSpeech = voiceConfig().value(QStringLiteral("speechProvider"),
                                                          QStringLiteral("local"))
                                         .toString().trimmed().toLower();
    const QString speechProvider = configuredSpeech == QLatin1String("openai")
        && !apiKey().isEmpty() ? QStringLiteral("openai")
        : configuredSpeech == QLatin1String("windows") ? QStringLiteral("windows")
                                                       : QStringLiteral("local");
    const bool reasoningReady = local ? localModelsEnabled() && m_localBackendReady
        : activeProvider == QLatin1String("anthropic") ? !anthropicKey().isEmpty()
                                                        : !apiKey().isEmpty();
    const QVariantMap usage = cloudUsage();
    const double budget = qBound(1.0,
        config().value(QStringLiteral("monthlyBudgetUsd"), 25.0).toDouble(), 10000.0);
    const QString voiceProvider = m_voice ? m_voice->provider() : QStringLiteral("none");
    return {
        {QStringLiteral("provider"), activeProvider},
        {QStringLiteral("model"), model()},
        {QStringLiteral("ready"), reasoningReady},
        {QStringLiteral("reasoningReady"), reasoningReady},
        {QStringLiteral("localModelsEnabled"), localModelsEnabled()},
        {QStringLiteral("localModelsTransitioning"), m_localModelsTransitioning},
        {QStringLiteral("visionReady"), visionConfigured()},
        {QStringLiteral("asrReady"), voiceProvider == QLatin1String("groq")
             ? !groqKey().isEmpty() : localModelsEnabled() && m_localAsrReady},
        {QStringLiteral("ttsReady"), speechProvider != QLatin1String("local")
             || (localModelsEnabled() && m_localTtsReady)},
        {QStringLiteral("speechProvider"), speechProvider},
        {QStringLiteral("voiceProvider"), voiceProvider},
        {QStringLiteral("realtimeVoiceReady"), m_voice && m_voice->available()},
        {QStringLiteral("contextWindow"), local ? 8192 : 0},
        {QStringLiteral("localMultimodal"), false},
        {QStringLiteral("endpoint"), normalizedOpenAiBaseUrl(config())},
        {QStringLiteral("visionEndpoint"), config().value(QStringLiteral("visionBaseUrl"),
             QStringLiteral("http://127.0.0.1:1236/v1"))},
        {QStringLiteral("asrEndpoint"), voiceConfig().value(QStringLiteral("asrEndpoint"),
             QStringLiteral("http://127.0.0.1:1235/v1"))},
        {QStringLiteral("ttsEndpoint"), voiceConfig().value(QStringLiteral("ttsEndpoint"),
             QStringLiteral("http://127.0.0.1:1237/v1"))},
        {QStringLiteral("pinned"), m_modelResolver->pinned()},
        {QStringLiteral("resolvedAt"), m_modelResolver->resolvedAt()},
        {QStringLiteral("monthlyCostUsd"), usage.value(QStringLiteral("costUsd"), 0.0)},
        {QStringLiteral("monthlyBudgetUsd"), budget},
        {QStringLiteral("budgetAvailable"), usage.value(QStringLiteral("costUsd"), 0.0).toDouble()
             < budget},
        {QStringLiteral("terraRequests"), usage.value(QStringLiteral("terraRequests"), 0)},
        {QStringLiteral("solRequests"), usage.value(QStringLiteral("solRequests"), 0)},
    };
}

void StarvisService::refreshModel()
{
    if (provider() == QLatin1String("local"))
        probeLocalBackend();
    else if (provider() == QLatin1String("anthropic"))
        m_modelResolver->refreshNow();
    else
        emit configuredChanged();
}

QVariantMap StarvisService::config() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-config"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {};
}

QVariantMap StarvisService::cloudUsage() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-cloud-usage"));
    QVariantMap usage;
    if (raw.metaType().id() == QMetaType::QString)
        usage = QJsonDocument::fromJson(raw.toString().toUtf8()).object().toVariantMap();
    else if (raw.canConvert<QVariantMap>())
        usage = raw.toMap();
    const QString month = QDate::currentDate().toString(QStringLiteral("yyyy-MM"));
    if (usage.value(QStringLiteral("month")).toString() != month)
        return {{QStringLiteral("month"), month}};
    return usage;
}

bool StarvisService::cloudBudgetAvailable() const
{
    const double limit = qBound(1.0,
        config().value(QStringLiteral("monthlyBudgetUsd"), 25.0).toDouble(), 10000.0);
    return cloudUsage().value(QStringLiteral("costUsd"), 0.0).toDouble() < limit;
}

QString StarvisService::selectOpenAiModel(const QString& message, bool allowInternet,
                                          bool allowAgent) const
{
    const QVariantMap cfg = config();
    const QString routine = cfg.value(QStringLiteral("routineModel"),
                                      QStringLiteral("gpt-5.6-terra")).toString().trimmed();
    const QString frontier = cfg.value(QStringLiteral("frontierModel"),
                                       QStringLiteral("gpt-5.6-sol")).toString().trimmed();
    const QString routing = cfg.value(QStringLiteral("routingMode"),
                                      QStringLiteral("automatic")).toString().trimmed().toLower();
    if (routing == QLatin1String("sol"))
        return frontier.isEmpty() ? QLatin1String(kDefaultFrontierModel) : frontier;
    if (routing == QLatin1String("terra"))
        return routine.isEmpty() ? QLatin1String(kDefaultModel) : routine;

    const QString lower = message.toLower();
    static const QStringList difficultSignals{
        QStringLiteral("analyse approfondie"), QStringLiteral("deep analysis"),
        QStringLiteral("architecture"), QStringLiteral("diagnosti"),
        QStringLiteral("sécurité"), QStringLiteral("security"),
        QStringLiteral("confidentialité"), QStringLiteral("privacy"),
        QStringLiteral("compare"), QStringLiteral("évalue"), QStringLiteral("evaluate"),
        QStringLiteral("plan détaillé"), QStringLiteral("detailed plan"),
    };
    bool difficult = message.size() >= 1200 || (allowInternet && allowAgent);
    for (const QString& signal : difficultSignals)
        difficult = difficult || lower.contains(signal);
    return difficult
        ? (frontier.isEmpty() ? QLatin1String(kDefaultFrontierModel) : frontier)
        : (routine.isEmpty() ? QLatin1String(kDefaultModel) : routine);
}

void StarvisService::recordOpenAiUsage(const QJsonObject& payload, const QString& chatModel)
{
    const QJsonObject tokens = payload.value(QStringLiteral("usage")).toObject();
    const qint64 input = tokens.value(QStringLiteral("input_tokens")).toInteger();
    const qint64 output = tokens.value(QStringLiteral("output_tokens")).toInteger();
    if (input <= 0 && output <= 0)
        return;

    double inputUsd = 0.0;
    double outputUsd = 0.0;
    ModelResolver::costPerMTok(chatModel, inputUsd, outputUsd);

    QVariantMap usage = cloudUsage();
    usage.insert(QStringLiteral("month"), QDate::currentDate().toString(QStringLiteral("yyyy-MM")));
    usage.insert(QStringLiteral("inputTokens"),
                 usage.value(QStringLiteral("inputTokens"), 0).toLongLong() + input);
    usage.insert(QStringLiteral("outputTokens"),
                 usage.value(QStringLiteral("outputTokens"), 0).toLongLong() + output);
    const double cost = usage.value(QStringLiteral("costUsd"), 0.0).toDouble()
        + input * inputUsd / 1e6 + output * outputUsd / 1e6;
    usage.insert(QStringLiteral("costUsd"), cost);
    const QString counter = chatModel.contains(QLatin1String("sol"))
        ? QStringLiteral("solRequests") : QStringLiteral("terraRequests");
    usage.insert(counter, usage.value(counter, 0).toInt() + 1);
    m_settings->set(QStringLiteral("wp-starvis-cloud-usage"),
                    QString::fromUtf8(QJsonDocument::fromVariant(usage)
                                          .toJson(QJsonDocument::Compact)));
    m_settings->flush();

    m_sessionInputTokens += input;
    m_sessionOutputTokens += output;
    emit usageUpdated(static_cast<int>(m_sessionInputTokens),
                      static_cast<int>(m_sessionOutputTokens), cost);
    emit configuredChanged();
}

void StarvisService::recordCloudCharge(double costUsd, const QString& counter, qint64 units)
{
    if (costUsd <= 0.0 || units <= 0)
        return;
    QVariantMap usage = cloudUsage();
    usage.insert(QStringLiteral("month"), QDate::currentDate().toString(QStringLiteral("yyyy-MM")));
    usage.insert(QStringLiteral("costUsd"),
                 usage.value(QStringLiteral("costUsd"), 0.0).toDouble() + costUsd);
    usage.insert(counter, usage.value(counter, 0).toLongLong() + units);
    m_settings->set(QStringLiteral("wp-starvis-cloud-usage"),
                    QString::fromUtf8(QJsonDocument::fromVariant(usage)
                                          .toJson(QJsonDocument::Compact)));
    m_settings->flush();
    emit configuredChanged();
}

QString StarvisService::model() const
{
    if (provider() == QLatin1String("anthropic"))
        return m_modelResolver->currentModel();
    const QString stored = config().value(QStringLiteral("model")).toString().trimmed();
    if (!stored.isEmpty())
        return stored;
    if (provider() == QLatin1String("local"))
        return QStringLiteral("starvis-local");
    return QLatin1String(kDefaultModel);
}

QString StarvisService::buildContextBlock() const
{
    QStringList lines;
    lines << QStringLiteral("Local widget-panel context snapshot (%1):")
                 .arg(QDateTime::currentDateTime().toString(Qt::ISODate));

    if (m_weather && m_weather->ready()) {
        const QVariantMap current = m_weather->current();
        lines << QStringLiteral("- Weather %1: %2°C (feels %3°C), %4, humidity %5%, wind %6 km/h")
                     .arg(m_weather->locationName())
                     .arg(qRound(current.value(QStringLiteral("tempC")).toDouble()))
                     .arg(qRound(current.value(QStringLiteral("apparentC")).toDouble()))
                     .arg(current.value(QStringLiteral("label")).toString())
                     .arg(qRound(current.value(QStringLiteral("humidityPct")).toDouble()))
                     .arg(qRound(current.value(QStringLiteral("windKmh")).toDouble()));
    }

    if (m_stocks && m_stocks->rowCount() > 0) {
        QStringList quotes;
        for (int i = 0; i < m_stocks->rowCount(); ++i) {
            const QModelIndex idx = m_stocks->index(i);
            if (!m_stocks->data(idx, StocksModel::HasDataRole).toBool())
                continue;
            quotes << QStringLiteral("%1 %2 (%3%4%)")
                          .arg(m_stocks->data(idx, StocksModel::DisplayRole).toString())
                          .arg(m_stocks->data(idx, StocksModel::PriceRole).toDouble(), 0, 'f', 1)
                          .arg(m_stocks->data(idx, StocksModel::UpRole).toBool()
                                   ? QStringLiteral("+") : QString())
                          .arg(m_stocks->data(idx, StocksModel::PctRole).toDouble(), 0, 'f', 2);
        }
        if (!quotes.isEmpty())
            lines << QStringLiteral("- Markets: ") + quotes.join(QStringLiteral(" | "));
    }

    if (m_workstation && m_workstation->connected()) {
        const QVariantMap snap = m_workstation->snapshot();
        const QVariantMap cpu = snap.value(QStringLiteral("cpu")).toMap();
        const QVariantMap gpu = snap.value(QStringLiteral("gpu")).toMap();
        const QVariantMap ram = snap.value(QStringLiteral("ram")).toMap();
        lines << QStringLiteral("- Workstation: CPU %1%% %2C | GPU %3%% %4C | RAM %5%%")
                     .arg(qRound(cpu.value(QStringLiteral("usagePct")).toDouble()))
                     .arg(qRound(cpu.value(QStringLiteral("temperatureC")).toDouble()))
                     .arg(qRound(gpu.value(QStringLiteral("usagePct")).toDouble()))
                     .arg(qRound(gpu.value(QStringLiteral("temperatureC")).toDouble()))
                     .arg(qRound(ram.value(QStringLiteral("usedPct")).toDouble()));
    }

    if (m_news) {
        int categoriesIncluded = 0;
        for (const QVariant& labelVar : m_news->categories()) {
            if (categoriesIncluded >= 5)
                break;
            const QString label = labelVar.toString();
            const QVariantList items = m_news->itemsFor(label);
            if (items.isEmpty())
                continue;
            QStringList headlines;
            for (int i = 0; i < items.size() && i < 3; ++i)
                headlines << items.at(i).toMap().value(QStringLiteral("title")).toString();
            lines << QStringLiteral("- News [%1]: %2").arg(label, headlines.join(QStringLiteral(" / ")));
            ++categoriesIncluded;
        }
    }

    return lines.join(QLatin1Char('\n'));
}

void StarvisService::setBusy(bool busy)
{
    if (m_busy == busy)
        return;
    m_busy = busy;
    emit busyChanged();
}

bool StarvisService::speaking() const
{
    return m_nativeSpeechPlaying
        || (m_ttsPlayer && m_ttsPlayer->playbackState() == QMediaPlayer::PlayingState);
}

void StarvisService::stopSpeaking()
{
    if (m_ttsOperation)
        m_ttsOperation->cancel();
    if (m_ttsPending) {
        m_ttsPending = false;
        emit speakingChanged();
        emit speechOutputFinished(false, QStringLiteral("cancelled"));
    }
    if (m_ttsPlayer)
        m_ttsPlayer->stop();
#ifdef Q_OS_WIN
    if (m_nativeSpeechPlaying) {
        ++m_nativeSpeechGeneration;
        PlaySoundW(nullptr, nullptr, 0);
        m_nativeSpeechPlaying = false;
        emit speakingChanged();
    }
#endif
    if (m_speech)
        m_speech->stop();
}

bool StarvisService::canSpeak() const
{
    const QString output = voiceConfig().value(QStringLiteral("speechProvider"),
                                                QStringLiteral("local")).toString();
    return output == QLatin1String("local") || !apiKey().isEmpty()
        || (m_speech && m_speech->available());
}

QVariantMap StarvisService::voiceConfig() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-voice"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {};
}

void StarvisService::fallbackSpeech(const QString& text, const QString& error)
{
    qWarning() << "[starvis] local/cloud TTS unavailable:" << error;
    const bool allowWindowsFallback = voiceConfig().value(
        QStringLiteral("windowsFallback"), false).toBool();
    if (allowWindowsFallback && m_speech && m_speech->available()) {
        m_speech->say(text);
        qInfo() << "[starvis] spoken with Windows fallback," << text.size() << "chars";
    }
    emit speechOutputFinished(false, error);
}

void StarvisService::playSpeechBytes(const QByteArray& bytes, const QString& extension)
{
    const QString path = QStandardPaths::writableLocation(QStandardPaths::TempLocation)
        + QStringLiteral("/qt-panel-tts.") + extension;
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly)) {
        m_ttsPending = false;
        emit speakingChanged();
        emit speechOutputFinished(false, QStringLiteral("temporary audio file unavailable"));
        return;
    }
    file.write(bytes);
    file.close();

#ifdef Q_OS_WIN
    if (extension.compare(QStringLiteral("wav"), Qt::CaseInsensitive) == 0
        && QMediaDevices::defaultAudioOutput().isNull()) {
        const std::wstring nativePath = QDir::toNativeSeparators(path).toStdWString();
        if (!PlaySoundW(nativePath.c_str(), nullptr,
                        SND_FILENAME | SND_ASYNC | SND_NODEFAULT)) {
            m_ttsPending = false;
            emit speakingChanged();
            emit speechOutputFinished(false, QStringLiteral("native audio playback failed"));
            return;
        }
        const quint32 byteRate = bytes.size() >= 32
            ? qFromLittleEndian<quint32>(reinterpret_cast<const uchar*>(bytes.constData() + 28))
            : 0;
        const int durationMs = byteRate > 0
            ? qBound(250, int((qint64(bytes.size()) * 1000) / byteRate) + 300, 300000)
            : 30000;
        const int generation = ++m_nativeSpeechGeneration;
        m_ttsPending = false;
        m_nativeSpeechPlaying = true;
        emit speakingChanged();
        QTimer::singleShot(durationMs, this, [this, generation] {
            if (generation != m_nativeSpeechGeneration || !m_nativeSpeechPlaying)
                return;
            m_nativeSpeechPlaying = false;
            emit speakingChanged();
            emit speechOutputFinished(true, QString());
        });
        qInfo() << "[starvis] TTS playing through native WAV fallback,"
                << bytes.size() << "bytes";
        return;
    }
#endif

    if (!m_ttsPlayer) {
        m_ttsPlayer = new QMediaPlayer(this);
        m_ttsAudio = new QAudioOutput(this);
        m_ttsAudio->setVolume(0.85f);
        m_ttsPlayer->setAudioOutput(m_ttsAudio);
        connect(m_ttsPlayer, &QMediaPlayer::playbackStateChanged, this,
                [this](QMediaPlayer::PlaybackState state) {
            emit speakingChanged();
            if (state == QMediaPlayer::StoppedState && !m_ttsPending)
                emit speechOutputFinished(true, QString());
        });
        connect(m_ttsPlayer, &QMediaPlayer::errorOccurred, this,
                [this](QMediaPlayer::Error, const QString& error) {
            emit speechOutputFinished(false, error);
        });
    }
    m_ttsPlayer->setSource(QUrl());
    m_ttsPlayer->setSource(QUrl::fromLocalFile(path));
    m_ttsPending = false;
    emit speakingChanged();
    m_ttsPlayer->play();
    qInfo() << "[starvis] TTS playing," << bytes.size() << "bytes";
}

void StarvisService::previewVoice(const QString& voice)
{
    QVariantMap cfg = voiceConfig();
    cfg.insert(QStringLiteral("ttsVoice"), voice);
    m_settings->set(QStringLiteral("wp-starvis-voice"),
                    QString::fromUtf8(QJsonDocument::fromVariant(cfg).toJson(QJsonDocument::Compact)));
    speak(QStringLiteral("Bonjour, voici ma voix."));
}

void StarvisService::speak(const QString& text)
{
    const QString clean = textForSpeech(text);
    if (clean.isEmpty())
        return;
    if (m_ttsPending || speaking()) {
        stopSpeaking();
        return;
    }

    const QVariantMap cfg = voiceConfig();
    QString output = cfg.value(QStringLiteral("speechProvider"),
                               QStringLiteral("local")).toString().trimmed().toLower();
    const QString key = apiKey();
    if (output == QLatin1String("windows")) {
        if (m_speech && m_speech->available())
            m_speech->say(clean);
        return;
    }
    if (output == QLatin1String("openai") && key.isEmpty())
        output = QStringLiteral("local");
    if (output == QLatin1String("local") && !localModelsEnabled()) {
        fallbackSpeech(clean, QStringLiteral("modèles locaux désactivés"));
        return;
    }
    if (output == QLatin1String("openai") && !cloudBudgetAvailable()) {
        fallbackSpeech(clean, QStringLiteral("budget cloud mensuel atteint"));
        return;
    }

    const QString localEngine = cfg.value(QStringLiteral("localTtsEngine"),
                                           QStringLiteral("piper"))
                                    .toString().trimmed().toLower();
    QString ttsModel = cfg.value(QStringLiteral("ttsModel")).toString().trimmed();
    if (output == QLatin1String("local"))
        ttsModel = localEngine == QLatin1String("chatterbox")
            ? QStringLiteral("chatterbox-multilingual-v3")
            : QStringLiteral("piper-fr");
    else if (ttsModel.isEmpty())
        ttsModel = QStringLiteral("gpt-4o-mini-tts");
    QString voice = cfg.value(QStringLiteral("ttsVoice")).toString().trimmed();
    if (voice.isEmpty())
        voice = output == QLatin1String("local") ? QStringLiteral("Tom")
                                                   : QStringLiteral("alloy");

    QString baseUrl;
    QString bearer;
    QString extension;
    if (output == QLatin1String("local")) {
        baseUrl = cfg.value(QStringLiteral("ttsEndpoint"),
                            QStringLiteral("http://127.0.0.1:1237/v1")).toString();
        extension = QStringLiteral("wav");
    } else {
        baseUrl = QStringLiteral("https://api.openai.com/v1");
        bearer = key;
        extension = QStringLiteral("mp3");
    }
    while (baseUrl.endsWith(QLatin1Char('/')))
        baseUrl.chop(1);

    m_ttsPending = true;
    emit speakingChanged();

    m_ttsBackend->configure(baseUrl, ttsModel, bearer, extension);
    TtsRequest request;
    request.text = clean.left(3600);
    request.voice = voice;
    request.language = cfg.value(QStringLiteral("language"), QStringLiteral("fr")).toString();
    request.stream = false;
    request.options.insert(QStringLiteral("model"), ttsModel);
    request.options.insert(QStringLiteral("responseFormat"), extension);
    request.options.insert(QStringLiteral("timeoutMs"),
                           output == QLatin1String("local") ? 30000 : 60000);
    if (output == QLatin1String("local") && localEngine == QLatin1String("chatterbox")) {
        request.options.insert(QStringLiteral("language"), request.language);
        request.options.insert(QStringLiteral("exaggeration"),
                               cfg.value(QStringLiteral("ttsExaggeration"), 0.5));
        request.options.insert(QStringLiteral("cfgWeight"),
                               cfg.value(QStringLiteral("ttsCfgWeight"), 0.5));
        request.options.insert(QStringLiteral("timeoutMs"), 120000);
    }
    const QString instructions = cfg.value(QStringLiteral("ttsInstructions")).toString();
    if (!instructions.isEmpty())
        request.options.insert(QStringLiteral("instructions"), instructions);

    BackendOperation* operation = m_ttsBackend->synthesize(request, this);
    m_ttsOperation = operation;
    connect(operation, &BackendOperation::succeeded, this,
            [this, operation, clean, extension](const QVariantMap& result) {
        if (m_ttsOperation == operation)
            m_ttsOperation = nullptr;
        operation->deleteLater();
        const QByteArray bytes = result.value(QStringLiteral("audio")).toByteArray();
        if (bytes.isEmpty()) {
            m_ttsPending = false;
            emit speakingChanged();
            fallbackSpeech(clean, QStringLiteral("empty synthesized audio"));
            return;
        }
        if (extension == QLatin1String("mp3"))
            recordCloudCharge(clean.size() * 15.0 / 1e6,
                              QStringLiteral("ttsCharacters"), clean.size());
        playSpeechBytes(bytes, extension);
    });
    connect(operation, &BackendOperation::failed, this,
            [this, operation, clean](const QString& error) {
        if (m_ttsOperation == operation)
            m_ttsOperation = nullptr;
        operation->deleteLater();
        m_ttsPending = false;
        emit speakingChanged();
        fallbackSpeech(clean, error);
    });
    connect(operation, &BackendOperation::cancelled, this, [this, operation] {
        if (m_ttsOperation == operation)
            m_ttsOperation = nullptr;
        operation->deleteLater();
        if (m_ttsPending) {
            m_ttsPending = false;
            emit speakingChanged();
            emit speechOutputFinished(false, QStringLiteral("cancelled"));
        }
    });
}

void StarvisService::chat(const QString& message, const QVariantList& history,
                          bool allowInternet, bool allowAgent)
{
    if (message.trimmed().isEmpty() || m_busy)
        return;
    if (provider() == QLatin1String("local") && !localModelsEnabled()) {
        emit chatFailed(QStringLiteral("Les modèles locaux sont désactivés."));
        return;
    }
    if (provider() == QLatin1String("local"))
        postLocal(message, history, allowAgent);
    else if (provider() == QLatin1String("anthropic"))
        postAnthropic(message, history, allowInternet, allowAgent);
    else
        post(message, history, allowInternet, allowAgent);
}

void StarvisService::probeLocalBackend()
{
    if (!localModelsEnabled()) {
        if (m_localBackendReady || m_localVisionReady || m_localAsrReady || m_localTtsReady) {
            m_localBackendReady = m_localVisionReady = m_localAsrReady = m_localTtsReady = false;
            emit configuredChanged();
        }
        return;
    }

    const QVariantMap cfg = config();
    const QVariantMap voice = voiceConfig();
    auto setReady = [this](bool& target, bool ready) {
        if (target == ready)
            return;
        target = ready;
        emit configuredChanged();
    };
    auto probeModel = [this, setReady](QString base, const QString& expected, bool* target) {
        while (base.endsWith(QLatin1Char('/')))
            base.chop(1);
        m_http->getJson(QUrl(base + QStringLiteral("/models")), this,
                        [setReady, expected, target](const QJsonDocument& doc,
                                                     const QString& error) {
            bool found = false;
            if (error.isEmpty()) {
                for (const QJsonValue& value : doc.object().value(QStringLiteral("data")).toArray())
                    found = found || value.toObject().value(QStringLiteral("id")).toString() == expected;
            }
            setReady(*target, found);
        });
    };
    auto probeHealth = [this, setReady](QString base, const QString& capability, bool* target) {
        while (base.endsWith(QLatin1Char('/')))
            base.chop(1);
        if (base.endsWith(QLatin1String("/v1")))
            base.chop(3);
        m_http->getJson(QUrl(base + QStringLiteral("/health")), this,
                        [setReady, capability, target](const QJsonDocument& doc,
                                                       const QString& error) {
            const QJsonObject body = doc.object();
            const bool healthy = error.isEmpty()
                && body.value(QStringLiteral("status")).toString() == QLatin1String("ok");
            const bool capabilityReady = body.contains(capability)
                ? body.value(capability).toBool()
                : capability == QLatin1String("asrReady");
            setReady(*target, healthy && capabilityReady);
        });
    };
    if (provider() == QLatin1String("local"))
        probeModel(normalizedOpenAiBaseUrl(cfg), model(), &m_localBackendReady);
    else
        setReady(m_localBackendReady, false);
    probeModel(cfg.value(QStringLiteral("visionBaseUrl"),
                         QStringLiteral("http://127.0.0.1:1236/v1")).toString(),
               cfg.value(QStringLiteral("visionModel"), QStringLiteral("starvis-vision")).toString(),
               &m_localVisionReady);
    probeHealth(voice.value(QStringLiteral("asrEndpoint"),
                            QStringLiteral("http://127.0.0.1:1235/v1")).toString(),
                QStringLiteral("asrReady"), &m_localAsrReady);
    probeHealth(voice.value(QStringLiteral("ttsEndpoint"),
                            QStringLiteral("http://127.0.0.1:1237/v1")).toString(),
                QStringLiteral("ttsReady"), &m_localTtsReady);
}

bool StarvisService::visionConfigured() const
{
    if (localModelsEnabled() && m_localVisionReady)
        return true;
    const bool cloudAllowed = config().value(QStringLiteral("allowCloudVision"), false).toBool();
    return cloudAllowed && m_anthropic && m_anthropic->configured();
}

void StarvisService::classifyImage(const QImage& image, const QString& prompt,
                                   QObject* context, ClassifyCallback callback)
{
    if (localModelsEnabled() && m_localVisionReady) {
        classifyLocal({scaledVisionImage(image)}, {}, prompt, context, std::move(callback));
        return;
    }
    if (config().value(QStringLiteral("allowCloudVision"), false).toBool()
        && m_anthropic && m_anthropic->configured()) {
        m_anthropic->classifyImage(image, prompt, m_modelResolver->currentModel(),
                                   context, std::move(callback));
        return;
    }
    callback({}, {}, QStringLiteral("vision provider unavailable"));
}

void StarvisService::classifyWithGallery(const QVector<QPair<QString, QImage>>& gallery,
                                         const QImage& probe, const QString& prompt,
                                         QObject* context, ClassifyCallback callback)
{
    if (localModelsEnabled() && m_localVisionReady) {
        QVector<QImage> images;
        QVector<QString> labels;
        for (const auto& entry : gallery) {
            if (entry.second.isNull())
                continue;
            images.append(scaledVisionImage(entry.second, 400));
            labels.append(QStringLiteral("Référence — ") + entry.first);
        }
        images.append(scaledVisionImage(probe));
        labels.append(QStringLiteral("Image à analyser :"));
        classifyLocal(images, labels, prompt, context, std::move(callback));
        return;
    }
    if (config().value(QStringLiteral("allowCloudVision"), false).toBool()
        && m_anthropic && m_anthropic->configured()) {
        m_anthropic->classifyWithGallery(gallery, probe, prompt,
                                         m_modelResolver->currentModel(), context,
                                         std::move(callback));
        return;
    }
    callback({}, {}, QStringLiteral("vision provider unavailable"));
}

void StarvisService::classifyLocal(const QVector<QImage>& images,
                                   const QVector<QString>& labels,
                                   const QString& prompt, QObject* context,
                                   ClassifyCallback callback)
{
    const QVariantMap cfg = config();
    const QString endpoint = cfg.value(QStringLiteral("visionBaseUrl"),
                                       QStringLiteral("http://127.0.0.1:1236/v1")).toString();
    const QString selectedModel = cfg.value(QStringLiteral("visionModel"),
                                            QStringLiteral("starvis-vision")).toString();
    m_localVisionBackend->configure(endpoint, selectedModel);
    m_localVisionBackend->setAvailable(m_localVisionReady);

    VisionRequest request;
    request.images = images;
    request.imageLabels = labels;
    request.prompt = prompt;
    request.model = selectedModel;
    request.maxTokens = 768;
    BackendOperation* operation = m_localVisionBackend->analyze(request,
                                                               context ? context : this);
    QObject* callbackContext = context ? context : this;
    auto sharedCallback = std::make_shared<ClassifyCallback>(std::move(callback));
    connect(operation, &BackendOperation::succeeded, callbackContext,
            [operation, sharedCallback](const QVariantMap& result) {
        const QString raw = result.value(QStringLiteral("text")).toString();
        (*sharedCallback)(
            QJsonObject::fromVariantMap(result.value(QStringLiteral("json")).toMap()),
            raw, QString());
        operation->deleteLater();
    });
    connect(operation, &BackendOperation::failed, callbackContext,
            [operation, sharedCallback](const QString& error) {
        (*sharedCallback)({}, {}, error);
        operation->deleteLater();
    });
    connect(operation, &BackendOperation::cancelled, callbackContext, [operation] {
        operation->deleteLater();
    });
}

void StarvisService::postLocal(const QString& userMessage, const QVariantList& history,
                               bool allowAgent)
{
    setBusy(true);
    m_turnInputTokens = 0;
    m_turnOutputTokens = 0;
    const qint64 started = QDateTime::currentMSecsSinceEpoch();

    QJsonArray messages;
    messages.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("system")},
        {QStringLiteral("content"), QLatin1String(kSystemPrompt) + QStringLiteral("\n\n")
             + buildContextBlock()},
    });
    for (const QVariant& turnVar : history) {
        const QVariantMap turn = turnVar.toMap();
        const QString text = turn.value(QStringLiteral("text")).toString().trimmed();
        if (text.isEmpty())
            continue;
        messages.append(QJsonObject{
            {QStringLiteral("role"), turn.value(QStringLiteral("role")).toString()
                 == QLatin1String("assistant") ? QStringLiteral("assistant") : QStringLiteral("user")},
            {QStringLiteral("content"), text},
        });
    }
    messages.append(QJsonObject{{QStringLiteral("role"), QStringLiteral("user")},
                                {QStringLiteral("content"), userMessage}});

    if (allowAgent)
        runLocalTurn(messages, true, 0, started);
    else
        runLocalSimpleTurn(messages, started);
}

void StarvisService::runLocalSimpleTurn(const QJsonArray& messages, qint64 started)
{
    const QVariantMap cfg = config();
    const QString chatModel = model();
    m_localLlmBackend->configure(normalizedOpenAiBaseUrl(cfg), chatModel);

    LlmRequest request;
    request.messages = messages;
    request.model = chatModel;
    request.maxTokens = qBound(128, cfg.value(QStringLiteral("maxTokens"), 1800).toInt(), 8192);
    request.temperature = cfg.value(QStringLiteral("temperature"), 0.0).toDouble();
    request.reasoning = cfg.value(QStringLiteral("reasoningEnabled"), false).toBool();

    m_pendingText.clear();
    emit replyStarted();
    BackendOperation* operation = m_localLlmBackend->generate(request, this);
    m_activeBackendOperation = operation;
    connect(operation, &BackendOperation::textDelta, this, [this](const QString& delta) {
        m_pendingText += delta;
        emit replyDelta(delta);
    });
    connect(operation, &BackendOperation::thinkingDelta,
            this, &StarvisService::thinkingDelta);
    connect(operation, &BackendOperation::succeeded, this,
            [this, operation, chatModel, started](const QVariantMap& result) {
        if (m_activeBackendOperation == operation)
            m_activeBackendOperation = nullptr;
        setBusy(false);
        m_turnInputTokens = result.value(QStringLiteral("promptTokens")).toInt();
        m_turnOutputTokens = result.value(QStringLiteral("completionTokens")).toInt();
        m_sessionInputTokens += m_turnInputTokens;
        m_sessionOutputTokens += m_turnOutputTokens;
        emit usageUpdated(static_cast<int>(m_sessionInputTokens),
                          static_cast<int>(m_sessionOutputTokens), 0.0);
        const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
        emit replyReceived(m_pendingText.isEmpty() ? QStringLiteral("Command acknowledged.")
                                                   : m_pendingText,
                           chatModel, latency);
        operation->deleteLater();
    });
    connect(operation, &BackendOperation::failed, this,
            [this, operation](const QString& error) {
        if (m_activeBackendOperation == operation)
            m_activeBackendOperation = nullptr;
        setBusy(false);
        emit chatFailed(error);
        operation->deleteLater();
    });
    connect(operation, &BackendOperation::cancelled, this, [this, operation] {
        if (m_activeBackendOperation == operation)
            m_activeBackendOperation = nullptr;
        setBusy(false);
        operation->deleteLater();
    });
}

QJsonArray StarvisService::localTools() const
{
    QJsonArray tools;
    for (const QJsonValue& value : agentTools()) {
        const QJsonObject source = value.toObject();
        tools.append(QJsonObject{
            {QStringLiteral("type"), QStringLiteral("function")},
            {QStringLiteral("function"), QJsonObject{
                {QStringLiteral("name"), source.value(QStringLiteral("name"))},
                {QStringLiteral("description"), source.value(QStringLiteral("description"))},
                {QStringLiteral("parameters"), source.value(QStringLiteral("parameters"))},
            }},
        });
    }
    return tools;
}

void StarvisService::runLocalTurn(const QJsonArray& messages, bool allowAgent,
                                  int loop, qint64 started)
{
    const QVariantMap cfg = config();
    const QString chatModel = model();
    const int maxTokens = qBound(128, cfg.value(QStringLiteral("maxTokens"), 1800).toInt(), 8192);
    const QString baseUrl = normalizedOpenAiBaseUrl(cfg);

    QJsonObject body{{QStringLiteral("model"), chatModel},
                     {QStringLiteral("messages"), messages},
                     {QStringLiteral("max_tokens"), maxTokens},
                     {QStringLiteral("chat_template_kwargs"),
                      QJsonObject{{QStringLiteral("enable_thinking"), false}}}};
    if (cfg.contains(QStringLiteral("temperature")))
        body.insert(QStringLiteral("temperature"), cfg.value(QStringLiteral("temperature")).toDouble());

    if (!allowAgent || loop >= kMaxToolLoops) {
        body.insert(QStringLiteral("stream"), true);
        body.insert(QStringLiteral("stream_options"),
                    QJsonObject{{QStringLiteral("include_usage"), true}});
        m_pendingText.clear();
        emit replyStarted();
        m_activeStream = m_http->postSse(
            QUrl(baseUrl + QStringLiteral("/chat/completions")), {},
            QJsonDocument(body).toJson(QJsonDocument::Compact), this,
            [this](const QString&, const QByteArray& data) {
            if (data == QByteArrayLiteral("[DONE]"))
                return;
            const QJsonObject payload = QJsonDocument::fromJson(data).object();
            const QJsonObject usage = payload.value(QStringLiteral("usage")).toObject();
            if (!usage.isEmpty()) {
                m_turnInputTokens = usage.value(QStringLiteral("prompt_tokens")).toInt();
                m_turnOutputTokens = usage.value(QStringLiteral("completion_tokens")).toInt();
            }
            const QJsonArray choices = payload.value(QStringLiteral("choices")).toArray();
            if (choices.isEmpty())
                return;
            const QString delta = choices.first().toObject().value(QStringLiteral("delta"))
                                      .toObject().value(QStringLiteral("content")).toString();
            if (delta.isEmpty())
                return;
            m_pendingText += delta;
            emit replyDelta(delta);
        },
            [this, chatModel, started](int status, const QString& error) {
            m_activeStream = nullptr;
            setBusy(false);
            if (error == QLatin1String("aborted"))
                return;
            if (status < 200 || status >= 300 || !error.isEmpty()) {
                emit chatFailed(error.isEmpty()
                    ? QStringLiteral("Local model request failed (%1)").arg(status) : error);
                return;
            }
            m_sessionInputTokens += m_turnInputTokens;
            m_sessionOutputTokens += m_turnOutputTokens;
            emit usageUpdated(static_cast<int>(m_sessionInputTokens),
                              static_cast<int>(m_sessionOutputTokens), 0.0);
            const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
            emit replyReceived(m_pendingText.isEmpty() ? QStringLiteral("Command acknowledged.")
                                                       : m_pendingText,
                               chatModel, latency);
        });
        return;
    }

    body.insert(QStringLiteral("stream"), false);
    body.insert(QStringLiteral("tools"), localTools());
    body.insert(QStringLiteral("tool_choice"), QStringLiteral("auto"));
    m_http->requestJsonAuth(
        "POST", QUrl(baseUrl + QStringLiteral("/chat/completions")), QString(),
        QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this, messages, allowAgent, loop, started, chatModel]
        (const QJsonDocument& doc, int status, const QString& error) {
        const QJsonObject payload = doc.object();
        if (status < 200 || status >= 300) {
            setBusy(false);
            const QString detail = payload.value(QLatin1String("error")).toObject()
                                       .value(QLatin1String("message")).toString();
            emit chatFailed(!detail.isEmpty() ? detail : !error.isEmpty() ? error
                : QStringLiteral("Local model request failed (%1)").arg(status));
            return;
        }
        const QJsonArray choices = payload.value(QLatin1String("choices")).toArray();
        if (choices.isEmpty()) {
            setBusy(false);
            emit chatFailed(QStringLiteral("Local model returned no choices."));
            return;
        }
        const QJsonObject message = choices.first().toObject()
                                        .value(QStringLiteral("message")).toObject();
        const QJsonArray calls = message.value(QStringLiteral("tool_calls")).toArray();
        if (calls.isEmpty()) {
            setBusy(false);
            const QString text = message.value(QStringLiteral("content")).toString().trimmed();
            const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
            emit replyReceived(text.isEmpty() ? QStringLiteral("Command acknowledged.") : text,
                               chatModel, latency);
            return;
        }

        QJsonArray next = messages;
        next.append(message);
        for (const QJsonValue& value : calls) {
            const QJsonObject call = value.toObject();
            const QJsonObject function = call.value(QStringLiteral("function")).toObject();
            const QString name = function.value(QStringLiteral("name")).toString();
            const QJsonObject args = QJsonDocument::fromJson(
                function.value(QStringLiteral("arguments")).toString().toUtf8()).object();
            QString output;
            if (name == QLatin1String("propose_action")) {
                queueAction(name, args);
                output = QStringLiteral("Proposed and queued for user approval.");
            } else {
                bool handled = false;
                output = executeReadOnlyTool(name, args, handled);
                if (!handled)
                    output = QStringLiteral("Unknown tool.");
            }
            qInfo() << "[starvis.local] tool" << name << "loop" << loop;
            next.append(QJsonObject{
                {QStringLiteral("role"), QStringLiteral("tool")},
                {QStringLiteral("tool_call_id"), call.value(QStringLiteral("id"))},
                {QStringLiteral("name"), name},
                {QStringLiteral("content"), output.left(8000)},
            });
        }
        runLocalTurn(next, allowAgent, loop + 1, started);
    });
}

void StarvisService::briefing()
{
    if (m_busy)
        return;
    chat(QStringLiteral(
             "Donne-moi un briefing matinal concis à partir du contexte local: météo, marchés, "
             "thèmes principaux des nouvelles, et état de la station. En français, structuré, "
             "sans détailler chaque métrique. Le texte sera lu à voix haute: 120 mots maximum, "
             "phrases naturelles, sans Markdown, listes, liens, tableaux ni symboles."),
         {}, false, false);
}

void StarvisService::cancelChat()
{
    if (m_activeBackendOperation)
        m_activeBackendOperation->cancel();
    if (m_activeStream) {
        m_activeStream->abort();
        m_activeStream = nullptr;
    }
}

void StarvisService::post(const QString& userMessage, const QVariantList& history,
                          bool allowInternet, bool allowAgent)
{
    const QString key = apiKey();
    if (key.isEmpty()) {
        emit chatFailed(QStringLiteral("Clé OpenAI absente (wp-starvis-openai-key)."));
        return;
    }
    if (!cloudBudgetAvailable()) {
        emit chatFailed(QStringLiteral(
            "Budget cloud mensuel atteint. Augmentez la limite ou utilisez le mode local."));
        return;
    }
    setBusy(true);
    const qint64 started = QDateTime::currentMSecsSinceEpoch();

    const QVariantMap cfg = config();
    const QString chatModel = selectOpenAiModel(userMessage, allowInternet, allowAgent);
    const QString baseUrl = normalizedOpenAiBaseUrl(cfg);
    const int maxTokens = qBound(128, cfg.value(QStringLiteral("maxTokens"), 1800).toInt(), 8192);

    QJsonArray input;
    input.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), QStringLiteral("Context (do not echo back):\n") + buildContextBlock()},
    });
    for (const QVariant& turnVar : history) {
        const QVariantMap turn = turnVar.toMap();
        const QString role = turn.value(QStringLiteral("role")).toString();
        const QString text = turn.value(QStringLiteral("text")).toString();
        if (text.isEmpty())
            continue;
        input.append(QJsonObject{
            {QStringLiteral("role"),
             role == QLatin1String("assistant") ? QStringLiteral("assistant") : QStringLiteral("user")},
            {QStringLiteral("content"), text},
        });
    }
    input.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), userMessage},
    });

    if (allowAgent) {
        runAgentTurn(input, allowInternet, 0, started, chatModel);
        return;
    }

    QJsonObject body{
        {QStringLiteral("model"), chatModel},
        {QStringLiteral("instructions"), QLatin1String(kSystemPrompt)},
        {QStringLiteral("input"), input},
        {QStringLiteral("max_output_tokens"), maxTokens},
        {QStringLiteral("reasoning"), QJsonObject{{QStringLiteral("effort"), QStringLiteral("medium")}}},
    };
    if (supportsTemperature(chatModel) && cfg.contains(QStringLiteral("temperature")))
        body.insert(QStringLiteral("temperature"), cfg.value(QStringLiteral("temperature")).toDouble());
    if (allowInternet) {
        body.insert(QStringLiteral("tools"), QJsonArray{
            QJsonObject{{QStringLiteral("type"), QStringLiteral("web_search_preview")}}});
    }

    m_http->requestJsonAuth(
        "POST", QUrl(baseUrl + QStringLiteral("/responses")), key,
        QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this, chatModel, started](const QJsonDocument& doc, int status, const QString& error) {
        setBusy(false);
        const QJsonObject payload = doc.object();
        if (status < 200 || status >= 300) {
            const QString detail = payload.value(QLatin1String("error")).toObject()
                                       .value(QLatin1String("message")).toString();
            const QString message = !detail.isEmpty() ? detail
                : !error.isEmpty() ? error
                : QStringLiteral("OpenAI request failed (%1)").arg(status);
            qWarning() << "[starvis] chat failed:" << status << message;
            emit chatFailed(message);
            return;
        }
        recordOpenAiUsage(payload, chatModel);
        const QString text = extractResponseText(payload);
        const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
        qInfo() << "[starvis] reply" << payload.value(QLatin1String("model")).toString()
                << latency << "ms," << text.size() << "chars";
        emit replyReceived(text.isEmpty() ? QStringLiteral("Command acknowledged.") : text,
                           payload.value(QLatin1String("model")).toString(chatModel), latency);
    });
}

QString StarvisService::voiceToolSnapshot(const QString& tool) const
{
    if (tool == QLatin1String("check_cameras")) {
        if (!m_sentry)
            return QStringLiteral("Surveillance non initialisée.");
        return m_sentry->statusSnapshot();
    }
    if (tool == QLatin1String("get_news_summary")) {
        // News lines only, without the rest of the context bus.
        QStringList lines;
        if (m_news) {
            int categoriesIncluded = 0;
            for (const QVariant& labelVar : m_news->categories()) {
                if (categoriesIncluded >= 6)
                    break;
                const QString label = labelVar.toString();
                const QVariantList items = m_news->itemsFor(label);
                if (items.isEmpty())
                    continue;
                QStringList headlines;
                for (int i = 0; i < items.size() && i < 4; ++i)
                    headlines << items.at(i).toMap().value(QStringLiteral("title")).toString();
                lines << label + QStringLiteral(": ") + headlines.join(QStringLiteral(" / "));
                ++categoriesIncluded;
            }
        }
        return lines.isEmpty() ? QStringLiteral("Aucune nouvelle disponible.")
                               : lines.join(QLatin1Char('\n'));
    }
    // daily_briefing and anything else: full local context snapshot.
    return buildContextBlock();
}

void StarvisService::askClaude(const QString& question, QObject* context,
                               std::function<void(const QString&, const QString&)> callback)
{
    if (anthropicKey().isEmpty()) {
        callback({}, QStringLiteral("Clé Anthropic absente"));
        return;
    }
    const QJsonArray messages{
        QJsonObject{
            {QStringLiteral("role"), QStringLiteral("user")},
            {QStringLiteral("content"),
             QStringLiteral("Context (do not echo back):\n") + buildContextBlock()},
        },
        QJsonObject{
            {QStringLiteral("role"), QStringLiteral("user")},
            {QStringLiteral("content"), question},
        },
    };
    auto text = std::make_shared<QString>();
    AnthropicClient::StreamCallbacks callbacks;
    callbacks.onTextDelta = [text](const QString& t) { *text += t; };
    callbacks.onFinished = [text, callback](const QJsonArray&, const QString& stopReason,
                                            const QString& error) {
        if (!error.isEmpty())
            callback({}, error);
        else if (stopReason == QLatin1String("refusal"))
            callback({}, QStringLiteral("refus du modèle"));
        else
            callback(*text, QString());
    };
    m_anthropic->streamMessage(model(), QLatin1String(kSystemPrompt), messages, {},
                               2048, context, std::move(callbacks));
}

// ── Anthropic path: streaming chat + tool loop ────────────────────────────────

QJsonArray StarvisService::anthropicTools() const
{
    // Same tool set as the OpenAI path, in Anthropic's input_schema shape.
    QJsonArray tools;
    for (const QJsonValue& v : agentTools()) {
        const QJsonObject fn = v.toObject();
        tools.append(QJsonObject{
            {QStringLiteral("name"), fn.value(QLatin1String("name"))},
            {QStringLiteral("description"), fn.value(QLatin1String("description"))},
            {QStringLiteral("input_schema"), fn.value(QLatin1String("parameters"))},
        });
    }
    return tools;
}

void StarvisService::postAnthropic(const QString& userMessage, const QVariantList& history,
                                   bool allowInternet, bool allowAgent)
{
    setBusy(true);
    m_pendingText.clear();
    m_turnInputTokens = 0;
    m_turnOutputTokens = 0;
    const qint64 started = QDateTime::currentMSecsSinceEpoch();

    QJsonArray messages;
    messages.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"),
         QStringLiteral("Context (do not echo back):\n") + buildContextBlock()},
    });
    for (const QVariant& turnVar : history) {
        const QVariantMap turn = turnVar.toMap();
        const QString role = turn.value(QStringLiteral("role")).toString();
        const QString text = turn.value(QStringLiteral("text")).toString();
        if (text.isEmpty())
            continue;
        messages.append(QJsonObject{
            {QStringLiteral("role"), role == QLatin1String("assistant")
                                         ? QStringLiteral("assistant") : QStringLiteral("user")},
            {QStringLiteral("content"), text},
        });
    }
    messages.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), userMessage},
    });

    runAnthropicTurn(messages, allowInternet, allowAgent, 0, started);
}

void StarvisService::runAnthropicTurn(const QJsonArray& messages, bool allowInternet,
                                      bool allowAgent, int loop, qint64 started)
{
    QJsonArray tools;
    if (allowAgent)
        tools = anthropicTools();
    if (allowInternet) {
        // Anthropic's server-side web search: executes during the turn, no
        // client round-trip, so it never shows up as stop_reason tool_use.
        tools.append(QJsonObject{
            {QStringLiteral("type"), QStringLiteral("web_search_20250305")},
            {QStringLiteral("name"), QStringLiteral("web_search")},
            {QStringLiteral("max_uses"), 3},
        });
    }

    QVariantMap providerCfg;
    {
        const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-provider"));
        if (raw.metaType().id() == QMetaType::QString)
            providerCfg = QJsonDocument::fromJson(raw.toString().toUtf8()).object().toVariantMap();
        else if (raw.canConvert<QVariantMap>())
            providerCfg = raw.toMap();
    }
    const int maxTokens =
        qBound(256, providerCfg.value(QStringLiteral("maxTokens"), 8192).toInt(), 32000);
    const QString chatModel = model();

    AnthropicClient::StreamCallbacks callbacks;
    callbacks.onStart = [this, loop, started] {
        if (loop == 0) {
            emit replyStarted();
            qInfo() << "[starvis.anthropic] first event after"
                    << (QDateTime::currentMSecsSinceEpoch() - started) << "ms";
        }
    };
    callbacks.onTextDelta = [this](const QString& text) {
        m_pendingText += text;
        emit replyDelta(text);
    };
    callbacks.onThinkingDelta = [this](const QString& text) {
        emit thinkingDelta(text);
    };
    callbacks.onUsage = [this, chatModel](int inputTokens, int outputTokens) {
        m_turnInputTokens = inputTokens;
        m_turnOutputTokens = outputTokens;
        double inUsd = 0, outUsd = 0;
        ModelResolver::costPerMTok(chatModel, inUsd, outUsd);
        const qint64 totalIn = m_sessionInputTokens + inputTokens;
        const qint64 totalOut = m_sessionOutputTokens + outputTokens;
        emit usageUpdated(static_cast<int>(totalIn), static_cast<int>(totalOut),
                          totalIn * inUsd / 1e6 + totalOut * outUsd / 1e6);
    };
    callbacks.onFinished = [this, messages, allowInternet, allowAgent, loop, started, chatModel]
                           (const QJsonArray& content, const QString& stopReason,
                            const QString& error) {
        m_activeStream = nullptr;
        m_sessionInputTokens += m_turnInputTokens;
        m_sessionOutputTokens += m_turnOutputTokens;
        m_turnInputTokens = 0;
        m_turnOutputTokens = 0;

        if (!error.isEmpty()) {
            setBusy(false);
            const bool cancelled = error.startsWith(QLatin1String("aborted"));
            qWarning() << "[starvis.anthropic] turn failed:" << error;
            emit chatFailed(cancelled ? QStringLiteral("Requête annulée.") : error);
            return;
        }
        if (stopReason == QLatin1String("refusal")) {
            setBusy(false);
            qWarning() << "[starvis.anthropic] refusal stop reason";
            emit chatFailed(QStringLiteral("Le modèle a refusé cette requête."));
            return;
        }

        if (stopReason == QLatin1String("tool_use") && loop < kMaxToolLoops) {
            QJsonArray toolResults;
            for (const QJsonValue& v : content) {
                const QJsonObject block = v.toObject();
                if (block.value(QLatin1String("type")).toString() != QLatin1String("tool_use"))
                    continue;
                const QString name = block.value(QLatin1String("name")).toString();
                const QJsonObject args = block.value(QLatin1String("input")).toObject();
                QString output;
                if (name == QLatin1String("propose_action")) {
                    queueAction(name, args);
                    output = QStringLiteral("Proposed and queued for user approval.");
                } else {
                    bool handled = false;
                    output = executeReadOnlyTool(name, args, handled);
                    if (!handled)
                        output = QStringLiteral("Unknown tool.");
                }
                qInfo() << "[starvis.anthropic] tool" << name << "loop" << loop;
                toolResults.append(QJsonObject{
                    {QStringLiteral("type"), QStringLiteral("tool_result")},
                    {QStringLiteral("tool_use_id"), block.value(QLatin1String("id"))},
                    {QStringLiteral("content"), output.left(8000)},
                });
            }
            // The assistant content goes back VERBATIM (thinking blocks and
            // signatures included) followed by our tool results.
            QJsonArray next = messages;
            next.append(QJsonObject{
                {QStringLiteral("role"), QStringLiteral("assistant")},
                {QStringLiteral("content"), content},
            });
            next.append(QJsonObject{
                {QStringLiteral("role"), QStringLiteral("user")},
                {QStringLiteral("content"), toolResults},
            });
            runAnthropicTurn(next, allowInternet, allowAgent, loop + 1, started);
            return;
        }

        setBusy(false);
        const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
        qInfo() << "[starvis.anthropic] reply" << chatModel << latency << "ms,"
                << m_pendingText.size() << "chars, session usage in="
                << m_sessionInputTokens << "out=" << m_sessionOutputTokens;
        emit replyReceived(m_pendingText.isEmpty() ? QStringLiteral("Command acknowledged.")
                                                   : m_pendingText,
                           chatModel, latency);
    };

    m_activeStream = m_anthropic->streamMessage(chatModel, QLatin1String(kSystemPrompt),
                                                messages, tools, maxTokens, this,
                                                std::move(callbacks));
}

// ── Agent mode: tool loop + read-only tools + action approval queue ───────────

QJsonArray StarvisService::agentTools() const
{
    auto fn = [](const char* name, const char* desc, QJsonObject props,
                 QJsonArray required) {
        return QJsonObject{
            {QStringLiteral("type"), QStringLiteral("function")},
            {QStringLiteral("name"), QLatin1String(name)},
            {QStringLiteral("description"), QLatin1String(desc)},
            {QStringLiteral("parameters"), QJsonObject{
                {QStringLiteral("type"), QStringLiteral("object")},
                {QStringLiteral("properties"), props},
                {QStringLiteral("required"), required},
            }},
        };
    };
    auto strProp = [](const char* d) {
        return QJsonObject{{QStringLiteral("type"), QStringLiteral("string")},
                           {QStringLiteral("description"), QLatin1String(d)}};
    };

    QJsonArray tools;
    tools.append(fn("ws_list", "List files in a workspace directory (read-only).",
                    {{QStringLiteral("path"), strProp("Relative directory, default '.'")}}, {}));
    tools.append(fn("ws_read", "Read a workspace text file (read-only, truncated).",
                    {{QStringLiteral("path"), strProp("Relative file path")}},
                    {QStringLiteral("path")}));
    tools.append(fn("ws_search", "Search workspace file contents (read-only).",
                    {{QStringLiteral("query"), strProp("Substring to find")}},
                    {QStringLiteral("query")}));
    tools.append(fn("git_status", "Show git status of the workspace (read-only).", {}, {}));
    tools.append(fn("git_diff", "Show git diff of the workspace (read-only).", {}, {}));
    tools.append(fn("propose_action",
                    "Propose a side-effecting action for the user to approve. NOT executed "
                    "automatically. actionType: file_edit|command|git_commit|git_push|open_url.",
                    {
                        {QStringLiteral("actionType"), strProp("file_edit|command|git_commit|git_push|open_url")},
                        {QStringLiteral("summary"), strProp("One-line human summary")},
                        {QStringLiteral("path"), strProp("Target path (file_edit)")},
                        {QStringLiteral("content"), strProp("New file content (file_edit)")},
                        {QStringLiteral("command"), strProp("Command base (command)")},
                        {QStringLiteral("args"), QJsonObject{
                            {QStringLiteral("type"), QStringLiteral("array")},
                            {QStringLiteral("items"), QJsonObject{{QStringLiteral("type"), QStringLiteral("string")}}}}},
                        {QStringLiteral("url"), strProp("URL (open_url)")},
                        {QStringLiteral("message"), strProp("Commit message (git_commit)")},
                    },
                    {QStringLiteral("actionType"), QStringLiteral("summary")}));
    return tools;
}

void StarvisService::runAgentTurn(const QJsonArray& input, bool allowInternet, int loop,
                                  qint64 started, const QString& chatModel)
{
    const QString key = apiKey();
    const QVariantMap cfg = config();
    const QString baseUrl = normalizedOpenAiBaseUrl(cfg);

    QJsonArray tools = agentTools();
    if (allowInternet)
        tools.append(QJsonObject{{QStringLiteral("type"), QStringLiteral("web_search_preview")}});

    QJsonObject body{
        {QStringLiteral("model"), chatModel},
        {QStringLiteral("instructions"), QLatin1String(kSystemPrompt)},
        {QStringLiteral("input"), input},
        {QStringLiteral("tools"), tools},
        {QStringLiteral("max_output_tokens"),
         qBound(128, cfg.value(QStringLiteral("maxTokens"), 1800).toInt(), 8192)},
        {QStringLiteral("reasoning"), QJsonObject{{QStringLiteral("effort"), QStringLiteral("medium")}}},
    };

    m_http->requestJsonAuth(
        "POST", QUrl(baseUrl + QStringLiteral("/responses")), key,
        QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this, input, allowInternet, loop, started, chatModel]
        (const QJsonDocument& doc, int status, const QString& error) {
        const QJsonObject payload = doc.object();
        if (status < 200 || status >= 300) {
            setBusy(false);
            const QString detail = payload.value(QLatin1String("error")).toObject()
                                       .value(QLatin1String("message")).toString();
            emit chatFailed(!detail.isEmpty() ? detail
                            : !error.isEmpty() ? error
                            : QStringLiteral("Agent request failed (%1)").arg(status));
            return;
        }
        recordOpenAiUsage(payload, chatModel);

        // Collect function calls from the output.
        QJsonArray nextInput = input;
        QJsonArray calls;
        for (const QJsonValue& v : payload.value(QLatin1String("output")).toArray()) {
            const QJsonObject item = v.toObject();
            if (item.value(QLatin1String("type")).toString() == QLatin1String("function_call"))
                calls.append(item);
        }

        if (!calls.isEmpty() && loop < kMaxToolLoops) {
            for (const QJsonValue& cv : calls) {
                const QJsonObject call = cv.toObject();
                const QString name = call.value(QLatin1String("name")).toString();
                const QJsonObject args = QJsonDocument::fromJson(
                    call.value(QLatin1String("arguments")).toString().toUtf8()).object();

                QString output;
                if (name == QLatin1String("propose_action")) {
                    queueAction(name, args);
                    output = QStringLiteral("Proposed and queued for user approval.");
                } else {
                    bool handled = false;
                    output = executeReadOnlyTool(name, args, handled);
                    if (!handled)
                        output = QStringLiteral("Unknown tool.");
                }
                nextInput.append(call); // echo the call back
                nextInput.append(QJsonObject{
                    {QStringLiteral("type"), QStringLiteral("function_call_output")},
                    {QStringLiteral("call_id"), call.value(QLatin1String("call_id"))},
                    {QStringLiteral("output"), output.left(8000)},
                });
            }
            if (!cloudBudgetAvailable()) {
                setBusy(false);
                emit chatFailed(QStringLiteral("Budget cloud mensuel atteint pendant l'action."));
                return;
            }
            runAgentTurn(nextInput, allowInternet, loop + 1, started, chatModel);
            return;
        }

        setBusy(false);
        const QString text = extractResponseText(payload);
        const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
        qInfo() << "[starvis] agent reply, loop" << loop << latency << "ms";
        emit replyReceived(text.isEmpty() ? QStringLiteral("Done.") : text,
                           payload.value(QLatin1String("model")).toString(chatModel), latency);
    });
}

QString StarvisService::workspaceRoot() const
{
    const QString stored = m_settings->get(QStringLiteral("wp-starvis-workspace")).toString();
    if (!stored.isEmpty())
        return stored;
    return QStringLiteral("C:/Users/nicol/source/repos/widget-panel-qt");
}

bool StarvisService::resolveInWorkspace(const QString& rel, QString& absOut) const
{
    const QDir root(workspaceRoot());
    const QString abs = QDir::cleanPath(root.absoluteFilePath(rel.isEmpty() ? QStringLiteral(".") : rel));
    const QString rootAbs = QDir::cleanPath(root.absolutePath());
    if (abs.compare(rootAbs, Qt::CaseInsensitive) != 0
        && !abs.startsWith(rootAbs + QLatin1Char('/'), Qt::CaseInsensitive))
        return false; // path traversal guard
    // Skip noisy/ignored dirs.
    static const QStringList ignore = {QStringLiteral("/.git/"), QStringLiteral("/node_modules/"),
        QStringLiteral("/build/"), QStringLiteral("/dist/"), QStringLiteral("/.vs/")};
    for (const QString& ig : ignore)
        if ((abs + QStringLiteral("/")).contains(ig))
            return false;
    absOut = abs;
    return true;
}

QString StarvisService::executeReadOnlyTool(const QString& name, const QJsonObject& args,
                                            bool& handled)
{
    handled = true;
    if (name == QLatin1String("ws_list")) {
        QString abs;
        if (!resolveInWorkspace(args.value(QLatin1String("path")).toString(), abs))
            return QStringLiteral("Path not allowed.");
        QStringList out;
        const QDir dir(abs);
        const auto entries = dir.entryInfoList(QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot,
                                               QDir::Name);
        for (const QFileInfo& fi : entries) {
            if (out.size() >= 200) break;
            out << (fi.isDir() ? fi.fileName() + QStringLiteral("/") : fi.fileName());
        }
        return out.join(QLatin1Char('\n'));
    }
    if (name == QLatin1String("ws_read")) {
        QString abs;
        if (!resolveInWorkspace(args.value(QLatin1String("path")).toString(), abs))
            return QStringLiteral("Path not allowed.");
        QFile f(abs);
        if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
            return QStringLiteral("Cannot read file.");
        return QString::fromUtf8(f.read(16000));
    }
    if (name == QLatin1String("ws_search")) {
        const QString query = args.value(QLatin1String("query")).toString();
        if (query.isEmpty())
            return QStringLiteral("Empty query.");
        QStringList hits;
        QDirIterator it(workspaceRoot(),
                        {QStringLiteral("*.cpp"), QStringLiteral("*.h"), QStringLiteral("*.qml"),
                         QStringLiteral("*.js"), QStringLiteral("*.json"), QStringLiteral("*.md")},
                        QDir::Files, QDirIterator::Subdirectories);
        while (it.hasNext() && hits.size() < 40) {
            const QString path = it.next();
            QString abs;
            if (!resolveInWorkspace(QDir(workspaceRoot()).relativeFilePath(path), abs))
                continue;
            QFile f(path);
            if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
                continue;
            int line = 0;
            while (!f.atEnd() && hits.size() < 40) {
                ++line;
                const QString text = QString::fromUtf8(f.readLine());
                if (text.contains(query, Qt::CaseInsensitive))
                    hits << QStringLiteral("%1:%2: %3")
                                .arg(QDir(workspaceRoot()).relativeFilePath(path))
                                .arg(line).arg(text.trimmed().left(160));
            }
        }
        return hits.isEmpty() ? QStringLiteral("No matches.") : hits.join(QLatin1Char('\n'));
    }
    if (name == QLatin1String("git_status") || name == QLatin1String("git_diff")) {
        QProcess git;
        git.setWorkingDirectory(workspaceRoot());
        git.start(QStringLiteral("git"),
                  {name == QLatin1String("git_status") ? QStringLiteral("status")
                                                       : QStringLiteral("diff"),
                   QStringLiteral("--no-color")});
        if (!git.waitForFinished(4000))
            return QStringLiteral("git timed out.");
        return QString::fromUtf8(git.readAllStandardOutput()).left(8000);
    }
    handled = false;
    return {};
}

// Port of evaluateStarvisActionPolicy (main.js).
QVariantMap StarvisService::evaluatePolicy(const QVariantMap& action) const
{
    auto blocked = [](const QString& r) {
        return QVariantMap{{QStringLiteral("allowed"), false}, {QStringLiteral("reason"), r},
                           {QStringLiteral("severity"), QStringLiteral("blocked")}};
    };
    auto allowed = [](const QString& r) {
        return QVariantMap{{QStringLiteral("allowed"), true}, {QStringLiteral("reason"), r},
                           {QStringLiteral("severity"), QStringLiteral("review")}};
    };
    static const QStringList unsafeTokens = {QStringLiteral("&"), QStringLiteral("|"),
        QStringLiteral(";"), QStringLiteral("`"), QStringLiteral("$("), QStringLiteral(">"),
        QStringLiteral("<"), QStringLiteral("\n")};
    auto hasUnsafe = [](const QString& s) {
        for (const QString& t : unsafeTokens)
            if (s.contains(t)) return true;
        return false;
    };

    const QString type = action.value(QStringLiteral("actionType")).toString();
    if (type == QLatin1String("command")) {
        const QString cmd = action.value(QStringLiteral("command")).toString();
        const QStringList args = action.value(QStringLiteral("args")).toStringList();
        static const QStringList allow = {QStringLiteral("npm"), QStringLiteral("node"),
                                          QStringLiteral("git")};
        if (!allow.contains(cmd)) return blocked(QStringLiteral("Command \"%1\" not on allowlist.").arg(cmd));
        if (hasUnsafe(cmd) || std::any_of(args.begin(), args.end(), hasUnsafe))
            return blocked(QStringLiteral("Command contains shell metacharacters."));
        if (cmd == QLatin1String("npm")) {
            if (args.value(0) == QLatin1String("run") && !args.value(1).isEmpty())
                return allowed(QStringLiteral("npm run script — review the script name."));
            if (args.value(0) == QLatin1String("test")) return allowed(QStringLiteral("npm test."));
            return blocked(QStringLiteral("Only 'npm run <script>' and 'npm test' allowed."));
        }
        if (cmd == QLatin1String("git")) {
            static const QStringList ro = {QStringLiteral("status"), QStringLiteral("diff"),
                QStringLiteral("log"), QStringLiteral("show"), QStringLiteral("branch")};
            if (!ro.contains(args.value(0)))
                return blocked(QStringLiteral("Mutating git must use a dedicated action type."));
            return allowed(QStringLiteral("Read-only git command."));
        }
        if (cmd == QLatin1String("node")) {
            QString script;
            if (args.isEmpty() || !resolveInWorkspace(args.first(), script))
                return blocked(QStringLiteral("Node command needs a workspace script."));
            static const QStringList scriptSuffixes = {
                QStringLiteral("js"), QStringLiteral("mjs"), QStringLiteral("cjs")};
            if (!scriptSuffixes.contains(QFileInfo(script).suffix().toLower()))
                return blocked(QStringLiteral("Node command only allows JavaScript files."));
            return allowed(QStringLiteral("Node workspace script after approval."));
        }
        return allowed(QStringLiteral("Node workspace script — review before approving."));
    }
    if (type == QLatin1String("file_edit")) {
        QString abs;
        if (!resolveInWorkspace(action.value(QStringLiteral("path")).toString(), abs))
            return blocked(QStringLiteral("File path is outside the workspace or ignored."));
        static const QStringList protectedNames = {
            QStringLiteral(".env"), QStringLiteral("credentials.json"),
            QStringLiteral("id_rsa"), QStringLiteral("id_ed25519")};
        static const QStringList protectedSuffixes = {
            QStringLiteral("exe"), QStringLiteral("dll"), QStringLiteral("pfx"),
            QStringLiteral("p12"), QStringLiteral("pem"), QStringLiteral("key"),
            QStringLiteral("db"), QStringLiteral("sqlite")};
        const QFileInfo target(abs);
        if (protectedNames.contains(target.fileName().toLower())
            || protectedSuffixes.contains(target.suffix().toLower()))
            return blocked(QStringLiteral("File edit targets a protected or binary file."));
        const QString content = action.value(QStringLiteral("content")).toString();
        if (content.isEmpty()) return blocked(QStringLiteral("Missing replacement content."));
        if (content.contains(QChar::Null)) return blocked(QStringLiteral("Content appears binary."));
        if (content.size() > 200000) return blocked(QStringLiteral("Content too large."));
        return allowed(QStringLiteral("Text file write after approval."));
    }
    if (type == QLatin1String("git_commit")) {
        if (action.value(QStringLiteral("message")).toString().trimmed().isEmpty())
            return blocked(QStringLiteral("Git commit is missing a message."));
        const QStringList paths = action.value(QStringLiteral("args")).toStringList();
        if (paths.isEmpty())
            return blocked(QStringLiteral("Git commit needs explicit workspace paths."));
        for (const QString& path : paths) {
            QString abs;
            if (!resolveInWorkspace(path, abs))
                return blocked(QStringLiteral("Git commit path is not allowed: %1").arg(path));
            static const QStringList protectedSuffixes = {
                QStringLiteral("pfx"), QStringLiteral("p12"), QStringLiteral("pem"),
                QStringLiteral("key"), QStringLiteral("db"), QStringLiteral("sqlite")};
            const QFileInfo target(abs);
            if (target.fileName().compare(QStringLiteral(".env"), Qt::CaseInsensitive) == 0
                || protectedSuffixes.contains(target.suffix().toLower()))
                return blocked(QStringLiteral("Git commit path is protected: %1").arg(path));
        }
        return allowed(QStringLiteral("Git commit after approval."));
    }
    if (type == QLatin1String("git_push")) {
        const QStringList args = action.value(QStringLiteral("args")).toStringList();
        if (std::any_of(args.begin(), args.end(), hasUnsafe))
            return blocked(QStringLiteral("Git push target contains unsafe characters."));
        return QVariantMap{{QStringLiteral("allowed"), true},
                           {QStringLiteral("reason"), QStringLiteral("Git push needs two approvals.")},
                           {QStringLiteral("severity"), QStringLiteral("high")},
                           {QStringLiteral("requiresSecondApproval"), true}};
    }
    if (type == QLatin1String("open_url")) {
        const QString url = action.value(QStringLiteral("url")).toString();
        if (!url.startsWith(QLatin1String("http")))
            return blocked(QStringLiteral("Only http(s) URLs allowed."));
        return allowed(QStringLiteral("Open URL after approval."));
    }
    return blocked(QStringLiteral("Unsupported action type."));
}

void StarvisService::queueAction(const QString& name, const QJsonObject& args)
{
    Q_UNUSED(name)
    QVariantMap action = args.toVariantMap();
    const QVariantMap verdict = evaluatePolicy(action);
    QVariantMap entry{
        {QStringLiteral("id"), QUuid::createUuid().toString(QUuid::Id128)},
        {QStringLiteral("actionType"), action.value(QStringLiteral("actionType"))},
        {QStringLiteral("summary"), action.value(QStringLiteral("summary"))},
        {QStringLiteral("detail"), QString::fromUtf8(QJsonDocument(args).toJson(QJsonDocument::Compact))},
        {QStringLiteral("status"), verdict.value(QStringLiteral("allowed")).toBool()
                                       ? QStringLiteral("pending") : QStringLiteral("blocked")},
        {QStringLiteral("verdict"), verdict.value(QStringLiteral("allowed"))},
        {QStringLiteral("reason"), verdict.value(QStringLiteral("reason"))},
        {QStringLiteral("severity"), verdict.value(QStringLiteral("severity"))},
        {QStringLiteral("requiresSecondApproval"),
         verdict.value(QStringLiteral("requiresSecondApproval"), false)},
        {QStringLiteral("confirmationArmed"), false},
        {QStringLiteral("createdAt"), QDateTime::currentMSecsSinceEpoch()},
        {QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch()},
    };
    m_actions.prepend(entry);
    while (m_actions.size() > 50)
        m_actions.removeLast();
    persistActions();
    emit actionsChanged();
    qInfo() << "[starvis] action queued:" << entry.value(QStringLiteral("actionType")).toString()
            << "verdict=" << verdict.value(QStringLiteral("severity")).toString();
}

QVariantList StarvisService::pendingActions() const
{
    QVariantList out;
    for (const QVariant& v : m_actions) {
        const QVariantMap a = v.toMap();
        const QString status = a.value(QStringLiteral("status")).toString();
        if (status == QLatin1String("pending") || status == QLatin1String("blocked"))
            out.append(a);
    }
    return out;
}

QVariantList StarvisService::recentActions() const
{
    QVariantList out;
    for (const QVariant& v : m_actions) {
        const QVariantMap action = v.toMap();
        const QString status = action.value(QStringLiteral("status")).toString();
        if (status != QLatin1String("pending") && status != QLatin1String("blocked"))
            out.append(action);
        if (out.size() >= 8)
            break;
    }
    return out;
}

bool StarvisService::executionEnabled() const
{
    return m_settings->get(QStringLiteral("wp-starvis-exec-enabled"), false).toBool();
}

void StarvisService::setExecutionEnabled(bool enabled)
{
    if (executionEnabled() == enabled)
        return;
    m_settings->set(QStringLiteral("wp-starvis-exec-enabled"), enabled);
    emit executionEnabledChanged();
}

void StarvisService::approveAction(const QString& id)
{
    for (int i = 0; i < m_actions.size(); ++i) {
        QVariantMap a = m_actions[i].toMap();
        if (a.value(QStringLiteral("id")).toString() != id)
            continue;
        const QJsonObject detail = QJsonDocument::fromJson(
            a.value(QStringLiteral("detail")).toString().toUtf8()).object();
        const QVariantMap policy = evaluatePolicy(detail.toVariantMap());
        a.insert(QStringLiteral("verdict"), policy.value(QStringLiteral("allowed")));
        a.insert(QStringLiteral("reason"), policy.value(QStringLiteral("reason")));
        a.insert(QStringLiteral("severity"), policy.value(QStringLiteral("severity")));
        a.insert(QStringLiteral("requiresSecondApproval"),
                 policy.value(QStringLiteral("requiresSecondApproval"), false));
        if (a.value(QStringLiteral("status")).toString() != QLatin1String("pending")
            || !policy.value(QStringLiteral("allowed")).toBool()) {
            if (a.value(QStringLiteral("status")).toString() == QLatin1String("pending")) {
                a.insert(QStringLiteral("status"), QStringLiteral("blocked"));
                a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
                m_actions[i] = a;
                persistActions();
                emit actionsChanged();
            }
            qWarning() << "[starvis] approve refused — action is blocked by policy";
            return;
        }
        if (a.value(QStringLiteral("requiresSecondApproval")).toBool()
            && !a.value(QStringLiteral("confirmationArmed")).toBool()) {
            a.insert(QStringLiteral("confirmationArmed"), true);
            a.insert(QStringLiteral("result"),
                     QStringLiteral("Second approval required before execution."));
            a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
            m_actions[i] = a;
            persistActions();
            emit actionsChanged();
            return;
        }
        if (!executionEnabled()) {
            // Capability gate: structure approved/recorded, but no fs/exec side
            // effects run until the user enables execution explicitly.
            a.insert(QStringLiteral("status"), QStringLiteral("approved-audit"));
            qInfo() << "[starvis] action approved (audit only — execution disabled)";
        } else {
            const QString type = a.value(QStringLiteral("actionType")).toString();
            bool ok = false;
            QString result;
            auto run = [this, &result](const QString& program, const QStringList& args,
                                       int timeoutMs) {
                QProcess process;
                process.setWorkingDirectory(workspaceRoot());
                process.start(program, args);
                if (!process.waitForStarted(5000)) {
                    result = process.errorString();
                    return false;
                }
                if (!process.waitForFinished(timeoutMs)) {
                    process.kill();
                    process.waitForFinished(2000);
                    result = QStringLiteral("Process timed out.");
                    return false;
                }
                result = QString::fromUtf8(process.readAllStandardOutput()
                                           + process.readAllStandardError()).left(12000);
                return process.exitStatus() == QProcess::NormalExit && process.exitCode() == 0;
            };
            if (type == QLatin1String("open_url")) {
                ok = QDesktopServices::openUrl(QUrl(detail.value(QLatin1String("url")).toString()));
                result = ok ? QStringLiteral("URL opened.") : QStringLiteral("Could not open URL.");
            } else if (type == QLatin1String("file_edit")) {
                QString abs;
                if (resolveInWorkspace(detail.value(QLatin1String("path")).toString(), abs)) {
                    QDir().mkpath(QFileInfo(abs).absolutePath());
                    QFile f(abs);
                    if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
                        f.write(detail.value(QLatin1String("content")).toString().toUtf8());
                        ok = true;
                        result = QStringLiteral("Wrote %1.").arg(
                            QDir(workspaceRoot()).relativeFilePath(abs));
                    } else {
                        result = f.errorString();
                    }
                }
            } else if (type == QLatin1String("command")) {
                ok = run(detail.value(QLatin1String("command")).toString(),
                         detail.value(QLatin1String("args")).toVariant().toStringList(), 60000);
            } else if (type == QLatin1String("git_commit")) {
                const QStringList paths = detail.value(QLatin1String("args")).toVariant().toStringList();
                QStringList addArgs{QStringLiteral("add"), QStringLiteral("--")};
                addArgs.append(paths);
                ok = run(QStringLiteral("git"), addArgs, 30000);
                if (ok)
                    ok = run(QStringLiteral("git"),
                             {QStringLiteral("commit"), QStringLiteral("-m"),
                              detail.value(QLatin1String("message")).toString()}, 60000);
            } else if (type == QLatin1String("git_push")) {
                const QStringList target = detail.value(QLatin1String("args")).toVariant().toStringList();
                QStringList pushArgs{QStringLiteral("push"),
                                     target.value(0, QStringLiteral("origin"))};
                if (!target.value(1).isEmpty())
                    pushArgs.append(target.value(1));
                ok = run(QStringLiteral("git"), pushArgs, 120000);
            }
            a.insert(QStringLiteral("status"),
                     ok ? QStringLiteral("approved") : QStringLiteral("failed"));
            a.insert(QStringLiteral("result"), result);
            qInfo() << "[starvis] action executed:" << type << "ok=" << ok;
        }
        a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
        m_actions[i] = a;
        persistActions();
        emit actionsChanged();
        return;
    }
}

void StarvisService::rejectAction(const QString& id)
{
    for (int i = 0; i < m_actions.size(); ++i) {
        QVariantMap a = m_actions[i].toMap();
        if (a.value(QStringLiteral("id")).toString() == id) {
            if (a.value(QStringLiteral("status")).toString() != QLatin1String("pending"))
                return;
            a.insert(QStringLiteral("status"), QStringLiteral("rejected"));
            a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
            m_actions[i] = a;
            persistActions();
            emit actionsChanged();
            return;
        }
    }
}

void StarvisService::persistActions()
{
    m_settings->set(QStringLiteral("wp-starvis-actions"),
                    QString::fromUtf8(QJsonDocument(QJsonArray::fromVariantList(m_actions))
                                          .toJson(QJsonDocument::Compact)));
}

void StarvisService::loadActions()
{
    const QString raw = m_settings->get(QStringLiteral("wp-starvis-actions")).toString();
    if (raw.isEmpty())
        return;
    m_actions = QJsonDocument::fromJson(raw.toUtf8()).array().toVariantList();
    for (int i = 0; i < m_actions.size(); ++i) {
        QVariantMap action = m_actions.at(i).toMap();
        const QJsonObject detail = QJsonDocument::fromJson(
            action.value(QStringLiteral("detail")).toString().toUtf8()).object();
        if (detail.isEmpty())
            continue;
        const QVariantMap policy = evaluatePolicy(detail.toVariantMap());
        action.insert(QStringLiteral("verdict"), policy.value(QStringLiteral("allowed")));
        action.insert(QStringLiteral("reason"), policy.value(QStringLiteral("reason")));
        action.insert(QStringLiteral("severity"), policy.value(QStringLiteral("severity")));
        action.insert(QStringLiteral("requiresSecondApproval"),
                      policy.value(QStringLiteral("requiresSecondApproval"), false));
        if (action.value(QStringLiteral("status")).toString() == QLatin1String("pending")
            && !policy.value(QStringLiteral("allowed")).toBool())
            action.insert(QStringLiteral("status"), QStringLiteral("blocked"));
        m_actions[i] = action;
    }
}

} // namespace qtpanel
