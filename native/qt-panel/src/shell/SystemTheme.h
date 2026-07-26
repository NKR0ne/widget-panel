#pragma once

#include <QColor>
#include <QObject>
#include <QVariantList>

namespace qtpanel {

// Exposes the Windows personalization state to QML so the panel can behave the
// way the shell's own surfaces do.
//
// There is no public API that hands an app the Start menu's material, and
// WinUI's AcrylicBrush is not reachable from Qt. What is reachable is the same
// state Start reads, so the panel can be driven from it: the accent shade the
// shell uses for menu surfaces, whether the user asked for accent on those
// surfaces at all, and whether transparency effects are enabled system-wide.
//
// Polls lightly rather than listening for WM_SETTINGCHANGE; a few seconds of
// latency on a personalization change is not worth a message hook.
class SystemTheme : public QObject {
    Q_OBJECT
    Q_PROPERTY(QColor accent READ accent NOTIFY accentChanged)
    Q_PROPERTY(QColor startTint READ startTint NOTIFY accentChanged)
    // The shell's own accent ramp, lightest to darkest: indices 0-2 are the
    // light variants, 3 is the base accent (AccentColorMenu), 4-6 the dark
    // variants (4 is StartColorMenu), 7 a complement. Using these instead of
    // deriving our own shades is what keeps highlights matching the shell.
    Q_PROPERTY(QVariantList accentPalette READ accentPalette NOTIFY accentChanged)
    Q_PROPERTY(bool highContrast READ highContrast NOTIFY appearanceChanged)
    Q_PROPERTY(bool animationsEnabled READ animationsEnabled NOTIFY appearanceChanged)
    // Settings > Personalization > Colors > Transparency effects. When the user
    // turns this off the shell drops acrylic and mica to solid, and so must we.
    Q_PROPERTY(bool transparencyEnabled READ transparencyEnabled NOTIFY appearanceChanged)
    // "Show accent color on Start and taskbar" (ColorPrevalence). When on, the
    // shell tints its surfaces with the accent instead of a neutral.
    Q_PROPERTY(bool accentOnSurfaces READ accentOnSurfaces NOTIFY appearanceChanged)
    // Reported for completeness; the panel is dark-only today.
    Q_PROPERTY(bool lightTheme READ lightTheme NOTIFY appearanceChanged)

public:
    explicit SystemTheme(QObject* parent = nullptr);

    QColor accent() const { return m_accent; }
    QColor startTint() const { return m_startTint; }
    QVariantList accentPalette() const { return m_accentPalette; }
    bool highContrast() const { return m_highContrast; }
    bool animationsEnabled() const { return m_animationsEnabled; }
    bool transparencyEnabled() const { return m_transparencyEnabled; }
    bool accentOnSurfaces() const { return m_accentOnSurfaces; }
    bool lightTheme() const { return m_lightTheme; }

signals:
    void accentChanged();
    void appearanceChanged();

private:
    void refresh();
    void refreshPersonalization();

    QColor m_accent;
    QColor m_startTint;
    QVariantList m_accentPalette;
    bool m_highContrast = false;
    bool m_animationsEnabled = true;
    bool m_transparencyEnabled = true;
    bool m_accentOnSurfaces = false;
    bool m_lightTheme = false;
};

} // namespace qtpanel
