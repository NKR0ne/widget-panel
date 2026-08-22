#include "SentryService.h"

#include "AnthropicClient.h"
#include "StarvisService.h"
#include "StarvisState.h"
#include "WebcamCapture.h"
#include "core/SettingsStore.h"
#include "services/camera/CameraClient.h"
#include "services/camera/DirectCameraClient.h"
#include "services/camera/HikvisionEventClient.h"

#include <QDateTime>
#include <QDebug>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTime>
#include <QUuid>

namespace qtpanel {

namespace {

// Cameras report every ~90-500 ms; the detector only needs ~2 Hz.
constexpr qint64 kAnalyzeIntervalMs = 500;
constexpr qint64 kAbsenceMs = 30 * 60 * 1000;
constexpr int kPresenceStreakNeeded = 3;
constexpr int kMaxEvents = 8;
// Activity log: what Starvis did, per source, for the last day.
constexpr qint64 kActivityRetentionMs = 24 * 60 * 60 * 1000;
constexpr int kMaxActivityEntries = 400;

const char kClassifyPrompt[] =
    "You are a perimeter security analyst. This snapshot was taken the moment "
    "the camera's own analytics raised a perimeter event. Reply with STRICT "
    "JSON only, no prose: {\"person\": bool, \"at_door\": bool, "
    "\"description\": \"one short French sentence\", "
    "\"threat\": \"none|notice|alert\"}. Judge the perimeter, not movement: "
    "threat=alert for an unknown person inside the private perimeter or at the "
    "door; notice for a person passing at the edge or an unclear figure; none "
    "for animals, vehicles on the street, foliage, weather or light changes.";

// Second pass: only runs when a person is in frame and references exist.
const char kIdentifyPrompt[] =
    "The reference images above are people known to this household, each "
    "announced by name. Decide whether the person in the image to analyse is "
    "one of them. Same clothing is NOT evidence; judge face and build. Reply "
    "with STRICT JSON only: {\"match\": \"<exact reference name, or empty "
    "string if unknown or unsure>\", \"confidence\": \"low|medium|high\"}.";

const char kGreetPrompt[] =
    "You are Starvis, a French-speaking desktop assistant. This webcam snapshot "
    "shows your user arriving at their desk. Read their apparent mood and energy "
    "from non-verbal cues (posture, expression). Reply with STRICT JSON only: "
    "{\"greeting_fr\": \"a warm, 1-2 sentence personalized French greeting that "
    "subtly reflects their apparent state and offers the daily briefing\", "
    "\"mood\": \"one English word\"}.";

// Spoken and written alerts name the camera, not its internal id.
QString cameraLabel(const QString& cameraId)
{
    if (cameraId == QLatin1String("direct"))
        return QStringLiteral("Caméra extérieure");
    if (cameraId == QLatin1String("xprotect"))
        return QStringLiteral("Caméra XProtect");
    if (cameraId == QLatin1String("webcam"))
        return QStringLiteral("Webcam");
    return cameraId;
}

} // namespace

QImage SentryImageProvider::requestImage(const QString& id, QSize* size, const QSize& requested)
{
    QMutexLocker lock(&m_mutex);
    // Live views append "?n=<frame>" to defeat the QML image cache; the key is
    // everything before it.
    const QString key = id.section(QLatin1Char('?'), 0, 0);
    QImage image = m_images.value(key);
    if (size)
        *size = image.size();
    if (!requested.isEmpty() && !image.isNull())
        image = image.scaled(requested, Qt::KeepAspectRatio, Qt::SmoothTransformation);
    return image;
}

QImage SentryImageProvider::image(const QString& id) const
{
    QMutexLocker lock(&m_mutex);
    return m_images.value(id);
}

void SentryImageProvider::storeImage(const QString& id, const QImage& image)
{
    QMutexLocker lock(&m_mutex);
    m_images.insert(id, image);
    // Prune old event thumbnails only — the "live/<source>" previews must
    // survive or the Vision tiles go blank.
    QStringList events;
    for (const QString& key : m_images.keys()) {
        if (key.startsWith(QLatin1String("event/")))
            events << key;
    }
    while (events.size() > kMaxEvents + 2) {
        m_images.remove(events.first());
        events.removeFirst();
    }
}

SentryService::SentryService(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                             StarvisService* starvis, CameraClient* xprotect,
                             DirectCameraClient* direct, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_starvis(starvis)
    , m_xprotect(xprotect)
    , m_direct(direct)
    , m_provider(new SentryImageProvider)
{
    m_webcam = new WebcamCapture(this);

    // The camera's own analytics are the preferred trigger: on-sensor, full
    // resolution, zoned and scheduled in the device, and already classified on
    // AI firmware. Local frame differencing stays as fallback and for the
    // webcam, which has no device-side detection at all.
    m_directEvents = new HikvisionEventClient(settings, vault, http, this);
    connect(m_directEvents, &HikvisionEventClient::eventDetected, this,
            [this](const QString&, const QString& label, const QString& target,
                   const QString& category) {
        onCameraEvent(QStringLiteral("direct"), label, target, category);
    });
    connect(m_directEvents, &HikvisionEventClient::statusChanged, this, [this] {
        emit configChanged();
        logActivity(QStringLiteral("direct"), QStringLiteral("stream"),
                    QStringLiteral("Flux d'événements : ") + m_directEvents->status());
    });

    // Live previews are pulled from the camera itself, so the view does not
    // depend on the RTSP card being on screen (and never steals its sink).
    m_previewTimer.setInterval(15000);
    connect(&m_previewTimer, &QTimer::timeout, this, &SentryService::pullLivePreviews);

    loadActivity();
    loadPeople();

    if (m_xprotect) {
        connect(m_xprotect, &CameraClient::frameReady, this,
                [this](const QImage& frame) { onFrame(QStringLiteral("xprotect"), frame); });
    }
    if (m_direct) {
        connect(m_direct, &DirectCameraClient::analysisFrame, this,
                [this](const QImage& frame) { onFrame(QStringLiteral("direct"), frame); });
    }
    connect(m_webcam, &WebcamCapture::frameReady, this, [this](const QImage& frame) {
        onFrame(QStringLiteral("webcam"), frame);
        if (m_livePreview) {
            m_provider->storeImage(QStringLiteral("live/webcam"), frame);
            ++m_sourceFrameIds[QStringLiteral("webcam")];
            ++m_liveFrameId;
            emit liveFrameChanged();
        }
    });
    connect(m_webcam, &WebcamCapture::availableChanged, this, &SentryService::configChanged);

    m_absenceTimer.setSingleShot(true);
    m_absenceTimer.setInterval(kAbsenceMs);
    connect(&m_absenceTimer, &QTimer::timeout, this, [this] {
        if (m_presence != QLatin1String("absent")) {
            m_presence = QStringLiteral("absent");
            m_presenceStreak = 0;
            qInfo() << "[starvis.sentry] presence -> absent";
            emit presenceChanged();
        }
    });

    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key == QLatin1String("wp-starvis-sentry") || key == QLatin1String("wp-starvis-greet"))
            applyConfig();
    });
    applyConfig();
    qInfo() << "[starvis.sentry] initialized; armed =" << anyArmed()
            << "webcam =" << m_webcam->available();
}

