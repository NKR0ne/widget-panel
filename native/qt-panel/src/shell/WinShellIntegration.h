#pragma once

class QWindow;

namespace qtpanel {

// Win32/DWM chrome for the panel window: system backdrop, dark mode, rounded
// corners, and tool-window (taskbar-skipping) style — the native equivalent of
// Electron's backgroundMaterial + skipTaskbar.
//
// Two materials are supported. Mica (DWMSBT_MAINWINDOW) samples the wallpaper
// once and heavily desaturates it, which suits a docked, always-on surface
// carrying dense text. Acrylic (DWMSBT_TRANSIENTWINDOW) live-blurs whatever is
// behind the window; it looks livelier but lets arbitrary desktop content
// change the contrast under body copy.
class WinShellIntegration {
public:
    // transparency mirrors the system "Transparency effects" preference; when
    // it is off both materials give way to a solid backdrop.
    static void applyPanelChrome(QWindow* window, bool mica = true, bool transparency = true);
    // Swap the backdrop at runtime so the materials can be compared from
    // settings, and so the system preference can be followed live.
    static void setBackdropMaterial(QWindow* window, bool mica, bool transparency);
};

} // namespace qtpanel
