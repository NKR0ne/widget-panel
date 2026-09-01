#include "SpeechService.h"

#include <QDebug>
#include <QElapsedTimer>
#include <QTimer>

#include <windows.h>
#include <sapi.h>

#include <algorithm>
// Deliberately NOT sphelper.h: its helpers pull in ATL (atlbase.h), which the
// VS Build Tools install does not ship. The two helpers used here are short.

namespace qtpanel {

namespace {

// SAPI reports a voice's language as a hex LCID attribute: 40c = fr-FR,
// c0c = fr-CA. Matching either keeps alerts in the panel's language.
bool isFrenchVoice(ISpObjectToken* token)
{
    if (!token)
        return false;
    ISpDataKey* attributes = nullptr;
    if (FAILED(token->OpenKey(L"Attributes", &attributes)) || !attributes)
        return false;
    LPWSTR language = nullptr;
    const bool ok = SUCCEEDED(attributes->GetStringValue(L"Language", &language)) && language;
    bool french = false;
    if (ok) {
        const QString value = QString::fromWCharArray(language).toLower();
        french = value.contains(QLatin1String("40c")) || value.contains(QLatin1String("c0c"));
        CoTaskMemFree(language);
    }
    attributes->Release();
    return french;
}

// A voice token's default string value is its human description.
QString tokenDescription(ISpObjectToken* token)
{
    LPWSTR description = nullptr;
    if (!token || FAILED(token->GetStringValue(nullptr, &description)) || !description)
        return {};
    const QString name = QString::fromWCharArray(description);
    CoTaskMemFree(description);
    return name;
}

// sphelper's SpEnumTokens, without ATL: open a voices category and enumerate.
IEnumSpObjectTokens* enumerateVoices(LPCWSTR categoryId)
{
    ISpObjectTokenCategory* category = nullptr;
    if (FAILED(CoCreateInstance(CLSID_SpObjectTokenCategory, nullptr, CLSCTX_ALL,
                                IID_ISpObjectTokenCategory,
                                reinterpret_cast<void**>(&category)))
        || !category) {
        return nullptr;
    }
    IEnumSpObjectTokens* tokens = nullptr;
    if (SUCCEEDED(category->SetId(categoryId, FALSE)))
        category->EnumTokens(nullptr, nullptr, &tokens);
    category->Release();
    return tokens;
}

// Modern Windows installs its good voices under Speech_OneCore, which the
// classic SPCAT_VOICES category does NOT enumerate — on this machine the only
// classic voice is US English while three French-Canadian ones sit here. SAPI
// can drive them; they simply have to be looked for.
const wchar_t kOneCoreVoices[] =
    L"HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices";

} // namespace

struct SpeechService::Private {
    ISpVoice* voice = nullptr;
    QTimer* completionTimer = nullptr;
    QElapsedTimer startedAt;
    bool comInitialized = false;
    bool pending = false;
    bool observedSpeaking = false;
    qint64 maximumDurationMs = 120000;
    USHORT originalVolume = 100;
    QString voiceName;
};

SpeechService::SpeechService(QObject* parent)
    : QObject(parent)
    , d(std::make_unique<Private>())
{
    const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    // RPC_E_CHANGED_MODE means someone already initialized this thread with a
    // different model — that is fine, we just must not uninitialize it later.
    d->comInitialized = SUCCEEDED(init);

    HRESULT hr = CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_ALL,
                                  IID_ISpVoice, reinterpret_cast<void**>(&d->voice));
    if (FAILED(hr) || !d->voice) {
        qWarning() << "[speech] SAPI unavailable" << Qt::hex << hr;
        d->voice = nullptr;
        return;
    }

