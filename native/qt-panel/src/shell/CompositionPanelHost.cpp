#include "CompositionPanelHost.h"

#include <d3d11.h>
#include <dwmapi.h>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Microsoft.Graphics.DirectX.h>
#include <winrt/Microsoft.UI.h>
#include <winrt/Microsoft.UI.Dispatching.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.SystemBackdrops.h>
#include <winrt/Microsoft.UI.Content.h>
#include <winrt/Microsoft.UI.Input.h>
#include <winrt/Microsoft.UI.Composition.Interop.h>

#include <QAnimationDriver>
#include <QColor>
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QDebug>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>

// Input is delivered with QCoreApplication::sendEvent. QWindowSystemInterface
// looks like the more correct route -- it is the path the platform plugin uses,
// and it drives Flickable replay and pointer handler grabs properly -- but it
// QUEUES events for a platform window to drain, and this QQuickWindow is
// offscreen and has none. Nothing arrived, flushWindowSystemEvents included.#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickGraphicsDevice>
#include <QQuickItem>
#include <QQuickRenderControl>
#include <QQuickRenderTarget>
#include <QQuickWindow>
#include <QTimer>

namespace mucomp = winrt::Microsoft::UI::Composition;
namespace backdrops = winrt::Microsoft::UI::Composition::SystemBackdrops;
namespace content = winrt::Microsoft::UI::Content;
namespace muinput = winrt::Microsoft::UI::Input;
namespace mgdx = winrt::Microsoft::Graphics::DirectX;

namespace {
constexpr wchar_t kWindowClass[] = L"WidgetPanelCompositionHost";
CompositionPanelHost* g_activeHost = nullptr;

// Qt drives animations from the render loop of a real QQuickWindow. A
// QQuickRenderControl window has no swap chain and therefore no such clock, so
// without this every QML animation AND the panel slide fall back to a generic
// timer that is not synchronised with when we actually present -- which reads
// exactly as "less instant, less smooth" even though the frame rate looks fine.
class RenderLoopAnimationDriver : public QAnimationDriver
{
public:
    explicit RenderLoopAnimationDriver(QObject* parent = nullptr) : QAnimationDriver(parent)
    {
        m_timer.start();
    }

    void advance() override
    {
        m_elapsed = m_timer.elapsed();
        advanceAnimation();
    }

    qint64 elapsed() const override { return m_elapsed; }

private:
    QElapsedTimer m_timer;
    qint64 m_elapsed = 0;
};
} // namespace

// WinRT types are kept out of the header so translation units that merely
// include this class do not need the C++/WinRT projections on their include
// path.
struct CompositionPanelHost::Private
{
    winrt::com_ptr<ID3D11Device> device;
    winrt::com_ptr<ID3D11DeviceContext> context;
    winrt::com_ptr<ID3D11Texture2D> qtTexture;
    mucomp::ContainerVisual rootVisual{ nullptr };
    mucomp::SpriteVisual contentVisual{ nullptr };
    mucomp::CompositionSurfaceBrush surfaceBrush{ nullptr };

    winrt::Microsoft::UI::Dispatching::DispatcherQueueController dq{ nullptr };
    mucomp::Compositor compositor{ nullptr };
    mucomp::CompositionDrawingSurface surface{ nullptr };
    content::DesktopChildSiteBridge bridge{ nullptr };
    content::ContentIsland island{ nullptr };
    backdrops::DesktopAcrylicController acrylic{ nullptr };
    backdrops::SystemBackdropConfiguration config{ nullptr };

    // Must outlive the function that registers the handlers. As a local it is
    // released on return, taking the registrations with it, and every call
    // still reports success while no event is ever delivered.
    muinput::InputPointerSource pointerSource{ nullptr };
    muinput::InputKeyboardSource keyboardSource{ nullptr };

    RenderLoopAnimationDriver* animationDriver = nullptr;
    Qt::CursorShape lastCursorShape = Qt::ArrowCursor;
    HCURSOR lastCursor = nullptr;
    int pixelWidth = 0;
    int pixelHeight = 0;
    bool needsRender = true;
};

