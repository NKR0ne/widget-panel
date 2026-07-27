#pragma once

#include <QObject>
#include <QPointer>
#include <QHash>
#include <QNetworkCookie>
#include <QString>
#include <QTimer>
#include <QPropertyAnimation>
#include <QVariantMap>

#include <memory>

#include "FocusPolicy.h"
#include "WorkAreaWatcher.h"

class PanelSurfaceTarget;
class QQuickWindow;
class QQuickWebEngineProfile;

namespace qtpanel {

class HelperServer;
class SettingsStore;
class SystemTheme;

// Owns the panel window lifecycle: geometry (gap inset, work-area height,
// fit modes, drag resize), native-window slide choreography, pin state,
// blur-to-hide policy, and helper notifications.
// Port of the window-management half of the Electron main.js.
class PanelWindowController : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool pinned READ pinned NOTIFY pinnedChanged)
    Q_PROPERTY(bool panelVisible READ panelVisible NOTIFY panelVisibleChanged)
    Q_PROPERTY(QString graphicsApiName READ graphicsApiName NOTIFY graphicsApiNameChanged)
    Q_PROPERTY(bool islandOpen READ islandOpen NOTIFY islandChanged)
    Q_PROPERTY(QString islandKind READ islandKind NOTIFY islandChanged)
    Q_PROPERTY(QString islandUrl READ islandUrl NOTIFY islandChanged)
    Q_PROPERTY(int islandX READ islandX NOTIFY islandChanged)
    Q_PROPERTY(bool islandLoading READ islandLoading NOTIFY islandChanged)
    Q_PROPERTY(QString islandStatus READ islandStatus NOTIFY islandChanged)
    Q_PROPERTY(QString islandError READ islandError NOTIFY islandChanged)
    Q_PROPERTY(QString islandTitle READ islandTitle NOTIFY islandChanged)
    Q_PROPERTY(bool islandCanGoBack READ islandCanGoBack NOTIFY islandChanged)
    Q_PROPERTY(bool islandCanGoForward READ islandCanGoForward NOTIFY islandChanged)
    Q_PROPERTY(QString islandReadyState READ islandReadyState NOTIFY islandChanged)
    Q_PROPERTY(bool micaBackdrop READ micaBackdrop WRITE setMicaBackdrop NOTIFY micaBackdropChanged)
    // Drives the slide. A property on the controller rather than on the window,
    // because the composition path has no QWindow to animate -- one slide
    // implementation serves both.
    Q_PROPERTY(int surfaceX READ surfaceX WRITE setSurfaceX)

public:
    PanelWindowController(SettingsStore* settings, HelperServer* helper,
                          QQuickWebEngineProfile* webProfile, QObject* parent = nullptr);
    // Defined out of line: m_target is a unique_ptr to a forward-declared type,
    // so the destructor must be emitted where PanelSurfaceTarget is complete.
    ~PanelWindowController() override;

    void attach(QQuickWindow* window);

    // Composition path: the scene is hosted in an HWND with no QWindow, so the
    // controller is handed a target directly. Takes ownership.
    void attachTarget(PanelSurfaceTarget* target, QQuickWindow* sceneWindow);

    int surfaceX() const;
    void setSurfaceX(int x);
    // Lets the backdrop follow the system transparency preference live. Must be
    // called before attach() so the first chrome application already honours it.
    void setSystemTheme(SystemTheme* theme);

    bool pinned() const { return m_pinned; }
    bool panelVisible() const { return m_panelVisible; }
    QString graphicsApiName() const { return m_graphicsApiName; }

    Q_INVOKABLE void showPanel();
    Q_INVOKABLE void hidePanel(bool force = false);
    Q_INVOKABLE void togglePanel();
    Q_INVOKABLE void togglePin();
    Q_INVOKABLE void setModalOpen(bool open);
    Q_INVOKABLE void startResize();
    Q_INVOKABLE void endResize();
    // Port of the panel-fit-mode IPC: 'base' sizes to the visible columns,
    // stage modes (news/monitor/live) expand to the full work area.
    Q_INVOKABLE bool fitMode(const QString& mode, int columnCount, const QVariantMap& colWidths);
    // Active layout mode, remembered so hide/show re-applies the width that
    // belongs to the mode currently on screen instead of the base width.
    QString mode() const { return m_mode; }
    // Web spotlight: expands to the six-column surface and embeds Qt WebEngine
    // in columns four through six.
    Q_INVOKABLE void openIsland(const QString& url);
    Q_INVOKABLE void openPressReader(const QString& url);
    Q_INVOKABLE void navigateIsland(const QString& url);
    Q_INVOKABLE void reloadIsland();
    Q_INVOKABLE void backIsland();
    Q_INVOKABLE void forwardIsland();
    Q_INVOKABLE QString runIslandScript(const QString& script);
    Q_INVOKABLE void reportIslandState(const QString& url, const QString& title,
                                       bool loading, bool canGoBack,
                                       bool canGoForward, const QString& error = {});
    Q_INVOKABLE void completeIslandScript(const QString& id, const QVariant& result,
                                          const QString& error = {});
    Q_INVOKABLE void reportIslandRenderTerminated(int status, int exitCode);
    Q_INVOKABLE bool openExternal(const QString& url);
    Q_INVOKABLE void captureTradingViewSession();
    Q_INVOKABLE void closeIsland();
    // Settings surface (persists to the wp-* keys, applies live).
    Q_INVOKABLE double windowOpacity() const;
    Q_INVOKABLE void setWindowOpacity(double value);
    Q_INVOKABLE double pinnedOpacityValue() const { return pinnedOpacity(); }
    Q_INVOKABLE void setPinnedOpacity(double value);
    Q_INVOKABLE bool autostart() const;
    Q_INVOKABLE void setAutostart(bool enabled);
    // DWM system backdrop: mica (docked, wallpaper-tinted) vs acrylic
    // (live desktop blur). Applies immediately and persists.
    bool micaBackdrop() const { return m_micaBackdrop; }
    Q_INVOKABLE void setMicaBackdrop(bool mica);
    // While following the system material the backdrop is forced to acrylic,
    // because that is what Start and the shell flyouts use. The stored mica
    // preference is left untouched so it returns when the mode is turned off.
    Q_INVOKABLE void setFollowSystemMaterial(bool follow);
    Q_INVOKABLE void quit();

    bool islandOpen() const { return m_islandOpen; }
    QString islandKind() const { return m_islandKind; }
    QString islandUrl() const { return m_islandUrl; }
    int islandX() const { return m_islandPanelWidth; }
    bool islandLoading() const { return m_islandLoading; }
    QString islandStatus() const { return m_islandStatus; }
    QString islandError() const { return m_islandError; }
    QString islandTitle() const { return m_islandTitle; }
    bool islandCanGoBack() const { return m_islandCanGoBack; }
    bool islandCanGoForward() const { return m_islandCanGoForward; }
    QString islandReadyState() const { return m_islandReadyState; }

