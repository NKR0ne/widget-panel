#pragma once

#include "MotionDetector.h"

#include <QImage>
#include <QMutex>
#include <QObject>
#include <QQuickImageProvider>
#include <QTimer>
#include <QVariantList>

namespace qtpanel {

class AnthropicClient;
class CameraClient;
class DirectCameraClient;
class HikvisionEventClient;
class HttpClient;
class SecretVault;
class SettingsStore;
class StarvisService;
class WebcamCapture;

// Serves the sentry event thumbnails: image://starvis/event/<id>
class SentryImageProvider : public QQuickImageProvider {
public:
    SentryImageProvider() : QQuickImageProvider(QQuickImageProvider::Image) {}
    QImage requestImage(const QString& id, QSize* size, const QSize& requested) override;
    void storeImage(const QString& id, const QImage& image);
    QImage image(const QString& id) const;

private:
    mutable QMutex m_mutex;
    QHash<QString, QImage> m_images; // pruned alongside the event ring
};

// Local-first camera analytics: frames from the security cameras and the
// webcam run through MotionDetector; motion events snapshot to Claude vision
// for classification ({person, at_door, threat}); alerts fan out to the UI.
// The webcam additionally drives a presence FSM (absent → present → greeted)
// for arrival greetings with non-verbal reading.
class SentryService : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool anyArmed READ anyArmed NOTIFY configChanged)
    Q_PROPERTY(QVariantList events READ events NOTIFY eventsChanged)
    Q_PROPERTY(QString presence READ presence NOTIFY presenceChanged)
    Q_PROPERTY(bool webcamAvailable READ webcamAvailable NOTIFY configChanged)
    // Bumped whenever a live preview frame lands, so QML Images can re-fetch
    // image://starvis/live/<source>.
    Q_PROPERTY(int liveFrameId READ liveFrameId NOTIFY liveFrameChanged)

public:
    SentryService(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                  StarvisService* starvis, CameraClient* xprotect,
                  DirectCameraClient* direct, QObject* parent = nullptr);

    SentryImageProvider* imageProvider() const { return m_provider; }

    bool anyArmed() const;
    QVariantList events() const { return m_events; }
    QString presence() const { return m_presence; }
    bool webcamAvailable() const;

    Q_INVOKABLE bool cameraArmed(const QString& cameraId) const;
    Q_INVOKABLE void setCameraArmed(const QString& cameraId, bool armed);
    // "camera" (the device's own analytics), "local" (frame differencing here),
    // or "both". Cameras that expose events default to their own detection.
    Q_INVOKABLE QString detectionMode(const QString& cameraId) const;
    Q_INVOKABLE void setDetectionMode(const QString& cameraId, const QString& mode);
    // Live state of the camera event subscription, for the settings readout.
    Q_INVOKABLE QString eventSourceStatus() const;
    // "intrusion" (line crossing / zone entry / tamper only) or "all".
    Q_INVOKABLE QString eventScope() const;
    Q_INVOKABLE void setEventScope(const QString& scope);
    // Spoken announcements: "off" | "alerts" (threats only) | "all" events.
    Q_INVOKABLE QString voiceAlertMode() const;
    Q_INVOKABLE void setVoiceAlertMode(const QString& mode);
    // Writes the per-rule enable flag the camera's web UI never sets.
    Q_INVOKABLE void enableCameraPerimeterRules();
    Q_INVOKABLE void useSingleCameraRule(const QString& keep);

    // ── Known people ────────────────────────────────────────────────────
    // Naming someone on an event keeps that snapshot as a reference; later
    // events are compared against the named references so Starvis can say who
    // it is instead of "une personne". No face database — the same vision
    // model does the comparison.
    Q_INVOKABLE QVariantList knownPeople() const { return m_people; }
    // Uses the snapshot already stored for that event as the reference.
    Q_INVOKABLE bool namePerson(const QString& eventId, const QString& name);
    Q_INVOKABLE void forgetPerson(const QString& personId);

    int liveFrameId() const { return m_liveFrameId; }
    // Per-source counter: a webcam frame must not make the camera tile refetch
    // an identical JPEG (and swap for nothing).
    Q_INVOKABLE int frameIdFor(const QString& source) const
    {
        return m_sourceFrameIds.value(source, 0);
    }
    // Live preview polling runs only while the Vision section is on screen.
    Q_INVOKABLE void setLivePreview(bool enabled);
    // Newest-first activity for one source, within the retention window.
    Q_INVOKABLE QVariantList activityFor(const QString& cameraId, int limit = 60) const;

    // Text summary for the check_cameras voice tool.
    QString statusSnapshot() const;

