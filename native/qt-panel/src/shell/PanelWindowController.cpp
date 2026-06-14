#include "PanelWindowController.h"

#include "BraveHostClient.h"
#include "HelperServer.h"
#include "WinShellIntegration.h"
#include "core/SettingsStore.h"

#include <QCoreApplication>
#include <QCursor>
#include <QDateTime>
#include <QDebug>
#include <QDir>
#include <QHash>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSettings>

namespace qtpanel {

PanelWindowController::PanelWindowController(SettingsStore* settings, HelperServer* helper,
                                             BraveHostClient* brave, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_helper(helper)
    , m_brave(brave)
{
    m_hideFallback.setSingleShot(true);
    connect(&m_hideFallback, &QTimer::timeout, this, &PanelWindowController::completeHide);

    m_resizeTimer.setInterval(16);
    connect(&m_resizeTimer, &QTimer::timeout, this, &PanelWindowController::onResizeTick);

    // Electron delays the helper state notify 350ms after show so the strip's
    // WM_LBUTTONDOWN passes through the hook before g_panelOn flips.
    m_helperStateDelay.setSingleShot(true);
    m_helperStateDelay.setInterval(350);
    connect(&m_helperStateDelay, &QTimer::timeout, this, [this] {
        if (m_helper && m_window && m_window->isVisible()) {
            m_helper->sendState(true);
            notifyHelperHwnds();
        }
    });
}

void PanelWindowController::attach(QQuickWindow* window)
{
    m_window = window;
    window->setFlags(Qt::FramelessWindowHint | Qt::Tool | Qt::WindowStaysOnTopHint);
    window->setColor(Qt::transparent);
    applyWorkArea();
    WinShellIntegration::applyPanelChrome(window);

    connect(window, &QWindow::activeChanged, this, &PanelWindowController::onActiveChanged);
    connect(window, &QQuickWindow::sceneGraphInitialized,
            this, &PanelWindowController::resolveGraphicsApiName, Qt::QueuedConnection);
    connect(&m_workArea, &WorkAreaWatcher::workAreaChanged, this, [this] { applyWorkArea(); });

    if (m_helper) {
        connect(m_helper, &HelperServer::toggleRequested, this, &PanelWindowController::togglePanel);
        connect(m_helper, &HelperServer::clickOutside, this, &PanelWindowController::onClickOutside);
        connect(m_helper, &HelperServer::helperReady, this, [this] {
            m_helper->sendState(m_window && m_window->isVisible());
            notifyHelperHwnds();
        });
        connect(m_helper, &HelperServer::clientConnected, this, [this] {
            m_helper->sendState(m_window && m_window->isVisible());
        });
    }

    m_pinned = m_settings->get(QStringLiteral("wp-pinned"), false).toBool();
    emit pinnedChanged();
}

void PanelWindowController::showPanel()
{
    if (!m_window || m_window->isVisible() || m_showAnimating)
        return;
    m_showAnimating = true;
    m_hiding = false;
    m_hideFallback.stop();
    m_focus.noteToggle();

    m_window->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    applyWorkArea();
    m_window->show();
    m_window->raise();
    if (!m_pinned) {
        QTimer::singleShot(150, this, [this] {
            if (m_window && m_window->isVisible())
                m_window->requestActivate();
        });
    }
    emit slideInRequested();
    setPanelVisibleState(true);
    QTimer::singleShot(kSlideMs, this, [this] { m_showAnimating = false; });
    m_helperStateDelay.start();
}

void PanelWindowController::hidePanel(bool force)
{
    if (!m_window || !m_window->isVisible() || m_hiding)
        return;
    if (!force && QDateTime::currentMSecsSinceEpoch() < m_geometryLockUntil) {
        qInfo() << "[panel] geometry lock — skip hide";
        return;
    }
    if (m_islandOpen)
        closeIsland();
    m_hiding = true;
    m_helperStateDelay.stop();
    m_focus.resetModal();
    emit slideOutRequested();
    m_hideFallback.start(kSlideMs + 160);
}

void PanelWindowController::hideAnimationDone()
{
    completeHide();
}

void PanelWindowController::completeHide()
{
    if (!m_hiding)
        return;
    m_hiding = false;
    m_hideFallback.stop();
    if (!m_window)
        return;
    m_window->hide();
    m_window->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    if (m_helper)
        m_helper->sendState(false);
    setPanelVisibleState(false);
}

void PanelWindowController::togglePanel()
{
    if (!m_window)
        return;
    m_focus.noteToggle();
    if (m_window->isVisible())
        hidePanel();
    else
        showPanel();
}

void PanelWindowController::togglePin()
{
    m_pinned = !m_pinned;
    m_settings->set(QStringLiteral("wp-pinned"), m_pinned);
    if (m_window && m_window->isVisible())
        m_window->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    emit pinnedChanged();
    notifyHelperHwnds();
}

void PanelWindowController::setModalOpen(bool open)
{
    if (open)
        m_focus.noteModalOpened();
    else
        m_focus.noteModalClosed();
}

void PanelWindowController::onActiveChanged()
{
    if (!m_window || m_window->isActive())
        return;
    if (m_pinned || !m_window->isVisible() || m_hiding || m_islandOpen)
        return;
    if (!m_focus.blurMayHide())
        return;
    QTimer::singleShot(FocusPolicy::kRecheckDelayMs, this, [this] {
        if (!m_window || !m_window->isVisible() || m_pinned || m_hiding)
            return;
        if (m_window->isActive())
            return;
        if (!m_focus.delayedCheckAllowsHide())
            return;
        hidePanel();
    });
}

void PanelWindowController::onClickOutside()
{
    if (m_pinned)
        return;
    QTimer::singleShot(FocusPolicy::kRecheckDelayMs, this, [this] {
        if (!m_window || !m_window->isVisible() || m_pinned || m_hiding)
            return;
        if (!m_focus.delayedCheckAllowsHide())
            return;
        hidePanel();
    });
}

void PanelWindowController::startResize()
{
    if (!m_window || m_resizeTimer.isActive())
        return;
    m_resizeStartX = QCursor::pos().x();
    m_resizeStartW = m_window->width();
    m_resizeTimer.start();
}

void PanelWindowController::onResizeTick()
{
    if (!m_window) {
        m_resizeTimer.stop();
        return;
    }
    const QRect wa = m_workArea.workArea();
    const int newW = qBound(kMinPanelWidth,
                            m_resizeStartW + (QCursor::pos().x() - m_resizeStartX),
                            wa.width() - 40);
    m_window->setGeometry(wa.x() + kPanelGap, wa.y() + kPanelGap,
                          newW, wa.height() - kPanelGap * 2);
}

void PanelWindowController::endResize()
{
    if (!m_resizeTimer.isActive())
        return;
    m_resizeTimer.stop();
    if (m_window)
        m_settings->set(QStringLiteral("wp-width"), m_window->width());
}

void PanelWindowController::fitMode(const QString& mode, int baseColumnCount, const QVariantMap& colWidths)
{
    if (!m_window)
        return;
    const bool stage = mode != QLatin1String("base");
    const int width = stage ? fullPanelWidth() : basePanelWidth(baseColumnCount, colWidths);
    m_geometryLockUntil = QDateTime::currentMSecsSinceEpoch() + 700;
    if (!stage)
        m_settings->set(QStringLiteral("wp-width"), width);
    const QRect wa = m_workArea.workArea();
    m_window->setGeometry(wa.x() + kPanelGap, wa.y() + kPanelGap,
                          width, wa.height() - kPanelGap * 2);
    m_focus.noteToggle();
    notifyHelperHwnds();
    qInfo() << "[panel] fit-mode" << mode << "stage=" << stage << "width=" << width;
}

void PanelWindowController::openIsland(const QString& url)
{
    if (!m_window || url.trimmed().isEmpty() || !m_brave)
        return;
    const QRect wa = m_workArea.workArea();
    const qreal sf = m_window->devicePixelRatio();
    constexpr int kBraveMargin = 8;
    constexpr int kToolbarH = 42; // matches the in-panel island toolbar height

    const int panelW = m_islandOpen ? m_islandPanelWidth : m_window->width();
    if (!m_islandOpen)
        m_islandPanelWidth = panelW;
    const int panelScreenRight = wa.x() + kPanelGap + panelW;
    const int braveW = wa.x() + wa.width() - panelScreenRight - kPanelGap;
    if (braveW < 240) {
        qWarning() << "[island] not enough room beside the panel (" << braveW << "px )";
        return;
    }
    const int height = wa.height() - kPanelGap * 2;

    m_focus.noteBrowserOpened();
    m_geometryLockUntil = QDateTime::currentMSecsSinceEpoch() + 700;
    m_window->setGeometry(wa.x() + kPanelGap, wa.y() + kPanelGap, panelW + braveW, height);
    // Drop topmost while embedded: the brave shell sets itself HWND_TOPMOST
    // after the reparent and must win z-order over the panel.
    m_window->setFlag(Qt::WindowStaysOnTopHint, false);

    m_islandOpen = true;
    m_islandUrl = url;
    emit islandChanged();

    m_brave->open(url,
                  qRound((panelScreenRight + kBraveMargin) * sf),
                  qRound((wa.y() + kPanelGap + kToolbarH) * sf),
                  qRound((braveW - kBraveMargin * 2) * sf),
                  qRound((height - kToolbarH - kBraveMargin) * sf));
    m_brave->roundCorners(static_cast<qulonglong>(m_window->winId()));
    notifyHelperHwnds();
    qInfo() << "[island] opened" << url << "braveW=" << braveW;
}

void PanelWindowController::navigateIsland(const QString& url)
{
    if (!m_islandOpen || url.trimmed().isEmpty()) {
        if (!url.trimmed().isEmpty())
            openIsland(url);
        return;
    }
    QString target = url.trimmed();
    if (!target.startsWith(QLatin1String("http")))
        target.prepend(QLatin1String("https://"));
    m_islandUrl = target;
    emit islandChanged();
    if (m_brave)
        m_brave->navigate(target);
}

void PanelWindowController::closeIsland()
{
    if (!m_islandOpen)
        return;
    if (m_brave)
        m_brave->closeShell();
    m_islandOpen = false;
    m_islandUrl.clear();
    emit islandChanged();
    if (m_window) {
        const QRect wa = m_workArea.workArea();
        const int width = qMax(kMinPanelWidth, m_islandPanelWidth);
        m_window->setGeometry(wa.x() + kPanelGap, wa.y() + kPanelGap,
                              width, wa.height() - kPanelGap * 2);
        if (!m_pinned)
            m_window->setFlag(Qt::WindowStaysOnTopHint, true);
    }
    notifyHelperHwnds();
    qInfo() << "[island] closed";
}

double PanelWindowController::windowOpacity() const
{
    return qBound(0.1, m_settings->getDouble(QStringLiteral("wp-opacity"), 1.0), 1.0);
}

void PanelWindowController::setWindowOpacity(double value)
{
    const double clamped = qBound(0.1, value, 1.0);
    // Stored as a string for Electron-store compatibility.
    m_settings->set(QStringLiteral("wp-opacity"), QString::number(clamped));
    if (m_window && m_window->isVisible() && !m_pinned)
        m_window->setOpacity(clamped);
}

void PanelWindowController::setPinnedOpacity(double value)
{
    const double clamped = qBound(0.05, value, 1.0);
    m_settings->set(QStringLiteral("wp-pinned-opacity"), QString::number(clamped));
    if (m_window && m_window->isVisible() && m_pinned)
        m_window->setOpacity(clamped);
}

bool PanelWindowController::autostart() const
{
    QSettings run(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows"
                                 "\\CurrentVersion\\Run"), QSettings::NativeFormat);
    return run.contains(QStringLiteral("qt-panel"));
}

void PanelWindowController::setAutostart(bool enabled)
{
    QSettings run(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows"
                                 "\\CurrentVersion\\Run"), QSettings::NativeFormat);
    if (enabled) {
        run.setValue(QStringLiteral("qt-panel"), QLatin1Char('"')
            + QDir::toNativeSeparators(QCoreApplication::applicationFilePath())
            + QLatin1Char('"'));
    } else {
        run.remove(QStringLiteral("qt-panel"));
    }
    qInfo() << "[settings] autostart" << (enabled ? "enabled" : "disabled");
}

