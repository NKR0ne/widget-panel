#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QTimer>
#include <functional>
#include <utility>

namespace qtpanel {

// Wait for a display-connected speaker without blocking the UI or keeping
// an obsolete announcement alive after cancellation/replacement.
class AudioOutputRecovery : public QObject {
public:
    using Completion = std::function<void(bool)>;
    AudioOutputRecovery(std::function<bool()> available, std::function<void()> wake,
                        QObject* parent = nullptr, int timeoutMs = 8000,
                        int pollMs = 100, int settleMs = 300)
        : QObject(parent), m_available(std::move(available)), m_wake(std::move(wake)),
          m_timeoutMs(timeoutMs), m_settleMs(settleMs)
    {
        m_timer.setInterval(pollMs);
        connect(&m_timer, &QTimer::timeout, this, [this] {
            if (m_available()) {
                if (!m_settled.isValid())
                    m_settled.start();
                if (m_settled.elapsed() >= m_settleMs) {
                    complete(true);
                    return;
                }
            } else {
                m_settled.invalidate();
            }
            if (m_elapsed.elapsed() >= m_timeoutMs)
                complete(false);
        });
    }

    void request(Completion completion)
    {
        cancel();
        if (m_available()) {
            completion(true);
            return;
        }
        m_completion = std::move(completion);
        m_elapsed.start();
        m_wake();
        m_timer.start();
    }

    void cancel()
    {
        m_timer.stop();
        m_completion = {};
        m_settled.invalidate();
    }

private:
    void complete(bool ready)
    {
        auto completion = std::move(m_completion);
        cancel();
        if (completion)
            completion(ready);
    }

    QTimer m_timer;
    QElapsedTimer m_elapsed;
    QElapsedTimer m_settled;
    std::function<bool()> m_available;
    std::function<void()> m_wake;
    Completion m_completion;
    int m_timeoutMs;
    int m_settleMs;
};

} // namespace qtpanel
