#include "WebcamCapture.h"

#include <QCamera>
#include <QDateTime>
#include <QDebug>
#include <QMediaCaptureSession>
#include <QMediaDevices>
#include <QVideoFrame>
#include <QVideoSink>

namespace qtpanel {

namespace {
constexpr qint64 kFrameIntervalMs = 500;
} // namespace

WebcamCapture::WebcamCapture(QObject* parent)
    : QObject(parent)
{
    auto* mediaDevices = new QMediaDevices(this);
    connect(mediaDevices, &QMediaDevices::videoInputsChanged, this, [this] {
        qInfo() << "[starvis.sentry] video inputs changed, available ="
                << !QMediaDevices::defaultVideoInput().isNull();
        emit availableChanged();
        applyState();
    });
}

WebcamCapture::~WebcamCapture() = default;

bool WebcamCapture::available() const
{
    return !QMediaDevices::defaultVideoInput().isNull();
}

void WebcamCapture::setEnabled(bool enabled)
{
    if (m_enabled == enabled)
        return;
    m_enabled = enabled;
    applyState();
}

void WebcamCapture::applyState()
{
    const bool shouldRun = m_enabled && available();
    if (shouldRun == (m_camera != nullptr))
        return;

    if (!shouldRun) {
        qInfo() << "[starvis.sentry] webcam capture stopped";
        if (m_camera)
            m_camera->stop();
        delete m_session;  m_session = nullptr;
        delete m_camera;   m_camera = nullptr;
        delete m_sink;     m_sink = nullptr;
        emit activeChanged();
        return;
    }

    m_camera = new QCamera(QMediaDevices::defaultVideoInput(), this);
    m_session = new QMediaCaptureSession(this);
    m_sink = new QVideoSink(this);
    m_session->setCamera(m_camera);
    m_session->setVideoSink(m_sink);
    connect(m_sink, &QVideoSink::videoFrameChanged, this, [this](const QVideoFrame& frame) {
        const qint64 now = QDateTime::currentMSecsSinceEpoch();
        if (now - m_lastEmitMs < kFrameIntervalMs || !frame.isValid())
            return;
        m_lastEmitMs = now;
        const QImage image = frame.toImage();
        if (image.isNull())
            return;
        m_lastFrame = image;
        emit frameReady(image);
    });
    connect(m_camera, &QCamera::errorOccurred, this, [this] {
        qWarning() << "[starvis.sentry] webcam error:"
                   << (m_camera ? m_camera->errorString() : QString());
    });
    m_camera->start();
    qInfo() << "[starvis.sentry] webcam capture started:"
            << QMediaDevices::defaultVideoInput().description();
    emit activeChanged();
}

} // namespace qtpanel