void PanelWindowController::quit()
{
    m_settings->flush();
    QCoreApplication::quit();
}

void PanelWindowController::applyWorkArea()
{
    if (!m_window)
        return;
    const QRect wa = m_workArea.workArea();
    const int current = (m_panelVisible && m_window->width() >= kMinPanelWidth)
        ? m_window->width()
        : storedWidth();
    const int width = qBound(kMinPanelWidth, current, qMax(kMinPanelWidth, wa.width() - 40));
    m_window->setGeometry(wa.x() + kPanelGap, wa.y() + kPanelGap,
                          width, wa.height() - kPanelGap * 2);
}

void PanelWindowController::notifyHelperHwnds()
{
    if (m_helper && m_window)
        m_helper->sendHwnds(static_cast<qulonglong>(m_window->winId()));
}

void PanelWindowController::setPanelVisibleState(bool visible)
{
    if (m_panelVisible == visible)
        return;
    m_panelVisible = visible;
    emit panelVisibleChanged();
}

void PanelWindowController::resolveGraphicsApiName()
{
    if (!m_window)
        return;
    const QSGRendererInterface* ri = m_window->rendererInterface();
    QString name = QStringLiteral("unknown");
    if (ri) {
        switch (ri->graphicsApi()) {
        case QSGRendererInterface::Vulkan:     name = QStringLiteral("Vulkan"); break;
        case QSGRendererInterface::Direct3D11: name = QStringLiteral("D3D11"); break;
        case QSGRendererInterface::Direct3D12: name = QStringLiteral("D3D12"); break;
        case QSGRendererInterface::OpenGL:     name = QStringLiteral("OpenGL"); break;
        case QSGRendererInterface::Software:   name = QStringLiteral("Software"); break;
        default:                               name = QStringLiteral("other"); break;
        }
    }
    if (name != m_graphicsApiName) {
        m_graphicsApiName = name;
        emit graphicsApiNameChanged();
    }
    qInfo() << "[render] scene graph on" << name;
}

