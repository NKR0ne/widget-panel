/*
 * taskbar-hook.dll  —  injected into Explorer.exe
 *
 * Creates a WS_POPUP AppBar window docked to the left edge of the primary
 * monitor.  The window is the full screen height but transparent everywhere
 * except the pill button, which is centred vertically.
 *
 * AppBar (SHAppBarMessage ABE_LEFT) gives us proper shell integration:
 *   • Shell guarantees the strip is never covered by other windows
 *   • Full-screen apps trigger ABN_FULLSCREENAPP so we hide/show cleanly
 *   • Auto-hide taskbar works fine (different edge, no conflict)
 *   • Zero z-order fighting — no TOPMOST hackery required
 *
 * Transparency: WS_EX_LAYERED + LWA_COLORKEY.  The strip background is
 * painted with TRANSP_KEY; layered colour-key makes those pixels both
 * invisible and click-through.  Only the pill area is opaque / hittable.
 *
 * IPC: TCP 127.0.0.1:47321 — no integrity-level restrictions.
 */

#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <shellapi.h>
#include <string>
#include <cstdio>
#include <cstdarg>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")

// ── Constants ─────────────────────────────────────────────────────────────────
static const wchar_t* WND_CLASS      = L"WPAppBarBtn";
static const UINT     WM_APPBAR      = WM_APP + 1;   // AppBar callback message
static const UINT     WM_STATECHANGE = WM_APP + 2;   // IPC thread → window thread: redraw + alpha
static const int      IPC_PORT       = 47321;

// AppBar strip — narrow enough to be unobtrusive; just wide enough for the chevron
static const int STRIP_W = 18;

// LWA_COLORKEY transparent colour — never appears in the arrow drawing
static const COLORREF TRANSP_KEY = RGB(0, 0, 1);

// ── State ─────────────────────────────────────────────────────────────────────
static HWND          g_hwnd       = NULL;
static HMODULE       g_hMod       = NULL;
static SOCKET        g_sock       = INVALID_SOCKET;
static int           g_badge      = 0;
static volatile bool g_panelOn    = true;
static volatile bool g_hover      = false;
static volatile bool g_running    = true;
static bool          g_appBarReg  = false;   // true once ABM_NEW succeeded
static wchar_t       g_logPath[MAX_PATH] = {};

// ── Mouse hook state (click-outside detection) ────────────────────────────────
static HHOOK         g_mouseHook  = NULL;
static LONG_PTR      g_panelHwnd  = 0;
static LONG_PTR      g_braveHwnd  = 0;

