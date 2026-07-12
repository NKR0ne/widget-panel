#include "CameraClient.h"

#include "XpCrypto.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QDebug>
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMutexLocker>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QSet>
#include <QSslConfiguration>

namespace qtpanel {

namespace {
const char kDefaultBaseUrl[] = "https://securitycenter.local:8082";
const char kDefaultCameraId[] = "11ae9771-dcc4-430b-b47c-20caa6175566";
const char kCommChannel[] = "/XProtectMobile/Communication";
const char kVideoChannel[] = "/XProtectMobile/Video";
constexpr int kFrameIntervalMs = 90; // ~11 fps pull cadence
constexpr int kFirstFrameReconnectMs = 10000;
constexpr int kStaleReconnectMs = 30000;

bool isInvalidCredentialsError(const QString& error)
{
    static const QRegularExpression re(
        QStringLiteral("(?:code\\s*15\\b|invalid\\s*credentials)"),
        QRegularExpression::CaseInsensitiveOption);
    return re.match(error).hasMatch();
}

QString xmlEscape(QString v) {
    v.replace(QLatin1Char('&'), QLatin1String("&amp;"));
    v.replace(QLatin1Char('<'), QLatin1String("&lt;"));
    v.replace(QLatin1Char('"'), QLatin1String("&quot;"));
    return v;
}

QString paramValue(const QString& xml, const QString& name) {
    // <Param Name="X" Value="Y" /> in either attribute order.
    QRegularExpression re(
        QStringLiteral("<Param[^>]*Name=\"%1\"[^>]*Value=\"([^\"]*)\"").arg(name),
        QRegularExpression::CaseInsensitiveOption);
    auto m = re.match(xml);
    if (m.hasMatch())
        return m.captured(1);
    re.setPattern(QStringLiteral("<Param[^>]*Value=\"([^\"]*)\"[^>]*Name=\"%1\"").arg(name));
    return re.match(xml).captured(1);
}

QMap<QString, QString> parseOutputParams(const QString& xml) {
    QMap<QString, QString> out;
    QRegularExpression re(QStringLiteral("<Param\\s+Name=\"([^\"]*)\"\\s+Value=\"([^\"]*)\""),
                          QRegularExpression::CaseInsensitiveOption);
    auto it = re.globalMatch(xml);
    while (it.hasNext()) {
        auto m = it.next();
        out.insert(m.captured(1), m.captured(2));
    }
    return out;
}

QString xmlAttr(const QString& xml, const QString& name)
{
    QRegularExpression re(QStringLiteral("\\b%1=\"([^\"]*)\"").arg(name),
                          QRegularExpression::CaseInsensitiveOption);
    return re.match(xml).captured(1);
}

QString xmlTag(const QString& xml, const QString& name)
{
    QRegularExpression re(QStringLiteral("<%1[^>]*>([^<]*)</%1>").arg(name),
                          QRegularExpression::CaseInsensitiveOption);
    return re.match(xml).captured(1).trimmed();
}

QVariantList parseCameraItems(const QString& xml)
{
    QVariantList out;
    QSet<QString> seen;
    const QRegularExpression itemRe(QStringLiteral("<Item\\b[^>]*(?:/>|>[\\s\\S]*?</Item>)"),
                                    QRegularExpression::CaseInsensitiveOption);
    auto it = itemRe.globalMatch(xml);
    while (it.hasNext()) {
        const QString item = it.next().captured(0);
        QString type = xmlAttr(item, QStringLiteral("Type"));
        if (type.isEmpty())
            type = xmlTag(item, QStringLiteral("Type"));
        if (type.compare(QStringLiteral("Camera"), Qt::CaseInsensitive) != 0)
            continue;

        QString id = xmlAttr(item, QStringLiteral("Id"));
        if (id.isEmpty())
            id = xmlAttr(item, QStringLiteral("ID"));
        if (id.isEmpty())
            id = xmlTag(item, QStringLiteral("Id"));
        if (id.isEmpty() || seen.contains(id))
            continue;
        seen.insert(id);

        QString name = xmlAttr(item, QStringLiteral("Name"));
        if (name.isEmpty())
            name = xmlTag(item, QStringLiteral("Name"));
        out.append(QVariantMap{
            {QStringLiteral("id"), id},
            {QStringLiteral("name"), name.isEmpty() ? id : name},
        });
    }
    return out;
}
} // namespace

// ── Image provider ───────────────────────────────────────────────────────────
QImage CameraImageProvider::requestImage(const QString& id, QSize* size, const QSize&)
{
    Q_UNUSED(id)
    QMutexLocker locker(&m_frameMutex);
    if (size)
        *size = m_frame.size();
    return m_frame;
}

void CameraImageProvider::setFrame(const QImage& frame)
{
    QMutexLocker locker(&m_frameMutex);
    m_frame = frame;
}

// ── Client ───────────────────────────────────────────────────────────────────
CameraClient::CameraClient(SettingsStore* settings, SecretVault* vault,
                           CameraImageProvider* provider, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_provider(provider)
{
    m_baseUrl = settings->get(QStringLiteral("wp-camera-url"),
                              QLatin1String(kDefaultBaseUrl)).toString();
    m_cameraId = settings->get(QStringLiteral("wp-camera-id"),
                               QLatin1String(kDefaultCameraId)).toString();

    m_frameTimer.setSingleShot(true);
    connect(&m_frameTimer, &QTimer::timeout, this, &CameraClient::pullFrame);

    m_liveMessageTimer.setInterval(5000);
    connect(&m_liveMessageTimer, &QTimer::timeout, this, &CameraClient::sendLiveMessage);

    m_staleFrameTimer.setInterval(5000);
    connect(&m_staleFrameTimer, &QTimer::timeout, this, &CameraClient::checkStaleFrame);

    m_nam.setTransferTimeout(30000);
}

CameraClient::~CameraClient()
{
    ++m_sessionGeneration;
    const auto replies = m_nam.findChildren<QNetworkReply*>();
    for (QNetworkReply* reply : replies)
        reply->abort();
    delete static_cast<XpCrypto*>(m_crypto);
    m_crypto = nullptr;
}

bool CameraClient::configured() const
{
    const QJsonObject creds = QJsonDocument::fromJson(
        m_settings->get(QStringLiteral("wp-camera-auth")).toString().toUtf8()).object();
    return !creds.value(QLatin1String("u")).toString().isEmpty()
           && m_vault->has(QStringLiteral("camera-password"));
}

void CameraClient::setStatus(const QString& status, const QString& error)
{
    m_status = status;
    m_error = error;
    emit statusChanged();
    if (!error.isEmpty())
        qWarning() << "[camera]" << status << "-" << error;
    else
        qInfo() << "[camera]" << status;
}

QNetworkRequest CameraClient::makeRequest(const QString& path) const
{
    QNetworkRequest req(QUrl(m_baseUrl + path));
    // securitycenter.local presents a self-signed cert on the LAN.
    QSslConfiguration ssl = QSslConfiguration::defaultConfiguration();
    ssl.setPeerVerifyMode(QSslSocket::VerifyNone);
    req.setSslConfiguration(ssl);
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("text/xml"));
    return req;
}

void CameraClient::start(const QString& user, const QString& pass, const QString& loginType)
{
    stop();
    // Re-read connection settings so editors take effect on reconnect.
    m_baseUrl = m_settings->get(QStringLiteral("wp-camera-url"),
                                QLatin1String(kDefaultBaseUrl)).toString();
    m_cameraId = m_settings->get(QStringLiteral("wp-camera-id"),
                                 QLatin1String(kDefaultCameraId)).toString();

    if (!user.isEmpty()) {
        m_user = user;
        m_pass = pass;
        m_loginType = loginType;
        // Username/loginType in settings; password only in the vault.
        const QJsonObject creds{
            {QStringLiteral("u"), user},
            {QStringLiteral("loginType"), loginType},
        };
        m_settings->set(QStringLiteral("wp-camera-auth"),
                        QString::fromUtf8(QJsonDocument(creds).toJson(QJsonDocument::Compact)));
        m_vault->set(QStringLiteral("camera-password"), pass);
    } else {
        const QJsonObject creds = QJsonDocument::fromJson(
            m_settings->get(QStringLiteral("wp-camera-auth")).toString().toUtf8()).object();
        m_user = creds.value(QLatin1String("u")).toString();
        m_pass = m_vault->get(QStringLiteral("camera-password"));
        m_loginType = creds.value(QLatin1String("loginType")).toString();
    }
    if (m_user.isEmpty()) {
        setStatus(QStringLiteral("error"), QStringLiteral("No credentials"));
        return;
    }

    // Login fallback order, mirroring the Electron widget's 'auto' mode.
    if (m_loginType.isEmpty() || m_loginType == QLatin1String("auto"))
        m_loginAttempts = {QStringLiteral("Windows"), QStringLiteral("Basic"), QString()};
    else
        m_loginAttempts = {m_loginType};
    m_loginAttemptIndex = 0;

    connectStep();
}

void CameraClient::stop()
{
    ++m_sessionGeneration;
    const auto replies = m_nam.findChildren<QNetworkReply*>();
    for (QNetworkReply* reply : replies)
        reply->abort();
    m_frameTimer.stop();
    m_liveMessageTimer.stop();
    m_staleFrameTimer.stop();
    m_streaming = false;
    m_sessionFrameCount = 0;
    m_lastFrameAtMs = 0;
    if (!m_videoId.isEmpty())
        closeStream();
    delete static_cast<XpCrypto*>(m_crypto);
    m_crypto = nullptr;
    m_connectionId.clear();
    m_videoId.clear();
    m_authenticatedLoginType.clear();
}

void CameraClient::forgetCredentials()
{
    stop();
    m_settings->remove(QStringLiteral("wp-camera-auth"));
    m_vault->remove(QStringLiteral("camera-password"));
    m_user.clear();
    m_pass.clear();
    m_loginType.clear();
    setStatus(QStringLiteral("idle"));
}

void CameraClient::discoverCameras()
{
    if (m_connectionId.isEmpty()) {
        start();
        return;
    }
    discoverCamerasStep([] {});
}

void CameraClient::postCommand(const QString& name, const QMap<QString, QString>& params,
                               std::function<void(const QMap<QString, QString>&, const QString&)> cb)
{
    postCommandRaw(name, params, [cb](const QString& chosen, const QString& error) {
        if (!error.isEmpty()) {
            cb({}, error);
            return;
        }
        if (chosen.contains(QStringLiteral("<Result>Error</Result>"))) {
            const QString code = chosen.section(QStringLiteral("<ErrorCode>"), 1, 1)
                                      .section(QStringLiteral("</ErrorCode>"), 0, 0);
            cb({}, QStringLiteral("Command error (code %1)").arg(code));
            return;
        }
        cb(parseOutputParams(chosen.section(QStringLiteral("<OutputParams"), 1)), QString());
    });
}

void CameraClient::postCommandRaw(const QString& name, const QMap<QString, QString>& params,
                                  std::function<void(const QString&, const QString&)> cb)
{
    const quint64 generation = m_sessionGeneration;
    QString body = QStringLiteral("<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        "<Communication xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" "
        "xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\">");
    if (!m_connectionId.isEmpty())
        body += QStringLiteral("<ConnectionId>%1</ConnectionId>").arg(m_connectionId);
    body += QStringLiteral("<Command SequenceId=\"%1\"><Type>Request</Type><Name>%2</Name><InputParams>")
                .arg(++m_sequence).arg(name);
    for (auto it = params.constBegin(); it != params.constEnd(); ++it)
        body += QStringLiteral("<Param Name=\"%1\" Value=\"%2\" />").arg(it.key(), xmlEscape(it.value()));
    body += QStringLiteral("</InputParams></Command></Communication>\r\n\r\n");

    QNetworkReply* reply = m_nam.post(makeRequest(QLatin1String(kCommChannel)), body.toUtf8());
    connect(reply, &QNetworkReply::sslErrors, reply,
            [reply](const QList<QSslError>&) { reply->ignoreSslErrors(); });
    connect(reply, &QNetworkReply::finished, this, [this, reply, generation, cb] {
        reply->deleteLater();
        if (generation != m_sessionGeneration)
            return;
        if (reply->error() != QNetworkReply::NoError) {
            cb({}, reply->errorString());
            return;
        }
        const QString text = QString::fromUtf8(reply->readAll());
        // Take the last non-processing response document.
        QString chosen = text;
        const QStringList docs = text.split(QStringLiteral("\r\n\r\n"), Qt::SkipEmptyParts);
        for (const QString& doc : docs) {
            if (!doc.contains(QStringLiteral("<Result>Processing</Result>")))
                chosen = doc;
        }
        cb(chosen, QString());
    });
}

void CameraClient::connectStep()
{
    setStatus(QStringLiteral("connecting"));
    delete static_cast<XpCrypto*>(m_crypto);
    auto* crypto = new XpCrypto();
    m_crypto = crypto;
    m_connectionId.clear();

    postCommand(QStringLiteral("Connect"), {
        {QStringLiteral("ProcessingMessage"), QStringLiteral("No")},
        {QStringLiteral("PublicKey"), crypto->createPublicKey()},
        {QStringLiteral("PrimeLength"), QStringLiteral("1024")},
        {QStringLiteral("EncryptionPadding"), QStringLiteral("ISO10126")},
    }, [this, crypto](const QMap<QString, QString>& out, const QString& error) {
        if (!error.isEmpty()) {
            setStatus(QStringLiteral("error"), error);
            return;
        }
        m_connectionId = out.value(QStringLiteral("ConnectionId"));
        m_serverTimeoutSec = out.value(QStringLiteral("Timeout"), QStringLiteral("30")).toInt();
        crypto->setServerPublicKey(out.value(QStringLiteral("PublicKey")));
        if (!crypto->ready()) {
            setStatus(QStringLiteral("error"), QStringLiteral("Key exchange failed"));
            return;
        }
        loginStep();
    });
}

void CameraClient::loginStep()
{
    auto* crypto = static_cast<XpCrypto*>(m_crypto);
    const QString attempt = m_loginAttempts.value(m_loginAttemptIndex);
    setStatus(QStringLiteral("login"));

    QMap<QString, QString> params{
        {QStringLiteral("Username"), crypto->encodeString(m_user)},
        {QStringLiteral("Password"), crypto->encodeString(m_pass)},
        {QStringLiteral("SupportsResampling"), QStringLiteral("Yes")},
    };
    if (!attempt.isEmpty())
        params.insert(QStringLiteral("LoginType"), attempt);

    postCommand(QStringLiteral("LogIn"), params,
                [this](const QMap<QString, QString>&, const QString& error) {
        if (!error.isEmpty()) {
            const bool invalidCredentials = isInvalidCredentialsError(error);
            // Probe alternate login types only for an explicit credential-type
            // rejection. Network/server errors must not consume auth attempts.
            if (invalidCredentials && ++m_loginAttemptIndex < m_loginAttempts.size()) {
                qInfo() << "[camera] login retry as"
                        << (m_loginAttempts.value(m_loginAttemptIndex).isEmpty()
                                ? QStringLiteral("default")
                                : m_loginAttempts.value(m_loginAttemptIndex));
                connectStep();
            } else {
                if (invalidCredentials) {
                    m_settings->remove(QStringLiteral("wp-camera-auth"));
                    m_vault->remove(QStringLiteral("camera-password"));
                    m_user.clear();
                    m_pass.clear();
                    m_loginType.clear();
                    qWarning() << "[camera] rejected credentials cleared after bounded attempts";
                }
                setStatus(QStringLiteral("error"), error);
            }
            return;
        }
        // Persist the accepted login type only after RequestStream confirms
        // that this session can access the selected camera.
        m_authenticatedLoginType = m_loginAttempts.value(m_loginAttemptIndex);
        m_liveMessageTimer.start();
        discoverCamerasStep([this] { requestStreamStep(); });
    });
}

void CameraClient::discoverCamerasStep(std::function<void()> then)
{
    m_discoveryStatus = QStringLiteral("Discovering cameras");
    emit camerasChanged();
    postCommandRaw(QStringLiteral("GetItems"), {}, [this, then](const QString& xml, const QString& error) {
        if (!error.isEmpty() || xml.contains(QStringLiteral("<Result>Error</Result>"))) {
            m_discoveryStatus = error.isEmpty()
                ? QStringLiteral("Camera discovery unavailable")
                : QStringLiteral("Camera discovery failed: %1").arg(error);
            emit camerasChanged();
            qWarning() << "[camera]" << m_discoveryStatus;
            then();
            return;
        }

        m_cameras = parseCameraItems(xml);
        if (m_cameras.isEmpty()) {
            m_discoveryStatus = QStringLiteral("No cameras discovered");
            emit camerasChanged();
            qWarning() << "[camera] no cameras found in GetItems response";
            then();
            return;
        }

        const QString savedId = m_settings->get(QStringLiteral("wp-camera-id"),
                                                QLatin1String(kDefaultCameraId)).toString();
        const QString hint = m_settings->get(QStringLiteral("wp-camera-name-hint"),
                                             QStringLiteral("HikVision")).toString();
        QVariantMap chosen;
        for (const QVariant& value : m_cameras) {
            const QVariantMap cam = value.toMap();
            if (cam.value(QStringLiteral("id")).toString() == savedId) {
                chosen = cam;
                break;
            }
        }
        if (chosen.isEmpty() && !hint.isEmpty()) {
            for (const QVariant& value : m_cameras) {
                const QVariantMap cam = value.toMap();
                if (cam.value(QStringLiteral("name")).toString()
                        .contains(hint, Qt::CaseInsensitive)) {
                    chosen = cam;
                    break;
                }
            }
        }
        if (chosen.isEmpty())
            chosen = m_cameras.first().toMap();

        const QString nextId = chosen.value(QStringLiteral("id")).toString();
        const QString nextName = chosen.value(QStringLiteral("name")).toString();
        if (!nextId.isEmpty()) {
            m_cameraId = nextId;
            m_settings->set(QStringLiteral("wp-camera-id"), nextId);
            m_settings->set(QStringLiteral("wp-camera-name"), nextName);
        }
        m_discoveryStatus = QStringLiteral("%1 cameras; selected %2")
            .arg(m_cameras.size())
            .arg(nextName.isEmpty() ? nextId : nextName);
        emit camerasChanged();
        qInfo() << "[camera]" << m_discoveryStatus;
        then();
    });
}

void CameraClient::requestStreamStep()
{
    postCommand(QStringLiteral("RequestStream"), {
        {QStringLiteral("CameraId"), m_cameraId},
        {QStringLiteral("DestWidth"), QStringLiteral("640")},
        {QStringLiteral("DestHeight"), QStringLiteral("360")},
        {QStringLiteral("SignalType"), QStringLiteral("Live")},
        {QStringLiteral("MethodType"), QStringLiteral("Pull")},
        {QStringLiteral("Fps"), QStringLiteral("15")},
        {QStringLiteral("ComprLevel"), QStringLiteral("70")},
        {QStringLiteral("KeyFramesOnly"), QStringLiteral("No")},
        {QStringLiteral("RequestSize"), QStringLiteral("Yes")},
        {QStringLiteral("StreamType"), QStringLiteral("Transcoded")},
    }, [this](const QMap<QString, QString>& out, const QString& error) {
        if (!error.isEmpty()) {
            setStatus(QStringLiteral("error"), error);
            return;
        }
        m_videoId = out.value(QStringLiteral("VideoId"));
        if (m_videoId.isEmpty()) {
            setStatus(QStringLiteral("error"), QStringLiteral("No VideoId in stream response"));
            return;
        }
        const QJsonObject creds{
            {QStringLiteral("u"), m_user},
            {QStringLiteral("loginType"), m_authenticatedLoginType},
        };
        m_settings->set(QStringLiteral("wp-camera-auth"),
                        QString::fromUtf8(QJsonDocument(creds).toJson(QJsonDocument::Compact)));
        m_streaming = true;
        m_sessionFrameCount = 0;
        m_lastFrameAtMs = QDateTime::currentMSecsSinceEpoch();
        m_staleFrameTimer.start();
        setStatus(QStringLiteral("streaming"));
        pullFrame();
    });
}

void CameraClient::pullFrame()
{
    if (!m_streaming || m_videoId.isEmpty())
        return;
    const quint64 generation = m_sessionGeneration;
    const QString path = QStringLiteral("%1/%2/").arg(QLatin1String(kVideoChannel), m_videoId);
    QNetworkReply* reply = m_nam.post(makeRequest(path), QByteArray());
    connect(reply, &QNetworkReply::sslErrors, reply,
            [reply](const QList<QSslError>&) { reply->ignoreSslErrors(); });
    connect(reply, &QNetworkReply::finished, this, [this, reply, generation] {
        reply->deleteLater();
        if (generation != m_sessionGeneration || !m_streaming)
            return;
        if (reply->error() != QNetworkReply::NoError) {
            scheduleNextFrame(1000);
            return;
        }
        const QByteArray data = reply->readAll();
        // Frame header (ItemHeaderParser): dataSize @28 (u32 LE), headerSize @32 (u16 LE).
        if (data.size() >= 36) {
            const auto u = [&data](int o) { return static_cast<quint8>(data[o]); };
            const quint32 dataSize = quint32(u(28)) | (quint32(u(29)) << 8)
                | (quint32(u(30)) << 16) | (quint32(u(31)) << 24);
            const quint32 headerSize = quint32(u(32)) | (quint32(u(33)) << 8);
            if (dataSize > 0 && headerSize + dataSize <= quint32(data.size())) {
                const QByteArray jpeg = data.mid(static_cast<int>(headerSize),
                                                 static_cast<int>(dataSize));
                QImage img;
                if (img.loadFromData(jpeg, "JPEG")) {
                    m_provider->setFrame(img);
                    m_lastFrameAtMs = QDateTime::currentMSecsSinceEpoch();
                    ++m_sessionFrameCount;
                    ++m_frameId;
                    if (m_frameId == 1 || m_frameId % 50 == 0)
                        qInfo() << "[camera] frame" << m_frameId << img.width() << "x" << img.height();
                    emit frameChanged();
                } else if (m_frameId == 0) {
                    qWarning() << "[camera] first frame JPEG decode failed, bytes=" << jpeg.size();
                }
            }
        }
        scheduleNextFrame(kFrameIntervalMs);
    });
}

void CameraClient::scheduleNextFrame(int ms)
{
    if (m_streaming)
        m_frameTimer.start(ms);
}

void CameraClient::checkStaleFrame()
{
    if (!m_streaming || m_lastFrameAtMs <= 0)
        return;
    const qint64 age = QDateTime::currentMSecsSinceEpoch() - m_lastFrameAtMs;
    const qint64 deadline = m_sessionFrameCount == 0
        ? kFirstFrameReconnectMs : kStaleReconnectMs;
    if (age < deadline)
        return;

    qWarning() << "[camera] no frames for" << age << "ms; reconnecting";
    stop();
    const quint64 generation = m_sessionGeneration;
    setStatus(QStringLiteral("connecting"));
    QTimer::singleShot(5000, this, [this, generation] {
        if (generation == m_sessionGeneration
            && m_status == QLatin1String("connecting"))
            start();
    });
}

void CameraClient::sendLiveMessage()
{
    if (m_connectionId.isEmpty())
        return;
    postCommand(QStringLiteral("LiveMessage"), {}, [](const QMap<QString, QString>&, const QString&) {});
}

void CameraClient::closeStream()
{
    postCommand(QStringLiteral("CloseStream"),
                {{QStringLiteral("VideoId"), m_videoId}},
                [](const QMap<QString, QString>&, const QString&) {});
}

} // namespace qtpanel