double PanelWindowController::pinnedOpacity() const
{
    const double value = m_settings->getDouble(QStringLiteral("wp-pinned-opacity"), 0.25);
    return qBound(0.05, value, 1.0);
}

int PanelWindowController::storedWidth() const
{
    return qMax(kMinPanelWidth, m_settings->getInt(QStringLiteral("wp-width"), 720));
}

int PanelWindowController::fullPanelWidth() const
{
    const QRect wa = m_workArea.workArea();
    return qMax(kMinPanelWidth, wa.width() - kPanelGap * 2);
}

int PanelWindowController::basePanelWidth(int baseColumnCount, const QVariantMap& colWidths) const
{
    static const QStringList order = {
        QStringLiteral("left"), QStringLiteral("monitor"), QStringLiteral("mid"),
        QStringLiteral("feed"), QStringLiteral("right"), QStringLiteral("aux"),
    };
    static const QHash<QString, int> defaults = {
        {QStringLiteral("left"), 220}, {QStringLiteral("monitor"), 220},
        {QStringLiteral("mid"), 240},  {QStringLiteral("feed"), 260},
        {QStringLiteral("right"), 260}, {QStringLiteral("aux"), 260},
    };
    const int count = qBound(3, baseColumnCount > 0 ? baseColumnCount : 3,
                             static_cast<int>(order.size()));
    if (count >= order.size())
        return fullPanelWidth();
    int columnsWidth = 0;
    for (int i = 0; i < count; ++i) {
        const QString& col = order.at(i);
        int w = colWidths.value(col).toInt();
        if (w <= 0)
            w = defaults.value(col, 220);
        columnsWidth += qBound(150, w, 900);
    }
    const int dividers = (count - 1) * kDividerWidth;
    return qMax(kMinPanelWidth,
                qMin(fullPanelWidth(), columnsWidth + dividers + kResizeHandleWidth + 22));
}

} // namespace qtpanel
