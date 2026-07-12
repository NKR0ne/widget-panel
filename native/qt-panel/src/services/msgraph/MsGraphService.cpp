#include "MsGraphService.h"

#include "core/HttpClient.h"
#include "core/SettingsStore.h"

#include <QCryptographicHash>
#include <QDateTime>
#include <QDebug>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocale>
#include <QRandomGenerator>
#include <QTcpSocket>
#include <QTimeZone>
#include <QUrl>
#include <QUrlQuery>

#include <utility>

namespace qtpanel {

namespace {

constexpr quint16 kAuthPort = 47340;  // MS_AUTH_PORT — must match the Azure app redirect URI
const char kTokenUrl[] = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const char kAuthorizeUrl[] = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const char kGraphBase[] = "https://graph.microsoft.com/v1.0";
// Mail.ReadWrite (not Mail.Read) so markRead's PATCH doesn't 403.
const char kScopes[] = "Calendars.Read Mail.ReadWrite Tasks.ReadWrite offline_access User.Read";

constexpr int kAgendaPollMin = 5;
constexpr int kMailPollMin = 3;
constexpr int kTodoPollMin = 5;

QString base64Url(const QByteArray& bytes)
{
    return QString::fromLatin1(bytes.toBase64(QByteArray::Base64UrlEncoding
                                              | QByteArray::OmitTrailingEquals));
}

QString relTime(const QDateTime& dt)
{
    if (!dt.isValid())
        return {};
    const qint64 seconds = dt.secsTo(QDateTime::currentDateTime());
    if (seconds < 60) return QStringLiteral("%1s").arg(qMax<qint64>(0, seconds));
    if (seconds < 3600) return QStringLiteral("%1m").arg(seconds / 60);
    if (seconds < 86400) return QStringLiteral("%1h").arg(seconds / 3600);
    return QStringLiteral("%1d").arg(seconds / 86400);
}

} // namespace

MsGraphService::MsGraphService(SettingsStore* settings, HttpClient* http, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_http(http)
{
    m_authTimeout.setSingleShot(true);
    m_authTimeout.setInterval(5 * 60 * 1000);
    connect(&m_authTimeout, &QTimer::timeout, this, [this] {
        stopAuthServer();
        if (m_authState == QLatin1String("authenticating"))
            failAuth(QStringLiteral("Microsoft sign-in timed out."));
    });

    m_agendaTimer.setInterval(kAgendaPollMin * 60 * 1000);
    connect(&m_agendaTimer, &QTimer::timeout, this, &MsGraphService::fetchAgenda);
    m_mailTimer.setInterval(kMailPollMin * 60 * 1000);
    connect(&m_mailTimer, &QTimer::timeout, this, &MsGraphService::fetchMail);
    m_todoTimer.setInterval(kTodoPollMin * 60 * 1000);
    connect(&m_todoTimer, &QTimer::timeout, this, &MsGraphService::fetchTodo);
    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key != QLatin1String("wp-ms-client"))
            return;
        const QString next = m_settings->get(QStringLiteral("wp-ms-client")).toString().trimmed();
        if (next == m_clientId)
            return;
        m_clientId = next;
        if (!m_refreshToken.isEmpty()) {
            m_accessToken.clear();
            m_refreshToken.clear();
            m_expiryMs = 0;
            m_settings->remove(QStringLiteral("wp-ms-tokens"));
        }
        if (m_authState != QLatin1String("authenticating"))
            setAuthState(m_clientId.isEmpty() ? QStringLiteral("none") : QStringLiteral("setup"));
    });

    loadStoredTokens();
    if (!m_refreshToken.isEmpty()) {
        setAuthState(QStringLiteral("refreshing"));
        refreshAll();
    } else if (m_clientId.isEmpty()) {
        setAuthState(QStringLiteral("none"));
    } else {
        setAuthState(QStringLiteral("setup"));
    }
}

void MsGraphService::setAuthState(const QString& state)
{
    if (state != QLatin1String("error") && !m_authError.isEmpty()) {
        m_authError.clear();
        emit authErrorChanged();
    }
    if (m_authState == state)
        return;
    m_authState = state;
    emit authStateChanged();
    qInfo() << "[msgraph] auth state:" << state;
}

void MsGraphService::loadStoredTokens()
{
    m_clientId = m_settings->get(QStringLiteral("wp-ms-client")).toString();
    const QString rawTokens = m_settings->get(QStringLiteral("wp-ms-tokens")).toString();
    if (rawTokens.isEmpty())
        return;
    const QJsonDocument doc = QJsonDocument::fromJson(rawTokens.toUtf8());
    if (!doc.isObject())
        return;
    const QJsonObject obj = doc.object();
    m_accessToken = obj.value(QLatin1String("accessToken")).toString();
    m_refreshToken = obj.value(QLatin1String("refreshToken")).toString();
    m_expiryMs = static_cast<qint64>(obj.value(QLatin1String("expiry")).toDouble());
}