QVariantMap SentryService::sentryConfig() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-sentry"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {};
}

QVariantMap SentryService::greetConfig() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-greet"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {};
}

void SentryService::applyConfig()
{
    const QVariantMap cfg = sentryConfig();
    m_detector.setThreshold(
        qBound(0.005, cfg.value(QStringLiteral("diffThreshold"), 0.045).toDouble(), 0.5));
    m_detector.setCooldownMs(
        qBound(5, cfg.value(QStringLiteral("cooldownSec"), 30).toInt(), 3600) * 1000);
    // Zones: {camId: [{x,y,w,h}...]} normalized.
    const QVariantMap zones = cfg.value(QStringLiteral("zones")).toMap();
    for (auto it = zones.constBegin(); it != zones.constEnd(); ++it) {
        QVector<QRectF> rects;
        for (const QVariant& zv : it.value().toList()) {
            const QVariantMap z = zv.toMap();
            rects.append(QRectF(z.value(QStringLiteral("x")).toDouble(),
                                z.value(QStringLiteral("y")).toDouble(),
                                z.value(QStringLiteral("w")).toDouble(),
                                z.value(QStringLiteral("h")).toDouble()));
        }
        m_detector.setZones(it.key(), rects);
    }
    // Webcam capture runs while its camera is armed (presence + greeting).
    m_webcam->setEnabled(cfg.value(QStringLiteral("webcamArmed"), true).toBool());

    const QString directMode = detectionMode(QStringLiteral("direct"));
    const bool directArmed = cameraArmed(QStringLiteral("direct"));
    // Subscribe to the device only when it is the trigger; the local RTSP tap
    // costs a mapped copy per frame, so it runs only when actually used.
    m_directEvents->setEnabled(directArmed && directMode != QLatin1String("local"));
    if (m_direct)
        m_direct->setAnalysisEnabled(directArmed && directMode != QLatin1String("camera"));
    emit configChanged();
}

bool SentryService::webcamAvailable() const
{
    return m_webcam && m_webcam->available();
}

bool SentryService::cameraArmed(const QString& cameraId) const
{
    const QVariantMap cfg = sentryConfig();
    if (cameraId == QLatin1String("webcam"))
        return cfg.value(QStringLiteral("webcamArmed"), true).toBool();
    return cfg.value(QStringLiteral("armed")).toMap().value(cameraId, false).toBool();
}

void SentryService::setCameraArmed(const QString& cameraId, bool armed)
{
    QVariantMap cfg = sentryConfig();
    if (cameraId == QLatin1String("webcam")) {
        cfg.insert(QStringLiteral("webcamArmed"), armed);
    } else {
        QVariantMap armedMap = cfg.value(QStringLiteral("armed")).toMap();
        armedMap.insert(cameraId, armed);
        cfg.insert(QStringLiteral("armed"), armedMap);
    }
    m_settings->set(QStringLiteral("wp-starvis-sentry"),
                    QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(cfg))
                                          .toJson(QJsonDocument::Compact)));
    m_detector.reset(cameraId);
    qInfo() << "[starvis.sentry]" << cameraId << (armed ? "armed" : "disarmed");
    logActivity(cameraId, QStringLiteral("config"),
                armed ? QStringLiteral("Surveillance armée") : QStringLiteral("Surveillance désarmée"));
}

