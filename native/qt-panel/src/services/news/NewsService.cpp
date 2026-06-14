#include "NewsService.h"

#include "core/HttpClient.h"
#include "core/SettingsStore.h"
#include "core/TextFix.h"

#include <QDateTime>
#include <QDebug>
#include <QDomDocument>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QSet>
#include <QUrl>

#include <utility>

namespace qtpanel {

namespace {

constexpr int kMaxItems = 7;
constexpr qint64 kMaxAgeMs = 30LL * 86400000LL;
constexpr int kPollMinutes = 10;
const char kRssAccept[] = "application/rss+xml, application/xml, text/xml, */*";

QString relTime(qint64 pubMs)
{
    if (pubMs <= 0)
        return {};
    const qint64 seconds = (QDateTime::currentMSecsSinceEpoch() - pubMs) / 1000;
    if (seconds < 60) return QStringLiteral("%1s").arg(qMax<qint64>(0, seconds));
    if (seconds < 3600) return QStringLiteral("%1m").arg(seconds / 60);
    if (seconds < 86400) return QStringLiteral("%1h").arg(seconds / 3600);
    return QStringLiteral("%1d").arg(seconds / 86400);
}

QString hostname(const QString& url)
{
    const QString host = QUrl(url).host();
    return host.startsWith(QLatin1String("www.")) ? host.mid(4) : host;
}

qint64 parseDateMs(const QString& raw)
{
    if (raw.isEmpty())
        return 0;
    QDateTime dt = QDateTime::fromString(raw, Qt::RFC2822Date);
    if (!dt.isValid())
        dt = QDateTime::fromString(raw, Qt::ISODate);
    return dt.isValid() ? dt.toMSecsSinceEpoch() : 0;
}

QString childText(const QDomElement& item, const QString& tag)
{
    const QDomElement direct = item.firstChildElement(tag);
    if (!direct.isNull())
        return TextFix::repairMojibake(direct.text().trimmed());
    // Namespaced feeds sometimes only match by local name.
    for (QDomElement child = item.firstChildElement(); !child.isNull();
         child = child.nextSiblingElement()) {
        if (child.tagName().section(QLatin1Char(':'), -1) == tag)
            return TextFix::repairMojibake(child.text().trimmed());
    }
    return {};
}

QString normalizeItemUrl(const QString& value, const QString& baseUrl)
{
    const QString raw = value.trimmed();
    if (raw.isEmpty() || raw == QLatin1String("#"))
        return {};
    const QUrl base(baseUrl);
    const QUrl resolved = base.isValid() && !baseUrl.isEmpty()
        ? base.resolved(QUrl(raw)) : QUrl(raw);
    const QString scheme = resolved.scheme().toLower();
    return (scheme == QLatin1String("http") || scheme == QLatin1String("https"))
        ? resolved.toString() : QString();
}

QString stripHtml(const QString& html)
{
    static const QRegularExpression tags(QStringLiteral("<[^>]+>"));
    static const QRegularExpression spaces(QStringLiteral("\\s+"));
    QString text = TextFix::repairMojibake(html);
    text.replace(tags, QStringLiteral(" "));
    text.replace(spaces, QStringLiteral(" "));
    return text.trimmed();
}

bool looksLikeImageUrl(const QString& url)
{
    static const QRegularExpression imageExt(
        QStringLiteral("\\.(?:avif|webp|jpe?g|png|gif)(?:[?#]|$)"),
        QRegularExpression::CaseInsensitiveOption);
    return imageExt.match(url).hasMatch();
}

bool isJunkImage(const QString& url)
{
    static const QRegularExpression junk(
        QStringLiteral("logo|icon|avatar|sprite|tracking|pixel|spacer"),
        QRegularExpression::CaseInsensitiveOption);
    return junk.match(url).hasMatch();
}

QString extractHtmlImage(const QString& html)
{
    static const QRegularExpression imgTag(QStringLiteral("<img\\b[^>]*>"),
                                           QRegularExpression::CaseInsensitiveOption);
    const QString img = imgTag.match(html).captured(0);
    if (!img.isEmpty()) {
        auto attr = [&img](const char* name) {
            const QRegularExpression re(
                QStringLiteral("\\b%1=[\"']([^\"']+)[\"']").arg(QLatin1String(name)),
                QRegularExpression::CaseInsensitiveOption);
            return re.match(img).captured(1);
        };
        QString src = attr("src");
        if (src.isEmpty()) src = attr("data-src");
        if (src.isEmpty()) src = attr("data-original");
        if (src.isEmpty()) src = attr("data-lazy-src");
        if (!src.isEmpty() && !isJunkImage(src))
            return src;
    }
    static const QRegularExpression bareUrl(
        QStringLiteral("https?://[^\\s\"'<>]+?\\.(?:avif|webp|jpe?g|png|gif)(?:\\?[^\\s\"'<>]*)?"),
        QRegularExpression::CaseInsensitiveOption);
    const QString url = bareUrl.match(html).captured(0);
    return (!url.isEmpty() && !isJunkImage(url)) ? url : QString();
}

QString extractImage(const QDomElement& item)
{
    // <enclosure type="image/..." url=...> or image-looking enclosure URL.
    const QDomElement enclosure = item.firstChildElement(QStringLiteral("enclosure"));
    if (!enclosure.isNull()) {
        const QString url = enclosure.attribute(QStringLiteral("url"));
        if (!url.isEmpty()
            && (enclosure.attribute(QStringLiteral("type")).startsWith(QLatin1String("image"))
                || looksLikeImageUrl(url)))
            return url;
    }

    // media:thumbnail / media:content (and unprefixed variants), widest first.
    QString best;
    int bestWidth = -1;
    for (QDomElement child = item.firstChildElement(); !child.isNull();
         child = child.nextSiblingElement()) {
        const QString local = child.tagName().section(QLatin1Char(':'), -1);
        if (local != QLatin1String("thumbnail") && local != QLatin1String("content"))
            continue;
        const QString url = child.attribute(QStringLiteral("url"));
        if (url.isEmpty())
            continue;
        const QString medium = child.attribute(QStringLiteral("medium"));
        if (medium == QLatin1String("image") || local == QLatin1String("thumbnail")
            || looksLikeImageUrl(url)) {
            const int width = child.attribute(QStringLiteral("width")).toInt();
            if (width > bestWidth) {
                bestWidth = width;
                best = url;
            }
        }
    }
    if (!best.isEmpty())
        return best;

    const QDomElement itunes = item.firstChildElement(QStringLiteral("itunes:image"));
    if (!itunes.isNull() && !itunes.attribute(QStringLiteral("href")).isEmpty())
        return itunes.attribute(QStringLiteral("href"));

    const QDomElement imageUrl = item.firstChildElement(QStringLiteral("image"))
                                     .firstChildElement(QStringLiteral("url"));
    if (!imageUrl.isNull() && !imageUrl.text().trimmed().isEmpty())
        return imageUrl.text().trimmed();

    QString html = childText(item, QStringLiteral("description"));
    if (html.isEmpty()) html = childText(item, QStringLiteral("summary"));
    if (html.isEmpty()) html = childText(item, QStringLiteral("encoded"));
    return extractHtmlImage(html);
}

QString extractLink(const QDomElement& item, const QString& baseUrl)
{
    // Atom <link href> — prefer rel="alternate" (or no rel).
    QString atomFirst;
    QString atomAlternate;
    for (QDomElement child = item.firstChildElement(QStringLiteral("link")); !child.isNull();
         child = child.nextSiblingElement(QStringLiteral("link"))) {
        const QString href = child.attribute(QStringLiteral("href"));
        if (href.isEmpty())
            continue;
        if (atomFirst.isEmpty())
            atomFirst = href;
        const QString rel = child.attribute(QStringLiteral("rel")).toLower();
        if (rel.isEmpty() || rel == QLatin1String("alternate")) {
            atomAlternate = href;
            break;
        }
    }

    const QDomElement guid = item.firstChildElement(QStringLiteral("guid"));
    const QString guidValue =
        guid.attribute(QStringLiteral("isPermaLink")) != QLatin1String("false")
            ? guid.text().trimmed() : QString();

    const QStringList candidates = {
        atomAlternate.isEmpty() ? atomFirst : atomAlternate,
        item.firstChildElement(QStringLiteral("link")).text().trimmed(),
        guidValue,
        item.firstChildElement(QStringLiteral("id")).text().trimmed(),
    };
    for (const QString& candidate : candidates) {
        const QString url = normalizeItemUrl(candidate, baseUrl);
        if (!url.isEmpty())
            return url;
    }
    return {};
}

} // namespace

NewsService::NewsService(SettingsStore* settings, HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_http(http)
{
    loadCategories();
    m_pollTimer.setInterval(kPollMinutes * 60 * 1000);
    connect(&m_pollTimer, &QTimer::timeout, this, &NewsService::refresh);
    m_pollTimer.start();
    refresh();
}

void NewsService::loadCategories()
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-config"));
    QVariantMap config;
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            config = doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        config = raw.toMap();
    }

