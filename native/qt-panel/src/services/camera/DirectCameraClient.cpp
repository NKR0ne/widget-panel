#include "DirectCameraClient.h"

#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDateTime>
#include <QDebug>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QUrl>
#include <QVideoFrame>

#include <algorithm>
#include <chrono>

namespace qtpanel {

namespace {
constexpr auto kPageKey = "wp-camera-direct-url";
constexpr auto kStreamKey = "wp-camera-direct-stream-url";
constexpr auto kUserKey = "wp-camera-direct-user";
constexpr auto kVerifiedKey = "wp-camera-direct-verified";
constexpr auto kAttemptsKey = "wp-camera-direct-auth-failures";
constexpr auto kAttemptHistoryKey = "wp-camera-direct-attempt-history";
constexpr auto kPasswordKey = "camera-direct-password";
constexpr auto kDefaultPage = "http://ipcam1.local/doc/page/preview.asp";
constexpr auto kDefaultPath = "/ISAPI/Streaming/channels/102";

QString withoutUserInfo(QUrl url)
{
    url.setUserName({});
    url.setPassword({});
    return url.toString(QUrl::FullyEncoded);
}
} // namespace

DirectCameraClient::DirectCameraClient(SettingsStore* settings, SecretVault* vault,
                                       QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_decoder(this)
{
    m_decoder.setProcessChannelMode(QProcess::SeparateChannels);
    connect(&m_decoder, &QProcess::readyReadStandardOutput,
            this, &DirectCameraClient::handleDecoderOutput);
    connect(&m_decoder, &QProcess::readyReadStandardError,
            this, &DirectCameraClient::handleDecoderErrorOutput);
    connect(&m_decoder, &QProcess::errorOccurred, this,
            [this](QProcess::ProcessError processError) {
        if (m_ignoreDecoderSignals || !m_attemptActive)
            return;
        if (processError == QProcess::FailedToStart) {
            clearPlayer();
            setStatus(QStringLiteral("error"),
                      QStringLiteral("The bundled FFmpeg decoder could not be started."));
        }
    });
    connect(&m_decoder, qOverload<int, QProcess::ExitStatus>(&QProcess::finished),
            this, &DirectCameraClient::handleDecoderFinished);

    m_firstFrameTimer.setSingleShot(true);
    m_firstFrameTimer.setInterval(25000);
    connect(&m_firstFrameTimer, &QTimer::timeout, this, [this] {
        if (m_attemptActive && !m_receivedFrame)
            fail(QStringLiteral("No video frame arrived within 25 seconds."));
    });

    m_staleFrameTimer.setInterval(5000);
    connect(&m_staleFrameTimer, &QTimer::timeout, this, [this] {
        if (!m_attemptActive || !m_receivedFrame)
            return;
        if (QDateTime::currentMSecsSinceEpoch() - m_lastFrameAtMs > 15000)
            fail(QStringLiteral("The camera stream stopped delivering frames."));
    });

    m_reconnectTimer.setSingleShot(true);
    connect(&m_reconnectTimer, &QTimer::timeout, this, [this] {
        if (!m_attemptActive && configured() && verified()) {
            qInfo() << "[camera-direct] retrying verified stream after transport failure";
            start();
        }
    });

    if (m_settings) {
        connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
            if (!key.startsWith(QLatin1String("wp-camera-direct-")))
                return;
            if (m_suppressConfigurationChange)
                return;
            if (key == QLatin1String(kPageKey) || key == QLatin1String(kStreamKey)
                || key == QLatin1String(kUserKey)) {
                handleConfigurationChange();
            } else {
                emit configurationChanged();
            }
        });
    }
    if (m_vault) {
        connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
            if (key == QLatin1String(kPasswordKey) && !m_suppressConfigurationChange)
                handleConfigurationChange();
        });
    }

    m_configFingerprint = configurationFingerprint();
    migrateLegacyAttemptState();
    if (!configured())
        m_status = QStringLiteral("setup");
    else if (!verified() && protectedAttempts() >= kProtectedAttemptLimit)
        m_status = QStringLiteral("blocked");
    else
        m_status = QStringLiteral("ready");

    qInfo() << "[camera-direct] endpoint" << endpoint()
            << "configured" << configured() << "verified" << verified()
            << "FFmpeg RTSP-over-TCP decoder";
}

