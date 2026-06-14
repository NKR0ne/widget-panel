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

public:
    explicit SystemTheme(QObject* parent = nullptr);

    QColor accent() const { return m_accent; }

signals:
    void accentChanged();

private:
    void refresh();
    QColor m_accent;
};

} // namespace qtpanel
