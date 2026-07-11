#include "StarvisService.h"

#include "core/HttpClient.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"
#include "services/news/NewsService.h"
#include "services/stocks/StocksModel.h"
#include "services/weather/WeatherService.h"
#include "services/workstation/WorkstationClient.h"

#include <QAudioOutput>
#include <QDateTime>
#include <QDebug>
#include <QDesktopServices>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMediaPlayer>
#include <QProcess>
#include <QStandardPaths>
#include <QUrl>
#include <QUuid>

namespace qtpanel {

namespace {

const char kDefaultModel[] = "gpt-5.5";
const char kDefaultBaseUrl[] = "https://api.openai.com/v1";

// STARVIS_SYSTEM_PROMPT from main.js; native agent tools are appended per request.
const char kSystemPrompt[] =
    "You are Starvis, an embedded assistant inside the Widget Panel desktop app.\n"
    "Default behavior is ChatGPT-like: answer naturally, reason clearly, and adapt to the user. "
    "Avoid theatrical command-center roleplay unless the user asks for that style.\n"
    "Be concise by default, but give complete technical answers when the task requires detail.\n"
    "Use supplied local widget-panel context when relevant. Treat it as a bounded local snapshot, "
    "not full filesystem or renderer access.\n"
    "For dashboard/report requests, synthesize. Do not dump every metric or headline unless asked.\n"
    "For news, group related headlines into themes and implications; mention only the most "
    "important examples.\n"
    "If the user asks for current, live, scheduled, price, weather, sports, news, or other "
    "time-sensitive data that is not present in local context and web search is disabled, reply "
    "exactly: INTERNET_PERMISSION_REQUEST: I need web access to check that live data. "
    "May I fetch it?";

// Port of extractResponseText(): first output_text inside a message item.
QString extractResponseText(const QJsonObject& payload)
{
    const QJsonArray output = payload.value(QLatin1String("output")).toArray();
    for (const QJsonValue& itemValue : output) {
        const QJsonObject item = itemValue.toObject();
        if (item.value(QLatin1String("type")).toString() != QLatin1String("message"))
            continue;
        const QJsonArray content = item.value(QLatin1String("content")).toArray();
        for (const QJsonValue& partValue : content) {
            const QJsonObject part = partValue.toObject();
            if (part.value(QLatin1String("type")).toString() == QLatin1String("output_text"))
                return part.value(QLatin1String("text")).toString();
        }
    }
    return {};
}

bool supportsTemperature(const QString& model)
{
    // Reasoning model families reject the temperature parameter.
    return !(model.startsWith(QLatin1String("gpt-5"))
             || model.startsWith(QLatin1String("o1"))
             || model.startsWith(QLatin1String("o3"))
             || model.startsWith(QLatin1String("o4")));
}

} // namespace

StarvisService::StarvisService(SettingsStore* settings, SecretVault* vault, HttpClient* http,
                               WeatherService* weather, StocksModel* stocks,
                               NewsService* news, WorkstationClient* workstation,
                               QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_http(http)
    , m_weather(weather)
    , m_stocks(stocks)
    , m_news(news)
    , m_workstation(workstation)
{
    loadActions();
    connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
        if (key == QLatin1String("starvis-openai-key"))
            emit configuredChanged();
    });
    connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
        if (key == QLatin1String("wp-starvis-config"))
            emit configuredChanged();
    });
    qInfo() << "[starvis]" << (configured() ? "configured, model:" + model()
                                            : QStringLiteral("no API key stored"));
}

QString StarvisService::apiKey() const
{
    return m_vault->get(QStringLiteral("starvis-openai-key")).trimmed();
}

bool StarvisService::configured() const
{
    return !apiKey().isEmpty();
}

QVariantMap StarvisService::config() const
{
    const QVariant raw = m_settings->get(QStringLiteral("wp-starvis-config"));
    if (raw.metaType().id() == QMetaType::QString) {
        const QJsonDocument doc = QJsonDocument::fromJson(raw.toString().toUtf8());
        if (doc.isObject())
            return doc.object().toVariantMap();
    } else if (raw.canConvert<QVariantMap>()) {
        return raw.toMap();
    }
    return {};
}

QString StarvisService::model() const
{
    const QString stored = config().value(QStringLiteral("model")).toString().trimmed();
    return stored.isEmpty() ? QLatin1String(kDefaultModel) : stored;
}

