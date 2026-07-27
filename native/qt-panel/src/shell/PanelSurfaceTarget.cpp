#include "PanelSurfaceTarget.h"

#include "CompositionPanelHost.h"

#include <QGuiApplication>
#include <QQuickWindow>
#include <QScreen>

#include <windows.h>

// --- windowed path ----------------------------------------------------------

QQuickWindowTarget::QQuickWindowTarget(QQuickWindow* window) : m_window(window) {}

bool QQuickWindowTarget::isVisible() const { return m_window && m_window->isVisible(); }
int QQuickWindowTarget::x() const { return m_window ? m_window->x() : 0; }
int QQuickWindowTarget::width() const { return m_window ? m_window->width() : 0; }
void QQuickWindowTarget::setGeometry(const QRect& g) { if (m_window) m_window->setGeometry(g); }
void QQuickWindowTarget::setX(int x) { if (m_window) m_window->setX(x); }
void QQuickWindowTarget::setOpacity(qreal o) { if (m_window) m_window->setOpacity(o); }
void QQuickWindowTarget::show() { if (m_window) m_window->show(); }
void QQuickWindowTarget::hide() { if (m_window) m_window->hide(); }
void QQuickWindowTarget::raise() { if (m_window) m_window->raise(); }
void QQuickWindowTarget::requestActivate() { if (m_window) m_window->requestActivate(); }
bool QQuickWindowTarget::isActive() const { return m_window && m_window->isActive(); }
QScreen* QQuickWindowTarget::screen() const { return m_window ? m_window->screen() : nullptr; }
WId QQuickWindowTarget::winId() const { return m_window ? m_window->winId() : 0; }

// --- composition path -------------------------------------------------------

CompositionSurfaceTarget::CompositionSurfaceTarget(CompositionPanelHost* host) : m_host(host) {}

qreal CompositionSurfaceTarget::scaleFactor() const
{
    if (QScreen* s = screen())
        return s->devicePixelRatio();
    return 1.0;
}

bool CompositionSurfaceTarget::isVisible() const
{
    return m_host && m_host->hwnd() && IsWindowVisible(m_host->hwnd());
}

int CompositionSurfaceTarget::x() const
{
    if (!m_host || !m_host->hwnd()) return 0;
    RECT r{};
    GetWindowRect(m_host->hwnd(), &r);
    return qRound(r.left / scaleFactor());
}

int CompositionSurfaceTarget::width() const
{
    if (!m_host || !m_host->hwnd()) return 0;
    RECT r{};
    GetWindowRect(m_host->hwnd(), &r);
    return qRound((r.right - r.left) / scaleFactor());
}

void CompositionSurfaceTarget::setGeometry(const QRect& g)
{
    if (!m_host || !m_host->hwnd()) return;
    const qreal s = scaleFactor();
    SetWindowPos(m_host->hwnd(), nullptr,
                 qRound(g.x() * s), qRound(g.y() * s),
                 qRound(g.width() * s), qRound(g.height() * s),
                 SWP_NOZORDER | SWP_NOACTIVATE);
}

void CompositionSurfaceTarget::setX(int x)
{
    if (!m_host || !m_host->hwnd()) return;
    // Y must be carried over. SWP_NOSIZE preserves the size but NOT the
    // position, so passing 0 here moved the window to the top of the screen on
    // every call -- and the slide calls this once per frame, so the panel
    // walked to y=0 as it animated. It also changed the material: acrylic
    // samples the desktop behind the window, so a window that has moved is
    // sampling different content and comes back a different tone.
    RECT r{};
    GetWindowRect(m_host->hwnd(), &r);
    SetWindowPos(m_host->hwnd(), nullptr, qRound(x * scaleFactor()), r.top, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

void CompositionSurfaceTarget::setOpacity(qreal o)
{
    // Not SetLayeredWindowAttributes: a layered window has a redirection
    // surface, which is the opposite of what WS_EX_NOREDIRECTIONBITMAP asks
    // for, and the two do not combine. Opacity belongs on the composition root
    // visual, where it also composites correctly against the acrylic behind it.
    if (m_host) m_host->setRootOpacity(static_cast<float>(o));
}

void CompositionSurfaceTarget::show()
{
    if (m_host && m_host->hwnd()) ShowWindow(m_host->hwnd(), SW_SHOWNOACTIVATE);
}

void CompositionSurfaceTarget::hide()
{
    if (m_host && m_host->hwnd()) ShowWindow(m_host->hwnd(), SW_HIDE);
}

void CompositionSurfaceTarget::raise()
{
    if (!m_host || !m_host->hwnd()) return;
    SetWindowPos(m_host->hwnd(), HWND_TOPMOST, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

void CompositionSurfaceTarget::requestActivate()
{
    if (m_host && m_host->hwnd()) SetForegroundWindow(m_host->hwnd());
}

bool CompositionSurfaceTarget::isActive() const
{
    return m_host && m_host->hwnd() && GetForegroundWindow() == m_host->hwnd();
}

QScreen* CompositionSurfaceTarget::screen() const
{
    if (m_host && m_host->hwnd()) {
        RECT r{};
        GetWindowRect(m_host->hwnd(), &r);
        // Physical centre; screenAt takes logical coordinates, so this is only
        // reliable once there is a primary-screen ratio to divide by. Falling
        // back to the primary screen is correct for the single-monitor case and
        // honest about the multi-monitor one.
        if (QScreen* primary = QGuiApplication::primaryScreen()) {
            const qreal s = primary->devicePixelRatio();
            const QPoint centre(qRound((r.left + r.right) / 2.0 / s),
                                qRound((r.top + r.bottom) / 2.0 / s));
            if (QScreen* at = QGuiApplication::screenAt(centre)) return at;
            return primary;
        }
    }
    return QGuiApplication::primaryScreen();
}

WId CompositionSurfaceTarget::winId() const
{
    return m_host ? reinterpret_cast<WId>(m_host->hwnd()) : 0;
}

QQuickWindow* CompositionSurfaceTarget::quickWindow() const
{
    return m_host ? m_host->quickWindow() : nullptr;
}
