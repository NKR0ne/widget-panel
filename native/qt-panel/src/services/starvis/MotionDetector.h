#pragma once

#include <QHash>
#include <QImage>
#include <QRectF>
#include <QString>
#include <QVector>

#include <cstdint>

namespace qtpanel {

// Pure, per-camera frame-differencing motion detector. No Qt parents, no
// timers, no I/O — unit-testable with synthetic frames.
//
// Frames are downscaled to a small grayscale raster; the mean absolute
// per-pixel delta inside each zone (normalized rects; empty list = whole
// frame) is compared to `threshold` (0..1). A per-camera cooldown suppresses
// repeat events; `now` is passed in (ms) so tests control the clock.
class MotionDetector {
public:
    struct Result {
        bool motion = false;
        double score = 0;      // strongest zone's mean delta 0..1
        int zoneIndex = -1;    // -1 = whole frame
        bool suppressed = false; // motion seen but inside cooldown
    };

    explicit MotionDetector(int rasterWidth = 160, int rasterHeight = 90);

    void setThreshold(double threshold) { m_threshold = threshold; }
    double threshold() const { return m_threshold; }
    void setCooldownMs(qint64 cooldownMs) { m_cooldownMs = cooldownMs; }

    void setZones(const QString& cameraId, const QVector<QRectF>& normalizedZones);
    void reset(const QString& cameraId);

    Result analyze(const QString& cameraId, const QImage& frame, qint64 nowMs);

private:
    struct CameraState {
        QVector<uint8_t> previous;
        qint64 lastEventMs = -1;
        bool hasPrevious = false;
    };

    QVector<uint8_t> rasterize(const QImage& frame) const;

    int m_width;
    int m_height;
    double m_threshold = 0.045;
    qint64 m_cooldownMs = 30000;
    QHash<QString, CameraState> m_cameras;
    QHash<QString, QVector<QRectF>> m_zones;
};

} // namespace qtpanel
