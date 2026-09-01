#pragma once

#include <QObject>

#include <memory>

namespace qtpanel {

// Temporarily mutes active Windows audio sessions outside this process and
// restores each session's original mute state when the alert completes.
class WindowsAudioFocus final : public QObject {
    Q_OBJECT

public:
    explicit WindowsAudioFocus(QObject* parent = nullptr);
    ~WindowsAudioFocus() override;

    bool engage();
    void restore();
    bool active() const;

private:
    struct Private;
    std::unique_ptr<Private> d;
};

} // namespace qtpanel