namespace {

LRESULT CALLBACK hostWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    // Pointer input never arrives here: DesktopChildSiteBridge creates its own
    // child window on top, so client-area hit-testing resolves to the bridge.
    // Input comes from InputPointerSource on the island instead.
    // NOT tracking WM_ACTIVATE. Acrylic dims to an inactive state when its
    // window loses focus, which is right for the Start menu -- a transient
    // surface you dismiss -- and wrong here. This panel is an always-on-top
    // sidebar meant to be read WHILE working in other windows, so it is
    // unfocused almost all of the time; following activation makes it spend its
    // life dimmed and change tone every time you click away. Pinned active
    // instead, in setInputActive.
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// QML sets cursorShape on its QQuickWindow, and Qt applies it to that window's
// native handle. Here there isn't one -- the scene lives in an offscreen window
// -- so the shape never reaches the OS and the pointer stays an arrow over
// resize handles, text fields and links. Mapping it across by hand is what
// restores the feedback that tells you a drag will resize.
HCURSOR cursorForShape(Qt::CursorShape shape)
{
    const wchar_t* id = IDC_ARROW;
    switch (shape) {
    case Qt::SizeHorCursor:   case Qt::SplitHCursor: id = IDC_SIZEWE;   break;
    case Qt::SizeVerCursor:   case Qt::SplitVCursor: id = IDC_SIZENS;   break;
    case Qt::SizeFDiagCursor:                        id = IDC_SIZENWSE; break;
    case Qt::SizeBDiagCursor:                        id = IDC_SIZENESW; break;
    case Qt::SizeAllCursor:                          id = IDC_SIZEALL;  break;
    case Qt::IBeamCursor:                            id = IDC_IBEAM;    break;
    case Qt::PointingHandCursor:                     id = IDC_HAND;     break;
    case Qt::WaitCursor:                             id = IDC_WAIT;     break;
    case Qt::BusyCursor:                             id = IDC_APPSTARTING; break;
    case Qt::ForbiddenCursor:                        id = IDC_NO;       break;
    case Qt::CrossCursor:                            id = IDC_CROSS;    break;
    default: break;
    }
    return LoadCursorW(nullptr, id);
}

// Modifier state comes from the OS rather than the event: KeyEventArgs carries
// the key that changed, not the state of the others.
Qt::KeyboardModifiers currentModifiers()
{
    Qt::KeyboardModifiers m = Qt::NoModifier;
    if (GetKeyState(VK_SHIFT) & 0x8000)   m |= Qt::ShiftModifier;
    if (GetKeyState(VK_CONTROL) & 0x8000) m |= Qt::ControlModifier;
    if (GetKeyState(VK_MENU) & 0x8000)    m |= Qt::AltModifier;
    return m;
}

// Only the keys that do not arrive as characters. Printable input comes through
// CharacterReceived, which has already been through the keyboard layout and
// dead-key composition -- reconstructing it from virtual keys would break every
// accented character on this French layout.
int qtKeyForVirtualKey(quint32 vk)
{
    switch (vk) {
    case VK_BACK:   return Qt::Key_Backspace;
    case VK_TAB:    return Qt::Key_Tab;
    case VK_RETURN: return Qt::Key_Return;
    case VK_ESCAPE: return Qt::Key_Escape;
    case VK_PRIOR:  return Qt::Key_PageUp;
    case VK_NEXT:   return Qt::Key_PageDown;
    case VK_END:    return Qt::Key_End;
    case VK_HOME:   return Qt::Key_Home;
    case VK_LEFT:   return Qt::Key_Left;
    case VK_UP:     return Qt::Key_Up;
    case VK_RIGHT:  return Qt::Key_Right;
    case VK_DOWN:   return Qt::Key_Down;
    case VK_DELETE: return Qt::Key_Delete;
    case VK_INSERT: return Qt::Key_Insert;
    default:
        if (vk >= VK_F1 && vk <= VK_F24) return Qt::Key_F1 + (vk - VK_F1);
        return 0;
    }
}

} // namespace

CompositionPanelHost::CompositionPanelHost(QObject* parent)
    : QObject(parent), d(new Private)
{
    // Set here, not at the end of initialize(): WM_ACTIVATE can arrive during
    // ShowWindow, which happens well before initialize() returns, and the
    // activation state that first message carries is the one the backdrop
    // starts from.
    g_activeHost = this;
}

CompositionPanelHost::~CompositionPanelHost()
{
    if (g_activeHost == this) g_activeHost = nullptr;
    delete d;
}

