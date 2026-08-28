#include "VoiceSession.h"

#include "StarvisService.h"
#include "StarvisState.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QAudioSink>
#include <QAudioSource>
#include <QBuffer>
#include <QDataStream>
#include <QDebug>
#include <QHttpMultiPart>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMediaDevices>
#include <QNetworkReply>
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
            [this] { m_localMode ? stopLocal() : closeSession(QStringLiteral("idle")); });
    m_capTimer.setSingleShot(true);
    connect(&m_capTimer, &QTimer::timeout, this,
            [this] { m_localMode ? stopLocal() : closeSession(QStringLiteral("session cap")); });

    connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
        if (key == QLatin1String("starvis-openai-key")
            || key == QLatin1String("starvis-groq-key"))
            emit availableChanged();
    });
    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key == QLatin1String("wp-starvis-voice")) {
            emit availableChanged();
            probeLocalRuntime();
        }
    });
    connect(m_starvis, &StarvisService::localModelsStateChanged,
            this, &VoiceSession::availableChanged);
    // Hot-plugging a microphone flips availability.
    auto* mediaDevices = new QMediaDevices(this);
    connect(mediaDevices, &QMediaDevices::audioInputsChanged, this,
            [this] { emit availableChanged(); });

    // The launcher owns service startup, so avoid emitting availability while
    // the QML object tree is still being constructed. A delayed health probe is
    // installed after the UI startup path has completed.
    m_localRuntimeReady = true;
    auto* localHealthTimer = new QTimer(this);
    localHealthTimer->setInterval(15000);
    connect(localHealthTimer, &QTimer::timeout, this, &VoiceSession::probeLocalRuntime);
    QTimer::singleShot(8000, this, [this, localHealthTimer] {
        if (provider() == QLatin1String("local"))
            probeLocalRuntime();
        localHealthTimer->start();
    });

    connect(m_starvis, &StarvisService::replyReceived, this,
            [this](const QString& text, const QString&, int) {
        if (!m_localMode || !m_waitingLocalReply)
            return;
        m_waitingLocalReply = false;
        setPhase(QStringLiteral("speaking"));
        m_starvis->speak(text);
    });
    connect(m_starvis, &StarvisService::chatFailed, this, [this](const QString&) {
        if (m_localMode && m_waitingLocalReply) {
            m_waitingLocalReply = false;
            resumeLocalListening();
        }
    });
    connect(m_starvis, &StarvisService::speechOutputFinished, this,
            [this](bool success, const QString&) {
        if (!m_localMode || !m_localProcessing)
            return;
        if (success)
            resumeLocalListening();
        else
            QTimer::singleShot(3500, this, &VoiceSession::resumeLocalListening);
    });
}

VoiceSession::~VoiceSession()
{
    stopAudio();
}

QString VoiceSession::openAiKey() const
{
    return m_vault->get(QStringLiteral("starvis-openai-key")).trimmed();
}

QString VoiceSession::groqKey() const
{
    return m_vault->get(QStringLiteral("starvis-groq-key")).trimmed();
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
    const bool microphone = !QMediaDevices::defaultAudioInput().isNull();
    const QString selected = provider();
    return microphone && (selected == QLatin1String("local")
        ? m_starvis->localModelsEnabled() && m_localRuntimeReady
        : selected == QLatin1String("groq") ? !groqKey().isEmpty()
                                             : !openAiKey().isEmpty());
}

QString VoiceSession::unavailableReason() const
{
    if (QMediaDevices::defaultAudioInput().isNull())
        return QStringLiteral("Aucun microphone détecté");
    if (provider() == QLatin1String("local") && !m_starvis->localModelsEnabled())
        return QStringLiteral("Modèles locaux désactivés");
    if (provider() == QLatin1String("local") && !m_localRuntimeReady)
        return QStringLiteral("Service vocal local en démarrage");
    if (provider() == QLatin1String("groq") && groqKey().isEmpty())
        return QStringLiteral("Clé Groq absente");
    if (provider() == QLatin1String("openai") && openAiKey().isEmpty())
        return QStringLiteral("Clé OpenAI absente");
    return {};
}

QString VoiceSession::provider() const
{
    const QString selected = voiceConfig().value(QStringLiteral("sessionProvider"),
                                                  QStringLiteral("local"))
                                 .toString().trimmed().toLower();
    if (selected == QLatin1String("openai"))
        return QStringLiteral("openai");
    if (selected == QLatin1String("groq"))
        return QStringLiteral("groq");
    return QStringLiteral("local");
}

QString VoiceSession::localEndpoint() const
{
    if (provider() == QLatin1String("groq"))
        return QStringLiteral("https://api.groq.com/openai/v1");
    QString endpoint = voiceConfig().value(QStringLiteral("asrEndpoint"),
                                            QStringLiteral("http://127.0.0.1:1235/v1"))
                           .toString().trimmed();
    while (endpoint.endsWith(QLatin1Char('/')))
        endpoint.chop(1);
    return endpoint;
}