signals:
    void pinnedChanged();
    void micaBackdropChanged();
    void panelVisibleChanged();
    void graphicsApiNameChanged();
    void islandChanged();
    void islandScriptResult(const QString& id, const QVariant& result,
                            const QString& error);
    void islandOpenRequested(const QString& url);
    void pressReaderOpenRequested(const QString& url);
    void islandNavigateRequested(const QString& url);
    void islandReloadRequested();
    void islandBackRequested();
    void islandForwardRequested();
    void islandCloseRequested();
    void islandScriptRequested(const QString& id, const QString& script);
    void tradingViewSessionCaptured();

private:
    void completeHide();
    int hiddenWindowX() const;
    int slideDuration() const;
    void onActiveChanged();
    void onClickOutside();
    void onResizeTick();
    void applyWorkArea();
    void notifyHelperHwnds();
    void captureTradingViewCookies();
    void startIslandLoad(const QString& status);
    void openSpotlight(const QString& url, const QString& kind);
    void failIslandLoad(const QString& error);
    void setPanelVisibleState(bool visible);
    void resolveGraphicsApiName();
    QString autostartCommand() const;
    double pinnedOpacity() const;
    int storedWidth() const;
    // Column count the given mode renders (mirrors PanelSurface.columnCount):
    // monitor/live are always 6, news has its own key, base uses wp-base-columns.
    int columnsForMode(const QString& mode) const;
    // Width that belongs to a mode — used on show so the panel returns at the
    // size of the mode on screen, not whatever base last stored.
    int widthForMode(const QString& mode) const;
    QVariantMap storedColumnWidths() const;
    int fullPanelWidth() const;
    int basePanelWidth(int baseColumnCount, const QVariantMap& colWidths) const;

    static constexpr int kPanelHorizontalGap = 5;
    static constexpr int kPanelVerticalGap = 10;
    static constexpr int kSlideMs = 390;          // PANEL_SLIDE_MS
    static constexpr int kDividerWidth = 4;       // PANEL_DIVIDER_WIDTH
    static constexpr int kResizeHandleWidth = 5;  // PANEL_RESIZE_HANDLE_WIDTH
    static constexpr int kMinPanelWidth = 320;

    SettingsStore* m_settings = nullptr;
    HelperServer* m_helper = nullptr;
    QQuickWebEngineProfile* m_webProfile = nullptr;
    QHash<QString, QNetworkCookie> m_webCookies;
    QPointer<QQuickWindow> m_window;
    // Every window operation goes through this rather than m_window directly,
    // so the composition path (which has no QWindow) shares one implementation
    // of the geometry, slide and pin logic instead of duplicating it.
    // Owned; created by attach() or attachTarget().
    std::unique_ptr<PanelSurfaceTarget> m_target;
    WorkAreaWatcher m_workArea;
    FocusPolicy m_focus;

    bool systemTransparency() const;

    bool effectiveMica() const { return m_micaBackdrop && !m_followSystemMaterial; }

    SystemTheme* m_systemTheme = nullptr;
    bool m_pinned = false;
    bool m_micaBackdrop = true;
    bool m_followSystemMaterial = false;
    bool m_panelVisible = false;
    bool m_showAnimating = false;
    bool m_hiding = false;
    bool m_islandOpen = false;
    QString m_islandKind;
    bool m_islandLoading = false;
    QString m_islandUrl;
    QString m_islandStatus;
    QString m_islandError;
    QString m_islandTitle;
    bool m_islandCanGoBack = false;
    bool m_islandCanGoForward = false;
    QString m_islandReadyState;
    int m_islandPanelWidth = 0;
    QString m_mode = QStringLiteral("base");
    int m_islandRestoreWidth = 0;
    qint64 m_geometryLockUntil = 0;
    QString m_graphicsApiName = QStringLiteral("starting");

    QTimer m_hideFallback;
    QPropertyAnimation m_slideAnimation;
    QTimer m_resizeTimer;
    QTimer m_helperStateDelay;
    QTimer m_islandReadyTimeout;
    quint64 m_nextIslandScriptId = 0;
    int m_resizeStartX = 0;
    int m_resizeStartW = 0;
};

} // namespace qtpanel
