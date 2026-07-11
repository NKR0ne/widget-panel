#pragma once

#include <QObject>
#include <QHash>
#include <QSet>
#include <QTcpServer>
#include <QTimer>
#include <QVariantList>

#include <functional>

class QJsonDocument;

namespace qtpanel {

class HttpClient;
class SettingsStore;

// Microsoft Graph integration: token lifecycle (silent refresh from the
// imported wp-ms-tokens, interactive PKCE via the system browser + loopback
// http://localhost:47340/callback as fallback) and the Agenda / Mail / To-Do
// data flows used by the widgets.
class MsGraphService : public QObject {
    Q_OBJECT
    // "none" (no client id), "setup" (needs interactive auth),
    // "authenticating", "refreshing", "ok", "error"
    Q_PROPERTY(QString authState READ authState NOTIFY authStateChanged)
    Q_PROPERTY(QVariantList agendaEvents READ agendaEvents NOTIFY agendaChanged)
    Q_PROPERTY(QVariantList mailMessages READ mailMessages NOTIFY mailChanged)
    Q_PROPERTY(QVariantList todoTasks READ todoTasks NOTIFY todoChanged)
    Q_PROPERTY(int unreadCount READ unreadCount NOTIFY unreadCountChanged)
    Q_PROPERTY(QVariantList calendars READ calendars NOTIFY calendarsChanged)
    Q_PROPERTY(QVariantList todoLists READ todoLists NOTIFY todoListsChanged)
    Q_PROPERTY(QStringList selectedCalendarIds READ selectedCalendarIds NOTIFY calendarsChanged)
    Q_PROPERTY(QString selectedTodoListId READ selectedTodoListId NOTIFY todoListsChanged)

public:
    MsGraphService(SettingsStore* settings, HttpClient* http, QObject* parent = nullptr);

    QString authState() const { return m_authState; }
    QVariantList agendaEvents() const { return m_agendaEvents; }
    QVariantList mailMessages() const { return m_mailMessages; }
    QVariantList todoTasks() const { return m_todoTasks; }
    int unreadCount() const { return m_unreadCount; }
    QVariantList calendars() const { return m_calendars; }
    QVariantList todoLists() const { return m_todoLists; }
    QStringList selectedCalendarIds() const;
    QString selectedTodoListId() const;

    Q_INVOKABLE void startAuth(const QString& clientId);
    Q_INVOKABLE void signOut();
    Q_INVOKABLE void refreshAll();
    Q_INVOKABLE void markMailRead(const QString& messageId);
    Q_INVOKABLE void moveMail(const QString& messageId, const QString& destinationId);
    Q_INVOKABLE void completeTodoTask(const QString& taskId);
    Q_INVOKABLE void addTodoTask(const QString& title);
    Q_INVOKABLE void toggleCalendar(const QString& id);
    Q_INVOKABLE void setTodoList(const QString& id);

signals:
    void authStateChanged();
    void agendaChanged();
    void mailChanged();
    void todoChanged();
    void unreadCountChanged();
    void calendarsChanged();
    void todoListsChanged();

private:
    using TokenCallback = std::function<void(const QString& accessToken)>;

    void setAuthState(const QString& state);
    void loadStoredTokens();
    void saveTokens(const QString& accessToken, const QString& refreshToken, qint64 expiryMs);
    void ensureToken(TokenCallback onReady);
    void refreshToken(TokenCallback onReady);
    void exchangeAuthCode(const QString& code);
    void stopAuthServer();
    void graphGet(const QString& path, std::function<void(const QJsonDocument&)> onOk);

    void fetchAgenda();
    void fetchCalendars();
    void fetchMail();
    void fetchTodo();
    void fetchTodoLists();
    void fetchTodoTasks(const QString& listId);

    SettingsStore* m_settings = nullptr;
    HttpClient* m_http = nullptr;

    QString m_authState = QStringLiteral("none");
    QString m_clientId;
    QString m_accessToken;
    QString m_refreshToken;
    qint64 m_expiryMs = 0;
    bool m_refreshing = false;
    QList<TokenCallback> m_tokenWaiters;

    // Interactive PKCE state
    QTcpServer* m_authServer = nullptr;
    QString m_codeVerifier;
    QTimer m_authTimeout;

    QTimer m_agendaTimer;
    QTimer m_mailTimer;
    QTimer m_todoTimer;
    QVariantList m_agendaEvents;
    QVariantList m_mailMessages;
    QVariantList m_todoTasks;
    QVariantList m_calendars;   // {id,name,color}
    QVariantList m_todoLists;   // {id,name}
    int m_unreadCount = 0;
    // Multi-calendar agenda accumulation.
    int m_agendaPending = 0;
    QVariantList m_agendaAccum;
    QHash<QString, qint64> m_graphBackoffUntil;
    QSet<QString> m_graphRetryScheduled;
};

} // namespace qtpanel