void VoiceSession::setPhase(const QString& phase)
{
    if (m_phase == phase)
        return;
    m_phase = phase;
    emit phaseChanged();
}

void VoiceSession::probeLocalRuntime()
{
    QUrl health(localEndpoint());
    QString path = health.path();
    if (path.endsWith(QLatin1String("/v1")))
        path.chop(3);
    health.setPath(path + QStringLiteral("/health"));
    QNetworkRequest request(health);
    request.setTransferTimeout(3000);
    QNetworkReply* reply = m_localNetwork.get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        const QJsonObject body = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ready = reply->error() == QNetworkReply::NoError
            && body.value(QStringLiteral("status")).toString() == QLatin1String("ok")
            && body.value(QStringLiteral("asrReady")).toBool();
        reply->deleteLater();
        if (ready != m_localRuntimeReady) {
            m_localRuntimeReady = ready;
            emit availableChanged();
        }
    });
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

    if (provider() == QLatin1String("local") || provider() == QLatin1String("groq")) {
        startLocal();
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
    if (m_localMode) {
        stopLocal();
        return;
    }
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
            if (m_localMode) {
                handleLocalAudio(data);
                return;
            }
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

    if (!m_localMode) {
        m_sink = new QAudioSink(QMediaDevices::defaultAudioOutput(), m_format, this);
        m_sinkDevice = m_sink->start();
    }
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
    m_preRoll.clear();
    m_localRecording.clear();
    m_responding = false;
}

void VoiceSession::startLocal()
{
    m_localMode = true;
    m_localProcessing = false;
    m_waitingLocalReply = false;
    m_elapsedSec = 0;
    emit elapsedChanged();
    setStatus(QStringLiteral("live"));
    setPhase(QStringLiteral("listening"));
    startAudio();
    m_elapsedTimer.start();
    const QVariantMap cfg = voiceConfig();
    const int idleMin = qBound(1, cfg.value(QStringLiteral("idleTimeoutMin"), 10).toInt(), 60);
    const int capMin = qBound(2, cfg.value(QStringLiteral("maxSessionMin"), 60).toInt(), 180);
    m_idleTimer.start(idleMin * 60 * 1000);
    m_capTimer.start(capMin * 60 * 1000);
    if (m_starvis && m_starvis->state())
        m_starvis->state()->setListening(true);
    qInfo() << "[starvis.voice] local continuous session open";
}

void VoiceSession::stopLocal()
{
    qInfo() << "[starvis.voice] local session closed after" << m_elapsedSec << "s";
    m_elapsedTimer.stop();
    m_idleTimer.stop();
    m_capTimer.stop();
    stopAudio();
    m_localMode = false;
    m_localProcessing = false;
    m_localHeardSpeech = false;
    m_waitingLocalReply = false;
    if (m_starvis && m_starvis->state()) {
        m_starvis->state()->setListening(false);
        m_starvis->state()->setAudioLevel(0);
    }
    setPhase(QStringLiteral("idle"));
    setStatus(QStringLiteral("idle"));
}

void VoiceSession::handleLocalAudio(const QByteArray& data)
{
    const double level = rmsLevel(data);
    if (m_starvis && m_starvis->state())
        m_starvis->state()->setAudioLevel(level);
    if (m_muted || m_localProcessing || (m_starvis && m_starvis->busy()))
        return;

    const QVariantMap cfg = voiceConfig();
    const double threshold = qBound(0.004,
        cfg.value(QStringLiteral("vadThreshold"), 0.018).toDouble(), 0.20);
    const int silenceTarget = qBound(350,
        cfg.value(QStringLiteral("silenceMs"), 750).toInt(), 2000);
    const int chunkMs = qMax(1, data.size() * 1000 / (kSampleRate * 2));
    const bool speech = level >= threshold;

    if (!m_localHeardSpeech) {
        m_preRoll.append(data);
        constexpr int kPreRollBytes = kSampleRate * 2 * 350 / 1000;
        if (m_preRoll.size() > kPreRollBytes)
            m_preRoll.remove(0, m_preRoll.size() - kPreRollBytes);
        if (!speech)
            return;
        m_localHeardSpeech = true;
        m_localRecording = m_preRoll;
        m_preRoll.clear();
        m_localSilenceMs = 0;
        setPhase(QStringLiteral("hearing"));
    }

    m_localRecording.append(data);
    m_localSilenceMs = speech ? 0 : m_localSilenceMs + chunkMs;
    constexpr int kMaximumBytes = kSampleRate * 2 * 15;
    if (m_localSilenceMs >= silenceTarget || m_localRecording.size() >= kMaximumBytes)
        submitLocalUtterance();
}