QString SentryService::detectionMode(const QString& cameraId) const
{
    // The webcam has no device-side analytics; it is always local.
    if (cameraId == QLatin1String("webcam"))
        return QStringLiteral("local");
    const QVariantMap modes = sentryConfig().value(QStringLiteral("detection")).toMap();
    const QString stored = modes.value(cameraId).toString();
    if (stored == QLatin1String("camera") || stored == QLatin1String("local")
        || stored == QLatin1String("both"))
        return stored;
    // Default: let the camera detect when it can, otherwise fall back locally.
    if (cameraId == QLatin1String("direct") && m_directEvents && m_directEvents->configured())
        return QStringLiteral("camera");
    return QStringLiteral("local");
}

void SentryService::setDetectionMode(const QString& cameraId, const QString& mode)
{
    QVariantMap cfg = sentryConfig();
    QVariantMap modes = cfg.value(QStringLiteral("detection")).toMap();
    modes.insert(cameraId, mode);
    cfg.insert(QStringLiteral("detection"), modes);
    m_settings->set(QStringLiteral("wp-starvis-sentry"),
                    QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(cfg))
                                          .toJson(QJsonDocument::Compact)));
    qInfo() << "[starvis.sentry] detection mode for" << cameraId << "->" << mode;
}

QString SentryService::eventSourceStatus() const
{
    if (!m_directEvents)
        return QStringLiteral("indisponible");
    if (!m_directEvents->configured())
        return QStringLiteral("identifiants manquants");
    QString status = m_directEvents->status();
    if (!m_directEvents->smartStatus().isEmpty())
        status += QStringLiteral(" · ") + m_directEvents->smartStatus();
    if (m_filteredMotionCount > 0) {
        // Surfaced because "nothing happens" is otherwise ambiguous: the
        // camera may be sending only plain motion, which this scope drops.
        status += QStringLiteral(" · %1 mouvement(s) ignoré(s)").arg(m_filteredMotionCount);
    }
    return status;
}

// ── Known people: named reference snapshots ─────────────────────────────────

QString SentryService::peopleDir() const
{
    return m_settings->dataDir() + QStringLiteral("/known-people");
}

void SentryService::loadPeople()
{
    const QString raw = m_settings->get(QStringLiteral("wp-starvis-people")).toString();
    if (raw.isEmpty())
        return;
    for (const QVariant& entry : QJsonDocument::fromJson(raw.toUtf8()).array().toVariantList()) {
        const QVariantMap person = entry.toMap();
        // Drop entries whose reference image no longer exists on disk.
        if (QFile::exists(person.value(QStringLiteral("file")).toString()))
            m_people.append(person);
    }
    qInfo() << "[starvis.sentry]" << m_people.size() << "personne(s) connue(s)";
}

void SentryService::persistPeople()
{
    m_settings->set(QStringLiteral("wp-starvis-people"),
                    QString::fromUtf8(QJsonDocument(QJsonArray::fromVariantList(m_people))
                                          .toJson(QJsonDocument::Compact)));
    emit peopleChanged();
}

bool SentryService::namePerson(const QString& eventId, const QString& name)
{
    const QString clean = name.trimmed();
    if (clean.isEmpty() || eventId.isEmpty())
        return false;
    // The event's snapshot becomes the reference; it must still be in memory.
    const QImage snapshot = m_provider->image(QStringLiteral("event/") + eventId);
    if (snapshot.isNull()) {
        qWarning() << "[starvis.sentry] pas d'image pour l'événement" << eventId;
        return false;
    }

    QDir().mkpath(peopleDir());
    const QString id = QUuid::createUuid().toString(QUuid::Id128);
    const QString file = peopleDir() + QStringLiteral("/") + id + QStringLiteral(".jpg");
    QImage reference = snapshot;
    if (reference.width() > 640)
        reference = reference.scaledToWidth(640, Qt::SmoothTransformation);
    if (!reference.save(file, "JPEG", 82)) {
        qWarning() << "[starvis.sentry] écriture de la référence impossible:" << file;
        return false;
    }

    m_people.append(QVariantMap{
        {QStringLiteral("id"), id},
        {QStringLiteral("name"), clean},
        {QStringLiteral("file"), file},
        {QStringLiteral("addedAt"), QDateTime::currentDateTime().toString(Qt::ISODate)},
    });
    persistPeople();
    logActivity(QStringLiteral("direct"), QStringLiteral("config"),
                QStringLiteral("Personne enregistrée : ") + clean);
    qInfo() << "[starvis.sentry] référence ajoutée pour" << clean;
    return true;
}

void SentryService::forgetPerson(const QString& personId)
{
    for (int i = 0; i < m_people.size(); ++i) {
        const QVariantMap person = m_people.at(i).toMap();
        if (person.value(QStringLiteral("id")).toString() != personId)
            continue;
        QFile::remove(person.value(QStringLiteral("file")).toString());
        logActivity(QStringLiteral("direct"), QStringLiteral("config"),
                    QStringLiteral("Personne oubliée : ")
                        + person.value(QStringLiteral("name")).toString());
        m_people.removeAt(i);
        persistPeople();
        return;
    }
}

