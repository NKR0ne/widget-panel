#pragma once

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QVariantMap>

#include <functional>
#include <vector>

namespace qtpanel {

// One asynchronous backend request, shared by text, vision, STT, and TTS.
// Backends stream partial results through this object and register transport
// abort handlers so cancellation always propagates below the UI layer.
class BackendOperation final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString id READ id CONSTANT)
    Q_PROPERTY(QString capability READ capability CONSTANT)
    Q_PROPERTY(QString provider READ provider CONSTANT)
    Q_PROPERTY(State state READ state NOTIFY stateChanged)
    Q_PROPERTY(bool active READ active NOTIFY stateChanged)
    Q_PROPERTY(bool cancellationRequested READ cancellationRequested NOTIFY stateChanged)
    Q_PROPERTY(QString text READ text NOTIFY textDelta)
    Q_PROPERTY(QString thinking READ thinking NOTIFY thinkingDelta)
    Q_PROPERTY(QString error READ error NOTIFY stateChanged)

public:
    enum class State {
        Pending,
        Running,
        Cancelling,
        Completed,
        Cancelled,
        Failed,
    };
    Q_ENUM(State)

    explicit BackendOperation(const QString& capability, const QString& provider,
                              QObject* parent = nullptr);

    QString id() const { return m_id; }
    QString capability() const { return m_capability; }
    QString provider() const { return m_provider; }
    State state() const { return m_state; }
    bool active() const;
    bool cancellationRequested() const;
    QString text() const { return m_text; }
    QString thinking() const { return m_thinking; }
    QString error() const { return m_error; }
    QVariantMap result() const { return m_result; }

    void start();
    void appendText(const QString& delta);
    void appendThinking(const QString& delta);
    void appendTranscript(const QString& delta, bool final = false);
    void appendAudio(const QByteArray& pcm, int sampleRate, int channels = 1);
    void complete(const QVariantMap& result = {});
    void fail(const QString& error);
    void acknowledgeCancelled();

    // Handlers run once, in registration order. A backend normally registers
    // QNetworkReply::abort, process termination, or decoder interruption here.
    void addCancellationHandler(std::function<void()> handler);

    Q_INVOKABLE void cancel();

signals:
    void stateChanged();
    void textDelta(const QString& delta);
    void thinkingDelta(const QString& delta);
    void transcriptDelta(const QString& delta, bool final);
    void audioChunk(const QByteArray& pcm, int sampleRate, int channels);
    void cancellationRequestedSignal();
    void succeeded(const QVariantMap& result);
    void cancelled();
    void failed(const QString& error);

private:
    bool terminal() const;
    void setState(State state);

    QString m_id;
    QString m_capability;
    QString m_provider;
    State m_state = State::Pending;
    QString m_text;
    QString m_thinking;
    QString m_error;
    QVariantMap m_result;
    std::vector<std::function<void()>> m_cancelHandlers;
};

} // namespace qtpanel
