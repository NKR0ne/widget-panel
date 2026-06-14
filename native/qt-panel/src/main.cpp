#include <QDir>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalServer>
#include <QLocalSocket>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QTimer>
#include <QtQml>

#include "core/HttpClient.h"
#include "core/Log.h"
#include "core/QmlNetwork.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"
#include "core/SoundFx.h"
#include "shell/SystemTheme.h"
#include "services/camera/CameraClient.h"
#include "services/live/LiveFeedService.h"
#include "services/msgraph/MsGraphService.h"
#include "services/news/NewsService.h"
#include "services/reader/ReaderService.h"
#include "services/starvis/StarvisService.h"
#include "services/stocks/StocksModel.h"
#include "services/weather/WeatherService.h"
#include "services/workstation/WorkstationClient.h"
#include "shell/BraveHostClient.h"
#include "shell/HelperServer.h"
#include "shell/PanelWindowController.h"

using namespace qtpanel;

namespace {
const char kInstanceName[] = "qt-panel-single-instance";
} // namespace

int main(int argc, char* argv[])
{
    QGuiApplication::setApplicationName(QStringLiteral("qt-panel"));
    QGuiApplication::setOrganizationName(QStringLiteral("qt-panel"));
    QGuiApplication app(argc, argv);

    const QString appData = QString::fromLocal8Bit(qgetenv("APPDATA"));
    const QString dataDir = appData + QStringLiteral("/qt-panel");
    QDir().mkpath(dataDir);
    initLogging(dataDir + QStringLiteral("/qt-panel.log"));

    // Single instance: forward a toggle to the running panel and exit.
    {
        QLocalSocket probe;
        probe.connectToServer(QLatin1String(kInstanceName));
        if (probe.waitForConnected(250)) {
            probe.write("toggle\n");
            probe.waitForBytesWritten(250);
            qInfo() << "second instance — forwarded toggle";
            return 0;
        }
    }
    QLocalServer instanceServer;
    QLocalServer::removeServer(QLatin1String(kInstanceName));
    instanceServer.listen(QLatin1String(kInstanceName));

    // Renderer selection: prefer Vulkan; since Qt 6.5 the scene graph falls
    // back to D3D11 automatically when Vulkan initialization fails. The API
    // that actually won is surfaced in the panel header.
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Vulkan);
    qInfo() << "[render] requesting Vulkan (automatic D3D11 fallback)";

    SettingsStore settings(dataDir + QStringLiteral("/settings.json"));
    settings.importLegacyIfEmpty(appData + QStringLiteral("/widget-panel/config.json"));

    // Move secrets out of plaintext settings into the Windows Credential
    // Manager (one-time; no-op once migrated). Camera password is split out of
    // the wp-camera-auth JSON below by the camera client.
    SecretVault vault;
    vault.migrateFromSettings(&settings, QStringLiteral("wp-starvis-openai-key"),
                              QStringLiteral("starvis-openai-key"));
    {
        const QJsonObject camCreds = QJsonDocument::fromJson(
            settings.get(QStringLiteral("wp-camera-auth")).toString().toUtf8()).object();
        if (camCreds.contains(QLatin1String("p"))
            && !vault.has(QStringLiteral("camera-password"))) {
            vault.set(QStringLiteral("camera-password"),
                      camCreds.value(QLatin1String("p")).toString());
            QJsonObject trimmed{
                {QStringLiteral("u"), camCreds.value(QLatin1String("u"))},
                {QStringLiteral("loginType"), camCreds.value(QLatin1String("loginType"))},
            };
            settings.set(QStringLiteral("wp-camera-auth"),
                         QString::fromUtf8(QJsonDocument(trimmed).toJson(QJsonDocument::Compact)));
            qInfo() << "[vault] migrated camera password → Credential Manager";
        }
    }
    {
        // Migrate API keys out of wp-config.apiKeys into the vault (once).
        const QJsonObject cfg = QJsonDocument::fromJson(
            settings.get(QStringLiteral("wp-config")).toString().toUtf8()).object();
        const QJsonObject apiKeys = cfg.value(QLatin1String("apiKeys")).toObject();
        const QString tomtom = apiKeys.value(QLatin1String("traffic")).toString();
        if (!tomtom.isEmpty() && !vault.has(QStringLiteral("tomtom-key")))
            vault.set(QStringLiteral("tomtom-key"), tomtom);
        const QString finnhub = apiKeys.value(QLatin1String("stocks")).toString();
        if (!finnhub.isEmpty() && !vault.has(QStringLiteral("finnhub-key")))
            vault.set(QStringLiteral("finnhub-key"), finnhub);
    }

    HelperServer helper;
    BraveHostClient brave;
    PanelWindowController controller(&settings, &helper, &brave);

    HttpClient http;
    WeatherService weather(&settings, &http);
    WorkstationClient workstation;
    workstation.setActive(true);
    StocksModel stocks(&settings, &http);
    NewsService news(&settings, &http);
    MsGraphService msGraph(&settings, &http);
    LiveFeedService live(&http);
    ReaderService reader(&http);
    StarvisService starvis(&settings, &vault, &http, &weather, &stocks, &news, &workstation);
    auto* cameraProvider = new CameraImageProvider(); // engine takes ownership
    CameraClient camera(&settings, &vault, cameraProvider);

    // Outlook unread count → AppBar pill badge (and any future overlay).
    QObject::connect(&msGraph, &MsGraphService::unreadCountChanged, &helper,
                     [&] { helper.sendBadge(msGraph.unreadCount()); });

    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Panel", &controller);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Store", &settings);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Weather", &weather);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Workstation", &workstation);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Stocks", &stocks);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "News", &news);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "MsGraph", &msGraph);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Live", &live);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Reader", &reader);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Starvis", &starvis);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Camera", &camera);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Vault", &vault);

    SystemTheme systemTheme;
    SoundFx soundFx(&settings);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Sys", &systemTheme);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "SoundFx", &soundFx);

    QQmlApplicationEngine engine;
    QmlNetworkFactory netFactory;
    engine.setNetworkAccessManagerFactory(&netFactory);
    engine.addImageProvider(QStringLiteral("camera"), cameraProvider);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app,
                     [] { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.loadFromModule("QtPanel", "Main");
    if (engine.rootObjects().isEmpty()) {
        qCritical() << "failed to load QML root";
        return 1;
    }

    auto* window = qobject_cast<QQuickWindow*>(engine.rootObjects().constFirst());
    if (!window) {
        qCritical() << "QML root object is not a window";
        return 1;
    }
    controller.attach(window);

    QObject::connect(&instanceServer, &QLocalServer::newConnection, &controller, [&] {
        while (QLocalSocket* peer = instanceServer.nextPendingConnection()) {
            QObject::connect(peer, &QLocalSocket::disconnected, peer, &QObject::deleteLater);
            controller.togglePanel();
        }
    });

    const bool noHelper = app.arguments().contains(QStringLiteral("--no-helper"));
    helper.start(!noHelper);

    // Temporary diagnostic: reproduce the settings-stepper column change and
    // dump scene grabs before/after to verify rendering survives the resize.
    if (app.arguments().contains(QStringLiteral("--diag-fitmode"))) {
        QTimer::singleShot(5000, window, [window, &dataDir] {
            window->grabWindow().save(dataDir + QStringLiteral("/diag-before.png"));
            qInfo() << "[diag] before grab saved, window" << window->geometry();
        });
        QTimer::singleShot(6500, &controller, [&controller, &settings] {
            settings.set(QStringLiteral("wp-base-columns"), 3);
            controller.fitMode(QStringLiteral("base"), 3, {});
        });
        QTimer::singleShot(8500, window, [window, &dataDir] {
            window->grabWindow().save(dataDir + QStringLiteral("/diag-narrow.png"));
            qInfo() << "[diag] narrow grab saved, window" << window->geometry();
        });
        QTimer::singleShot(9500, &controller, [&controller, &settings] {
            settings.set(QStringLiteral("wp-base-columns"), 6);
            controller.fitMode(QStringLiteral("base"), 6, {});
        });
        QTimer::singleShot(11500, window, [window, &dataDir] {
            window->grabWindow().save(dataDir + QStringLiteral("/diag-wide.png"));
            qInfo() << "[diag] wide grab saved, window" << window->geometry();
        });
    }

    controller.showPanel();
    const int rc = app.exec();
    settings.flush();
    return rc;
}
