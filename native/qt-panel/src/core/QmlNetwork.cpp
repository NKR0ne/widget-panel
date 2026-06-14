#include "QmlNetwork.h"

#include <QNetworkRequest>

namespace qtpanel {

QNetworkReply* UaNetworkAccessManager::createRequest(Operation op,
                                                     const QNetworkRequest& request,
                                                     QIODevice* outgoingData)
{
    QNetworkRequest patched(request);
    patched.setHeader(QNetworkRequest::UserAgentHeader,
                      QStringLiteral("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                     "AppleWebKit/537.36"));
    patched.setRawHeader("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
    return QNetworkAccessManager::createRequest(op, patched, outgoingData);
}

QNetworkAccessManager* QmlNetworkFactory::create(QObject* parent)
{
    auto* manager = new UaNetworkAccessManager(parent);
    manager->setTransferTimeout(15000);
    return manager;
}

} // namespace qtpanel
