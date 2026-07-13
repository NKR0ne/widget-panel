#pragma once

#include <QString>

namespace qtpanel {

// Installs a Qt message handler that mirrors output to a log file and stderr.
void initLogging(const QString& filePath);

// Qt Multimedia exposes a generic QMediaPlayer error for some FFmpeg failures,
// while the backend logs the actionable reason immediately beforehand.
QString recentFfmpegError(int maxAgeMs = 2000);

} // namespace qtpanel
