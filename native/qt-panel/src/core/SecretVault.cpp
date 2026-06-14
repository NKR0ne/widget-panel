#include "SecretVault.h"

#include "SettingsStore.h"

#include <QDebug>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincred.h>

namespace qtpanel {

namespace {
std::wstring targetName(const QString& key)
{
    return (QStringLiteral("qt-panel:") + key).toStdWString();
}
} // namespace

QString SecretVault::get(const QString& key) const
{
    PCREDENTIALW cred = nullptr;
    const std::wstring target = targetName(key);
    if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &cred))
        return {};
    QString value;
    if (cred->CredentialBlob && cred->CredentialBlobSize > 0) {
        value = QString::fromUtf8(reinterpret_cast<const char*>(cred->CredentialBlob),
                                  static_cast<int>(cred->CredentialBlobSize));
    }
    CredFree(cred);
    return value;
}

bool SecretVault::has(const QString& key) const
{
    PCREDENTIALW cred = nullptr;
    const std::wstring target = targetName(key);
    if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &cred))
        return false;
    CredFree(cred);
    return true;
}

void SecretVault::set(const QString& key, const QString& value)
{
    const std::wstring target = targetName(key);
    const QByteArray blob = value.toUtf8();

    CREDENTIALW cred{};
    cred.Type = CRED_TYPE_GENERIC;
    cred.TargetName = const_cast<LPWSTR>(target.c_str());
    cred.CredentialBlobSize = static_cast<DWORD>(blob.size());
    cred.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char*>(blob.constData()));
    cred.Persist = CRED_PERSIST_LOCAL_MACHINE;

    if (!CredWriteW(&cred, 0))
        qWarning() << "[vault] CredWrite failed for" << key << "err" << GetLastError();
    emit changed(key);
}

void SecretVault::remove(const QString& key)
{
    const std::wstring target = targetName(key);
    CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0);
    emit changed(key);
}

bool SecretVault::migrateFromSettings(SettingsStore* settings, const QString& settingsKey,
                                      const QString& vaultKey)
{
    const QString existing = settings->get(settingsKey).toString();
    if (!existing.isEmpty()) {
        set(vaultKey, existing);
        settings->remove(settingsKey);
        qInfo() << "[vault] migrated" << settingsKey << "→ Credential Manager";
        return true;
    }
    return has(vaultKey);
}

} // namespace qtpanel
