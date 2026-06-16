#pragma once

#include <QObject>
#include <QSet>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>

namespace qtpanel {

class CameraClient;
class LiveFeedService;
class MsGraphService;
class PanelWindowController;
class SecretVault;
class SettingsStore;
class StarvisService;
class StocksModel;
class WorkstationClient;

// Small native preflight surface for the services that still need real
// environment validation after the Qt rewrite. It does not replace runtime
// testing; it gives the settings panel deterministic probes and readable state.
class DiagnosticsService : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList rows READ rows NOTIFY rowsChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(bool running READ running NOTIFY statusChanged)

public:
    DiagnosticsService(SettingsStore* settings, SecretVault* vault,
                       PanelWindowController* panel, MsGraphService* graph,
                       LiveFeedService* live, WorkstationClient* workstation,
                       CameraClient* camera, StarvisService* starvis,
                       StocksModel* stocks, QObject* parent = nullptr);

    QVariantList rows() const { return m_rows; }
    QString status() const { return m_status; }
    bool running() const { return m_running; }

    Q_INVOKABLE void runPreflight();
    Q_INVOKABLE void probeMicrosoft();
    Q_INVOKABLE void probeLiveFeeds();
    Q_INVOKABLE void probeWorkstation();
    Q_INVOKABLE void probeCameraDiscovery();
    Q_INVOKABLE void probeStarvis();
    Q_INVOKABLE void openPressReader();
    Q_INVOKABLE void openDirectCamera();
    Q_INVOKABLE void probeShellIsland();

signals:
    void rowsChanged();
    void statusChanged();

private:
    QVariantMap makeRow(const QString& id, const QString& label,
                        const QString& state, const QString& detail) const;
    void upsertRow(const QString& id, const QString& label,
                   const QString& state, const QString& detail);
    void updateMicrosoftRow();
    void updateWorkstationRow();
    void updateCameraRow();
    void updateStarvisRow();
    void updatePressReaderRow();
    void updateStocksRow();
    void updateShellRow();
    void updateLiveRow();
    void setStatusText(const QString& status);
    void setRunning(bool running);

    SettingsStore* m_settings = nullptr;
    SecretVault* m_vault = nullptr;
    PanelWindowController* m_panel = nullptr;
    MsGraphService* m_graph = nullptr;
    LiveFeedService* m_live = nullptr;
    WorkstationClient* m_workstation = nullptr;
    CameraClient* m_camera = nullptr;
    StarvisService* m_starvis = nullptr;
    StocksModel* m_stocks = nullptr;

    QVariantList m_rows;
    QString m_status = QStringLiteral("Not run yet");
    bool m_running = false;
    QSet<QString> m_livePending;
    QStringList m_liveResolved;
    QStringList m_liveFailed;
};

} // namespace qtpanel
