#include "PanelWindowController.h"

#include "HelperServer.h"
#include "WinShellIntegration.h"
#include "core/SettingsStore.h"

#include <QCoreApplication>
#include <QCursor>
#include <QDateTime>
#include <QDebug>
#include <QDesktopServices>
#include <QDir>
#include <QFileInfo>
#include <QHash>
#include <QJsonDocument>
#include <QJsonObject>
#include <QEasingCurve>
#include <QQuickWindow>
#include <QScreen>
#include <QSGRendererInterface>
#include <QSettings>
#include <QStandardPaths>
#include <QtWebEngineCore/QWebEngineCookieStore>
#include <QtWebEngineQuick/QQuickWebEngineProfile>

#include <utility>

namespace qtpanel {

namespace {
QString cookieKey(const QNetworkCookie& cookie)
{
    return cookie.domain() + QLatin1Char('|')
        + cookie.path() + QLatin1Char('|')
        + QString::fromUtf8(cookie.name());
}
} // namespace

PanelWindowController::PanelWindowController(SettingsStore* settings, HelperServer* helper,
                                             QQuickWebEngineProfile* webProfile, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_helper(helper)
    , m_webProfile(webProfile)
{
    m_hideFallback.setSingleShot(true);
    connect(&m_hideFallback, &QTimer::timeout, this, &PanelWindowController::completeHide);

    m_slideAnimation.setPropertyName("x");
    connect(&m_slideAnimation, &QPropertyAnimation::finished, this, [this] {
        if (m_hiding)
            completeHide();
        else
            m_showAnimating = false;
    });

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
    m_islandReadyTimeout.setSingleShot(true);
    m_islandReadyTimeout.setInterval(18000);
    connect(&m_islandReadyTimeout, &QTimer::timeout, this, [this] {
        if (m_islandOpen && m_islandLoading)
            failIslandLoad(QStringLiteral("Timed out waiting for browser island"));
    });
    if (m_webProfile && m_webProfile->cookieStore()) {
        QWebEngineCookieStore* cookies = m_webProfile->cookieStore();
        connect(cookies, &QWebEngineCookieStore::cookieAdded, this,
                [this](const QNetworkCookie& cookie) {
            m_webCookies.insert(cookieKey(cookie), cookie);
        });
        connect(cookies, &QWebEngineCookieStore::cookieRemoved, this,
                [this](const QNetworkCookie& cookie) {
            m_webCookies.remove(cookieKey(cookie));
        });
        cookies->loadAllCookies();
    }

    // Build-tree startup uses launch.ps1 for delayed login initialization and
    // retry handling. Standalone deployments continue launching directly.
    if (autostart()) {
        QSettings run(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows"
                                     "\\CurrentVersion\\Run"), QSettings::NativeFormat);
        const QString desired = autostartCommand();
        if (!desired.isEmpty() && run.value(QStringLiteral("qt-panel")).toString() != desired) {
            run.setValue(QStringLiteral("qt-panel"), desired);
            qInfo() << "[settings] migrated autostart command";
        }
    }
}

void PanelWindowController::attach(QQuickWindow* window)
{
    m_window = window;
    m_slideAnimation.setTargetObject(window);
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
    const int restingX = m_window->x();
    const int hiddenX = hiddenWindowX();
    m_slideAnimation.stop();
    m_slideAnimation.setDuration(slideDuration());
    m_slideAnimation.setEasingCurve(QEasingCurve::OutCubic);
    m_slideAnimation.setStartValue(hiddenX);
    m_slideAnimation.setEndValue(restingX);
    m_window->setX(hiddenX);
    m_window->show();
    m_window->raise();
    if (!m_pinned) {
        QTimer::singleShot(150, this, [this] {
            if (m_window && m_window->isVisible())
                m_window->requestActivate();
        });
    }
    setPanelVisibleState(true);
    m_slideAnimation.start();
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
    m_slideAnimation.stop();
    m_slideAnimation.setDuration(slideDuration());
    m_slideAnimation.setEasingCurve(QEasingCurve::InCubic);
    m_slideAnimation.setStartValue(m_window->x());
    m_slideAnimation.setEndValue(hiddenWindowX());
    m_slideAnimation.start();
    m_hideFallback.start(slideDuration() + 160);
}

void PanelWindowController::completeHide()
{
    if (!m_hiding)
        return;
    m_hiding = false;
    m_showAnimating = false;
    m_hideFallback.stop();
    if (!m_window)
        return;
    m_window->hide();
    m_window->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    if (m_helper)
        m_helper->sendState(false);
    setPanelVisibleState(false);
}

int PanelWindowController::hiddenWindowX() const
{
    if (!m_window)
        return -kMinPanelWidth - 2;
    const QScreen* screen = m_window->screen();
    const int screenLeft = screen ? screen->geometry().left() : m_workArea.workArea().left();
    return screenLeft - m_window->width() - 2;
}

int PanelWindowController::slideDuration() const
{
    return m_settings->get(QStringLiteral("wp-reduced-motion"), false).toBool()
        ? 0 : kSlideMs;
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
    const QRect screen = m_workArea.screenGeometry();
    const int maxWidth = fullPanelWidth();
    const int newW = qBound(kMinPanelWidth,
                            m_resizeStartW + (QCursor::pos().x() - m_resizeStartX),
                            maxWidth);
    m_window->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          newW, wa.height() - kPanelVerticalGap * 2);
}

