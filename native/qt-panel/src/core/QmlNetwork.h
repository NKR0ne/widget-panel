#pragma once

#include <QNetworkAccessManager>
#include <QQmlNetworkAccessManagerFactory>

namespace qtpanel {

// QML Image & co. load over the network with Qt's default User-Agent, which
// many news CDNs reject. This factory gives the QML engine managers that
// send the same browser-like UA as HttpClient.
class UaNetworkAccessManager : public QNetworkAccessManager {
    Q_OBJECT

public:
    using QNetworkAccessManager::QNetworkAccessManager;

protected:
    QNetworkReply* createRequest(Operation op, const QNetworkRequest& request,
                                 QIODevice* outgoingData) override;
};

class QmlNetworkFactory : public QQmlNetworkAccessManagerFactory {
public:
    QNetworkAccessManager* create(QObject* parent) override;
};

} // namespace qtpanel