QString StarvisService::buildContextBlock() const
{
    QStringList lines;
    lines << QStringLiteral("Local widget-panel context snapshot (%1):")
                 .arg(QDateTime::currentDateTime().toString(Qt::ISODate));

    if (m_weather && m_weather->ready()) {
        const QVariantMap current = m_weather->current();
        lines << QStringLiteral("- Weather %1: %2°C (feels %3°C), %4, humidity %5%, wind %6 km/h")
                     .arg(m_weather->locationName())
                     .arg(qRound(current.value(QStringLiteral("tempC")).toDouble()))
                     .arg(qRound(current.value(QStringLiteral("apparentC")).toDouble()))
                     .arg(current.value(QStringLiteral("label")).toString())
                     .arg(qRound(current.value(QStringLiteral("humidityPct")).toDouble()))
                     .arg(qRound(current.value(QStringLiteral("windKmh")).toDouble()));
    }

    if (m_stocks && m_stocks->rowCount() > 0) {
        QStringList quotes;
        for (int i = 0; i < m_stocks->rowCount(); ++i) {
            const QModelIndex idx = m_stocks->index(i);
            if (!m_stocks->data(idx, StocksModel::HasDataRole).toBool())
                continue;
            quotes << QStringLiteral("%1 %2 (%3%4%)")
                          .arg(m_stocks->data(idx, StocksModel::DisplayRole).toString())
                          .arg(m_stocks->data(idx, StocksModel::PriceRole).toDouble(), 0, 'f', 1)
                          .arg(m_stocks->data(idx, StocksModel::UpRole).toBool()
                                   ? QStringLiteral("+") : QString())
                          .arg(m_stocks->data(idx, StocksModel::PctRole).toDouble(), 0, 'f', 2);
        }
        if (!quotes.isEmpty())
            lines << QStringLiteral("- Markets: ") + quotes.join(QStringLiteral(" | "));
    }

    if (m_workstation && m_workstation->connected()) {
        const QVariantMap snap = m_workstation->snapshot();
        const QVariantMap cpu = snap.value(QStringLiteral("cpu")).toMap();
        const QVariantMap gpu = snap.value(QStringLiteral("gpu")).toMap();
        const QVariantMap ram = snap.value(QStringLiteral("ram")).toMap();
        lines << QStringLiteral("- Workstation: CPU %1%% %2C | GPU %3%% %4C | RAM %5%%")
                     .arg(qRound(cpu.value(QStringLiteral("usagePct")).toDouble()))
                     .arg(qRound(cpu.value(QStringLiteral("temperatureC")).toDouble()))
                     .arg(qRound(gpu.value(QStringLiteral("usagePct")).toDouble()))
                     .arg(qRound(gpu.value(QStringLiteral("temperatureC")).toDouble()))
                     .arg(qRound(ram.value(QStringLiteral("usedPct")).toDouble()));
    }

    if (m_news) {
        int categoriesIncluded = 0;
        for (const QVariant& labelVar : m_news->categories()) {
            if (categoriesIncluded >= 5)
                break;
            const QString label = labelVar.toString();
            const QVariantList items = m_news->itemsFor(label);
            if (items.isEmpty())
                continue;
            QStringList headlines;
            for (int i = 0; i < items.size() && i < 3; ++i)
                headlines << items.at(i).toMap().value(QStringLiteral("title")).toString();
            lines << QStringLiteral("- News [%1]: %2").arg(label, headlines.join(QStringLiteral(" / ")));
            ++categoriesIncluded;
        }
    }

    return lines.join(QLatin1Char('\n'));
}

void StarvisService::setBusy(bool busy)
{
    if (m_busy == busy)
        return;
    m_busy = busy;
    emit busyChanged();
}

bool StarvisService::speaking() const
{
    return m_ttsPlayer && m_ttsPlayer->playbackState() == QMediaPlayer::PlayingState;
}

void StarvisService::stopSpeaking()
{
    if (m_ttsPlayer)
        m_ttsPlayer->stop();
}

void StarvisService::speak(const QString& text)
{
    const QString key = apiKey();
    const QString clean = text.trimmed();
    if (key.isEmpty() || clean.isEmpty())
        return;
    if (speaking()) {
        stopSpeaking();
        return;
    }

    const QVariantMap cfg = config();
    QString ttsModel = cfg.value(QStringLiteral("ttsModel")).toString().trimmed();
    if (ttsModel.isEmpty())
        ttsModel = QStringLiteral("gpt-4o-mini-tts");
    QString voice = cfg.value(QStringLiteral("ttsVoice")).toString().trimmed();
    if (voice.isEmpty())
        voice = QStringLiteral("alloy");

    const QJsonObject body{
        {QStringLiteral("model"), ttsModel},
        {QStringLiteral("voice"), voice},
        {QStringLiteral("input"), clean.left(3600)},
        {QStringLiteral("response_format"), QStringLiteral("mp3")},
    };
    const QString baseUrl = [this] {
        QString url = config().value(QStringLiteral("baseUrl")).toString().trimmed();
        if (url.isEmpty())
            url = QLatin1String(kDefaultBaseUrl);
        while (url.endsWith(QLatin1Char('/')))
            url.chop(1);
        return url;
    }();

    m_http->postForBytes(QUrl(baseUrl + QStringLiteral("/audio/speech")), key,
                         QJsonDocument(body).toJson(QJsonDocument::Compact), this,
                         [this](const QByteArray& bytes, int status, const QString& error) {
        if (status < 200 || status >= 300 || bytes.isEmpty()) {
            qWarning() << "[starvis] tts failed:" << status << error;
            return;
        }
        const QString path = QStandardPaths::writableLocation(QStandardPaths::TempLocation)
            + QStringLiteral("/qt-panel-tts.mp3");
        QFile file(path);
        if (!file.open(QIODevice::WriteOnly)) {
            qWarning() << "[starvis] tts temp write failed:" << path;
            return;
        }
        file.write(bytes);
        file.close();

        if (!m_ttsPlayer) {
            m_ttsPlayer = new QMediaPlayer(this);
            m_ttsAudio = new QAudioOutput(this);
            m_ttsAudio->setVolume(0.85f);
            m_ttsPlayer->setAudioOutput(m_ttsAudio);
            connect(m_ttsPlayer, &QMediaPlayer::playbackStateChanged,
                    this, &StarvisService::speakingChanged);
        }
        m_ttsPlayer->setSource(QUrl()); // force reload of the same file path
        m_ttsPlayer->setSource(QUrl::fromLocalFile(path));
        m_ttsPlayer->play();
        qInfo() << "[starvis] tts playing," << bytes.size() << "bytes";
    });
}

