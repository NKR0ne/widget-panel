/*
 * taskbar-btn.exe  —  DLL injector + watchdog
 * Logs to native/bin/injector.log
 */

#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <tlhelp32.h>
#include <cstdio>
#include <cstdarg>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")

static const wchar_t* MUTEX_NAME = L"WPTaskbarBtnMutex";
static wchar_t g_dllPath[MAX_PATH];
static wchar_t g_logPath[MAX_PATH];

static void Log(const char* fmt, ...)
{
    FILE* f = _wfopen(g_logPath, L"a");
    if (!f) return;
    va_list ap; va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

// ── Elevate SeDebugPrivilege ──────────────────────────────────────────────────
static bool EnableDebugPrivilege()
{
    HANDLE tok; TOKEN_PRIVILEGES tp;
    if (!OpenProcessToken(GetCurrentProcess(),
                          TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &tok))
        return false;
    LookupPrivilegeValue(NULL, SE_DEBUG_NAME, &tp.Privileges[0].Luid);
    tp.PrivilegeCount = 1;
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    BOOL ok = AdjustTokenPrivileges(tok, FALSE, &tp, 0, NULL, NULL);
    CloseHandle(tok);
    return ok && GetLastError() != ERROR_NOT_ALL_ASSIGNED;
}

// ── Find explorer.exe PID ─────────────────────────────────────────────────────
static DWORD FindExplorerPid()
{
    DWORD pid  = 0;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W pe{ sizeof(pe) };
    if (Process32FirstW(snap, &pe)) {
        do {
            if (_wcsicmp(pe.szExeFile, L"explorer.exe") == 0) {
                pid = pe.th32ProcessID; break;
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return pid;
}

// ── Check if our DLL is already loaded in a process ──────────────────────────
static bool IsDllLoaded(DWORD pid)
{
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid);
    if (snap == INVALID_HANDLE_VALUE) return false;
    MODULEENTRY32W me{ sizeof(me) };
    bool found = false;
    if (Module32FirstW(snap, &me)) {
        do {
            if (_wcsicmp(me.szModule, L"taskbar-hook.dll") == 0) {
                found = true; break;
            }
        } while (Module32NextW(snap, &me));
    }
    CloseHandle(snap);
    return found;
}

// ── Find Explorer's main thread (the one that owns Shell_TrayWnd) ────────────
static DWORD FindExplorerThreadId()
{
    HWND tray = FindWindowW(L"Shell_TrayWnd", NULL);
    if (!tray) return 0;
    DWORD pid = 0;
    DWORD tid = GetWindowThreadProcessId(tray, &pid);
    return tid;
}

// ── SetWindowsHookEx-based injection (HVCI/Defender-friendly) ────────────────
static HMODULE g_hookDll = NULL;
static HHOOK   g_hook    = NULL;
static DWORD   g_hookedTid = 0;

static bool InstallHook(DWORD tid)
{
    if (!tid) { Log("InstallHook: no thread id"); return false; }
    if (!g_hookDll) {
        g_hookDll = LoadLibraryW(g_dllPath);
        if (!g_hookDll) {
            Log("LoadLibrary failed: %lu", GetLastError());
            return false;
        }
        Log("LoadLibrary OK hmod=%p", (void*)g_hookDll);
    }
    HOOKPROC proc = (HOOKPROC)GetProcAddress(g_hookDll, "WpHookThunk");
    if (!proc) {
        Log("GetProcAddress(WpHookThunk) failed: %lu", GetLastError());
        return false;
    }
    g_hook = SetWindowsHookExW(WH_CALLWNDPROC, proc, g_hookDll, tid);
    if (!g_hook) {
        Log("SetWindowsHookEx failed: %lu", GetLastError());
        return false;
    }
    g_hookedTid = tid;
    Log("SetWindowsHookEx OK hook=%p tid=%lu", (void*)g_hook, tid);
    // Nudge Explorer to dispatch a message so the hook fires and the OS
    // loader pulls our DLL into Explorer's address space immediately.
    HWND tray = FindWindowW(L"Shell_TrayWnd", NULL);
    if (tray) PostMessageW(tray, WM_NULL, 0, 0);
    return true;
}

static void UninstallHook()
{
    if (g_hook) {
        UnhookWindowsHookEx(g_hook);
        g_hook = NULL;
        g_hookedTid = 0;
        Log("UnhookWindowsHookEx done");
    }
}

// ── Entry ─────────────────────────────────────────────────────────────────────
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int)
{
    // Paths next to exe
    GetModuleFileNameW(NULL, g_dllPath, MAX_PATH);
    wcscpy(g_logPath, g_dllPath);
    wchar_t* sl = wcsrchr(g_logPath, L'\\');
    if (sl) wcscpy(sl + 1, L"injector.log");
    sl = wcsrchr(g_dllPath, L'\\');
    if (sl) wcscpy(sl + 1, L"taskbar-hook.dll");

    { FILE* f = _wfopen(g_logPath, L"w"); if (f) fclose(f); }
    Log("=== taskbar-btn injector starting ===");

    // Check DLL exists
    DWORD attr = GetFileAttributesW(g_dllPath);
    if (attr == INVALID_FILE_ATTRIBUTES) {
        Log("ERROR: DLL not found at path");
        MessageBoxW(NULL, L"taskbar-hook.dll not found next to taskbar-btn.exe",
                    L"taskbar-btn", MB_ICONERROR);
        return 1;
    }
    Log("DLL path OK");

    // Single instance
    HANDLE mutex = CreateMutex(NULL, TRUE, MUTEX_NAME);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        Log("Already running"); CloseHandle(mutex); return 0;
    }

    // Try to get SeDebugPrivilege (may fail without elevation — that's OK)
    bool dbg = EnableDebugPrivilege();
    Log("SeDebugPrivilege: %s", dbg ? "granted" : "denied");

    // Wait for taskbar
    while (!FindWindow(L"Shell_TrayWnd", NULL)) Sleep(1000);
    Sleep(1000);  // let Explorer fully initialize

    DWORD lastTid = FindExplorerThreadId();
    Log("Explorer thread id: %lu", lastTid);
    if (lastTid) {
        if (!InstallHook(lastTid)) {
            Log("InstallHook failed — will retry in watchdog");
        }
    }

    // Watchdog — re-install the hook when Explorer's main thread id changes
    // (Explorer restarted) or when our hook was somehow released. Also pumps
    // messages so SetWindowsHookEx callbacks land cleanly.
    for (;;) {
        MSG msg;
        // Drain any messages without blocking, then sleep.
        while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        Sleep(3000);
        DWORD curTid = FindExplorerThreadId();
        if (!curTid) continue;
        if (curTid != lastTid) {
            Log("Explorer thread changed (%lu -> %lu) — re-installing hook", lastTid, curTid);
            UninstallHook();
            // Brief delay so Explorer is fully up before we hook it.
            Sleep(2000);
            if (InstallHook(curTid)) lastTid = curTid;
        } else if (!IsDllLoaded(FindExplorerPid())) {
            // Hook was installed but DLL isn't in Explorer anymore — re-install.
            Log("DLL gone from Explorer — re-installing hook");
            UninstallHook();
            Sleep(500);
            InstallHook(curTid);
        }
    }

    UninstallHook();
    CloseHandle(mutex);
    return 0;
}