DirectCameraClient::~DirectCameraClient()
{
    clearPlayer();
}

bool DirectCameraClient::configured() const
{
    if (!m_settings || !m_vault)
        return false;
    const QUrl stream = resolvedEndpoint();
    const QString scheme = stream.scheme().toLower();
    return stream.isValid() && !stream.host().isEmpty()
        && (scheme == QLatin1String("rtsp") || scheme == QLatin1String("rtsps"))
        && !m_settings->get(QLatin1String(kUserKey)).toString().trimmed().isEmpty()
        && !m_vault->get(QLatin1String(kPasswordKey)).isEmpty();
}

bool DirectCameraClient::verified() const
{
    return m_settings && m_settings->get(QLatin1String(kVerifiedKey), false).toBool();
}

int DirectCameraClient::protectedAttempts() const
{
    if (!m_settings)
        return 0;
    const QJsonObject history = attemptHistory();
    const QJsonObject entry = history.value(configurationFingerprintId()).toObject();
    if (entry.contains(QLatin1String("attempts"))) {
        return std::clamp(entry.value(QLatin1String("attempts")).toInt(),
                          0, kProtectedAttemptLimit);
    }
    if (!history.isEmpty())
        return 0;
    return std::clamp(m_settings->getInt(QLatin1String(kAttemptsKey), 0),
                      0, kProtectedAttemptLimit);
}

int DirectCameraClient::authAttemptsRemaining() const
{
    return std::max(0, kProtectedAttemptLimit - protectedAttempts());
}

QString DirectCameraClient::endpoint() const
{
    return withoutUserInfo(resolvedEndpoint());
}

QUrl DirectCameraClient::normalizeEndpoint(const QString& value) const
{
    const QString input = value.trimmed();
    QUrl url = QUrl::fromUserInput(input.isEmpty() ? QString::fromLatin1(kDefaultPage) : input);
    const QString scheme = url.scheme().toLower();

    if (scheme == QLatin1String("http") || scheme == QLatin1String("https")) {
        QUrl stream;
        stream.setScheme(QStringLiteral("rtsp"));
        stream.setHost(url.host());
        stream.setPort(554);
        stream.setPath(QString::fromLatin1(kDefaultPath));
        return stream;
    }

    if (scheme.isEmpty() && !input.isEmpty()) {
        QUrl stream;
        stream.setScheme(QStringLiteral("rtsp"));
        stream.setHost(input);
        stream.setPort(554);
        stream.setPath(QString::fromLatin1(kDefaultPath));
        return stream;
    }

    url.setUserName({});
    url.setPassword({});
    return url;
}

QUrl DirectCameraClient::resolvedEndpoint() const
{
    if (!m_settings)
        return normalizeEndpoint(QString::fromLatin1(kDefaultPage));
    const QString stream = m_settings->get(QLatin1String(kStreamKey)).toString().trimmed();
    if (!stream.isEmpty())
        return normalizeEndpoint(stream);
    const QString page = m_settings->get(QLatin1String(kPageKey),
                                         QString::fromLatin1(kDefaultPage)).toString();
    return normalizeEndpoint(page);
}

QByteArray DirectCameraClient::configurationFingerprint() const
{
    if (!m_settings || !m_vault)
        return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    hash.addData(endpoint().toUtf8());
    hash.addData(QByteArrayView("\0", 1));
    hash.addData(m_settings->get(QLatin1String(kUserKey)).toString().trimmed().toUtf8());
    hash.addData(QByteArrayView("\0", 1));
    hash.addData(m_vault->get(QLatin1String(kPasswordKey)).toUtf8());
    return hash.result();
}

QString DirectCameraClient::configurationFingerprintId() const
{
    return QString::fromLatin1(configurationFingerprint().toHex());
}

