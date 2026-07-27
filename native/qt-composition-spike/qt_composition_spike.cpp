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
#include <winrt/Microsoft.UI.Input.h>
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
#include <QMouseEvent>
#include <QCoreApplication>

#include <cstdio>

namespace mucomp = winrt::Microsoft::UI::Composition;
namespace backdrops = winrt::Microsoft::UI::Composition::SystemBackdrops;
namespace content = winrt::Microsoft::UI::Content;
namespace muinput = winrt::Microsoft::UI::Input;
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

int g_hostMouseMsgs = 0;
void renderFrameFwd();

LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    // Diagnostic: separates "the island is the wrong input source" from "no
    // mouse message is being pumped to this thread at all". Those need
    // completely different fixes and look identical from the island's side.
    if (msg == WM_MOUSEMOVE || msg == WM_LBUTTONDOWN || msg == WM_NCMOUSEMOVE) {
        // Report the first few immediately. Reporting only every N messages
        // cannot distinguish "none arrived" from "fewer than N arrived", and
        // that difference is the entire question.
        if (++g_hostMouseMsgs <= 3)
            std::printf("[qtspike] host mouse msg #%d (0x%04X)\n", g_hostMouseMsgs, msg);
    }
    if (msg == WM_TIMER) { renderFrameFwd(); return 0; }
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    if (msg == WM_KEYDOWN && wp == VK_ESCAPE) { DestroyWindow(hwnd); return 0; }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// Input arrives in island coordinates, which are DIPs; Qt's scene is sized in
// render-target pixels. One scale factor converts between them.
double g_inputScale = 1.0;
int g_pointerEvents = 0;
int g_moved = 0, g_pressed = 0, g_released = 0;

// Launched from Explorer there is no console, so stdout goes nowhere and the
// result of a manual pointer test is whatever the tester remembers seeing.
// The counters go to a file next to the exe so the outcome can be read back
// instead of relayed.
void logResult()
{
    const QString path = QDir(QCoreApplication::applicationDirPath()).filePath("input-test.log");
    FILE* f = nullptr;
    if (_wfopen_s(&f, reinterpret_cast<const wchar_t*>(path.utf16()), L"w") != 0 || !f) return;
    std::fprintf(f, "pointer events : %d\n", g_pointerEvents);
    std::fprintf(f, "PointerMoved   : %d\n", g_moved);
    std::fprintf(f, "PointerPressed : %d\n", g_pressed);
    std::fprintf(f, "PointerReleased: %d\n", g_released);
    std::fprintf(f, "host mouse msgs: %d\n", g_hostMouseMsgs);
    std::fprintf(f, "VERDICT        : %s\n",
                 g_moved > 0 ? (g_pressed > 0 ? "PASS - move and press both reach Qt"
                                              : "PARTIAL - move reaches Qt, no press seen")
                             : "FAIL - no pointer input reached Qt");
    std::fclose(f);
}

// The host HWND never sees any of this: DesktopChildSiteBridge creates its own
// child window on top, so hit-testing resolves to the bridge and the host's
// wndProc is never called for pointer input. Forwarding Win32 messages from the
// host -- the obvious approach -- silently receives nothing. Input has to be
// taken from the island via InputPointerSource instead.
void dispatchMouse(QEvent::Type type, const winrt::Windows::Foundation::Point& pos,
                   Qt::MouseButton button, Qt::MouseButtons buttons)
{
    if (!g_stage.quickWindow) return;
    ++g_pointerEvents;
    const QPointF local(pos.X * g_inputScale, pos.Y * g_inputScale);
    QMouseEvent ev(type, local, local, local, button, buttons, Qt::NoModifier);
    QCoreApplication::sendEvent(g_stage.quickWindow, &ev);
}

// Must outlive wireInput(). As a local it is released the moment the function
// returns, which takes the handler registrations with it: everything reports
// success, and not one pointer event is ever delivered.
muinput::InputPointerSource g_pointerSource{ nullptr };

