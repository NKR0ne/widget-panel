#pragma once

#include <QObject>
#include <QString>

class QSoundEffect;

namespace qtpanel {

class SettingsStore;

// Subtle UI feedback sounds (port intent of sound.service.js). A soft click is
// synthesized to a temp WAV at startup so no audio asset ships. Off by default
// (wp-sound-enabled).
class SoundFx : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool enabled READ enabled WRITE setEnabled NOTIFY enabledChanged)

public:
    explicit SoundFx(SettingsStore* settings, QObject* parent = nullptr);

    bool enabled() const;
    void setEnabled(bool on);

    Q_INVOKABLE void tap();

signals:
    void enabledChanged();

private:
    SettingsStore* m_settings = nullptr;
    QSoundEffect* m_click = nullptr;
};

} // namespace qtpanel
