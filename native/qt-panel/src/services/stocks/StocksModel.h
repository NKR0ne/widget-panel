#pragma once

#include <QAbstractListModel>
#include <QStringList>
#include <QTimer>
#include <QVariantList>

namespace qtpanel {

class HttpClient;
class SecretVault;
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
    Q_PROPERTY(QVariantList earnings READ earnings NOTIFY earningsChanged)
    Q_PROPERTY(QVariantList ipos READ ipos NOTIFY iposChanged)
    Q_PROPERTY(QVariantList heatmapRows READ heatmapRows NOTIFY heatmapRowsChanged)
    Q_PROPERTY(bool watchlistsRefreshing READ watchlistsRefreshing NOTIFY watchlistsRefreshChanged)
    Q_PROPERTY(QString watchlistsStatus READ watchlistsStatus NOTIFY watchlistsRefreshChanged)

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
        TvSymbolRole,
    };

    StocksModel(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                QObject* parent = nullptr);

    int rowCount(const QModelIndex& parent = {}) const override;
    QVariant data(const QModelIndex& index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    QStringList listNames() const;
    int currentList() const { return m_current; }
    QVariantList earnings() const { return m_earnings; }
    QVariantList ipos() const { return m_ipos; }
    QVariantList heatmapRows() const;
    bool watchlistsRefreshing() const { return m_watchlistsRefreshing; }
    QString watchlistsStatus() const { return m_watchlistsStatus; }

    Q_INVOKABLE void setList(int index);
    Q_INVOKABLE void reloadLists();
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void refreshWatchlists();
    Q_INVOKABLE void refreshEarnings();
    Q_INVOKABLE void refreshIpos();
    Q_INVOKABLE QString heatmapUrl(const QString& blockColor = QString(),
                                   const QString& layout = QString()) const;

signals:
    void countChanged();
    void listsChanged();
    void currentListChanged();
    void earningsChanged();
    void iposChanged();
    void heatmapRowsChanged();
    void watchlistsRefreshChanged();

private:
    struct Row {
        QString display;
        QString tvSymbol;   // TradingView symbol, e.g. NASDAQ:NVDA
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
    void fetchFinnhubRow(int listIndex, int rowIndex);
    QString marketProvider() const;
    QStringList earningsSymbols() const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    HttpClient* m_http = nullptr;
    QTimer m_pollTimer;
    QTimer m_eventsTimer;
    QList<List> m_lists;
    int m_current = 0;
    QVariantList m_earnings;
    QVariantList m_ipos;
    bool m_watchlistsRefreshing = false;
    QString m_watchlistsStatus;
};

} // namespace qtpanel