void StarvisService::chat(const QString& message, const QVariantList& history,
                          bool allowInternet, bool allowAgent)
{
    if (message.trimmed().isEmpty() || m_busy)
        return;
    post(message, history, allowInternet, allowAgent);
}

void StarvisService::briefing()
{
    if (m_busy)
        return;
    post(QStringLiteral(
             "Donne-moi un briefing matinal concis à partir du contexte local: météo, marchés, "
             "thèmes principaux des nouvelles, et état de la station. En français, structuré, "
             "sans détailler chaque métrique."),
         {}, false, false);
}

void StarvisService::post(const QString& userMessage, const QVariantList& history,
                          bool allowInternet, bool allowAgent)
{
    const QString key = apiKey();
    if (key.isEmpty()) {
        emit chatFailed(QStringLiteral("Clé OpenAI absente (wp-starvis-openai-key)."));
        return;
    }
    setBusy(true);
    const qint64 started = QDateTime::currentMSecsSinceEpoch();

    const QVariantMap cfg = config();
    const QString chatModel = model();
    const QString baseUrl = [&cfg] {
        QString url = cfg.value(QStringLiteral("baseUrl")).toString().trimmed();
        if (url.isEmpty())
            url = QLatin1String(kDefaultBaseUrl);
        while (url.endsWith(QLatin1Char('/')))
            url.chop(1);
        return url;
    }();
    const int maxTokens = qBound(128, cfg.value(QStringLiteral("maxTokens"), 1800).toInt(), 8192);

    QJsonArray input;
    input.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), QStringLiteral("Context (do not echo back):\n") + buildContextBlock()},
    });
    for (const QVariant& turnVar : history) {
        const QVariantMap turn = turnVar.toMap();
        const QString role = turn.value(QStringLiteral("role")).toString();
        const QString text = turn.value(QStringLiteral("text")).toString();
        if (text.isEmpty())
            continue;
        input.append(QJsonObject{
            {QStringLiteral("role"),
             role == QLatin1String("assistant") ? QStringLiteral("assistant") : QStringLiteral("user")},
            {QStringLiteral("content"), text},
        });
    }
    input.append(QJsonObject{
        {QStringLiteral("role"), QStringLiteral("user")},
        {QStringLiteral("content"), userMessage},
    });

    if (allowAgent) {
        runAgentTurn(input, allowInternet, 0, started);
        return;
    }

    QJsonObject body{
        {QStringLiteral("model"), chatModel},
        {QStringLiteral("instructions"), QLatin1String(kSystemPrompt)},
        {QStringLiteral("input"), input},
        {QStringLiteral("max_output_tokens"), maxTokens},
        {QStringLiteral("reasoning"), QJsonObject{{QStringLiteral("effort"), QStringLiteral("medium")}}},
    };
    if (supportsTemperature(chatModel) && cfg.contains(QStringLiteral("temperature")))
        body.insert(QStringLiteral("temperature"), cfg.value(QStringLiteral("temperature")).toDouble());
    if (allowInternet) {
        body.insert(QStringLiteral("tools"), QJsonArray{
            QJsonObject{{QStringLiteral("type"), QStringLiteral("web_search_preview")}}});
    }

    m_http->requestJsonAuth(
        "POST", QUrl(baseUrl + QStringLiteral("/responses")), key,
        QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this, chatModel, started](const QJsonDocument& doc, int status, const QString& error) {
        setBusy(false);
        const QJsonObject payload = doc.object();
        if (status < 200 || status >= 300) {
            const QString detail = payload.value(QLatin1String("error")).toObject()
                                       .value(QLatin1String("message")).toString();
            const QString message = !detail.isEmpty() ? detail
                : !error.isEmpty() ? error
                : QStringLiteral("OpenAI request failed (%1)").arg(status);
            qWarning() << "[starvis] chat failed:" << status << message;
            emit chatFailed(message);
            return;
        }
        const QString text = extractResponseText(payload);
        const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
        qInfo() << "[starvis] reply" << payload.value(QLatin1String("model")).toString()
                << latency << "ms," << text.size() << "chars";
        emit replyReceived(text.isEmpty() ? QStringLiteral("Command acknowledged.") : text,
                           payload.value(QLatin1String("model")).toString(chatModel), latency);
    });
}

// ── Agent mode: tool loop + read-only tools + action approval queue ───────────