void MsGraphService::saveTokens(const QString& accessToken, const QString& refreshToken,
                                qint64 expiryMs)
{
    m_accessToken = accessToken;
    if (!refreshToken.isEmpty())
        m_refreshToken = refreshToken;
    m_expiryMs = expiryMs;
    // Same JSON-string shape the Electron app stores, for compatibility.
    const QJsonObject obj{
        {QStringLiteral("accessToken"), m_accessToken},
        {QStringLiteral("refreshToken"), m_refreshToken},
        {QStringLiteral("expiry"), static_cast<double>(m_expiryMs)},
    };
    m_settings->set(QStringLiteral("wp-ms-tokens"),
                    QString::fromUtf8(QJsonDocument(obj).toJson(QJsonDocument::Compact)));
}

void MsGraphService::ensureToken(TokenCallback onReady)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (!m_accessToken.isEmpty() && now < m_expiryMs - 5 * 60 * 1000) {
        onReady(m_accessToken);
        return;
    }
    refreshToken(std::move(onReady));
}

void MsGraphService::refreshToken(TokenCallback onReady)
{
    if (m_refreshToken.isEmpty() || m_clientId.isEmpty()) {
        setAuthState(m_clientId.isEmpty() ? QStringLiteral("none") : QStringLiteral("setup"));
        return;
    }
    m_tokenWaiters.append(std::move(onReady));
    if (m_refreshing)
        return;
    m_refreshing = true;

    QUrlQuery form;
    form.addQueryItem(QStringLiteral("client_id"), m_clientId);
    form.addQueryItem(QStringLiteral("grant_type"), QStringLiteral("refresh_token"));
    form.addQueryItem(QStringLiteral("refresh_token"), m_refreshToken);

    m_http->postForm(QUrl(QLatin1String(kTokenUrl)), form, this,
                     [this](const QJsonDocument& doc, int status, const QString& error) {
        m_refreshing = false;
        const QJsonObject body = doc.object();
        const QString accessToken = body.value(QLatin1String("access_token")).toString();
        if (status != 200 || accessToken.isEmpty()) {
            const QString detail = !error.isEmpty() ? error
                : !body.value(QLatin1String("error_description")).toString().isEmpty()
                    ? body.value(QLatin1String("error_description")).toString()
                    : body.value(QLatin1String("error")).toString();
            m_tokenWaiters.clear();
            if (status == 400 || status == 401) {
                m_accessToken.clear();
                m_refreshToken.clear();
                m_expiryMs = 0;
                m_settings->remove(QStringLiteral("wp-ms-tokens"));
            }
            failAuth(detail.isEmpty()
                         ? QStringLiteral("Microsoft token refresh failed (%1).").arg(status)
                         : detail);
            return;
        }
        const qint64 expiresIn = static_cast<qint64>(
            body.value(QLatin1String("expires_in")).toDouble(3600));
        saveTokens(accessToken,
                   body.value(QLatin1String("refresh_token")).toString(),
                   QDateTime::currentMSecsSinceEpoch() + expiresIn * 1000);
        setAuthState(QStringLiteral("ok"));
        const auto waiters = std::exchange(m_tokenWaiters, {});
        for (const TokenCallback& waiter : waiters)
            waiter(m_accessToken);
    });
}

// ── Interactive PKCE ──────────────────────────────────────────────────────────

