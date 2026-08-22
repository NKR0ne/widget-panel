#include "VoiceSession.h"

#include "StarvisService.h"
#include "StarvisState.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QAudioSink>
#include <QAudioSource>
#include <QDebug>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMediaDevices>
#include <QNetworkRequest>
#include <QWebSocket>

#include <cmath>

namespace qtpanel {

namespace {

constexpr int kSampleRate = 24000;
constexpr int kChunkBytes = 3840; // ~40 ms of 24 kHz mono int16

double rmsLevel(const QByteArray& pcm)
{
    const auto* samples = reinterpret_cast<const qint16*>(pcm.constData());
    const int count = pcm.size() / 2;
    if (count == 0)
        return 0;
    double sum = 0;
    for (int i = 0; i < count; ++i)
        sum += double(samples[i]) * samples[i];
    return std::sqrt(sum / count) / 32768.0;
}

} // namespace

VoiceSession::VoiceSession(SettingsStore* settings, SecretVault* vault,
                           StarvisService* starvis, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_starvis(starvis)
{
    m_format.setSampleRate(kSampleRate);
    m_format.setChannelCount(1);
    m_format.setSampleFormat(QAudioFormat::Int16);

    m_elapsedTimer.setInterval(1000);
    connect(&m_elapsedTimer, &QTimer::timeout, this, [this] {
        ++m_elapsedSec;
        emit elapsedChanged();
    });
    m_idleTimer.setSingleShot(true);
    connect(&m_idleTimer, &QTimer::timeout, this,
            [this] { closeSession(QStringLiteral("idle")); });
    m_capTimer.setSingleShot(true);
    connect(&m_capTimer, &QTimer::timeout, this,
            [this] { closeSession(QStringLiteral("session cap")); });

    connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
        if (key == QLatin1String("starvis-openai-key"))
            emit availableChanged();
    });
    // Hot-plugging a microphone flips availability.
    auto* mediaDevices = new QMediaDevices(this);
    connect(mediaDevices, &QMediaDevices::audioInputsChanged, this,
            [this] { emit availableChanged(); });
}

VoiceSession::~VoiceSession()
{
    stopAudio();
}

QString VoiceSession::openAiKey() const
{
    return m_vault->get(QStringLiteral("starvis-openai-key")).trimmed();
}

QVariantMap VoiceSession::voiceConfig() const
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

bool VoiceSession::available() const
{
    return !openAiKey().isEmpty() && !QMediaDevices::defaultAudioInput().isNull();
}

QString VoiceSession::unavailableReason() const
{
    if (openAiKey().isEmpty())
        return QStringLiteral("Clé OpenAI absente");
    if (QMediaDevices::defaultAudioInput().isNull())
        return QStringLiteral("Aucun microphone détecté");
    return {};
}

void VoiceSession::setMuted(bool muted)
{
    if (m_muted == muted)
        return;
    m_muted = muted;
    emit mutedChanged();
}

void VoiceSession::setStatus(const QString& status)
{
    if (m_status == status)
        return;
    m_status = status;
    emit statusChanged();
}

