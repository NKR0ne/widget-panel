#pragma once

#include "BackendInterfaces.h"

#include <QNetworkAccessManager>
#include <QString>

namespace qtpanel {

// OpenAI-compatible multimodal adapter for LM Studio and llama.cpp vision
// servers. Images are sent as data URLs and the full request remains
// cancellable through BackendOperation.
class OpenAiCompatibleVisionBackend final : public VisionBackend {
    Q_OBJECT

public:
    explicit OpenAiCompatibleVisionBackend(QObject* parent = nullptr);

    BackendDescriptor descriptor() const override;
    BackendOperation* analyze(const VisionRequest& request,
                              QObject* owner = nullptr) override;

    void configure(const QString& endpoint, const QString& model,
                   const QString& bearerToken = {});
    void setAvailable(bool available);

private:
    QString chatCompletionsUrl() const;

    QNetworkAccessManager m_network;
    QString m_endpoint = QStringLiteral("http://127.0.0.1:1236/v1");
    QString m_model;
    QString m_bearerToken;
    bool m_available = false;
};

} // namespace qtpanel
