#include "Log.h"

#include <QDateTime>
#include <QFile>
#include <QMutex>

#include <cstdio>
#include <cstdlib>

namespace {

QFile* g_logFile = nullptr;
QMutex g_mutex;
QString g_lastFfmpegError;
qint64 g_lastFfmpegErrorAt = 0;

void messageHandler(QtMsgType type, const QMessageLogContext& context, const QString& msg)
{
    Q_UNUSED(context)
    const char* level = "info";
    switch (type) {
    case QtDebugMsg:    level = "debug"; break;
    case QtInfoMsg:     level = "info"; break;
    case QtWarningMsg:  level = "warn"; break;
    case QtCriticalMsg: level = "critical"; break;
    case QtFatalMsg:    level = "fatal"; break;
    }
    const QString line = QStringLiteral("[%1] [%2] %3\n")
        .arg(QDateTime::currentDateTime().toString(Qt::ISODateWithMs),
             QLatin1String(level), msg);
    {
        QMutexLocker lock(&g_mutex);
        if (msg.contains(QLatin1String("FFmpeg error description:"))) {
            g_lastFfmpegError = msg;
            g_lastFfmpegErrorAt = QDateTime::currentMSecsSinceEpoch();
        }
        if (g_logFile && g_logFile->isOpen()) {
            g_logFile->write(line.toUtf8());
            g_logFile->flush();
        }
    }
    fputs(qPrintable(line), stderr);
    if (type == QtFatalMsg)
        std::abort();
}

} // namespace

namespace qtpanel {

void initLogging(const QString& filePath)
{
    auto* file = new QFile(filePath);
    if (!file->open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text))
        fprintf(stderr, "qt-panel: cannot open log file %s\n", qPrintable(filePath));
    {
        QMutexLocker lock(&g_mutex);
        g_logFile = file;
    }
    qInstallMessageHandler(messageHandler);
    qInfo() << "qt-panel logging to" << filePath;
}

QString recentFfmpegError(int maxAgeMs)
{
    QMutexLocker lock(&g_mutex);
    if (g_lastFfmpegErrorAt <= 0
        || QDateTime::currentMSecsSinceEpoch() - g_lastFfmpegErrorAt > maxAgeMs) {
        return {};
    }
    return g_lastFfmpegError;
}

} // namespace qtpanel
