#pragma once

#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>

class QProcess;

namespace qtpanel {

// Server side of the taskbar-btn helper protocol: newline-delimited JSON on
// TCP 127.0.0.1:47321. The helper (AppBar pill button injected into Explorer)
// connects to us, exactly as it did to the Electron main process.
//
//   app → helper   {"type":"badge","count":N}
//                  {"type":"state","visible":true|false}
//                  {"type":"hwnd","panel":N,"brave":0}
//   helper → app   {"type":"ready"} {"type":"toggle"} {"type":"clickoutside"}
class HelperServer : public QObject {
    Q_OBJECT

public:
    explicit HelperServer(QObject* parent = nullptr);

    // Binds the port (retrying while the Electron app still owns it) and,
    // when spawnHelperProcess is set, launches taskbar-btn.exe if found.
    void start(bool spawnHelperProcess);
    bool hasClient() const { return m_socket != nullptr; }

public slots:
    void sendState(bool visible);
    void sendBadge(int count);
    void sendHwnds(qulonglong panelHwnd);

signals:
    void helperReady();
    void toggleRequested();
    void clickOutside();
    void clientConnected();

private:
    void tryListen();
    void spawnHelper();
    void onNewConnection();
    void onReadyRead();
    void sendJson(const QJsonObject& message);
    static QString findHelperExecutable();

    QTcpServer m_server;
    QPointer<QTcpSocket> m_socket;
    QByteArray m_buffer;
    QProcess* m_helperProcess = nullptr;
    QTimer m_retryTimer;
    bool m_spawnRequested = false;
};

} // namespace qtpanel
