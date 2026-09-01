#pragma once

#include <QImage>
#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QProcess>
#include <QTimer>
#include <QVideoSink>

namespace qtpanel {

class SecretVault;
class SettingsStore;

// Direct RTSP camera client, kept separate from the XProtect SDK client. New
// credentials are only tried after an explicit user action. Once a frame has
// verified them, the card may reconnect that exact configuration on startup.
class DirectCameraClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QString error READ error NOTIFY statusChanged)
    Q_PROPERTY(bool configured READ configured NOTIFY configurationChanged)
    Q_PROPERTY(bool verified READ verified NOTIFY configurationChanged)
    Q_PROPERTY(int authAttemptsRemaining READ authAttemptsRemaining NOTIFY configurationChanged)
    Q_PROPERTY(QString endpoint READ endpoint NOTIFY configurationChanged)

public:
    DirectCameraClient(SettingsStore* settings, SecretVault* vault,
                       QObject* parent = nullptr);
    ~DirectCameraClient() override;

    QString status() const { return m_status; }
    QString error() const { return m_error; }
    bool configured() const;
    bool verified() const;
    int authAttemptsRemaining() const;
    QString endpoint() const;

    Q_INVOKABLE void configureAndStart(const QString& user, const QString& password,
                                       const QString& streamEndpoint = {});
    Q_INVOKABLE void start();
    Q_INVOKABLE void startIfVerified();
    Q_INVOKABLE void stop();
    Q_INVOKABLE void forgetCredentials();
    Q_INVOKABLE void resetAttemptGuard();
    Q_INVOKABLE void attachVideoSink(QVideoSink* sink);
    Q_INVOKABLE void detachVideoSink(QVideoSink* sink);

    // Analysis fan-out for SentryService: off by default because toImage()
    // costs a mapped copy per frame.
    void setAnalysisEnabled(bool enabled) { m_analysisEnabled = enabled; }

signals:
    void statusChanged();
    void configurationChanged();
    // Endpoint or credentials changed; background consumers must reconnect.
    void connectionConfigurationChanged();
    void analysisFrame(const QImage& frame);

private:
    static constexpr int kProtectedAttemptLimit = 2;
    static constexpr qint64 kAnalysisIntervalMs = 500;
    static constexpr int kOutputWidth = 640;
    static constexpr int kOutputHeight = 360;
    static constexpr int kOutputFrameBytes = kOutputWidth * kOutputHeight * 4;

    QUrl resolvedEndpoint() const;
    QUrl normalizeEndpoint(const QString& value) const;
    QByteArray configurationFingerprint() const;
    QString configurationFingerprintId() const;
    QJsonObject attemptHistory() const;
    int protectedAttempts() const;
    void writeProtectedAttempts(int attempts);
    void migrateLegacyAttemptState();
    void handleConfigurationChange();
    void handleDecoderOutput();
    void handleDecoderErrorOutput();
    void handleDecoderFinished(int exitCode, QProcess::ExitStatus exitStatus);
    void handleFrame(const QVideoFrame& frame);
    QString ffmpegExecutable() const;
    QString decoderFailureDetail() const;
    void setStatus(const QString& status, const QString& error = {});
    void setVerificationState(bool verified, int attempts);
    void fail(const QString& detail, bool authenticationRejected = false);
    void clearPlayer();
    QString sanitizedError(const QString& detail) const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    QProcess m_decoder;
    QPointer<QVideoSink> m_renderSink;
    QTimer m_firstFrameTimer;
    QTimer m_staleFrameTimer;
    QTimer m_reconnectTimer;
    QByteArray m_configFingerprint;
    QString m_status = QStringLiteral("setup");
    QString m_error;
    QByteArray m_decoderOutput;
    QByteArray m_decoderErrors;
    qint64 m_lastFrameAtMs = 0;
    qint64 m_lastAnalysisMs = 0;
    bool m_analysisEnabled = false;
    bool m_attemptActive = false;
    bool m_attemptWasVerified = false;
    bool m_receivedFrame = false;
    bool m_ignoreDecoderSignals = false;
    bool m_suppressConfigurationChange = false;
    int m_reconnectDelayMs = 2000;
};

} // namespace qtpanel