QVector<QPair<QString, QImage>> SentryService::referenceGallery() const
{
    QVector<QPair<QString, QImage>> gallery;
    // Capped: every reference is re-sent with each identification, so the
    // gallery is a per-event cost.
    for (const QVariant& entry : m_people) {
        if (gallery.size() >= 6)
            break;
        const QVariantMap person = entry.toMap();
        QImage image(person.value(QStringLiteral("file")).toString());
        if (!image.isNull())
            gallery.append({person.value(QStringLiteral("name")).toString(), image});
    }
    return gallery;
}

// ── Activity log: what Starvis did, per source, for the last 24 hours ────────

void SentryService::logActivity(const QString& cameraId, const QString& kind,
                                const QString& text)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    m_activity.prepend(QVariantMap{
        {QStringLiteral("at"), now},
        {QStringLiteral("time"), QDateTime::currentDateTime().toString(QStringLiteral("HH:mm:ss"))},
        {QStringLiteral("cameraId"), cameraId},
        {QStringLiteral("kind"), kind},
        {QStringLiteral("text"), text},
    });
    // Retention first, then the hard cap.
    while (!m_activity.isEmpty()) {
        const qint64 at = m_activity.last().toMap().value(QStringLiteral("at")).toLongLong();
        if (now - at <= kActivityRetentionMs && m_activity.size() <= kMaxActivityEntries)
            break;
        m_activity.removeLast();
    }
    persistActivity();
    emit activityChanged();
}

QVariantList SentryService::activityFor(const QString& cameraId, int limit) const
{
    const qint64 cutoff = QDateTime::currentMSecsSinceEpoch() - kActivityRetentionMs;
    QVariantList out;
    for (const QVariant& entry : m_activity) {
        const QVariantMap row = entry.toMap();
        if (row.value(QStringLiteral("cameraId")).toString() != cameraId)
            continue;
        if (row.value(QStringLiteral("at")).toLongLong() < cutoff)
            continue;
        out.append(row);
        if (out.size() >= limit)
            break;
    }
    return out;
}

void SentryService::persistActivity()
{
    m_settings->set(QStringLiteral("wp-starvis-vision-log"),
                    QString::fromUtf8(QJsonDocument(QJsonArray::fromVariantList(m_activity))
                                          .toJson(QJsonDocument::Compact)));
}

void SentryService::loadActivity()
{
    const QString raw = m_settings->get(QStringLiteral("wp-starvis-vision-log")).toString();
    if (raw.isEmpty())
        return;
    const qint64 cutoff = QDateTime::currentMSecsSinceEpoch() - kActivityRetentionMs;
    for (const QVariant& entry : QJsonDocument::fromJson(raw.toUtf8()).array().toVariantList()) {
        if (entry.toMap().value(QStringLiteral("at")).toLongLong() >= cutoff)
            m_activity.append(entry);
    }
}

void SentryService::setLivePreview(bool enabled)
{
    if (m_livePreview == enabled)
        return;
    m_livePreview = enabled;
    if (enabled) {
        pullLivePreviews();
        m_previewTimer.start();
    } else {
        m_previewTimer.stop();
    }
}

void SentryService::pullLivePreviews()
{
    // The Vision tile now shows the RTSP stream directly, so this no longer
    // feeds the display. It only refreshes the fallback evidence frame used
    // when a snapshot at event time fails — hence the slow cadence.
    if (!m_directEvents || !m_directEvents->configured())
        return;
    m_directEvents->fetchSnapshot(this, [this](const QImage& snapshot) {
        if (snapshot.isNull())
            return;
        m_provider->storeImage(QStringLiteral("live/direct"), snapshot);
        m_lastFrames.insert(QStringLiteral("direct"), snapshot);
        ++m_sourceFrameIds[QStringLiteral("direct")];
        ++m_liveFrameId;
        emit liveFrameChanged();
    });
}

void SentryService::enableCameraPerimeterRules()
{
    if (!m_directEvents)
        return;
    logActivity(QStringLiteral("direct"), QStringLiteral("config"),
                QStringLiteral("Activation des règles de périmètre sur la caméra"));
    m_directEvents->enablePerimeterRules();
}

void SentryService::useSingleCameraRule(const QString& keep)
{
    if (!m_directEvents)
        return;
    logActivity(QStringLiteral("direct"), QStringLiteral("config"),
                QStringLiteral("Exclusivité VCA : conservation de ") + keep);
    m_directEvents->useSinglePerimeterRule(keep);
}

QString SentryService::voiceAlertMode() const
{
    const QString stored = sentryConfig().value(QStringLiteral("voiceAlerts")).toString();
    if (stored == QLatin1String("off") || stored == QLatin1String("alerts")
        || stored == QLatin1String("all"))
        return stored;
    return QStringLiteral("all"); // every perimeter event is announced
}

void SentryService::setVoiceAlertMode(const QString& mode)
{
    QVariantMap cfg = sentryConfig();
    cfg.insert(QStringLiteral("voiceAlerts"), mode);
    m_settings->set(QStringLiteral("wp-starvis-sentry"),
                    QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(cfg))
                                          .toJson(QJsonDocument::Compact)));
    qInfo() << "[starvis.sentry] voice alerts ->" << voiceAlertMode();
    emit configChanged();
    if (mode != QLatin1String("off") && m_starvis && m_starvis->canSpeak())
        m_starvis->speak(QStringLiteral("Alertes vocales activées."));
}

