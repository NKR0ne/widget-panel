#include "ModelResolver.h"

#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrlQuery>

namespace qtpanel {

namespace {

const char kFallbackModel[] = "claude-opus-5";
const char kDefaultBaseUrl[] = "https://api.anthropic.com";
const char kAnthropicVersion[] = "2023-06-01";
constexpr int kRefreshIntervalMs = 24 * 60 * 60 * 1000;

} // namespace

ModelResolver::ModelResolver(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                             QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_http(http)
{
    m_refreshTimer.setInterval(kRefreshIntervalMs);
    connect(&m_refreshTimer, &QTimer::timeout, this, &ModelResolver::refreshNow);
    m_refreshTimer.start();

    connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
        if (key == QLatin1String("starvis-anthropic-key"))
            refreshNow();
    });
    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key == QLatin1String("wp-starvis-provider"))
            emit modelChanged(); // pin may have changed
    });

    if (!apiKey().isEmpty())
        refreshNow();
}

QVariantMap ModelResolver::providerConfig() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-provider"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {};
}

QString ModelResolver::apiKey() const
{
    return m_vault->get(QStringLiteral("starvis-anthropic-key")).trimmed();
}

QString ModelResolver::baseUrl() const
{
    QString url = providerConfig().value(QStringLiteral("anthropicBaseUrl")).toString().trimmed();
    if (url.isEmpty())
        url = QLatin1String(kDefaultBaseUrl);
    while (url.endsWith(QLatin1Char('/')))
        url.chop(1);
    return url;
}

bool ModelResolver::pinned() const
{
    return !providerConfig().value(QStringLiteral("modelPin")).toString().trimmed().isEmpty();
}

QString ModelResolver::currentModel() const
{
    const QVariantMap cfg = providerConfig();
    const QString pin = cfg.value(QStringLiteral("modelPin")).toString().trimmed();
    if (!pin.isEmpty())
        return pin;
    const QString resolved = cfg.value(QStringLiteral("resolvedModel")).toString().trimmed();
    return resolved.isEmpty() ? QLatin1String(kFallbackModel) : resolved;
}

QDateTime ModelResolver::resolvedAt() const
{
    return QDateTime::fromString(
        providerConfig().value(QStringLiteral("resolvedAt")).toString(), Qt::ISODate);
}

QStringList ModelResolver::defaultTierPatterns()
{
    return {QStringLiteral("^claude-fable-\\d"),
            QStringLiteral("^claude-opus-\\d"),
            QStringLiteral("^claude-sonnet-\\d")};
}

void ModelResolver::costPerMTok(const QString& model, double& inputUsd, double& outputUsd)
{
    // Estimates for the status readout only; not billing data.
    if (model.startsWith(QLatin1String("gpt-5.6-sol")))  { inputUsd = 4;   outputUsd = 20; return; }
    if (model.startsWith(QLatin1String("gpt-5.6-terra"))){ inputUsd = 2;   outputUsd = 12; return; }
    if (model.startsWith(QLatin1String("gpt-5.6-luna"))) { inputUsd = .2;  outputUsd = 1.2; return; }
    if (model.startsWith(QLatin1String("claude-fable"))) { inputUsd = 10;  outputUsd = 50; return; }
    if (model.startsWith(QLatin1String("claude-opus")))  { inputUsd = 5;   outputUsd = 25; return; }
    if (model.startsWith(QLatin1String("claude-sonnet"))){ inputUsd = 3;   outputUsd = 15; return; }
    if (model.startsWith(QLatin1String("claude-haiku"))) { inputUsd = 1;   outputUsd = 5;  return; }
    inputUsd = 5; outputUsd = 25;
}

QString ModelResolver::rankModels(const QJsonArray& models, const QStringList& tierPatterns)
{
    static const QRegularExpression dateSuffix(QStringLiteral("-\\d{8}$"));

    QStringList ids;
    QHash<QString, QString> createdAt;
    for (const QJsonValue& v : models) {
        const QJsonObject m = v.toObject();
        const QString id = m.value(QLatin1String("id")).toString();
        if (id.isEmpty())
            continue;
        ids << id;
        createdAt.insert(id, m.value(QLatin1String("created_at")).toString());
    }

    for (const QString& pattern : tierPatterns) {
        const QRegularExpression re(pattern);
        if (!re.isValid())
            continue;
        QString best;
        for (const QString& id : ids) {
            if (!re.match(id).hasMatch())
                continue;
            // A dated snapshot loses to its alias when the alias is listed too:
            // the alias tracks the current revision, which is the whole point.
            const QRegularExpressionMatch dated = dateSuffix.match(id);
            if (dated.hasMatch() && ids.contains(id.left(dated.capturedStart())))
                continue;
            if (best.isEmpty() || createdAt.value(id) > createdAt.value(best))
                best = id;
        }
        if (!best.isEmpty())
            return best;
    }
    return {};
}

void ModelResolver::refreshNow()
{
    if (m_fetching || apiKey().isEmpty())
        return;
    m_fetching = true;
    fetchPage(QString(), {});
}

void ModelResolver::fetchPage(const QString& afterId, QJsonArray accumulated)
{
    QUrl url(baseUrl() + QStringLiteral("/v1/models"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("limit"), QStringLiteral("100"));
    if (!afterId.isEmpty())
        query.addQueryItem(QStringLiteral("after_id"), afterId);
    url.setQuery(query);

    m_http->requestJsonAuth(
        "GET", url, QString(), {}, this,
        [this, accumulated](const QJsonDocument& doc, int status, const QString& error) mutable {
        const QJsonObject payload = doc.object();
        if (status < 200 || status >= 300) {
            m_fetching = false;
            qWarning() << "[starvis.anthropic] model list failed:" << status << error;
            return;
        }
        const QJsonArray page = payload.value(QLatin1String("data")).toArray();
        for (const QJsonValue& v : page)
            accumulated.append(v);
        if (payload.value(QLatin1String("has_more")).toBool() && !page.isEmpty()) {
            fetchPage(page.last().toObject().value(QLatin1String("id")).toString(),
                      accumulated);
            return;
        }
        m_fetching = false;

        QStringList patterns;
        for (const QVariant& p :
             providerConfig().value(QStringLiteral("rankPatterns")).toList())
            patterns << p.toString();
        if (patterns.isEmpty())
            patterns = defaultTierPatterns();

        const QString top = rankModels(accumulated, patterns);
        if (top.isEmpty()) {
            qWarning() << "[starvis.anthropic] model list returned nothing rankable,"
                       << accumulated.size() << "models";
            return;
        }
        persistResolved(top);
    },
        {{QByteArrayLiteral("x-api-key"), apiKey().toUtf8()},
         {QByteArrayLiteral("anthropic-version"), QByteArray(kAnthropicVersion)}});
}

void ModelResolver::persistResolved(const QString& model)
{
    QVariantMap cfg = providerConfig();
    const QString previous = cfg.value(QStringLiteral("resolvedModel")).toString();
    cfg.insert(QStringLiteral("resolvedModel"), model);
    cfg.insert(QStringLiteral("resolvedAt"),
               QDateTime::currentDateTime().toString(Qt::ISODate));
    m_settings->set(QStringLiteral("wp-starvis-provider"),
                    QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(cfg))
                                          .toJson(QJsonDocument::Compact)));
    qInfo() << "[starvis.anthropic] model resolved:" << model
            << (pinned() ? "(pinned override active)" : "");
    if (previous != model)
        emit modelChanged();
}

} // namespace qtpanel
