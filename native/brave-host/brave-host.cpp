// brave-host.cpp
// Launches Brave once, reparents it into braveWin, then navigates via CDP.
//
// Protocol (newline-delimited JSON):
//   Electron → brave-host  {"type":"open","hwnd":N,"url":"...","y":41,"w":900,"h":H}
//   Electron → brave-host  {"type":"navigate","url":"..."}
//   Electron → brave-host  {"type":"resize","w":900,"h":H}
//   Electron → brave-host  {"type":"close"}
//   brave-host → Electron  {"type":"ready"}
//   brave-host → Electron  {"type":"error","msg":"..."}

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
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
    // Skip optional whitespace (pretty-printed JSON has ": " not just ":")
    while (p < j.size() && (j[p]==' '||j[p]=='\t'||j[p]=='\r'||j[p]=='\n')) p++;
    if (p >= j.size() || j[p] != '"') return "";
    p++; // skip opening quote
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
static const int CDP_PORT = 9232; // Use non-standard port to avoid conflicts

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

// Retry until CDP port is ready (Brave takes ~1-3s after launch)
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

// Find the first target of type "page" with an http/https URL and return its WS URL.
// Iterates objects in the JSON array from /json so we skip extension background pages.
static std::string FindPageTarget(const std::string& jsonArray) {
    size_t pos = 0;
    while (pos < jsonArray.size()) {
        size_t objStart = jsonArray.find('{', pos);
        if (objStart == std::string::npos) break;
        // Find the closing brace at the same depth
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

    // Extract path: "ws://localhost:9232/devtools/page/XXX" → "/devtools/page/XXX"
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

    // Escape url for JSON
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

    // Read one response
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

// ── Global state ──────────────────────────────────────────────────────────────
static PROCESS_INFORMATION g_pi   = {};
static HWND                g_brave = NULL;
static HWND                g_parent = NULL;
static int                 g_y = 41, g_w = 900, g_h = 800;
static std::wstring        g_bravePath;
static bool                g_launched = false; // Brave launched and reparented

static void KillBrave() {
    g_launched = false;
    if (g_brave && IsWindow(g_brave)) {
        // Reparent back to desktop and hide before killing — prevents the window
        // escaping as a visible top-level window while the process is dying.
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
    if (!g_parent) return false;
    g_brave = FindNewBraveHwnd(snapBefore, 12000);
    if (!g_brave) { Log("[brave] HWND not found"); return false; }
    Log("[brave] HWND: " + std::to_string((size_t)g_brave));

    LONG_PTR style = GetWindowLongPtrW(g_brave, GWL_STYLE);
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU | WS_BORDER);
    style |= WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    SetWindowLongPtrW(g_brave, GWL_STYLE, style);
    LONG_PTR exStyle = GetWindowLongPtrW(g_brave, GWL_EXSTYLE);
    exStyle &= ~(WS_EX_APPWINDOW | WS_EX_OVERLAPPEDWINDOW);
    SetWindowLongPtrW(g_brave, GWL_EXSTYLE, exStyle);
    SetParent(g_brave, g_parent);
    SetWindowPos(g_brave, HWND_TOP, 0, g_y, g_w, g_h - g_y,
                 SWP_SHOWWINDOW | SWP_FRAMECHANGED);
    g_launched = true;
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
        g_parent = reinterpret_cast<HWND>((ULONG_PTR)jnum(line, "hwnd"));
        g_y = (int)jnum(line, "y");
        g_w = (int)jnum(line, "w");
        g_h = (int)jnum(line, "h");
        std::string url = jstr(line, "url");
        SnapData sd; EnumWindows(SnapProc, reinterpret_cast<LPARAM>(&sd));
        std::vector<HWND> snap = sd.hwnds;
        KillBrave(); // ensure clean start
        if (LaunchBrave(url, snap)) {
            std::thread([snap](){
                if (ReparentBrave(snap)) Send("{\"type\":\"ready\"}");
                else                     Send("{\"type\":\"error\",\"msg\":\"hwnd not found\"}");
            }).detach();
        }
    }
    else if (type == "navigate") {
        std::string url = jstr(line, "url");
        if (!g_launched) {
            // Not yet launched — open fresh
            SnapData sd; EnumWindows(SnapProc, reinterpret_cast<LPARAM>(&sd));
            std::vector<HWND> snap = sd.hwnds;
            if (LaunchBrave(url, snap)) {
                std::thread([snap](){
                    if (ReparentBrave(snap)) Send("{\"type\":\"ready\"}");
                }).detach();
            }
        } else {
            // Already running — navigate in place via CDP, no new window
            std::thread([url](){
                if (NavigateViaCDP(url)) Send("{\"type\":\"ready\"}");
                else                     Send("{\"type\":\"error\",\"msg\":\"cdp navigate failed\"}");
            }).detach();
        }
    }
    else if (type == "resize") {
        g_w = (int)jnum(line, "w");
        g_h = (int)jnum(line, "h");
        if (g_brave && IsWindow(g_brave))
            SetWindowPos(g_brave, NULL, 0, g_y, g_w, g_h - g_y, SWP_NOZORDER | SWP_NOACTIVATE);
    }
    else if (type == "close") {
        KillBrave();
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
            closesocket(s); Sleep(1000); continue;
        }
        { std::lock_guard<std::mutex> lk(g_sockMtx); g_sock = s; }
        Log("[tcp] connected");
        Send("{\"type\":\"ready\"}");
        std::string buf;
        char tmp[4096];
        while (true) {
            int n = recv(s, tmp, sizeof(tmp) - 1, 0);
            if (n <= 0) break;
            tmp[n] = '\0';
            buf += tmp;
            size_t pos;
            while ((pos = buf.find('\n')) != std::string::npos) {
                std::string msg = buf.substr(0, pos);
                buf.erase(0, pos + 1);
                if (!msg.empty()) HandleMessage(msg);
            }
        }
        { std::lock_guard<std::mutex> lk(g_sockMtx); g_sock = INVALID_SOCKET; }
        closesocket(s);
        Log("[tcp] disconnected — reconnecting");
        Sleep(1000);
    }
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    wchar_t mod[MAX_PATH];
    GetModuleFileNameW(NULL, mod, MAX_PATH);
    std::wstring dir(mod);
    dir = dir.substr(0, dir.rfind(L'\\'));
    g_logPath = dir + L"\\brave-host.log";
    { std::ofstream f(g_logPath); }

    g_bravePath = FindBrave();
    if (g_bravePath.empty()) Log("[brave] not found");
    else {
        std::string s(g_bravePath.begin(), g_bravePath.end());
        Log("[brave] path: " + s);
    }

    WSADATA wsa; WSAStartup(MAKEWORD(2,2), &wsa);
    ConnectLoop();
    WSACleanup();
    return 0;
}
