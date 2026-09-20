#pragma once
#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QJsonObject>
namespace qtpanel {
class StocksModel;
class HttpClient;
class SecretVault;
class MarketInsights : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList movers READ movers NOTIFY updated)
    Q_PROPERTY(QString status READ status NOTIFY updated)
    Q_PROPERTY(QVariantList headlines READ headlines NOTIFY newsChanged)
    Q_PROPERTY(QString newsStatus READ newsStatus NOTIFY newsChanged)
public:
    MarketInsights(StocksModel*, HttpClient*, SecretVault*, QObject* parent = nullptr);
    QVariantList movers() const { return m_movers; }
    QString status() const { return m_status; }
    QVariantList headlines() const { return m_headlines; }
    QString newsStatus() const { return m_newsStatus; }
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void loadNews(const QString& symbol);
    static QVariantMap parseChart(const QJsonObject&, const QVariantMap&, qint64 now);
    static QVariantList rank(const QVariantList&, qint64 now);
signals:
    void updated();
    void refreshed();
    void newsChanged();
private:
    void next(int generation);
    StocksModel* m_stocks;
    HttpClient* m_http;
    SecretVault* m_vault;
    QTimer m_poll;
    QVariantList m_queue, m_pending, m_movers, m_headlines;
    QString m_status, m_newsStatus;
    QHash<QString, QVariantList> m_newsCache;
    QHash<QString, qint64> m_newsFetched;
    bool m_busy = false;
    int m_generation = 0, m_newsGeneration = 0, m_failures = 0, m_consecutiveErrors = 0, m_total = 0;
    qint64 m_lastNewsRequest = 0;
};
}
