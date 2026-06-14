#pragma once

#include <QObject>
#include <QPointer>
#include <QRect>
#include <QScreen>

namespace qtpanel {

// Tracks the primary monitor's work area (taskbar-safe region) across
// resolution, DPI, and primary-screen changes.
class WorkAreaWatcher : public QObject {
    Q_OBJECT

public:
    explicit WorkAreaWatcher(QObject* parent = nullptr);

    QRect workArea() const;

signals:
    void workAreaChanged(const QRect& area);

private:
    void watchScreen(QScreen* screen);

    QPointer<QScreen> m_watched;
};

} // namespace qtpanel