QQuickItem* CompositionPanelHost::rootItem() const { return m_rootItem; }

bool CompositionPanelHost::createHostWindow(const QSize& size)
{
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = hostWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = kWindowClass;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassExW(&wc);

    // Frameless, tool window, always on top: the same chrome the windowed path
    // asks Qt for, applied directly because there is no QWindow to ask.
    m_hwnd = CreateWindowExW(
        WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
        kWindowClass, L"Widget Panel", WS_POPUP,
        0, 0, size.width(), size.height(),
        nullptr, nullptr, wc.hInstance, nullptr);
    if (!m_hwnd) {
        qWarning() << "[composition] CreateWindowExW failed:" << GetLastError();
        return false;
    }

    // Round the WINDOW, not the painted surface. The backdrop fills the whole
    // window rect, so a rounded Rectangle drawn in QML sits over square acrylic
    // -- the corner tessellation shows through that mismatch as small triangles
    // on the arc. DWM's own corner preference rounds the window itself,
    // backdrop included, and gives the same radius the shell uses.
    const DWM_WINDOW_CORNER_PREFERENCE corner = DWMWCP_ROUND;
    const HRESULT hr = DwmSetWindowAttribute(m_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
                                             &corner, sizeof(corner));
    if (FAILED(hr))
        qWarning() << "[composition] rounded corners unavailable" << Qt::hex << hr;
    return true;
}

bool CompositionPanelHost::createCompositionTree()
{
    const UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags,
                                   nullptr, 0, D3D11_SDK_VERSION,
                                   d->device.put(), nullptr, d->context.put());
    if (FAILED(hr)) {
        qWarning() << "[composition] D3D11CreateDevice failed" << Qt::hex << hr;
        return false;
    }

    d->dq = winrt::Microsoft::UI::Dispatching::DispatcherQueueController::CreateOnCurrentThread();
    d->compositor = mucomp::Compositor{};

    const winrt::Microsoft::UI::WindowId windowId{ reinterpret_cast<uint64_t>(m_hwnd) };
    d->bridge = content::DesktopChildSiteBridge::Create(d->compositor, windowId);
    d->bridge.ResizePolicy(content::ContentSizePolicy::ResizeContentToParentWindow);

    auto root = d->compositor.CreateContainerVisual();
    d->rootVisual = root;
    d->island = content::ContentIsland::Create(root);
    d->bridge.Connect(d->island);

    // This island is transparent by design -- that is how the acrylic shows
    // through -- and a transparent island is not hit-tested by default, so
    // without this no pointer event is ever delivered.
    d->island.IsHitTestVisibleWhenTransparent(true);
    d->island.IsIslandEnabled(true);
    d->island.IsIslandVisible(true);

    auto compositorInterop = d->compositor.as<mucomp::ICompositorInterop>();
    mucomp::ICompositionGraphicsDevice graphicsDevice{ nullptr };
    hr = compositorInterop->CreateGraphicsDevice(d->device.get(), &graphicsDevice);
    if (FAILED(hr)) {
        qWarning() << "[composition] CreateGraphicsDevice failed" << Qt::hex << hr;
        return false;
    }

    d->surface = graphicsDevice.CreateDrawingSurface(
        { 1.0f, 1.0f },
        mgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        mgdx::DirectXAlphaMode::Premultiplied);

    auto contentVisual = d->compositor.CreateSpriteVisual();
    d->contentVisual = contentVisual;
    // Sized explicitly in resizeToIsland, NOT by RelativeSizeAdjustment: that is
    // relative to the PARENT, and the root visual of an island has no parent, so
    // the root stays 0x0 and everything under it inherits a size that never
    // matches the window. Any disagreement between the visual size and the
    // surface size shows up as content drawn at a different scale from where
    // input believes it is -- clicks landing somewhere other than the cursor.
    d->surfaceBrush = d->compositor.CreateSurfaceBrush(d->surface);
    // Fill, so the surface maps 1:1 onto the visual rather than being drawn at
    // its own pixel size inside it.
    d->surfaceBrush.Stretch(mucomp::CompositionStretch::Fill);
    contentVisual.Brush(d->surfaceBrush);
    root.Children().InsertAtTop(contentVisual);

    d->island.StateChanged([this](const content::ContentIsland&,
                                  const content::ContentIslandStateChangedEventArgs& args) {
        if (args.DidActualSizeChange() || args.DidRasterizationScaleChange())
            resizeToIsland();
    });
    return true;
}

