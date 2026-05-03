// brave-host.cpp
// Launches Brave once, reparents it into a self-created plain Win32 shell window,
// then navigates via CDP.
//
// Protocol (newline-delimited JSON):
//   Electron → brave-host  {"type":"open","hwnd":0,"url":"...","x":PX,"y":PY,"w":W,"h":H}
//                           x,y = screen coords for the shell window
//   Electron → brave-host  {"type":"navigate","url":"..."}
//   Electron → brave-host  {"type":"resize","w":W,"h":H}
//   Electron → brave-host  {"type":"close"}
//   Electron → brave-host  {"type":"detach"}
//   Electron → brave-host  {"type":"round-corners","hwnd":N}
//   Electron → brave-host  {"type":"z-top","hwnd":N}
//   Electron → brave-host  {"type":"z-bottom","hwnd":N}
//   Electron → brave-host  {"type":"taskbar-hide"}
//   Electron → brave-host  {"type":"taskbar-show"}
//   brave-host → Electron  {"type":"ready"}
//   brave-host → Electron  {"type":"error","msg":"..."}

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwmapi.h>
#include <winhttp.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <shellapi.h>
#include <shlobj.h>

#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <atomic>
#include <mutex>
#include <fstream>
#include <sstream>
#include <algorithm>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "psapi.lib")
#pragma comment(lib, "dwmapi.lib")

// ── Logging ───────────────────────────────────────────────────────────────────
static std::wstring g_logPath;
static std::mutex   g_logMtx;
static void Log(const std::string& msg) {
    std::lock_guard<std::mutex> lk(g_logMtx);
    std::ofstream f(g_logPath, std::ios::app);
    f << msg << "\n";
}

// ── JSON helpers ──────────────────────────────────────────────────────────────
static std::string jstr(const std::string& j, const std::string& key) {
    std::string needle = "\"" + key + "\":";
    auto p = j.find(needle);
    if (p == std::string::npos) return "";
    p += needle.size();
    while (p < j.size() && (j[p]==' '||j[p]=='\t'||j[p]=='\r'||j[p]=='\n')) p++;
    if (p >= j.size() || j[p] != '"') return "";
    p++;
    auto e = j.find('"', p);
    return e == std::string::npos ? "" : j.substr(p, e - p);
}
static long long jnum(const std::string& j, const std::string& key) {
    std::string needle = "\"" + key + "\":";
    auto p = j.find(needle);
    if (p == std::string::npos) return 0;
    p += needle.size();
    while (p < j.size() && (j[p]==' '||j[p]=='\t'||j[p]=='\r'||j[p]=='\n')) p++;
    try { return std::stoll(j.substr(p)); } catch (...) { return 0; }
}

// ── Brave path detection ──────────────────────────────────────────────────────
static std::wstring FindBrave() {
    const wchar_t* paths[] = {
        L"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        L"C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    };
    for (auto p : paths)
        if (GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES) return p;
    wchar_t local[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, local))) {
        std::wstring p = std::wstring(local) + L"\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
        if (GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES) return p;
    }
    return L"";
}

static void PumpPending();  // forward declaration — defined in shell section below

// ── HWND snapshot ─────────────────────────────────────────────────────────────
struct SnapData { std::vector<HWND> hwnds; };
static BOOL CALLBACK SnapProc(HWND hw, LPARAM lp) {
    wchar_t cls[64] = {};
    GetClassNameW(hw, cls, 64);
    if (wcscmp(cls, L"Chrome_WidgetWin_1") == 0 && IsWindowVisible(hw)) {
        RECT r; GetWindowRect(hw, &r);
        if ((r.right - r.left) >= 100)
            reinterpret_cast<SnapData*>(lp)->hwnds.push_back(hw);
    }
    return TRUE;
}
static HWND FindNewBraveHwnd(const std::vector<HWND>& before, int timeoutMs = 12000) {
    auto start = std::chrono::steady_clock::now();
    while (std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - start).count() < timeoutMs) {
        PumpPending();  // keep message pump alive while we wait for Brave
        SnapData sd; EnumWindows(SnapProc, reinterpret_cast<LPARAM>(&sd));
        for (auto hw : sd.hwnds) {
            if (std::find(before.begin(), before.end(), hw) == before.end()) {
                RECT r; GetWindowRect(hw, &r);
                if ((r.right - r.left) >= 200 && (r.bottom - r.top) >= 200)
                    return hw;
            }
        }
        Sleep(100);
    }
    return NULL;
}