QJsonArray StarvisService::agentTools() const
{
    auto fn = [](const char* name, const char* desc, QJsonObject props,
                 QJsonArray required) {
        return QJsonObject{
            {QStringLiteral("type"), QStringLiteral("function")},
            {QStringLiteral("name"), QLatin1String(name)},
            {QStringLiteral("description"), QLatin1String(desc)},
            {QStringLiteral("parameters"), QJsonObject{
                {QStringLiteral("type"), QStringLiteral("object")},
                {QStringLiteral("properties"), props},
                {QStringLiteral("required"), required},
            }},
        };
    };
    auto strProp = [](const char* d) {
        return QJsonObject{{QStringLiteral("type"), QStringLiteral("string")},
                           {QStringLiteral("description"), QLatin1String(d)}};
    };

    QJsonArray tools;
    tools.append(fn("ws_list", "List files in a workspace directory (read-only).",
                    {{QStringLiteral("path"), strProp("Relative directory, default '.'")}}, {}));
    tools.append(fn("ws_read", "Read a workspace text file (read-only, truncated).",
                    {{QStringLiteral("path"), strProp("Relative file path")}},
                    {QStringLiteral("path")}));
    tools.append(fn("ws_search", "Search workspace file contents (read-only).",
                    {{QStringLiteral("query"), strProp("Substring to find")}},
                    {QStringLiteral("query")}));
    tools.append(fn("git_status", "Show git status of the workspace (read-only).", {}, {}));
    tools.append(fn("git_diff", "Show git diff of the workspace (read-only).", {}, {}));
    tools.append(fn("propose_action",
                    "Propose a side-effecting action for the user to approve. NOT executed "
                    "automatically. actionType: file_edit|command|git_commit|git_push|open_url.",
                    {
                        {QStringLiteral("actionType"), strProp("file_edit|command|git_commit|git_push|open_url")},
                        {QStringLiteral("summary"), strProp("One-line human summary")},
                        {QStringLiteral("path"), strProp("Target path (file_edit)")},
                        {QStringLiteral("content"), strProp("New file content (file_edit)")},
                        {QStringLiteral("command"), strProp("Command base (command)")},
                        {QStringLiteral("args"), QJsonObject{
                            {QStringLiteral("type"), QStringLiteral("array")},
                            {QStringLiteral("items"), QJsonObject{{QStringLiteral("type"), QStringLiteral("string")}}}}},
                        {QStringLiteral("url"), strProp("URL (open_url)")},
                        {QStringLiteral("message"), strProp("Commit message (git_commit)")},
                    },
                    {QStringLiteral("actionType"), QStringLiteral("summary")}));
    return tools;
}

void StarvisService::runAgentTurn(const QJsonArray& input, bool allowInternet, int loop,
                                  qint64 started)
{
    const QString key = apiKey();
    const QVariantMap cfg = config();
    const QString chatModel = model();
    QString baseUrl = cfg.value(QStringLiteral("baseUrl")).toString().trimmed();
    if (baseUrl.isEmpty())
        baseUrl = QLatin1String(kDefaultBaseUrl);
    while (baseUrl.endsWith(QLatin1Char('/')))
        baseUrl.chop(1);

    QJsonArray tools = agentTools();
    if (allowInternet)
        tools.append(QJsonObject{{QStringLiteral("type"), QStringLiteral("web_search_preview")}});

    QJsonObject body{
        {QStringLiteral("model"), chatModel},
        {QStringLiteral("instructions"), QLatin1String(kSystemPrompt)},
        {QStringLiteral("input"), input},
        {QStringLiteral("tools"), tools},
        {QStringLiteral("max_output_tokens"),
         qBound(128, cfg.value(QStringLiteral("maxTokens"), 1800).toInt(), 8192)},
        {QStringLiteral("reasoning"), QJsonObject{{QStringLiteral("effort"), QStringLiteral("medium")}}},
    };

    m_http->requestJsonAuth(
        "POST", QUrl(baseUrl + QStringLiteral("/responses")), key,
        QJsonDocument(body).toJson(QJsonDocument::Compact), this,
        [this, input, allowInternet, loop, started, chatModel]
        (const QJsonDocument& doc, int status, const QString& error) {
        const QJsonObject payload = doc.object();
        if (status < 200 || status >= 300) {
            setBusy(false);
            const QString detail = payload.value(QLatin1String("error")).toObject()
                                       .value(QLatin1String("message")).toString();
            emit chatFailed(!detail.isEmpty() ? detail
                            : !error.isEmpty() ? error
                            : QStringLiteral("Agent request failed (%1)").arg(status));
            return;
        }

        // Collect function calls from the output.
        QJsonArray nextInput = input;
        QJsonArray calls;
        for (const QJsonValue& v : payload.value(QLatin1String("output")).toArray()) {
            const QJsonObject item = v.toObject();
            if (item.value(QLatin1String("type")).toString() == QLatin1String("function_call"))
                calls.append(item);
        }

        if (!calls.isEmpty() && loop < kMaxToolLoops) {
            for (const QJsonValue& cv : calls) {
                const QJsonObject call = cv.toObject();
                const QString name = call.value(QLatin1String("name")).toString();
                const QJsonObject args = QJsonDocument::fromJson(
                    call.value(QLatin1String("arguments")).toString().toUtf8()).object();

                QString output;
                if (name == QLatin1String("propose_action")) {
                    queueAction(name, args);
                    output = QStringLiteral("Proposed and queued for user approval.");
                } else {
                    bool handled = false;
                    output = executeReadOnlyTool(name, args, handled);
                    if (!handled)
                        output = QStringLiteral("Unknown tool.");
                }
                nextInput.append(call); // echo the call back
                nextInput.append(QJsonObject{
                    {QStringLiteral("type"), QStringLiteral("function_call_output")},
                    {QStringLiteral("call_id"), call.value(QLatin1String("call_id"))},
                    {QStringLiteral("output"), output.left(8000)},
                });
            }
            runAgentTurn(nextInput, allowInternet, loop + 1, started);
            return;
        }

        setBusy(false);
        const QString text = extractResponseText(payload);
        const int latency = static_cast<int>(QDateTime::currentMSecsSinceEpoch() - started);
        qInfo() << "[starvis] agent reply, loop" << loop << latency << "ms";
        emit replyReceived(text.isEmpty() ? QStringLiteral("Done.") : text,
                           payload.value(QLatin1String("model")).toString(chatModel), latency);
    });
}