bool CompositionPanelHost::createQtRenderPath()
{
    m_renderControl = new QQuickRenderControl(this);
    m_quickWindow = new QQuickWindow(m_renderControl);

    // Transparent, or the scene paints over the material it is meant to sit on.
    m_quickWindow->setColor(Qt::transparent);
    m_quickWindow->setGraphicsDevice(
        QQuickGraphicsDevice::fromDeviceAndContext(d->device.get(), d->context.get()));

    if (!m_renderControl->initialize()) {
        qWarning() << "[composition] QQuickRenderControl::initialize failed";
        return false;
    }

    // Render on demand. Qt raises these whenever the scene actually needs
    // redrawing, including each step of a running animation, so an idle panel
    // costs nothing instead of a GPU blit and a scene-graph sync every frame.
    connect(m_renderControl, &QQuickRenderControl::renderRequested,
            this, &CompositionPanelHost::requestRender);
    connect(m_renderControl, &QQuickRenderControl::sceneChanged,
            this, &CompositionPanelHost::requestRender);
    return true;
}

void CompositionPanelHost::requestRender() { d->needsRender = true; }

void CompositionPanelHost::wireInput()
{
    d->pointerSource = muinput::InputPointerSource::GetForIsland(d->island);

    auto send = [this](QEvent::Type type, const winrt::Windows::Foundation::Point& pos,
                       Qt::MouseButton button, Qt::MouseButtons buttons) {
        if (!m_quickWindow) return;
        // Island coordinates and Qt logical coordinates are both DIPs, verified
        // by measurement: the pointer reached 1109.71 against a 1112 DIP window,
        // and presses resolved to the item under the cursor. No conversion.
        const QPointF p(pos.X, pos.Y);
        QMouseEvent ev(type, p, p, p, button, buttons, currentModifiers());
        const bool accepted = QCoreApplication::sendEvent(m_quickWindow, &ev);
        // Diagnostic for the unresponsive modal close button: report whether Qt
        // accepted the press and which item it resolved to. "accepted" false
        // means nothing took it; a hit item that is not the button means the
        // press landed elsewhere. Those need different fixes and look identical
        // from outside.
        if (type == QEvent::MouseButtonPress) {
            QQuickItem* hit = m_quickWindow->contentItem()
                ? m_quickWindow->contentItem()->childAt(p.x(), p.y()) : nullptr;
            qInfo() << "[composition] press" << p << "accepted" << accepted
                    << "| evAccepted" << ev.isAccepted()
                    << "| hit" << (hit ? hit->metaObject()->className() : "none")
                    << "| activeFocusItem"
                    << (m_quickWindow->activeFocusItem()
                            ? m_quickWindow->activeFocusItem()->metaObject()->className() : "none");
        }
    };

    d->pointerSource.PointerMoved([this, send](auto&&, const muinput::PointerEventArgs& args) {
        const auto pt = args.CurrentPoint();
        send(QEvent::MouseMove, pt.Position(), Qt::NoButton,
             pt.Properties().IsLeftButtonPressed() ? Qt::LeftButton : Qt::NoButton);
        // AFTER dispatching: sendEvent is synchronous, so QML has already
        // updated hover state and therefore the window's cursor by this point.
        // Applying it here also lands after the system's own WM_SETCURSOR for
        // this move, which would otherwise put the arrow back.
        if (m_quickWindow) {
            const Qt::CursorShape shape = m_quickWindow->cursor().shape();
            if (shape != d->lastCursorShape) {
                d->lastCursorShape = shape;
                d->lastCursor = cursorForShape(shape);
            }
            if (d->lastCursor) SetCursor(d->lastCursor);
        }
    });
    d->pointerSource.PointerPressed([send](auto&&, const muinput::PointerEventArgs& args) {
        send(QEvent::MouseButtonPress, args.CurrentPoint().Position(),
             Qt::LeftButton, Qt::LeftButton);
    });
    d->pointerSource.PointerReleased([send](auto&&, const muinput::PointerEventArgs& args) {
        send(QEvent::MouseButtonRelease, args.CurrentPoint().Position(),
             Qt::LeftButton, Qt::NoButton);
    });
    d->pointerSource.PointerExited([this, send](auto&&, const muinput::PointerEventArgs& args) {
        send(QEvent::MouseMove, args.CurrentPoint().Position(), Qt::NoButton, Qt::NoButton);
        if (m_quickWindow)
        {
            QEvent leave(QEvent::Leave);
            QCoreApplication::sendEvent(m_quickWindow, &leave);
        }
    });

    // Scrolling. Without this every list in the panel -- mail, tasks, agenda,
    // articles -- is stuck at the top.
    d->pointerSource.PointerWheelChanged([this](auto&&, const muinput::PointerEventArgs& args) {
        if (!m_quickWindow) return;
        const auto pt = args.CurrentPoint();
        const auto props = pt.Properties();
        const int delta = props.MouseWheelDelta();
        const QPointF p(pt.Position().X, pt.Position().Y);
        const QPoint angle = props.IsHorizontalMouseWheel() ? QPoint(delta, 0) : QPoint(0, delta);
        QWheelEvent ev(p, p, QPoint(0, 0), angle, Qt::NoButton, currentModifiers(),
                       Qt::NoScrollPhase, false);
        QCoreApplication::sendEvent(m_quickWindow, &ev);
    });

    // Keyboard, in two halves. CharacterReceived carries text that has already
    // been through the layout and dead-key composition; KeyDown/KeyUp carry the
    // keys that never produce characters. Sending both for a printable key would
    // type it twice, so qtKeyForVirtualKey returns 0 for those and they are
    // dropped here.
    d->keyboardSource = muinput::InputKeyboardSource::GetForIsland(d->island);

    d->keyboardSource.KeyDown([this](auto&&, const muinput::KeyEventArgs& args) {
        if (!m_quickWindow) return;
        const int key = qtKeyForVirtualKey(static_cast<quint32>(args.VirtualKey()));
        if (!key) return;
        QKeyEvent ev(QEvent::KeyPress, key, currentModifiers());
        QCoreApplication::sendEvent(m_quickWindow, &ev);
    });
    d->keyboardSource.KeyUp([this](auto&&, const muinput::KeyEventArgs& args) {
        if (!m_quickWindow) return;
        const int key = qtKeyForVirtualKey(static_cast<quint32>(args.VirtualKey()));
        if (!key) return;
        QKeyEvent ev(QEvent::KeyRelease, key, currentModifiers());
        QCoreApplication::sendEvent(m_quickWindow, &ev);
    });
    d->keyboardSource.CharacterReceived([this](auto&&, const muinput::CharacterReceivedEventArgs& args) {
        if (!m_quickWindow) return;
        const auto code = args.KeyCode();
        // Control characters arrive here too (Enter, Backspace, Escape) and are
        // already handled as keys above; passing them again inserts control
        // codes into text fields.
        if (code < 0x20 || code == 0x7F) return;
        const char32_t ucs4 = static_cast<char32_t>(code);
        const QString text = QString::fromUcs4(&ucs4, 1);
        QKeyEvent ev(QEvent::KeyPress, 0, currentModifiers(), text);
        QCoreApplication::sendEvent(m_quickWindow, &ev);
    });
}