    const QVariantList active = config.value(QStringLiteral("activeIds")).toList();
    QStringList activeIds;
    for (const QVariant& id : active)
        activeIds.append(id.toString());

    m_categories.clear();
    m_categoryLabels.clear();
    m_allCategoryLabels.clear();
    const QVariantList categories = config.value(QStringLiteral("categories")).toList();
    for (const QVariant& entry : categories) {
        const QVariantMap map = entry.toMap();
        const QString label = TextFix::repairMojibake(map.value(QStringLiteral("label")).toString());
        if (label.isEmpty())
            continue;
        m_allCategoryLabels.append(label);
        if (!activeIds.isEmpty() && !activeIds.contains(QStringLiteral("cat:") + label))
            continue;
        Category category;
        category.label = label;
        for (const QVariant& feedVar : map.value(QStringLiteral("feeds")).toList()) {
            const QVariantMap feedMap = feedVar.toMap();
            const QString url = feedMap.value(QStringLiteral("url")).toString().trimmed();
            if (!url.isEmpty())
                category.feeds.append({url, feedMap.value(QStringLiteral("title")).toString()});
        }
        m_categories.append(category);
        m_categoryLabels.append(label);
    }
    emit categoriesChanged();
    qInfo() << "[news]" << m_categories.size() << "active categories";
}

