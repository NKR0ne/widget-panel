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
//   Test/owner → brave-host {"type":"quit"}
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
#include <psapi.h>
#include <shellapi.h>
#include <shlobj.h>

#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <atomic>
#include <condition_variable>
#include <deque>
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
static void AppendUtf8(std::string& out, unsigned code) {
    if (code <= 0x7f) out.push_back((char)code);
    else if (code <= 0x7ff) {
        out.push_back((char)(0xc0 | (code >> 6)));
        out.push_back((char)(0x80 | (code & 0x3f)));
    } else {
        out.push_back((char)(0xe0 | (code >> 12)));
        out.push_back((char)(0x80 | ((code >> 6) & 0x3f)));
        out.push_back((char)(0x80 | (code & 0x3f)));
    }
}

static std::string jstr(const std::string& j, const std::string& key) {
    std::string needle = "\"" + key + "\":";
    auto p = j.find(needle);
    if (p == std::string::npos) return "";
    p += needle.size();
    while (p < j.size() && (j[p]==' '||j[p]=='\t'||j[p]=='\r'||j[p]=='\n')) p++;
    if (p >= j.size() || j[p] != '"') return "";
    p++;
    std::string out;
    while (p < j.size()) {
        char c = j[p++];
        if (c == '"') return out;
        if (c != '\\') { out.push_back(c); continue; }
        if (p >= j.size()) return "";
        char esc = j[p++];
        if (esc == '"' || esc == '\\' || esc == '/') out.push_back(esc);
        else if (esc == 'b') out.push_back('\b');
        else if (esc == 'f') out.push_back('\f');
        else if (esc == 'n') out.push_back('\n');
        else if (esc == 'r') out.push_back('\r');
        else if (esc == 't') out.push_back('\t');
        else if (esc == 'u' && p + 4 <= j.size()) {
            unsigned code = 0;
            for (int i = 0; i < 4; ++i) {
                char h = j[p++];
                code = code * 16 + (h >= '0' && h <= '9' ? h - '0'
                    : h >= 'a' && h <= 'f' ? h - 'a' + 10
                    : h >= 'A' && h <= 'F' ? h - 'A' + 10 : 0);
            }
            AppendUtf8(out, code);
        }
    }
    return "";
}
static long long jnum(const std::string& j, const std::string& key) {
    std::string needle = "\"" + key + "\":";
    auto p = j.find(needle);
    if (p == std::string::npos) return 0;
    p += needle.size();
    while (p < j.size() && (j[p]==' '||j[p]=='\t'||j[p]=='\r'||j[p]=='\n')) p++;
    try { return std::stoll(j.substr(p)); } catch (...) { return 0; }
}

static std::string JsonEscape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 16);
    for (unsigned char c : value) {
        if (c == '"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if (c < 0x20) {
            char buf[7];
            _snprintf_s(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
        } else out.push_back((char)c);
    }
    return out;
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
// ── Diagnostic: dump all top-level windows belonging to any brave.exe process ─
// Hypothesis-neutral: does NOT filter on class, size, or visibility. Captures
// raw state so we can tell post-mortem whether the new HWND is missing because
// our spawned process exited (single-instance delegation), the class changed,
// the window is cloaked, the size is below threshold, etc.
extern PROCESS_INFORMATION g_pi;  // resolved at link time, defined further down

static std::string PidImageNameLower(DWORD pid) {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) return "";
    wchar_t buf[MAX_PATH] = {};
    DWORD sz = MAX_PATH;
    std::string out;
    if (QueryFullProcessImageNameW(h, 0, buf, &sz)) {
        std::wstring w(buf);
        auto slash = w.find_last_of(L"\\/");
        if (slash != std::wstring::npos) w = w.substr(slash + 1);
        for (auto c : w) out.push_back((char)((c >= L'A' && c <= L'Z') ? c + 32 : c));
    }
    CloseHandle(h);
    return out;
}