void CompositionPanelHost::resizeToIsland()
{
    if (!d->island || !m_quickWindow) return;

    const auto dip = d->island.ActualSize();
    const float scale = d->island.RasterizationScale();
    const int pxW = qMax(1, qRound(dip.x * scale));
    const int pxH = qMax(1, qRound(dip.y * scale));
    if (pxW == d->pixelWidth && pxH == d->pixelHeight) return;

    d->pixelWidth = pxW;
    d->pixelHeight = pxH;

    D3D11_TEXTURE2D_DESC td{};
    td.Width = static_cast<UINT>(pxW);
    td.Height = static_cast<UINT>(pxH);
    td.MipLevels = 1;
    td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    winrt::com_ptr<ID3D11Texture2D> tex;
    if (FAILED(d->device->CreateTexture2D(&td, nullptr, tex.put()))) {
        qWarning() << "[composition] resize: CreateTexture2D failed";
        return;
    }
    d->qtTexture = tex;

    if (d->surface) {
        auto si = d->surface.as<mucomp::ICompositionDrawingSurfaceInterop>();
        SIZE s{ pxW, pxH };
        si->Resize(s);
    }

    // Laid out in DIPs, rasterized at native pixels: QML metrics match the
    // windowed path and text lands on whole device pixels instead of being
    // resampled by the visual's scale.
    auto rt = QQuickRenderTarget::fromD3D11Texture(
        d->qtTexture.get(), DXGI_FORMAT_B8G8R8A8_UNORM, QSize(pxW, pxH), 1);
    rt.setDevicePixelRatio(scale);
    m_quickWindow->setRenderTarget(rt);
    m_quickWindow->setGeometry(0, 0, qRound(dip.x), qRound(dip.y));
    if (m_rootItem) {
        m_rootItem->setWidth(dip.x);
        m_rootItem->setHeight(dip.y);
    }
    // Composition visuals live in the island's DIP space, so both take the DIP
    // size while the surface underneath is the pixel size. Getting this wrong is
    // invisible in a screenshot -- the content still fills the window -- but
    // input and pixels stop agreeing.
    if (d->rootVisual) d->rootVisual.Size({ dip.x, dip.y });
    if (d->contentVisual) d->contentVisual.Size({ dip.x, dip.y });

    d->needsRender = true;
    qInfo() << "[composition] sized: island DIP" << dip.x << dip.y
            << "| scale" << scale
            << "| surface px" << pxW << pxH
            << "| qt window" << m_quickWindow->size()
            << "| root visual" << (d->rootVisual ? d->rootVisual.Size().x : -1)
                               << (d->rootVisual ? d->rootVisual.Size().y : -1);
    emit sizeChanged(QSize(qRound(dip.x), qRound(dip.y)), scale);
}

