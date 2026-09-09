#pragma once

#include <QJsonArray>
#include <QObject>
#include <QVariantList>
#include <QVariantMap>

class QAudioOutput;
class QMediaPlayer;

namespace qtpanel {

class HttpClient;
class SettingsStore;

// Internet simulcasts of broadcast radio, discovered through Radio Browser.
// Playback lives here rather than in QML so it survives panel hide/reorder.
class RadioService final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList stations READ stations NOTIFY stationsChanged)
    Q_PROPERTY(QVariantList favorites READ favorites NOTIFY favoritesChanged)
    Q_PROPERTY(bool favoritesMode READ favoritesMode WRITE setFavoritesMode NOTIFY stateChanged)
    Q_PROPERTY(bool loading READ loading NOTIFY stateChanged)
    Q_PROPERTY(bool playing READ playing NOTIFY stateChanged)
    Q_PROPERTY(bool buffering READ buffering NOTIFY stateChanged)
    Q_PROPERTY(QString error READ error NOTIFY stateChanged)
    Q_PROPERTY(QString query READ query NOTIFY stateChanged)
    Q_PROPERTY(QString region READ region NOTIFY stateChanged)
    Q_PROPERTY(QString category READ category NOTIFY stateChanged)
    Q_PROPERTY(bool libraryMode READ libraryMode NOTIFY stateChanged)
    Q_PROPERTY(QString currentStationId READ currentStationId NOTIFY currentStationChanged)
    Q_PROPERTY(QString stationName READ stationName NOTIFY currentStationChanged)
    Q_PROPERTY(QString stationDetail READ stationDetail NOTIFY currentStationChanged)
    Q_PROPERTY(QString frequency READ frequency NOTIFY currentStationChanged)
    Q_PROPERTY(QString logoUrl READ logoUrl NOTIFY currentStationChanged)
    Q_PROPERTY(QString nowPlaying READ nowPlaying NOTIFY metadataChanged)
    Q_PROPERTY(qreal volume READ volume WRITE setVolume NOTIFY volumeChanged)

public:
    RadioService(SettingsStore* settings, HttpClient* http, QObject* parent = nullptr);

    QVariantList stations() const { return m_stations; }
    QVariantList favorites() const { return m_favorites; }
    bool favoritesMode() const { return m_favoritesMode; }
    void setFavoritesMode(bool enabled);
    bool loading() const { return m_loading; }
    bool playing() const;
    bool buffering() const { return m_buffering; }
    QString error() const { return m_error; }
    QString query() const { return m_query; }
    QString region() const { return m_region; }
    QString category() const { return m_category; }
    bool libraryMode() const { return m_libraryMode; }
    QString currentStationId() const;
    QString stationName() const;
    QString stationDetail() const;
    QString frequency() const;
    QString logoUrl() const;
    QString nowPlaying() const { return m_nowPlaying; }
    qreal volume() const;
    void setVolume(qreal volume);

    Q_INVOKABLE void refresh(const QString& query = {});
    Q_INVOKABLE void browse(const QString& query, const QString& region,
                            const QString& category);
    Q_INVOKABLE void showLibrary();
    Q_INVOKABLE void selectStation(const QString& stationId);
    Q_INVOKABLE void toggleFavorite(const QString& stationId);
    Q_INVOKABLE void toggle();
    Q_INVOKABLE void play();
    Q_INVOKABLE void pause();
    Q_INVOKABLE void stop();
    Q_INVOKABLE void next();
    Q_INVOKABLE void previous();

    static QVariantList parseStations(const QJsonArray& payload);

signals:
    void stationsChanged();
    void favoritesChanged();
    void stateChanged();
    void currentStationChanged();
    void metadataChanged();
    void volumeChanged();

private:
    void loadCache();
    void saveCache();
    void saveBrowseState();
    void setCurrent(const QVariantMap& station, bool persist = true);
    int currentIndex() const;
    QString defaultRegion() const;
    void updateMetadata();

    SettingsStore* m_settings = nullptr;
    HttpClient* m_http = nullptr;
    QMediaPlayer* m_player = nullptr;
    QAudioOutput* m_audioOutput = nullptr;
    QVariantList m_libraryStations;
    QVariantList m_stations;
    QVariantList m_favorites;
    QVariantMap m_current;
    QString m_query;
    QString m_region = QStringLiteral("local");
    QString m_category = QStringLiteral("all");
    QString m_error;
    QString m_nowPlaying;
    bool m_loading = false;
    bool m_buffering = false;
    bool m_libraryMode = true;
    bool m_favoritesMode = false;
    int m_requestId = 0;
};

} // namespace qtpanel