void MsGraphService::startAuth(const QString& clientId)
{
    if (clientId.trimmed().isEmpty()) {
        failAuth(QStringLiteral("Microsoft client ID is not configured."));
        return;
    }
    m_clientId = clientId.trimmed();
    m_settings->set(QStringLiteral("wp-ms-client"), m_clientId);
    stopAuthServer();

    QByteArray verifierBytes(32, Qt::Uninitialized);
    QRandomGenerator::system()->fillRange(
        reinterpret_cast<quint32*>(verifierBytes.data()), verifierBytes.size() / 4);
    m_codeVerifier = base64Url(verifierBytes);
    QByteArray stateBytes(24, Qt::Uninitialized);
    QRandomGenerator::system()->fillRange(
        reinterpret_cast<quint32*>(stateBytes.data()), stateBytes.size() / 4);
    m_authStateToken = base64Url(stateBytes);
    const QString challenge = base64Url(
        QCryptographicHash::hash(m_codeVerifier.toLatin1(), QCryptographicHash::Sha256));

    m_authServer = new QTcpServer(this);
    connect(m_authServer, &QTcpServer::newConnection, this, [this] {
        while (QTcpSocket* socket = m_authServer ? m_authServer->nextPendingConnection() : nullptr) {
            connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
                const QByteArray requestLine = socket->peek(4096);
                const int lineEnd = requestLine.indexOf("\r\n");
                if (lineEnd < 0)
                    return;
                const QList<QByteArray> parts = requestLine.left(lineEnd).split(' ');
                if (parts.size() < 2 || !parts[1].startsWith("/callback")) {
                    socket->write("HTTP/1.1 204 No Content\r\n\r\n");
                    socket->disconnectFromHost();
                    return;
                }
                const QUrlQuery query(QUrl(QString::fromLatin1(parts[1])).query());
                const QString code = query.queryItemValue(QStringLiteral("code"));
                const QString error = query.queryItemValue(QStringLiteral("error"));
                const QString errorDescription = query.queryItemValue(
                    QStringLiteral("error_description"));
                const QString returnedState = query.queryItemValue(QStringLiteral("state"));
                const bool stateValid = !m_authStateToken.isEmpty()
                    && returnedState == m_authStateToken;
                const bool success = error.isEmpty() && !code.isEmpty() && stateValid;
                QString callbackError;
                if (!stateValid)
                    callbackError = QStringLiteral("OAuth state validation failed.");
                else if (!errorDescription.isEmpty())
                    callbackError = errorDescription;
                else if (!error.isEmpty())
                    callbackError = error;
                else if (code.isEmpty())
                    callbackError = QStringLiteral("Microsoft returned no authorization code.");

                const QByteArray html = QStringLiteral(
                    "<!DOCTYPE html><html><head><meta charset=utf-8><title>Widget Panel</title></head>"
                    "<body style=\"font-family:system-ui;background:#0a0a0c;color:#aaa;display:flex;"
                    "align-items:center;justify-content:center;height:100vh;margin:0;"
                    "flex-direction:column;gap:14px\"><div style=\"font-size:32px\">%1</div>"
                    "<div style=\"font-size:14px\">%2</div></body></html>")
                    .arg(success ? QStringLiteral("✓") : QStringLiteral("✗"),
                         success
                             ? QStringLiteral("Authentication complete — you can close this tab.")
                             : (QStringLiteral("Authentication failed: ")
                                + callbackError.toHtmlEscaped()))
                    .toUtf8();
                socket->write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                              "Content-Length: " + QByteArray::number(html.size()) + "\r\n\r\n" + html);
                socket->flush();
                socket->disconnectFromHost();

                stopAuthServer();
                if (!success)
                    failAuth(callbackError);
                else
                    exchangeAuthCode(code);
            });
        }
    });
    if (!m_authServer->listen(QHostAddress::LocalHost, kAuthPort)) {
        qWarning() << "[msgraph] auth callback port" << kAuthPort << "unavailable";
        stopAuthServer();
        failAuth(QStringLiteral("Microsoft callback port 47340 is unavailable."));
        return;
    }

    QUrl authUrl{QLatin1String(kAuthorizeUrl)};
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("client_id"), m_clientId);
    query.addQueryItem(QStringLiteral("response_type"), QStringLiteral("code"));
    query.addQueryItem(QStringLiteral("redirect_uri"),
                       QStringLiteral("http://localhost:%1/callback").arg(kAuthPort));
    query.addQueryItem(QStringLiteral("scope"), QLatin1String(kScopes));
    query.addQueryItem(QStringLiteral("code_challenge"), challenge);
    query.addQueryItem(QStringLiteral("code_challenge_method"), QStringLiteral("S256"));
    query.addQueryItem(QStringLiteral("state"), m_authStateToken);
    query.addQueryItem(QStringLiteral("prompt"), QStringLiteral("select_account"));
    authUrl.setQuery(query);

    setAuthState(QStringLiteral("authenticating"));
    m_authTimeout.start();
    emit authUrlReady(authUrl.toString());
    qInfo() << "[msgraph] PKCE auth opened in native browser island";
}

void MsGraphService::exchangeAuthCode(const QString& code)
{
    QUrlQuery form;
    form.addQueryItem(QStringLiteral("client_id"), m_clientId);
    form.addQueryItem(QStringLiteral("grant_type"), QStringLiteral("authorization_code"));
    form.addQueryItem(QStringLiteral("code"), code);
    form.addQueryItem(QStringLiteral("redirect_uri"),
                      QStringLiteral("http://localhost:%1/callback").arg(kAuthPort));
    form.addQueryItem(QStringLiteral("code_verifier"), m_codeVerifier);

    m_http->postForm(QUrl(QLatin1String(kTokenUrl)), form, this,
                     [this](const QJsonDocument& doc, int status, const QString& error) {
        const QJsonObject body = doc.object();
        const QString accessToken = body.value(QLatin1String("access_token")).toString();
        if (status != 200 || accessToken.isEmpty()) {
            const QString detail = !error.isEmpty() ? error
                : !body.value(QLatin1String("error_description")).toString().isEmpty()
                    ? body.value(QLatin1String("error_description")).toString()
                    : body.value(QLatin1String("error")).toString();
            failAuth(detail.isEmpty()
                         ? QStringLiteral("Microsoft code exchange failed (%1).").arg(status)
                         : detail);
            return;
        }
        const qint64 expiresIn = static_cast<qint64>(
            body.value(QLatin1String("expires_in")).toDouble(3600));
        saveTokens(accessToken,
                   body.value(QLatin1String("refresh_token")).toString(),
                   QDateTime::currentMSecsSinceEpoch() + expiresIn * 1000);
        setAuthState(QStringLiteral("ok"));
        m_codeVerifier.clear();
        m_authStateToken.clear();
        refreshAll();
    });
}