void CompositionPanelHost::renderFrame()
{
    if (!m_renderControl || !d->surface || !d->qtTexture) return;

    // Advance animations in step with presentation, before deciding whether
    // anything changed: advancing is what MAKES the scene change while an
    // animation is running, so doing it after the needsRender check would stall
    // every animation the moment the scene went quiet.
    if (d->animationDriver) d->animationDriver->advance();

    if (!d->needsRender) return;
    d->needsRender = false;

    m_renderControl->polishItems();
    m_renderControl->beginFrame();
    m_renderControl->sync();
    m_renderControl->render();
    m_renderControl->endFrame();

    auto interop = d->surface.as<mucomp::ICompositionDrawingSurfaceInterop>();
    winrt::com_ptr<ID3D11Texture2D> target;
    POINT offset{};
    const HRESULT hr = interop->BeginDraw(nullptr, winrt::guid_of<ID3D11Texture2D>(),
                                          target.put_void(), &offset);
    if (FAILED(hr)) {
        qWarning() << "[composition] BeginDraw failed" << Qt::hex << hr;
        return;
    }
    // BeginDraw may hand back a region of a shared atlas rather than a
    // dedicated surface, so the reported offset must be honoured; drawing
    // straight into it works until the compositor decides to atlas.
    D3D11_BOX box{};
    box.right = static_cast<UINT>(d->pixelWidth);
    box.bottom = static_cast<UINT>(d->pixelHeight);
    box.back = 1;
    d->context->CopySubresourceRegion(target.get(), 0,
                                      static_cast<UINT>(offset.x),
                                      static_cast<UINT>(offset.y),
                                      0, d->qtTexture.get(), 0, &box);
    interop->EndDraw();
}

void CompositionPanelHost::setTint(const QColor& tint, float tintOpacity, float luminosityOpacity)
{
    if (!d->acrylic) return;
    d->acrylic.TintColor(winrt::Windows::UI::Color{
        255, static_cast<uint8_t>(tint.red()),
        static_cast<uint8_t>(tint.green()),
        static_cast<uint8_t>(tint.blue()) });
    d->acrylic.TintOpacity(tintOpacity);
    d->acrylic.LuminosityOpacity(luminosityOpacity);
}

void CompositionPanelHost::setTintColor(const QColor& tint)
{
    if (!d->acrylic || !tint.isValid()) return;
    d->acrylic.TintColor(winrt::Windows::UI::Color{
        255, static_cast<uint8_t>(tint.red()),
        static_cast<uint8_t>(tint.green()),
        static_cast<uint8_t>(tint.blue()) });
}