struct DiagCtx { std::vector<HWND>* wins; };
static BOOL CALLBACK DiagEnumProc(HWND hw, LPARAM lp) {
    DWORD pid = 0;
    GetWindowThreadProcessId(hw, &pid);
    if (pid == 0) return TRUE;
    if (PidImageNameLower(pid) != "brave.exe") return TRUE;
    reinterpret_cast<DiagCtx*>(lp)->wins->push_back(hw);
    return TRUE;
}

static void DumpBraveWindows(const std::vector<HWND>& before, int elapsedSec) {
    std::vector<HWND> wins;
    DiagCtx ctx{ &wins };
    EnumWindows(DiagEnumProc, reinterpret_cast<LPARAM>(&ctx));

    std::string head = "[diag t=" + std::to_string(elapsedSec) + "s] brave-wins=" + std::to_string(wins.size());
    if (g_pi.hProcess) {
        DWORD wait = WaitForSingleObject(g_pi.hProcess, 0);
        if (wait == WAIT_OBJECT_0) {
            DWORD code = 0;
            GetExitCodeProcess(g_pi.hProcess, &code);
            head += " our-pid=" + std::to_string(g_pi.dwProcessId) + " EXITED code=" + std::to_string(code);
        } else {
            head += " our-pid=" + std::to_string(g_pi.dwProcessId) + " running";
        }
    }
    Log(head);

    for (HWND hw : wins) {
        DWORD pid = 0; GetWindowThreadProcessId(hw, &pid);
        wchar_t cls[128] = {}; GetClassNameW(hw, cls, 128);
        wchar_t tt[256] = {}; GetWindowTextW(hw, tt, 256);
        RECT r{}; GetWindowRect(hw, &r);
        BOOL vis = IsWindowVisible(hw);
        int cloaked = 0;
        DwmGetWindowAttribute(hw, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
        HWND owner = GetWindow(hw, GW_OWNER);
        LONG_PTR style = GetWindowLongPtrW(hw, GWL_STYLE);
        LONG_PTR ex = GetWindowLongPtrW(hw, GWL_EXSTYLE);
        bool inBefore = std::find(before.begin(), before.end(), hw) != before.end();

        std::wstring wcls(cls), wtt(tt);
        if (wtt.size() > 60) wtt = wtt.substr(0, 60);
        std::string scls(wcls.begin(), wcls.end());
        std::string stt(wtt.begin(), wtt.end());

        char buf[512];
        _snprintf_s(buf, sizeof(buf),
            "  hw=%llu pid=%lu cls=%s %ldx%ld vis=%d cloaked=%d owner=%llu style=0x%llx ex=0x%llx inBefore=%d title=\"%s\"",
            (unsigned long long)(size_t)hw, (unsigned long)pid, scls.c_str(),
            (long)(r.right - r.left), (long)(r.bottom - r.top),
            (int)vis, cloaked, (unsigned long long)(size_t)owner,
            (unsigned long long)style, (unsigned long long)ex,
            (int)inBefore, stt.c_str());
        Log(buf);
    }
}

static HWND FindNewBraveHwnd(const std::vector<HWND>& before, int timeoutMs = 12000) {
    auto start = std::chrono::steady_clock::now();
    DumpBraveWindows(before, 0);
    int lastDumpSec = 0;
    while (true) {
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::steady_clock::now() - start).count();
        if (elapsed >= timeoutMs) break;

        PumpPending();  // keep message pump alive while we wait for Brave
        SnapData sd; EnumWindows(SnapProc, reinterpret_cast<LPARAM>(&sd));
        for (auto hw : sd.hwnds) {
            if (std::find(before.begin(), before.end(), hw) == before.end()) {
                RECT r; GetWindowRect(hw, &r);
                if ((r.right - r.left) >= 200 && (r.bottom - r.top) >= 200) {
                    DumpBraveWindows(before, (int)(elapsed / 1000));
                    Log("[diag] match accepted hwnd=" + std::to_string((size_t)hw));
                    return hw;
                }
            }
        }
        int elapsedSec = (int)(elapsed / 1000);
        if (elapsedSec > lastDumpSec) {
            DumpBraveWindows(before, elapsedSec);
            lastDumpSec = elapsedSec;
        }
        Sleep(100);
    }
    DumpBraveWindows(before, timeoutMs / 1000);
    return NULL;
}

