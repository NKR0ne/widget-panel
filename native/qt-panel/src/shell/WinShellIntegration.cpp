#include "WinShellIntegration.h"

#include <QDebug>
#include <QWindow>

#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <dwmapi.h>
#include <uxtheme.h>

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif
#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif
#ifndef DWMWA_SYSTEMBACKDROP_TYPE
#define DWMWA_SYSTEMBACKDROP_TYPE 38
#endif

namespace {
constexpr int kCornerRound = 2;     // DWMWCP_ROUND
constexpr int kBackdropAcrylic = 3; // DWMSBT_TRANSIENTWINDOW
} // namespace

namespace qtpanel {

void WinShellIntegration::applyPanelChrome(QWindow* window)
{
    if (!window)
        return;
    const HWND hwnd = reinterpret_cast<HWND>(window->winId());
    if (!hwnd)
        return;

    // Defensive: Qt::Tool normally sets this, but the panel must never get a
    // taskbar button regardless of how the window flags evolve.
    const LONG_PTR exStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW);

    // Backdrop only shows through where the frame is extended into the client
    // area and the swapchain clears to transparent.
    const MARGINS margins{-1, -1, -1, -1};
    DwmExtendFrameIntoClientArea(hwnd, &margins);

    BOOL dark = TRUE;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));

    int corner = kCornerRound;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner, sizeof(corner));

    int backdrop = kBackdropAcrylic;
    const HRESULT hr = DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof(backdrop));
    if (FAILED(hr))
        qWarning() << "[shell] acrylic system backdrop unavailable, hr =" << hr;
    else
        qInfo() << "[shell] acrylic backdrop + rounded corners applied";
}

} // namespace qtpanel
