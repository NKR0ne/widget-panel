#pragma once

#include <QObject>
#include <QString>

#include <memory>

namespace qtpanel {

// Offline speech via the Windows speech API (SAPI). This is the voice that
// must work when nothing else does: no API key, no network, no cost — so a
// perimeter alert is still spoken when the cloud TTS is unconfigured or the
// link is down. Prefers an installed French voice.
class SpeechService : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool available READ available CONSTANT)

public:
    explicit SpeechService(QObject* parent = nullptr);
    ~SpeechService() override;

    bool available() const;
    bool speaking() const;
    QString voiceName() const;

    // Speaks asynchronously, replacing anything currently being said.
    Q_INVOKABLE void say(const QString& text);
    bool sayAtVolume(const QString& text, int volumePercent);
    Q_INVOKABLE void stop();

signals:
    void speakingChanged();
    void finished();

private:
    struct Private;
    std::unique_ptr<Private> d;
};

} // namespace qtpanel