void PanelWindowController::endResize()
{
    if (!m_resizeTimer.isActive())
        return;
    m_resizeTimer.stop();
    if (m_window)
        m_settings->set(QStringLiteral("wp-width"), m_window->width());
}

bool PanelWindowController::fitMode(const QString& mode, int columnCount, const QVariantMap& colWidths)
{
    if (!m_window)
        return false;
    const bool stage = mode != QLatin1String("base");
    const int width = basePanelWidth(columnCount, colWidths);
    m_geometryLockUntil = QDateTime::currentMSecsSinceEpoch() + 700;
    if (!stage)
        m_settings->set(QStringLiteral("wp-width"), width);
    const QRect wa = m_workArea.workArea();
    const QRect screen = m_workArea.screenGeometry();
    m_window->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          width, wa.height() - kPanelVerticalGap * 2);
    m_focus.noteToggle();
    notifyHelperHwnds();
    const bool applied = qAbs(m_window->width() - width) <= 2;
    const int leftGap = m_window->x() - screen.x();
    const int rightGap = screen.x() + screen.width()
        - (m_window->x() + m_window->width());
    qInfo() << "[panel] fit-mode" << mode << "stage=" << stage
            << "width=" << width << "actual=" << m_window->width()
            << "left-gap=" << leftGap << "right-gap=" << rightGap
            << "screen=" << screen << "work-area=" << wa
            << "ok=" << applied;
    return applied;
}

void PanelWindowController::startIslandLoad(const QString& status)
{
    m_islandLoading = true;
    m_islandStatus = status;
    m_islandError.clear();
    m_islandReadyTimeout.start();
    emit islandChanged();
}

void PanelWindowController::failIslandLoad(const QString& error)
{
    if (!m_islandOpen)
        return;
    m_islandReadyTimeout.stop();
    m_islandLoading = false;
    m_islandStatus = QStringLiteral("Error");
    m_islandError = error.isEmpty() ? QStringLiteral("Browser island failed") : error;
    emit islandChanged();
}

