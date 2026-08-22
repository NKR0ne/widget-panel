#pragma once

#include <QImage>
#include <QObject>
#include <QTimer>

class QCamera;
class QMediaCaptureSession;
class QVideoSink;

namespace qtpanel {

// Throttled webcam frame source for presence detection. Hot-plug aware: while
// no camera is present it is a dormant no-op; QMediaDevices::videoInputsChanged
// re-attaches when one appears.
class WebcamCapture : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool available READ available NOTIFY availableChanged)
    Q_PROPERTY(bool active READ active NOTIFY activeChanged)

public:
    explicit WebcamCapture(QObject* parent = nullptr);
    ~WebcamCapture() override;

    bool available() const;
    bool active() const { return m_camera != nullptr; }

    void setEnabled(bool enabled); // desired state; actual follows availability
    // Most recent frame (null until one arrives).
    QImage lastFrame() const { return m_lastFrame; }

signals:
    void availableChanged();
    void activeChanged();
    void frameReady(const QImage& frame); // throttled, >= 500 ms apart

private:
    void applyState();

    QCamera* m_camera = nullptr;
    QMediaCaptureSession* m_session = nullptr;
    QVideoSink* m_sink = nullptr;
    QImage m_lastFrame;
    qint64 m_lastEmitMs = 0;
    bool m_enabled = false;
};

} // namespace qtpanel