QString SentryService::eventScope() const
{
    const QString stored = sentryConfig().value(QStringLiteral("eventScope")).toString();
    return stored == QLatin1String("all") ? stored : QStringLiteral("intrusion");
}

void SentryService::setEventScope(const QString& scope)
{
    QVariantMap cfg = sentryConfig();
    cfg.insert(QStringLiteral("eventScope"),
               scope == QLatin1String("all") ? scope : QStringLiteral("intrusion"));
    m_settings->set(QStringLiteral("wp-starvis-sentry"),
                    QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(cfg))
                                          .toJson(QJsonDocument::Compact)));
    m_filteredMotionCount = 0;
    qInfo() << "[starvis.sentry] event scope ->" << eventScope();
    logActivity(QStringLiteral("direct"), QStringLiteral("config"),
                QStringLiteral("Portée des alertes : ")
                    + (eventScope() == QLatin1String("intrusion")
                           ? QStringLiteral("intrusions du périmètre")
                           : QStringLiteral("tout mouvement")));
}

bool SentryService::anyArmed() const
{
    const QVariantMap cfg = sentryConfig();
    if (cfg.value(QStringLiteral("webcamArmed"), true).toBool() && webcamAvailable())
        return true;
    const QVariantMap armedMap = cfg.value(QStringLiteral("armed")).toMap();
    for (auto it = armedMap.constBegin(); it != armedMap.constEnd(); ++it)
        if (it.value().toBool())
            return true;
    return false;
}

void SentryService::onCameraEvent(const QString& cameraId, const QString& label,
                                  const QString& target, const QString& category)
{
    if (!cameraArmed(cameraId))
        return;

    // Perimeter focus: plain movement (rain, headlights, branches) is not an
    // intrusion. Only line crossings, zone entries and camera tampering get
    // through unless the scope is widened.
    if (eventScope() == QLatin1String("intrusion")
        && category != QLatin1String("intrusion") && category != QLatin1String("tamper")) {
        ++m_filteredMotionCount;
        if (m_filteredMotionCount == 1 || m_filteredMotionCount % 25 == 0) {
            qInfo() << "[starvis.sentry] ignored (scope=intrusion):" << label
                    << "— total ignored" << m_filteredMotionCount;
            logActivity(cameraId, QStringLiteral("ignored"),
                        QStringLiteral("Ignoré (portée intrusion) : %1 — %2 au total")
                            .arg(label).arg(m_filteredMotionCount));
        }
        emit configChanged(); // refresh the settings readout counter
        return;
    }

    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    const qint64 cooldown =
        qBound(5, sentryConfig().value(QStringLiteral("cooldownSec"), 30).toInt(), 3600) * 1000LL;
    if (now - m_lastCameraEventMs.value(cameraId) < cooldown) {
        qInfo() << "[starvis.sentry] camera event suppressed (cooldown):" << label;
        logActivity(cameraId, QStringLiteral("ignored"),
                    QStringLiteral("Répétition ignorée (délai) : ") + label);
        return;
    }
    m_lastCameraEventMs.insert(cameraId, now);
    logActivity(cameraId, QStringLiteral("event"),
                QStringLiteral("Événement périmètre : ") + label
                    + (target.isEmpty() ? QString()
                                        : QStringLiteral(" [") + target + QLatin1Char(']')));

    QString hint = label;
    if (target == QLatin1String("human") || target == QLatin1String("person"))
        hint += QStringLiteral(" (personne détectée par la caméra)");
    else if (target == QLatin1String("vehicle"))
        hint += QStringLiteral(" (véhicule détecté par la caméra)");

    if (!sentryConfig().value(QStringLiteral("escalate"), true).toBool()) {
        recordEvent(cameraId, m_lastFrames.value(cameraId), {}, 1.0, hint);
        return;
    }
    // Evidence comes from the camera itself at full resolution; the last
    // decoded stream frame is the fallback when the snapshot call fails.
    m_directEvents->fetchSnapshot(this, [this, cameraId, hint](const QImage& snapshot) {
        const QImage evidence = snapshot.isNull() ? m_lastFrames.value(cameraId) : snapshot;
        if (evidence.isNull()) {
            recordEvent(cameraId, {}, {}, 1.0, hint);
            return;
        }
        escalate(cameraId, evidence, 1.0, hint);
    });
}

void SentryService::onFrame(const QString& cameraId, const QImage& frame)
{
    if (!cameraArmed(cameraId))
        return;
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (now - m_lastFrameMs.value(cameraId) < kAnalyzeIntervalMs)
        return;
    m_lastFrameMs.insert(cameraId, now);
    // Kept regardless of the detection mode: it is the fallback evidence for a
    // device-raised event whose snapshot call fails.
    m_lastFrames.insert(cameraId, frame);

    if (cameraId != QLatin1String("webcam")
        && detectionMode(cameraId) == QLatin1String("camera"))
        return; // the device is the trigger; no local differencing needed

    const MotionDetector::Result result = m_detector.analyze(cameraId, frame, now);

    if (cameraId == QLatin1String("webcam")) {
        updatePresence(result.motion || result.suppressed
                       || result.score >= m_detector.threshold() * 0.5, frame);
        return; // the webcam is for presence, not intrusion alerts
    }

    if (result.motion) {
        qInfo() << "[starvis.sentry] motion on" << cameraId
                << "score" << result.score << "zone" << result.zoneIndex;
        if (sentryConfig().value(QStringLiteral("escalate"), true).toBool())
            escalate(cameraId, frame, result.score);
        else
            recordEvent(cameraId, frame, {}, result.score);
    }
}

