#include "SoundFx.h"

#include "SettingsStore.h"

#include <QByteArray>
#include <QDir>
#include <QFile>
#include <QSoundEffect>
#include <QStandardPaths>
#include <QUrl>
#include <QtEndian>
#include <QtMath>

namespace qtpanel {

namespace {

// Write a tiny soft "click" as a 16-bit mono PCM WAV (a short sine burst with a
// fast decay envelope). Returns the file path, or empty on failure.
QString writeClickWav()
{
    const int sampleRate = 44100;
    const int ms = 55;
    const int frames = sampleRate * ms / 1000;
    const double freq = 1200.0;

    QByteArray pcm;
    pcm.reserve(frames * 2);
    for (int i = 0; i < frames; ++i) {
        const double t = static_cast<double>(i) / sampleRate;
        const double env = qExp(-t * 60.0);               // fast decay
        const double s = qSin(2.0 * M_PI * freq * t) * env * 0.25;
        const qint16 v = static_cast<qint16>(qBound(-1.0, s, 1.0) * 32767);
        pcm.append(static_cast<char>(v & 0xFF));
        pcm.append(static_cast<char>((v >> 8) & 0xFF));
    }

    const int byteRate = sampleRate * 2;
    const int dataSize = pcm.size();
    QByteArray wav;
    auto u32 = [&wav](quint32 v) { quint32 le = qToLittleEndian(v); wav.append(reinterpret_cast<char*>(&le), 4); };
    auto u16 = [&wav](quint16 v) { quint16 le = qToLittleEndian(v); wav.append(reinterpret_cast<char*>(&le), 2); };
    wav.append("RIFF"); u32(36 + dataSize); wav.append("WAVE");
    wav.append("fmt "); u32(16); u16(1); u16(1); u32(sampleRate); u32(byteRate); u16(2); u16(16);
    wav.append("data"); u32(dataSize); wav.append(pcm);

    const QString path = QStandardPaths::writableLocation(QStandardPaths::TempLocation)
        + QStringLiteral("/qt-panel-click.wav");
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly))
        return {};
    f.write(wav);
    return path;
}

} // namespace

SoundFx::SoundFx(SettingsStore* settings, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
{
    const QString path = writeClickWav();
    if (!path.isEmpty()) {
        m_click = new QSoundEffect(this);
        m_click->setSource(QUrl::fromLocalFile(path));
        m_click->setVolume(0.25);
    }
}

bool SoundFx::enabled() const
{
    return m_settings->get(QStringLiteral("wp-sound-enabled"), false).toBool();
}

void SoundFx::setEnabled(bool on)
{
    if (enabled() == on)
        return;
    m_settings->set(QStringLiteral("wp-sound-enabled"), on);
    emit enabledChanged();
}

void SoundFx::tap()
{
    if (m_click && enabled())
        m_click->play();
}

} // namespace qtpanel
