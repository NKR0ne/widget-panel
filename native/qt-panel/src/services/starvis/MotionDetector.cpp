#include "MotionDetector.h"

namespace qtpanel {

MotionDetector::MotionDetector(int rasterWidth, int rasterHeight)
    : m_width(rasterWidth)
    , m_height(rasterHeight)
{
}

void MotionDetector::setZones(const QString& cameraId, const QVector<QRectF>& normalizedZones)
{
    m_zones.insert(cameraId, normalizedZones);
}

void MotionDetector::reset(const QString& cameraId)
{
    m_cameras.remove(cameraId);
}

QVector<uint8_t> MotionDetector::rasterize(const QImage& frame) const
{
    const QImage scaled = frame.scaled(m_width, m_height, Qt::IgnoreAspectRatio,
                                       Qt::FastTransformation)
                              .convertToFormat(QImage::Format_Grayscale8);
    QVector<uint8_t> out(m_width * m_height);
    for (int y = 0; y < m_height; ++y) {
        const uchar* line = scaled.constScanLine(y);
        std::copy(line, line + m_width, out.begin() + y * m_width);
    }
    return out;
}

MotionDetector::Result MotionDetector::analyze(const QString& cameraId, const QImage& frame,
                                               qint64 nowMs)
{
    Result result;
    if (frame.isNull())
        return result;

    CameraState& state = m_cameras[cameraId];
    QVector<uint8_t> raster = rasterize(frame);
    if (!state.hasPrevious || state.previous.size() != raster.size()) {
        state.previous = std::move(raster);
        state.hasPrevious = true;
        return result; // first frame is the baseline
    }

    QVector<QRectF> zones = m_zones.value(cameraId);
    if (zones.isEmpty())
        zones.append(QRectF(0, 0, 1, 1));

    for (int zoneIndex = 0; zoneIndex < zones.size(); ++zoneIndex) {
        const QRectF& zone = zones.at(zoneIndex);
        const int x0 = qBound(0, int(zone.left() * m_width), m_width - 1);
        const int x1 = qBound(x0 + 1, int(zone.right() * m_width), m_width);
        const int y0 = qBound(0, int(zone.top() * m_height), m_height - 1);
        const int y1 = qBound(y0 + 1, int(zone.bottom() * m_height), m_height);

        qint64 sum = 0;
        int count = 0;
        for (int y = y0; y < y1; ++y) {
            const uint8_t* current = raster.constData() + y * m_width;
            const uint8_t* previous = state.previous.constData() + y * m_width;
            for (int x = x0; x < x1; ++x) {
                sum += qAbs(int(current[x]) - int(previous[x]));
                ++count;
            }
        }
        const double score = count > 0 ? double(sum) / (count * 255.0) : 0;
        if (score > result.score) {
            result.score = score;
            result.zoneIndex = zones.size() == 1 && zone == QRectF(0, 0, 1, 1)
                ? -1 : zoneIndex;
        }
    }

    state.previous = std::move(raster);

    if (result.score >= m_threshold) {
        if (state.lastEventMs >= 0 && nowMs - state.lastEventMs < m_cooldownMs) {
            result.suppressed = true;
        } else {
            result.motion = true;
            state.lastEventMs = nowMs;
        }
    }
    return result;
}

} // namespace qtpanel