void PanelWindowController::reportIslandState(const QString& url, const QString& title,
                                              bool loading, bool canGoBack,
                                              bool canGoForward, const QString& error)
{
    if (!m_islandOpen)
        return;

    bool changed = false;
    if (!url.isEmpty() && url != m_islandUrl) {
        m_islandUrl = url;
        changed = true;
    }
    if (title != m_islandTitle) {
        m_islandTitle = title;
        changed = true;
    }
    if (canGoBack != m_islandCanGoBack) {
        m_islandCanGoBack = canGoBack;
        changed = true;
    }
    if (canGoForward != m_islandCanGoForward) {
        m_islandCanGoForward = canGoForward;
        changed = true;
    }
    const QString readyState = loading ? QStringLiteral("loading") : QStringLiteral("complete");
    if (readyState != m_islandReadyState) {
        m_islandReadyState = readyState;
        changed = true;
    }
    if (!error.isEmpty()) {
        m_islandReadyTimeout.stop();
        m_islandLoading = false;
        m_islandStatus = QStringLiteral("Error");
        m_islandError = error;
        changed = true;
    } else if (loading && !m_islandLoading) {
        m_islandLoading = true;
        m_islandStatus = QStringLiteral("Loading");
        m_islandError.clear();
        m_islandReadyTimeout.start();
        changed = true;
    } else if (!loading && (m_islandLoading || !m_islandError.isEmpty()
                            || m_islandStatus != QLatin1String("Ready"))) {
        m_islandReadyTimeout.stop();
        m_islandLoading = false;
        m_islandStatus = QStringLiteral("Ready");
        m_islandError.clear();
        changed = true;
    }
    if (changed)
        emit islandChanged();
}

void PanelWindowController::openIsland(const QString& url)
{
    if (!m_window || url.trimmed().isEmpty() || !m_webProfile)
        return;
    QString target = url.trimmed();
    if (!target.startsWith(QLatin1String("http"))
        && !target.startsWith(QLatin1String("data:")))
        target.prepend(QLatin1String("https://"));
    const QRect wa = m_workArea.workArea();
    const QRect screen = m_workArea.screenGeometry();
    const int fullWidth = fullPanelWidth();
    if (!m_islandOpen)
        m_islandRestoreWidth = m_window->width();
    m_islandPanelWidth = fullWidth / 2;
    const int height = wa.height() - kPanelVerticalGap * 2;

    m_focus.noteBrowserOpened();
    m_geometryLockUntil = QDateTime::currentMSecsSinceEpoch() + 700;
    m_window->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          fullWidth, height);

    m_islandOpen = true;
    m_islandUrl = target;
    m_islandTitle.clear();
    m_islandCanGoBack = false;
    m_islandCanGoForward = false;
    m_islandReadyState.clear();
    startIslandLoad(QStringLiteral("Opening"));
    emit islandOpenRequested(target);
    notifyHelperHwnds();
    qInfo() << "[web] spotlight opened" << target
            << "windowW=" << fullWidth << "spotlightX=" << m_islandPanelWidth;
}

void PanelWindowController::navigateIsland(const QString& url)
{
    if (!m_islandOpen || url.trimmed().isEmpty()) {
        if (!url.trimmed().isEmpty())
            openIsland(url);
        return;
    }
    QString target = url.trimmed();
    if (!target.startsWith(QLatin1String("http"))
        && !target.startsWith(QLatin1String("data:")))
        target.prepend(QLatin1String("https://"));
    m_islandUrl = target;
    m_islandTitle.clear();
    m_islandReadyState.clear();
    startIslandLoad(QStringLiteral("Navigating"));
    emit islandNavigateRequested(target);
}

void PanelWindowController::reloadIsland()
{
    if (!m_islandOpen)
        return;
    m_islandReadyState.clear();
    startIslandLoad(QStringLiteral("Reloading"));
    emit islandReloadRequested();
}

void PanelWindowController::backIsland()
{
    if (!m_islandOpen || !m_islandCanGoBack)
        return;
    m_islandReadyState.clear();
    startIslandLoad(QStringLiteral("Back"));
    emit islandBackRequested();
}

void PanelWindowController::forwardIsland()
{
    if (!m_islandOpen || !m_islandCanGoForward)
        return;
    m_islandReadyState.clear();
    startIslandLoad(QStringLiteral("Forward"));
    emit islandForwardRequested();
}

QString PanelWindowController::runIslandScript(const QString& script)
{
    if (!m_islandOpen || script.trimmed().isEmpty())
        return {};
    const QString id = QStringLiteral("web-eval-%1").arg(++m_nextIslandScriptId);
    emit islandScriptRequested(id, script);
    return id;
}

void PanelWindowController::completeIslandScript(const QString& id, const QVariant& result,
                                                 const QString& error)
{
    if (!id.isEmpty())
        emit islandScriptResult(id, result, error);
}