void MsGraphService::stopAuthServer()
{
    m_authTimeout.stop();
    if (m_authServer) {
        m_authServer->close();
        m_authServer->deleteLater();
        m_authServer = nullptr;
    }
}

void MsGraphService::cancelAuth()
{
    if (m_authState != QLatin1String("authenticating"))
        return;
    stopAuthServer();
    m_codeVerifier.clear();
    m_authStateToken.clear();
    setAuthState(m_clientId.isEmpty() ? QStringLiteral("none") : QStringLiteral("setup"));
    qInfo() << "[msgraph] interactive authentication cancelled";
}

void MsGraphService::signOut()
{
    m_accessToken.clear();
    m_refreshToken.clear();
    m_expiryMs = 0;
    m_settings->remove(QStringLiteral("wp-ms-tokens"));
    m_agendaEvents.clear();
    m_mailMessages.clear();
    m_todoTasks.clear();
    m_unreadCount = 0;
    m_agendaTimer.stop();
    m_mailTimer.stop();
    m_todoTimer.stop();
    emit agendaChanged();
    emit mailChanged();
    emit todoChanged();
    emit unreadCountChanged();
    setAuthState(m_clientId.isEmpty() ? QStringLiteral("none") : QStringLiteral("setup"));
}

// ── Graph data flows ──────────────────────────────────────────────────────────

void MsGraphService::graphGet(const QString& path, std::function<void(const QJsonDocument&)> onOk)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    const qint64 backoffUntil = m_graphBackoffUntil.value(path, 0);
    if (backoffUntil > now) {
        if (!m_graphRetryScheduled.contains(path)) {
            m_graphRetryScheduled.insert(path);
            const int delayMs = static_cast<int>(
                qBound<qint64>(1000LL, backoffUntil - now, 5LL * 60LL * 1000LL));
            QTimer::singleShot(delayMs, this, [this, path, onOk = std::move(onOk)]() mutable {
                m_graphRetryScheduled.remove(path);
                graphGet(path, std::move(onOk));
            });
        }
        qInfo() << "[msgraph] GET" << path << "deferred by throttle backoff";
        return;
    }

    ensureToken([this, path, onOk = std::move(onOk)](const QString& token) {
        m_http->requestJsonAuth("GET", QUrl(QLatin1String(kGraphBase) + path), token, {}, this,
                                [this, path, onOk](const QJsonDocument& doc, int status,
                                                   const QString& error) {
            if (status == 401) {
                // Token went bad mid-flight; one retry after a forced refresh.
                m_expiryMs = 0;
                ensureToken([this, path, onOk](const QString& fresh) {
                    m_http->requestJsonAuth("GET", QUrl(QLatin1String(kGraphBase) + path), fresh,
                                            {}, this,
                                            [onOk](const QJsonDocument& retryDoc, int retryStatus,
                                                   const QString&) {
                        if (retryStatus >= 200 && retryStatus < 300)
                            onOk(retryDoc);
                    });
                });
                return;
            }
            if (status >= 200 && status < 300)
                onOk(doc);
            else if (status == 429 || status == 503 || status == 504) {
                constexpr int kGraphBackoffMs = 60000;
                m_graphBackoffUntil.insert(path,
                    QDateTime::currentMSecsSinceEpoch() + kGraphBackoffMs);
                if (!m_graphRetryScheduled.contains(path)) {
                    m_graphRetryScheduled.insert(path);
                    QTimer::singleShot(kGraphBackoffMs, this, [this, path, onOk] {
                        m_graphRetryScheduled.remove(path);
                        graphGet(path, onOk);
                    });
                }
                qWarning() << "[msgraph] GET" << path << "throttled/unavailable:" << status
                           << error << "- retrying after" << kGraphBackoffMs << "ms";
            } else {
                qWarning() << "[msgraph] GET" << path << "failed:" << status << error;
            }
        });
    });
}

