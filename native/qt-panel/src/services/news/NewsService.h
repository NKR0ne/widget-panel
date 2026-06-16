#pragma once

#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

namespace qtpanel {

class HttpClient;
class SettingsStore;

// RSS/Atom aggregation for the Feedly OPML categories stored in
// wp-config.categories. Per category: fetch every feed, dedupe, drop items
// older than 30 days, sort newest-first, keep 7 — same rules as
// renderer/widgets/news/news.service.js.
class NewsService : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList categories READ categories NOTIFY categoriesChanged)
    Q_PROPERTY(QVariantList allCategories READ allCategories NOTIFY categoriesChanged)

public:
    NewsService(SettingsStore* settings, HttpClient* http, QObject* parent = nullptr);

    // Active category labels in stored order.
    QVariantList categories() const { return m_categoryLabels; }
    // All configured category labels in stored order, including disabled ones.
    QVariantList allCategories() const { return m_allCategoryLabels; }

    Q_INVOKABLE QVariantList itemsFor(const QString& label) const;
    Q_INVOKABLE QVariantList feedLabelsFor(const QString& label) const;
    Q_INVOKABLE bool isLoading(const QString& label) const;
    Q_INVOKABLE void refresh();
    // Re-read wp-config (categories + activeIds) and refetch. Called when the
    // manage panel toggles categories or imports a new OPML.
    Q_INVOKABLE void reload();
    // Parse a Feedly OPML file and replace wp-config.categories. Returns the
    // number of categories imported.
    Q_INVOKABLE int importOpml(const QUrl& fileUrl);

    // Public for unit testing; parses one RSS2/Atom document into item maps.
    static QVariantList parseFeedXml(const QString& xml, const QString& baseUrl);

signals:
    void categoriesChanged();
    void categoryUpdated(const QString& label);

private:
    struct Feed {
        QString url;
        QString title;
    };
    struct Category {
        QString label;
        QList<Feed> feeds;
        QVariantList items;
        int pendingFeeds = 0;
        QList<QVariantList> feedResults;
    };

    void loadCategories();
    void refreshCategory(int index);
    void finishCategory(int index);
    void hydrateImages(int index);

    SettingsStore* m_settings = nullptr;
    HttpClient* m_http = nullptr;
    QTimer m_pollTimer;
    QList<Category> m_categories;
    QVariantList m_categoryLabels;
    QVariantList m_allCategoryLabels;
};

} // namespace qtpanel