void PanelWindowController::reportIslandRenderTerminated(int status, int exitCode)
{
    if (!m_islandOpen)
        return;
    const QString error = QStringLiteral("Web renderer stopped (%1, code %2)")
                              .arg(status).arg(exitCode);
    qWarning() << "[web]" << error;
    failIslandLoad(error);
}

bool PanelWindowController::openExternal(const QString& url)
{
    const QUrl target = QUrl::fromUserInput(url.trimmed());
    if (!target.isValid()
        || (target.scheme() != QLatin1String("http")
            && target.scheme() != QLatin1String("https"))) {
        qWarning() << "[external] rejected URL" << url;
        return false;
    }
    const bool opened = QDesktopServices::openUrl(target);
    qInfo() << "[external]" << (opened ? "opened" : "failed") << target.host();
    return opened;
}

void PanelWindowController::captureTradingViewSession()
{
    if (!m_webProfile || !m_webProfile->cookieStore()) {
        m_settings->set(QStringLiteral("wp-tv-capture-status"),
                        QStringLiteral("Qt WebEngine profile unavailable"));
        return;
    }
    if (!m_islandOpen) {
        openIsland(QStringLiteral("https://www.tradingview.com/accounts/signin/"));
        m_settings->set(QStringLiteral("wp-tv-capture-status"),
                        QStringLiteral("Sign in, then press Capture"));
        return;
    }
    m_settings->set(QStringLiteral("wp-tv-capture-status"),
                    QStringLiteral("Capturing TradingView cookies"));
    m_webProfile->cookieStore()->loadAllCookies();
    QTimer::singleShot(350, this, &PanelWindowController::captureTradingViewCookies);
}

void PanelWindowController::captureTradingViewCookies()
{
    QStringList pairs;
    QString sessionId;
    QString csrf;
    QString username;
    for (const QNetworkCookie& cookie : std::as_const(m_webCookies)) {
        QString domain = cookie.domain().trimmed().toLower();
        while (domain.startsWith(QLatin1Char('.')))
            domain.remove(0, 1);
        const QString name = QString::fromUtf8(cookie.name());
        const QString cookieValue = QString::fromUtf8(cookie.value());
        if (name.isEmpty() || cookieValue.isEmpty())
            continue;
        if (domain != QLatin1String("tradingview.com")
            && !domain.endsWith(QLatin1String(".tradingview.com")))
            continue;
        pairs << QStringLiteral("%1=%2").arg(name, cookieValue);
        if (name == QLatin1String("sessionid"))
            sessionId = cookieValue;
        else if (name == QLatin1String("csrftoken"))
            csrf = cookieValue;
        else if (name == QLatin1String("username"))
            username = cookieValue;
    }

    if (sessionId.isEmpty()) {
        m_settings->set(QStringLiteral("wp-tv-capture-status"),
                        QStringLiteral("TradingView session not found"));
        qWarning() << "[tv] no sessionid in captured cookies";
        return;
    }

    m_settings->set(QStringLiteral("wp-tv-cookies"), pairs.join(QStringLiteral("; ")));
    m_settings->set(QStringLiteral("wp-tv-session"), sessionId);
    m_settings->set(QStringLiteral("wp-tv-csrf"), csrf);
    m_settings->set(QStringLiteral("wp-tv-user"), username);
    m_settings->set(QStringLiteral("wp-tv-capture-status"),
                    username.isEmpty()
                        ? QStringLiteral("TradingView session captured")
                        : QStringLiteral("TradingView session captured: %1").arg(username));
    emit tradingViewSessionCaptured();
    qInfo() << "[tv] captured TradingView session cookies; user=" << username
            << "cookies=" << pairs.size();
}

