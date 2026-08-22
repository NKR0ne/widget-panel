#pragma once

#include <QHash>
#include <QImage>
#include <QObject>
#include <QSet>
#include <QTimer>

#include <functional>

class QNetworkReply;

namespace qtpanel {

class HttpClient;
class SecretVault;
class SettingsStore;

// Subscribes to the camera's OWN detection instead of diffing frames here:
// GET /ISAPI/Event/notification/alertStream is a long-lived multipart stream of
// <EventNotificationAlert> documents raised by the camera's on-sensor
// analytics (motion, line crossing, field/intrusion, tamper), already zoned,
// scheduled and — on AI firmware — classified. Full-resolution snapshots come
// from /ISAPI/Streaming/channels/<n>/picture at event time.
class HikvisionEventClient : public QObject {
    Q_OBJECT

public:
    HikvisionEventClient(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                         QObject* parent = nullptr);

    // True when a host and credentials are stored (does not imply connected).
    bool configured() const;
    bool connected() const { return m_connected; }
    QString status() const { return m_status; }

    void setEnabled(bool enabled);

    // Full-resolution still from the camera itself; falls back to a null image.
    void fetchSnapshot(QObject* context, std::function<void(const QImage&)> callback);

    // Whether the camera's perimeter analytics are actually switched on in the
    // DEVICE. Without them it only ever raises plain motion, and an intrusion
    // scope stays silent — this turns that silence into a stated reason.
    void probeSmartCapabilities();
    QString smartStatus() const { return m_smartStatus; }

    // The camera's web UI writes rule coordinates but leaves each rule's own
    // <enabled> flag false, so the analytic never evaluates. This flips that
    // flag through the API, changing nothing else, and re-reads to confirm.
    void enablePerimeterRules();
    // These models allow only ONE smart analytic at a time. Keeping both
    // perimeter functions on leaves the camera unable to arm either rule, so
    // this disables the other one and arms the chosen rule alone.
    void useSinglePerimeterRule(const QString& keep);

    // Which security question an ISAPI eventType answers:
    //   "intrusion" — someone crossed a line or entered a guarded zone
    //   "tamper"    — the camera itself was blinded or moved
    //   "motion"    — something moved somewhere (the noisy one)
    //   "other"     — everything else the device can raise
    static QString categoryForEventType(const QString& type);

signals:
    // type: the raw ISAPI eventType; label: human French wording;
    // target: "human"/"vehicle"/"" when the camera classified it;
    // category: see categoryForEventType.
    void eventDetected(const QString& type, const QString& label, const QString& target,
                       const QString& category);
    void statusChanged();

private:
    void connectStream();
    void openStream();
    // The alert stream carries only subscribed event types; the default
    // subscription omits the smart analytics.
    void subscribeToAllEvents();
    void scheduleReconnect();
    void consume(const QByteArray& chunk);
    void handleAlert(const QByteArray& xml);
    void setStatus(const QString& status, bool connected);
    QString baseUrl() const;
    QString user() const;
    QString password() const;
    int channel() const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    HttpClient* m_http = nullptr;
    QNetworkReply* m_stream = nullptr;
    QByteArray m_buffer;
    QTimer m_reconnectTimer;
    QString m_status = QStringLiteral("idle");
    QString m_smartStatus;
    QHash<QString, QString> m_smartResults; // feature -> état
    QSet<QString> m_seenTypes;             // logged once each, for diagnosis
    QString m_lastActiveType;
    qint64 m_lastEventMs = 0;
    int m_reconnectDelayMs = 2000;
    bool m_enabled = false;
    bool m_connected = false;
    bool m_sawAlert = false;
    bool m_subscribed = false; // event subscription attempted this session
};

} // namespace qtpanel