// ── Kill process tree ─────────────────────────────────────────────────────────
static void KillTree(DWORD pid) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W pe{ sizeof(pe) };
    std::vector<DWORD> kids;
    if (Process32FirstW(snap, &pe))
        do { if (pe.th32ParentProcessID == pid) kids.push_back(pe.th32ProcessID); }
        while (Process32NextW(snap, &pe));
    CloseHandle(snap);
    for (auto k : kids) KillTree(k);
    HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
    if (h) { TerminateProcess(h, 0); CloseHandle(h); }
}

// ── CDP navigation via WinHTTP WebSocket ──────────────────────────────────────
static const int CDP_PORT = 9232;

static std::string CdpHttpGet(const wchar_t* path) {
    HINTERNET hSess = WinHttpOpen(L"wp", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    if (!hSess) return "";
    HINTERNET hConn = WinHttpConnect(hSess, L"localhost", CDP_PORT, 0);
    HINTERNET hReq  = WinHttpOpenRequest(hConn, L"GET", path, NULL, NULL, NULL, 0);
    std::string result;
    if (hReq && WinHttpSendRequest(hReq, NULL, 0, NULL, 0, 0, 0) &&
        WinHttpReceiveResponse(hReq, NULL)) {
        DWORD avail = 0;
        while (WinHttpQueryDataAvailable(hReq, &avail) && avail > 0) {
            std::vector<char> buf(avail + 1, 0);
            DWORD read = 0;
            WinHttpReadData(hReq, buf.data(), avail, &read);
            result.append(buf.data(), read);
        }
    }
    if (hReq)  WinHttpCloseHandle(hReq);
    if (hConn) WinHttpCloseHandle(hConn);
    WinHttpCloseHandle(hSess);
    return result;
}

static std::string CdpGetJson(int timeoutMs = 10000) {
    auto start = std::chrono::steady_clock::now();
    while (std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - start).count() < timeoutMs) {
        std::string j = CdpHttpGet(L"/json");
        if (!j.empty() && j.find("webSocketDebuggerUrl") != std::string::npos)
            return j;
        Sleep(200);
    }
    return "";
}

static std::string FindPageTarget(const std::string& jsonArray) {
    size_t pos = 0;
    while (pos < jsonArray.size()) {
        size_t objStart = jsonArray.find('{', pos);
        if (objStart == std::string::npos) break;
        int depth = 0; size_t objEnd = std::string::npos;
        for (size_t i = objStart; i < jsonArray.size(); i++) {
            if (jsonArray[i] == '{') depth++;
            else if (jsonArray[i] == '}') { if (--depth == 0) { objEnd = i; break; } }
        }
        if (objEnd == std::string::npos) break;
        std::string obj = jsonArray.substr(objStart, objEnd - objStart + 1);
        std::string type  = jstr(obj, "type");
        std::string wsUrl = jstr(obj, "webSocketDebuggerUrl");
        std::string pUrl  = jstr(obj, "url");
        Log("[cdp] target type=" + type + " url=" + pUrl);
        if (type == "page" && !wsUrl.empty())
            return wsUrl;
        pos = objEnd + 1;
    }
    return "";
}