void NewsService::reload()
{
    loadCategories();
    refresh();
}

int NewsService::importOpml(const QUrl& fileUrl)
{
    const QString path = fileUrl.isLocalFile() ? fileUrl.toLocalFile() : fileUrl.toString();
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        qWarning() << "[news] OPML open failed:" << path;
        return 0;
    }
    QDomDocument doc;
    if (!doc.setContent(file.readAll())) {
        qWarning() << "[news] OPML parse failed:" << path;
        return 0;
    }

    // Port of parseOPML (news.service.js): body > outline; a top outline with
    // nested xmlUrl outlines is a category, a top outline that *is* a feed goes
    // to "Uncategorized".
    QVariantList categories;
    QStringList activeCatIds;
    const QDomElement body = doc.documentElement().firstChildElement(QStringLiteral("body"));
    auto feedFromOutline = [](const QDomElement& o) {
        const QString url = o.attribute(QStringLiteral("xmlUrl")).trimmed();
        QString title = o.attribute(QStringLiteral("title"));
        if (title.isEmpty()) title = o.attribute(QStringLiteral("text"));
        if (title.isEmpty()) title = url;
        return QVariantMap{{QStringLiteral("url"), url},
                           {QStringLiteral("title"), TextFix::repairMojibake(title)}};
    };

    QVariantList uncategorized;
    for (QDomElement top = body.firstChildElement(QStringLiteral("outline")); !top.isNull();
         top = top.nextSiblingElement(QStringLiteral("outline"))) {
        // Collect descendant feed outlines.
        QVariantList feeds;
        const QDomNodeList all = top.elementsByTagName(QStringLiteral("outline"));
        for (int i = 0; i < all.size(); ++i) {
            const QDomElement o = all.at(i).toElement();
            if (!o.attribute(QStringLiteral("xmlUrl")).trimmed().isEmpty())
                feeds.append(feedFromOutline(o));
        }
        if (feeds.isEmpty()) {
            if (!top.attribute(QStringLiteral("xmlUrl")).trimmed().isEmpty())
                uncategorized.append(feedFromOutline(top));
            continue;
        }
        QString label = top.attribute(QStringLiteral("title"));
        if (label.isEmpty()) label = top.attribute(QStringLiteral("text"));
        if (label.isEmpty()) label = QStringLiteral("Category");
        label = TextFix::repairMojibake(label);
        categories.append(QVariantMap{{QStringLiteral("label"), label},
                                      {QStringLiteral("feeds"), feeds}});
        activeCatIds.append(QStringLiteral("cat:") + label);
    }
    if (!uncategorized.isEmpty()) {
        categories.append(QVariantMap{{QStringLiteral("label"), QStringLiteral("Uncategorized")},
                                      {QStringLiteral("feeds"), uncategorized}});
        activeCatIds.append(QStringLiteral("cat:Uncategorized"));
    }
    if (categories.isEmpty())
        return 0;

    // Merge into wp-config: replace categories, reset column placements, keep
    // system activeIds and add the new category ids.
    const QJsonObject cfg = QJsonDocument::fromJson(
        m_settings->get(QStringLiteral("wp-config")).toString().toUtf8()).object();
    QVariantMap config = cfg.toVariantMap();
    config.insert(QStringLiteral("categories"), categories);
    config.insert(QStringLiteral("columns"), QVariantMap{});
    const QVariantList existingActiveIds = config.value(QStringLiteral("activeIds")).toList();
    if (!existingActiveIds.isEmpty()) {
        QStringList active;
        for (const QVariant& id : existingActiveIds) {
            if (!id.toString().startsWith(QStringLiteral("cat:")))
                active.append(id.toString());
        }
        active.append(activeCatIds);
        config.insert(QStringLiteral("activeIds"), active);
    }
    m_settings->set(QStringLiteral("wp-config"),
                    QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(config))
                                          .toJson(QJsonDocument::Compact)));
    reload();
    qInfo() << "[news] imported" << categories.size() << "categories from OPML";
    return static_cast<int>(categories.size());
}

