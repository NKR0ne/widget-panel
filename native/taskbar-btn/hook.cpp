/*
 * taskbar-hook.dll  —  injected into Explorer.exe
 *
 * Subclasses Shell_TrayWnd so TraySubclassProc runs synchronously on
 * Explorer's own thread for every z-order/position change.
 *
 * IPC: TCP 127.0.0.1:47321 — no integrity-level restrictions (named pipes
 * blocked Explorer→Electron with ERROR_ACCESS_DENIED).
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
#include <dwmapi.h>
#include <string>
#include <cstdio>
#include <cstdarg>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")

// ── Constants ─────────────────────────────────────────────────────────────────
static const wchar_t* WND_CLASS = L"WPHookBtn";
static const UINT     WM_TBSYNC = WM_APP + 1;
static const int      IPC_PORT  = 47321;

static const int BTN_W = 44;
static const int BTN_H = 40;

static const COLORREF CLR_BG     = RGB(0x11, 0x11, 0x14);
static const COLORREF CLR_ACTIVE = RGB(0x4f, 0x8e, 0xf7);
static const COLORREF CLR_IDLE   = RGB(0x28, 0x28, 0x38);
static const COLORREF CLR_BADGE  = RGB(0xf7, 0x4f, 0x7e);
static const COLORREF CLR_WHITE  = RGB(0xff, 0xff, 0xff);

// ── State ─────────────────────────────────────────────────────────────────────
static HWND          g_hwnd         = NULL;
static HWND          g_taskbar      = NULL;
static HMODULE       g_hMod         = NULL;
static WNDPROC       g_origTrayProc = NULL;
static SOCKET        g_sock         = INVALID_SOCKET;
static int           g_badge        = 0;
static volatile bool g_panelOn      = true;
static volatile bool g_hover        = false;
static volatile bool g_running      = true;
static wchar_t       g_logPath[MAX_PATH] = {};

// ── Mouse hook state (click-outside detection) ────────────────────────────────
static HHOOK              g_mouseHook  = NULL;
static LONG_PTR  g_panelHwnd  = 0;   // HWND of Electron panel window
static LONG_PTR  g_braveHwnd  = 0;   // HWND of Brave toolbar window (0 if closed)

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

// ── Sync button with taskbar ──────────────────────────────────────────────────
static void SyncNow()
{
    if (!g_taskbar || !g_hwnd) return;
    RECT tb{};
    GetWindowRect(g_taskbar, &tb);
    int tbH = tb.bottom - tb.top;

    if (tbH <= 4) {
        if (IsWindowVisible(g_hwnd)) ShowWindow(g_hwnd, SW_HIDE);
        return;
    }

    int btnX = tb.left + 4;
    int btnY = tb.top  + (tbH - BTN_H) / 2;
    SetWindowPos(g_hwnd, HWND_TOPMOST,
                 btnX, btnY, BTN_W, BTN_H,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER);
}

// ── Shell_TrayWnd subclass ────────────────────────────────────────────────────
static LRESULT CALLBACK TraySubclassProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    LRESULT r = CallWindowProc(g_origTrayProc, hwnd, msg, wp, lp);
    switch (msg) {
    case WM_WINDOWPOSCHANGED:
    case WM_SIZE:
    case WM_MOVE:
        SyncNow();
        break;
    case WM_DESTROY:
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)g_origTrayProc);
        g_origTrayProc = NULL;
        break;
    }
    return r;
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
            if (g_hwnd) InvalidateRect(g_hwnd, NULL, FALSE);
        } else if (s.find("\"hwnd\"") != std::string::npos) {
            // {"type":"hwnd","panel":N,"brave":N}
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

// ── Low-level mouse hook — fires for every click, regardless of focus ─────────
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

// ── Rendering ─────────────────────────────────────────────────────────────────
static void DrawBtn(HDC hdc, RECT rc)
{
    HBRUSH bg = CreateSolidBrush(CLR_BG);
    FillRect(hdc, &rc, bg); DeleteObject(bg);

    int cx = (rc.left+rc.right)/2, cy = (rc.top+rc.bottom)/2, r = 11;

    COLORREF ic = (g_panelOn || g_hover) ? CLR_ACTIVE : CLR_IDLE;
    HPEN   pen = CreatePen(PS_SOLID, 0, ic);
    HBRUSH fil = CreateSolidBrush(ic);
    HPEN   op  = (HPEN)SelectObject(hdc, pen);
    HBRUSH ob  = (HBRUSH)SelectObject(hdc, fil);
    RoundRect(hdc, cx-r, cy-r, cx+r, cy+r, 6, 6);
    SelectObject(hdc, op); SelectObject(hdc, ob);
    DeleteObject(pen); DeleteObject(fil);

    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, CLR_WHITE);
    HFONT font = CreateFont(-11,0,0,0,FW_BOLD,0,0,0,ANSI_CHARSET,0,0,
                            CLEARTYPE_QUALITY,DEFAULT_PITCH|FF_SWISS,L"Segoe UI");
    HFONT of = (HFONT)SelectObject(hdc, font);
    RECT  ir{ cx-r, cy-r, cx+r, cy+r };
    DrawText(hdc, L"W", 1, &ir, DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    SelectObject(hdc, of); DeleteObject(font);

    if (g_badge > 0) {
        int bx=cx+r-2, by=cy-r+2, br=7;
        HPEN   bp  = CreatePen(PS_SOLID,0,CLR_BADGE);
        HBRUSH bbr = CreateSolidBrush(CLR_BADGE);
        SelectObject(hdc,bp); SelectObject(hdc,bbr);
        Ellipse(hdc,bx-br,by-br,bx+br,by+br);
        DeleteObject(bp); DeleteObject(bbr);
        wchar_t num[4]; swprintf_s(num,g_badge>9?L"9+":L"%d",g_badge);
        SetTextColor(hdc,CLR_WHITE);
        HFONT sf  = CreateFont(-7,0,0,0,FW_BOLD,0,0,0,ANSI_CHARSET,0,0,
                               CLEARTYPE_QUALITY,DEFAULT_PITCH|FF_SWISS,L"Segoe UI");
        HFONT osf = (HFONT)SelectObject(hdc,sf);
        RECT  br2{ bx-br,by-br,bx+br,by+br };
        DrawText(hdc,num,-1,&br2,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        SelectObject(hdc,osf); DeleteObject(sf);
    }
}

// ── Window proc ───────────────────────────────────────────────────────────────
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg) {
    case WM_TBSYNC: {
        MSG tmp;
        while (PeekMessage(&tmp, hwnd, WM_TBSYNC, WM_TBSYNC, PM_REMOVE)) {}
        SyncNow();
        return 0;
    }
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc; GetClientRect(hwnd, &rc);
        HDC mem = CreateCompatibleDC(hdc);
        HBITMAP bmp = CreateCompatibleBitmap(hdc, rc.right, rc.bottom);
        auto old = SelectObject(mem, bmp);
        DrawBtn(mem, rc);
        BitBlt(hdc,0,0,rc.right,rc.bottom,mem,0,0,SRCCOPY);
        SelectObject(mem,old); DeleteObject(bmp); DeleteDC(mem);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_LBUTTONUP:
        Log("clicked — sock=%s", g_sock != INVALID_SOCKET ? "connected" : "none");
        if (g_sock != INVALID_SOCKET) {
            // Panel is running — toggle it
            SendMsg(R"({"type":"toggle"})");
        } else {
            // Panel not running — launch it from panel.path file
            wchar_t pathFile[MAX_PATH];
            GetModuleFileNameW(g_hMod, pathFile, MAX_PATH);
            wchar_t* sl = wcsrchr(pathFile, L'\\');
            if (sl) wcscpy(sl + 1, L"panel.path");

            FILE* f = _wfopen(pathFile, L"r");
            if (f) {
                char launchPath[1024] = {};
                fread(launchPath, 1, sizeof(launchPath) - 1, f);
                fclose(f);
                // Trim newline
                for (char* p = launchPath; *p; p++) {
                    if (*p == '\r' || *p == '\n') { *p = 0; break; }
                }
                Log("launching: %s", launchPath);
                // Convert to wide and split into exe + args if needed
                wchar_t wpath[1024] = {};
                MultiByteToWideChar(CP_UTF8, 0, launchPath, -1, wpath, 1024);

                // Find first space to split exe from args
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
    case WM_MOUSEMOVE:
        if (!g_hover) {
            g_hover = true; InvalidateRect(hwnd,NULL,FALSE);
            TRACKMOUSEEVENT tme{sizeof(tme),TME_LEAVE,hwnd,0};
            TrackMouseEvent(&tme);
        }
        return 0;
    case WM_MOUSELEAVE:
        g_hover = false; InvalidateRect(hwnd,NULL,FALSE);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

// ── Button thread ─────────────────────────────────────────────────────────────
static DWORD WINAPI BtnThread(LPVOID)
{
    Log("BtnThread started");

    for (int i = 0; i < 30 && !g_taskbar; i++) {
        g_taskbar = FindWindow(L"Shell_TrayWnd", NULL);
        if (!g_taskbar) Sleep(500);
    }
    if (!g_taskbar) { Log("Shell_TrayWnd not found"); return 1; }
    Log("Shell_TrayWnd: %p", (void*)g_taskbar);

    WNDCLASSEX wc{};
    wc.cbSize = sizeof(wc); wc.style = CS_HREDRAW|CS_VREDRAW;
    wc.lpfnWndProc = WndProc; wc.hInstance = g_hMod;
    wc.hCursor = LoadCursor(NULL,IDC_HAND); wc.hbrBackground = NULL;
    wc.lpszClassName = WND_CLASS;
    RegisterClassEx(&wc);

    RECT tb{};
    GetWindowRect(g_taskbar, &tb);
    int tbH  = tb.bottom - tb.top;
    int btnX = tb.left + 4;
    int btnY = tb.top  + (tbH - BTN_H) / 2;

    g_hwnd = CreateWindowEx(
        WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
        WND_CLASS, L"W", WS_POPUP,
        btnX, btnY, BTN_W, BTN_H,
        NULL, NULL, g_hMod, NULL);

    if (!g_hwnd) { Log("CreateWindowEx failed: %lu", GetLastError()); return 1; }
    Log("popup created: %p", (void*)g_hwnd);

    DWM_WINDOW_CORNER_PREFERENCE pref = DWMWCP_ROUND;
    DwmSetWindowAttribute(g_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &pref, sizeof(pref));

    if (tbH > 4) ShowWindow(g_hwnd, SW_SHOWNOACTIVATE);
    UpdateWindow(g_hwnd);

    g_origTrayProc = (WNDPROC)SetWindowLongPtrW(
        g_taskbar, GWLP_WNDPROC, (LONG_PTR)TraySubclassProc);
    Log("subclassed Shell_TrayWnd; origProc=%p", (void*)g_origTrayProc);

    HANDLE hIpcThd = CreateThread(NULL, 0, IpcProc, NULL, 0, NULL);

    // Global low-level mouse hook — intercepts all clicks for click-outside detection.
    // Must be installed from a thread with a message pump (BtnThread qualifies).
    g_mouseHook = SetWindowsHookEx(WH_MOUSE_LL, LowLevelMouseProc, NULL, 0);
    Log("mouse hook: %p", (void*)g_mouseHook);

    MSG msg;
    while (g_running && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    Log("BtnThread exiting");
    if (g_mouseHook) { UnhookWindowsHookEx(g_mouseHook); g_mouseHook = NULL; }
    if (g_origTrayProc && g_taskbar) {
        SetWindowLongPtrW(g_taskbar, GWLP_WNDPROC, (LONG_PTR)g_origTrayProc);
        g_origTrayProc = NULL;
    }
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
        { wchar_t* s = wcsrchr(g_logPath, L'\\'); if (s) wcscpy(s+1, L"hook.log"); }
        { FILE* f = _wfopen(g_logPath, L"w"); if (f) fclose(f); }
        Log("DLL_PROCESS_ATTACH PID=%lu", GetCurrentProcessId());
        CreateThread(NULL, 0, BtnThread, NULL, 0, NULL);
        break;
    case DLL_PROCESS_DETACH:
        g_running = false;
        if (g_origTrayProc && g_taskbar) {
            SetWindowLongPtrW(g_taskbar, GWLP_WNDPROC, (LONG_PTR)g_origTrayProc);
            g_origTrayProc = NULL;
        }
        if (g_hwnd) PostMessage(g_hwnd, WM_QUIT, 0, 0);
        if (g_sock != INVALID_SOCKET) { closesocket(g_sock); g_sock = INVALID_SOCKET; }
        break;
    }
    return TRUE;
}
