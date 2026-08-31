#pragma once

#include "BackendInterfaces.h"

#include <QString>

namespace qtpanel {

class HttpClient;

// OpenAI-compatible streaming chat adapter used by LM Studio and compatible
// local servers. Provider-specific policy stays outside this transport class.
class OpenAiCompatibleLLMBackend final : public LLMBackend {
    Q_OBJECT

public:
    explicit OpenAiCompatibleLLMBackend(HttpClient* http, QObject* parent = nullptr);

    BackendDescriptor descriptor() const override;
    BackendOperation* generate(const LlmRequest& request,
                               QObject* owner = nullptr) override;

    void configure(const QString& endpoint, const QString& defaultModel,
                   const QString& bearerToken = {});
    void setAvailable(bool available);

private:
    QString chatCompletionsUrl() const;

    HttpClient* m_http = nullptr;
    QString m_endpoint = QStringLiteral("http://127.0.0.1:1234/v1");
    QString m_defaultModel;
    QString m_bearerToken;
    bool m_available = false;
};

} // namespace qtpanel