// ── CDP navigation via WinHTTP WebSocket ──────────────────────────────────────
static const int CDP_PORT = 9232;

static std::string CdpHttpGet(const wchar_t* path) {
    HINTERNET hSess = WinHttpOpen(L"wp", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    if (!hSess) return "";
    // The shell window lives on the socket thread. Bound localhost calls even
    // though CDP work normally runs on the worker, so shutdown and recovery
    // cannot stall indefinitely when Chromium is redirecting or exiting.
    WinHttpSetTimeouts(hSess, 1000, 1000, 1000, 1000);
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

// Per-call CDP navigate: fetch /json, open a fresh WebSocket to the current
// page target, send Page.navigate, close. No caching — the page target can
// change across cross-origin navigations, and a stale cached socket sends
// data that Brave silently drops. Cost is ~100ms per navigate (acceptable);
// we skip the receive-after-send so we don't block on a potentially slow
// Brave response.
static bool NavigateViaCDP(const std::string& url) {
    // 15s timeout — with --user-data-dir creating a fresh profile, Brave's
    // CDP takes longer to come online than with a warm profile. 8s wasn't
    // enough on the first post-open navigate.
    std::string json = CdpGetJson(15000);
    if (json.empty()) { Log("[cdp] /json timeout"); return false; }

    std::string wsUrlFull = FindPageTarget(json);
    if (wsUrlFull.empty()) { Log("[cdp] no page target found"); return false; }

    auto pathPos = wsUrlFull.find("/devtools");
    if (pathPos == std::string::npos) { Log("[cdp] bad wsUrl"); return false; }
    std::string wsPath = wsUrlFull.substr(pathPos);
    std::wstring wsPathW(wsPath.begin(), wsPath.end());

    HINTERNET hSess = WinHttpOpen(L"wp", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    if (!hSess) return false;
    HINTERNET hConn = WinHttpConnect(hSess, L"localhost", CDP_PORT, 0);
    if (!hConn) { WinHttpCloseHandle(hSess); return false; }
    HINTERNET hReq = WinHttpOpenRequest(hConn, L"GET", wsPathW.c_str(), NULL, NULL, NULL, 0);
    if (!hReq) { WinHttpCloseHandle(hConn); WinHttpCloseHandle(hSess); return false; }

    WinHttpSetOption(hReq, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0);
    if (!WinHttpSendRequest(hReq, NULL, 0, NULL, 0, 0, 0) ||
        !WinHttpReceiveResponse(hReq, NULL)) {
        Log("[cdp] ws upgrade failed");
        WinHttpCloseHandle(hReq);
        WinHttpCloseHandle(hConn);
        WinHttpCloseHandle(hSess);
        return false;
    }

    HINTERNET hWs = WinHttpWebSocketCompleteUpgrade(hReq, NULL);
    WinHttpCloseHandle(hReq);
    if (!hWs) {
        WinHttpCloseHandle(hConn);
        WinHttpCloseHandle(hSess);
        return false;
    }

    std::string safeUrl;
    for (char c : url) {
        if (c == '"') safeUrl += "\\\"";
        else if (c == '\\') safeUrl += "\\\\";
        else safeUrl += c;
    }
    std::string msg = "{\"id\":1,\"method\":\"Page.navigate\",\"params\":{\"url\":\"" + safeUrl + "\"}}";
    DWORD result = WinHttpWebSocketSend(hWs, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,
                                        (PVOID)msg.c_str(), (DWORD)msg.size());
    Log("[cdp] Page.navigate sent, result=" + std::to_string(result));

    // Fire-and-forget: don't wait for the ack. Closing the WS immediately is
    // fine — the navigate command is already processed by Chromium.
    WinHttpWebSocketClose(hWs, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
    WinHttpCloseHandle(hWs);
    WinHttpCloseHandle(hConn);
    WinHttpCloseHandle(hSess);
    return result == ERROR_SUCCESS;
}

struct CdpReply {
    bool ok = false;
    std::string json;
};

static CdpReply CallCDP(const std::string& method, const std::string& params = "{}",
                        bool waitForReply = true, int timeoutMs = 10000) {
    CdpReply reply;
    std::string json = CdpGetJson(timeoutMs);
    if (json.empty()) { Log("[cdp] /json timeout for " + method); return reply; }
    std::string wsUrlFull = FindPageTarget(json);
    auto pathPos = wsUrlFull.find("/devtools");
    if (pathPos == std::string::npos) { Log("[cdp] no page target for " + method); return reply; }
    std::string wsPath = wsUrlFull.substr(pathPos);
    std::wstring wsPathW(wsPath.begin(), wsPath.end());

    HINTERNET hSess = WinHttpOpen(L"wp", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    if (!hSess) return reply;
    WinHttpSetTimeouts(hSess, timeoutMs, timeoutMs, timeoutMs, timeoutMs);
    HINTERNET hConn = WinHttpConnect(hSess, L"localhost", CDP_PORT, 0);
    HINTERNET hReq = hConn
        ? WinHttpOpenRequest(hConn, L"GET", wsPathW.c_str(), NULL, NULL, NULL, 0) : NULL;
    HINTERNET hWs = NULL;
    if (hReq) {
        WinHttpSetOption(hReq, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, NULL, 0);
        if (WinHttpSendRequest(hReq, NULL, 0, NULL, 0, 0, 0)
            && WinHttpReceiveResponse(hReq, NULL))
            hWs = WinHttpWebSocketCompleteUpgrade(hReq, NULL);
        WinHttpCloseHandle(hReq);
    }
    if (!hWs) {
        if (hConn) WinHttpCloseHandle(hConn);
        WinHttpCloseHandle(hSess);
        Log("[cdp] websocket upgrade failed for " + method);
        return reply;
    }

    const std::string message = "{\"id\":1,\"method\":\"" + JsonEscape(method)
        + "\",\"params\":" + params + "}";
    DWORD sendResult = WinHttpWebSocketSend(hWs, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,
                                             (PVOID)message.data(), (DWORD)message.size());
    if (sendResult == ERROR_SUCCESS && waitForReply) {
        std::vector<char> buffer(32768);
        while (reply.json.size() < 2 * 1024 * 1024) {
            DWORD bytes = 0;
            WINHTTP_WEB_SOCKET_BUFFER_TYPE type = WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE;
            DWORD receiveResult = WinHttpWebSocketReceive(
                hWs, buffer.data(), (DWORD)buffer.size(), &bytes, &type);
            if (receiveResult != ERROR_SUCCESS) break;
            reply.json.append(buffer.data(), bytes);
            if (type == WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE) break;
            if (type == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) break;
        }
    }
    reply.ok = sendResult == ERROR_SUCCESS
        && (!waitForReply || (!reply.json.empty()
            && reply.json.find("\"error\"") == std::string::npos));
    Log("[cdp] " + method + " ok=" + std::to_string(reply.ok)
        + " bytes=" + std::to_string(reply.json.size()));
    WinHttpWebSocketClose(hWs, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, NULL, 0);
    WinHttpCloseHandle(hWs);
    if (hConn) WinHttpCloseHandle(hConn);
    WinHttpCloseHandle(hSess);
    return reply;
}

static std::vector<long long> HistoryEntryIds(const std::string& json) {
    std::vector<long long> ids;
    size_t entries = json.find("\"entries\"");
    size_t begin = entries == std::string::npos ? std::string::npos : json.find('[', entries);
    size_t end = begin == std::string::npos ? std::string::npos : json.find(']', begin);
    if (begin == std::string::npos || end == std::string::npos) return ids;
    size_t pos = begin;
    while ((pos = json.find('{', pos)) != std::string::npos && pos < end) {
        size_t close = json.find('}', pos);
        if (close == std::string::npos || close > end) break;
        long long id = jnum(json.substr(pos, close - pos + 1), "id");
        if (id > 0) ids.push_back(id);
        pos = close + 1;
    }
    return ids;
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
static HANDLE              g_braveJob = NULL;
// g_brave forward-declared above (used by ShellWndProc)
static HWND                g_parent = NULL;
static HWND                g_shell  = NULL;   // shell window we create
static int                 g_x = 0, g_y = 0, g_w = 900, g_h = 800;
static int                 g_shellX = 0, g_shellY = 0;
static std::wstring        g_bravePath;
static bool                g_launched = false;
static std::atomic<bool>    g_exitRequested{false};

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
    if (g_braveJob) {
        // The dedicated browser and every child renderer are assigned to this
        // kill-on-close job. Terminating the job is bounded and avoids a slow
        // recursive process snapshot on the Win32 shell thread.
        TerminateJobObject(g_braveJob, 0);
        CloseHandle(g_braveJob);
        g_braveJob = NULL;
    } else if (g_pi.hProcess
               && WaitForSingleObject(g_pi.hProcess, 0) == WAIT_TIMEOUT) {
        TerminateProcess(g_pi.hProcess, 0);
    }
    if (g_pi.hProcess) {
        CloseHandle(g_pi.hProcess);
        CloseHandle(g_pi.hThread);
        g_pi = {};
    }
}

static bool LaunchBrave(const std::string& url, const std::vector<HWND>& snapBefore) {
    if (g_bravePath.empty()) { Log("[brave] exe not found"); return false; }
    std::wstring wurl(url.begin(), url.end());
    std::wstring port = std::to_wstring(CDP_PORT);

    wchar_t localAppData[MAX_PATH] = {};
    if (FAILED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        Log("[brave] LOCALAPPDATA unavailable");
        return false;
    }
    std::wstring profile = std::wstring(localAppData) + L"\\WidgetPanel\\BraveIsland";
    int createResult = SHCreateDirectoryExW(NULL, profile.c_str(), NULL);
    if (createResult != ERROR_SUCCESS && createResult != ERROR_FILE_EXISTS
        && createResult != ERROR_ALREADY_EXISTS) {
        Log("[brave] could not create island profile: " + std::to_string(createResult));
        return false;
    }

    // A dedicated persistent profile prevents Chromium single-instance
    // delegation into the user's normal browser, which would drop the CDP
    // flags and could reparent an unrelated personal window. Island sessions
    // and cookies still persist in this profile across panel launches.
    std::wstring args = L"\"" + g_bravePath + L"\""
        L" --app=" + wurl +
        L" --user-data-dir=\"" + profile + L"\""
        L" --no-first-run"
        L" --no-default-browser-check"
        L" --force-dark-mode"
        L" --enable-features=WebContentsForceDark"
        // Recent Chromium versions silently disable CDP without an explicit
        // origin allowlist; --remote-allow-origins=* permits the localhost
        // WebSocket upgrade we need for Page.navigate.
        L" --remote-allow-origins=*"
        L" --remote-debugging-port=" + port;
    Log("[brave] args=" + std::string(args.begin(), args.end()));

    STARTUPINFOW si{ sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_SHOWNOACTIVATE;
    if (!CreateProcessW(NULL, args.data(), NULL, NULL, FALSE,
                        CREATE_NO_WINDOW, NULL, NULL, &si, &g_pi)) {
        Log("[brave] CreateProcess failed: " + std::to_string(GetLastError()));
        return false;
    }
    Log("[brave] launched PID=" + std::to_string(g_pi.dwProcessId));
    g_braveJob = CreateJobObjectW(NULL, NULL);
    if (g_braveJob) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(g_braveJob, JobObjectExtendedLimitInformation,
                                &limits, sizeof(limits));
        if (!AssignProcessToJobObject(g_braveJob, g_pi.hProcess))
            Log("[brave] AssignProcessToJobObject failed: " + std::to_string(GetLastError()));
    }
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
static std::atomic<unsigned long long> g_cdpGeneration{1};
static thread_local unsigned long long g_activeCdpGeneration = 0;
static void Send(const std::string& json) {
    if (g_activeCdpGeneration != 0
        && g_activeCdpGeneration != g_cdpGeneration.load())
        return;
    std::lock_guard<std::mutex> lk(g_sockMtx);
    if (g_sock == INVALID_SOCKET) return;
    std::string line = json + "\n";
    send(g_sock, line.c_str(), (int)line.size(), 0);
}

struct CdpTask {
    std::string line;
    std::string type;
    unsigned long long generation = 0;
};

static std::mutex g_cdpQueueMtx;
static std::condition_variable g_cdpQueueCv;
static std::deque<CdpTask> g_cdpQueue;

static void HandleMessage(const std::string& line, bool fromCdpWorker = false);

static void InvalidateCdpTasks() {
    g_cdpGeneration.fetch_add(1);
    std::lock_guard<std::mutex> lock(g_cdpQueueMtx);
    g_cdpQueue.clear();
}

static void QueueCdpTask(const std::string& line, const std::string& type) {
    const auto generation = g_cdpGeneration.load();
    {
        std::lock_guard<std::mutex> lock(g_cdpQueueMtx);
        if (type == "state") {
            for (const auto& pending : g_cdpQueue) {
                if (pending.generation == generation && pending.type == "state")
                    return;
            }
        }
        g_cdpQueue.push_back({line, type, generation});
    }
    g_cdpQueueCv.notify_one();
}

static void CdpWorkerLoop() {
    while (true) {
        CdpTask task;
        {
            std::unique_lock<std::mutex> lock(g_cdpQueueMtx);
            g_cdpQueueCv.wait(lock, [] { return !g_cdpQueue.empty(); });
            task = std::move(g_cdpQueue.front());
            g_cdpQueue.pop_front();
        }
        if (task.generation != g_cdpGeneration.load())
            continue;
        g_activeCdpGeneration = task.generation;
        HandleMessage(task.line, true);
        g_activeCdpGeneration = 0;
    }
}

static bool IsCdpTask(const std::string& type) {
    return type == "navigate" || type == "reload" || type == "back"
        || type == "forward" || type == "eval" || type == "state"
        || type == "cookies";
}

static void HandleMessage(const std::string& line, bool fromCdpWorker) {
    std::string type = jstr(line, "type");

    if (!fromCdpWorker && IsCdpTask(type)
        && !(type == "navigate" && !g_launched)) {
        QueueCdpTask(line, type);
        return;
    }
    Log("[msg] " + line);

    if (type == "open") {
        InvalidateCdpTasks();
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
        if (!fromCdpWorker && !g_launched) {
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
    else if (type == "reload") {
        CdpReply reply = CallCDP("Page.reload", "{\"ignoreCache\":false}", false);
        if (reply.ok) Send("{\"type\":\"ready\"}");
        else Send("{\"type\":\"error\",\"msg\":\"cdp reload failed\"}");
    }
    else if (type == "back" || type == "forward") {
        CdpReply history = CallCDP("Page.getNavigationHistory");
        std::vector<long long> ids = HistoryEntryIds(history.json);
        long long current = jnum(history.json, "currentIndex");
        long long target = type == "back" ? current - 1 : current + 1;
        if (history.ok && target >= 0 && target < (long long)ids.size()) {
            CdpReply nav = CallCDP("Page.navigateToHistoryEntry",
                "{\"entryId\":" + std::to_string(ids[(size_t)target]) + "}", false);
            if (nav.ok) Send("{\"type\":\"ready\"}");
            else Send("{\"type\":\"error\",\"msg\":\"history navigation failed\"}");
        } else {
            Send("{\"type\":\"ready\"}");
        }
    }
    else if (type == "eval") {
        std::string id = jstr(line, "id");
        std::string script = jstr(line, "script");
        CdpReply reply = CallCDP("Runtime.evaluate",
            "{\"expression\":\"" + JsonEscape(script)
                + "\",\"awaitPromise\":true,\"returnByValue\":true,\"userGesture\":true}");
        if (!reply.ok || reply.json.find("\"exceptionDetails\"") != std::string::npos) {
            Send("{\"type\":\"eval\",\"id\":\"" + JsonEscape(id)
                + "\",\"ok\":false,\"error\":\"island script failed\"}");
        } else {
            Send("{\"type\":\"eval\",\"id\":\"" + JsonEscape(id)
                + "\",\"ok\":true,\"payload\":" + reply.json + "}");
        }
    }
    else if (type == "state") {
        const std::string expression =
            "JSON.stringify({url:location.href,title:document.title,readyState:document.readyState})";
        CdpReply page = CallCDP("Runtime.evaluate",
            "{\"expression\":\"" + JsonEscape(expression)
                + "\",\"returnByValue\":true}", true, 2500);
        CdpReply history;
        if (page.ok)
            history = CallCDP("Page.getNavigationHistory", "{}", true, 1500);
        std::string value = jstr(page.json, "value");
        std::string url = jstr(value, "url");
        std::string title = jstr(value, "title");
        std::string readyState = jstr(value, "readyState");
        long long current = jnum(history.json, "currentIndex");
        std::vector<long long> ids = HistoryEntryIds(history.json);
        bool canBack = history.ok && current > 0;
        bool canForward = history.ok && current + 1 < (long long)ids.size();
        std::string payload = "{\"available\":" + std::string(page.ok ? "true" : "false")
            + ",\"url\":\"" + JsonEscape(url) + "\",\"title\":\"" + JsonEscape(title)
            + "\",\"readyState\":\"" + JsonEscape(readyState)
            + "\",\"canGoBack\":" + (canBack ? "true" : "false")
            + ",\"canGoForward\":" + (canForward ? "true" : "false") + "}";
        Send("{\"type\":\"state\",\"payload\":" + payload + "}");
    }
    else if (type == "cookies") {
        CdpReply reply = CallCDP("Network.getAllCookies", "{}", true, 15000);
        if (reply.ok) Send("{\"type\":\"cookies\",\"payload\":" + reply.json + "}");
        else Send("{\"type\":\"error\",\"msg\":\"cookie capture failed\"}");
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
        InvalidateCdpTasks();
        // Hide the shell first for instant visual feedback. KillBrave's
        // process-tree cleanup (renderers, GPU, etc.) can take a moment
        // and would otherwise delay the apparent panel dismissal.
        if (g_shell && IsWindow(g_shell)) ShowWindow(g_shell, SW_HIDE);
        KillBrave();
        DestroyShell();
    }
    else if (type == "quit") {
        InvalidateCdpTasks();
        if (g_shell && IsWindow(g_shell)) ShowWindow(g_shell, SW_HIDE);
        KillBrave();
        DestroyShell();
        g_exitRequested = true;
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
        InvalidateCdpTasks();
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
    while (!g_exitRequested.load()) {
        SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(PORT);
        inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
        if (connect(s, (sockaddr*)&addr, sizeof(addr)) != 0) {
            closesocket(s);
            // Pump messages while waiting to reconnect so the shell stays responsive
            for (int i = 0; i < 50 && !g_exitRequested.load(); i++) {
                PumpPending();
                Sleep(20);
            }
            continue;
        }
        { std::lock_guard<std::mutex> lk(g_sockMtx); g_sock = s; }
        Log("[tcp] connected");
        Send("{\"type\":\"ready\"}");
        std::string buf;
        char tmp[4096];
        while (!g_exitRequested.load()) {
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
        InvalidateCdpTasks();
        closesocket(s);
        if (g_exitRequested.load())
            return;
        Log("[tcp] disconnected — reconnecting");
        for (int i = 0; i < 50 && !g_exitRequested.load(); i++) {
            PumpPending();
            Sleep(20);
        }
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
    std::thread(CdpWorkerLoop).detach();

    // Main thread owns the shell window and pumps its messages via PumpPending()
    // interleaved with the IO loop — no separate pump thread needed.
    ConnectLoop();
    WSACleanup();
    return 0;
}
