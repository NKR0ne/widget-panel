#include "BraveHostClient.h"

#include <QCoreApplication>
#include <QDebug>
#include <QDir>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonDocument>
#include <QProcess>

namespace qtpanel {

namespace {
constexpr quint16 kBravePort = 47322;
} // namespace

BraveHostClient::BraveHostClient(QObject* parent)
    : QObject(parent)
{
    connect(&m_server, &QTcpServer::newConnection, this, &BraveHostClient::onNewConnection);
}

void BraveHostClient::start()
{
    if (m_server.isListening())
        return;
    if (!m_server.listen(QHostAddress::LocalHost, kBravePort)) {
        qWarning() << "[brave] port" << kBravePort << "busy:" << m_server.errorString();
        return;
    }
    qInfo() << "[brave] listening on 127.0.0.1:" << kBravePort;
}

QString BraveHostClient::findHelperExecutable()
{
    const QString appDir = QCoreApplication::applicationDirPath();
    const QStringList candidates = {
        appDir + QStringLiteral("/helpers/brave-host.exe"),
        QDir::cleanPath(appDir + QStringLiteral("/../../../bin/brave-host.exe")),
    };
    for (const QString& candidate : candidates) {
        if (QFileInfo::exists(candidate))
            return candidate;
    }
    return {};
}

void BraveHostClient::spawnHelper()
{
    if (m_helperProcess)
        return;
    const QString path = findHelperExecutable();
    if (path.isEmpty()) {
        qWarning() << "[brave] brave-host.exe not found — web islands unavailable";
        return;
    }
    m_helperProcess = new QProcess(this);
    m_helperProcess->setProgram(path);
    connect(m_helperProcess, &QProcess::finished, this, [this](int code) {
        qInfo() << "[brave] brave-host exited (" << code << ")";
        m_helperProcess->deleteLater();
        m_helperProcess = nullptr;
    });
    m_helperProcess->start();
    qInfo() << "[brave] spawned" << path;
}

void BraveHostClient::onNewConnection()
{
    while (QTcpSocket* socket = m_server.nextPendingConnection()) {
        if (m_socket)
            m_socket->deleteLater();
        m_socket = socket;
        m_buffer.clear();
        connect(socket, &QTcpSocket::readyRead, this, &BraveHostClient::onReadyRead);
        connect(socket, &QTcpSocket::disconnected, this, [this, socket] {
            if (m_socket == socket)
                m_socket = nullptr;
            socket->deleteLater();
        });
        qInfo() << "[brave] brave-host connected";
        if (!m_pendingOpen.isEmpty()) {
            sendJson(m_pendingOpen);
            m_pendingOpen = {};
        }
    }
}

void BraveHostClient::onReadyRead()
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
        const QJsonObject msg = QJsonDocument::fromJson(line).object();
        const QString type = msg.value(QLatin1String("type")).toString();
        if (type == QLatin1String("ready")) {
            qInfo() << "[brave] ready";
            emit readyReceived();
        } else if (type == QLatin1String("error")) {
            qWarning() << "[brave] error:" << msg.value(QLatin1String("msg")).toString();
        }
    }
}

void BraveHostClient::sendJson(const QJsonObject& message)
{
    if (!m_socket || m_socket->state() != QAbstractSocket::ConnectedState)
        return;
    m_socket->write(QJsonDocument(message).toJson(QJsonDocument::Compact) + '\n');
}

void BraveHostClient::open(const QString& url, int physX, int physY, int physW, int physH)
{
    start();
    const QJsonObject message{
        {QStringLiteral("type"), QStringLiteral("open")},
        {QStringLiteral("hwnd"), 0},
        {QStringLiteral("url"), url},
        {QStringLiteral("x"), physX},
        {QStringLiteral("y"), physY},
        {QStringLiteral("w"), physW},
        {QStringLiteral("h"), physH},
    };
    if (connected()) {
        sendJson(message);
    } else {
        m_pendingOpen = message;
        spawnHelper();
    }
}

void BraveHostClient::navigate(const QString& url)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("navigate")},
              {QStringLiteral("url"), url}});
}

void BraveHostClient::setGeometry(int physX, int physY, int physW, int physH)
{
    if (!m_pendingOpen.isEmpty()) {
        m_pendingOpen.insert(QStringLiteral("x"), physX);
        m_pendingOpen.insert(QStringLiteral("y"), physY);
        m_pendingOpen.insert(QStringLiteral("w"), physW);
        m_pendingOpen.insert(QStringLiteral("h"), physH);
        return;
    }
    sendJson({{QStringLiteral("type"), QStringLiteral("geometry")},
              {QStringLiteral("x"), physX},
              {QStringLiteral("y"), physY},
              {QStringLiteral("w"), physW},
              {QStringLiteral("h"), physH}});
}

void BraveHostClient::reload()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("reload")}});
}

void BraveHostClient::back()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("back")}});
}

void BraveHostClient::forward()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("forward")}});
}

void BraveHostClient::closeShell()
{
    m_pendingOpen = {};
    sendJson({{QStringLiteral("type"), QStringLiteral("close")}});
}

void BraveHostClient::roundCorners(qulonglong hwnd)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("round-corners")},
              {QStringLiteral("hwnd"), static_cast<double>(hwnd)}});
}

} // namespace qtpanel