QString StarvisService::workspaceRoot() const
{
    const QString stored = m_settings->get(QStringLiteral("wp-starvis-workspace")).toString();
    if (!stored.isEmpty())
        return stored;
    return QStringLiteral("C:/Users/nicol/source/repos/widget-panel");
}

bool StarvisService::resolveInWorkspace(const QString& rel, QString& absOut) const
{
    const QDir root(workspaceRoot());
    const QString abs = QDir::cleanPath(root.absoluteFilePath(rel.isEmpty() ? QStringLiteral(".") : rel));
    const QString rootAbs = QDir::cleanPath(root.absolutePath());
    if (abs.compare(rootAbs, Qt::CaseInsensitive) != 0
        && !abs.startsWith(rootAbs + QLatin1Char('/'), Qt::CaseInsensitive))
        return false; // path traversal guard
    // Skip noisy/ignored dirs.
    static const QStringList ignore = {QStringLiteral("/.git/"), QStringLiteral("/node_modules/"),
        QStringLiteral("/build/"), QStringLiteral("/dist/"), QStringLiteral("/.vs/")};
    for (const QString& ig : ignore)
        if ((abs + QStringLiteral("/")).contains(ig))
            return false;
    absOut = abs;
    return true;
}

QString StarvisService::executeReadOnlyTool(const QString& name, const QJsonObject& args,
                                            bool& handled)
{
    handled = true;
    if (name == QLatin1String("ws_list")) {
        QString abs;
        if (!resolveInWorkspace(args.value(QLatin1String("path")).toString(), abs))
            return QStringLiteral("Path not allowed.");
        QStringList out;
        const QDir dir(abs);
        const auto entries = dir.entryInfoList(QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot,
                                               QDir::Name);
        for (const QFileInfo& fi : entries) {
            if (out.size() >= 200) break;
            out << (fi.isDir() ? fi.fileName() + QStringLiteral("/") : fi.fileName());
        }
        return out.join(QLatin1Char('\n'));
    }
    if (name == QLatin1String("ws_read")) {
        QString abs;
        if (!resolveInWorkspace(args.value(QLatin1String("path")).toString(), abs))
            return QStringLiteral("Path not allowed.");
        QFile f(abs);
        if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
            return QStringLiteral("Cannot read file.");
        return QString::fromUtf8(f.read(16000));
    }
    if (name == QLatin1String("ws_search")) {
        const QString query = args.value(QLatin1String("query")).toString();
        if (query.isEmpty())
            return QStringLiteral("Empty query.");
        QStringList hits;
        QDirIterator it(workspaceRoot(),
                        {QStringLiteral("*.cpp"), QStringLiteral("*.h"), QStringLiteral("*.qml"),
                         QStringLiteral("*.js"), QStringLiteral("*.json"), QStringLiteral("*.md")},
                        QDir::Files, QDirIterator::Subdirectories);
        while (it.hasNext() && hits.size() < 40) {
            const QString path = it.next();
            QString abs;
            if (!resolveInWorkspace(QDir(workspaceRoot()).relativeFilePath(path), abs))
                continue;
            QFile f(path);
            if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
                continue;
            int line = 0;
            while (!f.atEnd() && hits.size() < 40) {
                ++line;
                const QString text = QString::fromUtf8(f.readLine());
                if (text.contains(query, Qt::CaseInsensitive))
                    hits << QStringLiteral("%1:%2: %3")
                                .arg(QDir(workspaceRoot()).relativeFilePath(path))
                                .arg(line).arg(text.trimmed().left(160));
            }
        }
        return hits.isEmpty() ? QStringLiteral("No matches.") : hits.join(QLatin1Char('\n'));
    }
    if (name == QLatin1String("git_status") || name == QLatin1String("git_diff")) {
        QProcess git;
        git.setWorkingDirectory(workspaceRoot());
        git.start(QStringLiteral("git"),
                  {name == QLatin1String("git_status") ? QStringLiteral("status")
                                                       : QStringLiteral("diff"),
                   QStringLiteral("--no-color")});
        if (!git.waitForFinished(4000))
            return QStringLiteral("git timed out.");
        return QString::fromUtf8(git.readAllStandardOutput()).left(8000);
    }
    handled = false;
    return {};
}