signals:
    void configChanged();
    void eventsChanged();
    void presenceChanged();
    void activityChanged();
    void liveFrameChanged();
    void peopleChanged();
    // severity: "alert" | "notice" | "info"; QML fans this into Ui.notify.
    void alertRaised(const QString& text, const QString& severity);
    void badgeCountChanged(int pendingAlerts);

private:
    void onFrame(const QString& cameraId, const QImage& frame);
    void onCameraEvent(const QString& cameraId, const QString& label, const QString& target,
                       const QString& category);
    void escalate(const QString& cameraId, const QImage& frame, double score,
                  const QString& hint = {});
    void recordEvent(const QString& cameraId, const QImage& frame,
                     const QJsonObject& classification, double score,
                     const QString& hint = {}, const QString& knownName = {});
    // Second pass, only when a person was seen and references exist.
    void identifyThenRecord(const QString& cameraId, const QImage& frame,
                            const QJsonObject& classification, double score,
                            const QString& hint);
    void loadPeople();
    void persistPeople();
    QString peopleDir() const;
    QVector<QPair<QString, QImage>> referenceGallery() const;
    void updatePresence(bool motion, const QImage& frame);
    void issueGreeting(const QImage& frame);
    // Common tail of every greeting, whether Claude wrote it or the clock did.
    void deliverGreeting(const QString& text, const QString& mood = {});
    // Vision-free greeting: used when there is no key, or the call failed.
    QString localGreeting() const;
    QVariantMap sentryConfig() const;
    QVariantMap greetConfig() const;
    void applyConfig();
    bool inQuietHours() const;
    // One line in the per-source activity log (kind: stream|event|ignored|
    // analysis|alert|presence|config). Pruned to 24 h and persisted.
    void logActivity(const QString& cameraId, const QString& kind, const QString& text);
    void loadActivity();
    void persistActivity();
    void pullLivePreviews();

    SettingsStore* m_settings = nullptr;
    StarvisService* m_starvis = nullptr;
    CameraClient* m_xprotect = nullptr;
    DirectCameraClient* m_direct = nullptr;
    WebcamCapture* m_webcam = nullptr;
    HikvisionEventClient* m_directEvents = nullptr;
    SentryImageProvider* m_provider = nullptr; // owned by the QML engine
    MotionDetector m_detector;
    QVariantList m_events; // newest first, capped at 8
    QString m_presence = QStringLiteral("absent"); // absent|present|greeted
    int m_presenceStreak = 0;
    qint64 m_lastWebcamMotionMs = 0;
    qint64 m_lastGreetingMs = 0;
    int m_pendingAlerts = 0;
    QTimer m_absenceTimer; // no webcam motion for 30 min -> absent
    QHash<QString, qint64> m_lastFrameMs;  // per-camera analysis throttle
    QHash<QString, QImage> m_lastFrames;   // fallback evidence for camera events
    QHash<QString, qint64> m_lastCameraEventMs; // cooldown for device events
    int m_filteredMotionCount = 0; // movement ignored under the intrusion scope
    QVariantList m_activity;       // newest first, 24 h retention
    QVariantList m_people;         // {id, name, file} — reference snapshots
    QTimer m_previewTimer;         // 1 Hz snapshot pull while Vision is visible
    int m_liveFrameId = 0;
    QHash<QString, int> m_sourceFrameIds;
    bool m_livePreview = false;
};

} // namespace qtpanel
