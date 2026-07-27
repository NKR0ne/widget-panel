// Phase 3 spike: put a live Qt Quick scene on top of Microsoft's own acrylic.
//
// Phase 0 proved DesktopAcrylicController renders. It did not answer the
// question the port actually depends on: can Qt's scene graph draw INTO that
// composition tree, so the material sits behind real UI instead of behind an
// empty window?
//
// Chain under test:
//   one shared ID3D11Device
//     -> Compositor (via ICompositorInterop::CreateGraphicsDevice)
//        -> CompositionDrawingSurface -> SpriteVisual  [content, on top]
//     -> QQuickRenderControl + QQuickWindow            [draws the content]
//   DesktopChildSiteBridge + ContentIsland
//     -> DesktopAcrylicController                      [material, behind]
//
// The load-bearing choice is QQuickGraphicsDevice::fromDeviceAndContext: Qt is
// handed the SAME D3D11 device the compositor renders with, so the texture Qt
// draws into is already the compositor's to read. The alternative -- two
// devices and a shared/keyed-mutex texture -- is a great deal more machinery
// and buys nothing here.
//
// Qt renders into its own texture which is then blitted into whatever texture
// BeginDraw hands back, at the offset it reports. BeginDraw is allowed to
// return a region of a shared atlas rather than a dedicated surface, so
// rendering straight into it and ignoring updateOffset works right up until the
// compositor decides to atlas, and then draws in the wrong place.

#include <windows.h>
#include <d3d11.h>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.Graphics.h>
// WinAppSDK ships its OWN DirectXPixelFormat/DirectXAlphaMode under
// Microsoft.Graphics.DirectX. CreateDrawingSurface takes those, and the
// identically named Windows.Graphics.DirectX types will not convert.
#include <winrt/Microsoft.Graphics.DirectX.h>
#include <winrt/Microsoft.UI.h>
#include <winrt/Microsoft.UI.Dispatching.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.SystemBackdrops.h>
#include <winrt/Microsoft.UI.Content.h>
#include <winrt/Microsoft.UI.Composition.Interop.h>

#include <QGuiApplication>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickGraphicsDevice>
#include <QQuickItem>
#include <QQuickRenderControl>
#include <QQuickRenderTarget>
#include <QQuickWindow>
#include <QTimer>
#include <QUrl>
#include <QDir>
#include <QDebug>

#include <cstdio>

namespace mucomp = winrt::Microsoft::UI::Composition;
namespace backdrops = winrt::Microsoft::UI::Composition::SystemBackdrops;
namespace content = winrt::Microsoft::UI::Content;
namespace mgdx = winrt::Microsoft::Graphics::DirectX;

namespace {

struct Stage {
    winrt::com_ptr<ID3D11Device> device;
    winrt::com_ptr<ID3D11DeviceContext> context;
    winrt::com_ptr<ID3D11Texture2D> qtTexture;   // Qt's render target
    mucomp::CompositionDrawingSurface surface{ nullptr };
    QQuickRenderControl* renderControl = nullptr;
    QQuickWindow* quickWindow = nullptr;
    int width = 0;
    int height = 0;
};

Stage g_stage;
content::DesktopChildSiteBridge g_bridge{ nullptr };

LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    if (msg == WM_KEYDOWN && wp == VK_ESCAPE) { DestroyWindow(hwnd); return 0; }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// One frame: Qt renders into its own texture, then that texture is blitted into
// the composition surface.
void renderFrame()
{
    if (!g_stage.renderControl || !g_stage.surface) return;

    g_stage.renderControl->polishItems();
    g_stage.renderControl->beginFrame();
    g_stage.renderControl->sync();
    g_stage.renderControl->render();
    g_stage.renderControl->endFrame();

    auto interop = g_stage.surface.as<mucomp::ICompositionDrawingSurfaceInterop>();
    winrt::com_ptr<ID3D11Texture2D> target;
    POINT offset{};
    const HRESULT hr = interop->BeginDraw(nullptr, winrt::guid_of<ID3D11Texture2D>(),
                                          target.put_void(), &offset);
    if (FAILED(hr)) {
        std::printf("[qtspike] BeginDraw failed 0x%08X\n", static_cast<unsigned>(hr));
        return;
    }

    D3D11_BOX box{};
    box.left = 0; box.top = 0; box.front = 0;
    box.right = static_cast<UINT>(g_stage.width);
    box.bottom = static_cast<UINT>(g_stage.height);
    box.back = 1;
    g_stage.context->CopySubresourceRegion(target.get(), 0,
                                           static_cast<UINT>(offset.x),
                                           static_cast<UINT>(offset.y),
                                           0, g_stage.qtTexture.get(), 0, &box);
    interop->EndDraw();
}

} // namespace