void SentryService::escalate(const QString& cameraId, const QImage& frame, double score,
                             const QString& hint)
{
    AnthropicClient* anthropic = m_starvis ? m_starvis->anthropic() : nullptr;
    if (!anthropic || !anthropic->configured()) {
        recordEvent(cameraId, frame, {}, score, hint);
        return;
    }
    if (m_starvis->state())
        m_starvis->state()->setAnalyzing(true);
    QString prompt = QLatin1String(kClassifyPrompt);
    if (!hint.isEmpty()) {
        // What the camera itself decided, so the model adjudicates rather than
        // re-detects — this is the whole point of using the device's analytics.
        prompt += QStringLiteral("\nThe camera's own analytics raised: ") + hint
                + QStringLiteral(". Judge what is actually in the frame.");
    }
    qInfo() << "[starvis.sentry] escalating" << cameraId << "snapshot to vision model"
            << (hint.isEmpty() ? QString() : QStringLiteral("hint=") + hint);
    logActivity(cameraId, QStringLiteral("analysis"),
                QStringLiteral("Image envoyée à ") + m_starvis->model()
                    + QStringLiteral(" pour analyse"));
    anthropic->classifyImage(frame, prompt, m_starvis->model(), this,
                             [this, cameraId, frame, score, hint](const QJsonObject& result,
                                                                  const QString& raw,
                                                                  const QString& error) {
        if (m_starvis->state())
            m_starvis->state()->setAnalyzing(false);
        if (!error.isEmpty()) {
            qWarning() << "[starvis.sentry] classification failed:" << error;
            recordEvent(cameraId, frame, {}, score, hint);
            return;
        }
        qInfo() << "[starvis.sentry] classified:" << QJsonDocument(result).toJson(
            QJsonDocument::Compact) << (result.isEmpty() ? "raw: " + raw.left(120) : "");
        identifyThenRecord(cameraId, frame, result, score, hint);
    });
}

void SentryService::identifyThenRecord(const QString& cameraId, const QImage& frame,
                                       const QJsonObject& classification, double score,
                                       const QString& hint)
{
    const bool person = classification.value(QLatin1String("person")).toBool();
    const QVector<QPair<QString, QImage>> gallery = referenceGallery();
    AnthropicClient* anthropic = m_starvis ? m_starvis->anthropic() : nullptr;
    if (!person || gallery.isEmpty() || !anthropic) {
        recordEvent(cameraId, frame, classification, score, hint);
        return;
    }

    qInfo() << "[starvis.sentry] identification contre" << gallery.size() << "référence(s)";
    anthropic->classifyWithGallery(gallery, frame, QLatin1String(kIdentifyPrompt),
                                   m_starvis->model(), this,
                                   [this, cameraId, frame, classification, score, hint]
                                   (const QJsonObject& result, const QString&,
                                    const QString& error) {
        QString name;
        if (error.isEmpty()) {
            const QString confidence = result.value(QLatin1String("confidence")).toString();
            // A hesitant match is worse than none: naming the wrong person
            // would quietly downgrade a real intrusion.
            if (confidence == QLatin1String("high") || confidence == QLatin1String("medium"))
                name = result.value(QLatin1String("match")).toString().trimmed();
            // Only a name that is actually in the registry may be announced;
            // an invented one would sound authoritative and be wrong.
            bool known = false;
            for (const QVariant& entry : m_people) {
                if (entry.toMap().value(QStringLiteral("name")).toString()
                        .compare(name, Qt::CaseInsensitive) == 0) {
                    known = true;
                    break;
                }
            }
            if (!known)
                name.clear();
            qInfo() << "[starvis.sentry] identification:"
                    << (name.isEmpty() ? QStringLiteral("inconnu") : name)
                    << "confiance" << confidence;
        } else {
            qWarning() << "[starvis.sentry] identification échouée:" << error;
        }
        recordEvent(cameraId, frame, classification, score, hint, name);
    });
}

