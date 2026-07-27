#include "PanelWindowController.h"

#include "HelperServer.h"
#include "SystemTheme.h"
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

#include "PanelSurfaceTarget.h"
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

    m_slideAnimation.setPropertyName("surfaceX");
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
        if (m_helper && m_target && m_target->isVisible()) {
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
    m_target = std::make_unique<QQuickWindowTarget>(window);
    // Animate the controller's own surfaceX, not the window's x. The
    // composition path has no QWindow to animate, and routing both through one
    // property keeps a single slide implementation instead of two that have to
    // stay in step.
    m_slideAnimation.setTargetObject(this);
    window->setFlags(Qt::FramelessWindowHint | Qt::Tool | Qt::WindowStaysOnTopHint);
    window->setColor(Qt::transparent);
    applyWorkArea();
    m_micaBackdrop = m_settings->get(QStringLiteral("wp-backdrop-material"),
                                     QStringLiteral("mica")).toString()
                     != QLatin1String("acrylic");
    m_followSystemMaterial =
        m_settings->get(QStringLiteral("wp-follow-system-material")).toString()
        == QLatin1String("true");
    qInfo() << "[shell] follow-system-material" << m_followSystemMaterial
            << "mica-pref" << m_micaBackdrop << "effective-mica" << effectiveMica();
    WinShellIntegration::applyPanelChrome(window, effectiveMica(), systemTransparency());
    // attach() can run after the QML engine has already bound micaBackdrop at
    // its default, so announce the stored value rather than leaving Theme's
    // tint out of step with the material actually on screen.
    emit micaBackdropChanged();

    connect(window, &QWindow::activeChanged, this, &PanelWindowController::onActiveChanged);
    connect(window, &QQuickWindow::sceneGraphInitialized,
            this, &PanelWindowController::resolveGraphicsApiName, Qt::QueuedConnection);
    connect(&m_workArea, &WorkAreaWatcher::workAreaChanged, this, [this] { applyWorkArea(); });

    if (m_helper) {
        connect(m_helper, &HelperServer::toggleRequested, this, &PanelWindowController::togglePanel);
        connect(m_helper, &HelperServer::clickOutside, this, &PanelWindowController::onClickOutside);
        connect(m_helper, &HelperServer::helperReady, this, [this] {
            m_helper->sendState(m_target && m_target->isVisible());
            notifyHelperHwnds();
        });
        connect(m_helper, &HelperServer::clientConnected, this, [this] {
            m_helper->sendState(m_target && m_target->isVisible());
        });
    }

    m_pinned = m_settings->get(QStringLiteral("wp-pinned"), false).toBool();
    emit pinnedChanged();
}

PanelWindowController::~PanelWindowController() = default;

int PanelWindowController::surfaceX() const
{
    return m_target ? m_target->x() : 0;
}

void PanelWindowController::setSurfaceX(int x)
{
    if (m_target) m_target->setX(x);
}

void PanelWindowController::attachTarget(PanelSurfaceTarget* target, QQuickWindow* sceneWindow)
{
    m_target.reset(target);
    // Deliberately NOT assigning m_window: it gates the DWM backdrop calls,
    // which must not run here. In composition mode the material comes from
    // DesktopAcrylicController, and this scene window has no native surface for
    // DWM to act on anyway.
    m_slideAnimation.setTargetObject(this);
    applyWorkArea();

    m_followSystemMaterial =
        m_settings->get(QStringLiteral("wp-follow-system-material")).toString()
        == QLatin1String("true");
    emit micaBackdropChanged();

    if (sceneWindow) {
        connect(sceneWindow, &QQuickWindow::sceneGraphInitialized,
                this, &PanelWindowController::resolveGraphicsApiName, Qt::QueuedConnection);
    }
    connect(&m_workArea, &WorkAreaWatcher::workAreaChanged, this, [this] { applyWorkArea(); });

    if (m_helper) {
        connect(m_helper, &HelperServer::toggleRequested, this, &PanelWindowController::togglePanel);
        connect(m_helper, &HelperServer::clickOutside, this, &PanelWindowController::onClickOutside);
        connect(m_helper, &HelperServer::helperReady, this, [this] {
            m_helper->sendState(m_target && m_target->isVisible());
            notifyHelperHwnds();
        });
        connect(m_helper, &HelperServer::clientConnected, this, [this] {
            m_helper->sendState(m_target && m_target->isVisible());
        });
    }

    m_pinned = m_settings->get(QStringLiteral("wp-pinned"), false).toBool();
    emit pinnedChanged();
    qInfo() << "[composition] controller attached to composition target";
}