QStringList MsGraphService::selectedCalendarIds() const
{
    const QString raw = m_settings->get(QStringLiteral("wp-agenda-cal-ids")).toString();
    if (raw.isEmpty())
        return {};
    // Tolerate the Electron JSON-array format and our comma-joined format.
    const QJsonDocument doc = QJsonDocument::fromJson(raw.toUtf8());
    if (doc.isArray()) {
        QStringList ids;
        for (const QJsonValue& v : doc.array())
            if (!v.toString().isEmpty())
                ids.append(v.toString());
        return ids;
    }
    return raw.split(QLatin1Char(','), Qt::SkipEmptyParts);
}

QString MsGraphService::selectedTodoListId() const
{
    return m_settings->get(QStringLiteral("wp-todo-list-id")).toString();
}

void MsGraphService::toggleCalendar(const QString& id)
{
    QStringList ids = selectedCalendarIds();
    if (ids.isEmpty()) {
        for (const QVariant& calendar : std::as_const(m_calendars)) {
            const QString calendarId = calendar.toMap().value(QStringLiteral("id")).toString();
            if (!calendarId.isEmpty())
                ids.append(calendarId);
        }
    }
    if (ids.contains(id))
        ids.removeAll(id);
    else
        ids.append(id);
    if (ids.size() == m_calendars.size()) {
        m_settings->remove(QStringLiteral("wp-agenda-cal-ids"));
    } else {
        // Persist as a JSON array (Electron-compatible; ids contain commas/specials).
        m_settings->set(QStringLiteral("wp-agenda-cal-ids"),
                        QString::fromUtf8(QJsonDocument(QJsonArray::fromStringList(ids))
                                              .toJson(QJsonDocument::Compact)));
    }
    emit calendarsChanged();
    fetchAgenda();
}

void MsGraphService::setTodoList(const QString& id)
{
    m_settings->set(QStringLiteral("wp-todo-list-id"), id);
    emit todoListsChanged();
    fetchTodoTasks(id);
}

void MsGraphService::refreshAll()
{
    if (m_refreshToken.isEmpty())
        return;
    fetchCalendars();
    fetchAgenda();
    fetchMail();
    fetchTodoLists();
    fetchTodo();
    m_agendaTimer.start();
    m_mailTimer.start();
    m_todoTimer.start();
}

void MsGraphService::fetchCalendars()
{
    graphGet(QStringLiteral("/me/calendars?$select=id,name,hexColor,color&$top=50"),
             [this](const QJsonDocument& doc) {
        QVariantList cals;
        for (const QJsonValue& v : doc.object().value(QLatin1String("value")).toArray()) {
            const QJsonObject c = v.toObject();
            QString color = c.value(QLatin1String("hexColor")).toString();
            cals.append(QVariantMap{
                {QStringLiteral("id"), c.value(QLatin1String("id")).toString()},
                {QStringLiteral("name"), c.value(QLatin1String("name")).toString()},
                {QStringLiteral("color"), color.startsWith(QLatin1Char('#')) ? color
                                                                            : QStringLiteral("#4f8ef7")},
            });
        }
        m_calendars = cals;
        emit calendarsChanged();
    });
}

