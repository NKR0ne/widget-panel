#include "SystemTheme.h"

#include <QDebug>
#include <QSettings>
#include <QTimer>

#ifdef Q_OS_WIN
#include <windows.h>
#endif

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
#ifdef Q_OS_WIN
    HIGHCONTRASTW contrast{};
    contrast.cbSize = sizeof(contrast);
    const bool highContrast = SystemParametersInfoW(
        SPI_GETHIGHCONTRAST, sizeof(contrast), &contrast, 0)
        && (contrast.dwFlags & HCF_HIGHCONTRASTON);

    BOOL animationsEnabled = TRUE;
    if (!SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animationsEnabled, 0))
        animationsEnabled = TRUE;

    if (m_highContrast != highContrast
        || m_animationsEnabled != (animationsEnabled != FALSE)) {
        m_highContrast = highContrast;
        m_animationsEnabled = animationsEnabled != FALSE;
        emit appearanceChanged();
    }
#endif

    // Ahead of the accent read below, which bails out early on unreadable or
    // out-of-range values — personalization state must refresh regardless.
    refreshPersonalization();

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
        if (!m_startTint.isValid())
            m_startTint = c;
        emit accentChanged();
    }
}

void SystemTheme::refreshPersonalization()
{
    QSettings personalize(
        QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows"
                       "\\CurrentVersion\\Themes\\Personalize"),
        QSettings::NativeFormat);
    // Absent keys mean the shell default: transparency on, accent off surfaces.
    const bool transparency =
        personalize.value(QStringLiteral("EnableTransparency"), 1).toInt() != 0;
    const bool prevalence =
        personalize.value(QStringLiteral("ColorPrevalence"), 0).toInt() != 0;
    const bool light =
        personalize.value(QStringLiteral("AppsUseLightTheme"), 0).toInt() != 0;

    if (m_transparencyEnabled != transparency || m_accentOnSurfaces != prevalence
        || m_lightTheme != light) {
        m_transparencyEnabled = transparency;
        m_accentOnSurfaces = prevalence;
        m_lightTheme = light;
        qInfo() << "[theme] transparency" << transparency
                << "accentOnSurfaces" << prevalence << "lightTheme" << light;
        emit appearanceChanged();
    }

    // StartColorMenu is the shade the shell actually paints Start and the menu
    // surfaces with, which is what we want to tint against — it is already
    // darkened relative to the raw accent. Note the byte order differs from
    // DWM's ColorizationColor above: this key is ABGR, that one is ARGB.
    QSettings explorerAccent(
        QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows"
                       "\\CurrentVersion\\Explorer\\Accent"),
        QSettings::NativeFormat);
    bool startOk = false;
    const quint32 abgr =
        explorerAccent.value(QStringLiteral("StartColorMenu")).toUInt(&startOk);
    if (!startOk)
        return;
    const QColor start(static_cast<int>(abgr & 0xFFu),
                       static_cast<int>((abgr >> 8) & 0xFFu),
                       static_cast<int>((abgr >> 16) & 0xFFu));
    if (start.isValid() && start != m_startTint) {
        m_startTint = start;
        qInfo() << "[theme] start menu tint" << start.name();
        emit accentChanged();
    }
}

} // namespace qtpanel
