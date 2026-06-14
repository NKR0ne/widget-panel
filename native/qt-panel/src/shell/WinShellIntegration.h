#pragma once

class QWindow;

namespace qtpanel {

// Win32/DWM chrome for the panel window: acrylic system backdrop, dark mode,
// rounded corners, and tool-window (taskbar-skipping) style — the native
// equivalent of Electron's backgroundMaterial:'acrylic' + skipTaskbar.
class WinShellIntegration {
public:
    static void applyPanelChrome(QWindow* window);
};

} // namespace qtpanel
