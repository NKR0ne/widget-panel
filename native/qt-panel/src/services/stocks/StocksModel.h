#pragma once

#include <QAbstractListModel>
#include <QStringList>
#include <QTimer>
#include <QVariantList>

namespace qtpanel {

class HttpClient;
class SettingsStore;

// Quote rows backed by Yahoo's v8 chart API (intraday 5-minute candles),
// polled every 60s. Supports multiple lists: the built-in "Marchés" overview
// plus the user's TradingView watchlists (from the cached wp-tv-lists-cache),
// and an IPO calendar tab via the public TradingView scanner.
class StocksModel : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ rowCount NOTIFY countChanged)
    Q_PROPERTY(QStringList listNames READ listNames NOTIFY listsChanged)
    Q_PROPERTY(int currentList READ currentList NOTIFY currentListChanged)
    Q_PROPERTY(QVariantList ipos READ ipos NOTIFY iposChanged)

public:
    enum Roles {
        DisplayRole = Qt::UserRole + 1,
        TickerRole,
        PriceRole,
        ChangeRole,
        PctRole,
        ClosesRole,
        PrevCloseRole,
        HasDataRole,
        UpRole,
    };

    StocksModel(SettingsStore* settings, HttpClient* http, QObject* parent = nullptr);

    int rowCount(const QModelIndex& parent = {}) const override;
    QVariant data(const QModelIndex& index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    QStringList listNames() const;
    int currentList() const { return m_current; }
    QVariantList ipos() const { return m_ipos; }

    Q_INVOKABLE void setList(int index);
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void refreshIpos();

signals:
    void countChanged();
    void listsChanged();
    void currentListChanged();
    void iposChanged();

private:
    struct Row {
        QString display;
        QString ticker;     // Yahoo symbol
        double price = 0;
        double change = 0;
        double pct = 0;
        double prevClose = 0;
        QVariantList closes;
        bool hasData = false;
    };
    struct List {
        QString name;
        QList<Row> rows;
    };

    void loadLists();
    void fetchRow(int listIndex, int rowIndex);

    SettingsStore* m_settings = nullptr;
    HttpClient* m_http = nullptr;
    QTimer m_pollTimer;
    QList<List> m_lists;
    int m_current = 0;
    QVariantList m_ipos;
};

} // namespace qtpanel