void VoiceSession::start()
{
    if (active())
        return;
    if (!available()) {
        qWarning() << "[starvis.voice] start refused:" << unavailableReason();
        return;
    }

    const QVariantMap cfg = voiceConfig();
    QString model = cfg.value(QStringLiteral("realtimeModel")).toString().trimmed();
    if (model.isEmpty())
        model = QStringLiteral("gpt-realtime");

    setStatus(QStringLiteral("connecting"));
    m_elapsedSec = 0;
    emit elapsedChanged();

    m_socket = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);
    QNetworkRequest request(
        QUrl(QStringLiteral("wss://api.openai.com/v1/realtime?model=%1").arg(model)));
    request.setRawHeader("Authorization", "Bearer " + openAiKey().toUtf8());
    request.setRawHeader("OpenAI-Beta", "realtime=v1");

    connect(m_socket, &QWebSocket::connected, this, [this] {
        qInfo() << "[starvis.voice] session open";
        setStatus(QStringLiteral("live"));
        sendSessionUpdate();
        startAudio();
        m_elapsedTimer.start();
        const QVariantMap cfg = voiceConfig();
        const int idleMin = qBound(1, cfg.value(QStringLiteral("idleTimeoutMin"), 5).toInt(), 60);
        const int capMin = qBound(2, cfg.value(QStringLiteral("maxSessionMin"), 30).toInt(), 180);
        m_idleTimer.start(idleMin * 60 * 1000);
        m_capTimer.start(capMin * 60 * 1000);
        if (m_starvis && m_starvis->state())
            m_starvis->state()->setListening(true);
    });
    connect(m_socket, &QWebSocket::textMessageReceived,
            this, &VoiceSession::handleMessage);
    connect(m_socket, &QWebSocket::disconnected, this, [this] {
        qInfo() << "[starvis.voice] socket disconnected after" << m_elapsedSec << "s";
        stopAudio();
        m_elapsedTimer.stop();
        m_idleTimer.stop();
        m_capTimer.stop();
        if (m_starvis && m_starvis->state()) {
            m_starvis->state()->setListening(false);
            m_starvis->state()->setSpeaking(false);
            m_starvis->state()->setAudioLevel(0);
        }
        if (m_socket) {
            m_socket->deleteLater();
            m_socket = nullptr;
        }
        if (m_status != QLatin1String("error"))
            setStatus(QStringLiteral("idle"));
    });
    connect(m_socket, &QWebSocket::errorOccurred, this, [this](QAbstractSocket::SocketError) {
        qWarning() << "[starvis.voice] socket error:"
                   << (m_socket ? m_socket->errorString() : QString());
        setStatus(QStringLiteral("error"));
    });

    m_socket->open(request);
}

void VoiceSession::stop()
{
    closeSession(QStringLiteral("user"));
}

void VoiceSession::closeSession(const QString& reason)
{
    if (!m_socket)
        return;
    qInfo() << "[starvis.voice] session closed (" << reason << ") after"
            << m_elapsedSec << "s";
    m_socket->close();
}

void VoiceSession::sendJson(const QJsonObject& object)
{
    if (m_socket && m_socket->isValid())
        m_socket->sendTextMessage(
            QString::fromUtf8(QJsonDocument(object).toJson(QJsonDocument::Compact)));
}

void VoiceSession::sendSessionUpdate()
{
    const QVariantMap cfg = voiceConfig();
    QString voice = cfg.value(QStringLiteral("voice")).toString().trimmed();
    if (voice.isEmpty())
        voice = QStringLiteral("marin");

    auto tool = [](const char* name, const char* description, QJsonObject props,
                   QJsonArray required) {
        return QJsonObject{
            {QStringLiteral("type"), QStringLiteral("function")},
            {QStringLiteral("name"), QLatin1String(name)},
            {QStringLiteral("description"), QLatin1String(description)},
            {QStringLiteral("parameters"), QJsonObject{
                {QStringLiteral("type"), QStringLiteral("object")},
                {QStringLiteral("properties"), props},
                {QStringLiteral("required"), required},
            }},
        };
    };

    const QJsonArray tools{
        tool("get_news_summary",
             "Résumé des manchettes actuelles du panneau (nouvelles locales).", {}, {}),
        tool("daily_briefing",
             "Briefing du contexte local: météo, marchés, nouvelles, station.", {}, {}),
        tool("check_cameras",
             "État des caméras de surveillance et derniers événements détectés.", {}, {}),
        tool("ask_claude",
             "Délègue une question complexe au modèle de raisonnement Claude.",
             QJsonObject{{QStringLiteral("question"), QJsonObject{
                 {QStringLiteral("type"), QStringLiteral("string")},
                 {QStringLiteral("description"), QStringLiteral("La question complète")},
             }}},
             QJsonArray{QStringLiteral("question")}),
    };

    sendJson(QJsonObject{
        {QStringLiteral("type"), QStringLiteral("session.update")},
        {QStringLiteral("session"), QJsonObject{
            {QStringLiteral("modalities"), QJsonArray{QStringLiteral("audio"), QStringLiteral("text")}},
            {QStringLiteral("instructions"),
             QStringLiteral("Tu es Starvis, l'assistant vocal du Widget Panel. Réponds en "
                            "français, brièvement et naturellement. Utilise les outils pour "
                            "les nouvelles, le briefing, les caméras, et délègue les "
                            "questions complexes à ask_claude.")},
            {QStringLiteral("voice"), voice},
            {QStringLiteral("input_audio_format"), QStringLiteral("pcm16")},
            {QStringLiteral("output_audio_format"), QStringLiteral("pcm16")},
            {QStringLiteral("input_audio_transcription"),
             QJsonObject{{QStringLiteral("model"), QStringLiteral("whisper-1")}}},
            {QStringLiteral("turn_detection"),
             QJsonObject{{QStringLiteral("type"), QStringLiteral("server_vad")}}},
            {QStringLiteral("tools"), tools},
        }},
    });
}

