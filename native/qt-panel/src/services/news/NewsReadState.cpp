#include "NewsReadState.h"
#include "core/SettingsStore.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QUrl>
#include <QUrlQuery>

namespace qtpanel {
NewsReadState::NewsReadState(SettingsStore* settings, QObject* parent)
    : QObject(parent), m_settings(settings)
{
    const auto saved = QJsonDocument::fromJson(settings->get("wp-news-read-state").toString().toUtf8()).object();
    m_items = saved.value("items").toObject().toVariantMap();
    for (const auto& category : saved.value("categories").toVariant().toStringList())
        m_categories.insert(category);
}
QString NewsReadState::keyFor(const QVariantMap& item)
{
    const QString link = item.value("link", item.value("url")).toString().trimmed();
    QUrl url(link);
    if (!link.isEmpty() && (url.scheme() == "https" || url.scheme() == "http") && !url.host().isEmpty()) {
        url.setFragment({});
        QUrlQuery query(url);
        for (const auto& pair : query.queryItems()) {
            const auto key = pair.first.toLower();
            if (key.startsWith("utm_") || key == "fbclid" || key == "gclid")
                query.removeAllQueryItems(pair.first);
        }
        url.setQuery(query);
        return url.adjusted(QUrl::NormalizePathSegments).toString(QUrl::FullyEncoded);
    }
    const auto id = item.value("id").toString();
    return id.startsWith("mock-") ? QString() : id;
}
bool NewsReadState::isUnread(const QVariantMap& item) const
{
    const auto key = keyFor(item);
    return !key.isEmpty() && m_items.contains(key) && !m_items.value(key).toBool();
}
void NewsReadState::save()
{
    QVariantMap data{{"items", m_items}, {"categories", QStringList(m_categories.begin(), m_categories.end())}};
    m_settings->set("wp-news-read-state", QString::fromUtf8(QJsonDocument::fromVariant(data).toJson(QJsonDocument::Compact)));
    ++m_revision;
    emit changed();
}
void NewsReadState::observe(const QString& category, const QVariantList& items)
{
    bool dirty = false;
    const bool baseline = !m_categories.contains(category);
    bool valid = false;
    for (const auto& value : items) {
        const auto item = value.toMap();
        if (item.value("link").toString().isEmpty()) continue;
        const auto key = keyFor(item);
        if (key.isEmpty()) continue;
        valid = true;
        if (!m_items.contains(key)) {
            m_items.insert(key, baseline);
            dirty = true;
        }
    }
    if (valid && baseline) { m_categories.insert(category); dirty = true; }
    if (dirty) save();
}
void NewsReadState::setRead(const QVariantMap& item, bool read)
{
    const auto key = keyFor(item);
    if (key.isEmpty() || (m_items.contains(key) && m_items.value(key).toBool() == read)) return;
    m_items.insert(key, read);
    save();
}
int NewsReadState::unreadCount(const QVariantList& items) const
{
    QSet<QString> keys;
    for (const auto& item : items) if (isUnread(item.toMap())) keys.insert(keyFor(item.toMap()));
    return keys.size();
}
void NewsReadState::markAllRead(const QVariantList& items)
{
    bool dirty = false;
    for (const auto& item : items) {
        const auto key = keyFor(item.toMap());
        if (!key.isEmpty() && isUnread(item.toMap())) { m_items[key] = true; dirty = true; }
    }
    if (dirty) save();
}
void NewsReadState::readerCompleted(const QVariantMap& article, bool busy)
{
    if (busy || article.value("seedFallback").toBool()
        || article.value("sourceLabel").toString() == "feed summary"
        || !article.value("error").toString().isEmpty()
        || !article.value("challenge").toString().isEmpty()
        || article.value("paywall").toBool()
        || article.value("paragraphs").toList().isEmpty()) return;
    if (m_items.contains(keyFor(article))) setRead(article);
}
}
