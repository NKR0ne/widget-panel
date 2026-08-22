#include "StarvisState.h"

#include <QDateTime>
#include <QDebug>

namespace qtpanel {

StarvisState::StarvisState(QObject* parent)
    : QObject(parent)
{
    m_rateTimer.setInterval(500);
    connect(&m_rateTimer, &QTimer::timeout, this, [this] {
        // ~4 chars per token is close enough for a motion parameter.
        const double rate = (m_deltaChars / 4.0) * 2.0;
        m_deltaChars = 0;
        if (!qFuzzyCompare(rate + 1.0, m_tokensPerSec + 1.0)) {
            m_tokensPerSec = rate;
            emit tokensPerSecChanged();
        }
        if (rate <= 0 && !m_reasoning)
            m_rateTimer.stop();
    });

    m_alertDecay.setSingleShot(true);
    m_alertDecay.setInterval(10000);
    connect(&m_alertDecay, &QTimer::timeout, this, [this] {
        m_alertActive = false;
        recompute();
    });
}

QString StarvisState::state() const
{
    return m_current;
}

void StarvisState::recompute()
{
    QString next = QStringLiteral("idle");
    if (m_alertActive)
        next = QStringLiteral("alert");
    else if (m_speaking)
        next = QStringLiteral("speaking");
    else if (m_listening)
        next = QStringLiteral("listening");
    else if (m_analyzing)
        next = QStringLiteral("analyzing");
    else if (m_reasoning)
        next = QStringLiteral("reasoning");
    if (next != m_current) {
        m_current = next;
        qInfo() << "[starvis.state] ->" << next;
        emit stateChanged();
    }
}

void StarvisState::setReasoning(bool on)
{
    if (m_reasoning == on)
        return;
    m_reasoning = on;
    if (on && !m_rateTimer.isActive())
        m_rateTimer.start();
    recompute();
}

void StarvisState::setSpeaking(bool on)
{
    if (m_speaking == on)
        return;
    m_speaking = on;
    recompute();
}

void StarvisState::setListening(bool on)
{
    if (m_listening == on)
        return;
    m_listening = on;
    recompute();
}

void StarvisState::setAnalyzing(bool on)
{
    if (m_analyzing == on)
        return;
    m_analyzing = on;
    recompute();
}

void StarvisState::triggerAlert(const QString& text, const QString& severity)
{
    m_lastAlert = {
        {QStringLiteral("text"), text},
        {QStringLiteral("severity"), severity},
        {QStringLiteral("at"), QDateTime::currentDateTime().toString(Qt::ISODate)},
    };
    emit alertChanged();
    m_alertActive = true;
    m_alertDecay.start();
    recompute();
}

void StarvisState::noteTextDelta(int chars)
{
    m_deltaChars += chars;
    if (!m_rateTimer.isActive())
        m_rateTimer.start();
}

void StarvisState::setUsage(int inputTokens, int outputTokens, double costUsd)
{
    m_sessionInputTokens = inputTokens;
    m_sessionOutputTokens = outputTokens;
    m_sessionCostUsd = costUsd;
    emit usageChanged();
}

void StarvisState::setAudioLevel(double level)
{
    const double clamped = qBound(0.0, level, 1.0);
    if (qFuzzyCompare(clamped + 1.0, m_audioLevel + 1.0))
        return;
    m_audioLevel = clamped;
    emit audioLevelChanged();
}

} // namespace qtpanel
