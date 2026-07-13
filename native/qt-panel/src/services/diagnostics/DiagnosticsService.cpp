#include "DiagnosticsService.h"

#include "core/SecretVault.h"
#include "core/SettingsStore.h"
#include "services/camera/CameraClient.h"
#include "services/camera/DirectCameraClient.h"
#include "services/live/LiveFeedService.h"
#include "services/msgraph/MsGraphService.h"
#include "services/starvis/StarvisService.h"
#include "services/stocks/StocksModel.h"
#include "services/workstation/WorkstationClient.h"
#include "shell/PanelWindowController.h"

#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimer>
#include <QUrl>

namespace qtpanel {

DiagnosticsService::DiagnosticsService(SettingsStore* settings, SecretVault* vault,
                                       PanelWindowController* panel, MsGraphService* graph,
                                       LiveFeedService* live, WorkstationClient* workstation,
                                       CameraClient* camera, DirectCameraClient* directCamera,
                                       StarvisService* starvis,
                                       StocksModel* stocks, QObject* parent)
    : QObject(parent)
    , m_settings(settings)
    , m_vault(vault)
    , m_panel(panel)
    , m_graph(graph)
    , m_live(live)
    , m_workstation(workstation)
    , m_camera(camera)
    , m_directCamera(directCamera)
    , m_starvis(starvis)
    , m_stocks(stocks)
{
    if (m_graph) {
        connect(m_graph, &MsGraphService::authStateChanged, this,
                &DiagnosticsService::updateMicrosoftRow);
        connect(m_graph, &MsGraphService::agendaChanged, this,
                &DiagnosticsService::updateMicrosoftRow);
        connect(m_graph, &MsGraphService::mailChanged, this,
                &DiagnosticsService::updateMicrosoftRow);
        connect(m_graph, &MsGraphService::todoChanged, this,
                &DiagnosticsService::updateMicrosoftRow);
    }
    if (m_live) {
        connect(m_live, &LiveFeedService::feedResolved, this,
                [this](const QString& feedId, const QString&) {
                    m_livePending.remove(feedId);
                    if (!m_liveResolved.contains(feedId))
                        m_liveResolved.push_back(feedId);
                    updateLiveRow();
                });
        connect(m_live, &LiveFeedService::feedFailed, this,
                [this](const QString& feedId, const QString& error) {
                    m_livePending.remove(feedId);
                    const QString label = error.isEmpty() ? feedId : QStringLiteral("%1: %2").arg(feedId, error);
                    if (!m_liveFailed.contains(label))
                        m_liveFailed.push_back(label);
                    updateLiveRow();
                });
    }
    if (m_workstation) {
        connect(m_workstation, &WorkstationClient::connectedChanged, this,
                &DiagnosticsService::updateWorkstationRow);
        connect(m_workstation, &WorkstationClient::snapshotChanged, this,
                &DiagnosticsService::updateWorkstationRow);
    }
    if (m_camera) {
        connect(m_camera, &CameraClient::statusChanged, this,
                &DiagnosticsService::updateCameraRow);
        connect(m_camera, &CameraClient::camerasChanged, this,
                &DiagnosticsService::updateCameraRow);
    }
    if (m_directCamera) {
        connect(m_directCamera, &DirectCameraClient::statusChanged, this,
                &DiagnosticsService::updateCameraRow);
        connect(m_directCamera, &DirectCameraClient::configurationChanged, this,
                &DiagnosticsService::updateCameraRow);
    }
    if (m_starvis) {
        connect(m_starvis, &StarvisService::configuredChanged, this,
                &DiagnosticsService::updateStarvisRow);
        connect(m_starvis, &StarvisService::busyChanged, this,
                &DiagnosticsService::updateStarvisRow);
    }
    if (m_settings) {
        connect(m_settings, &SettingsStore::changed, this, [this](const QString& key) {
            if (key.startsWith(QLatin1String("wp-tv-")) || key == QLatin1String("wp-market-provider"))
                updateStocksRow();
            if (key.startsWith(QLatin1String("wp-pressreader-")))
                updatePressReaderRow();
            if (key.startsWith(QLatin1String("wp-camera-")))
                updateCameraRow();
        });
    }
    if (m_panel) {
        connect(m_panel, &PanelWindowController::islandChanged, this,
                &DiagnosticsService::updateShellRow);
        connect(m_panel, &PanelWindowController::panelVisibleChanged, this,
                &DiagnosticsService::updateShellRow);
        connect(m_panel, &PanelWindowController::graphicsApiNameChanged, this,
                &DiagnosticsService::updateShellRow);
    }
    if (m_vault) {
        connect(m_vault, &SecretVault::changed, this, [this](const QString& key) {
            if (key == QLatin1String("pressreader-user") || key == QLatin1String("pressreader-password"))
                updatePressReaderRow();
            if (key == QLatin1String("finnhub-key"))
                updateStocksRow();
            if (key == QLatin1String("starvis-openai-key"))
                updateStarvisRow();
            if (key == QLatin1String("camera-password"))
                updateCameraRow();
            if (key == QLatin1String("camera-direct-password"))
                updateCameraRow();
        });
    }
}

void DiagnosticsService::runPreflight()
{
    m_rows.clear();
    emit rowsChanged();
    setRunning(true);
    setStatusText(QStringLiteral("Running preflight"));

    updateShellRow();
    probeMicrosoft();
    probeLiveFeeds();
    probeWorkstation();
    probeCameraDiscovery();
    probeStarvis();
    updatePressReaderRow();
    updateStocksRow();

    if (m_settings) {
        m_settings->set(QStringLiteral("wp-runtime-diagnostics-at"),
                        QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
    }
    QTimer::singleShot(10000, this, [this] {
        if (!m_livePending.isEmpty())
            updateLiveRow();
        setRunning(false);
        setStatusText(QStringLiteral("Preflight ready"));
    });
}

void DiagnosticsService::refreshSnapshot()
{
    m_rows.clear();
    emit rowsChanged();
    updateShellRow();
    updateMicrosoftRow();
    updateWorkstationRow();
    updateCameraRow();
    updateStarvisRow();
    updatePressReaderRow();
    updateStocksRow();
    updateLiveRow();
    setStatusText(QStringLiteral("Status refreshed without network probes"));
}

void DiagnosticsService::probeMicrosoft()
{
    updateMicrosoftRow();
    if (!m_graph)
        return;
    const QString state = m_graph->authState();
    if (state != QLatin1String("none") && state != QLatin1String("setup")
        && state != QLatin1String("authenticating")) {
        upsertRow(QStringLiteral("microsoft"), QStringLiteral("Microsoft"),
                  QStringLiteral("checking"), QStringLiteral("Refreshing Graph data"));
        m_graph->refreshAll();
    }
}

void DiagnosticsService::probeLiveFeeds()
{
    m_livePending.clear();
    m_liveResolved.clear();
    m_liveFailed.clear();
    if (!m_live) {
        upsertRow(QStringLiteral("live"), QStringLiteral("Live feeds"),
                  QStringLiteral("error"), QStringLiteral("Live service missing"));
        return;
    }
    const QStringList ids = m_live->feedIds();
    for (const QString& id : ids) {
        if (m_live->isYouTube(id)) {
            if (!m_liveResolved.contains(id))
                m_liveResolved.push_back(id);
            continue;
        }
        m_livePending.insert(id);
    }
    updateLiveRow();
    for (const QString& id : ids) {
        if (m_live->isYouTube(id))
            continue;
        m_live->resolve(id, true);
    }
}

void DiagnosticsService::probeWorkstation()
{
    if (m_workstation)
        m_workstation->setActive(true);
    updateWorkstationRow();
}

void DiagnosticsService::probeCameraDiscovery()
{
    if (m_camera && m_camera->configured())
        m_camera->discoverCameras();
    updateCameraRow();
}

void DiagnosticsService::probeStarvis()
{
    updateStarvisRow();
}

void DiagnosticsService::openPressReader()
{
    if (!m_panel || !m_settings)
        return;
    const QString url = m_settings->get(
        QStringLiteral("wp-pressreader-url"),
        QStringLiteral("https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog/featured")).toString();
    m_panel->openIsland(url);
    upsertRow(QStringLiteral("pressreader"), QStringLiteral("PressReader"),
              QStringLiteral("checking"), QStringLiteral("Opened saved PressReader URL"));
}

void DiagnosticsService::openDirectCamera()
{
    if (!m_directCamera)
        return;
    m_directCamera->start();
    upsertRow(QStringLiteral("camera-direct"), QStringLiteral("Direct camera"),
              QStringLiteral("checking"),
              QStringLiteral("Starting the native RTSP stream"));
}

void DiagnosticsService::probeShellIsland()
{
    if (!m_panel) {
        upsertRow(QStringLiteral("shell"), QStringLiteral("Shell"),
                  QStringLiteral("error"), QStringLiteral("Panel controller missing"));
        return;
    }
    const QString html = QStringLiteral(
        "<!doctype html><html><body style='margin:0;background:#111827;color:white;"
        "font-family:Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh'>"
        "<div><h1 style='font-size:20px'>Qt Panel shell probe</h1>"
        "<p>Focus, z-order, island position, and capture target are active.</p></div>"
        "</body></html>");
    const QString encoded = QString::fromLatin1(QUrl::toPercentEncoding(html));
    m_panel->openIsland(QStringLiteral("data:text/html;charset=utf-8,%1").arg(encoded));
    upsertRow(QStringLiteral("shell"), QStringLiteral("Shell"),
              QStringLiteral("checking"),
              QStringLiteral("Island probe opened; verify focus and z-order"));
}

QVariantMap DiagnosticsService::makeRow(const QString& id, const QString& label,
                                        const QString& state, const QString& detail) const
{
    return {
        {QStringLiteral("id"), id},
        {QStringLiteral("label"), label},
        {QStringLiteral("state"), state},
        {QStringLiteral("detail"), detail},
    };
}

void DiagnosticsService::upsertRow(const QString& id, const QString& label,
                                   const QString& state, const QString& detail)
{
    const QVariantMap next = makeRow(id, label, state, detail);
    for (qsizetype i = 0; i < m_rows.size(); ++i) {
        if (m_rows.at(i).toMap().value(QStringLiteral("id")).toString() == id) {
            m_rows[i] = next;
            emit rowsChanged();
            return;
        }
    }
    m_rows.push_back(next);
    emit rowsChanged();
}

void DiagnosticsService::updateMicrosoftRow()
{
    if (!m_graph) {
        upsertRow(QStringLiteral("microsoft"), QStringLiteral("Microsoft"),
                  QStringLiteral("error"), QStringLiteral("Graph service missing"));
        return;
    }
    const QString auth = m_graph->authState();
    QString state = QStringLiteral("ok");
    if (auth == QLatin1String("none") || auth == QLatin1String("setup"))
        state = QStringLiteral("setup");
    else if (auth == QLatin1String("error"))
        state = QStringLiteral("error");
    else if (auth == QLatin1String("authenticating") || auth == QLatin1String("refreshing"))
        state = QStringLiteral("checking");
    const QString detail = QStringLiteral("%1; agenda %2, mail %3, tasks %4, unread %5")
                               .arg(auth)
                               .arg(m_graph->agendaEvents().size())
                               .arg(m_graph->mailMessages().size())
                               .arg(m_graph->todoTasks().size())
                               .arg(m_graph->unreadCount());
    upsertRow(QStringLiteral("microsoft"), QStringLiteral("Microsoft"), state, detail);
}

void DiagnosticsService::updateWorkstationRow()
{
    if (!m_workstation) {
        upsertRow(QStringLiteral("workstation"), QStringLiteral("Workstation"),
                  QStringLiteral("error"), QStringLiteral("Telemetry service missing"));
        return;
    }
    QString state = m_workstation->connected() ? QStringLiteral("ok") : QStringLiteral("warn");
    if (m_workstation->stale())
        state = QStringLiteral("warn");
    const QString detail = QStringLiteral("%1; %2 keys")
                               .arg(m_workstation->connected()
                                        ? QStringLiteral("pipe connected")
                                        : QStringLiteral("pipe waiting"))
                               .arg(m_workstation->snapshot().size());
    upsertRow(QStringLiteral("workstation"), QStringLiteral("Workstation"), state, detail);
}

void DiagnosticsService::updateCameraRow()
{
    if (!m_directCamera) {
        upsertRow(QStringLiteral("camera-direct"), QStringLiteral("Direct camera"),
                  QStringLiteral("error"), QStringLiteral("Direct camera service missing"));
    } else {
        QString state = QStringLiteral("setup");
        if (m_directCamera->status() == QLatin1String("connecting"))
            state = QStringLiteral("checking");
        else if (m_directCamera->status() == QLatin1String("streaming"))
            state = QStringLiteral("ok");
        else if (m_directCamera->status() == QLatin1String("error")
                 || m_directCamera->status() == QLatin1String("blocked"))
            state = QStringLiteral("error");
        else if (m_directCamera->configured())
            state = QStringLiteral("ok");

        QString detail = QStringLiteral("%1; %2; %3 protected attempts remaining")
                             .arg(m_directCamera->endpoint(), m_directCamera->status())
                             .arg(m_directCamera->authAttemptsRemaining());
        if (m_directCamera->verified())
            detail += QStringLiteral("; verified");
        if (!m_directCamera->error().isEmpty())
            detail += QStringLiteral("; %1").arg(m_directCamera->error());
        upsertRow(QStringLiteral("camera-direct"), QStringLiteral("Direct camera"), state, detail);
    }
    if (!m_camera) {
        upsertRow(QStringLiteral("camera"), QStringLiteral("Camera"),
                  QStringLiteral("error"), QStringLiteral("Camera service missing"));
        return;
    }
    QString state = QStringLiteral("setup");
    if (m_camera->configured())
        state = m_camera->status() == QLatin1String("error") ? QStringLiteral("error") : QStringLiteral("ok");
    if (m_camera->status() == QLatin1String("connecting")
        || m_camera->status() == QLatin1String("login"))
        state = QStringLiteral("checking");
    QString detail = QStringLiteral("%1").arg(m_camera->status());
    if (!m_camera->discoveryStatus().isEmpty())
        detail += QStringLiteral("; %1").arg(m_camera->discoveryStatus());
    if (!m_camera->error().isEmpty())
        detail += QStringLiteral("; %1").arg(m_camera->error());
    upsertRow(QStringLiteral("camera"), QStringLiteral("Camera"), state, detail);
}

void DiagnosticsService::updateStarvisRow()
{
    if (!m_starvis) {
        upsertRow(QStringLiteral("starvis"), QStringLiteral("Starvis"),
                  QStringLiteral("error"), QStringLiteral("Starvis service missing"));
        return;
    }
    const QString state = m_starvis->configured()
        ? (m_starvis->busy() ? QStringLiteral("checking") : QStringLiteral("ok"))
        : QStringLiteral("setup");
    const QString detail = m_starvis->configured()
        ? QStringLiteral("model %1%2").arg(m_starvis->model(),
                                           m_starvis->busy() ? QStringLiteral("; busy") : QString())
        : QStringLiteral("OpenAI-compatible key missing");
    upsertRow(QStringLiteral("starvis"), QStringLiteral("Starvis"), state, detail);
}

void DiagnosticsService::updatePressReaderRow()
{
    if (!m_settings || !m_vault) {
        upsertRow(QStringLiteral("pressreader"), QStringLiteral("PressReader"),
                  QStringLiteral("error"), QStringLiteral("Settings or vault missing"));
        return;
    }
    const QString url = m_settings->get(QStringLiteral("wp-pressreader-url")).toString();
    const bool hasUser = m_vault->has(QStringLiteral("pressreader-user"));
    const bool hasPass = m_vault->has(QStringLiteral("pressreader-password"));
    const QString guardrailRaw = m_settings->get(QStringLiteral("wp-pressreader-guardrail")).toString();
    const QJsonObject guardrail = QJsonDocument::fromJson(guardrailRaw.toUtf8()).object();
    const qint64 blockedUntil = static_cast<qint64>(
        guardrail.value(QLatin1String("blockedUntil")).toDouble());
    const qint64 remainingMs = blockedUntil - QDateTime::currentMSecsSinceEpoch();
    const bool paused = remainingMs > 0;
    const QString state = paused ? QStringLiteral("checking")
        : (hasUser && hasPass) ? QStringLiteral("ok") : QStringLiteral("setup");
    const QString pauseDetail = paused
        ? QStringLiteral("; automation paused %1 min").arg((remainingMs + 59999) / 60000)
        : QString();
    upsertRow(QStringLiteral("pressreader"), QStringLiteral("PressReader"), state,
              QStringLiteral("%1; credentials %2/%3%4")
                  .arg(url.isEmpty() ? QStringLiteral("default URL") : QStringLiteral("custom URL"),
                       hasUser ? QStringLiteral("user") : QStringLiteral("no user"),
                       hasPass ? QStringLiteral("password") : QStringLiteral("no password"),
                       pauseDetail));
}

void DiagnosticsService::updateStocksRow()
{
    if (!m_settings || !m_stocks || !m_vault) {
        upsertRow(QStringLiteral("stocks"), QStringLiteral("Stocks"),
                  QStringLiteral("error"), QStringLiteral("Stocks service missing"));
        return;
    }
    const QString provider = m_settings->get(QStringLiteral("wp-market-provider"),
                                             QStringLiteral("auto")).toString();
    const bool hasFinnhub = m_vault->has(QStringLiteral("finnhub-key"));
    const bool needsFinnhub = provider == QLatin1String("finnhub");
    const QString state = (needsFinnhub && !hasFinnhub) ? QStringLiteral("setup") : QStringLiteral("ok");
    upsertRow(QStringLiteral("stocks"), QStringLiteral("Stocks"), state,
              QStringLiteral("provider %1; %2 lists; Finnhub %3")
                  .arg(provider.isEmpty() ? QStringLiteral("auto") : provider)
                  .arg(m_stocks->listNames().size())
                  .arg(hasFinnhub ? QStringLiteral("ready") : QStringLiteral("missing")));
}

void DiagnosticsService::updateShellRow()
{
    if (!m_panel) {
        upsertRow(QStringLiteral("shell"), QStringLiteral("Shell"),
                  QStringLiteral("error"), QStringLiteral("Panel controller missing"));
        return;
    }
    QString island = m_panel->islandOpen() ? QStringLiteral("open") : QStringLiteral("closed");
    if (m_panel->islandOpen()) {
        const QUrl url(m_panel->islandUrl());
        const QString target = url.isValid() && !url.host().isEmpty()
            ? url.host()
            : m_panel->islandUrl().left(64);
        island += QStringLiteral(" %1").arg(target);
        if (!m_panel->islandTitle().isEmpty())
            island += QStringLiteral(" \"%1\"").arg(m_panel->islandTitle().left(42));
        if (!m_panel->islandStatus().isEmpty())
            island += QStringLiteral(" [%1]").arg(m_panel->islandStatus());
        if (!m_panel->islandError().isEmpty())
            island += QStringLiteral(" error=%1").arg(m_panel->islandError().left(80));
    }
    upsertRow(QStringLiteral("shell"), QStringLiteral("Shell"), QStringLiteral("ok"),
              QStringLiteral("visible %1; island %2; renderer %3")
                  .arg(m_panel->panelVisible() ? QStringLiteral("yes") : QStringLiteral("no"),
                       island,
                       m_panel->graphicsApiName()));
}

void DiagnosticsService::updateLiveRow()
{
    const int resolved = m_liveResolved.size();
    const int failed = m_liveFailed.size();
    const int pending = m_livePending.size();
    QString state = QStringLiteral("checking");
    if (pending == 0)
        state = failed == 0 ? QStringLiteral("ok") : QStringLiteral("warn");
    QString detail = QStringLiteral("%1 resolved, %2 failed, %3 pending")
                         .arg(resolved)
                         .arg(failed)
                         .arg(pending);
    if (!m_liveFailed.isEmpty())
        detail += QStringLiteral("; ") + m_liveFailed.join(QStringLiteral("; "));
    upsertRow(QStringLiteral("live"), QStringLiteral("Live feeds"), state, detail);
}

void DiagnosticsService::setStatusText(const QString& status)
{
    if (m_status == status)
        return;
    m_status = status;
    emit statusChanged();
}

void DiagnosticsService::setRunning(bool running)
{
    if (m_running == running)
        return;
    m_running = running;
    emit statusChanged();
}

} // namespace qtpanel