// Port of evaluateStarvisActionPolicy (main.js).
QVariantMap StarvisService::evaluatePolicy(const QVariantMap& action) const
{
    auto blocked = [](const QString& r) {
        return QVariantMap{{QStringLiteral("allowed"), false}, {QStringLiteral("reason"), r},
                           {QStringLiteral("severity"), QStringLiteral("blocked")}};
    };
    auto allowed = [](const QString& r) {
        return QVariantMap{{QStringLiteral("allowed"), true}, {QStringLiteral("reason"), r},
                           {QStringLiteral("severity"), QStringLiteral("review")}};
    };
    static const QStringList unsafeTokens = {QStringLiteral("&"), QStringLiteral("|"),
        QStringLiteral(";"), QStringLiteral("`"), QStringLiteral("$("), QStringLiteral(">"),
        QStringLiteral("<"), QStringLiteral("\n")};
    auto hasUnsafe = [](const QString& s) {
        for (const QString& t : unsafeTokens)
            if (s.contains(t)) return true;
        return false;
    };

    const QString type = action.value(QStringLiteral("actionType")).toString();
    if (type == QLatin1String("command")) {
        const QString cmd = action.value(QStringLiteral("command")).toString();
        const QStringList args = action.value(QStringLiteral("args")).toStringList();
        static const QStringList allow = {QStringLiteral("npm"), QStringLiteral("node"),
                                          QStringLiteral("git")};
        if (!allow.contains(cmd)) return blocked(QStringLiteral("Command \"%1\" not on allowlist.").arg(cmd));
        if (hasUnsafe(cmd) || std::any_of(args.begin(), args.end(), hasUnsafe))
            return blocked(QStringLiteral("Command contains shell metacharacters."));
        if (cmd == QLatin1String("npm")) {
            if (args.value(0) == QLatin1String("run") && !args.value(1).isEmpty())
                return allowed(QStringLiteral("npm run script — review the script name."));
            if (args.value(0) == QLatin1String("test")) return allowed(QStringLiteral("npm test."));
            return blocked(QStringLiteral("Only 'npm run <script>' and 'npm test' allowed."));
        }
        if (cmd == QLatin1String("git")) {
            static const QStringList ro = {QStringLiteral("status"), QStringLiteral("diff"),
                QStringLiteral("log"), QStringLiteral("show"), QStringLiteral("branch")};
            if (!ro.contains(args.value(0)))
                return blocked(QStringLiteral("Mutating git must use a dedicated action type."));
            return allowed(QStringLiteral("Read-only git command."));
        }
        if (cmd == QLatin1String("node")) {
            QString script;
            if (args.isEmpty() || !resolveInWorkspace(args.first(), script))
                return blocked(QStringLiteral("Node command needs a workspace script."));
            static const QStringList scriptSuffixes = {
                QStringLiteral("js"), QStringLiteral("mjs"), QStringLiteral("cjs")};
            if (!scriptSuffixes.contains(QFileInfo(script).suffix().toLower()))
                return blocked(QStringLiteral("Node command only allows JavaScript files."));
            return allowed(QStringLiteral("Node workspace script after approval."));
        }
        return allowed(QStringLiteral("Node workspace script — review before approving."));
    }
    if (type == QLatin1String("file_edit")) {
        QString abs;
        if (!resolveInWorkspace(action.value(QStringLiteral("path")).toString(), abs))
            return blocked(QStringLiteral("File path is outside the workspace or ignored."));
        static const QStringList protectedNames = {
            QStringLiteral(".env"), QStringLiteral("credentials.json"),
            QStringLiteral("id_rsa"), QStringLiteral("id_ed25519")};
        static const QStringList protectedSuffixes = {
            QStringLiteral("exe"), QStringLiteral("dll"), QStringLiteral("pfx"),
            QStringLiteral("p12"), QStringLiteral("pem"), QStringLiteral("key"),
            QStringLiteral("db"), QStringLiteral("sqlite")};
        const QFileInfo target(abs);
        if (protectedNames.contains(target.fileName().toLower())
            || protectedSuffixes.contains(target.suffix().toLower()))
            return blocked(QStringLiteral("File edit targets a protected or binary file."));
        const QString content = action.value(QStringLiteral("content")).toString();
        if (content.isEmpty()) return blocked(QStringLiteral("Missing replacement content."));
        if (content.contains(QChar::Null)) return blocked(QStringLiteral("Content appears binary."));
        if (content.size() > 200000) return blocked(QStringLiteral("Content too large."));
        return allowed(QStringLiteral("Text file write after approval."));
    }
    if (type == QLatin1String("git_commit")) {
        if (action.value(QStringLiteral("message")).toString().trimmed().isEmpty())
            return blocked(QStringLiteral("Git commit is missing a message."));
        const QStringList paths = action.value(QStringLiteral("args")).toStringList();
        if (paths.isEmpty())
            return blocked(QStringLiteral("Git commit needs explicit workspace paths."));
        for (const QString& path : paths) {
            QString abs;
            if (!resolveInWorkspace(path, abs))
                return blocked(QStringLiteral("Git commit path is not allowed: %1").arg(path));
            static const QStringList protectedSuffixes = {
                QStringLiteral("pfx"), QStringLiteral("p12"), QStringLiteral("pem"),
                QStringLiteral("key"), QStringLiteral("db"), QStringLiteral("sqlite")};
            const QFileInfo target(abs);
            if (target.fileName().compare(QStringLiteral(".env"), Qt::CaseInsensitive) == 0
                || protectedSuffixes.contains(target.suffix().toLower()))
                return blocked(QStringLiteral("Git commit path is protected: %1").arg(path));
        }
        return allowed(QStringLiteral("Git commit after approval."));
    }
    if (type == QLatin1String("git_push")) {
        const QStringList args = action.value(QStringLiteral("args")).toStringList();
        if (std::any_of(args.begin(), args.end(), hasUnsafe))
            return blocked(QStringLiteral("Git push target contains unsafe characters."));
        return QVariantMap{{QStringLiteral("allowed"), true},
                           {QStringLiteral("reason"), QStringLiteral("Git push needs two approvals.")},
                           {QStringLiteral("severity"), QStringLiteral("high")},
                           {QStringLiteral("requiresSecondApproval"), true}};
    }
    if (type == QLatin1String("open_url")) {
        const QString url = action.value(QStringLiteral("url")).toString();
        if (!url.startsWith(QLatin1String("http")))
            return blocked(QStringLiteral("Only http(s) URLs allowed."));
        return allowed(QStringLiteral("Open URL after approval."));
    }
    return blocked(QStringLiteral("Unsupported action type."));
}

