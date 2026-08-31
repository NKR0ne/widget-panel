#include <QtTest>

#include "core/HttpClient.h"
#include "core/TextFix.h"
#include "core/SettingsStore.h"
#include "services/news/NewsService.h"
#include "services/reader/ReaderService.h"
#include "services/live/LiveFeedService.h"
#include "services/pressreader/PressReaderService.h"
#include "services/workstation/WorkstationClient.h"
#include "shell/FocusPolicy.h"
#include "shell/SystemTheme.h"
#include "services/starvis/ModelResolver.h"
#include "services/starvis/MotionDetector.h"
#include "services/starvis/backends/BackendOperation.h"
#include "services/starvis/backends/OpenAiCompatibleLLMBackend.h"
#include "services/starvis/backends/OpenAiCompatibleVisionBackend.h"
#include "services/starvis/backends/OpenAiCompatibleSTTBackend.h"
#include "services/starvis/backends/OpenAiCompatibleTTSBackend.h"
#include "services/starvis/backends/StreamingTextSegmenter.h"

#include <QJsonArray>
#include <QJsonObject>
#include <QLocalServer>
#include <QLocalSocket>
#include <QPainter>
#include <QTemporaryDir>
#include <QTcpServer>
#include <QTcpSocket>

using namespace qtpanel;

// Unit coverage for the trickiest pure-logic ports: encoding repair, the
// blur-to-hide heuristics, settings, feed parsing, and reader extraction.
class TestQtPanel : public QObject {
    Q_OBJECT

private slots:
    void backendOperationStreamsAndCompletes()
    {
        BackendOperation operation(QStringLiteral("llm"), QStringLiteral("lm-studio"));
        QSignalSpy textSpy(&operation, &BackendOperation::textDelta);
        QSignalSpy finishedSpy(&operation, &BackendOperation::succeeded);

        operation.start();
        operation.appendThinking(QStringLiteral("plan"));
        operation.appendText(QStringLiteral("Bonjour"));
        operation.appendText(QStringLiteral(" le monde."));
        operation.complete({{QStringLiteral("tokens"), 4}});

        QCOMPARE(operation.state(), BackendOperation::State::Completed);
        QCOMPARE(operation.text(), QStringLiteral("Bonjour le monde."));
        QCOMPARE(operation.thinking(), QStringLiteral("plan"));
        QCOMPARE(operation.result().value(QStringLiteral("tokens")).toInt(), 4);
        QCOMPARE(textSpy.count(), 2);
        QCOMPARE(finishedSpy.count(), 1);

        operation.appendText(QStringLiteral("ignored"));
        operation.fail(QStringLiteral("ignored"));
        QCOMPARE(operation.text(), QStringLiteral("Bonjour le monde."));
        QCOMPARE(operation.state(), BackendOperation::State::Completed);
    }

    void backendOperationCancellationPropagatesOnce()
    {
        BackendOperation operation(QStringLiteral("tts"), QStringLiteral("chatterbox"));
        QSignalSpy cancelledSpy(&operation, &BackendOperation::cancelled);
        int abortCount = 0;
        operation.addCancellationHandler([&] {
            ++abortCount;
            operation.acknowledgeCancelled();
        });

        operation.start();
        operation.cancel();
        operation.cancel();

        QCOMPARE(abortCount, 1);
        QCOMPARE(cancelledSpy.count(), 1);
        QCOMPARE(operation.state(), BackendOperation::State::Cancelled);
        QVERIFY(!operation.active());
    }

