#pragma once

#include <QDateTime>
#include <QJsonArray>
#include <QObject>
#include <QStringList>
#include <QTimer>

namespace qtpanel {

class HttpClient;
class SecretVault;
class SettingsStore;

// Keeps Starvis on the provider's top reasoning model without manual config:
// polls the Anthropic model list daily, ranks it, persists the winner, and
// notifies when it changes. A non-empty `modelPin` in wp-starvis-provider
// always wins over the resolved model.
class ModelResolver : public QObject {
    Q_OBJECT

public:
    ModelResolver(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                  QObject* parent = nullptr);

    // pin > freshly resolved > last persisted > hardcoded fallback.
    QString currentModel() const;
    bool pinned() const;
    QDateTime resolvedAt() const;

    Q_INVOKABLE void refreshNow();

    // Pure ranking, unit-testable: models is the Anthropic /v1/models `data`
    // array ({id, created_at, ...}); tierPatterns is an ordered list of
    // regexes, first tier with a match wins, newest created_at inside it.
    // Date-suffixed snapshot ids lose to their alias when both are present.
    static QString rankModels(const QJsonArray& models, const QStringList& tierPatterns);

    static QStringList defaultTierPatterns();

    // $/MTok (input, output) estimate for the status readout; family-based.
    static void costPerMTok(const QString& model, double& inputUsd, double& outputUsd);

signals:
    void modelChanged();

private:
    void fetchPage(const QString& afterId, QJsonArray accumulated);
    QVariantMap providerConfig() const;
    QString apiKey() const;
    QString baseUrl() const;
    void persistResolved(const QString& model);

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    HttpClient* m_http = nullptr;
    QTimer m_refreshTimer;
    bool m_fetching = false;
};

} // namespace qtpanel