void PanelWindowController::closeIsland()
{
    if (!m_islandOpen)
        return;
    emit islandCloseRequested();
    m_islandReadyTimeout.stop();
    m_islandOpen = false;
    m_islandLoading = false;
    m_islandUrl.clear();
    m_islandStatus.clear();
    m_islandError.clear();
    m_islandTitle.clear();
    m_islandCanGoBack = false;
    m_islandCanGoForward = false;
    m_islandReadyState.clear();
    emit islandChanged();
    if (m_window) {
        const QRect wa = m_workArea.workArea();
        const QRect screen = m_workArea.screenGeometry();
        const int width = qMax(kMinPanelWidth,
                               m_islandRestoreWidth > 0
                                   ? m_islandRestoreWidth
                                   : m_islandPanelWidth);
        m_window->setGeometry(screen.x() + kPanelHorizontalGap,
                              wa.y() + kPanelVerticalGap,
                              qMin(width, fullPanelWidth()),
                              wa.height() - kPanelVerticalGap * 2);
    }
    m_islandPanelWidth = 0;
    m_islandRestoreWidth = 0;
    notifyHelperHwnds();
    qInfo() << "[web] island closed";
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

QString PanelWindowController::autostartCommand() const
{
    const QString appPath = QDir::toNativeSeparators(QCoreApplication::applicationFilePath());
    const auto quote = [](const QString& value) {
        return QLatin1Char('"') + QDir::toNativeSeparators(value) + QLatin1Char('"');
    };

    const QDir appDir(QCoreApplication::applicationDirPath());
    QDir sourceRoot = appDir;
    const bool hasSourceRoot = sourceRoot.cdUp() && sourceRoot.cdUp();
    const QString launcher = hasSourceRoot
        ? sourceRoot.filePath(QStringLiteral("launch.ps1")) : QString();
    if (!QFileInfo::exists(launcher)) {
        if (!QFileInfo::exists(appDir.filePath(QStringLiteral("Qt6Core.dll"))))
            qWarning() << "[settings] autostart runtime missing and no launcher found beside build tree";
        return quote(appPath);
    }

    QString powershell = QStandardPaths::findExecutable(QStringLiteral("powershell.exe"));
    if (powershell.isEmpty()) {
        powershell = QDir(qEnvironmentVariable("SystemRoot", QStringLiteral("C:\\Windows")))
            .filePath(QStringLiteral("System32/WindowsPowerShell/v1.0/powershell.exe"));
    }

    const QString buildName = appDir.dirName().toLower();
    const QString config = buildName.endsWith(QLatin1String("debug"))
        ? QStringLiteral("debug") : QStringLiteral("release");
    const QString generator = buildName.startsWith(QLatin1String("nmake-"))
        ? QStringLiteral("NMake") : QStringLiteral("Ninja");
    return QStringLiteral("%1 -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass"
                          " -File %2 -Config %3 -Generator %4 -Startup")
        .arg(quote(powershell), quote(launcher), config, generator);
}

void PanelWindowController::setAutostart(bool enabled)
{
    QSettings run(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows"
                                 "\\CurrentVersion\\Run"), QSettings::NativeFormat);
    if (enabled) {
        run.setValue(QStringLiteral("qt-panel"), autostartCommand());
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
    const QRect screen = m_workArea.screenGeometry();
    const int current = (m_panelVisible && m_window->width() >= kMinPanelWidth)
        ? m_window->width()
        : storedWidth();
    const int width = qBound(kMinPanelWidth, current, fullPanelWidth());
    m_window->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          width, wa.height() - kPanelVerticalGap * 2);
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
    QVariantMap colWidths;
    const QVariant rawWidths = m_settings->get(QStringLiteral("wp-col-widths"));
    if (rawWidths.canConvert<QVariantMap>()) {
        colWidths = rawWidths.toMap();
    } else {
        const QJsonDocument doc = QJsonDocument::fromJson(rawWidths.toString().toUtf8());
        if (doc.isObject())
            colWidths = doc.object().toVariantMap();
    }
    const int columns = m_settings->getInt(QStringLiteral("wp-base-columns"), 3);
    const int layoutMinimum = basePanelWidth(columns, colWidths);
    const int stored = m_settings->getInt(QStringLiteral("wp-width"), layoutMinimum);
    return qMax(layoutMinimum, qMax(kMinPanelWidth, stored));
}

int PanelWindowController::fullPanelWidth() const
{
    const QRect screen = m_workArea.screenGeometry();
    return qMax(kMinPanelWidth, screen.width() - kPanelHorizontalGap * 2);
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
