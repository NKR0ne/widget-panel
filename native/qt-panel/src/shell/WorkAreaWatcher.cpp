#include "WorkAreaWatcher.h"

#include <QGuiApplication>

namespace qtpanel {

WorkAreaWatcher::WorkAreaWatcher(QObject* parent)
    : QObject(parent)
{
    connect(qGuiApp, &QGuiApplication::primaryScreenChanged, this, [this](QScreen* screen) {
        watchScreen(screen);
        emit workAreaChanged(workArea());
    });
    watchScreen(QGuiApplication::primaryScreen());
}

QRect WorkAreaWatcher::workArea() const
{
    const QScreen* screen = QGuiApplication::primaryScreen();
    return screen ? screen->availableGeometry() : QRect(0, 0, 1920, 1080);
}

void WorkAreaWatcher::watchScreen(QScreen* screen)
{
    if (m_watched)
        disconnect(m_watched, nullptr, this, nullptr);
    m_watched = screen;
    if (screen) {
        connect(screen, &QScreen::availableGeometryChanged, this, [this](const QRect& area) {
            emit workAreaChanged(area);
        });
    }
}

} // namespace qtpanel