QJsonObject DirectCameraClient::attemptHistory() const
{
    if (!m_settings)
        return {};
    const QVariant stored = m_settings->get(QLatin1String(kAttemptHistoryKey));
    if (stored.metaType().id() == QMetaType::QString) {
        const QJsonDocument document = QJsonDocument::fromJson(stored.toString().toUtf8());
        return document.isObject() ? document.object() : QJsonObject{};
    }
    return QJsonObject::fromVariantMap(stored.toMap());
}

void DirectCameraClient::writeProtectedAttempts(int attempts)
{
    if (!m_settings)
        return;
    attempts = std::clamp(attempts, 0, kProtectedAttemptLimit);
    QJsonObject history = attemptHistory();
    const QString fingerprint = configurationFingerprintId();
    if (!fingerprint.isEmpty()) {
        if (attempts == 0) {
            history.remove(fingerprint);
        } else {
            QJsonObject entry;
            entry.insert(QStringLiteral("attempts"), attempts);
            entry.insert(QStringLiteral("updatedAt"),
                         QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
            history.insert(fingerprint, entry);
        }
    }

    const bool wasSuppressed = m_suppressConfigurationChange;
    m_suppressConfigurationChange = true;
    m_settings->set(QLatin1String(kAttemptHistoryKey),
                    QString::fromUtf8(QJsonDocument(history).toJson(QJsonDocument::Compact)));
    m_settings->set(QLatin1String(kAttemptsKey), attempts);
    m_suppressConfigurationChange = wasSuppressed;
}

void DirectCameraClient::migrateLegacyAttemptState()
{
    if (!m_settings || !configured())
        return;
    const int legacyAttempts = std::clamp(
        m_settings->getInt(QLatin1String(kAttemptsKey), 0), 0, kProtectedAttemptLimit);
    const QString fingerprint = configurationFingerprintId();
    if (legacyAttempts == 0 || attemptHistory().contains(fingerprint))
        return;
    writeProtectedAttempts(legacyAttempts);
    qInfo() << "[camera-direct] migrated protected-attempt state for current credentials";
}

void DirectCameraClient::configureAndStart(const QString& user, const QString& password,
                                           const QString& streamEndpoint)
{
    if (!m_settings || !m_vault)
        return;

    const QString cleanUser = user.trimmed();
    const QString retainedPassword = password.isEmpty()
        ? m_vault->get(QLatin1String(kPasswordKey)) : password;
    const QUrl cleanEndpoint = normalizeEndpoint(streamEndpoint.isEmpty()
                                                    ? endpoint() : streamEndpoint);
    const QString scheme = cleanEndpoint.scheme().toLower();
    if (cleanUser.isEmpty() || retainedPassword.isEmpty()) {
        setStatus(QStringLiteral("setup"),
                  QStringLiteral("A camera username and password are required."));
        return;
    }
    if (!cleanEndpoint.isValid() || cleanEndpoint.host().isEmpty()
        || (scheme != QLatin1String("rtsp") && scheme != QLatin1String("rtsps"))) {
        setStatus(QStringLiteral("error"),
                  QStringLiteral("Enter a valid rtsp:// stream endpoint."));
        return;
    }

    const QByteArray before = configurationFingerprint();
    m_suppressConfigurationChange = true;
    m_settings->set(QLatin1String(kStreamKey), withoutUserInfo(cleanEndpoint));
    m_settings->set(QLatin1String(kUserKey), cleanUser);
    if (!password.isEmpty())
        m_vault->set(QLatin1String(kPasswordKey), password);
    m_suppressConfigurationChange = false;

    m_configFingerprint = configurationFingerprint();
    if (m_configFingerprint != before)
        setVerificationState(false, protectedAttempts());
    emit configurationChanged();
    emit connectionConfigurationChanged();
    start();
}

void DirectCameraClient::startIfVerified()
{
    if (configured() && verified() && !m_attemptActive)
        start();
}

void DirectCameraClient::start()
{
    if (!configured()) {
        setStatus(QStringLiteral("setup"),
                  QStringLiteral("Configure the direct camera credentials first."));
        return;
    }
    if (!verified() && protectedAttempts() >= kProtectedAttemptLimit) {
        setStatus(QStringLiteral("blocked"),
                  QStringLiteral("Connection is locked after two protected attempts. Verify or change the credentials before trying again."));
        return;
    }

    const QString decoderPath = ffmpegExecutable();
    if (decoderPath.isEmpty()) {
        clearPlayer();
        setStatus(QStringLiteral("error"),
                  QStringLiteral("FFmpeg is not installed for QtPanel. Run install-ffmpeg.ps1, then rebuild or relaunch."));
        return;
    }

    clearPlayer();
    m_attemptWasVerified = verified();
    m_receivedFrame = false;
    m_attemptActive = true;
    m_lastFrameAtMs = 0;

    if (!m_attemptWasVerified)
        setVerificationState(false, protectedAttempts() + 1);

    QUrl source = resolvedEndpoint();
    source.setUserName(m_settings->get(QLatin1String(kUserKey)).toString().trimmed());
    source.setPassword(m_vault->get(QLatin1String(kPasswordKey)));

    setStatus(QStringLiteral("connecting"));
    qInfo() << "[camera-direct] FFmpeg TCP stream connection to" << endpoint()
            << "remaining protected attempts" << authAttemptsRemaining();

    const QString videoFilter = QStringLiteral(
        "fps=15,scale=%1:%2:force_original_aspect_ratio=decrease,"
        "pad=%1:%2:(ow-iw)/2:(oh-ih)/2:black")
        .arg(kOutputWidth).arg(kOutputHeight);
    const QStringList arguments = {
        QStringLiteral("-hide_banner"),
        QStringLiteral("-loglevel"), QStringLiteral("warning"),
        QStringLiteral("-nostdin"),
        QStringLiteral("-rtsp_transport"), QStringLiteral("tcp"),
        QStringLiteral("-rtsp_flags"), QStringLiteral("prefer_tcp"),
        QStringLiteral("-timeout"), QStringLiteral("20000000"),
        QStringLiteral("-fflags"), QStringLiteral("+discardcorrupt"),
        QStringLiteral("-threads"), QStringLiteral("2"),
        QStringLiteral("-i"), source.toString(QUrl::FullyEncoded),
        QStringLiteral("-map"), QStringLiteral("0:v:0"),
        QStringLiteral("-an"), QStringLiteral("-sn"), QStringLiteral("-dn"),
        QStringLiteral("-vf"), videoFilter,
        QStringLiteral("-c:v"), QStringLiteral("rawvideo"),
        QStringLiteral("-pix_fmt"), QStringLiteral("bgra"),
        QStringLiteral("-f"), QStringLiteral("rawvideo"),
        QStringLiteral("pipe:1")
    };
    m_decoder.setProgram(decoderPath);
    m_decoder.setArguments(arguments);
    m_decoder.start(QIODevice::ReadOnly);
    m_firstFrameTimer.start();
}

void DirectCameraClient::stop()
{
    clearPlayer();
    m_reconnectDelayMs = 2000;
    setStatus(configured() ? QStringLiteral("stopped") : QStringLiteral("setup"));
}

void DirectCameraClient::forgetCredentials()
{
    clearPlayer();
    if (!m_settings || !m_vault)
        return;
    m_suppressConfigurationChange = true;
    m_settings->remove(QLatin1String(kUserKey));
    m_settings->remove(QLatin1String(kVerifiedKey));
    m_settings->set(QLatin1String(kAttemptsKey), 0);
    m_vault->remove(QLatin1String(kPasswordKey));
    m_suppressConfigurationChange = false;
    m_configFingerprint = configurationFingerprint();
    setStatus(QStringLiteral("setup"));
    emit configurationChanged();
    emit connectionConfigurationChanged();
}

void DirectCameraClient::resetAttemptGuard()
{
    if (!configured())
        return;
    setVerificationState(false, 0);
    setStatus(QStringLiteral("ready"),
              QStringLiteral("Attempt guard reset. No camera connection was made."));
}

void DirectCameraClient::attachVideoSink(QVideoSink* sink)
{
    if (m_renderSink == sink)
        return;
    if (m_renderSink)
        m_renderSink->setVideoFrame({});
    m_renderSink = sink;
    if (m_renderSink)
        m_renderSink->setVideoFrame({});
}

void DirectCameraClient::detachVideoSink(QVideoSink* sink)
{
    if (m_renderSink != sink)
        return;
    if (m_renderSink)
        m_renderSink->setVideoFrame({});
    m_renderSink.clear();
}

void DirectCameraClient::handleConfigurationChange()
{
    const QByteArray fingerprint = configurationFingerprint();
    if (fingerprint == m_configFingerprint) {
        emit configurationChanged();
        return;
    }

    clearPlayer();
    m_configFingerprint = fingerprint;
    setVerificationState(false, protectedAttempts());
    setStatus(configured() ? QStringLiteral("ready") : QStringLiteral("setup"));
    emit configurationChanged();
    emit connectionConfigurationChanged();
}

void DirectCameraClient::handleDecoderOutput()
{
    if (m_ignoreDecoderSignals || !m_attemptActive)
        return;

    m_decoderOutput.append(m_decoder.readAllStandardOutput());
    qsizetype consumed = 0;
    while (m_decoderOutput.size() - consumed >= kOutputFrameBytes) {
        const uchar* pixels = reinterpret_cast<const uchar*>(m_decoderOutput.constData() + consumed);
        const QImage view(pixels, kOutputWidth, kOutputHeight,
                          kOutputWidth * 4, QImage::Format_ARGB32);
        handleFrame(QVideoFrame(view.copy()));
        consumed += kOutputFrameBytes;
    }
    if (consumed > 0)
        m_decoderOutput.remove(0, consumed);
}

void DirectCameraClient::handleDecoderErrorOutput()
{
    if (m_ignoreDecoderSignals)
        return;
    m_decoderErrors.append(m_decoder.readAllStandardError());
    constexpr qsizetype kMaximumErrorBytes = 16 * 1024;
    if (m_decoderErrors.size() > kMaximumErrorBytes)
        m_decoderErrors = m_decoderErrors.right(kMaximumErrorBytes);
}

void DirectCameraClient::handleDecoderFinished(int exitCode, QProcess::ExitStatus exitStatus)
{
    if (m_ignoreDecoderSignals || !m_attemptActive)
        return;
    handleDecoderErrorOutput();
    const QString detail = decoderFailureDetail();
    const bool authenticationRejected = detail.contains(
        QLatin1String("401 Unauthorized"), Qt::CaseInsensitive)
        || detail.contains(QLatin1String("authentication failed"), Qt::CaseInsensitive)
        || detail.contains(QLatin1String("authorization failed"), Qt::CaseInsensitive);
    qWarning() << "[camera-direct] FFmpeg exited" << exitCode << exitStatus
               << sanitizedError(detail);
    fail(authenticationRejected
             ? QStringLiteral("Camera authentication rejected (401 Unauthorized). Verify the direct-camera username and password before rearming.")
             : detail,
         authenticationRejected);
}

void DirectCameraClient::handleFrame(const QVideoFrame& frame)
{
    if (m_renderSink)
        m_renderSink->setVideoFrame(frame);
    if (!m_attemptActive || !frame.isValid())
        return;

    m_lastFrameAtMs = QDateTime::currentMSecsSinceEpoch();

    // Analysis fan-out (SentryService). toImage() maps the frame, so it only
    // runs when a consumer asked for it and never faster than 2 Hz; the render
    // sink above is untouched.
    if (m_analysisEnabled
        && m_lastFrameAtMs - m_lastAnalysisMs >= kAnalysisIntervalMs) {
        const QImage image = frame.toImage();
        if (!image.isNull()) {
            m_lastAnalysisMs = m_lastFrameAtMs;
            emit analysisFrame(image);
        }
    }
    if (m_receivedFrame)
        return;

    m_receivedFrame = true;
    m_reconnectDelayMs = 2000;
    m_firstFrameTimer.stop();
    m_staleFrameTimer.start();
    setVerificationState(true, 0);
    setStatus(QStringLiteral("streaming"));
    qInfo() << "[camera-direct] first frame received; configuration verified";
}

QString DirectCameraClient::ffmpegExecutable() const
{
    const QString adjacent = QDir(QCoreApplication::applicationDirPath())
        .filePath(QStringLiteral("ffmpeg.exe"));
    if (QFileInfo::exists(adjacent))
        return adjacent;
    return QStandardPaths::findExecutable(QStringLiteral("ffmpeg.exe"));
}

QString DirectCameraClient::decoderFailureDetail() const
{
    const QString detail = QString::fromUtf8(m_decoderErrors).trimmed();
    if (!detail.isEmpty())
        return sanitizedError(detail);
    return QStringLiteral("The FFmpeg RTSP-over-TCP decoder stopped unexpectedly.");
}

void DirectCameraClient::setStatus(const QString& status, const QString& error)
{
    if (m_status == status && m_error == error)
        return;
    m_status = status;
    m_error = error;
    emit statusChanged();
}

void DirectCameraClient::setVerificationState(bool isVerified, int attempts)
{
    if (!m_settings)
        return;
    m_suppressConfigurationChange = true;
    m_settings->set(QLatin1String(kVerifiedKey), isVerified);
    writeProtectedAttempts(attempts);
    m_suppressConfigurationChange = false;
    emit configurationChanged();
}

void DirectCameraClient::fail(const QString& detail, bool authenticationRejected)
{
    // A known-good configuration must not lose verification because the LAN
    // dropped packets or FFmpeg's demuxer timed out. Only a positive auth
    // rejection can consume the protected credential guard.
    if (authenticationRejected && m_attemptWasVerified)
        setVerificationState(false, 1);

    const QString safeDetail = detail.isEmpty()
        ? QStringLiteral("The camera stream could not be opened.") : sanitizedError(detail);
    clearPlayer();
    const bool blocked = !verified() && protectedAttempts() >= kProtectedAttemptLimit;
    setStatus(blocked ? QStringLiteral("blocked") : QStringLiteral("error"), safeDetail);
    qWarning() << "[camera-direct] stream stopped:" << safeDetail
               << "remaining protected attempts" << authAttemptsRemaining();

    if (!authenticationRejected && configured() && verified()) {
        const int delayMs = m_reconnectDelayMs;
        m_reconnectTimer.start(delayMs);
        m_reconnectDelayMs = std::min(m_reconnectDelayMs * 2, 30000);
        qInfo() << "[camera-direct] verified transport reconnect scheduled in"
                << delayMs << "ms";
    }
}

void DirectCameraClient::clearPlayer()
{
    m_attemptActive = false;
    m_firstFrameTimer.stop();
    m_staleFrameTimer.stop();
    m_reconnectTimer.stop();
    m_ignoreDecoderSignals = true;
    if (m_decoder.state() != QProcess::NotRunning) {
        m_decoder.kill();
        m_decoder.waitForFinished(1000);
    }
    m_decoder.close();
    m_decoder.setProgram({});
    m_decoder.setArguments({});
    m_decoderOutput.clear();
    m_decoderErrors.clear();
    if (m_renderSink)
        m_renderSink->setVideoFrame({});
    m_ignoreDecoderSignals = false;
    m_lastFrameAtMs = 0;
}

QString DirectCameraClient::sanitizedError(const QString& detail) const
{
    QString clean = detail.trimmed();
    if (m_settings) {
        const QString user = m_settings->get(QLatin1String(kUserKey)).toString();
        if (!user.isEmpty())
            clean.replace(user, QStringLiteral("***"), Qt::CaseSensitive);
    }
    if (m_vault) {
        const QString password = m_vault->get(QLatin1String(kPasswordKey));
        if (!password.isEmpty())
            clean.replace(password, QStringLiteral("***"), Qt::CaseSensitive);
    }
    clean.replace(QRegularExpression(
                      QStringLiteral("((?:rtsp|rtsps)://)[^\\s/@]+@"),
                      QRegularExpression::CaseInsensitiveOption),
                  QStringLiteral("\\1"));
    return clean.left(240);
}

} // namespace qtpanel
