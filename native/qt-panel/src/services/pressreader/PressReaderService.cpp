#include "PressReaderService.h"

#include "core/SecretVault.h"
#include "core/SettingsStore.h"

#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QUrl>

namespace qtpanel {

namespace {
constexpr qint64 kSessionDurationMs = 48LL * 60 * 60 * 1000;
}

PressReaderService::PressReaderService(SettingsStore* settings, SecretVault* vault,
                                       bool automationAllowed, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_automationAllowed(automationAllowed)
{
    refreshConfiguration();
    if (m_settings) {
        connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
            if (key.startsWith(QLatin1String("wp-pressreader-")))
                refreshConfiguration();
        });
    }
    if (m_vault) {
        connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
            if (key == QLatin1String("pressreader-user")
                || key == QLatin1String("pressreader-password")) {
                m_loginAttempts.clear();
                refreshConfiguration();
            }
        });
    }
    m_clock.setInterval(30000);
    connect(&m_clock, &QTimer::timeout, this, [this] {
        const qint64 now = QDateTime::currentMSecsSinceEpoch();
        const qint64 guardrailEnd = blockedUntil();
        if (guardrailEnd > 0 && guardrailEnd <= now)
            clearGuardrail();
        if (m_open && m_sessionExpiresAt > 0 && m_sessionExpiresAt <= now
            && (m_state == QLatin1String("catalog-ready")
                || m_state == QLatin1String("publication-ready"))) {
            setState(QStringLiteral("session-expired"),
                     QStringLiteral("Acces de 48 h expire - reconnexion requise"));
        }
        emit changed();
    });
    m_clock.start();
}

QString PressReaderService::defaultEntryUrl()
{
    return QStringLiteral("https://ezproxy.bibliothequedequebec.qc.ca/login?url="
                          "https%3A%2F%2Fwww.pressreader.com");
}

QString PressReaderService::entryUrl() const
{
    if (!m_settings)
        return defaultEntryUrl();
    const QString configured = m_settings->get(
        QStringLiteral("wp-pressreader-url"), defaultEntryUrl()).toString().trimmed();
    return configured.isEmpty() ? defaultEntryUrl() : configured;
}

bool PressReaderService::automationBlocked() const
{
    return blockedUntil() > QDateTime::currentMSecsSinceEpoch();
}

int PressReaderService::sessionRemainingMinutes() const
{
    const qint64 remaining = m_sessionExpiresAt - QDateTime::currentMSecsSinceEpoch();
    return remaining <= 0 ? 0 : static_cast<int>((remaining + 59999) / 60000);
}

void PressReaderService::toggle()
{
    if (m_open)
        close();
    else
        openCatalog();
}

void PressReaderService::openCatalog()
{
    m_open = true;
    m_manualMode = false;
    m_loginAttempts.clear();
    m_startAttempts.clear();
    setState(QStringLiteral("opening"),
             m_automationAllowed ? QStringLiteral("Ouverture de PressReader")
                                 : QStringLiteral("Ouverture sans connexion automatique"));
    emit openRequested(entryUrl());
}

void PressReaderService::openManual()
{
    m_open = true;
    m_manualMode = true;
    setState(QStringLiteral("manual"), QStringLiteral("Connexion manuelle"));
    emit openRequested(entryUrl());
}

void PressReaderService::close()
{
    if (!m_open)
        return;
    emit closeRequested();
    surfaceClosed();
}

void PressReaderService::showCredentials()
{
    m_manualMode = false;
    setState(QStringLiteral("credentials-required"),
             QStringLiteral("Identifiants de bibliotheque requis"));
}

void PressReaderService::saveCredentials(const QString& user, const QString& password)
{
    const QString trimmedUser = user.trimmed();
    if (!m_vault || trimmedUser.isEmpty() || password.isEmpty()) {
        setState(QStringLiteral("credentials-required"),
                 QStringLiteral("Numero d'usager et mot de passe requis"));
        return;
    }
    m_vault->set(QStringLiteral("pressreader-user"), trimmedUser);
    m_vault->set(QStringLiteral("pressreader-password"), password);
    clearGuardrail();
    m_loginAttempts.clear();
    m_manualMode = false;
    refreshConfiguration();
    openCatalog();
}