void MsGraphService::fetchAgenda()
{
    const QDateTime now = QDateTime::currentDateTime();
    const QString range = QStringLiteral("startDateTime=%1&endDateTime=%2")
        .arg(now.toUTC().toString(Qt::ISODate), now.addMonths(1).toUTC().toString(Qt::ISODate));
    const QString sel = QStringLiteral(
        "&$select=subject,start,end,location,isAllDay,webLink&$orderby=start/dateTime&$top=200");

    const QStringList calIds = selectedCalendarIds();
    m_agendaAccum.clear();

    // Map id → color from the fetched calendar list.
    auto colorFor = [this](const QString& id) {
        for (const QVariant& v : m_calendars)
            if (v.toMap().value(QStringLiteral("id")).toString() == id)
                return v.toMap().value(QStringLiteral("color")).toString();
        return QStringLiteral("#4f8ef7");
    };

    auto process = [this](const QJsonDocument& doc, const QString& color) {
        const QLocale locale(QStringLiteral("fr_CA"));
        for (const QJsonValue& value : doc.object().value(QLatin1String("value")).toArray()) {
            const QJsonObject event = value.toObject();
            QDateTime startDt = QDateTime::fromString(
                event.value(QLatin1String("start")).toObject()
                     .value(QLatin1String("dateTime")).toString().left(19), Qt::ISODate);
            startDt.setTimeZone(QTimeZone::utc());
            const QDateTime local = startDt.toLocalTime();
            QDateTime endDt = QDateTime::fromString(
                event.value(QLatin1String("end")).toObject()
                     .value(QLatin1String("dateTime")).toString().left(19), Qt::ISODate);
            endDt.setTimeZone(QTimeZone::utc());
            const int durationMinutes = qMax<qint64>(0, startDt.secsTo(endDt) / 60);
            const bool allDay = event.value(QLatin1String("isAllDay")).toBool();
            const QDate today = QDate::currentDate();
            QString dayLabel;
            if (local.date() == today)
                dayLabel = QStringLiteral("Aujourd'hui");
            else if (local.date() == today.addDays(1))
                dayLabel = QStringLiteral("Demain");
            else
                dayLabel = locale.toString(local.date(), QStringLiteral("dddd d MMM"));
            m_agendaAccum.append(QVariantMap{
                {QStringLiteral("subject"), event.value(QLatin1String("subject")).toString()},
                {QStringLiteral("day"), dayLabel},
                {QStringLiteral("dateKey"), local.date().toString(Qt::ISODate)},
                {QStringLiteral("dateLong"),
                 locale.toString(local.date(), QStringLiteral("dddd d MMMM"))},
                {QStringLiteral("time"), allDay ? QStringLiteral("Journée")
                                                : local.toString(QStringLiteral("HH:mm"))},
                {QStringLiteral("durationMinutes"), durationMinutes},
                {QStringLiteral("allDay"), allDay},
                {QStringLiteral("isToday"), local.date() == QDate::currentDate()},
                {QStringLiteral("sortKey"), local.toMSecsSinceEpoch()},
                {QStringLiteral("color"), color},
                {QStringLiteral("location"), event.value(QLatin1String("location")).toObject()
                                                  .value(QLatin1String("displayName")).toString()},
                {QStringLiteral("webLink"), event.value(QLatin1String("webLink")).toString()},
            });
        }
    };

    auto publish = [this] {
        std::sort(m_agendaAccum.begin(), m_agendaAccum.end(), [](const QVariant& a, const QVariant& b) {
            return a.toMap().value(QStringLiteral("sortKey")).toLongLong()
                 < b.toMap().value(QStringLiteral("sortKey")).toLongLong();
        });
        QString previousDay;
        for (QVariant& entry : m_agendaAccum) {
            QVariantMap map = entry.toMap();
            const QString dateKey = map.value(QStringLiteral("dateKey")).toString();
            map.insert(QStringLiteral("showDayHeader"), dateKey != previousDay);
            previousDay = dateKey;
            entry = map;
        }
        m_agendaEvents = m_agendaAccum;
        emit agendaChanged();
        qInfo() << "[msgraph] agenda:" << m_agendaEvents.size() << "events";
    };

    if (calIds.isEmpty()) {
        graphGet(QStringLiteral("/me/calendarView?") + range + sel,
                 [process, publish](const QJsonDocument& doc) {
            process(doc, QStringLiteral("#4f8ef7"));
            publish();
        });
        return;
    }

    m_agendaPending = static_cast<int>(calIds.size());
    for (const QString& id : calIds) {
        const QString color = colorFor(id);
        const QString encId = QString::fromUtf8(QUrl::toPercentEncoding(id));
        graphGet(QStringLiteral("/me/calendars/%1/calendarView?").arg(encId) + range + sel,
                 [this, process, publish, color](const QJsonDocument& doc) {
            process(doc, color);
            if (--m_agendaPending <= 0)
                publish();
        });
    }
}

void MsGraphService::fetchMail()
{
    graphGet(QStringLiteral("/me/mailFolders/inbox/messages?$top=50"
                            "&$select=subject,from,receivedDateTime,bodyPreview,isRead,"
                            "importance,webLink"),
             [this](const QJsonDocument& doc) {
        QVariantList messages;
        int unread = 0;
        const QJsonArray values = doc.object().value(QLatin1String("value")).toArray();
        for (const QJsonValue& value : values) {
            const QJsonObject message = value.toObject();
            const bool isRead = message.value(QLatin1String("isRead")).toBool();
            if (!isRead)
                ++unread;
            const QJsonObject fromAddr = message.value(QLatin1String("from")).toObject()
                                             .value(QLatin1String("emailAddress")).toObject();
            const QDateTime received = QDateTime::fromString(
                message.value(QLatin1String("receivedDateTime")).toString(), Qt::ISODate);
            messages.append(QVariantMap{
                {QStringLiteral("id"), message.value(QLatin1String("id")).toString()},
                {QStringLiteral("subject"), message.value(QLatin1String("subject")).toString()},
                {QStringLiteral("from"), fromAddr.value(QLatin1String("name")).toString()},
                {QStringLiteral("preview"),
                 message.value(QLatin1String("bodyPreview")).toString().left(140)},
                {QStringLiteral("time"), relTime(received)},
                {QStringLiteral("isRead"), isRead},
                {QStringLiteral("important"),
                 message.value(QLatin1String("importance")).toString() == QLatin1String("high")},
                {QStringLiteral("webLink"), message.value(QLatin1String("webLink")).toString()},
            });
        }
        m_mailMessages = messages;
        emit mailChanged();
        if (m_unreadCount != unread) {
            m_unreadCount = unread;
            emit unreadCountChanged();
        }
        qInfo() << "[msgraph] mail:" << messages.size() << "messages," << unread << "unread";
    });
}