void StarvisService::queueAction(const QString& name, const QJsonObject& args)
{
    Q_UNUSED(name)
    QVariantMap action = args.toVariantMap();
    const QVariantMap verdict = evaluatePolicy(action);
    QVariantMap entry{
        {QStringLiteral("id"), QUuid::createUuid().toString(QUuid::Id128)},
        {QStringLiteral("actionType"), action.value(QStringLiteral("actionType"))},
        {QStringLiteral("summary"), action.value(QStringLiteral("summary"))},
        {QStringLiteral("detail"), QString::fromUtf8(QJsonDocument(args).toJson(QJsonDocument::Compact))},
        {QStringLiteral("status"), verdict.value(QStringLiteral("allowed")).toBool()
                                       ? QStringLiteral("pending") : QStringLiteral("blocked")},
        {QStringLiteral("verdict"), verdict.value(QStringLiteral("allowed"))},
        {QStringLiteral("reason"), verdict.value(QStringLiteral("reason"))},
        {QStringLiteral("severity"), verdict.value(QStringLiteral("severity"))},
        {QStringLiteral("requiresSecondApproval"),
         verdict.value(QStringLiteral("requiresSecondApproval"), false)},
        {QStringLiteral("confirmationArmed"), false},
        {QStringLiteral("createdAt"), QDateTime::currentMSecsSinceEpoch()},
        {QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch()},
    };
    m_actions.prepend(entry);
    while (m_actions.size() > 50)
        m_actions.removeLast();
    persistActions();
    emit actionsChanged();
    qInfo() << "[starvis] action queued:" << entry.value(QStringLiteral("actionType")).toString()
            << "verdict=" << verdict.value(QStringLiteral("severity")).toString();
}

QVariantList StarvisService::pendingActions() const
{
    QVariantList out;
    for (const QVariant& v : m_actions) {
        const QVariantMap a = v.toMap();
        const QString status = a.value(QStringLiteral("status")).toString();
        if (status == QLatin1String("pending") || status == QLatin1String("blocked"))
            out.append(a);
    }
    return out;
}

QVariantList StarvisService::recentActions() const
{
    QVariantList out;
    for (const QVariant& v : m_actions) {
        const QVariantMap action = v.toMap();
        const QString status = action.value(QStringLiteral("status")).toString();
        if (status != QLatin1String("pending") && status != QLatin1String("blocked"))
            out.append(action);
        if (out.size() >= 8)
            break;
    }
    return out;
}

bool StarvisService::executionEnabled() const
{
    return m_settings->get(QStringLiteral("wp-starvis-exec-enabled"), false).toBool();
}

void StarvisService::setExecutionEnabled(bool enabled)
{
    if (executionEnabled() == enabled)
        return;
    m_settings->set(QStringLiteral("wp-starvis-exec-enabled"), enabled);
    emit executionEnabledChanged();
}