void PressReaderService::forgetCredentials()
{
    if (m_vault) {
        m_vault->remove(QStringLiteral("pressreader-user"));
        m_vault->remove(QStringLiteral("pressreader-password"));
    }
    if (m_settings) {
        m_settings->remove(QStringLiteral("wp-pressreader-session-expires-at"));
        m_settings->remove(QStringLiteral("wp-pressreader-last-url"));
    }
    clearGuardrail();
    m_loginAttempts.clear();
    m_startAttempts.clear();
    m_sessionExpiresAt = 0;
    m_manualMode = false;
    refreshConfiguration();
    setState(QStringLiteral("credentials-required"),
             QStringLiteral("Identifiants PressReader effaces"));
}

void PressReaderService::pauseAutomation(int minutes)
{
    setGuardrail(qMax(1, minutes), QStringLiteral("manual pause"));
    setState(QStringLiteral("paused"), QStringLiteral("Connexion automatique en pause"));
}

void PressReaderService::resumeAutomation()
{
    clearGuardrail();
    m_manualMode = false;
    m_loginAttempts.clear();
    m_startAttempts.clear();
    setState(QStringLiteral("opening"), QStringLiteral("Connexion automatique active"));
}

bool PressReaderService::claimLoginAttempt(const QString& signature)
{
    const QString key = signature.trimmed();
    refreshConfiguration();
    if (!m_open || !m_automationAllowed || m_manualMode || automationBlocked()
        || !m_hasCredentials || key.isEmpty() || m_loginAttempts.contains(key))
        return false;
    m_loginAttempts.insert(key);
    setState(QStringLiteral("signing-in"), QStringLiteral("Connexion a la bibliotheque"));
    return true;
}

bool PressReaderService::claimStartReading(const QString& signature)
{
    const QString key = signature.trimmed();
    if (!m_open || m_manualMode || key.isEmpty() || m_startAttempts.contains(key))
        return false;
    m_startAttempts.insert(key);
    return true;
}

void PressReaderService::applyProbe(const QVariantMap& probe)
{
    if (!m_open)
        return;
    if (probe.value(QStringLiteral("authRejected")).toBool()) {
        setGuardrail(120, QStringLiteral("saved login rejected"));
        setState(QStringLiteral("rejected"),
                 QStringLiteral("Identifiants rejetes - aucune nouvelle tentative"));
        return;
    }
    const QString url = probe.value(QStringLiteral("url")).toString();
    if (probe.value(QStringLiteral("publication")).toBool()) {
        markSessionReady(url, true);
        return;
    }
    if (probe.value(QStringLiteral("hasSessionEvidence")).toBool()) {
        markSessionReady(url, false);
        return;
    }
    if (probe.value(QStringLiteral("hasLogin")).toBool()) {
        if (m_manualMode) {
            setState(QStringLiteral("manual"), QStringLiteral("Connexion manuelle"));
        } else if (!m_automationAllowed) {
            setState(QStringLiteral("manual"),
                     QStringLiteral("Connexion automatique desactivee pour ce profil"));
        } else if (automationBlocked()) {
            setState(QStringLiteral("paused"),
                     QStringLiteral("Connexion automatique suspendue"));
        } else if (!m_hasCredentials) {
            setState(QStringLiteral("credentials-required"),
                     QStringLiteral("Identifiants de bibliotheque requis"));
        }
        return;
    }
    if (m_state != QLatin1String("signing-in"))
        setState(QStringLiteral("opening"), QStringLiteral("Preparation de PressReader"));
}

void PressReaderService::automationTimedOut()
{
    if (!m_open || m_state != QLatin1String("signing-in"))
        return;
    setState(QStringLiteral("credentials-required"),
             QStringLiteral("Connexion sans reponse - verifier les identifiants"));
}