void CompositionPanelHost::setInputActive(bool)
{
    // Deliberately ignores the argument and pins active. See wndProc: a
    // glanceable sidebar is unfocused nearly always, so honouring activation
    // would leave it dimmed in normal use and shift tone on every click
    // elsewhere. Holding it active is also what makes the material identical on
    // first launch and after a hide/show cycle, which is the property that was
    // actually wanted.
    if (d->config) d->config.IsInputActive(true);
}

void CompositionPanelHost::setRootOpacity(float opacity)
{
    if (d->rootVisual) d->rootVisual.Opacity(qBound(0.0f, opacity, 1.0f));
}

void CompositionPanelHost::setDarkTheme(bool dark)
{
    if (!d->config) return;
    d->config.Theme(dark ? backdrops::SystemBackdropTheme::Dark
                         : backdrops::SystemBackdropTheme::Light);
}

bool CompositionPanelHost::initialize(QQmlEngine* engine, const QString& rootItemUri,
                                      const QString& rootItemName, const QSize& initialSize)
{
    // Every WinRT activation in here throws on failure, and an uncaught
    // hresult_error terminates the process rather than unwinding. A missing
    // activation manifest yields REGDB_E_CLASSNOTREG (0x80040154) and would
    // otherwise take the whole app down at startup instead of falling back to
    // the windowed path.
    try {
        return initializeInner(engine, rootItemUri, rootItemName, initialSize);
    } catch (const winrt::hresult_error& e) {
        qWarning() << "[composition] failed:" << Qt::hex << static_cast<uint32_t>(e.code().value)
                   << QString::fromWCharArray(e.message().c_str());
        return false;
    } catch (const std::exception& e) {
        qWarning() << "[composition] failed:" << e.what();
        return false;
    }
}

bool CompositionPanelHost::initializeInner(QQmlEngine* engine, const QString& rootItemUri,
                                           const QString& rootItemName, const QSize& initialSize)
{
    if (!createHostWindow(initialSize)) return false;
    if (!createCompositionTree()) return false;
    if (!createQtRenderPath()) return false;

    QQmlComponent component(engine, rootItemUri, rootItemName);
    if (component.isError()) {
        for (const QQmlError& e : component.errors())
            qWarning() << "[composition] QML error:" << e.toString();
        return false;
    }
    auto* item = qobject_cast<QQuickItem*>(component.create(engine->rootContext()));
    if (!item) {
        qWarning() << "[composition] root is not a QQuickItem";
        return false;
    }
    m_rootItem = item;
    item->setParentItem(m_quickWindow->contentItem());

    // The bridge only becomes visible once the host window is on screen; called
    // while it is still hidden, Show() silently leaves IsVisible false and the
    // island never presents a pixel.
    ShowWindow(m_hwnd, SW_SHOW);
    UpdateWindow(m_hwnd);
    d->bridge.Show();

    resizeToIsland();
    wireInput();

    d->config = backdrops::SystemBackdropConfiguration{};
    d->config.IsInputActive(true);
    d->config.Theme(backdrops::SystemBackdropTheme::Dark);

    auto target = d->bridge.try_as<mucomp::ICompositionSupportsSystemBackdrop>();
    if (target) {
        backdrops::DesktopAcrylicController acrylic{};
        if (acrylic.IsSupported()) {
            d->acrylic = acrylic;
            acrylic.Kind(backdrops::DesktopAcrylicKind::Base);
            acrylic.SetSystemBackdropConfiguration(d->config);
            const bool ok = acrylic.AddSystemBackdropTarget(target);
            qInfo() << "[composition] acrylic attached:" << ok;
        } else {
            qWarning() << "[composition] DesktopAcrylicController unsupported";
        }
    } else {
        qWarning() << "[composition] bridge has no ICompositionSupportsSystemBackdrop";
    }

    // Installed only once the scene is live. Qt takes ownership of the driver
    // as the application's animation clock; ours advances from renderFrame so
    // animation time and presentation time cannot drift apart.
    d->animationDriver = new RenderLoopAnimationDriver(this);
    d->animationDriver->install();

    auto* timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, &CompositionPanelHost::renderFrame);
    timer->start(8);

    setInputActive(true);

    m_valid = true;
    qInfo() << "[composition] host ready";
    return true;
}