QVariantList NewsService::itemsFor(const QString& label) const
{
    for (const Category& category : m_categories) {
        if (category.label == label)
            return category.items;
    }
    return {};
}

bool NewsService::isLoading(const QString& label) const
{
    for (const Category& category : m_categories) {
        if (category.label == label)
            return category.pendingFeeds > 0 && category.items.isEmpty();
    }
    return false;
}

void NewsService::refresh()
{
    for (int i = 0; i < m_categories.size(); ++i)
        refreshCategory(i);
}

void NewsService::refreshCategory(int index)
{
    Category& category = m_categories[index];
    if (category.feeds.isEmpty() || category.pendingFeeds > 0)
        return;
    category.pendingFeeds = static_cast<int>(category.feeds.size());
    category.feedResults.clear();

    for (const Feed& feed : category.feeds) {
        const QString feedUrl = feed.url;
        m_http->getText(QUrl(feedUrl), this,
                        [this, index, feedUrl](const QString& text, const QString& error) {
            if (index >= m_categories.size())
                return;
            Category& cat = m_categories[index];
            if (error.isEmpty())
                cat.feedResults.append(parseFeedXml(text, feedUrl));
            if (--cat.pendingFeeds <= 0)
                finishCategory(index);
        }, QLatin1String(kRssAccept));
    }
}

void NewsService::finishCategory(int index)
{
    Category& category = m_categories[index];
    const qint64 cutoff = QDateTime::currentMSecsSinceEpoch() - kMaxAgeMs;

    QVariantList merged;
    QSet<QString> seen;
    for (const QVariantList& feedItems : std::as_const(category.feedResults)) {
        for (const QVariant& itemVar : feedItems) {
            const QVariantMap item = itemVar.toMap();
            const QString id = item.value(QStringLiteral("id")).toString();
            if (seen.contains(id))
                continue;
            const qint64 pub = item.value(QStringLiteral("pubDateMs")).toLongLong();
            if (pub > 0 && pub < cutoff)
                continue;
            seen.insert(id);
            merged.append(item);
        }
    }
    std::sort(merged.begin(), merged.end(), [](const QVariant& a, const QVariant& b) {
        return a.toMap().value(QStringLiteral("pubDateMs")).toLongLong()
             > b.toMap().value(QStringLiteral("pubDateMs")).toLongLong();
    });
    while (merged.size() > kMaxItems)
        merged.removeLast();

    if (!merged.isEmpty()) {
        category.items = merged;
        hydrateImages(index);
    } else if (category.items.isEmpty()) {
        // Mock fallback so the card is never blank when every feed fails.
        category.items = {QVariantMap{
            {QStringLiteral("id"), QStringLiteral("mock-") + category.label},
            {QStringLiteral("title"), QStringLiteral("Flux indisponibles pour « %1 »")
                                          .arg(category.label)},
            {QStringLiteral("link"), QString()},
            {QStringLiteral("image"), QString()},
            {QStringLiteral("source"), QStringLiteral("hors ligne")},
            {QStringLiteral("time"), QString()},
            {QStringLiteral("pubDateMs"), 0},
        }};
    }
    category.feedResults.clear();
    emit categoryUpdated(category.label);
}

