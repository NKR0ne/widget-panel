#pragma once

#include <QObject>
#include <QPointer>
#include <QHash>
#include <QNetworkCookie>
#include <QString>
#include <QTimer>
#include <QPropertyAnimation>
#include <QVariantMap>

#include "FocusPolicy.h"
#include "WorkAreaWatcher.h"

class QQuickWindow;
class QQuickWebEngineProfile;

namespace qtpanel {

class HelperServer;
class SettingsStore;

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

public:
    PanelWindowController(SettingsStore* settings, HelperServer* helper,
                          QQuickWebEngineProfile* webProfile, QObject* parent = nullptr);

    void attach(QQuickWindow* window);

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
    WorkAreaWatcher m_workArea;
    FocusPolicy m_focus;

    bool m_pinned = false;
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