    void openAiCompatibleBackendStreamsAndReportsUsage()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        QByteArray requestBytes;
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, this, [&, socket] {
                requestBytes += socket->readAll();
                const int headerEnd = requestBytes.indexOf("\r\n\r\n");
                if (headerEnd < 0 || socket->property("answered").toBool())
                    return;
                const QByteArray headers = requestBytes.left(headerEnd);
                const QRegularExpression lengthPattern(
                    QStringLiteral("content-length:\\s*(\\d+)"),
                    QRegularExpression::CaseInsensitiveOption);
                const QRegularExpressionMatch match = lengthPattern.match(
                    QString::fromLatin1(headers));
                if (!match.hasMatch())
                    return;
                const int contentLength = match.captured(1).toInt();
                if (requestBytes.size() - headerEnd - 4 < contentLength)
                    return;

                socket->setProperty("answered", true);
                const QByteArray response =
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                    "Connection: close\r\n\r\n"
                    "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"analyse \"}}]}\n\n"
                    "data: {\"choices\":[{\"delta\":{\"content\":\"Bonjour\"}}]}\n\n"
                    "data: {\"choices\":[{\"delta\":{\"content\":\" local.\"}}]}\n\n"
                    "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,"
                    "\"completion_tokens\":3}}\n\n"
                    "data: [DONE]\n\n";
                socket->write(response);
                socket->disconnectFromHost();
            });
        });

        HttpClient http;
        OpenAiCompatibleLLMBackend backend(&http);
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("qwen-test"));
        LlmRequest request;
        request.messages = QJsonArray{
            QJsonObject{{QStringLiteral("role"), QStringLiteral("user")},
                        {QStringLiteral("content"), QStringLiteral("Bonjour")}},
        };
        request.reasoning = true;
        BackendOperation* operation = backend.generate(request, this);
        QSignalSpy textSpy(operation, &BackendOperation::textDelta);
        QSignalSpy thinkingSpy(operation, &BackendOperation::thinkingDelta);
        QSignalSpy finishedSpy(operation, &BackendOperation::succeeded);

        QTRY_COMPARE_WITH_TIMEOUT(finishedSpy.count(), 1, 2000);
        QCOMPARE(operation->text(), QStringLiteral("Bonjour local."));
        QCOMPARE(operation->thinking(), QStringLiteral("analyse "));
        QCOMPARE(operation->result().value(QStringLiteral("promptTokens")).toInt(), 12);
        QCOMPARE(operation->result().value(QStringLiteral("completionTokens")).toInt(), 3);
        QCOMPARE(textSpy.count(), 2);
        QCOMPARE(thinkingSpy.count(), 1);

        const int bodyStart = requestBytes.indexOf("\r\n\r\n") + 4;
        const QJsonObject sent = QJsonDocument::fromJson(requestBytes.mid(bodyStart)).object();
        QCOMPARE(sent.value(QStringLiteral("model")).toString(), QStringLiteral("qwen-test"));
        QVERIFY(sent.value(QStringLiteral("stream")).toBool());
        QVERIFY(sent.value(QStringLiteral("chat_template_kwargs")).toObject()
                    .value(QStringLiteral("enable_thinking")).toBool());
    }

    void openAiCompatibleBackendCancelsTransport()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            socket->write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                          "Connection: close\r\n\r\n");
            socket->flush();
        });

        HttpClient http;
        OpenAiCompatibleLLMBackend backend(&http);
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("qwen-test"));
        LlmRequest request;
        request.messages = QJsonArray{
            QJsonObject{{QStringLiteral("role"), QStringLiteral("user")},
                        {QStringLiteral("content"), QStringLiteral("Attends")}},
        };
        BackendOperation* operation = backend.generate(request, this);
        QSignalSpy cancelledSpy(operation, &BackendOperation::cancelled);
        QTRY_VERIFY_WITH_TIMEOUT(server.hasPendingConnections()
                                    || operation->state() == BackendOperation::State::Running,
                                500);
        operation->cancel();
        QTRY_COMPARE_WITH_TIMEOUT(cancelledSpy.count(), 1, 2000);
        QCOMPARE(operation->state(), BackendOperation::State::Cancelled);
    }

    void openAiCompatibleVisionSendsImagesAndReturnsJson()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        QByteArray requestBytes;
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, this, [&, socket] {
                requestBytes += socket->readAll();
                const int headerEnd = requestBytes.indexOf("\r\n\r\n");
                if (headerEnd < 0 || socket->property("answered").toBool())
                    return;
                const QRegularExpression lengthPattern(
                    QStringLiteral("content-length:\\s*(\\d+)"),
                    QRegularExpression::CaseInsensitiveOption);
                const auto match = lengthPattern.match(
                    QString::fromLatin1(requestBytes.left(headerEnd)));
                if (!match.hasMatch()
                    || requestBytes.size() - headerEnd - 4 < match.captured(1).toInt()) {
                    return;
                }
                socket->setProperty("answered", true);
                const QByteArray responseBody =
                    "{\"choices\":[{\"message\":{\"content\":"
                    "\"Analyse: {\\\"classification\\\":\\\"person\\\","
                    "\\\"confidence\\\":0.94}\"}}]}";
                socket->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                              "Content-Length: " + QByteArray::number(responseBody.size())
                              + "\r\nConnection: close\r\n\r\n" + responseBody);
                socket->disconnectFromHost();
            });
        });

        OpenAiCompatibleVisionBackend backend;
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("qwen-vl-test"));
        VisionRequest request;
        request.images = {QImage(4, 4, QImage::Format_RGB32)};
        request.images[0].fill(Qt::red);
        request.imageLabels = {QStringLiteral("Image à analyser :")};
        request.prompt = QStringLiteral("Réponds en JSON.");
        BackendOperation* operation = backend.analyze(request, this);
        QSignalSpy finishedSpy(operation, &BackendOperation::succeeded);

        QTRY_COMPARE_WITH_TIMEOUT(finishedSpy.count(), 1, 2000);
        QCOMPARE(operation->result().value(QStringLiteral("json")).toMap()
                     .value(QStringLiteral("classification")).toString(),
                 QStringLiteral("person"));
        const int bodyStart = requestBytes.indexOf("\r\n\r\n") + 4;
        const QJsonObject body = QJsonDocument::fromJson(requestBytes.mid(bodyStart)).object();
        QCOMPARE(body.value(QStringLiteral("model")).toString(), QStringLiteral("qwen-vl-test"));
        QVERIFY(!body.value(QStringLiteral("stream")).toBool());
        const QJsonArray content = body.value(QStringLiteral("messages")).toArray().first()
                                       .toObject().value(QStringLiteral("content")).toArray();
        QCOMPARE(content.first().toObject().value(QStringLiteral("text")).toString(),
                 QStringLiteral("Image à analyser :"));
        QVERIFY(content.at(1).toObject().value(QStringLiteral("image_url")).toObject()
                    .value(QStringLiteral("url")).toString()
                    .startsWith(QStringLiteral("data:image/jpeg;base64,")));
        QCOMPARE(content.last().toObject().value(QStringLiteral("text")).toString(),
                 QStringLiteral("Réponds en JSON."));
    }

    void openAiCompatibleVisionCancelsTransport()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, socket, [socket] { socket->readAll(); });
        });

        OpenAiCompatibleVisionBackend backend;
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("qwen-vl-test"));
        VisionRequest request;
        request.images = {QImage(4, 4, QImage::Format_RGB32)};
        request.prompt = QStringLiteral("Attends");
        BackendOperation* operation = backend.analyze(request, this);
        QSignalSpy cancelledSpy(operation, &BackendOperation::cancelled);
        operation->cancel();
        QTRY_COMPARE_WITH_TIMEOUT(cancelledSpy.count(), 1, 2000);
        QCOMPARE(operation->state(), BackendOperation::State::Cancelled);
    }

    void openAiCompatibleSttTranscribesPcmAndDetectsLanguage()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        QByteArray requestBytes;
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, this, [&, socket] {
                requestBytes += socket->readAll();
                const int headerEnd = requestBytes.indexOf("\r\n\r\n");
                if (headerEnd < 0 || socket->property("answered").toBool())
                    return;
                const QRegularExpression lengthPattern(
                    QStringLiteral("content-length:\\s*(\\d+)"),
                    QRegularExpression::CaseInsensitiveOption);
                const QRegularExpressionMatch match = lengthPattern.match(
                    QString::fromLatin1(requestBytes.left(headerEnd)));
                if (!match.hasMatch())
                    return;
                const int contentLength = match.captured(1).toInt();
                if (requestBytes.size() - headerEnd - 4 < contentLength)
                    return;

                socket->setProperty("answered", true);
                const QByteArray responseBody =
                    "{\"text\":\"Bonjour Starvis\",\"language\":\"fr\","
                    "\"model\":\"parakeet-tdt-0.6b-v3\"}";
                socket->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                              "Content-Length: " + QByteArray::number(responseBody.size())
                              + "\r\nConnection: close\r\n\r\n" + responseBody);
                socket->disconnectFromHost();
            });
        });

        OpenAiCompatibleSTTBackend backend;
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("parakeet-tdt-0.6b-v3"));
        SttRequest request;
        request.pcm = QByteArray(3200, '\0');
        request.sampleRate = 16000;
        request.channels = 1;
        request.detectLanguage = true;
        request.language = QStringLiteral("fr");
        BackendOperation* operation = backend.transcribe(request, this);
        QSignalSpy transcriptSpy(operation, &BackendOperation::transcriptDelta);
        QSignalSpy finishedSpy(operation, &BackendOperation::succeeded);

        QTRY_COMPARE_WITH_TIMEOUT(finishedSpy.count(), 1, 2000);
        QCOMPARE(operation->result().value(QStringLiteral("text")).toString(),
                 QStringLiteral("Bonjour Starvis"));
        QCOMPARE(operation->result().value(QStringLiteral("language")).toString(),
                 QStringLiteral("fr"));
        QCOMPARE(transcriptSpy.count(), 1);
        QCOMPARE(transcriptSpy.first().at(0).toString(), QStringLiteral("Bonjour Starvis"));
        QVERIFY(transcriptSpy.first().at(1).toBool());

        const int bodyStart = requestBytes.indexOf("\r\n\r\n") + 4;
        const QByteArray multipartBody = requestBytes.mid(bodyStart);
        QVERIFY(multipartBody.contains("name=\"file\""));
        QVERIFY(multipartBody.contains("RIFF"));
        QVERIFY(multipartBody.contains("name=\"model\""));
        QVERIFY(multipartBody.contains("parakeet-tdt-0.6b-v3"));
        QVERIFY(!multipartBody.contains("name=\"language\""));
    }

    void openAiCompatibleSttCancelsTransport()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, socket, [socket] {
                socket->readAll();
            });
        });

        OpenAiCompatibleSTTBackend backend;
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("parakeet-tdt-0.6b-v3"));
        SttRequest request;
        request.pcm = QByteArray(3200, '\0');
        BackendOperation* operation = backend.transcribe(request, this);
        QSignalSpy cancelledSpy(operation, &BackendOperation::cancelled);
        operation->cancel();
        QTRY_COMPARE_WITH_TIMEOUT(cancelledSpy.count(), 1, 2000);
        QCOMPARE(operation->state(), BackendOperation::State::Cancelled);
    }

    void openAiCompatibleTtsReturnsEncodedAudio()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        QByteArray requestBytes;
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, this, [&, socket] {
                requestBytes += socket->readAll();
                const int headerEnd = requestBytes.indexOf("\r\n\r\n");
                if (headerEnd < 0 || socket->property("answered").toBool())
                    return;
                const QRegularExpression lengthPattern(
                    QStringLiteral("content-length:\\s*(\\d+)"),
                    QRegularExpression::CaseInsensitiveOption);
                const QRegularExpressionMatch match = lengthPattern.match(
                    QString::fromLatin1(requestBytes.left(headerEnd)));
                if (!match.hasMatch())
                    return;
                const int contentLength = match.captured(1).toInt();
                if (requestBytes.size() - headerEnd - 4 < contentLength)
                    return;

                socket->setProperty("answered", true);
                const QByteArray responseBody("RIFF-local-audio");
                socket->write("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\n"
                              "Content-Length: " + QByteArray::number(responseBody.size())
                              + "\r\nConnection: close\r\n\r\n" + responseBody);
                socket->disconnectFromHost();
            });
        });

        OpenAiCompatibleTTSBackend backend;
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("piper-fr"), QStringLiteral("test-key"),
                          QStringLiteral("wav"));
        TtsRequest request;
        request.text = QStringLiteral("Bonjour Starvis");
        request.voice = QStringLiteral("Tom");
        request.language = QStringLiteral("fr");
        request.stream = false;
        BackendOperation* operation = backend.synthesize(request, this);
        QSignalSpy finishedSpy(operation, &BackendOperation::succeeded);

        QTRY_COMPARE_WITH_TIMEOUT(finishedSpy.count(), 1, 2000);
        QCOMPARE(operation->result().value(QStringLiteral("audio")).toByteArray(),
                 QByteArray("RIFF-local-audio"));
        QCOMPARE(operation->result().value(QStringLiteral("format")).toString(),
                 QStringLiteral("wav"));
        QVERIFY(requestBytes.contains("Authorization: Bearer test-key"));
        const int bodyStart = requestBytes.indexOf("\r\n\r\n") + 4;
        const QJsonObject body = QJsonDocument::fromJson(requestBytes.mid(bodyStart)).object();
        QCOMPARE(body.value(QStringLiteral("model")).toString(), QStringLiteral("piper-fr"));
        QCOMPARE(body.value(QStringLiteral("voice")).toString(), QStringLiteral("Tom"));
        QCOMPARE(body.value(QStringLiteral("input")).toString(),
                 QStringLiteral("Bonjour Starvis"));
        QCOMPARE(body.value(QStringLiteral("response_format")).toString(),
                 QStringLiteral("wav"));
    }

    void openAiCompatibleTtsCancelsTransport()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        connect(&server, &QTcpServer::newConnection, this, [&] {
            QTcpSocket* socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, socket, [socket] {
                socket->readAll();
            });
        });

        OpenAiCompatibleTTSBackend backend;
        backend.configure(QStringLiteral("http://127.0.0.1:%1/v1")
                              .arg(server.serverPort()),
                          QStringLiteral("piper-fr"));
        TtsRequest request;
        request.text = QStringLiteral("Bonjour Starvis");
        request.voice = QStringLiteral("Tom");
        BackendOperation* operation = backend.synthesize(request, this);
        QSignalSpy cancelledSpy(operation, &BackendOperation::cancelled);
        operation->cancel();
        QTRY_COMPARE_WITH_TIMEOUT(cancelledSpy.count(), 1, 2000);
        QCOMPARE(operation->state(), BackendOperation::State::Cancelled);
    }

    void streamingTextProducesSentenceSizedChunks()
    {
        StreamingTextSegmenter segmenter(12, 40);
        QVERIFY(segmenter.push(QStringLiteral("Bonjour, voici une ")).isEmpty());
        const QStringList first = segmenter.push(
            QStringLiteral("première phrase. Voici la suite"));
        QCOMPARE(first, QStringList{QStringLiteral("Bonjour, voici une première phrase.")});
        QCOMPARE(segmenter.flush(), QStringLiteral("Voici la suite"));

        const QStringList bounded = segmenter.push(
            QStringLiteral("Une très longue sortie sans ponctuation qui doit être découpée proprement"));
        QCOMPARE(bounded.size(), 1);
        QVERIFY(bounded.first().size() <= 40);
        QVERIFY(!segmenter.flush().isEmpty());
    }

    void workstationReconnectsWhenSnapshotsStop()
    {
        const QString pipeName = QStringLiteral("qt-panel-workstation-test-%1")
                                     .arg(QCoreApplication::applicationPid());
        QLocalServer::removeServer(pipeName);
        QLocalServer server;
        QVERIFY(server.listen(pipeName));

        int registrations = 0;
        bool replyToSnapshots = true;
        QList<QLocalSocket*> sockets;
        connect(&server, &QLocalServer::newConnection, this, [&] {
            while (QLocalSocket* socket = server.nextPendingConnection()) {
                sockets.append(socket);
                connect(socket, &QLocalSocket::readyRead, this, [&, socket] {
                    const QList<QByteArray> lines = socket->readAll().split('\n');
                    for (const QByteArray& line : lines) {
                        const QJsonObject request = QJsonDocument::fromJson(line.trimmed()).object();
                        const QString type = request.value(QStringLiteral("type")).toString();
                        if (type == QStringLiteral("register")) {
                            ++registrations;
                            socket->write("{\"type\":\"registered\"}\n");
                        } else if (type == QStringLiteral("snapshot") && replyToSnapshots) {
                            socket->write("{\"stale\":false,\"cpu\":{\"usagePct\":42}}\n");
                        }
                    }
                    socket->flush();
                });
            }
        });

        WorkstationClient client(nullptr, pipeName, 1200);
        client.setActive(true);
        QTRY_VERIFY_WITH_TIMEOUT(client.connected(), 1000);
        QTRY_COMPARE_WITH_TIMEOUT(
            client.snapshot().value(QStringLiteral("cpu")).toMap()
                .value(QStringLiteral("usagePct")).toInt(),
            42, 1000);

        replyToSnapshots = false;
        QTRY_VERIFY_WITH_TIMEOUT(registrations >= 2, 2800);

        replyToSnapshots = true;
        QTRY_VERIFY_WITH_TIMEOUT(client.connected(), 1000);
        QTRY_VERIFY_WITH_TIMEOUT(!client.stale(), 1500);
        client.setActive(false);
        qDeleteAll(sockets);
        QLocalServer::removeServer(pipeName);
    }

    void mojibakeRepair()
    {
        // "Québec" whose é (UTF-8 C3 A9) was decoded as cp1252 → "QuÃ©bec".
        const QString broken = QStringLiteral("Qu") + QChar(0x00C3) + QChar(0x00A9)
            + QStringLiteral("bec");
        QVERIFY(TextFix::artifactScore(broken) > 0);
        QCOMPARE(TextFix::repairMojibake(broken), QStringLiteral("Québec"));
        // Clean input is left untouched.
        QCOMPARE(TextFix::repairMojibake(QStringLiteral("Québec")), QStringLiteral("Québec"));
    }

    void cp1252Decode()
    {
        // 0x92 in cp1252 is a right single quote U+2019.
        QByteArray bytes;
        bytes.append(static_cast<char>(0x92));
        QCOMPARE(TextFix::decodeCp1252(bytes), QString(QChar(0x2019)));
    }

    // ── Starvis: auto model resolution ───────────────────────────────────
    void modelResolverPrefersTopTier()
    {
        const QJsonArray models{
            QJsonObject{{"id", "claude-sonnet-5"}, {"created_at", "2026-01-05T00:00:00Z"}},
            QJsonObject{{"id", "claude-opus-5"}, {"created_at", "2026-02-01T00:00:00Z"}},
            QJsonObject{{"id", "claude-fable-5"}, {"created_at", "2026-03-01T00:00:00Z"}},
        };
        QCOMPARE(ModelResolver::rankModels(models, ModelResolver::defaultTierPatterns()),
                 QStringLiteral("claude-fable-5"));
    }

    void modelResolverNewestWithinTier()
    {
        const QJsonArray models{
            QJsonObject{{"id", "claude-opus-5"}, {"created_at", "2026-02-01T00:00:00Z"}},
            QJsonObject{{"id", "claude-opus-6"}, {"created_at", "2026-06-01T00:00:00Z"}},
        };
        QCOMPARE(ModelResolver::rankModels(models, ModelResolver::defaultTierPatterns()),
                 QStringLiteral("claude-opus-6"));
    }

    void modelResolverSkipsDatedSnapshotWithAlias()
    {
        // The dated snapshot is newer, but its alias tracks the live revision.
        const QJsonArray models{
            QJsonObject{{"id", "claude-opus-5"}, {"created_at", "2026-02-01T00:00:00Z"}},
            QJsonObject{{"id", "claude-opus-5-20260401"}, {"created_at", "2026-04-01T00:00:00Z"}},
        };
        QCOMPARE(ModelResolver::rankModels(models, ModelResolver::defaultTierPatterns()),
                 QStringLiteral("claude-opus-5"));
        // With no alias present the snapshot is the only candidate.
        const QJsonArray orphan{
            QJsonObject{{"id", "claude-opus-7-20260501"}, {"created_at", "2026-05-01T00:00:00Z"}},
        };
        QCOMPARE(ModelResolver::rankModels(orphan, ModelResolver::defaultTierPatterns()),
                 QStringLiteral("claude-opus-7-20260501"));
    }

    void modelResolverEmptyList()
    {
        QVERIFY(ModelResolver::rankModels({}, ModelResolver::defaultTierPatterns()).isEmpty());
        // Non-Claude ids never match the tiers.
        const QJsonArray foreign{QJsonObject{{"id", "gpt-5.5"}, {"created_at", "2026-05-01"}}};
        QVERIFY(ModelResolver::rankModels(foreign, ModelResolver::defaultTierPatterns()).isEmpty());
    }

    void frontierModelCostTable()
    {
        double input = 0;
        double output = 0;
        ModelResolver::costPerMTok(QStringLiteral("gpt-5.6-terra"), input, output);
        QCOMPARE(input, 2.0);
        QCOMPARE(output, 12.0);

        ModelResolver::costPerMTok(QStringLiteral("gpt-5.6-sol"), input, output);
        QCOMPARE(input, 4.0);
        QCOMPARE(output, 20.0);

        ModelResolver::costPerMTok(QStringLiteral("gpt-5.6-luna"), input, output);
        QCOMPARE(input, 0.2);
        QCOMPARE(output, 1.2);
    }

    // ── Starvis: local motion detection ──────────────────────────────────
    void motionDetectorBaselineThenMotion()
    {
        MotionDetector detector;
        detector.setThreshold(0.02);
        detector.setCooldownMs(1000);

        QImage dark(320, 180, QImage::Format_RGB32);
        dark.fill(Qt::black);
        // The first frame only establishes the baseline.
        QVERIFY(!detector.analyze(QStringLiteral("cam"), dark, 0).motion);
        // An identical frame is not motion.
        QVERIFY(!detector.analyze(QStringLiteral("cam"), dark, 100).motion);

        QImage bright = dark;
        bright.fill(Qt::white);
        const MotionDetector::Result moved =
            detector.analyze(QStringLiteral("cam"), bright, 200);
        QVERIFY(moved.motion);
        QVERIFY(moved.score > 0.5);
    }

    void motionDetectorCooldownSuppresses()
    {
        MotionDetector detector;
        detector.setThreshold(0.02);
        detector.setCooldownMs(5000);

        QImage dark(320, 180, QImage::Format_RGB32);
        dark.fill(Qt::black);
        QImage bright = dark;
        bright.fill(Qt::white);

        detector.analyze(QStringLiteral("cam"), dark, 0);
        QVERIFY(detector.analyze(QStringLiteral("cam"), bright, 100).motion);
        // Same magnitude of change, inside the cooldown window.
        const MotionDetector::Result again =
            detector.analyze(QStringLiteral("cam"), dark, 200);
        QVERIFY(!again.motion);
        QVERIFY(again.suppressed);
        // Past the cooldown it reports again.
        QVERIFY(detector.analyze(QStringLiteral("cam"), bright, 6000).motion);
    }

    void motionDetectorZonesIgnoreOutsideChanges()
    {
        MotionDetector detector;
        detector.setThreshold(0.05);
        detector.setCooldownMs(0);
        // Watch the left quarter only.
        detector.setZones(QStringLiteral("cam"), {QRectF(0, 0, 0.25, 1)});

        QImage base(320, 180, QImage::Format_RGB32);
        base.fill(Qt::black);
        detector.analyze(QStringLiteral("cam"), base, 0);

        // Change only the right half — outside the zone.
        QImage rightChanged = base;
        {
            QPainter painter(&rightChanged);
            painter.fillRect(160, 0, 160, 180, Qt::white);
        }
        QVERIFY(!detector.analyze(QStringLiteral("cam"), rightChanged, 100).motion);

        // Now change inside the zone.
        QImage leftChanged = rightChanged;
        {
            QPainter painter(&leftChanged);
            painter.fillRect(0, 0, 80, 180, Qt::white);
        }
        QVERIFY(detector.analyze(QStringLiteral("cam"), leftChanged, 200).motion);
    }

    void focusPolicyDebounce()
    {
        FocusPolicy fp;
        fp.noteToggle();
        QVERIFY(!fp.blurMayHide());            // within toggle debounce
        QTest::qWait(220);
        QVERIFY(fp.blurMayHide());             // debounce elapsed
    }

    void focusPolicyModalGuard()
    {
        FocusPolicy fp;
        fp.noteModalOpened();
        QVERIFY(!fp.delayedCheckAllowsHide()); // modal open blocks hide
        fp.noteModalClosed();
        QVERIFY(!fp.delayedCheckAllowsHide()); // grace period right after close
    }

    void settingsRoundTrip()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(QStringLiteral("settings.json"));
        {
            SettingsStore s(path);
            s.set(QStringLiteral("wp-width"), 720);
            s.set(QStringLiteral("wp-opacity"), QStringLiteral("0.5"));
            s.flush();
        }
        SettingsStore reloaded(path);
        QCOMPARE(reloaded.getInt(QStringLiteral("wp-width"), 0), 720);
        // String-stored number coerces via getDouble (Electron-store mixes types).
        QCOMPARE(reloaded.getDouble(QStringLiteral("wp-opacity"), 1.0), 0.5);
        QCOMPARE(reloaded.getInt(QStringLiteral("missing"), 42), 42);
    }

    void pressReaderStateMachineIsBoundedAndDiagnosticSafe()
    {
        QTemporaryDir dir;
        SettingsStore settings(dir.filePath(QStringLiteral("settings.json")));
        PressReaderService pressReader(&settings, nullptr, false);
        QSignalSpy opened(&pressReader, &PressReaderService::openRequested);

        QCOMPARE(pressReader.entryUrl(), PressReaderService::defaultEntryUrl());
        pressReader.openCatalog();
        QCOMPARE(opened.count(), 1);
        QCOMPARE(pressReader.state(), QStringLiteral("opening"));
        QVERIFY(pressReader.open());

        const QVariantMap loginProbe{
            {QStringLiteral("hasLogin"), true},
            {QStringLiteral("signature"), QStringLiteral("proxy-login")},
        };
        pressReader.applyProbe(loginProbe);
        QCOMPARE(pressReader.state(), QStringLiteral("manual"));
        QVERIFY(!pressReader.claimLoginAttempt(QStringLiteral("proxy-login")));

        const QVariantMap catalogProbe{
            {QStringLiteral("url"), QStringLiteral("https://www.pressreader.com/catalog")},
            {QStringLiteral("hasSessionEvidence"), true},
        };
        pressReader.applyProbe(catalogProbe);
        QCOMPARE(pressReader.state(), QStringLiteral("catalog-ready"));
        QVERIFY(pressReader.sessionRemainingMinutes() > 47 * 60);

        const QVariantMap rejectionProbe{
            {QStringLiteral("authRejected"), true},
        };
        pressReader.applyProbe(rejectionProbe);
        QCOMPARE(pressReader.state(), QStringLiteral("rejected"));
        QVERIFY(pressReader.automationBlocked());
        pressReader.resumeAutomation();
        QVERIFY(!pressReader.automationBlocked());

        pressReader.close();
        QVERIFY(!pressReader.open());
        QCOMPARE(pressReader.state(), QStringLiteral("closed"));
    }

    void rssParse()
    {
        const QString xml = QStringLiteral(
            "<?xml version=\"1.0\"?><rss><channel>"
            "<item><title>Hello World</title><link>https://example.com/a</link>"
            "<description>Body text here that is long enough.</description>"
            "<pubDate>Wed, 02 Oct 2024 13:00:00 GMT</pubDate></item>"
            "</channel></rss>");
        const QVariantList items = NewsService::parseFeedXml(xml, QStringLiteral("https://example.com"));
        QCOMPARE(items.size(), 1);
        QCOMPARE(items.first().toMap().value(QStringLiteral("title")).toString(),
                 QStringLiteral("Hello World"));
        QCOMPARE(items.first().toMap().value(QStringLiteral("link")).toString(),
                 QStringLiteral("https://example.com/a"));
    }

    void atomParse()
    {
        const QString xml = QStringLiteral(
            "<?xml version=\"1.0\"?><feed xmlns=\"http://www.w3.org/2005/Atom\">"
            "<entry><title>Atom Item</title>"
            "<link rel=\"alternate\" href=\"https://example.com/b\"/>"
            "<summary>Summary text long enough to keep.</summary></entry></feed>");
        const QVariantList items = NewsService::parseFeedXml(xml, QStringLiteral("https://example.com"));
        QCOMPARE(items.size(), 1);
        QCOMPARE(items.first().toMap().value(QStringLiteral("link")).toString(),
                 QStringLiteral("https://example.com/b"));
    }

    void readerExtractsScoredArticle()
    {
        const QString html = QStringLiteral(
            "<html><head>"
            "<meta property=\"og:title\" content=\"Native Reader Works\">"
            "<meta property=\"og:image\" content=\"/hero.jpg\">"
            "<meta name=\"author\" content=\"Reporter Name\">"
            "</head><body>"
            "<nav><p>Subscribe to our newsletter and login.</p></nav>"
            "<section class=\"post-content\">"
            "<h2>A useful heading.</h2>"
            "<p>The first real paragraph contains enough detail to look like a"
            " readable article sentence with context and facts.</p>"
            "<p>The second real paragraph continues the story with more than"
            " enough text to survive the parser filters.</p>"
            "<img data-src=\"/photo.jpg\">"
            "<h3>Related Articles</h3>"
            "<p>This related paragraph should not be included in the reader.</p>"
            "</section>"
            "</body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/news/story"));
        const QVariantList paragraphs = article.value(QStringLiteral("paragraphs")).toList();
        const QVariantList images = article.value(QStringLiteral("images")).toList();

        QCOMPARE(article.value(QStringLiteral("title")).toString(),
                 QStringLiteral("Native Reader Works"));
        QCOMPARE(article.value(QStringLiteral("byline")).toString(),
                 QStringLiteral("Reporter Name"));
        QCOMPARE(article.value(QStringLiteral("image")).toString(),
                 QStringLiteral("https://example.com/hero.jpg"));
        QVERIFY(paragraphs.size() >= 2);
        QVERIFY(paragraphs.first().toString().contains(QStringLiteral("first real paragraph")));
        for (const QVariant& paragraph : paragraphs)
            QVERIFY(!paragraph.toString().contains(QStringLiteral("related paragraph")));
        QCOMPARE(images.first().toString(), QStringLiteral("https://example.com/hero.jpg"));
        QVERIFY(images.contains(QVariant(QStringLiteral("https://example.com/photo.jpg"))));
        QCOMPARE(article.value(QStringLiteral("fallbackUsed")).toBool(), false);
    }

    void readerFallsBackToReadableLines()
    {
        const QString html = QStringLiteral(
            "<html><body>"
            "<h1>Fallback Story</h1>"
            "<div>By Reporter Name</div>"
            "<div>This first fallback paragraph has enough sentence structure"
            " and length to be treated as useful article text.</div>"
            "<div>This second fallback paragraph adds more context and also"
            " ends like a normal sentence.</div>"
            "<div class=\"paywall\">Subscribe to continue reading.</div>"
            "</body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/fallback"));
        const QVariantList paragraphs = article.value(QStringLiteral("paragraphs")).toList();

        QCOMPARE(article.value(QStringLiteral("title")).toString(),
                 QStringLiteral("Fallback Story"));
        QVERIFY(article.value(QStringLiteral("fallbackUsed")).toBool());
        QVERIFY(article.value(QStringLiteral("paywall")).toBool());
        QCOMPARE(paragraphs.size(), 2);
        QVERIFY(paragraphs.first().toString().startsWith(QStringLiteral("This first fallback")));
    }

    void systemAppearanceIsExposed()
    {
        SystemTheme theme;
        QVERIFY(theme.accent().isValid());
        QVERIFY(theme.accent().alpha() > 0);
        const bool highContrast = theme.highContrast();
        const bool animationsEnabled = theme.animationsEnabled();
        QCOMPARE(theme.highContrast(), highContrast);
        QCOMPARE(theme.animationsEnabled(), animationsEnabled);
    }

    void readerStripsHostileMarkupAndPreservesStructure()
    {
        const QString html = QStringLiteral(
            "<html><head><title>Hostile Markup Story</title>"
            "<script>document.write('script noise that must never appear');</script>"
            "</head><body>"
            "<header><p>Header navigation that must never appear in reader output.</p></header>"
            "<article class=\"article-body\">"
            "<h2>Why native extraction needs defensive parsing.</h2>"
            "<p>The opening paragraph contains enough meaningful detail to establish"
            " the article and survive the reader quality filters.</p>"
            "<p>The second paragraph explains the implementation constraints with enough"
            " context to remain useful after chrome is removed.</p>"
            "<blockquote>This quoted observation is deliberately long enough to remain"
            " visible as part of the extracted article body.</blockquote>"
            "<ul><li>This structured list item carries a complete explanatory sentence.</li></ul>"
            "<div class=\"newsletter-promo\"><p>Newsletter promotion must be removed"
            " even though its text is long enough to resemble content.</p></div>"
            "<p>The final article paragraph confirms that noise removal does not truncate"
            " legitimate content surrounding an embedded promotion.</p>"
            "<h3>Read Next</h3>"
            "<p>This recommendation belongs outside the extracted article body.</p>"
            "</article><footer><p>Footer noise must never appear.</p></footer>"
            "</body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/hostile"));
        const QVariantList paragraphs = article.value(QStringLiteral("paragraphs")).toList();
        const QString body = [&paragraphs] {
            QStringList lines;
            for (const QVariant& paragraph : paragraphs)
                lines.append(paragraph.toString());
            return lines.join(QLatin1Char('\n'));
        }();

        QCOMPARE(article.value(QStringLiteral("title")).toString(),
                 QStringLiteral("Hostile Markup Story"));
        QVERIFY(body.contains(QStringLiteral("defensive parsing")));
        QVERIFY(body.contains(QStringLiteral("quoted observation")));
        QVERIFY(body.contains(QStringLiteral("structured list item")));
        QVERIFY(body.contains(QStringLiteral("final article paragraph")));
        QVERIFY(!body.contains(QStringLiteral("script noise")));
        QVERIFY(!body.contains(QStringLiteral("Newsletter promotion")));
        QVERIFY(!body.contains(QStringLiteral("recommendation belongs")));
        QVERIFY(!body.contains(QStringLiteral("Footer noise")));
    }

    void readerDetectsBotChallenge()
    {
        const QString html = QStringLiteral(
            "<html><head><title>Checking your browser</title></head>"
            "<body><main><h1>Checking your browser</h1>"
            "<p>Cloudflare is performing security verification before allowing access.</p>"
            "</main></body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://protected.example/story"));

        QVERIFY(!article.value(QStringLiteral("challenge")).toString().isEmpty());
        QVERIFY(!article.value(QStringLiteral("paywall")).toBool());
        QCOMPARE(article.value(QStringLiteral("source")).toString(),
                 QStringLiteral("protected.example"));
    }

    void readerResolvesFiltersAndDeduplicatesImages()
    {
        const QString html = QStringLiteral(
            "<html><head><meta property=\"og:title\" content=\"Image Story\">"
            "<meta property=\"og:image\" content=\"/media/hero.jpg\"></head><body>"
            "<article class=\"story-content\">"
            "<p>The first image story paragraph is long enough to pass all reader"
            " extraction thresholds and provide useful context.</p>"
            "<p>The second image story paragraph is similarly complete and ensures"
            " this article region is selected by the scoring logic.</p>"
            "<p>The third image story paragraph provides additional body text so the"
            " image assertions exercise the primary extraction path.</p>"
            "<img src=\"/media/hero.jpg\"><img data-src=\"../photos/detail.jpg\">"
            "<img src=\"//cdn.example.net/chart.png\"><img src=\"/assets/site-logo.svg\">"
            "<img src=\"/tracking/pixel.gif\"><img data-original=\"/media/extra.jpg\">"
            "</article></body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/news/story"));
        const QVariantList images = article.value(QStringLiteral("images")).toList();

        QCOMPARE(images.size(), 4);
        QCOMPARE(images.at(0).toString(), QStringLiteral("https://example.com/media/hero.jpg"));
        QCOMPARE(images.at(1).toString(), QStringLiteral("https://example.com/photos/detail.jpg"));
        QCOMPARE(images.at(2).toString(), QStringLiteral("https://cdn.example.net/chart.png"));
        QCOMPARE(images.at(3).toString(), QStringLiteral("https://example.com/media/extra.jpg"));
    }

    void readerSelectsLazyAndResponsiveImages()
    {
        const QString html = QStringLiteral(
            "<html><head><meta property=\"og:title\" content=\"Responsive Story\">"
            "<meta property=\"og:image\" content=\"/media/hero.jpg\"></head><body>"
            "<article class=\"story-content\">"
            "<p>The first responsive image paragraph is long enough to pass all reader"
            " extraction thresholds and provide useful article context.</p>"
            "<p>The second responsive image paragraph is similarly complete and ensures"
            " this article region is selected by the scoring logic.</p>"
            "<p>The third responsive image paragraph supplies enough body text for the"
            " image assertions to exercise the primary extraction path.</p>"
            "<img src=\"/images/placeholder.jpg\" data-lazy-src=\"/photos/lazy.jpg\">"
            "<img src=\"/photos/small.jpg\" srcset=\"/photos/small.jpg 320w, /photos/large.jpg 1280w\">"
            "<img data-srcset=\"//cdn.example.net/chart.jpg 1x, //cdn.example.net/chart@2x.jpg 2x\">"
            "<picture><source srcset=\"/photos/wide-small.webp 640w, /photos/wide.webp 1600w\">"
            "<img src=\"/photos/wide-fallback.jpg\"></picture>"
            "</article></body></html>");

        const QVariantMap article = ReaderService::extractArticleHtml(
            html, QStringLiteral("https://example.com/news/story"));
        const QVariantList images = article.value(QStringLiteral("images")).toList();

        QCOMPARE(images.size(), 5);
        QCOMPARE(images.at(0).toString(), QStringLiteral("https://example.com/media/hero.jpg"));
        QCOMPARE(images.at(1).toString(), QStringLiteral("https://example.com/photos/lazy.jpg"));
        QCOMPARE(images.at(2).toString(), QStringLiteral("https://example.com/photos/large.jpg"));
        QCOMPARE(images.at(3).toString(), QStringLiteral("https://cdn.example.net/chart@2x.jpg"));
        QCOMPARE(images.at(4).toString(), QStringLiteral("https://example.com/photos/wide.webp"));
    }

    void liveFeedCatalogMatchesRendererSources()
    {
        HttpClient http;
        LiveFeedService live(&http);

        QCOMPARE(live.feedIds(), QStringList({
            QStringLiteral("live-bloomberg"),
            QStringLiteral("live-radio-canada"),
            QStringLiteral("live-france24"),
            QStringLiteral("live-cbc-news"),
            QStringLiteral("live-lcn"),
            QStringLiteral("euronews"),
        }));
        QVERIFY(!live.isYouTube(QStringLiteral("live-bloomberg")));
        QCOMPARE(live.videoId(QStringLiteral("live-bloomberg")),
                 QStringLiteral("QB5BNdBFujE"));
        QCOMPARE(live.videoId(QStringLiteral("live-france24")),
                 QStringLiteral("HvZt-nh9sGg"));
        QCOMPARE(live.sourceLabel(QStringLiteral("live-bloomberg")), QStringLiteral("HLS"));
        QCOMPARE(live.sourceLabel(QStringLiteral("live-radio-canada")), QStringLiteral("HLS"));
        QCOMPARE(live.sourceLabel(QStringLiteral("live-lcn")), QStringLiteral("HLS"));
        QCOMPARE(live.webUrl(QStringLiteral("live-cbc-news")),
                 QStringLiteral("https://www.cbc.ca/player/play/video/9.4766516"));
        QCOMPARE(live.webUrl(QStringLiteral("euronews")),
                 QStringLiteral("https://www.euronews.com/live"));
    }

    void liveAudioOwnerRejectsUnknownFeeds()
    {
        HttpClient http;
        LiveFeedService live(&http);
        QSignalSpy changed(&live, &LiveFeedService::audioFeedIdChanged);

        live.requestAudio(QStringLiteral("not-a-feed"));
        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(changed.count(), 0);

        live.requestAudio(QStringLiteral("euronews"));
        QCOMPARE(live.audioFeedId(), QStringLiteral("euronews"));
        QCOMPARE(changed.count(), 1);
        live.requestAudio(QString());
        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(changed.count(), 2);
    }

    void liveShutdownIsIdempotent()
    {
        HttpClient http;
        LiveFeedService live(&http);
        QSignalSpy audioChanged(&live, &LiveFeedService::audioFeedIdChanged);
        QSignalSpy shutdownRequested(&live, &LiveFeedService::shutdownRequested);
        QSignalSpy resolved(&live, &LiveFeedService::feedResolved);

        live.requestAudio(QStringLiteral("euronews"));
        live.prepareShutdown();
        live.prepareShutdown();
        live.resolve(QStringLiteral("euronews"));

        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(audioChanged.count(), 2);
        QCOMPARE(shutdownRequested.count(), 1);
        QCOMPARE(resolved.count(), 0);
    }

    void liveDetailAcceptsOnlyNativeHlsFeeds()
    {
        HttpClient http;
        LiveFeedService live(&http);
        QSignalSpy detailChanged(&live, &LiveFeedService::detailChanged);

        QVERIFY(!live.openDetail(QStringLiteral("not-a-feed")));
        QVERIFY(!live.openDetail(QStringLiteral("live-radio-canada")));
        QVERIFY(live.openDetail(QStringLiteral("live-bloomberg")));
        QVERIFY(live.detailOpen());
        live.closeDetail();
        QCOMPARE(detailChanged.count(), 2);

        QVERIFY(live.openDetail(QStringLiteral("euronews")));
        QVERIFY(live.detailOpen());
        QCOMPARE(live.detailFeedId(), QStringLiteral("euronews"));
        QVERIFY(live.detailUrl().endsWith(QStringLiteral("playlist.m3u8")));
        QCOMPARE(detailChanged.count(), 3);

        live.requestAudio(QStringLiteral("euronews"));
        QCOMPARE(live.audioFeedId(), QStringLiteral("euronews"));
        live.closeDetail();
        QVERIFY(!live.detailOpen());
        QCOMPARE(live.detailFeedId(), QString());
        QCOMPARE(live.detailUrl(), QString());
        QCOMPARE(live.audioFeedId(), QString());
        QCOMPARE(detailChanged.count(), 4);
    }
};

QTEST_MAIN(TestQtPanel)
#include "test_qtpanel.moc"