int main(int argc, char** argv)
{
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    // Before QGuiApplication, and before any window: composition content does
    // not travel through the DPI-virtualized redirection bitmap, so without
    // this the island presents nothing while reporting perfect health.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    QGuiApplication app(argc, argv);
    std::printf("[qtspike] QGuiApplication up\n");

    // Qt initialises COM on this thread; ask for the apartment we need and
    // tolerate it already being what we asked for.
    try { winrt::init_apartment(winrt::apartment_type::single_threaded); }
    catch (const winrt::hresult_error& e) {
        std::printf("[qtspike] init_apartment: 0x%08X (continuing)\n",
                    static_cast<unsigned>(e.code().value));
    }

    const int W = 900, H = 700;
    g_stage.width = W;
    g_stage.height = H;

    // --- shared D3D11 device -------------------------------------------------
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags,
                                   nullptr, 0, D3D11_SDK_VERSION,
                                   g_stage.device.put(), nullptr, g_stage.context.put());
    if (FAILED(hr)) { std::printf("[qtspike] D3D11CreateDevice failed 0x%08X\n", (unsigned)hr); return 1; }
    std::printf("[qtspike] D3D11 device created\n");

    auto dq = winrt::Microsoft::UI::Dispatching::DispatcherQueueController::CreateOnCurrentThread();
    std::printf("[qtspike] dispatcher queue created\n");

    // --- host window ---------------------------------------------------------
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = wndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"QtCompositionSpikeWindow";
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassExW(&wc);

    const HWND hwnd = CreateWindowExW(WS_EX_NOREDIRECTIONBITMAP, wc.lpszClassName,
                                      L"Qt on Windows acrylic", WS_OVERLAPPEDWINDOW,
                                      200, 200, W, H, nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) { std::printf("[qtspike] CreateWindowExW failed\n"); return 1; }

    mucomp::Compositor compositor{};
    const winrt::Microsoft::UI::WindowId windowId{ reinterpret_cast<uint64_t>(hwnd) };
    auto bridge = content::DesktopChildSiteBridge::Create(compositor, windowId);
    g_bridge = bridge;
    bridge.ResizePolicy(content::ContentSizePolicy::ResizeContentToParentWindow);

    auto root = compositor.CreateContainerVisual();
    root.RelativeSizeAdjustment({ 1.0f, 1.0f });
    auto island = content::ContentIsland::Create(root);
    bridge.Connect(island);

    // --- composition surface Qt draws into -----------------------------------
    auto compositorInterop = compositor.as<mucomp::ICompositorInterop>();
    mucomp::ICompositionGraphicsDevice graphicsDevice{ nullptr };
    hr = compositorInterop->CreateGraphicsDevice(g_stage.device.get(), &graphicsDevice);
    if (FAILED(hr)) { std::printf("[qtspike] CreateGraphicsDevice failed 0x%08X\n", (unsigned)hr); return 1; }
    std::printf("[qtspike] composition graphics device created\n");

    g_stage.surface = graphicsDevice.CreateDrawingSurface(
        { static_cast<float>(W), static_cast<float>(H) },
        mgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        mgdx::DirectXAlphaMode::Premultiplied);

    auto contentVisual = compositor.CreateSpriteVisual();
    contentVisual.RelativeSizeAdjustment({ 1.0f, 1.0f });
    contentVisual.Brush(compositor.CreateSurfaceBrush(g_stage.surface));
    root.Children().InsertAtTop(contentVisual);
    std::printf("[qtspike] content visual attached\n");

    // --- Qt render target ----------------------------------------------------
    D3D11_TEXTURE2D_DESC td{};
    td.Width = W; td.Height = H; td.MipLevels = 1; td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    hr = g_stage.device->CreateTexture2D(&td, nullptr, g_stage.qtTexture.put());
    if (FAILED(hr)) { std::printf("[qtspike] CreateTexture2D failed 0x%08X\n", (unsigned)hr); return 1; }

    auto* renderControl = new QQuickRenderControl();
    auto* quickWindow = new QQuickWindow(renderControl);
    g_stage.renderControl = renderControl;
    g_stage.quickWindow = quickWindow;

    // Transparent, or the scene paints over the material we went to all this
    // trouble to get behind it.
    quickWindow->setColor(Qt::transparent);
    quickWindow->setGraphicsDevice(
        QQuickGraphicsDevice::fromDeviceAndContext(g_stage.device.get(), g_stage.context.get()));
    quickWindow->setGeometry(0, 0, W, H);

    if (!renderControl->initialize()) {
        std::printf("[qtspike] QQuickRenderControl::initialize FAILED\n");
        return 1;
    }
    std::printf("[qtspike] render control initialised (backend: %s)\n",
                qPrintable(QString::fromLatin1(
                    quickWindow->rendererInterface()->graphicsApi() == QSGRendererInterface::Direct3D11
                        ? "D3D11" : "other")));

    quickWindow->setRenderTarget(QQuickRenderTarget::fromD3D11Texture(
        g_stage.qtTexture.get(), DXGI_FORMAT_B8G8R8A8_UNORM, QSize(W, H), 1));

    // --- QML -----------------------------------------------------------------
    QQmlEngine engine;
    const QString qmlPath = QDir(QCoreApplication::applicationDirPath()).filePath("main.qml");
    QQmlComponent component(&engine, QUrl::fromLocalFile(qmlPath));
    if (component.isError()) {
        for (const QQmlError& e : component.errors())
            std::printf("[qtspike] QML error: %s\n", qPrintable(e.toString()));
        return 1;
    }
    auto* rootItem = qobject_cast<QQuickItem*>(component.create());
    if (!rootItem) { std::printf("[qtspike] QML root is not a QQuickItem\n"); return 1; }
    rootItem->setParentItem(quickWindow->contentItem());
    rootItem->setWidth(W);
    rootItem->setHeight(H);
    std::printf("[qtspike] QML loaded from %s\n", qPrintable(qmlPath));

    // --- backdrop, after the window is on screen -----------------------------
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
    bridge.Show();
    std::printf("[qtspike] window shown, bridge visible=%d\n", bridge.IsVisible() ? 1 : 0);

    backdrops::SystemBackdropConfiguration config{};
    config.IsInputActive(true);
    config.Theme(backdrops::SystemBackdropTheme::Dark);

    static backdrops::DesktopAcrylicController s_acrylic{ nullptr };
    auto target = bridge.try_as<mucomp::ICompositionSupportsSystemBackdrop>();
    if (target) {
        backdrops::DesktopAcrylicController acrylic{};
        s_acrylic = acrylic;
        acrylic.Kind(backdrops::DesktopAcrylicKind::Base);
        acrylic.TintColor(winrt::Windows::UI::Color{ 255, 0x34, 0x3C, 0x51 });
        acrylic.TintOpacity(0.8f);
        acrylic.LuminosityOpacity(0.85f);
        acrylic.SetSystemBackdropConfiguration(config);
        std::printf("[qtspike] acrylic attached: %s\n",
                    acrylic.AddSystemBackdropTarget(target) ? "yes" : "NO");
    } else {
        std::printf("[qtspike] bridge has no ICompositionSupportsSystemBackdrop\n");
    }

    QTimer timer;
    QObject::connect(&timer, &QTimer::timeout, [] { renderFrame(); });
    timer.start(16);

    std::printf("[qtspike] running - Esc to quit\n");
    return app.exec();
}