void PressReaderService::navigationStarted(const QString& url)
{
    if (!m_open)
        return;
    if (!url.isEmpty() && m_state != QLatin1String("signing-in"))
        setState(QStringLiteral("opening"), QStringLiteral("Chargement de PressReader"));
}

void PressReaderService::navigationFailed(const QString& error)
{
    if (!m_open)
        return;
    setState(QStringLiteral("offline"),
             error.isEmpty() ? QStringLiteral("PressReader indisponible") : error.left(180));
}

void PressReaderService::surfaceClosed()
{
    if (!m_open && m_state == QLatin1String("closed"))
        return;
    m_open = false;
    m_manualMode = false;
    m_loginAttempts.clear();
    m_startAttempts.clear();
    setState(QStringLiteral("closed"), QStringLiteral("PressReader ferme"));
}

void PressReaderService::refreshConfiguration()
{
    const bool hasCredentials = m_vault
        && m_vault->has(QStringLiteral("pressreader-user"))
        && m_vault->has(QStringLiteral("pressreader-password"));
    const qint64 expiresAt = m_settings
        ? m_settings->get(QStringLiteral("wp-pressreader-session-expires-at"), 0).toLongLong()
        : 0;
    const bool changedValue = hasCredentials != m_hasCredentials
        || expiresAt != m_sessionExpiresAt;
    m_hasCredentials = hasCredentials;
    m_sessionExpiresAt = expiresAt;
    if (changedValue)
        emit changed();
}

void PressReaderService::setState(const QString& state, const QString& status)
{
    if (m_state == state && m_status == status) {
        emit changed();
        return;
    }
    m_state = state;
    m_status = status;
    emit changed();
}

void PressReaderService::setGuardrail(int minutes, const QString& reason)
{
    if (!m_settings)
        return;
    const QJsonObject guardrail{
        {QStringLiteral("blockedUntil"),
         static_cast<double>(QDateTime::currentMSecsSinceEpoch()
                             + static_cast<qint64>(minutes) * 60000)},
        {QStringLiteral("reason"), reason},
    };
    m_settings->set(QStringLiteral("wp-pressreader-guardrail"),
                    QString::fromUtf8(QJsonDocument(guardrail).toJson(QJsonDocument::Compact)));
    emit changed();
}

void PressReaderService::clearGuardrail()
{
    if (m_settings && blockedUntil() != 0) {
        m_settings->set(QStringLiteral("wp-pressreader-guardrail"),
                        QStringLiteral("{\"blockedUntil\":0,\"reason\":\"\"}"));
    }
    emit changed();
}

void PressReaderService::markSessionReady(const QString& url, bool publication)
{
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (m_sessionExpiresAt < now + 60 * 60 * 1000) {
        m_sessionExpiresAt = now + kSessionDurationMs;
        if (m_settings)
            m_settings->set(QStringLiteral("wp-pressreader-session-expires-at"), m_sessionExpiresAt);
    }
    if (m_settings && !url.isEmpty()) {
        const QUrl parsed(url);
        if (parsed.host().contains(QLatin1String("pressreader.com"), Qt::CaseInsensitive))
            m_settings->set(QStringLiteral("wp-pressreader-last-url"), url);
    }
    clearGuardrail();
    setState(publication ? QStringLiteral("publication-ready")
                         : QStringLiteral("catalog-ready"),
             publication ? QStringLiteral("Publication prete")
                         : QStringLiteral("Session PressReader active"));
}

qint64 PressReaderService::blockedUntil() const
{
    if (!m_settings)
        return 0;
    const QVariant raw = m_settings->get(QStringLiteral("wp-pressreader-guardrail"),
                                         QStringLiteral("{}"));
    QJsonObject guardrail;
    if (raw.canConvert<QVariantMap>())
        guardrail = QJsonObject::fromVariantMap(raw.toMap());
    if (guardrail.isEmpty())
        guardrail = QJsonDocument::fromJson(raw.toString().toUtf8()).object();
    return static_cast<qint64>(
        guardrail.value(QStringLiteral("blockedUntil")).toDouble());
}

} // namespace qtpanel
