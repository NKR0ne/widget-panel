#include "BackendOperation.h"

#include <QMetaObject>
#include <QThread>
#include <QTimer>
#include <QUuid>

namespace qtpanel {

BackendOperation::BackendOperation(const QString& capability, const QString& provider,
                                   QObject* parent)
    : QObject(parent)
    , m_id(QUuid::createUuid().toString(QUuid::WithoutBraces))
    , m_capability(capability)
    , m_provider(provider)
{
}

bool BackendOperation::active() const
{
    return m_state == State::Pending || m_state == State::Running
        || m_state == State::Cancelling;
}

bool BackendOperation::cancellationRequested() const
{
    return m_state == State::Cancelling || m_state == State::Cancelled;
}

bool BackendOperation::terminal() const
{
    return m_state == State::Completed || m_state == State::Cancelled
        || m_state == State::Failed;
}

void BackendOperation::setState(State state)
{
    if (m_state == state)
        return;
    m_state = state;
    emit stateChanged();
}

void BackendOperation::start()
{
    if (m_state == State::Pending)
        setState(State::Running);
}

void BackendOperation::appendText(const QString& delta)
{
    if (delta.isEmpty() || terminal() || m_state == State::Cancelling)
        return;
    start();
    m_text += delta;
    emit textDelta(delta);
}

void BackendOperation::appendThinking(const QString& delta)
{
    if (delta.isEmpty() || terminal() || m_state == State::Cancelling)
        return;
    start();
    m_thinking += delta;
    emit thinkingDelta(delta);
}

void BackendOperation::appendTranscript(const QString& delta, bool final)
{
    if (delta.isEmpty() || terminal() || m_state == State::Cancelling)
        return;
    start();
    emit transcriptDelta(delta, final);
}

void BackendOperation::appendAudio(const QByteArray& pcm, int sampleRate, int channels)
{
    if (pcm.isEmpty() || sampleRate <= 0 || channels <= 0 || terminal()
        || m_state == State::Cancelling) {
        return;
    }
    start();
    emit audioChunk(pcm, sampleRate, channels);
}

void BackendOperation::complete(const QVariantMap& result)
{
    if (terminal() || m_state == State::Cancelling)
        return;
    m_result = result;
    m_cancelHandlers.clear();
    setState(State::Completed);
    emit succeeded(m_result);
}

void BackendOperation::fail(const QString& error)
{
    if (terminal() || m_state == State::Cancelling)
        return;
    m_error = error;
    m_cancelHandlers.clear();
    setState(State::Failed);
    emit failed(m_error);
}

void BackendOperation::acknowledgeCancelled()
{
    if (terminal())
        return;
    m_cancelHandlers.clear();
    setState(State::Cancelled);
    emit cancelled();
}

void BackendOperation::addCancellationHandler(std::function<void()> handler)
{
    if (!handler)
        return;
    if (cancellationRequested()) {
        handler();
        return;
    }
    if (!terminal())
        m_cancelHandlers.push_back(std::move(handler));
}

void BackendOperation::cancel()
{
    if (QThread::currentThread() != thread()) {
        QMetaObject::invokeMethod(this, &BackendOperation::cancel, Qt::QueuedConnection);
        return;
    }
    if (terminal() || m_state == State::Cancelling)
        return;

    setState(State::Cancelling);
    emit cancellationRequestedSignal();
    auto handlers = std::move(m_cancelHandlers);
    m_cancelHandlers.clear();
    for (const auto& handler : handlers)
        handler();

    // A transport should acknowledge cancellation from its completion callback.
    // This guard prevents a broken backend from leaving the UI stuck forever.
    QTimer::singleShot(1500, this, [this] {
        if (m_state == State::Cancelling)
            acknowledgeCancelled();
    });
}

} // namespace qtpanel