void StarvisService::approveAction(const QString& id)
{
    for (int i = 0; i < m_actions.size(); ++i) {
        QVariantMap a = m_actions[i].toMap();
        if (a.value(QStringLiteral("id")).toString() != id)
            continue;
        const QJsonObject detail = QJsonDocument::fromJson(
            a.value(QStringLiteral("detail")).toString().toUtf8()).object();
        const QVariantMap policy = evaluatePolicy(detail.toVariantMap());
        a.insert(QStringLiteral("verdict"), policy.value(QStringLiteral("allowed")));
        a.insert(QStringLiteral("reason"), policy.value(QStringLiteral("reason")));
        a.insert(QStringLiteral("severity"), policy.value(QStringLiteral("severity")));
        a.insert(QStringLiteral("requiresSecondApproval"),
                 policy.value(QStringLiteral("requiresSecondApproval"), false));
        if (a.value(QStringLiteral("status")).toString() != QLatin1String("pending")
            || !policy.value(QStringLiteral("allowed")).toBool()) {
            if (a.value(QStringLiteral("status")).toString() == QLatin1String("pending")) {
                a.insert(QStringLiteral("status"), QStringLiteral("blocked"));
                a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
                m_actions[i] = a;
                persistActions();
                emit actionsChanged();
            }
            qWarning() << "[starvis] approve refused — action is blocked by policy";
            return;
        }
        if (a.value(QStringLiteral("requiresSecondApproval")).toBool()
            && !a.value(QStringLiteral("confirmationArmed")).toBool()) {
            a.insert(QStringLiteral("confirmationArmed"), true);
            a.insert(QStringLiteral("result"),
                     QStringLiteral("Second approval required before execution."));
            a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
            m_actions[i] = a;
            persistActions();
            emit actionsChanged();
            return;
        }
        if (!executionEnabled()) {
            // Capability gate: structure approved/recorded, but no fs/exec side
            // effects run until the user enables execution explicitly.
            a.insert(QStringLiteral("status"), QStringLiteral("approved-audit"));
            qInfo() << "[starvis] action approved (audit only — execution disabled)";
        } else {
            const QString type = a.value(QStringLiteral("actionType")).toString();
            bool ok = false;
            QString result;
            auto run = [this, &result](const QString& program, const QStringList& args,
                                       int timeoutMs) {
                QProcess process;
                process.setWorkingDirectory(workspaceRoot());
                process.start(program, args);
                if (!process.waitForStarted(5000)) {
                    result = process.errorString();
                    return false;
                }
                if (!process.waitForFinished(timeoutMs)) {
                    process.kill();
                    process.waitForFinished(2000);
                    result = QStringLiteral("Process timed out.");
                    return false;
                }
                result = QString::fromUtf8(process.readAllStandardOutput()
                                           + process.readAllStandardError()).left(12000);
                return process.exitStatus() == QProcess::NormalExit && process.exitCode() == 0;
            };
            if (type == QLatin1String("open_url")) {
                ok = QDesktopServices::openUrl(QUrl(detail.value(QLatin1String("url")).toString()));
                result = ok ? QStringLiteral("URL opened.") : QStringLiteral("Could not open URL.");
            } else if (type == QLatin1String("file_edit")) {
                QString abs;
                if (resolveInWorkspace(detail.value(QLatin1String("path")).toString(), abs)) {
                    QDir().mkpath(QFileInfo(abs).absolutePath());
                    QFile f(abs);
                    if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
                        f.write(detail.value(QLatin1String("content")).toString().toUtf8());
                        ok = true;
                        result = QStringLiteral("Wrote %1.").arg(
                            QDir(workspaceRoot()).relativeFilePath(abs));
                    } else {
                        result = f.errorString();
                    }
                }
            } else if (type == QLatin1String("command")) {
                ok = run(detail.value(QLatin1String("command")).toString(),
                         detail.value(QLatin1String("args")).toVariant().toStringList(), 60000);
            } else if (type == QLatin1String("git_commit")) {
                const QStringList paths = detail.value(QLatin1String("args")).toVariant().toStringList();
                QStringList addArgs{QStringLiteral("add"), QStringLiteral("--")};
                addArgs.append(paths);
                ok = run(QStringLiteral("git"), addArgs, 30000);
                if (ok)
                    ok = run(QStringLiteral("git"),
                             {QStringLiteral("commit"), QStringLiteral("-m"),
                              detail.value(QLatin1String("message")).toString()}, 60000);
            } else if (type == QLatin1String("git_push")) {
                const QStringList target = detail.value(QLatin1String("args")).toVariant().toStringList();
                QStringList pushArgs{QStringLiteral("push"),
                                     target.value(0, QStringLiteral("origin"))};
                if (!target.value(1).isEmpty())
                    pushArgs.append(target.value(1));
                ok = run(QStringLiteral("git"), pushArgs, 120000);
            }
            a.insert(QStringLiteral("status"),
                     ok ? QStringLiteral("approved") : QStringLiteral("failed"));
            a.insert(QStringLiteral("result"), result);
            qInfo() << "[starvis] action executed:" << type << "ok=" << ok;
        }
        a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
        m_actions[i] = a;
        persistActions();
        emit actionsChanged();
        return;
    }
}

void StarvisService::rejectAction(const QString& id)
{
    for (int i = 0; i < m_actions.size(); ++i) {
        QVariantMap a = m_actions[i].toMap();
        if (a.value(QStringLiteral("id")).toString() == id) {
            if (a.value(QStringLiteral("status")).toString() != QLatin1String("pending"))
                return;
            a.insert(QStringLiteral("status"), QStringLiteral("rejected"));
            a.insert(QStringLiteral("updatedAt"), QDateTime::currentMSecsSinceEpoch());
            m_actions[i] = a;
            persistActions();
            emit actionsChanged();
            return;
        }
    }
}

void StarvisService::persistActions()
{
    m_settings->set(QStringLiteral("wp-starvis-actions"),
                    QString::fromUtf8(QJsonDocument(QJsonArray::fromVariantList(m_actions))
                                          .toJson(QJsonDocument::Compact)));
}

void StarvisService::loadActions()
{
    const QString raw = m_settings->get(QStringLiteral("wp-starvis-actions")).toString();
    if (raw.isEmpty())
        return;
    m_actions = QJsonDocument::fromJson(raw.toUtf8()).array().toVariantList();
    for (int i = 0; i < m_actions.size(); ++i) {
        QVariantMap action = m_actions.at(i).toMap();
        const QJsonObject detail = QJsonDocument::fromJson(
            action.value(QStringLiteral("detail")).toString().toUtf8()).object();
        if (detail.isEmpty())
            continue;
        const QVariantMap policy = evaluatePolicy(detail.toVariantMap());
        action.insert(QStringLiteral("verdict"), policy.value(QStringLiteral("allowed")));
        action.insert(QStringLiteral("reason"), policy.value(QStringLiteral("reason")));
        action.insert(QStringLiteral("severity"), policy.value(QStringLiteral("severity")));
        action.insert(QStringLiteral("requiresSecondApproval"),
                      policy.value(QStringLiteral("requiresSecondApproval"), false));
        if (action.value(QStringLiteral("status")).toString() == QLatin1String("pending")
            && !policy.value(QStringLiteral("allowed")).toBool())
            action.insert(QStringLiteral("status"), QStringLiteral("blocked"));
        m_actions[i] = action;
    }
}

} // namespace qtpanel
