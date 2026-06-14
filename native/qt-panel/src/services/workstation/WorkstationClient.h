#pragma once

#include <QLocalSocket>
#include <QObject>
#include <QTimer>
#include <QVariantMap>

namespace qtpanel {

// Client for the WorkstationMonitor telemetry pipe
// (\\.\pipe\WorkstationMonitorTelemetry), same newline-JSON protocol the
// Electron main process spoke: register → registered handshake, heartbeat
// every 2s, then {"type":"snapshot"} polled at 1Hz.
class WorkstationClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)
    Q_PROPERTY(bool stale READ stale NOTIFY snapshotChanged)
    Q_PROPERTY(QVariantMap snapshot READ snapshot NOTIFY snapshotChanged)

public:
    explicit WorkstationClient(QObject* parent = nullptr);

    bool connected() const { return m_registered; }
    bool stale() const { return m_stale; }
    QVariantMap snapshot() const { return m_snapshot; }

    // Polling runs only while active (a workstation widget is on screen).
    Q_INVOKABLE void setActive(bool active);

signals:
    void connectedChanged();
    void snapshotChanged();

private:
    void connectPipe();
    void disconnectPipe();
    void onReadyRead();
    void handleLine(const QByteArray& line);
    void requestSnapshot();
    void sendJson(const QVariantMap& message);
    void markStale();

    QLocalSocket m_socket;
    QByteArray m_buffer;
    QTimer m_pollTimer;       // 1s snapshot cadence
    QTimer m_heartbeatTimer;  // 2s keep-alive
    QTimer m_reconnectTimer;  // 3s retry while active
    QTimer m_staleTimer;      // marks data stale when snapshots stop arriving
    QVariantMap m_snapshot;
    bool m_active = false;
    bool m_registered = false;
    bool m_awaitingSnapshot = false;
    bool m_stale = false;
};

} // namespace qtpanel
