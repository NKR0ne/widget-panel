#pragma once

#include "BackendInterfaces.h"

#include <QNetworkAccessManager>
#include <QString>

namespace qtpanel {

// Multipart transcription adapter shared by local NeMo-Speech/Parakeet,
// current compatibility runtimes, and OpenAI-compatible cloud fallbacks.
class OpenAiCompatibleSTTBackend final : public STTBackend {
    Q_OBJECT

public:
    explicit OpenAiCompatibleSTTBackend(QObject* parent = nullptr);

    BackendDescriptor descriptor() const override;
    BackendOperation* transcribe(const SttRequest& request,
                                 QObject* owner = nullptr) override;

    void configure(const QString& endpoint, const QString& model,
                   const QString& bearerToken = {});
    void setAvailable(bool available);

private:
    static QByteArray pcmToWav(const SttRequest& request);
    QString transcriptionUrl() const;

    QNetworkAccessManager m_network;
    QString m_endpoint = QStringLiteral("http://127.0.0.1:1235/v1");
    QString m_model;
    QString m_bearerToken;
    bool m_available = false;
};

} // namespace qtpanel
