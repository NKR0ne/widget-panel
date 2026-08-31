#pragma once

#include "BackendOperation.h"

#include <QByteArray>
#include <QImage>
#include <QJsonArray>
#include <QObject>
#include <QString>
#include <QVariantMap>
#include <QVector>

namespace qtpanel {

struct BackendDescriptor {
    QString id;
    QString displayName;
    QString endpoint;
    QString model;
    bool available = false;
    bool streamsInput = false;
    bool streamsOutput = false;
    QVariantMap metadata;
};

struct LlmRequest {
    QJsonArray messages;
    QJsonArray tools;
    QString model;
    int maxTokens = 1800;
    double temperature = 0.0;
    bool reasoning = false;
};

struct VisionRequest {
    QVector<QImage> images;
    QString prompt;
    QString model;
    int maxTokens = 800;
    bool reasoning = false;
};

struct SttRequest {
    QByteArray pcm;
    int sampleRate = 16000;
    int channels = 1;
    QString model;
    QString language;
    bool detectLanguage = true;
    bool partialTranscripts = false;
};

struct TtsRequest {
    QString text;
    QString voice;
    QString language;
    int sampleRate = 24000;
    bool stream = true;
    QVariantMap options;
};

class LLMBackend : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    virtual BackendDescriptor descriptor() const = 0;
    virtual BackendOperation* generate(const LlmRequest& request,
                                       QObject* owner = nullptr) = 0;
signals:
    void availabilityChanged();
};

class VisionBackend : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    virtual BackendDescriptor descriptor() const = 0;
    virtual BackendOperation* analyze(const VisionRequest& request,
                                      QObject* owner = nullptr) = 0;
signals:
    void availabilityChanged();
};

class STTBackend : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    virtual BackendDescriptor descriptor() const = 0;
    virtual BackendOperation* transcribe(const SttRequest& request,
                                         QObject* owner = nullptr) = 0;
signals:
    void availabilityChanged();
};

class TTSBackend : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    virtual BackendDescriptor descriptor() const = 0;
    virtual BackendOperation* synthesize(const TtsRequest& request,
                                         QObject* owner = nullptr) = 0;
signals:
    void availabilityChanged();
};

} // namespace qtpanel

Q_DECLARE_METATYPE(qtpanel::BackendDescriptor)
Q_DECLARE_METATYPE(qtpanel::LlmRequest)
Q_DECLARE_METATYPE(qtpanel::VisionRequest)
Q_DECLARE_METATYPE(qtpanel::SttRequest)
Q_DECLARE_METATYPE(qtpanel::TtsRequest)
