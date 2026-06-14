#include "HelperServer.h"

#include <QCoreApplication>
#include <QDebug>
#include <QDir>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonDocument>
#include <QProcess>

namespace qtpanel {

namespace {
constexpr quint16 kHelperPort = 47321;
constexpr int kListenRetryMs = 5000;
} // namespace

HelperServer::HelperServer(QObject* parent)
    : QObject(parent)
{
    connect(&m_server, &QTcpServer::newConnection, this, &HelperServer::onNewConnection);
    m_retryTimer.setSingleShot(true);
    m_retryTimer.setInterval(kListenRetryMs);
    connect(&m_retryTimer, &QTimer::timeout, this, &HelperServer::tryListen);
}

void HelperServer::start(bool spawnHelperProcess)
{
    m_spawnRequested = spawnHelperProcess;
    tryListen();
}

void HelperServer::tryListen()
{
    if (m_server.isListening())
        return;
    if (!m_server.listen(QHostAddress::LocalHost, kHelperPort)) {
        // Most likely the Electron app still owns the port; keep retrying.
        qWarning() << "[helper] port" << kHelperPort << "busy ("
                   << m_server.errorString() << ") — retrying in" << kListenRetryMs << "ms";
        m_retryTimer.start();
        return;
    }
    qInfo() << "[helper] listening on 127.0.0.1:" << kHelperPort;
    if (m_spawnRequested)
        spawnHelper();
}

void HelperServer::spawnHelper()
{
    if (m_helperProcess)
        return;
    const QString path = findHelperExecutable();
    if (path.isEmpty()) {
        qInfo() << "[helper] taskbar-btn.exe not found — panel toggles via app only";
        return;
    }
    m_helperProcess = new QProcess(this);
    m_helperProcess->setProgram(path);
    connect(m_helperProcess, &QProcess::finished, this, [](int code) {
        qInfo() << "[helper] taskbar-btn exited (" << code << ")";
    });
    m_helperProcess->start();
    qInfo() << "[helper] spawned" << path;
}

QString HelperServer::findHelperExecutable()
{
    const QString appDir = QCoreApplication::applicationDirPath();
    const QStringList candidates = {
        appDir + QStringLiteral("/helpers/taskbar-btn.exe"),
        // Dev layout: build/<config>/qt-panel.exe → ../../../bin = native/bin
        QDir::cleanPath(appDir + QStringLiteral("/../../../bin/taskbar-btn.exe")),
    };
    for (const QString& candidate : candidates) {
        if (QFileInfo::exists(candidate))
            return candidate;
    }
    return {};
}

void HelperServer::onNewConnection()
{
    while (QTcpSocket* socket = m_server.nextPendingConnection()) {
        if (m_socket)
            m_socket->deleteLater();
        m_socket = socket;
        m_buffer.clear();
        connect(socket, &QTcpSocket::readyRead, this, &HelperServer::onReadyRead);
        connect(socket, &QTcpSocket::disconnected, this, [this, socket] {
            if (m_socket == socket)
                m_socket = nullptr;
            socket->deleteLater();
        });
        qInfo() << "[helper] taskbar-btn connected";
        emit clientConnected();
    }
}

void HelperServer::onReadyRead()
{
    if (!m_socket)
        return;
    m_buffer.append(m_socket->readAll());
    int newline = -1;
    while ((newline = m_buffer.indexOf('\n')) >= 0) {
        const QByteArray line = m_buffer.left(newline).trimmed();
        m_buffer.remove(0, newline + 1);
        if (line.isEmpty())
            continue;
        const QJsonDocument doc = QJsonDocument::fromJson(line);
        if (!doc.isObject())
            continue;
        const QString type = doc.object().value(QLatin1String("type")).toString();
        if (type == QLatin1String("ready")) {
            qInfo() << "[helper] ready";
            emit helperReady();
        } else if (type == QLatin1String("toggle")) {
            emit toggleRequested();
        } else if (type == QLatin1String("clickoutside")) {
            emit clickOutside();
        }
    }
}

void HelperServer::sendJson(const QJsonObject& message)
{
    if (!m_socket || m_socket->state() != QAbstractSocket::ConnectedState)
        return;
    m_socket->write(QJsonDocument(message).toJson(QJsonDocument::Compact) + '\n');
}

void HelperServer::sendState(bool visible)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("state")},
              {QStringLiteral("visible"), visible}});
}

void HelperServer::sendBadge(int count)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("badge")},
              {QStringLiteral("count"), count}});
}

void HelperServer::sendHwnds(qulonglong panelHwnd)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("hwnd")},
              {QStringLiteral("panel"), static_cast<double>(panelHwnd)},
              {QStringLiteral("brave"), 0}});
}

} // namespace qtpanel
