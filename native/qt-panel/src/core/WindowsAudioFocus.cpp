#include "WindowsAudioFocus.h"

#include <QDebug>
#include <QVector>

#include <audiopolicy.h>
#include <endpointvolume.h>
#include <mmdeviceapi.h>
#include <windows.h>

#include <utility>

namespace qtpanel {

namespace {

constexpr float kAlertMasterVolume = 0.5f;

}

struct WindowsAudioFocus::Private {
    struct Session {
        ISimpleAudioVolume* volume = nullptr;
        BOOL wasMuted = FALSE;
    };

    QVector<Session> sessions;
    IAudioEndpointVolume* endpointVolume = nullptr;
    float originalMasterVolume = 1.0f;
    BOOL originalEndpointMuted = FALSE;
    bool endpointStateCaptured = false;
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
    if (SUCCEEDED(hr)) {
        constexpr ERole roles[] = {eMultimedia, eConsole, eCommunications};
        for (ERole role : roles) {
            hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, role, &device);
            if (SUCCEEDED(hr) && device) {
                if (role != eMultimedia)
                    qWarning() << "[audio-focus] multimedia endpoint unavailable; using role"
                               << int(role);
                break;
            }
        }
    }

    if (SUCCEEDED(hr) && device) {
        const HRESULT endpointHr = device->Activate(
            __uuidof(IAudioEndpointVolume), CLSCTX_ALL, nullptr,
            reinterpret_cast<void**>(&d->endpointVolume));
        if (SUCCEEDED(endpointHr) && d->endpointVolume
            && SUCCEEDED(d->endpointVolume->GetMasterVolumeLevelScalar(
                &d->originalMasterVolume))
            && SUCCEEDED(d->endpointVolume->GetMute(&d->originalEndpointMuted))) {
            d->endpointStateCaptured = true;
            const HRESULT unmuteHr = d->endpointVolume->SetMute(FALSE, nullptr);
            const HRESULT volumeHr = d->endpointVolume->SetMasterVolumeLevelScalar(
                kAlertMasterVolume, nullptr);
            if (SUCCEEDED(unmuteHr) && SUCCEEDED(volumeHr)) {
                qInfo() << "[audio-focus] master volume"
                        << qRound(d->originalMasterVolume * 100.0f) << "-> 50";
            } else {
                qWarning() << "[audio-focus] unable to apply alert master volume"
                           << Qt::hex << unmuteHr << volumeHr;
            }
        } else {
            qWarning() << "[audio-focus] unable to control master volume"
                       << Qt::hex << endpointHr;
            if (d->endpointVolume) {
                d->endpointVolume->Release();
                d->endpointVolume = nullptr;
            }
        }
    }

    HRESULT sessionHr = hr;
    if (SUCCEEDED(sessionHr))
        sessionHr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                                     reinterpret_cast<void**>(&sessionManager));
    if (SUCCEEDED(sessionHr))
        sessionHr = sessionManager->GetSessionEnumerator(&sessionEnumerator);

    int count = 0;
    if (SUCCEEDED(sessionHr))
        sessionHr = sessionEnumerator->GetCount(&count);

    const DWORD ownPid = GetCurrentProcessId();
    for (int i = 0; SUCCEEDED(sessionHr) && i < count; ++i) {
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

    d->engaged = d->endpointStateCaptured || SUCCEEDED(sessionHr);
    if (!d->engaged) {
        qWarning() << "[audio-focus] unable to enumerate Windows audio sessions"
                   << Qt::hex << sessionHr;
        restore();
        return false;
    }
    qInfo() << "[audio-focus] muted" << d->sessions.size() << "active session(s)";
    return true;
}

void WindowsAudioFocus::restore()
{
    if (d->endpointVolume) {
        if (d->endpointStateCaptured) {
            d->endpointVolume->SetMasterVolumeLevelScalar(d->originalMasterVolume, nullptr);
            d->endpointVolume->SetMute(d->originalEndpointMuted, nullptr);
            qInfo() << "[audio-focus] restored master volume to"
                    << qRound(d->originalMasterVolume * 100.0f);
        }
        d->endpointVolume->Release();
        d->endpointVolume = nullptr;
    }
    d->endpointStateCaptured = false;

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
