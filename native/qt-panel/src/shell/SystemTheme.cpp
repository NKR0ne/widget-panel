#include "SystemTheme.h"

#include <QSettings>
#include <QTimer>

namespace qtpanel {

SystemTheme::SystemTheme(QObject* parent)
    : QObject(parent)
    , m_accent(QColor(0x4f, 0x8e, 0xf7)) // fallback = the app's default blue
{
    refresh();
    auto* timer = new QTimer(this);
    timer->setInterval(5000);
    connect(timer, &QTimer::timeout, this, &SystemTheme::refresh);
    timer->start();
}

void SystemTheme::refresh()
{
    // HKCU\Software\Microsoft\Windows\DWM\ColorizationColor is 0xAARRGGBB.
    QSettings dwm(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\DWM"),
                  QSettings::NativeFormat);
    bool ok = false;
    const quint32 argb = dwm.value(QStringLiteral("ColorizationColor")).toUInt(&ok);
    if (!ok)
        return;
    QColor c = QColor::fromRgb(argb | 0xFF000000u); // force opaque
    // Reject near-black/near-white that would wash out on the dark panel.
    const int lightness = c.lightness();
    if (lightness < 40 || lightness > 230)
        return;
    if (c != m_accent) {
        m_accent = c;
        emit accentChanged();
    }
}

} // namespace qtpanel