    // Prefer a French voice. OneCore first: that is where the modern (and on
    // this machine, the only French) voices live.
    for (LPCWSTR category : {kOneCoreVoices, SPCAT_VOICES}) {
        if (!d->voiceName.isEmpty())
            break;
        IEnumSpObjectTokens* tokens = enumerateVoices(category);
        if (!tokens)
            continue;
        ISpObjectToken* token = nullptr;
        while (tokens->Next(1, &token, nullptr) == S_OK && token) {
            if (isFrenchVoice(token) && SUCCEEDED(d->voice->SetVoice(token))) {
                d->voiceName = tokenDescription(token);
                token->Release();
                break;
            }
            token->Release();
            token = nullptr;
        }
        tokens->Release();
    }
    if (d->voiceName.isEmpty()) {
        ISpObjectToken* current = nullptr;
        if (SUCCEEDED(d->voice->GetVoice(&current)) && current) {
            d->voiceName = tokenDescription(current);
            current->Release();
        }
    }

    d->completionTimer = new QTimer(this);
    d->completionTimer->setInterval(50);
    connect(d->completionTimer, &QTimer::timeout, this, [this] {
        if (!d->voice || !d->pending)
            return;
        SPVOICESTATUS status{};
        const qint64 elapsed = d->startedAt.elapsed();
        const HRESULT statusResult = d->voice->GetStatus(&status, nullptr);
        if (FAILED(statusResult) && elapsed < d->maximumDurationMs)
            return;
        const bool isSpeaking = SUCCEEDED(statusResult)
            && status.dwRunningState == SPRS_IS_SPEAKING;
        d->observedSpeaking = d->observedSpeaking || isSpeaking;
        if (elapsed < d->maximumDurationMs
            && (isSpeaking || (!d->observedSpeaking && elapsed < 1500))) {
            return;
        }

        d->completionTimer->stop();
        d->pending = false;
        d->voice->SetVolume(d->originalVolume);
        emit speakingChanged();
        emit finished();
    });
    qInfo() << "[speech] SAPI ready, voice:" << d->voiceName;
}

SpeechService::~SpeechService()
{
    if (d->voice) {
        d->voice->Release();
        d->voice = nullptr;
    }
    if (d->comInitialized)
        CoUninitialize();
}

bool SpeechService::available() const
{
    return d->voice != nullptr;
}

bool SpeechService::speaking() const
{
    return d->pending;
}

QString SpeechService::voiceName() const
{
    return d->voiceName;
}

void SpeechService::say(const QString& text)
{
    sayAtVolume(text, 100);
}

bool SpeechService::sayAtVolume(const QString& text, int volumePercent)
{
    const QString clean = text.trimmed();
    if (!d->voice || clean.isEmpty())
        return false;
    if (d->pending)
        stop();

    d->voice->GetVolume(&d->originalVolume);
    d->voice->SetVolume(static_cast<USHORT>(std::clamp(volumePercent, 0, 100)));
    // Async so the GUI thread never waits on speech, purge so a new alert
    // replaces one still being read out.
    const HRESULT hr = d->voice->Speak(reinterpret_cast<LPCWSTR>(clean.utf16()),
                                       SPF_ASYNC | SPF_PURGEBEFORESPEAK, nullptr);
    if (FAILED(hr)) {
        d->voice->SetVolume(d->originalVolume);
        qWarning() << "[speech] speak failed" << Qt::hex << hr;
        return false;
    }
    d->pending = true;
    d->observedSpeaking = false;
    d->maximumDurationMs = std::clamp<qint64>(clean.size() * 120LL, 5000, 120000);
    d->startedAt.restart();
    d->completionTimer->start();
    emit speakingChanged();
    return true;
}

void SpeechService::stop()
{
    if (!d->voice)
        return;
    d->voice->Speak(nullptr, SPF_PURGEBEFORESPEAK, nullptr);
    if (!d->pending)
        return;
    d->completionTimer->stop();
    d->pending = false;
    d->voice->SetVolume(d->originalVolume);
    emit speakingChanged();
    emit finished();
}

} // namespace qtpanel