// Best-effort: fill missing thumbnails by pulling og:image from the article
// page (a few per category, to avoid hammering).
void NewsService::hydrateImages(int index)
{
    if (index >= m_categories.size())
        return;
    Category& category = m_categories[index];
    const QString label = category.label;
    int launched = 0;
    for (int i = 0; i < category.items.size() && launched < 4; ++i) {
        QVariantMap item = category.items.at(i).toMap();
        if (!item.value(QStringLiteral("image")).toString().isEmpty())
            continue;
        const QString link = item.value(QStringLiteral("link")).toString();
        if (link.isEmpty())
            continue;
        ++launched;
        const QString id = item.value(QStringLiteral("id")).toString();
        m_http->getText(QUrl(link), this, [this, label, id](const QString& html, const QString& error) {
            if (!error.isEmpty())
                return;
            static const QRegularExpression ogImage(
                QStringLiteral("<meta[^>]+property=\"og:image\"[^>]+content=\"([^\"]+)\""),
                QRegularExpression::CaseInsensitiveOption);
            const QString img = ogImage.match(html).captured(1);
            if (img.isEmpty())
                return;
            for (Category& cat : m_categories) {
                if (cat.label != label)
                    continue;
                for (int j = 0; j < cat.items.size(); ++j) {
                    QVariantMap it = cat.items.at(j).toMap();
                    if (it.value(QStringLiteral("id")).toString() == id) {
                        it.insert(QStringLiteral("image"), img);
                        cat.items[j] = it;
                        emit categoryUpdated(label);
                        return;
                    }
                }
            }
        }, QStringLiteral("text/html,application/xhtml+xml,*/*;q=0.8"));
    }
}

QVariantList NewsService::parseFeedXml(const QString& xml, const QString& baseUrl)
{
    QDomDocument doc;
    if (!doc.setContent(xml))
        return {};

    QVariantList items;
    auto collect = [&](const QString& tag) {
        const QDomNodeList nodes = doc.elementsByTagName(tag);
        for (int i = 0; i < nodes.size() && items.size() < kMaxItems; ++i) {
            const QDomElement item = nodes.at(i).toElement();
            if (item.isNull())
                continue;

            const QString link = extractLink(item, baseUrl);
            const QString title = childText(item, QStringLiteral("title"));
            if (link.isEmpty() || title.isEmpty())
                continue;

            QString pubRaw = childText(item, QStringLiteral("pubDate"));
            if (pubRaw.isEmpty()) pubRaw = childText(item, QStringLiteral("published"));
            if (pubRaw.isEmpty()) pubRaw = childText(item, QStringLiteral("updated"));
            const qint64 pubMs = parseDateMs(pubRaw);

            QString description = childText(item, QStringLiteral("description"));
            if (description.isEmpty()) description = childText(item, QStringLiteral("summary"));
            if (description.isEmpty()) description = childText(item, QStringLiteral("encoded"));

            QString author = childText(item, QStringLiteral("creator"));
            if (author.isEmpty()) author = childText(item, QStringLiteral("author"));

            const QString rawImage = extractImage(item);
            QString image = normalizeItemUrl(rawImage, link.isEmpty() ? baseUrl : link);
            if (image.isEmpty())
                image = rawImage;

            const QString guid = item.firstChildElement(QStringLiteral("guid")).text().trimmed();
            items.append(QVariantMap{
                {QStringLiteral("id"), guid.isEmpty() ? link : guid},
                {QStringLiteral("title"), title},
                {QStringLiteral("link"), link},
                {QStringLiteral("image"), image},
                {QStringLiteral("description"), stripHtml(description)},
                {QStringLiteral("author"), author},
                {QStringLiteral("source"), hostname(link)},
                {QStringLiteral("time"), relTime(pubMs)},
                {QStringLiteral("pubDateMs"), pubMs},
            });
        }
    };
    collect(QStringLiteral("item"));
    if (items.isEmpty())
        collect(QStringLiteral("entry"));
    return items;
}

} // namespace qtpanel