void SentryService::recordEvent(const QString& cameraId, const QImage& frame,
                                const QJsonObject& classification, double score,
                                const QString& hint, const QString& knownName)
{
    const QString id = QUuid::createUuid().toString(QUuid::Id128);
    // An event can arrive before any frame exists (stream just came up, or a
    // snapshot failed). Storing a null image only produces a broken tile.
    const bool hasEvidence = !frame.isNull();
    if (hasEvidence)
        m_provider->storeImage(QStringLiteral("event/") + id, frame);

    const bool person = classification.value(QLatin1String("person")).toBool();
    const bool atDoor = classification.value(QLatin1String("at_door")).toBool();
    // An event nobody could judge is NOT routine: keep it at "notice" so it is
    // still announced in "Menaces" mode. Silence on a failed analysis is the
    // worst outcome for a perimeter alarm.
    const bool unjudged = classification.isEmpty();
    QString threat = classification.value(QLatin1String("threat")).toString();
    if (threat.isEmpty())
        threat = QStringLiteral("notice");
    QString description = classification.value(QLatin1String("description")).toString();
    if (description.isEmpty()) {
        description = hint.isEmpty()
            ? QStringLiteral("Mouvement détecté (%1)").arg(cameraId)
            : hint.left(1).toUpper() + hint.mid(1);
        if (unjudged)
            description += QStringLiteral(" — analyse indisponible");
    }
    // A recognised resident is named and never treated as an intrusion.
    if (!knownName.isEmpty()) {
        description = QStringLiteral("%1 — %2").arg(knownName, description);
        if (threat == QLatin1String("alert"))
            threat = QStringLiteral("notice");
    }

    QVariantMap event{
        {QStringLiteral("id"), id},
        {QStringLiteral("cameraId"), cameraId},
        {QStringLiteral("at"), QDateTime::currentDateTime().toString(QStringLiteral("HH:mm:ss"))},
        {QStringLiteral("description"), description},
        {QStringLiteral("person"), person},
        {QStringLiteral("atDoor"), atDoor},
        {QStringLiteral("threat"), threat},
        {QStringLiteral("score"), score},
        {QStringLiteral("image"), hasEvidence
                                      ? QStringLiteral("image://starvis/event/") + id
                                      : QString()},
    };
    m_events.prepend(event);
    while (m_events.size() > kMaxEvents)
        m_events.removeLast();
    emit eventsChanged();

    QString text;
    if (atDoor)
        text = QStringLiteral("Quelqu'un à la porte — ") + description;
    else if (threat == QLatin1String("alert"))
        text = QStringLiteral("Intrusion possible — ") + description;
    else
        text = description;

    const QString severity = threat == QLatin1String("alert") ? QStringLiteral("alert")
                            : (person || atDoor || unjudged) ? QStringLiteral("notice")
                            : QStringLiteral("info");
    if (m_starvis && m_starvis->state() && severity != QLatin1String("info"))
        m_starvis->state()->triggerAlert(text, severity);
    if (severity == QLatin1String("alert") || atDoor) {
        ++m_pendingAlerts;
        emit badgeCountChanged(m_pendingAlerts);
    }

    // Spoken alert. "alerts" limits it to real threats; "all" narrates every
    // perimeter event. Never suppressed by quiet hours — an intrusion at 3am
    // is precisely when it must be heard.
    const QString voiceMode = voiceAlertMode();
    const bool speakThis = voiceMode == QLatin1String("all")
        || (voiceMode == QLatin1String("alerts")
            && (severity == QLatin1String("alert") || atDoor || unjudged));
    if (speakThis && m_starvis && m_starvis->canSpeak()) {
        // "À la porte" is the most useful thing to hear, so it leads the
        // spoken line as it already did the written one.
        QString spoken;
        if (severity == QLatin1String("alert"))
            spoken = QStringLiteral("Alerte périmètre. ") + description;
        else if (atDoor)
            spoken = QStringLiteral("Quelqu'un à la porte. ") + description;
        else
            spoken = QStringLiteral("%1 : %2").arg(cameraLabel(cameraId), description);
        m_starvis->speak(spoken);
        logActivity(cameraId, QStringLiteral("alert"),
                    QStringLiteral("Annonce vocale : ") + spoken);
    }
    emit alertRaised(text, severity);
    logActivity(cameraId,
                severity == QLatin1String("alert") ? QStringLiteral("alert")
                                                   : QStringLiteral("analysis"),
                (severity == QLatin1String("alert") ? QStringLiteral("ALERTE : ")
                 : severity == QLatin1String("notice") ? QStringLiteral("À signaler : ")
                                                       : QStringLiteral("Sans suite : "))
                    + description);
    qInfo() << "[starvis.sentry] event recorded:" << cameraId << threat << description;
}

void SentryService::updatePresence(bool motion, const QImage& frame)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (!motion) {
        m_presenceStreak = 0;
        return;
    }
    m_lastWebcamMotionMs = now;
    m_absenceTimer.start();

    if (m_presence == QLatin1String("absent")) {
        if (++m_presenceStreak >= kPresenceStreakNeeded) {
            m_presence = QStringLiteral("present");
            qInfo() << "[starvis.sentry] presence -> present";
            logActivity(QStringLiteral("webcam"), QStringLiteral("presence"),
                        QStringLiteral("Présence détectée"));
            emit presenceChanged();
            issueGreeting(frame);
        }
    }
}

bool SentryService::inQuietHours() const
{
    const QVariantMap cfg = greetConfig();
    const QTime start = QTime::fromString(
        cfg.value(QStringLiteral("quietStart"), QStringLiteral("22:00")).toString(),
        QStringLiteral("HH:mm"));
    const QTime end = QTime::fromString(
        cfg.value(QStringLiteral("quietEnd"), QStringLiteral("07:00")).toString(),
        QStringLiteral("HH:mm"));
    const QTime now = QTime::currentTime();
    if (!start.isValid() || !end.isValid())
        return false;
    if (start <= end)
        return now >= start && now < end;
    return now >= start || now < end; // spans midnight
}

