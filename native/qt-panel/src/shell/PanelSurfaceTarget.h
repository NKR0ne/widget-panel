#pragma once

// The window operations PanelWindowController performs, behind one interface.
//
// The composition path has no QWindow: the scene lives in an offscreen
// QQuickWindow with no native surface, and the real window is an HWND the
// compositor presents into. Geometry, slide, pin and blur-hide therefore cannot
// go through QWindow at all.
//
// This exists instead of `if (composition)` branches inside the controller.
// There are five separate places that set geometry and slide the panel, and
// scattering the condition through them would mean every future geometry change
// has to be made twice and kept in sync by hand -- which is exactly the kind of
// duplication that rots once one path is retired.

#include <QRect>
#include <QWindow>

class QQuickWindow;
class QScreen;
class CompositionPanelHost;

class PanelSurfaceTarget
{
public:
    virtual ~PanelSurfaceTarget() = default;

    virtual bool isVisible() const = 0;
    virtual int x() const = 0;
    virtual int width() const = 0;
    virtual void setGeometry(const QRect& geometry) = 0;
    // QWindow offers this overload and the controller uses it in five places;
    // providing it here keeps those call sites unchanged.
    void setGeometry(int x, int y, int w, int h) { setGeometry(QRect(x, y, w, h)); }
    virtual void setX(int x) = 0;
    virtual void setOpacity(qreal opacity) = 0;
    virtual void show() = 0;
    virtual void hide() = 0;
    virtual void raise() = 0;
    virtual void requestActivate() = 0;
    virtual bool isActive() const = 0;
    virtual QScreen* screen() const = 0;
    virtual WId winId() const = 0;

    // The scene's window. Present in both modes -- offscreen in the composition
    // path -- and used for the QML context and the renderer interface, never
    // for geometry.
    virtual QQuickWindow* quickWindow() const = 0;
};

// Windowed path: a straight pass-through to the QQuickWindow the QML Window
// creates.
class QQuickWindowTarget : public PanelSurfaceTarget
{
public:
    explicit QQuickWindowTarget(QQuickWindow* window);

    bool isVisible() const override;
    int x() const override;
    int width() const override;
    void setGeometry(const QRect& geometry) override;
    void setX(int x) override;
    void setOpacity(qreal opacity) override;
    void show() override;
    void hide() override;
    void raise() override;
    void requestActivate() override;
    bool isActive() const override;
    QScreen* screen() const override;
    WId winId() const override;
    QQuickWindow* quickWindow() const override { return m_window; }

private:
    QQuickWindow* m_window = nullptr;
};

// Composition path: geometry acts on the host HWND.
//
// Note the coordinate space. QWindow geometry is in logical DIPs and the
// controller computes its layout from QScreen, which is also DIPs -- but Win32
// SetWindowPos takes physical pixels. Every geometry value crossing this
// boundary is scaled by the device pixel ratio, and forgetting that puts the
// panel at 57% of its intended size and position on a 175% display.
class CompositionSurfaceTarget : public PanelSurfaceTarget
{
public:
    explicit CompositionSurfaceTarget(CompositionPanelHost* host);

    bool isVisible() const override;
    int x() const override;
    int width() const override;
    void setGeometry(const QRect& geometry) override;
    void setX(int x) override;
    void setOpacity(qreal opacity) override;
    void show() override;
    void hide() override;
    void raise() override;
    void requestActivate() override;
    bool isActive() const override;
    QScreen* screen() const override;
    WId winId() const override;
    QQuickWindow* quickWindow() const override;

private:
    qreal scaleFactor() const;
    CompositionPanelHost* m_host = nullptr;
};
