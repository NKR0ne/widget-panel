// Phase 0 spike: prove the highest-fidelity backdrop path works at all, before
// any of it touches the panel.
//
// Chain under test:
//   MddBootstrap (activate WindowsAppSDK for an unpackaged app)
//     -> Microsoft.UI.Dispatching.DispatcherQueueController (Compositor needs one)
//       -> Microsoft.UI.Composition.Compositor
//         -> Microsoft.UI.Content.DesktopChildSiteBridge (hosts composition in an HWND)
//           -> ContentIsland (the content the bridge presents)
//             -> DesktopAcrylicController.AddSystemBackdropTarget(bridge)
//
// NOTE: this is NOT the ICompositorDesktopInterop / DesktopWindowTarget route.
// That interop interface exists only for the OS compositor
// (Windows.UI.Composition) and is absent from the WindowsAppSDK package
// entirely — the projections ship Windows.UI.Composition.Desktop but no
// Microsoft.UI.Composition.Desktop. The two composition stacks are separate
// type systems, and DesktopAcrylicController lives in the Microsoft.UI one,
// so hosting has to go through Microsoft.UI.Content instead.
//
// If this renders, the material is Microsoft's own implementation rather than
// our reconstruction of the recipe, and TintColor / TintOpacity /
// LuminosityOpacity become real knobs instead of numbers we reverse-engineer.
// LuminosityOpacity in particular is the layer we could never reproduce by
// compositing over DWM's finished surface: it lifts light instead of covering it.

#include <windows.h>

// No MddBootstrap: this builds SELF-CONTAINED. The WindowsAppSDK runtime DLLs
// sit next to the exe and the activatable classes are resolved through a
// registration-free WinRT manifest embedded in the binary — so there is no
// framework package to find, no DDLM to resolve, and nothing to install. The
// bootstrapper path was tried first and fails 0x80670016 on a machine with no
// DDLM registered, which is the normal state for a machine that only ever ran
// *packaged* WinAppSDK apps.
//
// Deliberately NOT including Microsoft.UI.Interop.h for GetWindowIdFromWindow:
// that header is ABI-style and pulls a flat Microsoft.UI.h which the package
// does not ship (only the C++/WinRT projection winrt/Microsoft.UI.h exists).
// WindowId.Value is documented as the HWND, so construct it directly.

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.UI.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Microsoft.UI.h>
#include <winrt/Microsoft.UI.Dispatching.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.SystemBackdrops.h>
#include <winrt/Microsoft.UI.Content.h>

#include <cstdio>
#include <cstdlib>
#include <string>

namespace mucomp = winrt::Microsoft::UI::Composition;
namespace backdrops = winrt::Microsoft::UI::Composition::SystemBackdrops;
namespace content = winrt::Microsoft::UI::Content;

namespace {

struct Options {
    float tintOpacity = 0.8f;
    float luminosityOpacity = 0.85f;
    uint8_t r = 0x34, g = 0x3C, b = 0x51; // AccentDark2 from this machine's palette
    bool mica = false;
    bool probe = false;     // paint the island opaque red instead of attaching a backdrop
    bool redirect = false;  // keep the redirection bitmap (drop WS_EX_NOREDIRECTIONBITMAP)
};

Options parseArgs(int argc, char** argv)
{
    Options o;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--tint-opacity" && i + 1 < argc) { o.tintOpacity = std::strtof(argv[++i], nullptr); continue; }
        if (a == "--luminosity" && i + 1 < argc)   { o.luminosityOpacity = std::strtof(argv[++i], nullptr); continue; }
        if (a == "--mica") { o.mica = true; continue; }
        if (a == "--probe") { o.probe = true; continue; }
        if (a == "--redirect") { o.redirect = true; continue; }
        if (a == "--tint" && i + 1 < argc) {
            const unsigned long rgb = std::strtoul(argv[++i], nullptr, 16);
            o.r = static_cast<uint8_t>((rgb >> 16) & 0xFF);
            o.g = static_cast<uint8_t>((rgb >> 8) & 0xFF);
            o.b = static_cast<uint8_t>(rgb & 0xFF);
        }
    }
    return o;
}

// The bridge does not track the host window on its own; without MoveAndResize
// it stays zero-sized and the island has no area to composite into.
content::DesktopChildSiteBridge g_bridge{ nullptr };
content::ContentIsland g_island{ nullptr };
mucomp::SpriteVisual g_root{ nullptr };

void syncBridgeToClient(HWND hwnd)
{
    if (!g_bridge) return;
    RECT rc{};
    GetClientRect(hwnd, &rc);
    const int w = rc.right - rc.left;
    const int h = rc.bottom - rc.top;
    g_bridge.MoveAndResize({ 0, 0, w, h });

    // RelativeSizeAdjustment is relative to the PARENT visual, and an island's
    // root visual has no parent -- so it stays 0x0 and the island presents
    // nothing at all, however correct everything downstream is. The root must
    // be sized explicitly.
    //
    // In DIPs, not pixels. MoveAndResize above takes physical pixels, but
    // island content is scaled by RasterizationScale (1.75 on this display), so
    // sizing the root from the client rect overshoots by that factor. The
    // backdrop hides the mistake here because it attaches to the bridge rather
    // than the visual -- real content would be cropped.
    if (g_root && g_island) g_root.Size(g_island.ActualSize());
}

LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    if (msg == WM_SIZE) { syncBridgeToClient(hwnd); return 0; }
    if (msg == WM_KEYDOWN && wp == VK_ESCAPE) { DestroyWindow(hwnd); return 0; }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

} // namespace

int run(int argc, char** argv)
{
    const Options opt = parseArgs(argc, argv);

    std::printf("[spike] self-contained: no bootstrapper, runtime is beside the exe\n");

    // --defaults reads the values Windows itself ships for each acrylic kind,
    // rather than trusting anybody's recollection of the documentation. Start
    // uses the Base kind, so these are the numbers to match against.
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) != "--defaults") continue;
        winrt::init_apartment(winrt::apartment_type::single_threaded);
        auto dqLocal = winrt::Microsoft::UI::Dispatching::DispatcherQueueController::CreateOnCurrentThread();
        const struct { backdrops::DesktopAcrylicKind kind; const char* name; } kinds[] = {
            { backdrops::DesktopAcrylicKind::Base, "Base (Start menu)" },
            { backdrops::DesktopAcrylicKind::Thin, "Thin" },
        };
        // Defaults are theme-dependent, and a controller with no configuration
        // reports the light-theme ones -- which are not the numbers this panel
        // needs.
        const struct { backdrops::SystemBackdropTheme theme; const char* name; } themes[] = {
            { backdrops::SystemBackdropTheme::Light, "Light" },
            { backdrops::SystemBackdropTheme::Dark,  "Dark" },
        };
        for (const auto& k : kinds) {
            for (const auto& t : themes) {
                backdrops::SystemBackdropConfiguration cfg{};
                cfg.IsInputActive(true);
                cfg.Theme(t.theme);
                backdrops::DesktopAcrylicController c{};
                c.Kind(k.kind);
                c.SetSystemBackdropConfiguration(cfg);
                const auto tint = c.TintColor();
                const auto fallback = c.FallbackColor();
                std::printf("\n%s / %s\n", k.name, t.name);
                std::printf("  TintColor          #%02X%02X%02X  alpha %u\n",
                            tint.R, tint.G, tint.B, tint.A);
                std::printf("  TintOpacity        %.3f\n", c.TintOpacity());
                std::printf("  LuminosityOpacity  %.3f\n", c.LuminosityOpacity());
                std::printf("  FallbackColor      #%02X%02X%02X  alpha %u\n",
                            fallback.R, fallback.G, fallback.B, fallback.A);
            }
        }
        return 0;
    }

    winrt::init_apartment(winrt::apartment_type::single_threaded);

    // A Compositor requires a DispatcherQueue on the calling thread.
    auto dq = winrt::Microsoft::UI::Dispatching::DispatcherQueueController::CreateOnCurrentThread();
    std::printf("[spike] dispatcher queue created\n");

    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = wndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"CompositionSpikeWindow";
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassExW(&wc);

    const HWND hwnd = CreateWindowExW(
        opt.redirect ? 0 : WS_EX_NOREDIRECTIONBITMAP,
        wc.lpszClassName, L"Composition spike - acrylic",
        WS_OVERLAPPEDWINDOW,
        200, 200, 900, 700,
        nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) { std::printf("[spike] CreateWindowExW failed\n"); return 1; }

    mucomp::Compositor compositor{};
    std::printf("[spike] compositor created\n");

    const winrt::Microsoft::UI::WindowId windowId{ reinterpret_cast<uint64_t>(hwnd) };
    auto bridge = content::DesktopChildSiteBridge::Create(compositor, windowId);
    g_bridge = bridge;
    std::printf("[spike] desktop child site bridge created\n");

    // Something must be in the tree or there is nothing to composite behind.
    // --probe paints the island opaque red. It answers a question the backdrop
    // itself cannot: if red does not appear, the island/bridge is not presenting
    // and the backdrop was never the problem -- an unpainted WS_EX_NOREDIRECTION-
    // BITMAP window is fully see-through, so a "flat, tint-independent" reading
    // is just the wallpaper, not a material.
    auto root = compositor.CreateSpriteVisual();
    g_root = root;
    root.Brush(compositor.CreateColorBrush(opt.probe
        ? winrt::Windows::UI::Color{255, 255, 0, 0}
        : winrt::Windows::UI::Color{0, 0, 0, 0}));

    auto island = content::ContentIsland::Create(root);
    g_island = island;
    bridge.Connect(island);
    bridge.ResizePolicy(content::ContentSizePolicy::ResizeContentToParentWindow);
    std::printf("[spike] content island connected\n");

    // Show the host window BEFORE attaching a backdrop controller. The
    // controller's update thread starts sampling immediately, and on a window
    // that is not yet visible/composited it takes its own teardown path --
    // which in WinAppSDK 1.5 self-joins and fail-fasts the process.
    syncBridgeToClient(hwnd);
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
    // Show the BRIDGE only after the host window is on screen. Called while the
    // parent is still hidden, Show() silently leaves IsVisible false -- the
    // bridge stays invisible for the life of the process and the island never
    // presents a single pixel, with no error anywhere to say so.
    bridge.Show();
    std::printf("[spike] host window shown (redirection bitmap: %s), bridge visible=%d enabled=%d\n",
                opt.redirect ? "kept" : "none",
                bridge.IsVisible() ? 1 : 0, bridge.IsEnabled() ? 1 : 0);
    std::printf("[spike] root visual size %.0fx%.0f  island actual %.0fx%.0f  scale %.2f\n",
                root.Size().x, root.Size().y,
                island.ActualSize().x, island.ActualSize().y,
                island.RasterizationScale());

    backdrops::SystemBackdropConfiguration config{};
    config.IsInputActive(true);
    config.Theme(backdrops::SystemBackdropTheme::Dark);

    if (opt.probe) {
        std::printf("[spike] probe mode: island painted opaque red, no backdrop\n");
        std::printf("[spike] running - Esc to quit\n");
        dq.DispatcherQueue().RunEventLoop();
        return 0;
    }

    auto target = bridge.try_as<mucomp::ICompositionSupportsSystemBackdrop>();
    if (!target) {
        std::printf("[spike] FAIL: bridge does not implement ICompositionSupportsSystemBackdrop\n");
        return 1;
    }
    std::printf("[spike] bridge supports system backdrop\n");

    // Static so the controller outlives run(); a backdrop controller released
    // while its update thread is live is exactly the crash path above.
    static backdrops::DesktopAcrylicController s_acrylic{ nullptr };
    static backdrops::MicaController s_mica{ nullptr };
    static backdrops::SystemBackdropConfiguration s_config{ nullptr };
    s_config = config;

    if (opt.mica) {
        backdrops::MicaController mica{};
        s_mica = mica;
        if (!mica.IsSupported()) { std::printf("[spike] MicaController unsupported\n"); return 1; }
        mica.SetSystemBackdropConfiguration(config);
        const bool ok = mica.AddSystemBackdropTarget(target);
        std::printf("[spike] mica attached: %s\n", ok ? "yes" : "NO");
    } else {
        backdrops::DesktopAcrylicController acrylic{};
        s_acrylic = acrylic;
        if (!acrylic.IsSupported()) { std::printf("[spike] DesktopAcrylicController unsupported\n"); return 1; }
        acrylic.Kind(backdrops::DesktopAcrylicKind::Base);
        acrylic.TintColor(winrt::Windows::UI::Color{255, opt.r, opt.g, opt.b});
        acrylic.TintOpacity(opt.tintOpacity);
        acrylic.LuminosityOpacity(opt.luminosityOpacity);
        acrylic.SetSystemBackdropConfiguration(config);
        const bool ok = acrylic.AddSystemBackdropTarget(target);
        std::printf("[spike] acrylic attached: %s  tint #%02X%02X%02X opacity %.2f luminosity %.2f\n",
                    ok ? "yes" : "NO", opt.r, opt.g, opt.b, opt.tintOpacity, opt.luminosityOpacity);
    }

    std::printf("[spike] running - Esc to quit\n");

    // A Microsoft.UI DispatcherQueue expects to own the thread's message loop.
    // A raw GetMessage/DispatchMessage loop pumps the window but never services
    // the queue, and the composition stack fail-fasts (0xC0000409) rather than
    // returning an error -- so there is no HRESULT to catch, only a dead process.
    dq.DispatcherQueue().RunEventLoop();
    std::printf("[spike] event loop returned\n");

    return 0;
}

int main(int argc, char** argv)
{
    // Unbuffered: a C++/WinRT failure calls terminate, so anything sitting in a
    // block-buffered pipe is lost and the run looks like it printed nothing at
    // all. Diagnosing this spike depends on the last line before the crash.
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    // Must come before any window exists. Without it the process is DPI
    // virtualized: DWM stretches a low-res redirection bitmap to the real
    // panel, but composition content does not go through that bitmap, so the
    // island presents nothing while every property still reports healthy.
    // WinAppSDK apps get PerMonitorV2 from their packaged manifest; an
    // unpackaged host has to ask for it.
    if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
        std::printf("[spike] warning: could not set PerMonitorV2 DPI awareness\n");

    try {
        return run(argc, argv);
    } catch (const winrt::hresult_error& e) {
        std::printf("[spike] hresult_error 0x%08X: %ls\n",
                    static_cast<unsigned>(e.code().value), e.message().c_str());
        return 2;
    } catch (const std::exception& e) {
        std::printf("[spike] std::exception: %s\n", e.what());
        return 3;
    }
}