void PanelWindowController::showPanel()
{
    if (!m_target || m_target->isVisible() || m_showAnimating)
        return;
    m_showAnimating = true;
    m_hiding = false;
    m_hideFallback.stop();
    m_focus.noteToggle();

    m_target->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    applyWorkArea();
    const int restingX = m_target->x();
    const int hiddenX = hiddenWindowX();
    m_slideAnimation.stop();
    m_slideAnimation.setDuration(slideDuration());
    m_slideAnimation.setEasingCurve(QEasingCurve::OutCubic);
    m_slideAnimation.setStartValue(hiddenX);
    m_slideAnimation.setEndValue(restingX);
    m_target->setX(hiddenX);
    m_target->show();
    m_target->raise();
    if (!m_pinned) {
        QTimer::singleShot(150, this, [this] {
            if (m_target && m_target->isVisible())
                m_target->requestActivate();
        });
    }
    setPanelVisibleState(true);
    m_slideAnimation.start();
    m_helperStateDelay.start();
}

void PanelWindowController::hidePanel(bool force)
{
    if (!m_target || !m_target->isVisible() || m_hiding)
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
    m_slideAnimation.setStartValue(m_target->x());
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
    if (!m_target)
        return;
    m_target->hide();
    m_target->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    if (m_helper)
        m_helper->sendState(false);
    setPanelVisibleState(false);
}

int PanelWindowController::hiddenWindowX() const
{
    if (!m_target)
        return -kMinPanelWidth - 2;
    const QScreen* screen = m_target->screen();
    const int screenLeft = screen ? screen->geometry().left() : m_workArea.workArea().left();
    return screenLeft - m_target->width() - 2;
}

int PanelWindowController::slideDuration() const
{
    return m_settings->get(QStringLiteral("wp-reduced-motion"), false).toBool()
        ? 0 : kSlideMs;
}

void PanelWindowController::togglePanel()
{
    if (!m_target)
        return;
    m_focus.noteToggle();
    if (m_target->isVisible())
        hidePanel();
    else
        showPanel();
}

void PanelWindowController::togglePin()
{
    m_pinned = !m_pinned;
    m_settings->set(QStringLiteral("wp-pinned"), m_pinned);
    if (m_target && m_target->isVisible())
        m_target->setOpacity(m_pinned ? pinnedOpacity() : windowOpacity());
    emit pinnedChanged();
    notifyHelperHwnds();
}

void PanelWindowController::setModalOpen(bool open)
{
    if (open)
        m_focus.noteModalOpened();
    else
        m_focus.noteModalClosed();
    if (m_modalOpen != open) {
        m_modalOpen = open;
        emit modalOpenChanged();
    }
}

void PanelWindowController::onActiveChanged()
{
    if (!m_target || m_target->isActive())
        return;
    if (m_pinned || !m_target->isVisible() || m_hiding || m_islandOpen)
        return;
    if (!m_focus.blurMayHide())
        return;
    QTimer::singleShot(FocusPolicy::kRecheckDelayMs, this, [this] {
        if (!m_target || !m_target->isVisible() || m_pinned || m_hiding)
            return;
        if (m_target->isActive())
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
        if (!m_target || !m_target->isVisible() || m_pinned || m_hiding)
            return;
        if (!m_focus.delayedCheckAllowsHide())
            return;
        hidePanel();
    });
}

void PanelWindowController::startResize()
{
    if (!m_target || m_resizeTimer.isActive())
        return;
    m_resizeStartX = QCursor::pos().x();
    m_resizeStartW = m_target->width();
    m_resizeTimer.start();
}

void PanelWindowController::onResizeTick()
{
    if (!m_target) {
        m_resizeTimer.stop();
        return;
    }
    const QRect wa = m_workArea.workArea();
    const QRect screen = m_workArea.screenGeometry();
    const int maxWidth = fullPanelWidth();
    const int newW = qBound(kMinPanelWidth,
                            m_resizeStartW + (QCursor::pos().x() - m_resizeStartX),
                            maxWidth);
    m_target->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          newW, wa.height() - kPanelVerticalGap * 2);
}

