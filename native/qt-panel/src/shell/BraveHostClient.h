#pragma once

#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QTcpServer>
#include <QTcpSocket>

class QProcess;

namespace qtpanel {

// Client for the existing brave-host.exe helper (launches Brave, reparents it
// into a plain Win32 shell window, navigates via CDP). Same protocol as the
// Electron app: we listen on TCP 127.0.0.1:47322, brave-host connects in,
// newline-delimited JSON both ways. Coordinates in `open` are physical pixels.
class BraveHostClient : public QObject {
    Q_OBJECT

public:
    explicit BraveHostClient(QObject* parent = nullptr);

    void start();
    bool connected() const { return m_socket != nullptr; }

    void open(const QString& url, int physX, int physY, int physW, int physH);
    void navigate(const QString& url);
    void setGeometry(int physX, int physY, int physW, int physH);
    void reload();
    void back();
    void forward();
    void closeShell();
    void roundCorners(qulonglong hwnd);

signals:
    void readyReceived();

private:
    void spawnHelper();
    void onNewConnection();
    void onReadyRead();
    void sendJson(const QJsonObject& message);
    static QString findHelperExecutable();

    QTcpServer m_server;
    QPointer<QTcpSocket> m_socket;
    QByteArray m_buffer;
    QProcess* m_helperProcess = nullptr;
    QJsonObject m_pendingOpen; // queued until brave-host connects
};

} // namespace qtpanel