void VoiceSession::startAudio()
{
    const QAudioDevice inputDevice = QMediaDevices::defaultAudioInput();
    if (inputDevice.isNull()) {
        qWarning() << "[starvis.voice] no microphone";
        return;
    }
    m_micSource = new QAudioSource(inputDevice, m_format, this);
    m_micDevice = m_micSource->start();
    if (m_micDevice) {
        connect(m_micDevice, &QIODevice::readyRead, this, [this] {
            const QByteArray data = m_micDevice->readAll();
            if (data.isEmpty())
                return;
            if (m_starvis && m_starvis->state() && !m_responding)
                m_starvis->state()->setAudioLevel(rmsLevel(data));
            if (m_muted)
                return;
            m_micBuffer.append(data);
            while (m_micBuffer.size() >= kChunkBytes) {
                const QByteArray chunk = m_micBuffer.left(kChunkBytes);
                m_micBuffer.remove(0, kChunkBytes);
                sendJson(QJsonObject{
                    {QStringLiteral("type"), QStringLiteral("input_audio_buffer.append")},
                    {QStringLiteral("audio"), QString::fromLatin1(chunk.toBase64())},
                });
            }
        });
    }

    m_sink = new QAudioSink(QMediaDevices::defaultAudioOutput(), m_format, this);
    m_sinkDevice = m_sink->start();
}

void VoiceSession::stopAudio()
{
    if (m_micSource) {
        m_micSource->stop();
        m_micSource->deleteLater();
        m_micSource = nullptr;
        m_micDevice = nullptr;
    }
    if (m_sink) {
        m_sink->stop();
        m_sink->deleteLater();
        m_sink = nullptr;
        m_sinkDevice = nullptr;
    }
    m_micBuffer.clear();
    m_responding = false;
}