void PanelWindowController::endResize()
{
    if (!m_resizeTimer.isActive())
        return;
    m_resizeTimer.stop();
    // Only base remembers a dragged width. Stage modes are sized from their own
    // column count, so storing their width here would widen base as well.
    if (m_target && m_mode == QLatin1String("base"))
        m_settings->set(QStringLiteral("wp-width"), m_target->width());
}

bool PanelWindowController::fitMode(const QString& mode, int columnCount, const QVariantMap& colWidths)
{
    if (!m_target)
        return false;
    const bool stage = mode != QLatin1String("base");
    const int width = basePanelWidth(columnCount, colWidths);
    m_geometryLockUntil = QDateTime::currentMSecsSinceEpoch() + 700;
    // Remember which mode is on screen so a hide/show cycle restores this
    // mode's width instead of falling back to the base-mode width.
    if (m_mode != mode) {
        m_mode = mode;
        m_settings->set(QStringLiteral("wp-panel-mode"), mode);
    }
    if (!stage)
        m_settings->set(QStringLiteral("wp-width"), width);
    const QRect wa = m_workArea.workArea();
    const QRect screen = m_workArea.screenGeometry();
    m_target->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          width, wa.height() - kPanelVerticalGap * 2);
    m_focus.noteToggle();
    notifyHelperHwnds();
    const bool applied = qAbs(m_target->width() - width) <= 2;
    const int leftGap = m_target->x() - screen.x();
    const int rightGap = screen.x() + screen.width()
        - (m_target->x() + m_target->width());
    qInfo() << "[panel] fit-mode" << mode << "stage=" << stage
            << "width=" << width << "actual=" << m_target->width()
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
    openSpotlight(url, QStringLiteral("web"));
}

void PanelWindowController::openPressReader(const QString& url)
{
    openSpotlight(url, QStringLiteral("pressreader"));
}