void VoiceSession::submitLocalUtterance()
{
    constexpr int kMinimumBytes = kSampleRate * 2 * 300 / 1000;
    QByteArray pcm = std::move(m_localRecording);
    m_localRecording.clear();
    m_preRoll.clear();
    m_localHeardSpeech = false;
    m_localSilenceMs = 0;
    if (pcm.size() < kMinimumBytes)
        return;

    m_localProcessing = true;
    setPhase(QStringLiteral("transcribing"));
    m_idleTimer.start();
    if (m_starvis && m_starvis->state()) {
        m_starvis->state()->setListening(false);
        m_starvis->state()->setAudioLevel(0);
    }
    transcribeLocal(pcm);
}

QByteArray VoiceSession::pcmToWav(const QByteArray& pcm)
{
    QByteArray wav;
    QBuffer buffer(&wav);
    buffer.open(QIODevice::WriteOnly);
    QDataStream stream(&buffer);
    stream.setByteOrder(QDataStream::LittleEndian);
    stream.writeRawData("RIFF", 4);
    stream << quint32(36 + pcm.size());
    stream.writeRawData("WAVEfmt ", 8);
    stream << quint32(16) << quint16(1) << quint16(1) << quint32(kSampleRate)
           << quint32(kSampleRate * 2) << quint16(2) << quint16(16);
    stream.writeRawData("data", 4);
    stream << quint32(pcm.size());
    stream.writeRawData(pcm.constData(), pcm.size());
    return wav;
}

void VoiceSession::transcribeLocal(const QByteArray& pcm)
{
    const bool groq = provider() == QLatin1String("groq");
    const qint64 billedSeconds = groq
        ? qMax<qint64>(10, static_cast<qint64>(
              std::ceil(double(pcm.size()) / (kSampleRate * 2)))) : 0;
    auto* multipart = new QHttpMultiPart(QHttpMultiPart::FormDataType);
    QHttpPart audioPart;
    audioPart.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("audio/wav"));
    audioPart.setHeader(QNetworkRequest::ContentDispositionHeader,
                        QStringLiteral("form-data; name=\"file\"; filename=\"voice.wav\""));
    audioPart.setBody(pcmToWav(pcm));
    multipart->append(audioPart);

    const QVariantMap cfg = voiceConfig();
    QHttpPart languagePart;
    languagePart.setHeader(QNetworkRequest::ContentDispositionHeader,
                           QStringLiteral("form-data; name=\"language\""));
    languagePart.setBody(provider() == QLatin1String("groq")
        ? cfg.value(QStringLiteral("groqLanguage"), QStringLiteral("fr")).toString().toUtf8()
        : cfg.value(QStringLiteral("language"), QStringLiteral("French")).toString().toUtf8());
    multipart->append(languagePart);

    if (groq) {
        QHttpPart modelPart;
        modelPart.setHeader(QNetworkRequest::ContentDispositionHeader,
                            QStringLiteral("form-data; name=\"model\""));
        modelPart.setBody(cfg.value(QStringLiteral("groqModel"),
                                    QStringLiteral("whisper-large-v3")).toString().toUtf8());
        multipart->append(modelPart);
    }

    QNetworkRequest request(QUrl(localEndpoint() + QStringLiteral("/audio/transcriptions")));
    request.setTransferTimeout(300000);
    if (groq)
        request.setRawHeader("Authorization", "Bearer " + groqKey().toUtf8());
    QNetworkReply* reply = m_localNetwork.post(request, multipart);
    multipart->setParent(reply);
    connect(reply, &QNetworkReply::finished, this, [this, reply, groq, billedSeconds] {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject body = QJsonDocument::fromJson(reply->readAll()).object();
        const QString transportError = reply->error() == QNetworkReply::NoError
            ? QString() : reply->errorString();
        reply->deleteLater();
        if (status < 200 || status >= 300 || !transportError.isEmpty()) {
            const QString detail = body.value(QStringLiteral("error")).toObject()
                                       .value(QStringLiteral("message")).toString();
            qWarning() << "[starvis.voice] ASR failed" << provider() << status
                       << transportError << detail;
            resumeLocalListening();
            return;
        }
        const QString transcript = body.value(QStringLiteral("text")).toString().trimmed();
        if (transcript.isEmpty()) {
            resumeLocalListening();
            return;
        }
        if (groq)
            emit cloudUsageIncurred(billedSeconds * 0.111 / 3600.0,
                                    QStringLiteral("groqAsrSeconds"), billedSeconds);
        qInfo() << "[starvis.voice] transcript" << provider() << transcript;
        emit transcriptEvent(QStringLiteral("user"), transcript);
        setPhase(QStringLiteral("reasoning"));
        m_waitingLocalReply = true;
        m_starvis->chat(transcript, {}, false, false);
        if (!m_starvis->busy()) {
            m_waitingLocalReply = false;
            resumeLocalListening();
        }
    });
}

void VoiceSession::resumeLocalListening()
{
    if (!m_localMode)
        return;
    m_localProcessing = false;
    m_waitingLocalReply = false;
    m_localHeardSpeech = false;
    m_localRecording.clear();
    m_preRoll.clear();
    setPhase(QStringLiteral("listening"));
    if (m_starvis && m_starvis->state())
        m_starvis->state()->setListening(true);
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