void MsGraphService::fetchTodoLists()
{
    graphGet(QStringLiteral("/me/todo/lists"), [this](const QJsonDocument& doc) {
        QVariantList lists;
        for (const QJsonValue& v : doc.object().value(QLatin1String("value")).toArray()) {
            const QJsonObject l = v.toObject();
            lists.append(QVariantMap{
                {QStringLiteral("id"), l.value(QLatin1String("id")).toString()},
                {QStringLiteral("name"), l.value(QLatin1String("displayName")).toString()},
            });
        }
        m_todoLists = lists;
        emit todoListsChanged();
    });
}

void MsGraphService::fetchTodo()
{
    const QString storedListId = m_settings->get(QStringLiteral("wp-todo-list-id")).toString();
    if (!storedListId.isEmpty()) {
        fetchTodoTasks(storedListId);
        return;
    }
    graphGet(QStringLiteral("/me/todo/lists"), [this](const QJsonDocument& doc) {
        const QJsonArray lists = doc.object().value(QLatin1String("value")).toArray();
        if (lists.isEmpty())
            return;
        const QString listId = lists.first().toObject().value(QLatin1String("id")).toString();
        m_settings->set(QStringLiteral("wp-todo-list-id"), listId);
        emit todoListsChanged();
        fetchTodoTasks(listId);
    });
}

void MsGraphService::fetchTodoTasks(const QString& listId)
{
    const QString encodedListId = QString::fromUtf8(QUrl::toPercentEncoding(listId));
    graphGet(QStringLiteral("/me/todo/lists/%1/tasks?$filter=status ne 'completed'"
                            "&$orderby=importance desc,createdDateTime&$top=20")
                 .arg(encodedListId),
             [this, listId](const QJsonDocument& doc) {
        QVariantList tasks;
        const QJsonArray values = doc.object().value(QLatin1String("value")).toArray();
        for (const QJsonValue& value : values) {
            const QJsonObject task = value.toObject();
            if (task.value(QLatin1String("status")).toString() == QLatin1String("completed"))
                continue;
            const QString due = task.value(QLatin1String("dueDateTime")).toObject()
                                    .value(QLatin1String("dateTime")).toString();
            tasks.append(QVariantMap{
                {QStringLiteral("id"), task.value(QLatin1String("id")).toString()},
                {QStringLiteral("listId"), listId},
                {QStringLiteral("title"), task.value(QLatin1String("title")).toString()},
                {QStringLiteral("due"), due.isEmpty() ? QString() : due.left(10)},
                {QStringLiteral("important"),
                 task.value(QLatin1String("importance")).toString() == QLatin1String("high")},
            });
            if (tasks.size() >= 20)
                break;
        }
        m_todoTasks = tasks;
        emit todoChanged();
        qInfo() << "[msgraph] todo:" << tasks.size() << "open tasks";
    });
}

void MsGraphService::markMailRead(const QString& messageId)
{
    // Optimistic local flip, mirroring the Electron widget.
    for (QVariant& entry : m_mailMessages) {
        QVariantMap map = entry.toMap();
        if (map.value(QStringLiteral("id")).toString() == messageId) {
            map.insert(QStringLiteral("isRead"), true);
            entry = map;
        }
    }
    emit mailChanged();
    int unread = 0;
    for (const QVariant& entry : std::as_const(m_mailMessages)) {
        if (!entry.toMap().value(QStringLiteral("isRead")).toBool())
            ++unread;
    }
    if (m_unreadCount != unread) {
        m_unreadCount = unread;
        emit unreadCountChanged();
    }

    ensureToken([this, messageId](const QString& token) {
        m_http->requestJsonAuth(
            "PATCH",
            QUrl(QLatin1String(kGraphBase) + QStringLiteral("/me/messages/") + messageId),
            token, QByteArrayLiteral("{\"isRead\":true}"), this,
            [messageId](const QJsonDocument&, int status, const QString& error) {
            if (status < 200 || status >= 300)
                qWarning() << "[msgraph] markRead failed:" << status << error;
        });
    });
}

void MsGraphService::failAuth(const QString& error)
{
    const QString detail = error.trimmed().isEmpty()
        ? QStringLiteral("Microsoft authentication failed.") : error.trimmed();
    if (m_authError != detail) {
        m_authError = detail;
        emit authErrorChanged();
    }
    setAuthState(QStringLiteral("error"));
    qWarning() << "[msgraph] auth failed:" << detail;
}

