#pragma once

#include <QColor>
#include <QObject>

namespace qtpanel {

// Exposes the Windows accent color to QML so the theme can match the OS, like
// the Electron app's system-accent-color integration. Polls lightly for live
// updates when the user changes their accent.
class SystemTheme : public QObject {
    Q_OBJECT
    Q_PROPERTY(QColor accent READ accent NOTIFY accentChanged)
    Q_PROPERTY(bool highContrast READ highContrast NOTIFY appearanceChanged)
    Q_PROPERTY(bool animationsEnabled READ animationsEnabled NOTIFY appearanceChanged)

public:
    explicit SystemTheme(QObject* parent = nullptr);

    QColor accent() const { return m_accent; }
    bool highContrast() const { return m_highContrast; }
    bool animationsEnabled() const { return m_animationsEnabled; }

signals:
    void accentChanged();
    void appearanceChanged();

private:
    void refresh();
    QColor m_accent;
    bool m_highContrast = false;
    bool m_animationsEnabled = true;
};

} // namespace qtpanel
