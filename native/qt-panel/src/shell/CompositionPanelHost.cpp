#include "CompositionPanelHost.h"

#include <d3d11.h>

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

#include <QColor>
#include <QCoreApplication>
#include <QDebug>
#include <QMouseEvent>
#include <QQmlComponent>
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
}

// WinRT types are kept out of the header so translation units that merely
// include this class do not need the C++/WinRT projections on their include
// path.
struct CompositionPanelHost::Private
{
    winrt::com_ptr<ID3D11Device> device;
    winrt::com_ptr<ID3D11DeviceContext> context;
    winrt::com_ptr<ID3D11Texture2D> qtTexture;
    mucomp::ContainerVisual rootVisual{ nullptr };

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
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

} // namespace

CompositionPanelHost::CompositionPanelHost(QObject* parent)
    : QObject(parent), d(new Private)
{
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
    root.RelativeSizeAdjustment({ 1.0f, 1.0f });
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
    contentVisual.RelativeSizeAdjustment({ 1.0f, 1.0f });
    contentVisual.Brush(d->compositor.CreateSurfaceBrush(d->surface));
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
        // Island coordinates and Qt logical coordinates are both DIPs, so no
        // conversion is needed.
        const QPointF p(pos.X, pos.Y);
        QMouseEvent ev(type, p, p, p, button, buttons, Qt::NoModifier);
        QCoreApplication::sendEvent(m_quickWindow, &ev);
    };

    d->pointerSource.PointerMoved([send](auto&&, const muinput::PointerEventArgs& args) {
        const auto pt = args.CurrentPoint();
        send(QEvent::MouseMove, pt.Position(), Qt::NoButton,
             pt.Properties().IsLeftButtonPressed() ? Qt::LeftButton : Qt::NoButton);
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
        if (m_quickWindow) {
            QEvent leave(QEvent::Leave);
            QCoreApplication::sendEvent(m_quickWindow, &leave);
        }
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
    d->needsRender = true;
    emit sizeChanged(QSize(qRound(dip.x), qRound(dip.y)), scale);
}

void CompositionPanelHost::renderFrame()
{
    if (!m_renderControl || !d->surface || !d->qtTexture) return;
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

    auto* timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, &CompositionPanelHost::renderFrame);
    timer->start(8);

    g_activeHost = this;
    m_valid = true;
    qInfo() << "[composition] host ready";
    return true;
}