void VoiceSession::handleMessage(const QString& message)
{
    const QJsonObject event = QJsonDocument::fromJson(message.toUtf8()).object();
    const QString type = event.value(QLatin1String("type")).toString();

    if (type == QLatin1String("input_audio_buffer.speech_started")) {
        // Barge-in: kill the in-flight response and flush queued audio.
        m_idleTimer.start();
        if (m_responding) {
            qInfo() << "[starvis.voice] speech_started -> response.cancel";
            sendJson(QJsonObject{{QStringLiteral("type"), QStringLiteral("response.cancel")}});
            if (m_sink)
                m_sink->reset();
            m_sinkDevice = m_sink ? m_sink->start() : nullptr;
            m_responding = false;
        }
        if (m_starvis && m_starvis->state()) {
            m_starvis->state()->setSpeaking(false);
            m_starvis->state()->setListening(true);
        }
        return;
    }
    if (type == QLatin1String("response.audio.delta")) {
        m_idleTimer.start();
        const QByteArray pcm = QByteArray::fromBase64(
            event.value(QLatin1String("delta")).toString().toLatin1());
        if (m_sinkDevice)
            m_sinkDevice->write(pcm);
        if (!m_responding) {
            m_responding = true;
            if (m_starvis && m_starvis->state())
                m_starvis->state()->setSpeaking(true);
        }
        if (m_starvis && m_starvis->state())
            m_starvis->state()->setAudioLevel(rmsLevel(pcm));
        return;
    }
    if (type == QLatin1String("response.done")) {
        m_responding = false;
        if (m_starvis && m_starvis->state()) {
            m_starvis->state()->setSpeaking(false);
            m_starvis->state()->setAudioLevel(0);
        }
        return;
    }
    if (type == QLatin1String("response.audio_transcript.delta")) {
        m_assistantTranscript += event.value(QLatin1String("delta")).toString();
        return;
    }
    if (type == QLatin1String("response.audio_transcript.done")) {
        if (!m_assistantTranscript.trimmed().isEmpty())
            emit transcriptEvent(QStringLiteral("assistant"), m_assistantTranscript.trimmed());
        m_assistantTranscript.clear();
        return;
    }
    if (type == QLatin1String("conversation.item.input_audio_transcription.completed")) {
        const QString transcript = event.value(QLatin1String("transcript")).toString().trimmed();
        if (!transcript.isEmpty())
            emit transcriptEvent(QStringLiteral("user"), transcript);
        return;
    }
    if (type == QLatin1String("response.function_call_arguments.done")) {
        handleFunctionCall(event.value(QLatin1String("name")).toString(),
                           event.value(QLatin1String("call_id")).toString(),
                           event.value(QLatin1String("arguments")).toString());
        return;
    }
    if (type == QLatin1String("error")) {
        qWarning() << "[starvis.voice] api error:"
                   << event.value(QLatin1String("error")).toObject()
                          .value(QLatin1String("message")).toString();
        return;
    }
    if (type == QLatin1String("session.created"))
        qInfo() << "[starvis.voice] session created";
}

void VoiceSession::handleFunctionCall(const QString& name, const QString& callId,
                                      const QString& argumentsJson)
{
    qInfo() << "[starvis.voice] function_call" << name;
    auto respond = [this, callId](const QString& output) {
        sendJson(QJsonObject{
            {QStringLiteral("type"), QStringLiteral("conversation.item.create")},
            {QStringLiteral("item"), QJsonObject{
                {QStringLiteral("type"), QStringLiteral("function_call_output")},
                {QStringLiteral("call_id"), callId},
                {QStringLiteral("output"), output.left(6000)},
            }},
        });
        sendJson(QJsonObject{{QStringLiteral("type"), QStringLiteral("response.create")}});
        qInfo() << "[starvis.voice] function_call_output sent";
    };

    if (name == QLatin1String("get_news_summary")
        || name == QLatin1String("daily_briefing")
        || name == QLatin1String("check_cameras")) {
        respond(m_starvis ? m_starvis->voiceToolSnapshot(name)
                          : QStringLiteral("Service indisponible."));
        return;
    }
    if (name == QLatin1String("ask_claude")) {
        const QJsonObject args = QJsonDocument::fromJson(argumentsJson.toUtf8()).object();
        const QString question = args.value(QLatin1String("question")).toString();
        if (!m_starvis || question.trimmed().isEmpty()) {
            respond(QStringLiteral("Question vide."));
            return;
        }
        m_starvis->askClaude(question, this, [respond](const QString& answer,
                                                       const QString& error) {
            respond(error.isEmpty() ? answer : QStringLiteral("Erreur: ") + error);
        });
        return;
    }
    respond(QStringLiteral("Outil inconnu."));
}

} // namespace qtpanel
