#pragma once

#include <QObject>
#include <QString>
#include <QTimer>
#include <QVariantMap>

namespace qtpanel {

// QML-facing state hub for the Starvis avatar and stage readouts. Services
// raise flags; `state` is the highest-priority active one:
// alert > speaking > listening > analyzing > reasoning > idle.
class StarvisState : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY stateChanged)
    Q_PROPERTY(double tokensPerSec READ tokensPerSec NOTIFY tokensPerSecChanged)
    Q_PROPERTY(int sessionInputTokens READ sessionInputTokens NOTIFY usageChanged)
    Q_PROPERTY(int sessionOutputTokens READ sessionOutputTokens NOTIFY usageChanged)
    Q_PROPERTY(double sessionCostUsd READ sessionCostUsd NOTIFY usageChanged)
    Q_PROPERTY(double audioLevel READ audioLevel NOTIFY audioLevelChanged)
    Q_PROPERTY(QVariantMap lastAlert READ lastAlert NOTIFY alertChanged)

public:
    explicit StarvisState(QObject* parent = nullptr);

    QString state() const;
    double tokensPerSec() const { return m_tokensPerSec; }
    int sessionInputTokens() const { return m_sessionInputTokens; }
    int sessionOutputTokens() const { return m_sessionOutputTokens; }
    double sessionCostUsd() const { return m_sessionCostUsd; }
    double audioLevel() const { return m_audioLevel; }
    QVariantMap lastAlert() const { return m_lastAlert; }

    // Service-side setters (not invokable from QML on purpose).
    void setReasoning(bool on);
    void setSpeaking(bool on);
    void setListening(bool on);
    void setAnalyzing(bool on);
    void triggerAlert(const QString& text, const QString& severity);
    void noteTextDelta(int chars); // feeds the tokensPerSec estimate
    void setUsage(int inputTokens, int outputTokens, double costUsd);
    void setAudioLevel(double level);

signals:
    void stateChanged();
    void tokensPerSecChanged();
    void usageChanged();
    void audioLevelChanged();
    void alertChanged();

private:
    void recompute();

    bool m_reasoning = false;
    bool m_speaking = false;
    bool m_listening = false;
    bool m_analyzing = false;
    bool m_alertActive = false;
    QString m_current = QStringLiteral("idle");
    double m_tokensPerSec = 0;
    int m_deltaChars = 0;
    int m_sessionInputTokens = 0;
    int m_sessionOutputTokens = 0;
    double m_sessionCostUsd = 0;
    double m_audioLevel = 0;
    QVariantMap m_lastAlert;
    QTimer m_rateTimer;   // 500 ms: chars window -> tokens/s estimate
    QTimer m_alertDecay;  // 10 s: alert state falls back automatically
};

} // namespace qtpanel