void PanelWindowController::openSpotlight(const QString& url, const QString& kind)
{
    if (!m_target || url.trimmed().isEmpty() || !m_webProfile)
        return;
    QString target = url.trimmed();
    if (!target.startsWith(QLatin1String("http"))
        && !target.startsWith(QLatin1String("data:")))
        target.prepend(QLatin1String("https://"));
    const QRect wa = m_workArea.workArea();
    const QRect screen = m_workArea.screenGeometry();
    const int fullWidth = fullPanelWidth();
    if (!m_islandOpen)
        m_islandRestoreWidth = m_target->width();
    m_islandPanelWidth = fullWidth / 2;
    const int height = wa.height() - kPanelVerticalGap * 2;

    m_focus.noteBrowserOpened();
    m_geometryLockUntil = QDateTime::currentMSecsSinceEpoch() + 700;
    m_target->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          fullWidth, height);

    m_islandOpen = true;
    m_islandKind = kind;
    m_islandUrl = target;
    m_islandTitle.clear();
    m_islandCanGoBack = false;
    m_islandCanGoForward = false;
    m_islandReadyState.clear();
    startIslandLoad(QStringLiteral("Opening"));
    if (kind == QLatin1String("pressreader"))
        emit pressReaderOpenRequested(target);
    else
        emit islandOpenRequested(target);
    notifyHelperHwnds();
    qInfo() << "[web] spotlight opened" << kind << target
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
    m_islandKind.clear();
    m_islandLoading = false;
    m_islandUrl.clear();
    m_islandStatus.clear();
    m_islandError.clear();
    m_islandTitle.clear();
    m_islandCanGoBack = false;
    m_islandCanGoForward = false;
    m_islandReadyState.clear();
    emit islandChanged();
    if (m_target) {
        const QRect wa = m_workArea.workArea();
        const QRect screen = m_workArea.screenGeometry();
        const int width = qMax(kMinPanelWidth,
                               m_islandRestoreWidth > 0
                                   ? m_islandRestoreWidth
                                   : m_islandPanelWidth);
        m_target->setGeometry(screen.x() + kPanelHorizontalGap,
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
    if (m_target && m_target->isVisible() && !m_pinned)
        m_target->setOpacity(clamped);
}

void PanelWindowController::setPinnedOpacity(double value)
{
    const double clamped = qBound(0.05, value, 1.0);
    m_settings->set(QStringLiteral("wp-pinned-opacity"), QString::number(clamped));
    if (m_target && m_target->isVisible() && m_pinned)
        m_target->setOpacity(clamped);
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

bool PanelWindowController::systemTransparency() const
{
    return !m_systemTheme || m_systemTheme->transparencyEnabled();
}

void PanelWindowController::setSystemTheme(SystemTheme* theme)
{
    m_systemTheme = theme;
    if (!theme)
        return;
    // Re-apply on any personalization change so toggling transparency effects
    // in Windows Settings takes hold without restarting the panel.
    connect(theme, &SystemTheme::appearanceChanged, this, [this] {
        if (m_window)
            WinShellIntegration::setBackdropMaterial(m_window, effectiveMica(),
                                                     systemTransparency());
    });
}

void PanelWindowController::setMicaBackdrop(bool mica)
{
    if (m_micaBackdrop == mica)
        return;
    m_micaBackdrop = mica;
    m_settings->set(QStringLiteral("wp-backdrop-material"),
                    mica ? QStringLiteral("mica") : QStringLiteral("acrylic"));
    if (m_window)
        WinShellIntegration::setBackdropMaterial(m_window, effectiveMica(), systemTransparency());
    emit micaBackdropChanged();
}

void PanelWindowController::setFollowSystemMaterial(bool follow)
{
    if (m_followSystemMaterial == follow)
        return;
    m_followSystemMaterial = follow;
    if (m_window)
        WinShellIntegration::setBackdropMaterial(m_window, effectiveMica(), systemTransparency());
    emit micaBackdropChanged();
}

void PanelWindowController::quit()
{
    m_settings->flush();
    QCoreApplication::quit();
}

void PanelWindowController::applyWorkArea()
{
    if (!m_target)
        return;
    const QRect wa = m_workArea.workArea();
    const QRect screen = m_workArea.screenGeometry();
    // While visible keep the current width (a manual resize is authoritative);
    // otherwise — the show path — size for the mode that is actually on screen.
    const int current = (m_panelVisible && m_target->width() >= kMinPanelWidth)
        ? m_target->width()
        : widthForMode(m_mode);
    const int width = qBound(kMinPanelWidth, current, fullPanelWidth());
    m_target->setGeometry(screen.x() + kPanelHorizontalGap,
                          wa.y() + kPanelVerticalGap,
                          width, wa.height() - kPanelVerticalGap * 2);
    qInfo() << "[panel] apply-geometry mode=" << m_mode << "width=" << width
            << "visible=" << m_panelVisible;
}

void PanelWindowController::notifyHelperHwnds()
{
    if (m_helper && m_target)
        m_helper->sendHwnds(static_cast<qulonglong>(m_target->winId()));
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
    if (!m_target)
        return;
    const QSGRendererInterface* ri = m_target->quickWindow() ? m_target->quickWindow()->rendererInterface() : nullptr;
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

QVariantMap PanelWindowController::storedColumnWidths() const
{
    const QVariant rawWidths = m_settings->get(QStringLiteral("wp-col-widths"));
    if (rawWidths.canConvert<QVariantMap>())
        return rawWidths.toMap();
    const QJsonDocument doc = QJsonDocument::fromJson(rawWidths.toString().toUtf8());
    return doc.isObject() ? doc.object().toVariantMap() : QVariantMap();
}

int PanelWindowController::columnsForMode(const QString& mode) const
{
    // Mirrors PanelSurface.columnCount so C++ can size any mode on its own.
    const int base = m_settings->getInt(QStringLiteral("wp-base-columns"), 3);
    if (mode == QLatin1String("monitor") || mode == QLatin1String("live"))
        return 6;
    if (mode == QLatin1String("news"))
        return qBound(3, m_settings->getInt(QStringLiteral("wp-news-columns"), base), 6);
    return qBound(3, base, 6);
}

int PanelWindowController::widthForMode(const QString& mode) const
{
    const QVariantMap colWidths = storedColumnWidths();
    const int layout = basePanelWidth(columnsForMode(mode), colWidths);
    // Only base keeps a user-dragged width; stage modes are sized purely by
    // their own column count, so switching away and back cannot inflate them.
    if (mode != QLatin1String("base"))
        return qBound(kMinPanelWidth, layout, fullPanelWidth());
    const int stored = m_settings->getInt(QStringLiteral("wp-width"), layout);
    return qBound(kMinPanelWidth, qMax(layout, stored), fullPanelWidth());
}

int PanelWindowController::storedWidth() const
{
    return widthForMode(QStringLiteral("base"));
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
