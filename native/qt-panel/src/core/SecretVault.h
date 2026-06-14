#pragma once

#include <QObject>
#include <QString>

namespace qtpanel {

class SettingsStore;

// Secrets in the Windows Credential Manager instead of plaintext settings.json.
// Targets are namespaced "qt-panel:<key>", stored as CRED_TYPE_GENERIC for the
// current user. This is the §2.6 hardening over the Electron app, which kept
// API keys and passwords in the electron-store JSON. Exposed to QML as the
// "Vault" singleton so the settings UI can read/write API keys.
class SecretVault : public QObject {
    Q_OBJECT
public:
    Q_INVOKABLE QString get(const QString& key) const;
    Q_INVOKABLE void set(const QString& key, const QString& value);
    Q_INVOKABLE void remove(const QString& key);
    Q_INVOKABLE bool has(const QString& key) const;

    // One-time move of a secret from the settings store into the vault, then
    // clear it from settings. No-op if already migrated. Returns true if a
    // value is now available in the vault.
    bool migrateFromSettings(SettingsStore* settings, const QString& settingsKey,
                             const QString& vaultKey);

signals:
    void changed(const QString& key);
};

} // namespace qtpanel
