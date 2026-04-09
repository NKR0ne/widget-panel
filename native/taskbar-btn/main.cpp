/*
 * widget-panel — taskbar-btn helper
 *
 * A lightweight Win32 process that overlays a custom "W" button on the
 * Windows 11 taskbar exactly where the native Widgets button was.
 *
 * IPC: connects to a Named Pipe created by the Electron main process.
 *   Electron → helper  {"type":"badge","count":5}
 *                       {"type":"state","visible":true}
 *   Helper  → Electron {"type":"toggle"}
 *                       {"type":"ready"}
 *
 * Build:  cmake -B build -A x64  &&  cmake --build build --config Release
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <string>
#include <thread>
#include <atomic>
#include <sstream>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "user32.lib")

// ── Constants ─────────────────────────────────────────────────────────────────
static const wchar_t* PIPE_NAME  = L"\\\\.\\pipe\\widget-panel";
static const wchar_t* WND_CLASS  = L"WPTaskbarBtn";
static const wchar_t* MUTEX_NAME = L"WPTaskbarBtnMutex";

static const int BTN_W = 44;   // button width  (px)
static const int BTN_H = 40;   // button height (px)

// Brand colours
static const COLORREF CLR_BG      = RGB(0x11, 0x11, 0x14);
static const COLORREF CLR_ACTIVE  = RGB(0x4f, 0x8e, 0xf7);
static const COLORREF CLR_IDLE    = RGB(0x28, 0x28, 0x38);
static const COLORREF CLR_BADGE   = RGB(0xf7, 0x4f, 0x7e);
static const COLORREF CLR_WHITE   = RGB(0xff, 0xff, 0xff);

// ── Global state ──────────────────────────────────────────────────────────────
static HWND              g_hwnd    = NULL;
static HINSTANCE         g_hInst   = NULL;
static HANDLE            g_pipe    = INVALID_HANDLE_VALUE;
static int               g_badge   = 0;       // unread count
static bool              g_panelOn = true;     // panel visible?
static bool              g_hover   = false;    // mouse over button?
static std::atomic<bool> g_running { true };

// ── Taskbar geometry ──────────────────────────────────────────────────────────
// Returns the top-left position for our button:
//   - Anchored to the left edge of the taskbar
//   - Vertically centred within the taskbar band
// After removing the native Widgets button (TaskbarDa=0) the slot is empty;
// we occupy it at roughly x=100 (after Start ≈48px + Search ≈48px).
struct TaskbarInfo { RECT rc; int btnX, btnY; };

TaskbarInfo GetTaskbarInfo()
{
    HWND tb = FindWindow(L"Shell_TrayWnd", NULL);
    TaskbarInfo info{};
    if (!tb) return info;

    GetWindowRect(tb, &info.rc);
    int tbH = info.rc.bottom - info.rc.top;

    // Attempt to locate the "Widgets" child window by class to use its coords.
    // On Windows 11 ≥22H2 the Widgets host is "Windows.UI.Composition.DesktopWindowContentBridge".
    // If found, place our button at the same x. Otherwise fall back to x=100.
    struct FindCtx { HWND found; RECT rc; } ctx{};
    EnumChildWindows(tb, [](HWND h, LPARAM lp) -> BOOL {
        wchar_t cls[128]{};
        GetClassName(h, cls, 128);
        // The native search/widgets area in W11 typically lives in "Windows.UI.Composition..."
        if (wcsstr(cls, L"XamlExplorerHostIslandWindow") ||
            wcsstr(cls, L"Windows.UI.Composition")) {
            auto* ctx = reinterpret_cast<FindCtx*>(lp);
            GetWindowRect(h, &ctx->rc);
            ctx->found = h;
            return FALSE;
        }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&ctx));

    int xBase = (ctx.found && ctx.rc.left > info.rc.left)
                ? (ctx.rc.left - info.rc.left)   // align with XamlHost
                : 100;                            // fallback

    info.btnX = info.rc.left + xBase;
    info.btnY = info.rc.top  + (tbH - BTN_H) / 2;
    return info;
}

// ── Named pipe ────────────────────────────────────────────────────────────────
void SendMsg(const char* json)
{
    if (g_pipe == INVALID_HANDLE_VALUE) return;
    std::string line = std::string(json) + "\n";
    DWORD written;
    WriteFile(g_pipe, line.c_str(), static_cast<DWORD>(line.size()), &written, NULL);
}

// Blocking connect — retries until Electron's pipe server is up.
static void ConnectPipe()
{
    while (g_running) {
        g_pipe = CreateFile(PIPE_NAME,
                            GENERIC_READ | GENERIC_WRITE,
                            0, NULL, OPEN_EXISTING, 0, NULL);
        if (g_pipe != INVALID_HANDLE_VALUE) {
            SendMsg(R"({"type":"ready"})");
            return;
        }
        Sleep(1500);
    }
}

// Runs on a background thread — reads messages from Electron.
static void PipeThread()
{
    ConnectPipe();

    char buf[512];
    while (g_running) {
        DWORD nRead = 0;
        BOOL ok = ReadFile(g_pipe, buf, sizeof(buf) - 1, &nRead, NULL);
        if (!ok || nRead == 0) {
            CloseHandle(g_pipe);
            g_pipe = INVALID_HANDLE_VALUE;
            if (g_running) ConnectPipe();
            continue;
        }
        buf[nRead] = '\0';

        std::string s(buf);

        // {"type":"badge","count":N}
        if (s.find("\"badge\"") != std::string::npos) {
            auto p = s.find("\"count\":");
            if (p != std::string::npos) {
                try { g_badge = std::stoi(s.substr(p + 8)); } catch (...) {}
                InvalidateRect(g_hwnd, NULL, FALSE);
            }
        }
        // {"type":"state","visible":true|false}
        else if (s.find("\"state\"") != std::string::npos) {
            g_panelOn = (s.find("\"visible\":true") != std::string::npos);
            InvalidateRect(g_hwnd, NULL, FALSE);
        }
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
static void DrawBtn(HDC hdc, RECT rc)
{
    // Background
    HBRUSH bgBrush = CreateSolidBrush(CLR_BG);
    FillRect(hdc, &rc, bgBrush);
    DeleteObject(bgBrush);

    int cx = (rc.left + rc.right)  / 2;
    int cy = (rc.top  + rc.bottom) / 2;
    int r  = 11;  // icon half-size

    // Icon body — active (blue) when panel is visible, dim otherwise
    COLORREF iconClr = (g_panelOn || g_hover) ? CLR_ACTIVE : CLR_IDLE;
    HPEN   pen  = CreatePen(PS_SOLID, 0, iconClr);
    HBRUSH fill = CreateSolidBrush(iconClr);
    HPEN   oldP = static_cast<HPEN>(SelectObject(hdc, pen));
    HBRUSH oldB = static_cast<HBRUSH>(SelectObject(hdc, fill));
    RoundRect(hdc, cx - r, cy - r, cx + r, cy + r, 6, 6);
    SelectObject(hdc, oldP);
    SelectObject(hdc, oldB);
    DeleteObject(pen);
    DeleteObject(fill);

    // "W" label
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, CLR_WHITE);
    HFONT font = CreateFont(-11, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
    HFONT oldF = static_cast<HFONT>(SelectObject(hdc, font));
    RECT  iconRc{ cx - r, cy - r, cx + r, cy + r };
    DrawText(hdc, L"W", 1, &iconRc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    SelectObject(hdc, oldF);
    DeleteObject(font);

    // Badge circle
    if (g_badge > 0) {
        int bx = cx + r - 2;
        int by = cy - r + 2;
        int br = 7;

        HPEN   bp  = CreatePen(PS_SOLID, 0, CLR_BADGE);
        HBRUSH bbr = CreateSolidBrush(CLR_BADGE);
        SelectObject(hdc, bp);
        SelectObject(hdc, bbr);
        Ellipse(hdc, bx - br, by - br, bx + br, by + br);
        DeleteObject(bp);
        DeleteObject(bbr);

        wchar_t num[4];
        swprintf_s(num, g_badge > 9 ? L"9+" : L"%d", g_badge);
        SetTextColor(hdc, CLR_WHITE);
        HFONT sf = CreateFont(-7, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                              ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                              CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        HFONT osf = static_cast<HFONT>(SelectObject(hdc, sf));
        RECT  brc{ bx - br, by - br, bx + br, by + br };
        DrawText(hdc, num, -1, &brc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        SelectObject(hdc, osf);
        DeleteObject(sf);
    }
}

// ── Window proc ───────────────────────────────────────────────────────────────
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg) {

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        RECT rc; GetClientRect(hwnd, &rc);
        HDC     mem = CreateCompatibleDC(hdc);
        HBITMAP bmp = CreateCompatibleBitmap(hdc, rc.right, rc.bottom);
        auto    old = SelectObject(mem, bmp);
        DrawBtn(mem, rc);
        BitBlt(hdc, 0, 0, rc.right, rc.bottom, mem, 0, 0, SRCCOPY);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);

        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_LBUTTONUP:
        SendMsg(R"({"type":"toggle"})");
        return 0;

    case WM_MOUSEMOVE:
        if (!g_hover) {
            g_hover = true;
            InvalidateRect(hwnd, NULL, FALSE);
            // Track WM_MOUSELEAVE
            TRACKMOUSEEVENT tme{ sizeof(tme), TME_LEAVE, hwnd, 0 };
            TrackMouseEvent(&tme);
        }
        return 0;

    case WM_MOUSELEAVE:
        g_hover = false;
        InvalidateRect(hwnd, NULL, FALSE);
        return 0;

    // Re-anchor if taskbar moves (resolution change, taskbar resize, etc.)
    case WM_DISPLAYCHANGE:
    case WM_SETTINGCHANGE: {
        auto info = GetTaskbarInfo();
        SetWindowPos(hwnd, HWND_TOPMOST,
                     info.btnX, info.btnY, BTN_W, BTN_H,
                     SWP_NOACTIVATE | SWP_SHOWWINDOW);
        return 0;
    }

    case WM_DESTROY:
        g_running = false;
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

// ── Entry ─────────────────────────────────────────────────────────────────────
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int)
{
    // Single-instance guard
    HANDLE mutex = CreateMutex(NULL, TRUE, MUTEX_NAME);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        CloseHandle(mutex);
        return 0;
    }

    g_hInst = hInst;

    // Start pipe thread before window so it can start connecting
    std::thread pipeThd(PipeThread);

    // Register window class
    WNDCLASSEX wc{};
    wc.cbSize        = sizeof(wc);
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = hInst;
    wc.hCursor       = LoadCursor(NULL, IDC_HAND);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.lpszClassName = WND_CLASS;
    RegisterClassEx(&wc);

    // Create the overlay window
    auto info = GetTaskbarInfo();

    g_hwnd = CreateWindowEx(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
        WND_CLASS, L"Widget Panel",
        WS_POPUP,
        info.btnX, info.btnY, BTN_W, BTN_H,
        NULL, NULL, hInst, NULL);

    // Solid window with slight transparency so corners look clean on any bg
    SetLayeredWindowAttributes(g_hwnd, 0, 240, LWA_ALPHA);

    // Enable DWI rounded corners (Windows 11)
    DWM_WINDOW_CORNER_PREFERENCE pref = DWMWCP_ROUND;
    DwmSetWindowAttribute(g_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &pref, sizeof(pref));

    ShowWindow(g_hwnd, SW_SHOWNOACTIVATE);
    UpdateWindow(g_hwnd);

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    g_running = false;
    CloseHandle(g_pipe);
    pipeThd.join();
    CloseHandle(mutex);
    return 0;
}