static bool NavigateViaCDP(const std::string& url) {
    std::string json = CdpGetJson(8000);
    if (json.empty()) { Log("[cdp] /json timeout"); return false; }
    Log("[cdp] /json response length=" + std::to_string(json.size()));

    std::string wsUrlFull = FindPageTarget(json);
    if (wsUrlFull.empty()) { Log("[cdp] no page target found"); return false; }
    Log("[cdp] wsUrl: " + wsUrlFull);

    auto pathPos = wsUrlFull.find("/devtools");
    if (pathPos == std::string::npos) { Log("[cdp] bad wsUrl"); return false; }
    std::string wsPath = wsUrlFull.substr(pathPos);
    std::wstring wsPathW(wsPath.begin(), wsPath.end());

    HINTERNET hSess = WinHttpOpen(L"wp", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    HINTERNET hConn = WinHttpConnect(hSess, L"localhost", CDP_PORT, 0);
    HINTERNET hReq  = WinHttpOpenRequest(hConn, L"GET", wsPathW.c_str(), NULL, NULL, NULL, 0);

    WinHttpSetOption(hReq, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0);
    if (!WinHttpSendRequest(hReq, NULL, 0, NULL, 0, 0, 0) ||
        !WinHttpReceiveResponse(hReq, NULL)) {
        Log("[cdp] ws upgrade failed"); WinHttpCloseHandle(hReq);
        WinHttpCloseHandle(hConn); WinHttpCloseHandle(hSess); return false;
    }

    HINTERNET hWs = WinHttpWebSocketCompleteUpgrade(hReq, NULL);
    WinHttpCloseHandle(hReq);
    if (!hWs) { Log("[cdp] ws complete failed"); WinHttpCloseHandle(hConn); WinHttpCloseHandle(hSess); return false; }

    std::string safeUrl;
    for (char c : url) {
        if (c == '"') safeUrl += "\\\"";
        else if (c == '\\') safeUrl += "\\\\";
        else safeUrl += c;
    }
    std::string msg = "{\"id\":1,\"method\":\"Page.navigate\",\"params\":{\"url\":\"" + safeUrl + "\"}}";
    DWORD sent = WinHttpWebSocketSend(hWs, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,
                                      (PVOID)msg.c_str(), (DWORD)msg.size());
    Log("[cdp] Page.navigate sent, result=" + std::to_string(sent));

    char resp[4096] = {}; DWORD respLen = 0;
    WINHTTP_WEB_SOCKET_BUFFER_TYPE bufType;
    WinHttpWebSocketReceive(hWs, resp, sizeof(resp) - 1, &respLen, &bufType);
    Log("[cdp] response: " + std::string(resp, respLen));

    WinHttpWebSocketClose(hWs, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
    WinHttpCloseHandle(hWs);
    WinHttpCloseHandle(hConn);
    WinHttpCloseHandle(hSess);
    return true;
}

// Forward declaration (g_brave defined in Global state section below)
static HWND g_brave;

// ── Shell window (plain Win32 container for Brave, no Chromium) ───────────────
// Using a plain Win32 window avoids Chromium renderer focus competition.
// Electron's transparent panel (alwaysOnTop) overlays the toolbar above this.

static LRESULT CALLBACK ShellWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_SETFOCUS && g_brave && IsWindow(g_brave)) {
        // Forward keyboard focus to the Brave child so scroll/zoom/keyboard work
        DWORD braveThread = GetWindowThreadProcessId(g_brave, NULL);
        DWORD ourThread   = GetCurrentThreadId();
        if (braveThread != ourThread) AttachThreadInput(ourThread, braveThread, TRUE);
        SetFocus(g_brave);
        if (braveThread != ourThread) AttachThreadInput(ourThread, braveThread, FALSE);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

static void RegisterShellClass() {
    static bool done = false;
    if (done) return;
    done = true;
    WNDCLASSW wc{};
    wc.lpfnWndProc   = ShellWndProc;
    wc.hInstance     = GetModuleHandleW(NULL);
    wc.lpszClassName = L"WP_BraveShell";
    // Match the panel background color (rgba 55,60,80) so any sub-pixel gap
    // around Brave's content blends with the panel-color backdrop rather than
    // showing a black border.
    wc.hbrBackground = CreateSolidBrush(RGB(55, 60, 80));
    RegisterClassW(&wc);
}

static HWND CreateShellWin(int x, int y, int w, int h) {
    RegisterShellClass();
    // Create hidden — shown only after Brave is reparented and ready (no black flash)
    HWND hwnd = CreateWindowExW(
        WS_EX_TOOLWINDOW,                       // no taskbar button
        L"WP_BraveShell", L"",
        WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        x, y, w, h,
        NULL, NULL, GetModuleHandleW(NULL), NULL);
    if (hwnd)
        SetWindowPos(hwnd, HWND_TOP, x, y, w, h, SWP_NOACTIVATE | SWP_HIDEWINDOW);
    return hwnd;
}

// Drain the calling thread's message queue (non-blocking).
// Called from the main IO loop so the shell window's messages are
// processed on the same thread that created it.
static void PumpPending() {
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

// ── Global state ──────────────────────────────────────────────────────────────
static PROCESS_INFORMATION g_pi     = {};
// g_brave forward-declared above (used by ShellWndProc)
static HWND                g_parent = NULL;
static HWND                g_shell  = NULL;   // shell window we create
static int                 g_x = 0, g_y = 0, g_w = 900, g_h = 800;
static int                 g_shellX = 0, g_shellY = 0;
static std::wstring        g_bravePath;
static bool                g_launched = false;

static void DestroyShell() {
    if (g_shell && IsWindow(g_shell)) {
        DestroyWindow(g_shell);
        g_shell = NULL;
    }
}

static void KillBrave() {
    g_launched = false;
    if (g_brave && IsWindow(g_brave)) {
        SetParent(g_brave, NULL);
        ShowWindow(g_brave, SW_HIDE);
    }
    g_brave = NULL;
    if (g_pi.hProcess) {
        KillTree(g_pi.dwProcessId);
        CloseHandle(g_pi.hProcess);
        CloseHandle(g_pi.hThread);
        g_pi = {};
    }
}

static bool LaunchBrave(const std::string& url, const std::vector<HWND>& snapBefore) {
    if (g_bravePath.empty()) { Log("[brave] exe not found"); return false; }
    std::wstring wurl(url.begin(), url.end());
    std::wstring port = std::to_wstring(CDP_PORT);
    std::wstring args = L"\"" + g_bravePath + L"\""
        L" --app=" + wurl +
        L" --no-first-run"
        L" --no-default-browser-check"
        L" --force-dark-mode"
        L" --enable-features=WebContentsForceDark"
        L" --remote-debugging-port=" + port;

    STARTUPINFOW si{ sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_SHOWNOACTIVATE;
    if (!CreateProcessW(NULL, args.data(), NULL, NULL, FALSE,
                        CREATE_NO_WINDOW, NULL, NULL, &si, &g_pi)) {
        Log("[brave] CreateProcess failed: " + std::to_string(GetLastError()));
        return false;
    }
    Log("[brave] launched PID=" + std::to_string(g_pi.dwProcessId));
    return true;
}

static bool ReparentBrave(const std::vector<HWND>& snapBefore) {
    if (!g_parent) { Log("[reparent] no parent"); return false; }
    g_brave = FindNewBraveHwnd(snapBefore, 12000);
    if (!g_brave) { Log("[reparent] HWND not found after timeout"); return false; }
    Log("[reparent] brave HWND=" + std::to_string((size_t)g_brave)
        + " shell=" + std::to_string((size_t)g_shell)
        + " pos=" + std::to_string(g_shellX) + "," + std::to_string(g_shellY)
        + " size=" + std::to_string(g_w) + "x" + std::to_string(g_h));

    // Strip caption/border; add WS_CHILD so Brave renders inside the shell
    LONG_PTR style = GetWindowLongPtrW(g_brave, GWL_STYLE);
    Log("[reparent] original style=" + std::to_string(style));
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU | WS_BORDER);
    style |= WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    BOOL ok1 = SetWindowLongPtrW(g_brave, GWL_STYLE, style) || GetLastError() == 0;
    Log("[reparent] SetWindowLongPtr(STYLE) ok=" + std::to_string(ok1) + " err=" + std::to_string(GetLastError()));

    LONG_PTR exStyle = GetWindowLongPtrW(g_brave, GWL_EXSTYLE);
    exStyle &= ~(WS_EX_APPWINDOW | WS_EX_OVERLAPPEDWINDOW);
    SetWindowLongPtrW(g_brave, GWL_EXSTYLE, exStyle);

    HWND prev = SetParent(g_brave, g_shell);
    Log("[reparent] SetParent prev=" + std::to_string((size_t)prev) + " err=" + std::to_string(GetLastError()));

    // Position Brave so its Chromium-rendered chrome (tab/title bar) is clipped
    // off the top by the shell's bounds (WS_CLIPCHILDREN). The user only sees
    // the web content area below the chrome.
    // Chrome height in app-mode is ~34 logical px; scale by DPI to physical px.
    UINT dpi = GetDpiForWindow(g_shell);
    int chromeH = MulDiv(34, dpi, 96);
    Log("[reparent] dpi=" + std::to_string(dpi) + " chromeH=" + std::to_string(chromeH));
    BOOL ok2 = SetWindowPos(g_brave, HWND_TOP, 0, -chromeH, g_w, g_h + chromeH,
                            SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE);
    Log("[reparent] SetWindowPos(brave) ok=" + std::to_string(ok2) + " err=" + std::to_string(GetLastError()));

    g_launched = true;

    // Show shell as HWND_TOPMOST so it appears above the Electron window (which is
    // also TOPMOST). Shell is positioned below the 41px toolbar so the React
    // toolbar header remains visible. Brave content shows above Electron directly.
    BOOL ok3 = ShowWindow(g_shell, SW_SHOWNOACTIVATE);
    Log("[reparent] ShowWindow(shell) ok=" + std::to_string(ok3));
    BOOL ok4 = SetWindowPos(g_shell, HWND_TOPMOST, g_shellX, g_shellY, g_w, g_h,
                            SWP_NOACTIVATE);
    Log("[reparent] SetWindowPos(shell) ok=" + std::to_string(ok4) + " err=" + std::to_string(GetLastError()));

    AllowSetForegroundWindow(g_pi.dwProcessId);
    Log("[reparent] done");
    return true;
}

// ── TCP ───────────────────────────────────────────────────────────────────────
static SOCKET g_sock = INVALID_SOCKET;
static std::mutex g_sockMtx;
static void Send(const std::string& json) {
    std::lock_guard<std::mutex> lk(g_sockMtx);
    if (g_sock == INVALID_SOCKET) return;
    std::string line = json + "\n";
    send(g_sock, line.c_str(), (int)line.size(), 0);
}

static void HandleMessage(const std::string& line) {
    std::string type = jstr(line, "type");
    Log("[msg] " + line);

    if (type == "open") {
        g_shellX = (int)jnum(line, "x");  // screen coords for the shell window
        g_shellY = (int)jnum(line, "y");
        g_x = 0;  // Brave fills shell at (0,0)
        g_y = 0;
        g_w = (int)jnum(line, "w");
        g_h = (int)jnum(line, "h");
        std::string url = jstr(line, "url");

        // Destroy previous shell and kill Brave
        KillBrave();
        DestroyShell();

        // Create plain Win32 shell window — no Chromium renderer, so Brave owns focus
        g_shell  = CreateShellWin(g_shellX, g_shellY, g_w, g_h);
        g_parent = g_shell;
        Log("[shell] created hwnd=" + std::to_string((size_t)g_shell));

        SnapData sd; EnumWindows(SnapProc, reinterpret_cast<LPARAM>(&sd));
        std::vector<HWND> snap = sd.hwnds;
        if (LaunchBrave(url, snap)) {
            // Synchronous — main thread blocks here (pumping messages via PumpPending
            // inside FindNewBraveHwnd) until Brave's HWND appears. No detached thread,
            // no race with concurrent "close" messages.
            if (ReparentBrave(snap)) Send("{\"type\":\"ready\"}");
            else                     Send("{\"type\":\"error\",\"msg\":\"hwnd not found\"}");
        }
    }
    else if (type == "navigate") {
        std::string url = jstr(line, "url");
        if (!g_launched) {
            SnapData sd; EnumWindows(SnapProc, reinterpret_cast<LPARAM>(&sd));
            std::vector<HWND> snap = sd.hwnds;
            if (LaunchBrave(url, snap)) {
                if (ReparentBrave(snap)) Send("{\"type\":\"ready\"}");
            }
        } else {
            if (NavigateViaCDP(url)) Send("{\"type\":\"ready\"}");
            else                     Send("{\"type\":\"error\",\"msg\":\"cdp navigate failed\"}");
        }
    }
    else if (type == "resize") {
        g_w = (int)jnum(line, "w");
        g_h = (int)jnum(line, "h");
        if (g_shell && IsWindow(g_shell))
            SetWindowPos(g_shell, NULL, 0, 0, g_w, g_h,
                         SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        if (g_brave && IsWindow(g_brave))
            SetWindowPos(g_brave, NULL, 0, 0, g_w, g_h,
                         SWP_NOZORDER | SWP_NOACTIVATE);
    }
    else if (type == "close") {
        KillBrave();
        DestroyShell();
    }
    else if (type == "round-corners") {
        HWND hwnd = (HWND)(uintptr_t)(unsigned long long)jnum(line, "hwnd");
        if (hwnd && IsWindow(hwnd)) {
            DWORD pref = 2;  // DWMWCP_ROUND
            DwmSetWindowAttribute(hwnd, 33 /*DWMWA_WINDOW_CORNER_PREFERENCE*/, &pref, sizeof(pref));
        }
    }
    else if (type == "z-top") {
        HWND hwnd = (HWND)(uintptr_t)(unsigned long long)jnum(line, "hwnd");
        if (hwnd && IsWindow(hwnd))
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    else if (type == "z-bottom") {
        HWND hwnd = (HWND)(uintptr_t)(unsigned long long)jnum(line, "hwnd");
        if (hwnd && IsWindow(hwnd))
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    else if (type == "taskbar-hide") {
        HWND tray = FindWindowW(L"Shell_TrayWnd", NULL);
        if (tray) ShowWindow(tray, SW_HIDE);
    }
    else if (type == "taskbar-show") {
        HWND tray = FindWindowW(L"Shell_TrayWnd", NULL);
        if (tray) ShowWindow(tray, SW_SHOW);
    }
    else if (type == "detach") {
        if (g_brave && IsWindow(g_brave)) {
            LONG_PTR style = GetWindowLongPtrW(g_brave, GWL_STYLE);
            style &= ~WS_CHILD;
            style |= WS_OVERLAPPEDWINDOW;
            SetWindowLongPtrW(g_brave, GWL_STYLE, style);
            LONG_PTR exStyle = GetWindowLongPtrW(g_brave, GWL_EXSTYLE);
            exStyle |= WS_EX_APPWINDOW;
            SetWindowLongPtrW(g_brave, GWL_EXSTYLE, exStyle);
            SetParent(g_brave, NULL);
            ShowWindow(g_brave, SW_HIDE);
            SetWindowPos(g_brave, NULL, 0, 0, 0, 0,
                         SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
        }
        g_brave    = NULL;
        g_launched = false;
        if (g_pi.hProcess) { CloseHandle(g_pi.hProcess); CloseHandle(g_pi.hThread); g_pi = {}; }
        DestroyShell();
    }
}

static void ConnectLoop() {
    const int PORT = 47322;
    while (true) {
        SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(PORT);
        inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
        if (connect(s, (sockaddr*)&addr, sizeof(addr)) != 0) {
            closesocket(s);
            // Pump messages while waiting to reconnect so the shell stays responsive
            for (int i = 0; i < 50; i++) { PumpPending(); Sleep(20); }
            continue;
        }
        { std::lock_guard<std::mutex> lk(g_sockMtx); g_sock = s; }
        Log("[tcp] connected");
        Send("{\"type\":\"ready\"}");
        std::string buf;
        char tmp[4096];
        while (true) {
            // Pump window messages before waiting for socket data (non-blocking)
            PumpPending();
            // Wait up to 16 ms for socket data, keeping message latency low
            fd_set fds; FD_ZERO(&fds); FD_SET(s, &fds);
            timeval tv{0, 16000};
            int r = select(0, &fds, NULL, NULL, &tv);
            if (r < 0) break;
            if (r == 0) continue;  // timeout — loop back to pump messages
            int n = recv(s, tmp, sizeof(tmp) - 1, 0);
            if (n <= 0) break;
            tmp[n] = '\0';
            buf += tmp;
            size_t pos;
            while ((pos = buf.find('\n')) != std::string::npos) {
                std::string line = buf.substr(0, pos);
                buf.erase(0, pos + 1);
                if (!line.empty()) HandleMessage(line);
            }
        }
        { std::lock_guard<std::mutex> lk(g_sockMtx); g_sock = INVALID_SOCKET; }
        closesocket(s);
        Log("[tcp] disconnected — reconnecting");
        for (int i = 0; i < 50; i++) { PumpPending(); Sleep(20); }
    }
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    wchar_t mod[MAX_PATH];
    GetModuleFileNameW(NULL, mod, MAX_PATH);
    std::wstring dir(mod);
    dir = dir.substr(0, dir.rfind(L'\\'));
    g_logPath = dir + L"\\brave-host.log";
    { std::ofstream f(g_logPath); }  // clear log first so any crash below is diagnosable

    // Declare Per-Monitor DPI awareness so all Win32 coordinate APIs use physical
    // pixels directly — coordinates from Electron are already physical (multiplied
    // by scaleFactor before being sent over TCP).
    BOOL dpiOk = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    Log("[dpi] SetProcessDpiAwarenessContext ok=" + std::to_string(dpiOk) + " err=" + std::to_string(GetLastError()));

    // Log physical screen dimensions so we can verify DPI awareness is active
    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);
    Log("[screen] physical " + std::to_string(sw) + "x" + std::to_string(sh));

    g_bravePath = FindBrave();
    if (g_bravePath.empty()) Log("[brave] not found");
    else {
        std::string s(g_bravePath.begin(), g_bravePath.end());
        Log("[brave] path: " + s);
    }

    WSADATA wsa; WSAStartup(MAKEWORD(2,2), &wsa);

    // Main thread owns the shell window and pumps its messages via PumpPending()
    // interleaved with the IO loop — no separate pump thread needed.
    ConnectLoop();
    WSACleanup();
    return 0;
}
