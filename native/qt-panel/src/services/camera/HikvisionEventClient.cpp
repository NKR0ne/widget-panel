#include "HikvisionEventClient.h"

#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QDateTime>
#include <QDebug>
#include <QDomDocument>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QUrl>

namespace qtpanel {

namespace {

// The camera repeats an active event every second while it lasts; this is the
// floor between two events we act on (SentryService applies its own cooldown
// on top for the escalation itself).
constexpr qint64 kMinEventGapMs = 4000;
constexpr int kMaxReconnectDelayMs = 60000;
// Keep VCA shapes off the frame border (normalized 0..1000 space).
constexpr int kBorderMargin = 30;

// ISAPI eventType → French wording used in alerts and in the vision prompt.
QString labelForEventType(const QString& type)
{
    if (type == QLatin1String("linedetection"))
        return QStringLiteral("franchissement de ligne");
    if (type == QLatin1String("fielddetection"))
        return QStringLiteral("intrusion dans la zone");
    if (type == QLatin1String("regionEntrance"))
        return QStringLiteral("entrée dans la zone");
    if (type == QLatin1String("regionExiting"))
        return QStringLiteral("sortie de la zone");
    if (type == QLatin1String("tamperdetection") || type == QLatin1String("shelteralarm"))
        return QStringLiteral("sabotage de la caméra");
    if (type == QLatin1String("facedetection"))
        return QStringLiteral("visage détecté");
    if (type == QLatin1String("io"))
        return QStringLiteral("entrée d'alarme");
    if (type == QLatin1String("VMD"))
        return QStringLiteral("mouvement");
    return type;
}

} // namespace

QString HikvisionEventClient::categoryForEventType(const QString& type)
{
    // Perimeter events: the camera decided something crossed into a guarded
    // area. These are the ones worth waking a person for.
    if (type == QLatin1String("linedetection") || type == QLatin1String("fielddetection")
        || type == QLatin1String("regionEntrance") || type == QLatin1String("intrusion")
        || type == QLatin1String("perimeter"))
        return QStringLiteral("intrusion");
    if (type == QLatin1String("tamperdetection") || type == QLatin1String("shelteralarm"))
        return QStringLiteral("tamper");
    // Plain video-motion (and leaving a zone) fire on rain, headlights and
    // branches; they are movement, not intrusion.
    if (type == QLatin1String("VMD") || type == QLatin1String("regionExiting"))
        return QStringLiteral("motion");
    return QStringLiteral("other");
}

namespace {

// Events the camera emits continuously as keepalive/noise.
bool isNoiseEvent(const QString& type)
{
    return type == QLatin1String("videoloss") || type == QLatin1String("diskfull")
        || type == QLatin1String("diskerror") || type == QLatin1String("nicbroken")
        || type == QLatin1String("ipconflict") || type == QLatin1String("illaccess")
        || type == QLatin1String("badvideo");
}

QString firstText(const QDomElement& root, const QString& tag)
{
    const QDomNodeList nodes = root.elementsByTagName(tag);
    return nodes.isEmpty() ? QString() : nodes.at(0).toElement().text().trimmed();
}

} // namespace

HikvisionEventClient::HikvisionEventClient(SettingsStore* settings, SecretVault* vault,
                                           HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_http(http)
{
    m_reconnectTimer.setSingleShot(true);
    connect(&m_reconnectTimer, &QTimer::timeout, this, [this] {
        if (m_enabled)
            connectStream();
    });
}

QString HikvisionEventClient::baseUrl() const
{
    // Prefer the device page host, fall back to the RTSP stream host.
    const QString devicePage =
        m_settings->get(QStringLiteral("wp-camera-direct-url")).toString().trimmed();
    QUrl url(devicePage);
    if (url.host().isEmpty()) {
        const QUrl rtsp(m_settings->get(QStringLiteral("wp-camera-direct-stream-url"))
                            .toString().trimmed());
        url = rtsp;
    }
    if (url.host().isEmpty())
        return {};
    // ISAPI is HTTP on the device's web port, never the RTSP port.
    const QString scheme = url.scheme() == QLatin1String("https")
        ? QStringLiteral("https") : QStringLiteral("http");
    QString authority = url.host();
    if (url.port() > 0 && url.port() != 554 && url.port() != 80 && url.port() != 443)
        authority += QStringLiteral(":") + QString::number(url.port());
    return scheme + QStringLiteral("://") + authority;
}

QString HikvisionEventClient::user() const
{
    return m_settings->get(QStringLiteral("wp-camera-direct-user")).toString().trimmed();
}

QString HikvisionEventClient::password() const
{
    return m_vault->get(QStringLiteral("camera-direct-password"));
}

int HikvisionEventClient::channel() const
{
    // Stream path .../channels/102 → main stream of channel 1 is 101.
    const QUrl rtsp(m_settings->get(QStringLiteral("wp-camera-direct-stream-url"))
                        .toString().trimmed());
    const QString last = rtsp.path().section(QLatin1Char('/'), -1);
    bool ok = false;
    const int id = last.toInt(&ok);
    if (ok && id >= 100)
        return (id / 100) * 100 + 1; // 102 → 101 (main stream = best snapshot)
    return 101;
}

bool HikvisionEventClient::configured() const
{
    return !baseUrl().isEmpty() && !user().isEmpty() && !password().isEmpty();
}

void HikvisionEventClient::setStatus(const QString& status, bool connected)
{
    if (m_status == status && m_connected == connected)
        return;
    m_status = status;
    m_connected = connected;
    emit statusChanged();
}

void HikvisionEventClient::setEnabled(bool enabled)
{
    if (m_enabled == enabled)
        return;
    m_enabled = enabled;
    if (!enabled) {
        m_reconnectTimer.stop();
        if (m_stream) {
            m_stream->abort();
            m_stream = nullptr;
        }
        m_buffer.clear();
        setStatus(QStringLiteral("idle"), false);
        qInfo() << "[starvis.sentry] hikvision events disabled";
        return;
    }
    connectStream();
}

void HikvisionEventClient::connectStream()
{
    if (m_stream)
        return;
    if (!configured()) {
        setStatus(QStringLiteral("setup"), false);
        return;
    }
    // The alert stream only carries the event types the device is subscribed
    // to, and the default subscription does not include the smart analytics —
    // which is why only VMD ever arrived. subscribeEvent is write-only (GET
    // answers methodNotAllowed), so it is set, not read. Failure here is not
    // fatal: the stream still delivers whatever the device already sends.
    // Subscribe BEFORE opening the stream: a subscription that lands after the
    // stream is already running does not apply to it.
    if (!m_subscribed) {
        subscribeToAllEvents();
        return; // openStream() runs from the subscription's completion
    }
    openStream();
}

void HikvisionEventClient::openStream()
{
    if (m_stream || !configured())
        return;

    const QString url = baseUrl() + QStringLiteral("/ISAPI/Event/notification/alertStream");
    setStatus(QStringLiteral("connecting"), false);
    qInfo() << "[starvis.sentry] subscribing to camera events:" << url;

    m_stream = m_http->getStreamAuth(
        QUrl(url), user(), password(), this,
        [this](const QByteArray& chunk) {
            if (!m_connected) {
                setStatus(QStringLiteral("live"), true);
                m_reconnectDelayMs = 2000; // healthy stream resets the backoff
                qInfo() << "[starvis.sentry] camera event stream live";
                probeSmartCapabilities();
            }
            consume(chunk);
        },
        [this](int status, const QString& error) {
            m_stream = nullptr;
            m_buffer.clear();
            const bool aborted = error == QLatin1String("aborted");
            if (status == 401)
                setStatus(QStringLiteral("auth"), false);
            else
                setStatus(aborted ? QStringLiteral("idle") : QStringLiteral("error"), false);
            if (!aborted || m_enabled) {
                qWarning() << "[starvis.sentry] camera event stream ended:"
                           << status << error;
                scheduleReconnect();
            }
        });
}

void HikvisionEventClient::subscribeToAllEvents()
{
    // <eventMode>all</eventMode> is offered by SubscribeEventCap
    // (opt="all,list") and covers linedetection / fielddetection.
    // Field order and set mirror SubscribeEventCap exactly (format, heartbeat,
    // channelMode, eventMode); anything else is answered "Invalid Content".
    const QByteArray body =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<SubscribeEvent version=\"2.0\" xmlns=\"http://www.hikvision.com/ver20/XMLSchema\">"
        "<format>xml</format>"
        "<heartbeat>30</heartbeat>"
        "<channelMode>all</channelMode>"
        "<eventMode>all</eventMode>"
        "</SubscribeEvent>";
    // POST, not PUT: the device models this as creating a subscription
    // (SubscribeEventCap advertises isSupportUnSubscribeEvent alongside it).
    m_http->requestBytesAuth(
        "POST", QUrl(baseUrl() + QStringLiteral("/ISAPI/Event/notification/subscribeEvent")),
        user(), password(), body, "application/xml", this,
        [this](const QByteArray& response, int status, const QString& error) {
            const QString reply = QString::fromUtf8(response).simplified();
            if (status >= 200 && status < 300) {
                qInfo() << "[starvis.sentry] abonnement aux événements: tous —"
                        << reply.left(160);
            } else {
                qWarning() << "[starvis.sentry] abonnement refusé" << status << error
                           << reply;
            }
            // Either way the stream opens: a device that refuses the
            // subscription still delivers its default event set.
            m_subscribed = true;
            openStream();
        });
}

void HikvisionEventClient::scheduleReconnect()
{
    if (!m_enabled)
        return;
    // Cameras drop the stream routinely; back off but keep trying.
    m_reconnectTimer.start(m_reconnectDelayMs);
    m_reconnectDelayMs = qMin(m_reconnectDelayMs * 2, kMaxReconnectDelayMs);
}

void HikvisionEventClient::consume(const QByteArray& chunk)
{
    m_buffer.append(chunk);
    // Boundaries and part headers vary by firmware; the alert documents do not.
    for (;;) {
        const int start = m_buffer.indexOf("<EventNotificationAlert");
        if (start < 0) {
            if (m_buffer.size() > 65536)
                m_buffer.clear(); // never grow unbounded on junk
            return;
        }
        const int end = m_buffer.indexOf("</EventNotificationAlert>", start);
        if (end < 0) {
            if (start > 0)
                m_buffer.remove(0, start);
            // VCA events carry a JPEG attachment after the XML; if a document
            // is ever truncated mid-way the tail would otherwise accumulate
            // forever, since the start tag is at 0 and the guard below never
            // fires. Drop a partial document that stopped growing sensibly.
            if (m_buffer.size() > 512 * 1024) {
                qWarning() << "[starvis.sentry] document d'alerte tronqué, tampon vidé";
                m_buffer.clear();
            }
            return;
        }
        const int stop = end + int(qstrlen("</EventNotificationAlert>"));
        handleAlert(m_buffer.mid(start, stop - start));
        m_buffer.remove(0, stop);
    }
}

void HikvisionEventClient::handleAlert(const QByteArray& xml)
{
    QDomDocument document;
    if (!document.setContent(xml))
        return;
    const QDomElement root = document.documentElement();
    const QString type = firstText(root, QStringLiteral("eventType"));
    const QString state = firstText(root, QStringLiteral("eventState"));
    // Prove the subscription decodes real documents even when every event so
    // far was filtered as noise — otherwise a silent stream is ambiguous.
    if (!m_sawAlert) {
        m_sawAlert = true;
        qInfo() << "[starvis.sentry] first alert parsed: type=" << type << "state=" << state;
    }
    // Log each event type once, whatever we do with it afterwards. When a
    // perimeter test produces no announcement, this says whether the camera
    // ever sent the smart event at all — the one fact the stream can settle.
    if (!type.isEmpty() && !m_seenTypes.contains(type)) {
        m_seenTypes.insert(type);
        qInfo() << "[starvis.sentry] type d'événement vu:" << type
                << "état=" << state << "catégorie=" << categoryForEventType(type);
        if (categoryForEventType(type) == QLatin1String("intrusion")) {
            // Full document once per perimeter type: targets, regions, rule id.
            qInfo() << "[starvis.sentry] document:" << QString::fromUtf8(xml.left(900));
        }
    }
    if (type.isEmpty() || isNoiseEvent(type))
        return;
    // Only rising edges: the camera repeats "active" for the whole event.
    if (!state.isEmpty() && state != QLatin1String("active"))
        return;

    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (type == m_lastActiveType && now - m_lastEventMs < kMinEventGapMs)
        return;
    m_lastActiveType = type;
    m_lastEventMs = now;

    // AI firmware tags the detected object; older builds leave it empty.
    QString target = firstText(root, QStringLiteral("detectionTarget"));
    if (target.isEmpty())
        target = firstText(root, QStringLiteral("targetType"));

    const QString label = labelForEventType(type);
    const QString category = categoryForEventType(type);
    qInfo() << "[starvis.sentry] camera event:" << type << label << "category=" << category
            << (target.isEmpty() ? QString() : QStringLiteral("target=") + target);
    emit eventDetected(type, label, target, category);
}

void HikvisionEventClient::probeSmartCapabilities()
{
    if (!configured())
        return;
    // Read the device's own configuration for the two perimeter analytics.
    const QList<QPair<QString, QString>> features{
        {QStringLiteral("LineDetection"), QStringLiteral("franchissement de ligne")},
        {QStringLiteral("FieldDetection"), QStringLiteral("intrusion de zone")},
    };
    for (const auto& feature : features) {
        const QString url = baseUrl() + QStringLiteral("/ISAPI/Smart/%1/%2")
                                            .arg(feature.first)
                                            .arg(channel() / 100);
        const QString label = feature.second;
        m_http->getBytesAuth(QUrl(url), user(), password(), this,
                             [this, label](const QByteArray& body, int status, const QString&) {
            QString state;
            if (status == 404 || status == 403) {
                state = QStringLiteral("non pris en charge");
            } else if (status < 200 || status >= 300) {
                state = QStringLiteral("inconnu (%1)").arg(status);
            } else {
                // <enabled>true</enabled> anywhere in the returned config.
                const QString xml = QString::fromUtf8(body);
                const int at = xml.indexOf(QLatin1String("<enabled>"));
                const bool enabled = at >= 0
                    && xml.mid(at + 9, 4).compare(QLatin1String("true"), Qt::CaseInsensitive) == 0;
                state = enabled ? QStringLiteral("activé") : QStringLiteral("désactivé");
            }
            // The whole rule, not just <enabled>: target filter, rule list and
            // sensitivity all decide whether the analytic can ever fire, and
            // "enabled" alone has proven not to be the whole story.
            qInfo() << "[starvis.sentry] règle" << label << ":"
                    << QString::fromUtf8(body).simplified();
            m_smartResults.insert(label, state);
            QStringList parts;
            for (auto it = m_smartResults.constBegin(); it != m_smartResults.constEnd(); ++it)
                parts << it.key() + QStringLiteral(" : ") + it.value();
            parts.sort();
            m_smartStatus = parts.join(QStringLiteral(" · "));
            qInfo() << "[starvis.sentry] analytique caméra —" << label << state;
            emit statusChanged();
        });
    }

    // An analytic can be enabled yet never reach us: HikVision only pushes an
    // event to the alert stream when that rule's linkage includes "notify
    // surveillance centre". Read each trigger's own notification list — the
    // whole-document search this replaced gave a false positive.
    // A rule can be stored and still never run if the camera's analysis engine
    // is allocated elsewhere, or if the field we write is not writable at all.
    // These two answers say which, instead of guessing endpoint by endpoint.
    for (const QString& path : {QStringLiteral("/ISAPI/System/Network/mailing/%1"),
                                QStringLiteral("/ISAPI/System/Network/interfaces/%1/ipAddress")}) {
        const QString url = baseUrl() + path.arg(channel() / 100);
        m_http->getBytesAuth(QUrl(url), user(), password(), this,
                             [url](const QByteArray& body, int status, const QString&) {
            qInfo() << "[starvis.sentry] sonde" << url.section(QLatin1Char('/'), -2) << status
                    << QString::fromUtf8(body).simplified().left(1600);
        });
    }

    // Many HikVision models run only ONE smart analytic at a time: enabling
    // face detection silently starves line/field detection even though both
    // still report "enabled". Report what else is competing for that slot.
    for (const QString& other : {QStringLiteral("FaceDetect"),
                                 QStringLiteral("regionEntrance"),
                                 QStringLiteral("regionExiting")}) {
        m_http->getBytesAuth(
            QUrl(baseUrl() + QStringLiteral("/ISAPI/Smart/%1/%2").arg(other).arg(channel() / 100)),
            user(), password(), this,
            [other](const QByteArray& body, int status, const QString&) {
                if (status < 200 || status >= 300)
                    return;
                const QString xml = QString::fromUtf8(body);
                const int at = xml.indexOf(QLatin1String("<enabled>"));
                const bool enabled = at >= 0
                    && xml.mid(at + 9, 4).compare(QLatin1String("true"), Qt::CaseInsensitive) == 0;
                qInfo() << "[starvis.sentry] autre analytique" << other
                        << (enabled ? "ACTIVÉE (peut monopoliser la ressource VCA)"
                                    : "désactivée");
            });
    }

    const int channelId = channel() / 100;
    for (const QString& trigger : {QStringLiteral("linedetection"),
                                   QStringLiteral("fielddetection")}) {
        const QString url = baseUrl()
            + QStringLiteral("/ISAPI/Event/triggers/%1-%2/notifications")
                  .arg(trigger).arg(channelId);
        m_http->getBytesAuth(QUrl(url), user(), password(), this,
                             [this, trigger](const QByteArray& body, int status,
                                             const QString&) {
            if (status < 200 || status >= 300) {
                qWarning() << "[starvis.sentry] liaison" << trigger
                           << ": lecture impossible (" << status << ")";
                return;
            }
            const QString xml = QString::fromUtf8(body);
            const bool notifiesCentre = xml.contains(QLatin1String("center"), Qt::CaseInsensitive);
            if (notifiesCentre) {
                qInfo() << "[starvis.sentry] liaison" << trigger
                        << ": notifie le centre de surveillance — OK";
            } else {
                qWarning() << "[starvis.sentry] liaison" << trigger
                           << ": 'Notifier le centre de surveillance' N'EST PAS coché — "
                              "la caméra ne poussera jamais cet événement vers le flux";
            }
            qInfo() << "[starvis.sentry] notifications" << trigger << ":"
                    << xml.simplified().left(400);
        });
    }
}

void HikvisionEventClient::enablePerimeterRules()
{
    if (!configured()) {
        qWarning() << "[starvis.sentry] activation des règles impossible : identifiants absents";
        return;
    }
    const int channelId = channel() / 100;
    const QList<QPair<QString, QString>> rules{
        {QStringLiteral("LineDetection"), QStringLiteral("franchissement de ligne")},
        {QStringLiteral("FieldDetection"), QStringLiteral("intrusion de zone")},
    };

    for (const auto& rule : rules) {
        const QString url = baseUrl() + QStringLiteral("/ISAPI/Smart/%1/%2")
                                            .arg(rule.first).arg(channelId);
        const QString label = rule.second;
        m_http->getBytesAuth(QUrl(url), user(), password(), this,
                             [this, url, label](const QByteArray& body, int status,
                                                const QString& error) {
            if (status < 200 || status >= 300 || body.isEmpty()) {
                qWarning() << "[starvis.sentry]" << label
                           << ": lecture avant écriture impossible" << status << error;
                return;
            }
            QByteArray patched = body;
            // The outer function flag is already true, so flipping every
            // "false" occurrence only reaches the per-rule flags. Nothing
            // else in the document is touched.
            const int changes = patched.count("<enabled>false</enabled>");
            patched.replace("<enabled>false</enabled>", "<enabled>true</enabled>");

            // A shape touching the frame border is rejected by the analytics
            // engine, which then keeps the rule disabled however often the
            // flag is written. Pull every vertex just inside the 0..1000
            // normalized frame, preserving the drawn geometry.
            static const QRegularExpression coordinate(
                QStringLiteral("<position([XY])>(\\d+)</position([XY])>"));
            QString document = QString::fromUtf8(patched);
            QString rebuilt;
            int last = 0;
            int clamped = 0;
            auto matches = coordinate.globalMatch(document);
            while (matches.hasNext()) {
                const QRegularExpressionMatch match = matches.next();
                const int value = match.captured(2).toInt();
                const int inside = qBound(kBorderMargin, value, 1000 - kBorderMargin);
                rebuilt += document.mid(last, match.capturedStart() - last);
                rebuilt += QStringLiteral("<position%1>%2</position%3>")
                               .arg(match.captured(1)).arg(inside).arg(match.captured(3));
                last = match.capturedEnd();
                if (inside != value)
                    ++clamped;
            }
            rebuilt += document.mid(last);
            patched = rebuilt.toUtf8();

            if (changes == 0 && clamped == 0) {
                qInfo() << "[starvis.sentry]" << label << ": déjà active, rien à écrire";
                return;
            }
            qInfo() << "[starvis.sentry]" << label << ": activation de" << changes
                    << "règle(s)," << clamped << "point(s) rentré(s) dans le cadre — écriture…";

            m_http->requestBytesAuth("PUT", QUrl(url), user(), password(), patched,
                                     "application/xml", this,
                                     [this, url, label](const QByteArray& response, int status,
                                                        const QString& error) {
                const QString reply = QString::fromUtf8(response).simplified();
                if (status < 200 || status >= 300) {
                    qWarning() << "[starvis.sentry]" << label << ": écriture refusée"
                               << status << error << reply.left(200);
                    return;
                }
                qInfo() << "[starvis.sentry]" << label << ": écriture acceptée —"
                        << reply.left(160);
                // Read it back: the camera is the only authority on whether
                // the flag actually stuck.
                m_http->getBytesAuth(QUrl(url), user(), password(), this,
                                     [label](const QByteArray& verify, int status,
                                             const QString&) {
                    if (status < 200 || status >= 300)
                        return;
                    const bool stillDisabled =
                        verify.contains("<enabled>false</enabled>");
                    if (stillDisabled) {
                        qWarning() << "[starvis.sentry]" << label
                                   << ": VÉRIFICATION — la règle est encore inactive";
                    } else {
                        qInfo() << "[starvis.sentry]" << label
                                << ": VÉRIFICATION — règle active";
                    }
                });
            });
        });
    }
}

void HikvisionEventClient::useSinglePerimeterRule(const QString& keep)
{
    if (!configured())
        return;
    const int channelId = channel() / 100;
    // "restore" puts both perimeter functions back on, as the camera was found.
    const QString drop = keep == QLatin1String("LineDetection")
        ? QStringLiteral("FieldDetection")
        : keep == QLatin1String("restore") ? QStringLiteral("LineDetection")
                                           : QStringLiteral("LineDetection");

    const QString dropUrl = baseUrl() + QStringLiteral("/ISAPI/Smart/%1/%2")
                                            .arg(drop).arg(channelId);
    qInfo() << "[starvis.sentry] exclusivité VCA : désactivation de" << drop
            << "pour libérer" << keep;

    m_http->getBytesAuth(QUrl(dropUrl), user(), password(), this,
                         [this, dropUrl, drop, keep, channelId]
                         (const QByteArray& body, int status, const QString&) {
        if (status < 200 || status >= 300)
            return;
        // Only the function-level flag, which is the first <enabled> in the
        // document; the rule's own coordinates are left untouched.
        QByteArray patched = body;
        // "restore" re-enables the function instead of disabling it, so an
        // unsuccessful exclusivity test can put the camera back as found.
        if (keep == QLatin1String("restore")) {
            const int at = patched.indexOf("<enabled>false</enabled>");
            if (at >= 0)
                patched.replace(at, 24, "<enabled>true</enabled>");
        } else {
            const int at = patched.indexOf("<enabled>true</enabled>");
            if (at >= 0)
                patched.replace(at, 23, "<enabled>false</enabled>");
        }

        m_http->requestBytesAuth("PUT", QUrl(dropUrl), user(), password(), patched,
                                 "application/xml", this,
                                 [this, drop, keep, channelId]
                                 (const QByteArray&, int status, const QString& error) {
            qInfo() << "[starvis.sentry]" << drop << "désactivée:" << status << error;

            // Now arm the surviving analytic's rule.
            const QString keepUrl = baseUrl() + QStringLiteral("/ISAPI/Smart/%1/%2")
                                                    .arg(keep).arg(channelId);
            m_http->getBytesAuth(QUrl(keepUrl), user(), password(), this,
                                 [this, keepUrl, keep](const QByteArray& body, int status,
                                                       const QString&) {
                if (status < 200 || status >= 300)
                    return;
                QByteArray patched = body;
                patched.replace("<enabled>false</enabled>", "<enabled>true</enabled>");
                m_http->requestBytesAuth("PUT", QUrl(keepUrl), user(), password(), patched,
                                         "application/xml", this,
                                         [this, keepUrl, keep](const QByteArray&, int status,
                                                               const QString&) {
                    qInfo() << "[starvis.sentry]" << keep << ": écriture" << status;
                    m_http->getBytesAuth(QUrl(keepUrl), user(), password(), this,
                                         [keep](const QByteArray& verify, int, const QString&) {
                        const bool armed = !verify.contains("<enabled>false</enabled>");
                        if (armed)
                            qInfo() << "[starvis.sentry]" << keep
                                    << ": VÉRIFICATION — règle ARMÉE";
                        else
                            qWarning() << "[starvis.sentry]" << keep
                                       << ": VÉRIFICATION — toujours désarmée";
                    });
                });
            });
        });
    });
}

void HikvisionEventClient::fetchSnapshot(QObject* context,
                                         std::function<void(const QImage&)> callback)
{
    if (!configured()) {
        callback({});
        return;
    }
    const QString url = baseUrl() + QStringLiteral("/ISAPI/Streaming/channels/%1/picture")
                                        .arg(channel());
    m_http->getBytesAuth(QUrl(url), user(), password(), context,
                         [callback](const QByteArray& bytes, int status, const QString& error) {
        QImage image;
        if (status >= 200 && status < 300 && !bytes.isEmpty())
            image.loadFromData(bytes, "JPEG");
        if (image.isNull())
            qWarning() << "[starvis.sentry] snapshot failed:" << status << error;
        callback(image);
    });
}

} // namespace qtpanel