void MsGraphService::moveMail(const QString& messageId, const QString& destinationId)
{
    if (destinationId != QLatin1String("deleteditems")
            && destinationId != QLatin1String("junkemail")) {
        qWarning() << "[msgraph] rejected mail destination" << destinationId;
        return;
    }

    for (int i = 0; i < m_mailMessages.size(); ++i) {
        const QVariantMap map = m_mailMessages.at(i).toMap();
        if (map.value(QStringLiteral("id")).toString() == messageId) {
            m_mailMessages.removeAt(i);
            break;
        }
    }
    int unread = 0;
    for (const QVariant& entry : std::as_const(m_mailMessages)) {
        if (!entry.toMap().value(QStringLiteral("isRead")).toBool())
            ++unread;
    }
    m_unreadCount = unread;
    emit mailChanged();
    emit unreadCountChanged();

    ensureToken([this, messageId, destinationId](const QString& token) {
        const QJsonObject body{{QStringLiteral("destinationId"), destinationId}};
        const QByteArray encodedId = QUrl::toPercentEncoding(messageId);
        m_http->requestJsonAuth(
            "POST",
            QUrl(QLatin1String(kGraphBase) + QStringLiteral("/me/messages/")
                 + QString::fromUtf8(encodedId) + QStringLiteral("/move")),
            token, QJsonDocument(body).toJson(QJsonDocument::Compact), this,
            [this, destinationId](const QJsonDocument&, int status, const QString& error) {
            if (status < 200 || status >= 300) {
                qWarning() << "[msgraph] move mail failed:" << destinationId
                           << status << error;
                fetchMail();
            }
        });
    });
}

void MsGraphService::completeTodoTask(const QString& taskId)
{
    QString listId;
    for (int i = 0; i < m_todoTasks.size(); ++i) {
        const QVariantMap map = m_todoTasks.at(i).toMap();
        if (map.value(QStringLiteral("id")).toString() == taskId) {
            listId = map.value(QStringLiteral("listId")).toString();
            m_todoTasks.removeAt(i);
            break;
        }
    }
    emit todoChanged();
    if (listId.isEmpty())
        return;

    ensureToken([this, listId, taskId](const QString& token) {
        m_http->requestJsonAuth(
            "PATCH",
            QUrl(QLatin1String(kGraphBase)
                 + QStringLiteral("/me/todo/lists/%1/tasks/%2").arg(listId, taskId)),
            token, QByteArrayLiteral("{\"status\":\"completed\"}"), this,
            [](const QJsonDocument&, int status, const QString& error) {
            if (status < 200 || status >= 300)
                qWarning() << "[msgraph] completeTask failed:" << status << error;
        });
    });
}

void MsGraphService::addTodoTask(const QString& title)
{
    const QString trimmed = title.trimmed();
    const QString listId = selectedTodoListId();
    if (trimmed.isEmpty() || listId.isEmpty())
        return;

    const QString temporaryId = QStringLiteral("tmp-%1")
        .arg(QDateTime::currentMSecsSinceEpoch());
    m_todoTasks.prepend(QVariantMap{
        {QStringLiteral("id"), temporaryId},
        {QStringLiteral("listId"), listId},
        {QStringLiteral("title"), trimmed},
        {QStringLiteral("due"), QString()},
        {QStringLiteral("important"), false},
    });
    emit todoChanged();

    ensureToken([this, listId, trimmed, temporaryId](const QString& token) {
        const QString encodedListId = QString::fromUtf8(QUrl::toPercentEncoding(listId));
        const QJsonObject body{{QStringLiteral("title"), trimmed}};
        m_http->requestJsonAuth(
            "POST",
            QUrl(QLatin1String(kGraphBase)
                 + QStringLiteral("/me/todo/lists/%1/tasks").arg(encodedListId)),
            token, QJsonDocument(body).toJson(QJsonDocument::Compact), this,
            [this, listId, trimmed, temporaryId](const QJsonDocument& doc, int status,
                                                  const QString& error) {
            for (int i = 0; i < m_todoTasks.size(); ++i) {
                const QVariantMap current = m_todoTasks.at(i).toMap();
                if (current.value(QStringLiteral("id")).toString() != temporaryId)
                    continue;
                if (status >= 200 && status < 300) {
                    const QJsonObject task = doc.object();
                    m_todoTasks[i] = QVariantMap{
                        {QStringLiteral("id"), task.value(QLatin1String("id")).toString()},
                        {QStringLiteral("listId"), listId},
                        {QStringLiteral("title"),
                         task.value(QLatin1String("title")).toString(trimmed)},
                        {QStringLiteral("due"), QString()},
                        {QStringLiteral("important"), false},
                    };
                } else {
                    m_todoTasks.removeAt(i);
                    qWarning() << "[msgraph] add task failed:" << status << error;
                }
                emit todoChanged();
                return;
            }
        });
    });
}

} // namespace qtpanel
