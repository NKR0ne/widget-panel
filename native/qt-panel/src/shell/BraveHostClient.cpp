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
        const QString error = QStringLiteral("Port %1 busy: %2")
                                  .arg(kBravePort)
                                  .arg(m_server.errorString());
        qWarning() << "[brave]" << error;
        emit errorReceived(error);
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
        emit errorReceived(QStringLiteral("brave-host.exe not found"));
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
        if (!m_pendingEval.isEmpty()) {
            sendJson({{QStringLiteral("type"), QStringLiteral("eval")},
                      {QStringLiteral("script"), m_pendingEval}});
            m_pendingEval.clear();
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
        } else if (type == QLatin1String("cookies")) {
            emit cookiesReceived(msg.value(QLatin1String("payload")).toObject());
        } else if (type == QLatin1String("state")) {
            emit stateReceived(msg.value(QLatin1String("payload")).toObject());
        } else if (type == QLatin1String("error")) {
            const QString error = msg.value(QLatin1String("msg")).toString();
            qWarning() << "[brave] error:" << error;
            emit errorReceived(error);
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
        m_pendingEval.clear();
        spawnHelper();
    }
}

void BraveHostClient::navigate(const QString& url)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("navigate")},
              {QStringLiteral("url"), url}});
}

void BraveHostClient::reload()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("reload")}});
}

void BraveHostClient::goBack()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("back")}});
}

void BraveHostClient::goForward()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("forward")}});
}

void BraveHostClient::evaluate(const QString& script)
{
    if (!m_socket || m_socket->state() != QAbstractSocket::ConnectedState) {
        m_pendingEval = script;
        return;
    }
    sendJson({{QStringLiteral("type"), QStringLiteral("eval")},
              {QStringLiteral("script"), script}});
}

void BraveHostClient::requestState()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("state")}});
}

void BraveHostClient::closeShell()
{
    m_pendingOpen = {};
    m_pendingEval.clear();
    sendJson({{QStringLiteral("type"), QStringLiteral("close")}});
}

void BraveHostClient::roundCorners(qulonglong hwnd)
{
    sendJson({{QStringLiteral("type"), QStringLiteral("round-corners")},
              {QStringLiteral("hwnd"), static_cast<double>(hwnd)}});
}

void BraveHostClient::requestCookies()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("cookies")}});
}

} // namespace qtpanel
