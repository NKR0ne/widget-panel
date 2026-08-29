#include "WorkstationClient.h"

#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>

namespace qtpanel {

namespace {
constexpr int kPollMs = 1000;
constexpr int kHeartbeatMs = 2000;
constexpr int kReconnectMs = 3000;
constexpr int kConnectTimeoutMs = 1200;
constexpr int kRegistrationTimeoutMs = 1600;
} // namespace

WorkstationClient::WorkstationClient(QObject* parent)
    : WorkstationClient(parent, QStringLiteral("WorkstationMonitorTelemetry"), 3500)
{
}

WorkstationClient::WorkstationClient(QObject* parent, const QString& pipeName,
                                     int staleTimeoutMs)
    : QObject(parent)
    , m_pipeName(pipeName)
{
    m_pollTimer.setInterval(kPollMs);
    connect(&m_pollTimer, &QTimer::timeout, this, &WorkstationClient::requestSnapshot);

    m_heartbeatTimer.setInterval(kHeartbeatMs);
    connect(&m_heartbeatTimer, &QTimer::timeout, this, [this] {
        sendJson({{QStringLiteral("type"), QStringLiteral("heartbeat")}});
    });

    m_reconnectTimer.setInterval(kReconnectMs);
    m_reconnectTimer.setSingleShot(true);
    connect(&m_reconnectTimer, &QTimer::timeout, this, &WorkstationClient::connectPipe);

    m_connectTimer.setSingleShot(true);
    connect(&m_connectTimer, &QTimer::timeout, this, [this] {
        qWarning() << "[workstation] connection handshake timed out; reconnecting";
        disconnectPipe();
        scheduleReconnect();
    });

    m_staleTimer.setInterval(qMax(100, staleTimeoutMs));
    m_staleTimer.setSingleShot(true);
    connect(&m_staleTimer, &QTimer::timeout, this, &WorkstationClient::markStale);

    connect(&m_socket, &QLocalSocket::readyRead, this, &WorkstationClient::onReadyRead);
    connect(&m_socket, &QLocalSocket::connected, this, [this] {
        m_connectTimer.start(kRegistrationTimeoutMs);
        m_buffer.clear();
        sendJson({{QStringLiteral("type"), QStringLiteral("register")},
                  {QStringLiteral("clientName"), QStringLiteral("qt-panel")}});
    });
    connect(&m_socket, &QLocalSocket::errorOccurred, this, [this](QLocalSocket::LocalSocketError) {
        handleTransportFailure();
    });
    connect(&m_socket, &QLocalSocket::disconnected, this, [this] {
        handleTransportFailure();
    });
}

WorkstationClient::~WorkstationClient()
{
    // QLocalSocket emits state changes from its destructor. Disconnect it
    // before member teardown so those callbacks cannot restart dead timers.
    m_active = false;
    QObject::disconnect(&m_socket, nullptr, this, nullptr);
    m_pollTimer.stop();
    m_heartbeatTimer.stop();
    m_reconnectTimer.stop();
    m_connectTimer.stop();
    m_staleTimer.stop();
    if (m_socket.state() != QLocalSocket::UnconnectedState)
        m_socket.abort();
}

void WorkstationClient::setActive(bool active)
{
    if (m_active == active) {
        if (active && (!m_registered || m_stale)) {
            disconnectPipe();
            scheduleReconnect(0);
        }
        return;
    }
    m_active = active;
    if (active) {
        connectPipe();
    } else {
        sendJson({{QStringLiteral("type"), QStringLiteral("unregister")}});
        disconnectPipe();
        m_reconnectTimer.stop();
    }
}

void WorkstationClient::connectPipe()
{
    if (!m_active || m_socket.state() != QLocalSocket::UnconnectedState)
        return;
    m_connectTimer.start(kConnectTimeoutMs);
    m_socket.connectToServer(m_pipeName);
}

void WorkstationClient::disconnectPipe()
{
    if (m_resetting)
        return;
    m_resetting = true;
    const bool wasRegistered = m_registered;
    m_registered = false;
    m_awaitingSnapshot = false;
    m_pollTimer.stop();
    m_heartbeatTimer.stop();
    m_connectTimer.stop();
    m_staleTimer.stop();
    if (m_socket.state() != QLocalSocket::UnconnectedState)
        m_socket.abort();
    m_buffer.clear();
    if (!m_stale) {
        m_stale = true;
        emit snapshotChanged();
    }
    if (wasRegistered) {
        emit connectedChanged();
    }
    m_resetting = false;
}

void WorkstationClient::handleTransportFailure()
{
    if (m_resetting)
        return;
    disconnectPipe();
    scheduleReconnect();
}

void WorkstationClient::scheduleReconnect(int delayMs)
{
    if (!m_active)
        return;
    if (m_reconnectTimer.isActive() && m_reconnectTimer.remainingTime() <= delayMs)
        return;
    m_reconnectTimer.start(qMax(0, delayMs));
}

void WorkstationClient::onReadyRead()
{
    m_buffer.append(m_socket.readAll());
    int newline = -1;
    while ((newline = m_buffer.indexOf('\n')) >= 0) {
        const QByteArray line = m_buffer.left(newline).trimmed();
        m_buffer.remove(0, newline + 1);
        if (!line.isEmpty())
            handleLine(line);
    }
}

void WorkstationClient::handleLine(const QByteArray& line)
{
    const QJsonDocument doc = QJsonDocument::fromJson(line);
    if (!doc.isObject())
        return;
    const QJsonObject obj = doc.object();
    const QString type = obj.value(QLatin1String("type")).toString();

    if (type == QLatin1String("registered")) {
        qInfo() << "[workstation] registered with telemetry service";
        m_connectTimer.stop();
        m_registered = true;
        m_heartbeatTimer.start();
        m_pollTimer.start();
        emit connectedChanged();
        requestSnapshot();
        return;
    }

    if (!type.isEmpty()) {
        qWarning() << "[workstation] unexpected telemetry message" << type;
        return;
    }

    // Anything else is treated as a snapshot reply (the service answers the
    // snapshot request with the metrics object itself).
    m_awaitingSnapshot = false;
    m_snapshot = obj.toVariantMap();
    m_stale = obj.value(QLatin1String("stale")).toBool(false);
    m_staleTimer.start();
    emit snapshotChanged();
}

void WorkstationClient::requestSnapshot()
{
    if (!m_registered || m_awaitingSnapshot)
        return;
    m_awaitingSnapshot = true;
    sendJson({{QStringLiteral("type"), QStringLiteral("snapshot")}});
    // Clear the in-flight guard even if the reply never comes.
    QTimer::singleShot(1600, this, [this] { m_awaitingSnapshot = false; });
}

void WorkstationClient::sendJson(const QVariantMap& message)
{
    if (m_socket.state() != QLocalSocket::ConnectedState)
        return;
    m_socket.write(QJsonDocument(QJsonObject::fromVariantMap(message))
                       .toJson(QJsonDocument::Compact) + '\n');
}

void WorkstationClient::markStale()
{
    if (!m_stale) {
        m_stale = true;
        emit snapshotChanged();
    }
    if (!m_active)
        return;

    // A Windows named pipe can remain nominally connected after its server is
    // restarted. Writes then appear to succeed, but no snapshots arrive and
    // QLocalSocket emits neither errorOccurred nor disconnected. Treat the
    // stale watchdog as a transport failure so the subscription heals itself.
    qWarning() << "[workstation] telemetry stopped responding; reconnecting";
    disconnectPipe();
    scheduleReconnect(0);
}

} // namespace qtpanel
