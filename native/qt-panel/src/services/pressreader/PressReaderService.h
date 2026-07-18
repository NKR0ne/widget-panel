#pragma once

#include <QObject>
#include <QSet>
#include <QString>
#include <QTimer>
#include <QVariantMap>

namespace qtpanel {

class SecretVault;
class SettingsStore;

// Owns PressReader's session and authentication policy independently of the
// optional dashboard card. WebEngine rendering stays in QML, while this class
// enforces bounded login attempts and persists the library access window.
class PressReaderService : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool open READ open NOTIFY changed)
    Q_PROPERTY(QString state READ state NOTIFY changed)
    Q_PROPERTY(QString status READ status NOTIFY changed)
    Q_PROPERTY(QString entryUrl READ entryUrl NOTIFY changed)
    Q_PROPERTY(bool hasCredentials READ hasCredentials NOTIFY changed)
    Q_PROPERTY(bool automationAllowed READ automationAllowed CONSTANT)
    Q_PROPERTY(bool automationBlocked READ automationBlocked NOTIFY changed)
    Q_PROPERTY(bool manualMode READ manualMode NOTIFY changed)
    Q_PROPERTY(qint64 sessionExpiresAt READ sessionExpiresAt NOTIFY changed)
    Q_PROPERTY(int sessionRemainingMinutes READ sessionRemainingMinutes NOTIFY changed)

public:
    explicit PressReaderService(SettingsStore* settings, SecretVault* vault,
                                bool automationAllowed, QObject* parent = nullptr);

    static QString defaultEntryUrl();

    bool open() const { return m_open; }
    QString state() const { return m_state; }
    QString status() const { return m_status; }
    QString entryUrl() const;
    bool hasCredentials() const { return m_hasCredentials; }
    bool automationAllowed() const { return m_automationAllowed; }
    bool automationBlocked() const;
    bool manualMode() const { return m_manualMode; }
    qint64 sessionExpiresAt() const { return m_sessionExpiresAt; }
    int sessionRemainingMinutes() const;

    Q_INVOKABLE void toggle();
    Q_INVOKABLE void openCatalog();
    Q_INVOKABLE void openManual();
    Q_INVOKABLE void close();
    Q_INVOKABLE void showCredentials();
    Q_INVOKABLE void saveCredentials(const QString& user, const QString& password);
    Q_INVOKABLE void forgetCredentials();
    Q_INVOKABLE void pauseAutomation(int minutes = 10);
    Q_INVOKABLE void resumeAutomation();
    Q_INVOKABLE bool claimLoginAttempt(const QString& signature);
    Q_INVOKABLE bool claimStartReading(const QString& signature);
    Q_INVOKABLE void applyProbe(const QVariantMap& probe);
    Q_INVOKABLE void automationTimedOut();
    Q_INVOKABLE void navigationStarted(const QString& url);
    Q_INVOKABLE void navigationFailed(const QString& error);
    Q_INVOKABLE void surfaceClosed();

signals:
    void changed();
    void openRequested(const QString& url);
    void closeRequested();

private:
    void refreshConfiguration();
    void setState(const QString& state, const QString& status);
    void setGuardrail(int minutes, const QString& reason);
    void clearGuardrail();
    void markSessionReady(const QString& url, bool publication);
    qint64 blockedUntil() const;

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    bool m_automationAllowed = false;
    bool m_open = false;
    bool m_hasCredentials = false;
    bool m_manualMode = false;
    QString m_state = QStringLiteral("closed");
    QString m_status = QStringLiteral("PressReader ferme");
    qint64 m_sessionExpiresAt = 0;
    QSet<QString> m_loginAttempts;
    QSet<QString> m_startAttempts;
    QTimer m_clock;
};

} // namespace qtpanel