void wireInput(const content::ContentIsland& island)
{
    g_pointerSource = muinput::InputPointerSource::GetForIsland(island);
    auto& pointer = g_pointerSource;

    pointer.PointerMoved([](auto&&, const muinput::PointerEventArgs& args) {
        ++g_moved;
        const auto pt = args.CurrentPoint();
        dispatchMouse(QEvent::MouseMove, pt.Position(), Qt::NoButton,
                      pt.Properties().IsLeftButtonPressed() ? Qt::LeftButton : Qt::NoButton);
        logResult();
    });
    pointer.PointerPressed([](auto&&, const muinput::PointerEventArgs& args) {
        ++g_pressed;
        dispatchMouse(QEvent::MouseButtonPress, args.CurrentPoint().Position(),
                      Qt::LeftButton, Qt::LeftButton);
        logResult();
    });
    pointer.PointerReleased([](auto&&, const muinput::PointerEventArgs& args) {
        ++g_released;
        dispatchMouse(QEvent::MouseButtonRelease, args.CurrentPoint().Position(),
                      Qt::LeftButton, Qt::NoButton);
        logResult();
    });
    // Without an explicit exit, a hovered item stays hovered forever once the
    // cursor leaves the island.
    pointer.PointerExited([](auto&&, const muinput::PointerEventArgs& args) {
        dispatchMouse(QEvent::MouseMove, args.CurrentPoint().Position(),
                      Qt::NoButton, Qt::NoButton);
        if (g_stage.quickWindow) {
            QEvent leave(QEvent::Leave);
            QCoreApplication::sendEvent(g_stage.quickWindow, &leave);
        }
    });
    // Write once up front so the file exists even for a run that receives
    // nothing: an absent log means the build never ran, which is a different
    // failure from a run that got no input.
    logResult();
    std::printf("[qtspike] input wired to island\n");
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

void renderFrameFwd() { renderFrame(); }

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

    // --nobridge validates the test harness itself. A plain window with no
    // bridge, no island and no backdrop MUST count mouse messages when the
    // cursor moves over it. If it does not, the instrument is broken and every
    // "0 events" reading above means nothing.
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) != "--nobridge") continue;
        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);
        std::printf("[qtspike] --nobridge: plain window, counting mouse messages\n");
        MSG m{};
        int t = 0;
        while (GetMessageW(&m, nullptr, 0, 0)) {
            TranslateMessage(&m);
            DispatchMessageW(&m);
            if (++t % 40 == 0) std::printf("[qtspike] host mouse msgs: %d\n", g_hostMouseMsgs);
        }
        return 0;
    }

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

    // Island size is in DIPs; the Qt scene is W pixels wide.
    const auto islandSize = island.ActualSize();
    if (islandSize.x > 0) g_inputScale = static_cast<double>(W) / islandSize.x;
    std::printf("[qtspike] island %.0fx%.0f DIP, input scale %.3f\n",
                islandSize.x, islandSize.y, g_inputScale);
    // A transparent island is not hit-tested by default -- and this island is
    // transparent on purpose, so the acrylic behind it shows through. Without
    // this, every pointer event lands on nothing: InputPointerSource is wired
    // correctly, reports success, and simply never fires.
    island.IsHitTestVisibleWhenTransparent(true);
    island.IsIslandEnabled(true);
    island.IsIslandVisible(true);
    std::printf("[qtspike] island connected=%d enabled=%d visible=%d hitTestTransparent=%d "
                "siteEnabled=%d siteVisible=%d\n",
                island.IsConnected() ? 1 : 0, island.IsIslandEnabled() ? 1 : 0,
                island.IsIslandVisible() ? 1 : 0, island.IsHitTestVisibleWhenTransparent() ? 1 : 0,
                island.IsSiteEnabled() ? 1 : 0, island.IsSiteVisible() ? 1 : 0);
    wireInput(island);

    QTimer inputReport;
    QObject::connect(&inputReport, &QTimer::timeout, [] {
        std::printf("[qtspike] pointer events: %d   host mouse msgs: %d\n",
                    g_pointerEvents, g_hostMouseMsgs);
    });
    inputReport.start(2000);

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

    // --win32loop swaps Qt's event dispatcher for a plain Win32 pump. It exists
    // to answer one question: whether Qt's dispatcher is what is swallowing
    // pointer input. Rendering still works under it (renderFrame is driven by
    // WM_TIMER, and sendEvent is synchronous), but Qt timers and QML animations
    // do not run, so it is a diagnostic rather than a viable mode.
    bool win32Loop = false;
    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--win32loop") win32Loop = true;

    if (win32Loop) {
        SetTimer(hwnd, 1, 16, nullptr);
        std::printf("[qtspike] running under a raw Win32 message loop - Esc to quit\n");
        MSG msg{};
        int ticks = 0;
        while (GetMessageW(&msg, nullptr, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if (++ticks % 120 == 0)
                std::printf("[qtspike] pointer events: %d   host mouse msgs: %d\n",
                            g_pointerEvents, g_hostMouseMsgs);
        }
        return 0;
    }

    QTimer timer;
    QObject::connect(&timer, &QTimer::timeout, [] { renderFrame(); });
    timer.start(16);

    std::printf("[qtspike] running - Esc to quit\n");
    return app.exec();
}
