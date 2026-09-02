#pragma once

#include <QString>
#include <QUrl>
#include <QVariantMap>

namespace qtpanel::ReasoningEndpoint {

inline QString normalized(QString value)
{
    value = value.trimmed();
    while (value.endsWith(QLatin1Char('/')))
        value.chop(1);
    return value;
}

inline bool isLoopback(const QString& value)
{
    const QString host = QUrl(value).host().toLower();
    return host == QLatin1String("127.0.0.1")
        || host == QLatin1String("localhost")
        || host == QLatin1String("::1");
}

inline bool isKnownCloud(const QString& value)
{
    const QString host = QUrl(value).host().toLower();
    return host == QLatin1String("api.openai.com")
        || host.endsWith(QLatin1String(".openai.azure.com"))
        || host == QLatin1String("api.anthropic.com");
}

inline QString localBaseUrl(const QVariantMap& config)
{
    QString value = normalized(config.value(QStringLiteral("localBaseUrl")).toString());
    if (value.isEmpty() || isKnownCloud(value))
        value = normalized(config.value(QStringLiteral("baseUrl")).toString());
    if (value.isEmpty() || isKnownCloud(value))
        value = QStringLiteral("http://127.0.0.1:1234/v1");
    return value;
}

inline QString openAiBaseUrl(const QVariantMap& config)
{
    QString value = normalized(config.value(QStringLiteral("openaiBaseUrl")).toString());
    if (value.isEmpty() || isLoopback(value))
        value = normalized(config.value(QStringLiteral("baseUrl")).toString());
    if (value.isEmpty() || isLoopback(value))
        value = QStringLiteral("https://api.openai.com/v1");
    return value;
}

inline QVariantMap repairedConfig(QVariantMap config)
{
    const QString provider = config.value(QStringLiteral("provider"))
                                 .toString().trimmed().toLower();
    const QString generic = normalized(config.value(QStringLiteral("baseUrl")).toString());
    if (provider == QLatin1String("local")) {
        if (isKnownCloud(generic)
            && normalized(config.value(QStringLiteral("openaiBaseUrl")).toString()).isEmpty()) {
            config.insert(QStringLiteral("openaiBaseUrl"), generic);
        }
        const QString local = localBaseUrl(config);
        config.insert(QStringLiteral("localBaseUrl"), local);
        config.insert(QStringLiteral("baseUrl"), local);
    } else if (provider == QLatin1String("openai")) {
        if (isLoopback(generic)
            && normalized(config.value(QStringLiteral("localBaseUrl")).toString()).isEmpty()) {
            config.insert(QStringLiteral("localBaseUrl"), generic);
        }
        const QString cloud = openAiBaseUrl(config);
        config.insert(QStringLiteral("openaiBaseUrl"), cloud);
        config.insert(QStringLiteral("baseUrl"), cloud);
    }
    return config;
}

} // namespace qtpanel::ReasoningEndpoint
