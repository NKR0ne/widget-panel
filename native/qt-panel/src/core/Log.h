#pragma once

#include <QString>

namespace qtpanel {

// Installs a Qt message handler that mirrors output to a log file and stderr.
void initLogging(const QString& filePath);

} // namespace qtpanel
