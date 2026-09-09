#include "RadioService.h"

#include "core/HttpClient.h"
#include "core/SettingsStore.h"

#include <QAudioOutput>
#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMediaMetaData>
#include <QMediaPlayer>
#include <QRegularExpression>
#include <QSet>
#include <QUrl>
#include <QUrlQuery>

#include <algorithm>
#include <utility>

namespace qtpanel {

namespace {

const QString kDirectoryUrl =
    QStringLiteral("https://all.api.radio-browser.info/json/stations/search");

QString frequencyFromName(const QString& name)
{
    static const QRegularExpression frequencyRe(
        QStringLiteral("(?:^|\\D)((?:8[7-9]|9\\d|10[0-7])(?:[.,]\\d)?)(?=\\D|$)"));
    const QRegularExpressionMatch match = frequencyRe.match(name);
    if (!match.hasMatch())
        return {};
    QString value = match.captured(1);
    value.replace(QLatin1Char(','), QLatin1Char('.'));
    return value + QStringLiteral(" FM");
}

QVariantMap stationFromObject(const QJsonObject& object)
{
    if (object.value(QLatin1String("lastcheckok")).toInt(1) == 0)
        return {};

    const QString id = object.value(QLatin1String("stationuuid")).toString().trimmed();
    const QString name = object.value(QLatin1String("name")).toString().trimmed();
    QString streamUrl = object.value(QLatin1String("url_resolved")).toString().trimmed();
    if (streamUrl.isEmpty())
        streamUrl = object.value(QLatin1String("url")).toString().trimmed();

    const QUrl parsedUrl(streamUrl);
    if (id.isEmpty() || name.isEmpty() || !parsedUrl.isValid()
        || (parsedUrl.scheme() != QLatin1String("http")
            && parsedUrl.scheme() != QLatin1String("https"))) {
        return {};
    }

    return {
        {QStringLiteral("id"), id},
        {QStringLiteral("name"), name},
        {QStringLiteral("url"), streamUrl},
        {QStringLiteral("homepage"), object.value(QLatin1String("homepage")).toString()},
        {QStringLiteral("logo"), object.value(QLatin1String("favicon")).toString()},
        {QStringLiteral("country"), object.value(QLatin1String("country")).toString()},
        {QStringLiteral("state"), object.value(QLatin1String("state")).toString()},
        {QStringLiteral("language"), object.value(QLatin1String("language")).toString()},
        {QStringLiteral("tags"), object.value(QLatin1String("tags")).toString()},
        {QStringLiteral("codec"), object.value(QLatin1String("codec")).toString()},
        {QStringLiteral("bitrate"), object.value(QLatin1String("bitrate")).toInt()},
        {QStringLiteral("frequency"), frequencyFromName(name)},
    };
}

} // namespace

RadioService::RadioService(SettingsStore* settings, HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_http(http)
    , m_player(new QMediaPlayer(this))
    , m_audioOutput(new QAudioOutput(this))
{
    m_audioOutput->setVolume(std::clamp(
        m_settings->getDouble(QStringLiteral("wp-radio-volume"), 0.72), 0.0, 1.0));
    m_player->setAudioOutput(m_audioOutput);

    connect(m_player, &QMediaPlayer::playbackStateChanged, this, [this] {
        emit stateChanged();
    });
    connect(m_player, &QMediaPlayer::mediaStatusChanged, this,
            [this](QMediaPlayer::MediaStatus status) {
        const bool buffering = status == QMediaPlayer::LoadingMedia
            || status == QMediaPlayer::BufferingMedia
            || status == QMediaPlayer::StalledMedia;
        if (m_buffering != buffering) {
            m_buffering = buffering;
            emit stateChanged();
        }
    });
    connect(m_player, &QMediaPlayer::errorOccurred, this,
            [this](QMediaPlayer::Error, const QString& errorString) {
        m_error = errorString.isEmpty()
            ? QStringLiteral("Flux indisponible") : errorString;
        m_buffering = false;
        qWarning() << "[radio] playback failed:" << m_error;
        emit stateChanged();
    });
    connect(m_player, &QMediaPlayer::metaDataChanged,
            this, &RadioService::updateMetadata);

    loadCache();
    const QJsonObject browseState = QJsonDocument::fromJson(
        m_settings->get(QStringLiteral("wp-radio-browse")).toString().toUtf8()).object();
    m_query = browseState.value(QStringLiteral("query")).toString();
    m_region = browseState.value(QStringLiteral("region")).toString(QStringLiteral("local"));
    m_category = browseState.value(QStringLiteral("category")).toString(QStringLiteral("all"));
    m_libraryMode = m_query.isEmpty() && m_region == QLatin1String("local")
        && m_category == QLatin1String("all");
    if (!m_libraryMode)
        m_stations.clear(); // The cached local library does not match these filters.
}

bool RadioService::playing() const
{
    return m_player->playbackState() == QMediaPlayer::PlayingState;
}

qreal RadioService::volume() const
{
    return m_audioOutput->volume();
}

void RadioService::setVolume(qreal volume)
{
    const float bounded = std::clamp(static_cast<float>(volume), 0.0f, 1.0f);
    if (qFuzzyCompare(m_audioOutput->volume(), bounded))
        return;
    m_audioOutput->setVolume(bounded);
    m_settings->set(QStringLiteral("wp-radio-volume"), bounded);
    emit volumeChanged();
}

QString RadioService::currentStationId() const
{
    return m_current.value(QStringLiteral("id")).toString();
}

QString RadioService::stationName() const
{
    return m_current.value(QStringLiteral("name")).toString();
}

QString RadioService::stationDetail() const
{
    QStringList parts;
    const QString state = m_current.value(QStringLiteral("state")).toString().trimmed();
    const QString country = m_current.value(QStringLiteral("country")).toString().trimmed();
    const QString codec = m_current.value(QStringLiteral("codec")).toString().trimmed();
    const int bitrate = m_current.value(QStringLiteral("bitrate")).toInt();
    if (!state.isEmpty())
        parts << state;
    else if (!country.isEmpty())
        parts << country;
    if (!codec.isEmpty())
        parts << (bitrate > 0 ? QStringLiteral("%1 · %2 kb/s").arg(codec).arg(bitrate)
                             : codec);
    return parts.join(QStringLiteral("  ·  "));
}

QString RadioService::frequency() const
{
    return m_current.value(QStringLiteral("frequency")).toString();
}

QString RadioService::logoUrl() const
{
    return m_current.value(QStringLiteral("logo")).toString();
}

QVariantList RadioService::parseStations(const QJsonArray& payload)
{
    QVariantList stations;
    QSet<QString> seenIds;
    QSet<QString> seenStreams;
    for (const QJsonValue& value : payload) {
        const QVariantMap station = stationFromObject(value.toObject());
        if (station.isEmpty())
            continue;
        const QString id = station.value(QStringLiteral("id")).toString();
        const QString stream = station.value(QStringLiteral("url")).toString();
        if (seenIds.contains(id) || seenStreams.contains(stream))
            continue;
        seenIds.insert(id);
        seenStreams.insert(stream);
        stations.append(station);
    }
    return stations;
}

void RadioService::loadCache()
{
    const QJsonDocument cached = QJsonDocument::fromJson(
        m_settings->get(QStringLiteral("wp-radio-cache")).toString().toUtf8());
    if (cached.isArray()) {
        m_libraryStations = cached.array().toVariantList();
        m_stations = m_libraryStations;
    }

    const QString savedId = m_settings->get(
        QStringLiteral("wp-radio-last-station")).toString();
    const QJsonDocument savedCurrent = QJsonDocument::fromJson(
        m_settings->get(QStringLiteral("wp-radio-current")).toString().toUtf8());
    if (savedCurrent.isObject()) {
        const QVariantMap station = savedCurrent.object().toVariantMap();
        if (!station.value(QStringLiteral("id")).toString().isEmpty()
            && QUrl(station.value(QStringLiteral("url")).toString()).isValid()) {
            setCurrent(station, false);
        }
    }
    if (m_current.isEmpty()) {
        for (const QVariant& value : std::as_const(m_stations)) {
            const QVariantMap station = value.toMap();
            if (station.value(QStringLiteral("id")).toString() == savedId) {
                setCurrent(station, false);
                break;
            }
        }
    }
    if (m_current.isEmpty() && !m_stations.isEmpty())
        setCurrent(m_stations.first().toMap(), false);
}

void RadioService::saveCache()
{
        m_settings->set(QStringLiteral("wp-radio-cache"), QString::fromUtf8(
        QJsonDocument(QJsonArray::fromVariantList(m_libraryStations))
            .toJson(QJsonDocument::Compact)));
}

QString RadioService::defaultRegion() const
{
    const QVariant rawLocation = m_settings->get(QStringLiteral("wp-location"));
    QString name;
    if (rawLocation.metaType().id() == QMetaType::QString) {
        name = QJsonDocument::fromJson(rawLocation.toString().toUtf8()).object()
                   .value(QLatin1String("name")).toString();
    } else {
        name = rawLocation.toMap().value(QStringLiteral("name")).toString();
    }
    const QStringList parts = name.split(QLatin1Char(','), Qt::SkipEmptyParts);
    if (parts.size() >= 2)
        return parts.at(1).trimmed();
    return QStringLiteral("Quebec");
}

void RadioService::refresh(const QString& query)
{
    browse(query, QStringLiteral("local"), QStringLiteral("all"));
}

void RadioService::saveBrowseState()
{
    m_settings->set(QStringLiteral("wp-radio-browse"), QString::fromUtf8(
        QJsonDocument(QJsonObject{
            {QStringLiteral("query"), m_query},
            {QStringLiteral("region"), m_region},
            {QStringLiteral("category"), m_category},
        }).toJson(QJsonDocument::Compact)));
}

void RadioService::browse(const QString& query, const QString& region,
                          const QString& category)
{
    m_loading = true;
    m_error.clear();
    m_query = query.trimmed();
    m_region = region.isEmpty() ? QStringLiteral("local") : region;
    m_category = category.isEmpty() ? QStringLiteral("all") : category;
    m_libraryMode = m_query.isEmpty() && m_region == QLatin1String("local")
        && m_category == QLatin1String("all");
    const bool libraryRequest = m_libraryMode;
    saveBrowseState();
    const int requestId = ++m_requestId;
    emit stateChanged();

    QUrl url(kDirectoryUrl);
    QUrlQuery params;
    params.addQueryItem(QStringLiteral("hidebroken"), QStringLiteral("true"));
    params.addQueryItem(QStringLiteral("order"), QStringLiteral("clickcount"));
    params.addQueryItem(QStringLiteral("reverse"), QStringLiteral("true"));
    params.addQueryItem(QStringLiteral("limit"), QStringLiteral("40"));
    if (m_region == QLatin1String("local")) {
        params.addQueryItem(QStringLiteral("countrycode"), QStringLiteral("CA"));
        params.addQueryItem(QStringLiteral("state"), defaultRegion());
    } else if (m_region == QLatin1String("canada")) {
        params.addQueryItem(QStringLiteral("countrycode"), QStringLiteral("CA"));
    }
    if (!m_query.isEmpty())
        params.addQueryItem(QStringLiteral("name"), m_query);
    if (m_category != QLatin1String("all"))
        params.addQueryItem(QStringLiteral("tag"), m_category);
    url.setQuery(params);

    m_http->getJson(url, this,
        [this, requestId, libraryRequest](const QJsonDocument& document,
                                         const QString& error) {
            if (requestId != m_requestId)
                return;
            m_loading = false;
            if (!error.isEmpty() || !document.isArray()) {
                m_error = error.isEmpty()
                    ? QStringLiteral("Réponse Radio Browser invalide") : error;
                qWarning() << "[radio] directory failed:" << m_error;
                emit stateChanged();
                return;
            }
            const QVariantList stations = parseStations(document.array());
            if (stations.isEmpty()) {
                m_error = QStringLiteral("Aucune station trouvée");
                emit stateChanged();
                return;
            }
            m_stations = stations;
            if (libraryRequest) {
                m_libraryStations = stations;
                saveCache();
            }
            if (m_current.isEmpty())
                setCurrent(m_stations.first().toMap());
            emit stationsChanged();
            emit stateChanged();
            qInfo() << "[radio] directory returned" << m_stations.size() << "stations";
        });
}

void RadioService::showLibrary()
{
    ++m_requestId;
    m_loading = false;
    if (m_libraryStations.isEmpty()) {
        refresh();
        return;
    }
    m_stations = m_libraryStations;
    m_query.clear();
    m_region = QStringLiteral("local");
    m_category = QStringLiteral("all");
    m_error.clear();
    m_libraryMode = true;
    saveBrowseState();
    emit stationsChanged();
    emit stateChanged();
}

void RadioService::setCurrent(const QVariantMap& station, bool persist)
{
    if (station.isEmpty())
        return;
    m_current = station;
    m_nowPlaying.clear();
    m_error.clear();
    if (persist) {
        m_settings->set(QStringLiteral("wp-radio-last-station"), currentStationId());
        m_settings->set(QStringLiteral("wp-radio-current"), QString::fromUtf8(
            QJsonDocument(QJsonObject::fromVariantMap(m_current))
                .toJson(QJsonDocument::Compact)));
    }
    emit currentStationChanged();
    emit metadataChanged();
    emit stateChanged();
}

void RadioService::selectStation(const QString& stationId)
{
    for (const QVariant& value : std::as_const(m_stations)) {
        const QVariantMap station = value.toMap();
        if (station.value(QStringLiteral("id")).toString() != stationId)
            continue;
        const bool shouldPlay = playing();
        if (currentStationId() != stationId) {
            m_player->stop();
            m_player->setSource(QUrl());
            setCurrent(station);
        }
        if (shouldPlay)
            play();
        return;
    }
}

void RadioService::toggle()
{
    playing() ? pause() : play();
}

void RadioService::play()
{
    const QUrl streamUrl(m_current.value(QStringLiteral("url")).toString());
    if (!streamUrl.isValid() || streamUrl.isEmpty()) {
        m_error = QStringLiteral("Choisissez une station");
        emit stateChanged();
        if (m_stations.isEmpty())
            refresh();
        return;
    }

    const bool retrying = !m_error.isEmpty();
    m_error.clear();
    if (retrying)
        m_player->setSource(QUrl());
    if (m_player->source() != streamUrl)
        m_player->setSource(streamUrl);
    m_player->play();
    emit stateChanged();
}

void RadioService::pause()
{
    m_player->pause();
    emit stateChanged();
}

void RadioService::stop()
{
    m_player->stop();
    emit stateChanged();
}

int RadioService::currentIndex() const
{
    for (int i = 0; i < m_stations.size(); ++i) {
        if (m_stations.at(i).toMap().value(QStringLiteral("id")).toString()
            == currentStationId()) {
            return i;
        }
    }
    return -1;
}

void RadioService::next()
{
    if (m_stations.isEmpty())
        return;
    const bool shouldPlay = playing();
    const int nextIndex = (currentIndex() + 1 + m_stations.size()) % m_stations.size();
    selectStation(m_stations.at(nextIndex).toMap()
        .value(QStringLiteral("id")).toString());
    if (shouldPlay && !playing())
        play();
}

void RadioService::previous()
{
    if (m_stations.isEmpty())
        return;
    const bool shouldPlay = playing();
    int index = currentIndex();
    if (index < 0)
        index = 0;
    const int previousIndex = (index - 1 + m_stations.size()) % m_stations.size();
    selectStation(m_stations.at(previousIndex).toMap()
        .value(QStringLiteral("id")).toString());
    if (shouldPlay && !playing())
        play();
}

void RadioService::updateMetadata()
{
    QString title = m_player->metaData().stringValue(QMediaMetaData::Title).trimmed();
    if (title.compare(stationName(), Qt::CaseInsensitive) == 0)
        title.clear();
    if (m_nowPlaying == title)
        return;
    m_nowPlaying = title;
    emit metadataChanged();
}

} // namespace qtpanel
