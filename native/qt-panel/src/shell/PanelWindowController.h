#pragma once

#include <QObject>
#include <QPointer>
#include <QJsonObject>
#include <QString>
#include <QTimer>
#include <QVariantMap>

#include "FocusPolicy.h"
#include "WorkAreaWatcher.h"

class QQuickWindow;

namespace qtpanel {

class BraveHostClient;
class HelperServer;
class SettingsStore;

// Owns the panel window lifecycle: geometry (gap inset, work-area height,
// fit modes, drag resize), show/hide choreography synchronized with the QML
// slide animation, pin state, blur-to-hide policy, and helper notifications.
// Port of the window-management half of the Electron main.js.
class PanelWindowController : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool pinned READ pinned NOTIFY pinnedChanged)
    Q_PROPERTY(bool panelVisible READ panelVisible NOTIFY panelVisibleChanged)
    Q_PROPERTY(QString graphicsApiName READ graphicsApiName NOTIFY graphicsApiNameChanged)
    Q_PROPERTY(bool islandOpen READ islandOpen NOTIFY islandChanged)
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
                          BraveHostClient* brave, QObject* parent = nullptr);

    void attach(QQuickWindow* window);

    bool pinned() const { return m_pinned; }
    bool panelVisible() const { return m_panelVisible; }
    QString graphicsApiName() const { return m_graphicsApiName; }

    Q_INVOKABLE void showPanel();
    Q_INVOKABLE void hidePanel(bool force = false);
    Q_INVOKABLE void togglePanel();
    Q_INVOKABLE void togglePin();
    // QML calls this when the slide-out animation lands; only then is the
    // native window hidden (with a timeout fallback, like the Electron app).
    Q_INVOKABLE void hideAnimationDone();
    Q_INVOKABLE void setModalOpen(bool open);
    Q_INVOKABLE void startResize();
    Q_INVOKABLE void endResize();
    // Port of the panel-fit-mode IPC: 'base' sizes to the visible columns,
    // stage modes (news/monitor/live) expand to the full work area.
    Q_INVOKABLE bool fitMode(const QString& mode, int baseColumnCount, const QVariantMap& colWidths);
    // Web island: widens the window and parks the brave-host shell beside the
    // panel (port of openBraveInPanel / closeBraveInPanel).
    Q_INVOKABLE void openIsland(const QString& url);
    Q_INVOKABLE void navigateIsland(const QString& url);
    Q_INVOKABLE void reloadIsland();
    Q_INVOKABLE void backIsland();
    Q_INVOKABLE void forwardIsland();
    Q_INVOKABLE void runIslandScript(const QString& script);
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
    void slideInRequested();
    void slideOutRequested();

private:
    void completeHide();
    void onActiveChanged();
    void onClickOutside();
    void onResizeTick();
    void applyWorkArea();
    void notifyHelperHwnds();
    void handleTradingViewCookies(const QJsonObject& payload);
    void handleIslandState(const QJsonObject& payload);
    void startIslandLoad(const QString& status);
    void finishIslandLoad(const QString& status = QStringLiteral("Ready"));
    void failIslandLoad(const QString& error);
    void setPanelVisibleState(bool visible);
    void resolveGraphicsApiName();
    QString autostartCommand() const;
    double pinnedOpacity() const;
    int storedWidth() const;
    int fullPanelWidth() const;
    int basePanelWidth(int baseColumnCount, const QVariantMap& colWidths) const;

    static constexpr int kPanelGap = 10;          // PANEL_GAP
    static constexpr int kSlideMs = 390;          // PANEL_SLIDE_MS
    static constexpr int kDividerWidth = 4;       // PANEL_DIVIDER_WIDTH
    static constexpr int kResizeHandleWidth = 5;  // PANEL_RESIZE_HANDLE_WIDTH
    static constexpr int kMinPanelWidth = 320;

    SettingsStore* m_settings = nullptr;
    HelperServer* m_helper = nullptr;
    BraveHostClient* m_brave = nullptr;
    QPointer<QQuickWindow> m_window;
    WorkAreaWatcher m_workArea;
    FocusPolicy m_focus;

    bool m_pinned = false;
    bool m_panelVisible = false;
    bool m_showAnimating = false;
    bool m_hiding = false;
    bool m_islandOpen = false;
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
    QTimer m_resizeTimer;
    QTimer m_helperStateDelay;
    QTimer m_islandReadyTimeout;
    QTimer m_islandStatePoll;
    int m_resizeStartX = 0;
    int m_resizeStartW = 0;
};

} // namespace qtpanel