void SentryService::issueGreeting(const QImage& frame)
{
    const QVariantMap cfg = greetConfig();
    if (!cfg.value(QStringLiteral("enabled"), true).toBool())
        return;
    if (inQuietHours()) {
        qInfo() << "[starvis.sentry] greeting suppressed (quiet hours)";
        return;
    }
    const qint64 cooldownMs =
        qBound(10, cfg.value(QStringLiteral("cooldownMin"), 240).toInt(), 24 * 60) * 60000LL;
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (m_lastGreetingMs > 0 && now - m_lastGreetingMs < cooldownMs) {
        qInfo() << "[starvis.sentry] greeting suppressed (cooldown)";
        return;
    }

    // The cooldown is spent even when the greeting turns out to be the local
    // one, so a failing key cannot turn arrivals into a stream of greetings.
    m_lastGreetingMs = now;

    AnthropicClient* anthropic = m_starvis ? m_starvis->anthropic() : nullptr;
    if (!anthropic || !anthropic->configured()) {
        // No vision brain: greet from the clock rather than from the face.
        // Staying silent here was the one path that dropped the arrival.
        qInfo() << "[starvis.sentry] greeting without vision (no key)";
        deliverGreeting(localGreeting());
        return;
    }
    if (m_starvis->state())
        m_starvis->state()->setAnalyzing(true);
    qInfo() << "[starvis.sentry] arrival detected, reading non-verbals for greeting";
    anthropic->classifyImage(frame, QLatin1String(kGreetPrompt), m_starvis->model(), this,
                             [this](const QJsonObject& result, const QString&,
                                    const QString& error) {
        if (m_starvis->state())
            m_starvis->state()->setAnalyzing(false);
        if (!error.isEmpty()) {
            qWarning() << "[starvis.sentry] greeting vision failed:" << error;
            deliverGreeting(localGreeting());
            return;
        }
        const QString greeting = result.value(QLatin1String("greeting_fr")).toString();
        const QString mood = result.value(QLatin1String("mood")).toString();
        if (greeting.isEmpty()) {
            qWarning() << "[starvis.sentry] greeting empty, falling back to the clock";
            deliverGreeting(localGreeting());
            return;
        }
        qInfo() << "[starvis.sentry] greeting (mood:" << mood << "):" << greeting;
        deliverGreeting(greeting, mood);
    });
}

QString SentryService::localGreeting() const
{
    const int hour = QTime::currentTime().hour();
    const QString salutation = hour < 12  ? QStringLiteral("Bonjour")
                             : hour < 18  ? QStringLiteral("Bon après-midi")
                                          : QStringLiteral("Bonsoir");
    // No face was read, so the line claims nothing about how you look.
    return salutation
        + QStringLiteral(", je vous ai vu arriver. Dites-moi si vous voulez le briefing.");
}

void SentryService::deliverGreeting(const QString& text, const QString& mood)
{
    if (text.isEmpty())
        return;
    m_presence = QStringLiteral("greeted");
    emit presenceChanged();
    logActivity(QStringLiteral("webcam"), QStringLiteral("presence"),
                mood.isEmpty()
                    ? QStringLiteral("Accueil — ") + text
                    : QStringLiteral("Accueil (humeur : %1) — %2").arg(mood, text));
    emit alertRaised(text, QStringLiteral("info"));
    // Visual greeting lands even with no audio device; speech is a bonus.
    if (m_starvis && m_starvis->canSpeak())
        m_starvis->speak(text);
}

QString SentryService::statusSnapshot() const
{
    QStringList lines;
    lines << QStringLiteral("Détection caméra directe: %1, portée %2 (%3).")
                 .arg(detectionMode(QStringLiteral("direct")),
                      eventScope() == QLatin1String("intrusion")
                          ? QStringLiteral("intrusions seulement")
                          : QStringLiteral("tout mouvement"),
                      eventSourceStatus());
    lines << QStringLiteral("Caméras: xprotect %1, direct %2, webcam %3.")
                 .arg(cameraArmed(QStringLiteral("xprotect"))
                          ? QStringLiteral("armée") : QStringLiteral("désarmée"),
                      cameraArmed(QStringLiteral("direct"))
                          ? QStringLiteral("armée") : QStringLiteral("désarmée"),
                      webcamAvailable()
                          ? (cameraArmed(QStringLiteral("webcam"))
                                 ? QStringLiteral("active") : QStringLiteral("désactivée"))
                          : QStringLiteral("absente"));
    lines << QStringLiteral("Présence: %1.").arg(m_presence);
    if (m_events.isEmpty()) {
        lines << QStringLiteral("Aucun événement récent.");
    } else {
        lines << QStringLiteral("Derniers événements:");
        for (int i = 0; i < m_events.size() && i < 4; ++i) {
            const QVariantMap event = m_events.at(i).toMap();
            lines << QStringLiteral("- [%1 %2] %3")
                         .arg(event.value(QStringLiteral("at")).toString(),
                              event.value(QStringLiteral("cameraId")).toString(),
                              event.value(QStringLiteral("description")).toString());
        }
    }
    return lines.join(QLatin1Char('\n'));
}

} // namespace qtpanel
