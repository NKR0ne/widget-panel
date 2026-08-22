#pragma once

#include <QImage>
#include <QMutex>
#include <QNetworkAccessManager>
#include <QObject>
#include <QQuickImageProvider>
#include <QTimer>
#include <QVariantList>

#include <functional>

namespace qtpanel {

class SecretVault;
class SettingsStore;

// Provides the latest decoded camera frame to QML via image://camera/frame.
class CameraImageProvider : public QQuickImageProvider {
public:
    CameraImageProvider() : QQuickImageProvider(QQuickImageProvider::Image) {}
    QImage requestImage(const QString& id, QSize* size, const QSize& requested) override;
    void setFrame(const QImage& frame);

private:
    mutable QMutex m_frameMutex;
    QImage m_frame;
};

// Milestone XProtect mobile client: Connect (DH) → LogIn (encrypted creds) →
// RequestStream (Pull/Transcoded) → frame pull loop → JPEG frames. Port of the
// Electron CameraWidget's XPMobileSDK usage, native and Chromium-free.
class CameraClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QString error READ error NOTIFY statusChanged)
    Q_PROPERTY(bool configured READ configured NOTIFY statusChanged)
    Q_PROPERTY(int frameId READ frameId NOTIFY frameChanged)
    Q_PROPERTY(QVariantList cameras READ cameras NOTIFY camerasChanged)
    Q_PROPERTY(QString discoveryStatus READ discoveryStatus NOTIFY camerasChanged)

public:
    CameraClient(SettingsStore* settings, SecretVault* vault, CameraImageProvider* provider,
                 QObject* parent = nullptr);
    ~CameraClient() override;

    QString status() const { return m_status; }
    QString error() const { return m_error; }
    bool configured() const;
    int frameId() const { return m_frameId; }
    QVariantList cameras() const { return m_cameras; }
    QString discoveryStatus() const { return m_discoveryStatus; }

    // loginType: "Windows" | "Basic" | "" (SDK default). Empty user/pass reuses
    // the stored credentials.
    Q_INVOKABLE void start(const QString& user = {}, const QString& pass = {},
                           const QString& loginType = {});
    Q_INVOKABLE void stop();
    Q_INVOKABLE void forgetCredentials();
    Q_INVOKABLE void discoverCameras();

signals:
    void statusChanged();
    void frameChanged();
    void camerasChanged();
    // Decoded frame tap for analysis consumers (SentryService). The QML card
    // keeps using the image provider + frameChanged.
    void frameReady(const QImage& frame);

private:
    void setStatus(const QString& status, const QString& error = {});
    void connectStep();
    void loginStep();
    void discoverCamerasStep(std::function<void()> then);
    void requestStreamStep();
    void pullFrame();
    void scheduleNextFrame(int ms);
    void checkStaleFrame();
    void sendLiveMessage();
    void closeStream();

    void postCommand(const QString& name, const QMap<QString, QString>& params,
                     std::function<void(const QMap<QString, QString>&, const QString& error)> cb);
    void postCommandRaw(const QString& name, const QMap<QString, QString>& params,
                        std::function<void(const QString&, const QString& error)> cb);
    QNetworkRequest makeRequest(const QString& path) const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    CameraImageProvider* m_provider = nullptr;
    QNetworkAccessManager m_nam;

    QString m_baseUrl;
    QString m_cameraId;
    QString m_user;
    QString m_pass;
    QString m_loginType;
    QString m_authenticatedLoginType;
    QStringList m_loginAttempts;
    int m_loginAttemptIndex = 0;

    QString m_connectionId;
    QString m_videoId;
    int m_sequence = 0;
    int m_serverTimeoutSec = 30;

    QString m_status = QStringLiteral("idle");
    QString m_error;
    QVariantList m_cameras;
    QString m_discoveryStatus;
    int m_frameId = 0;
    int m_sessionFrameCount = 0;
    bool m_streaming = false;
    quint64 m_sessionGeneration = 0;

    QTimer m_frameTimer;
    QTimer m_liveMessageTimer;
    QTimer m_staleFrameTimer;
    qint64 m_lastFrameAtMs = 0;

    // Diffie-Hellman state lives in the .cpp to keep the header light.
    void* m_crypto = nullptr;
};

} // namespace qtpanel
