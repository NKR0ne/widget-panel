#include "WindowsAudioFocus.h"

#include <QDebug>
#include <QVector>

#include <audiopolicy.h>
#include <mmdeviceapi.h>
#include <windows.h>

#include <utility>

namespace qtpanel {

struct WindowsAudioFocus::Private {
    struct Session {
        ISimpleAudioVolume* volume = nullptr;
        BOOL wasMuted = FALSE;
    };

    QVector<Session> sessions;
    bool engaged = false;
    bool comInitialized = false;
};

WindowsAudioFocus::WindowsAudioFocus(QObject* parent)
    : QObject(parent)
    , d(std::make_unique<Private>())
{
}

WindowsAudioFocus::~WindowsAudioFocus()
{
    restore();
}

bool WindowsAudioFocus::active() const
{
    return d->engaged;
}

bool WindowsAudioFocus::engage()
{
    if (d->engaged)
        return true;

    const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    d->comInitialized = SUCCEEDED(init);

    IMMDeviceEnumerator* deviceEnumerator = nullptr;
    IMMDevice* device = nullptr;
    IAudioSessionManager2* sessionManager = nullptr;
    IAudioSessionEnumerator* sessionEnumerator = nullptr;

    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                  __uuidof(IMMDeviceEnumerator),
                                  reinterpret_cast<void**>(&deviceEnumerator));
    if (SUCCEEDED(hr))
        hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device);
    if (SUCCEEDED(hr))
        hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                              reinterpret_cast<void**>(&sessionManager));
    if (SUCCEEDED(hr))
        hr = sessionManager->GetSessionEnumerator(&sessionEnumerator);

    int count = 0;
    if (SUCCEEDED(hr))
        hr = sessionEnumerator->GetCount(&count);

    const DWORD ownPid = GetCurrentProcessId();
    for (int i = 0; SUCCEEDED(hr) && i < count; ++i) {
        IAudioSessionControl* control = nullptr;
        if (FAILED(sessionEnumerator->GetSession(i, &control)) || !control)
            continue;

        AudioSessionState state = AudioSessionStateInactive;
        IAudioSessionControl2* control2 = nullptr;
        DWORD processId = 0;
        const bool activeSession = SUCCEEDED(control->GetState(&state))
            && state == AudioSessionStateActive;
        const bool identified = SUCCEEDED(control->QueryInterface(
            __uuidof(IAudioSessionControl2), reinterpret_cast<void**>(&control2)))
            && control2 && SUCCEEDED(control2->GetProcessId(&processId));

        if (activeSession && identified && processId != ownPid) {
            ISimpleAudioVolume* volume = nullptr;
            BOOL muted = FALSE;
            if (SUCCEEDED(control->QueryInterface(__uuidof(ISimpleAudioVolume),
                                                  reinterpret_cast<void**>(&volume)))
                && volume && SUCCEEDED(volume->GetMute(&muted))
                && SUCCEEDED(volume->SetMute(TRUE, nullptr))) {
                d->sessions.append({volume, muted});
                volume = nullptr;
            }
            if (volume)
                volume->Release();
        }

        if (control2)
            control2->Release();
        control->Release();
    }

    if (sessionEnumerator)
        sessionEnumerator->Release();
    if (sessionManager)
        sessionManager->Release();
    if (device)
        device->Release();
    if (deviceEnumerator)
        deviceEnumerator->Release();

    d->engaged = SUCCEEDED(hr);
    if (!d->engaged) {
        qWarning() << "[audio-focus] unable to enumerate Windows audio sessions"
                   << Qt::hex << hr;
        restore();
        return false;
    }
    qInfo() << "[audio-focus] muted" << d->sessions.size() << "active session(s)";
    return true;
}

void WindowsAudioFocus::restore()
{
    for (const Private::Session& session : std::as_const(d->sessions)) {
        if (session.volume) {
            session.volume->SetMute(session.wasMuted, nullptr);
            session.volume->Release();
        }
    }
    const int restored = d->sessions.size();
    d->sessions.clear();
    d->engaged = false;
    if (d->comInitialized) {
        CoUninitialize();
        d->comInitialized = false;
    }
    if (restored > 0)
        qInfo() << "[audio-focus] restored" << restored << "session(s)";
}

} // namespace qtpanel
