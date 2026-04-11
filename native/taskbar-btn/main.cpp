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

// ── Get remote HMODULE for our DLL ───────────────────────────────────────────
static HMODULE GetRemoteModule(DWORD pid)
{
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid);
    if (snap == INVALID_HANDLE_VALUE) return NULL;
    MODULEENTRY32W me{ sizeof(me) };
    HMODULE hMod = NULL;
    if (Module32FirstW(snap, &me)) {
        do {
            if (_wcsicmp(me.szModule, L"taskbar-hook.dll") == 0) {
                hMod = me.hModule; break;
            }
        } while (Module32NextW(snap, &me));
    }
    CloseHandle(snap);
    return hMod;
}

// ── Inject DLL ────────────────────────────────────────────────────────────────
static bool InjectDll(DWORD pid)
{
    if (IsDllLoaded(pid)) {
        Log("DLL already loaded in PID %lu", pid);
        return true;
    }

    Log("Opening PID %lu ...", pid);
    HANDLE hProc = OpenProcess(
        PROCESS_CREATE_THREAD | PROCESS_VM_OPERATION |
        PROCESS_VM_WRITE     | PROCESS_VM_READ,
        FALSE, pid);
    if (!hProc) {
        Log("OpenProcess failed: %lu", GetLastError());
        return false;
    }
    Log("OpenProcess OK");

    size_t bytes = (wcslen(g_dllPath) + 1) * sizeof(wchar_t);
    LPVOID pMem  = VirtualAllocEx(hProc, NULL, bytes,
                                  MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!pMem) {
        Log("VirtualAllocEx failed: %lu", GetLastError());
        CloseHandle(hProc); return false;
    }

    if (!WriteProcessMemory(hProc, pMem, g_dllPath, bytes, NULL)) {
        Log("WriteProcessMemory failed: %lu", GetLastError());
        VirtualFreeEx(hProc, pMem, 0, MEM_RELEASE);
        CloseHandle(hProc); return false;
    }
    Log("Wrote DLL path to remote memory");

    HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
    FARPROC llW = GetProcAddress(k32, "LoadLibraryW");
    Log("LoadLibraryW addr: %p", (void*)llW);

    HANDLE hThrd = CreateRemoteThread(hProc, NULL, 0,
                       (LPTHREAD_START_ROUTINE)llW, pMem, 0, NULL);
    if (!hThrd) {
        Log("CreateRemoteThread failed: %lu", GetLastError());
        VirtualFreeEx(hProc, pMem, 0, MEM_RELEASE);
        CloseHandle(hProc); return false;
    }

    WaitForSingleObject(hThrd, 15000);
    DWORD code = 0;
    GetExitCodeThread(hThrd, &code);
    Log("Remote thread exit code (HMODULE): 0x%lx", code);
    CloseHandle(hThrd);
    VirtualFreeEx(hProc, pMem, 0, MEM_RELEASE);
    CloseHandle(hProc);

    if (code == 0) {
        Log("LoadLibraryW returned NULL — DLL load failed inside Explorer");
        return false;
    }

    Log("Injection succeeded");
    return true;
}

// ── Eject DLL ─────────────────────────────────────────────────────────────────
static void EjectDll(DWORD pid)
{
    HMODULE remMod = GetRemoteModule(pid);
    if (!remMod) return;
    HANDLE hProc = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_VM_OPERATION,
                               FALSE, pid);
    if (!hProc) return;
    FARPROC flW = GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "FreeLibrary");
    HANDLE h = CreateRemoteThread(hProc, NULL, 0,
                   (LPTHREAD_START_ROUTINE)flW,
                   (LPVOID)(uintptr_t)remMod, 0, NULL);
    if (h) { WaitForSingleObject(h, 5000); CloseHandle(h); }
    CloseHandle(hProc);
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

    DWORD lastPid = FindExplorerPid();
    Log("Explorer PID: %lu", lastPid);

    if (lastPid) {
        // Always eject stale copy first so the fresh build is guaranteed to load
        Log("Ejecting any stale DLL ...");
        EjectDll(lastPid);
        Sleep(1000);
        if (!InjectDll(lastPid)) {
            Log("Injection failed — will retry in watchdog");
        }
    }

    // Watchdog
    for (;;) {
        Sleep(3000);
        DWORD curPid = FindExplorerPid();
        if (curPid && curPid != lastPid) {
            Log("Explorer restarted (new PID %lu) — re-injecting", curPid);
            Sleep(4000);
            EjectDll(curPid);
            Sleep(500);
            InjectDll(curPid);
            lastPid = curPid;
        } else if (curPid && !IsDllLoaded(curPid)) {
            Log("DLL disappeared from PID %lu — re-injecting", curPid);
            InjectDll(curPid);
        }
    }

    EjectDll(lastPid);
    CloseHandle(mutex);
    return 0;
}
