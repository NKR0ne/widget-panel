#pragma once

#include <QAudioFormat>
#include <QObject>
#include <QTimer>

class QAudioSink;
class QAudioSource;
class QIODevice;
class QWebSocket;

namespace qtpanel {

class SecretVault;
class SettingsStore;
class StarvisService;

// Full-duplex realtime voice over the OpenAI Realtime API (QWebSocket).
// Mic: QAudioSource 24 kHz mono pcm16 → input_audio_buffer.append.
// Playback: QAudioSink push mode fed by response.audio.delta.
// Barge-in: server VAD speech_started → response.cancel + sink flush.
// Never auto-connects; idle and hard-cap timers close the session (cost guard).
class VoiceSession : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(bool active READ active NOTIFY statusChanged)
    Q_PROPERTY(bool available READ available NOTIFY availableChanged)
    Q_PROPERTY(QString unavailableReason READ unavailableReason NOTIFY availableChanged)
    Q_PROPERTY(int elapsedSec READ elapsedSec NOTIFY elapsedChanged)
    Q_PROPERTY(bool muted READ muted WRITE setMuted NOTIFY mutedChanged)

public:
    VoiceSession(SettingsStore* settings, SecretVault* vault, StarvisService* starvis,
                 QObject* parent = nullptr);
    ~VoiceSession() override;

    QString status() const { return m_status; } // idle|connecting|live|error
    bool active() const { return m_status == QLatin1String("connecting")
                              || m_status == QLatin1String("live"); }
    bool available() const;
    QString unavailableReason() const;
    int elapsedSec() const { return m_elapsedSec; }
    bool muted() const { return m_muted; }
    void setMuted(bool muted);

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop(); // user-initiated

signals:
    void statusChanged();
    void availableChanged();
    void elapsedChanged();
    void mutedChanged();
    // role: "user" | "assistant" | "system"; final transcripts only.
    void transcriptEvent(const QString& role, const QString& text);

private:
    void handleMessage(const QString& message);
    void handleFunctionCall(const QString& name, const QString& callId,
                            const QString& argumentsJson);
    void sendJson(const QJsonObject& object);
    void sendSessionUpdate();
    void startAudio();
    void stopAudio();
    void closeSession(const QString& reason);
    void setStatus(const QString& status);
    QVariantMap voiceConfig() const;
    QString openAiKey() const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    StarvisService* m_starvis = nullptr;
    QWebSocket* m_socket = nullptr;
    QAudioSource* m_micSource = nullptr;
    QIODevice* m_micDevice = nullptr;
    QAudioSink* m_sink = nullptr;
    QIODevice* m_sinkDevice = nullptr;
    QAudioFormat m_format;
    QByteArray m_micBuffer;
    QString m_status = QStringLiteral("idle");
    QString m_assistantTranscript; // accumulates response.audio_transcript.delta
    bool m_muted = false;
    bool m_responding = false;
    int m_elapsedSec = 0;
    QTimer m_elapsedTimer;  // 1 s UI tick
    QTimer m_idleTimer;     // no speech activity -> close
    QTimer m_capTimer;      // absolute session cap -> close
};

} // namespace qtpanel
