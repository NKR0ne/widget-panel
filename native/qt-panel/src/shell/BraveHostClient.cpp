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
    connect(m_helperProcess, &QProcess::finished, this,
            [this](int code, QProcess::ExitStatus status) {
        qInfo() << "[brave] brave-host exited code=" << code
                << "status=" << (status == QProcess::CrashExit ? "crash" : "normal");
        m_stateRequestPending = false;
        m_pendingEval = {};
        m_helperProcess->deleteLater();
        m_helperProcess = nullptr;
        emit errorReceived(QStringLiteral("Browser island host stopped unexpectedly"));
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
            if (m_socket == socket) {
                m_socket = nullptr;
                m_stateRequestPending = false;
            }
            socket->deleteLater();
        });
        qInfo() << "[brave] brave-host connected";
        if (!m_pendingOpen.isEmpty()) {
            sendJson(m_pendingOpen);
            m_pendingOpen = {};
        }
        if (!m_pendingEval.isEmpty()) {
            sendJson(m_pendingEval);
            m_pendingEval = {};
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
            m_stateRequestPending = false;
            emit stateReceived(msg.value(QLatin1String("payload")).toObject());
        } else if (type == QLatin1String("eval")) {
            const QString id = msg.value(QLatin1String("id")).toString();
            const QString error = msg.value(QLatin1String("error")).toString();
            QVariant result;
            if (msg.value(QLatin1String("ok")).toBool()) {
                const QJsonObject payload = msg.value(QLatin1String("payload")).toObject();
                const QJsonObject runtimeResult = payload.value(QLatin1String("result")).toObject()
                                                      .value(QLatin1String("result")).toObject();
                result = runtimeResult.value(QLatin1String("value")).toVariant();
            }
            emit evaluationReceived(id, result, error);
        } else if (type == QLatin1String("error")) {
            m_stateRequestPending = false;
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
    m_lastOpen = message;
    if (connected()) {
        sendJson(message);
    } else {
        m_pendingOpen = message;
        m_pendingEval = {};
        spawnHelper();
    }
}

void BraveHostClient::navigate(const QString& url)
{
    if (!m_lastOpen.isEmpty())
        m_lastOpen.insert(QStringLiteral("url"), url);
    if (connected()) {
        sendJson({{QStringLiteral("type"), QStringLiteral("navigate")},
                  {QStringLiteral("url"), url}});
    } else if (!m_lastOpen.isEmpty()) {
        m_pendingOpen = m_lastOpen;
        spawnHelper();
    }
}

void BraveHostClient::reload()
{
    if (connected()) {
        sendJson({{QStringLiteral("type"), QStringLiteral("reload")}});
    } else if (!m_lastOpen.isEmpty()) {
        m_pendingOpen = m_lastOpen;
        spawnHelper();
    }
}

void BraveHostClient::goBack()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("back")}});
}

void BraveHostClient::goForward()
{
    sendJson({{QStringLiteral("type"), QStringLiteral("forward")}});
}

QString BraveHostClient::evaluate(const QString& script)
{
    const QString id = QStringLiteral("eval-%1").arg(++m_nextEvaluationId);
    const QJsonObject message{
        {QStringLiteral("type"), QStringLiteral("eval")},
        {QStringLiteral("id"), id},
        {QStringLiteral("script"), script},
    };
    if (!m_socket || m_socket->state() != QAbstractSocket::ConnectedState) {
        m_pendingEval = message;
        return id;
    }
    sendJson(message);
    return id;
}

void BraveHostClient::requestState()
{
    if (!connected())
        return;
    if (m_stateRequestPending && m_stateRequestAge.isValid()
        && m_stateRequestAge.elapsed() < 8000)
        return;
    m_stateRequestPending = true;
    m_stateRequestAge.restart();
    sendJson({{QStringLiteral("type"), QStringLiteral("state")}});
}

void BraveHostClient::closeShell()
{
    m_pendingOpen = {};
    m_pendingEval = {};
    m_lastOpen = {};
    m_stateRequestPending = false;
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
