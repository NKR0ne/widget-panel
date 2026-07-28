#pragma once

// Hosts the Qt scene inside a Windows composition tree so the panel sits on
// Microsoft's own acrylic instead of our reconstruction of it.
//
// Why this exists at all: DWMSBT_TRANSIENTWINDOW hands us a finished acrylic
// surface. Everything we draw afterwards can only cover it, so the luminosity
// blend -- the stage that re-maps the backdrop's luminance and lets bright
// things behind stay bright -- is unreachable by construction. That is the
// difference the Start menu shows and no amount of tint tuning closes it.
// DesktopAcrylicController runs the same code the shell does and exposes
// LuminosityOpacity directly.
//
// Structure (all verified in native/qt-composition-spike before landing here):
//
//   one shared ID3D11Device
//     -> Compositor          (ICompositorInterop::CreateGraphicsDevice)
//        -> CompositionDrawingSurface -> SpriteVisual   [content, on top]
//     -> QQuickRenderControl + offscreen QQuickWindow   [draws the content]
//   DesktopChildSiteBridge + ContentIsland
//     -> DesktopAcrylicController                       [material, behind]
//
// The scene is laid out in DIPs at the island's ActualSize and rasterized at
// ActualSize * RasterizationScale, so QML metrics match the windowed path.

#include <QObject>
#include <QPointer>
#include <QSize>

#include <windows.h>

class QQuickItem;
class QQuickRenderControl;
class QQuickWindow;
class QQmlEngine;

class CompositionPanelHost : public QObject
{
    Q_OBJECT

public:
    explicit CompositionPanelHost(QObject* parent = nullptr);
    ~CompositionPanelHost() override;

    // Builds the HWND, the composition tree and the Qt render target, then
    // instantiates `rootItem` from `engine` as the scene root. Returns false
    // with a logged reason rather than throwing; the caller is expected to fall
    // back to the ordinary windowed path.
    bool initialize(QQmlEngine* engine, const QString& rootItemUri,
                    const QString& rootItemName, const QSize& initialSize);

    // The host window. Geometry, slide, pin and blur-hide act on this, not on
    // the offscreen QQuickWindow, which has no native window of its own.
    HWND hwnd() const { return m_hwnd; }

    // The offscreen window the scene lives in. Usable for QML context and for
    // sending input, but it must never be shown: it has no native surface.
    QQuickWindow* quickWindow() const { return m_quickWindow; }
    QQuickItem* rootItem() const;

    // Tint follows the accent palette exactly as the in-scene material does,
    // so the two paths stay visually comparable while both exist.
    // Colours the material without applying a tint wash. TintColor feeds the
    // luminosity layer as well as the tint layer, so at Start's own tint
    // opacity of 0 it still casts colour -- which is how the shell tints
    // without turning the surface into a slab.
    void setTintColor(const QColor& tint);
    void setTint(const QColor& tint, float tintOpacity, float luminosityOpacity);
    void setDarkTheme(bool dark);

    // Acrylic has a distinct inactive state, and Windows expects the host to
    // report activation rather than inferring it. Left unset, the backdrop
    // keeps whatever state it had at construction, so the panel looks different
    // before and after it is first activated.
    void setInputActive(bool active);

    // Applied to the composition root visual rather than via a layered window:
    // WS_EX_NOREDIRECTIONBITMAP and WS_EX_LAYERED are mutually exclusive in
    // practice, and this composites correctly against the backdrop behind it.
    void setRootOpacity(float opacity);

    bool isValid() const { return m_valid; }

signals:
    void sizeChanged(const QSize& dipSize, qreal scale);

    // Activation of the host window. The windowed path gets this from
    // QWindow::activeChanged; the composition path has no QWindow, so without
    // this the controller never learns the panel lost focus and blur-hide --
    // wired identically in both paths -- simply never fires.
    void hostActiveChanged(bool active);

private:
    struct Private;
    Private* d = nullptr;

    HWND m_hwnd = nullptr;
    QQuickRenderControl* m_renderControl = nullptr;
    QQuickWindow* m_quickWindow = nullptr;
    QPointer<QQuickItem> m_rootItem;
    bool m_valid = false;

    bool initializeInner(QQmlEngine* engine, const QString& rootItemUri,
                         const QString& rootItemName, const QSize& initialSize);
    bool createHostWindow(const QSize& size);
    bool createCompositionTree();
    bool createQtRenderPath();
    void wireInput();
    // Synthesises the pointer moves the island withholds while a button is
    // held, without which no DragHandler in the scene ever sees a drag.
    void pumpHeldPointer();
    void resizeToIsland();
    void renderFrame();
    void requestRender();
};
