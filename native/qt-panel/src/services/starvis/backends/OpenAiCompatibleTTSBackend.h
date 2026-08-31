#pragma once

#include "BackendInterfaces.h"

#include <QNetworkAccessManager>
#include <QString>

namespace qtpanel {

// Encoded-audio adapter for Piper-compatible local services and OpenAI TTS.
// Playback remains outside the backend so synthesis can be cancelled or
// replaced independently from the platform audio output.
class OpenAiCompatibleTTSBackend final : public TTSBackend {
    Q_OBJECT

public:
    explicit OpenAiCompatibleTTSBackend(QObject* parent = nullptr);

    BackendDescriptor descriptor() const override;
    BackendOperation* synthesize(const TtsRequest& request,
                                 QObject* owner = nullptr) override;

    void configure(const QString& endpoint, const QString& model,
                   const QString& bearerToken = {},
                   const QString& responseFormat = QStringLiteral("wav"));
    void setAvailable(bool available);

private:
    QString speechUrl() const;

    QNetworkAccessManager m_network;
    QString m_endpoint = QStringLiteral("http://127.0.0.1:1237/v1");
    QString m_model;
    QString m_bearerToken;
    QString m_responseFormat = QStringLiteral("wav");
    bool m_available = false;
};

} // namespace qtpanel