// ── Log ───────────────────────────────────────────────────────────────────────
static void Log(const char* fmt, ...)
{
    if (!g_logPath[0]) return;
    FILE* f = _wfopen(g_logPath, L"a");
    if (!f) return;
    va_list ap; va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

// ── AppBar position ───────────────────────────────────────────────────────────
static void PositionAppBar()
{
    if (!g_hwnd || !g_appBarReg) return;

    HMONITOR hmon = MonitorFromPoint({ 0, 0 }, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi = { sizeof(mi) };
    if (!GetMonitorInfo(hmon, &mi)) return;

    APPBARDATA abd = { sizeof(abd) };
    abd.hWnd             = g_hwnd;
    abd.uEdge            = ABE_LEFT;
    abd.uCallbackMessage = WM_APPBAR;
    abd.rc = {
        mi.rcMonitor.left,
        mi.rcMonitor.top,
        mi.rcMonitor.left + STRIP_W,
        mi.rcMonitor.bottom
    };

    SHAppBarMessage(ABM_QUERYPOS, &abd);
    // Enforce our width — QUERYPOS may shrink the right edge; we want exactly STRIP_W.
    abd.rc.right = abd.rc.left + STRIP_W;
    SHAppBarMessage(ABM_SETPOS, &abd);

    SetWindowPos(g_hwnd, HWND_TOP,
                 abd.rc.left, abd.rc.top,
                 abd.rc.right - abd.rc.left,
                 abd.rc.bottom - abd.rc.top,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);

    Log("PositionAppBar: (%d,%d)-(%d,%d)",
        abd.rc.left, abd.rc.top, abd.rc.right, abd.rc.bottom);
}

// ── TCP IPC ───────────────────────────────────────────────────────────────────
static void SendMsg(const char* json)
{
    if (g_sock == INVALID_SOCKET) return;
    std::string line = std::string(json) + "\n";
    send(g_sock, line.c_str(), (int)line.size(), 0);
}

static void ConnectTCP()
{
    Log("ConnectTCP: connecting to 127.0.0.1:%d", IPC_PORT);
    int attempt = 0;
    while (g_running) {
        g_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (g_sock != INVALID_SOCKET) {
            sockaddr_in addr{};
            addr.sin_family      = AF_INET;
            addr.sin_port        = htons((u_short)IPC_PORT);
            addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            if (connect(g_sock, (sockaddr*)&addr, sizeof(addr)) == 0) {
                Log("TCP connected after %d attempts", attempt);
                SendMsg(R"({"type":"ready"})");
                return;
            }
            closesocket(g_sock);
            g_sock = INVALID_SOCKET;
        }
        if (attempt % 5 == 0)
            Log("connect attempt %d failed: err=%d", attempt, WSAGetLastError());
        attempt++;
        Sleep(1500);
    }
}

static DWORD WINAPI IpcProc(LPVOID)
{
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    ConnectTCP();

    char buf[512];
    while (g_running) {
        int n = recv(g_sock, buf, sizeof(buf) - 1, 0);
        if (n <= 0) {
            closesocket(g_sock);
            g_sock = INVALID_SOCKET;
            if (g_running) ConnectTCP();
            continue;
        }
        buf[n] = '\0';
        std::string s(buf);
        if (s.find("\"badge\"") != std::string::npos) {
            auto p = s.find("\"count\":");
            if (p != std::string::npos) {
                try { g_badge = std::stoi(s.substr(p + 8)); } catch (...) {}
                if (g_hwnd) InvalidateRect(g_hwnd, NULL, FALSE);
            }
        } else if (s.find("\"state\"") != std::string::npos) {
            g_panelOn = s.find("\"visible\":true") != std::string::npos;
            if (!g_panelOn) { g_panelHwnd = 0; g_braveHwnd = 0; }
            if (g_hwnd) PostMessage(g_hwnd, WM_STATECHANGE, 0, 0);
        } else if (s.find("\"hwnd\"") != std::string::npos) {
            auto parseHwnd = [&](const char* key) -> LONG_PTR {
                auto p = s.find(key);
                if (p == std::string::npos) return 0;
                p += strlen(key);
                try { return (LONG_PTR)std::stoll(s.substr(p)); } catch (...) { return 0; }
            };
            g_panelHwnd = parseHwnd("\"panel\":");
            g_braveHwnd = parseHwnd("\"brave\":");
        }
    }
    if (g_sock != INVALID_SOCKET) { closesocket(g_sock); g_sock = INVALID_SOCKET; }
    WSACleanup();
    return 0;
}

// ── Low-level mouse hook (click-outside detection) ────────────────────────────
static bool PtInHwnd(POINT pt, LONG_PTR hwndVal) {
    if (!hwndVal) return false;
    HWND hw = reinterpret_cast<HWND>(hwndVal);
    if (!IsWindow(hw) || !IsWindowVisible(hw)) return false;
    RECT r; GetWindowRect(hw, &r);
    return pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom;
}

static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam)
{
    if (nCode == HC_ACTION && g_panelOn &&
        (wParam == WM_LBUTTONDOWN || wParam == WM_RBUTTONDOWN))
    {
        MSLLHOOKSTRUCT* ms = (MSLLHOOKSTRUCT*)lParam;
        POINT pt = ms->pt;
        bool inPanel = PtInHwnd(pt, g_panelHwnd);
        bool inBrave = PtInHwnd(pt, g_braveHwnd);
        bool onBtn   = (WindowFromPoint(pt) == g_hwnd);
        if (!inPanel && !inBrave && !onBtn)
            SendMsg(R"({"type":"clickoutside"})");
    }
    return CallNextHookEx(g_mouseHook, nCode, wParam, lParam);
}

// ── Alpha — near-invisible at rest, visible on hover / open ─────────────────
static void UpdateAlpha()
{
    if (!g_hwnd) return;
    BYTE alpha;
    if      (g_panelOn) alpha = 200;   // solid indicator while panel is open
    else if (g_hover)   alpha = 110;   // faint on hover
    else                alpha = 1;     // alpha=0 makes layered windows non-hittable on Win11;
                                       // alpha=1 is visually indistinguishable but stays hittable
    SetLayeredWindowAttributes(g_hwnd, 0, alpha, LWA_ALPHA);
}

// ── Rendering — plain coloured strip, no icons or text ───────────────────────
static void DrawStrip(HDC hdc, RECT rc)
{
    // Background — always opaque so mouse events are received even when alpha=0.
    COLORREF bg = g_panelOn ? RGB(18, 38, 72) : (g_hover ? RGB(28, 28, 42) : RGB(16, 16, 20));
    HBRUSH br = CreateSolidBrush(bg);
    FillRect(hdc, &rc, br);
    DeleteObject(br);

    // Thin accent line on the right edge (the panel-side edge) when panel is open.
    if (g_panelOn) {
        HBRUSH ab = CreateSolidBrush(RGB(79, 142, 247));
        RECT edge = { rc.right - 2, rc.top, rc.right, rc.bottom };
        FillRect(hdc, &edge, ab);
        DeleteObject(ab);
    }
}

// ── Window proc ───────────────────────────────────────────────────────────────
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg) {

    // ── AppBar shell notifications ────────────────────────────────────────────
    case WM_APPBAR:
        switch ((UINT)wp) {
        case ABN_POSCHANGED:
            // Shell tells us another AppBar changed — re-query our position.
            PositionAppBar();
            break;
        case ABN_FULLSCREENAPP:
            // lp != 0 → fullscreen app opening; hide ourselves.
            // lp == 0 → fullscreen app closed; reappear.
            if (lp) {
                ShowWindow(hwnd, SW_HIDE);
            } else {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                PositionAppBar();
            }
            break;
        case ABN_STATECHANGE:
        case ABN_WINDOWARRANGE:
            break;
        }
        return 0;

    // ── Required AppBar protocol ──────────────────────────────────────────────
    case WM_ACTIVATE: {
        APPBARDATA abd = { sizeof(abd) };
        abd.hWnd = hwnd;
        SHAppBarMessage(ABM_ACTIVATE, &abd);
        return DefWindowProc(hwnd, msg, wp, lp);
    }
    case WM_WINDOWPOSCHANGED: {
        APPBARDATA abd = { sizeof(abd) };
        abd.hWnd = hwnd;
        SHAppBarMessage(ABM_WINDOWPOSCHANGED, &abd);
        return DefWindowProc(hwnd, msg, wp, lp);
    }

    // ── Painting ──────────────────────────────────────────────────────────────
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc; GetClientRect(hwnd, &rc);
        HDC  mem = CreateCompatibleDC(hdc);
        HBITMAP bmp = CreateCompatibleBitmap(hdc, rc.right, rc.bottom);
        auto old = SelectObject(mem, bmp);
        DrawStrip(mem, rc);
        BitBlt(hdc, 0, 0, rc.right, rc.bottom, mem, 0, 0, SRCCOPY);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        EndPaint(hwnd, &ps);
        return 0;
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    case WM_LBUTTONUP:
        Log("clicked — sock=%s", g_sock != INVALID_SOCKET ? "connected" : "none");
        if (g_sock != INVALID_SOCKET) {
            SendMsg(R"({"type":"toggle"})");
        } else {
            // Electron not running — launch it via the path file the DLL writes
            wchar_t pathFile[MAX_PATH];
            GetModuleFileNameW(g_hMod, pathFile, MAX_PATH);
            wchar_t* sl = wcsrchr(pathFile, L'\\');
            if (sl) wcscpy(sl + 1, L"panel.path");
            FILE* f = _wfopen(pathFile, L"r");
            if (f) {
                char launchPath[1024] = {};
                fread(launchPath, 1, sizeof(launchPath) - 1, f);
                fclose(f);
                for (char* p = launchPath; *p; p++) {
                    if (*p == '\r' || *p == '\n') { *p = 0; break; }
                }
                Log("launching: %s", launchPath);
                wchar_t wpath[1024] = {};
                MultiByteToWideChar(CP_UTF8, 0, launchPath, -1, wpath, 1024);
                wchar_t* space = wcschr(wpath, L' ');
                if (space) {
                    *space = L'\0';
                    ShellExecuteW(NULL, L"open", wpath, space + 1, NULL, SW_SHOWNORMAL);
                } else {
                    ShellExecuteW(NULL, L"open", wpath, NULL, NULL, SW_SHOWNORMAL);
                }
            } else {
                Log("panel.path not found — cannot launch");
            }
        }
        return 0;

    case WM_STATECHANGE:
        UpdateAlpha();
        InvalidateRect(hwnd, NULL, FALSE);
        return 0;
    case WM_MOUSEMOVE:
        if (!g_hover) {
            g_hover = true;
            UpdateAlpha();
            InvalidateRect(hwnd, NULL, FALSE);
            TRACKMOUSEEVENT tme{ sizeof(tme), TME_LEAVE, hwnd, 0 };
            TrackMouseEvent(&tme);
        }
        return 0;
    case WM_MOUSELEAVE:
        g_hover = false;
        UpdateAlpha();
        InvalidateRect(hwnd, NULL, FALSE);
        return 0;

    case WM_DESTROY: {
        // Unregister AppBar before the window is gone
        if (g_appBarReg) {
            APPBARDATA abd = { sizeof(abd) };
            abd.hWnd = hwnd;
            SHAppBarMessage(ABM_REMOVE, &abd);
            g_appBarReg = false;
        }
        PostQuitMessage(0);
        return 0;
    }
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

// ── Button thread ─────────────────────────────────────────────────────────────
static DWORD WINAPI BtnThread(LPVOID)
{
    Log("BtnThread started");

    // Register window class
    WNDCLASSEX wc{};
    wc.cbSize        = sizeof(wc);
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = g_hMod;
    wc.hCursor       = LoadCursor(NULL, IDC_HAND);
    wc.hbrBackground = NULL;
    wc.lpszClassName = WND_CLASS;
    RegisterClassEx(&wc);

    // Primary monitor full height
    HMONITOR hmon = MonitorFromPoint({ 0, 0 }, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi = { sizeof(mi) };
    GetMonitorInfo(hmon, &mi);
    int monX = mi.rcMonitor.left;
    int monY = mi.rcMonitor.top;
    int monH = mi.rcMonitor.bottom - mi.rcMonitor.top;

    // WS_EX_LAYERED  — enables LWA_COLORKEY transparency
    // WS_EX_TOOLWINDOW — no taskbar button for this helper window
    // WS_EX_NOACTIVATE — clicking the pill never steals keyboard focus
    // No WS_EX_TOPMOST — AppBar + shell manages z-order; no TOPMOST fighting
    g_hwnd = CreateWindowEx(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        WND_CLASS, L"Widgets", WS_POPUP,
        monX, monY, STRIP_W, monH,
        NULL, NULL, g_hMod, NULL);

    if (!g_hwnd) { Log("CreateWindowEx failed: %lu", GetLastError()); return 1; }
    Log("AppBar window created: %p  size=(%d x %d)", (void*)g_hwnd, STRIP_W, monH);

    // Transparent background + initial faint alpha (UpdateAlpha sets both flags)
    UpdateAlpha();

    // Register as an AppBar on the left edge
    {
        APPBARDATA abd = { sizeof(abd) };
        abd.hWnd             = g_hwnd;
        abd.uCallbackMessage = WM_APPBAR;
        if (SHAppBarMessage(ABM_NEW, &abd)) {
            g_appBarReg = true;
            Log("AppBar registered");
        } else {
            Log("AppBar ABM_NEW failed — falling back to plain window");
        }
    }

    PositionAppBar();   // sets final size/position via ABM_SETPOS + SetWindowPos
    UpdateWindow(g_hwnd);

    // Start IPC thread and mouse hook
    HANDLE hIpcThd = CreateThread(NULL, 0, IpcProc, NULL, 0, NULL);
    g_mouseHook = SetWindowsHookEx(WH_MOUSE_LL, LowLevelMouseProc, NULL, 0);
    Log("IPC thread: %p  mouse hook: %p", (void*)hIpcThd, (void*)g_mouseHook);

    MSG msg;
    while (g_running && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    Log("BtnThread exiting");
    if (g_mouseHook) { UnhookWindowsHookEx(g_mouseHook); g_mouseHook = NULL; }
    g_running = false;
    if (g_sock != INVALID_SOCKET) { closesocket(g_sock); g_sock = INVALID_SOCKET; }
    if (hIpcThd) { WaitForSingleObject(hIpcThd, 3000); CloseHandle(hIpcThd); }
    if (g_hwnd)  { DestroyWindow(g_hwnd); g_hwnd = NULL; }
    UnregisterClass(WND_CLASS, g_hMod);
    return 0;
}

// ── DllMain ───────────────────────────────────────────────────────────────────
BOOL WINAPI DllMain(HINSTANCE hInst, DWORD reason, LPVOID)
{
    switch (reason) {
    case DLL_PROCESS_ATTACH:
        DisableThreadLibraryCalls(hInst);
        g_hMod    = hInst;
        g_running = true;
        GetModuleFileNameW(hInst, g_logPath, MAX_PATH);
        { wchar_t* s = wcsrchr(g_logPath, L'\\'); if (s) wcscpy(s + 1, L"hook.log"); }
        { FILE* f = _wfopen(g_logPath, L"w"); if (f) fclose(f); }
        Log("DLL_PROCESS_ATTACH PID=%lu", GetCurrentProcessId());
        CreateThread(NULL, 0, BtnThread, NULL, 0, NULL);
        break;
    case DLL_PROCESS_DETACH:
        g_running = false;
        if (g_hwnd) PostMessage(g_hwnd, WM_QUIT, 0, 0);
        if (g_sock != INVALID_SOCKET) { closesocket(g_sock); g_sock = INVALID_SOCKET; }
        break;
    }
    return TRUE;
}
