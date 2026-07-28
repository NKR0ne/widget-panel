#include <QDir>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QEventLoop>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalServer>
#include <QLocalSocket>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QRegularExpression>
#include <QSGRendererInterface>
#include <QStandardPaths>
#include <QTimer>
#include <QtQml>
#include <QtWebEngineQuick/QQuickWebEngineDownloadRequest>
#include <QtWebEngineQuick/QQuickWebEngineProfile>
#include <QtWebEngineQuick/qtwebenginequickglobal.h>

#include "core/HttpClient.h"
#include "core/Log.h"
#include "core/QmlNetwork.h"
#include "core/SecretVault.h"
#include "core/SettingsStore.h"
#include "core/SoundFx.h"
#include "shell/SystemTheme.h"
#include "services/camera/CameraClient.h"
#include "services/camera/DirectCameraClient.h"
#include "services/diagnostics/DiagnosticsService.h"
#include "services/live/LiveFeedService.h"
#include "services/msgraph/MsGraphService.h"
#include "services/news/NewsService.h"
#include "services/pressreader/PressReaderService.h"
#include "services/reader/ReaderService.h"
#include "services/starvis/StarvisService.h"
#include "services/stocks/StocksModel.h"
#include "services/weather/WeatherService.h"
#include "services/workstation/WorkstationClient.h"
#include "shell/HelperServer.h"
#include "shell/PanelWindowController.h"
#include "shell/CompositionPanelHost.h"
#include "shell/PanelSurfaceTarget.h"

using namespace qtpanel;

namespace {
const char kInstanceName[] = "qt-panel-single-instance";

QString safeProfileName(QString value)
{
    value = value.trimmed();
    value.replace(QRegularExpression(QStringLiteral("[^A-Za-z0-9._-]")),
                  QStringLiteral("-"));
    return value.left(64);
}
} // namespace

int main(int argc, char* argv[])
{
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QtWebEngineQuick::initialize();
    QGuiApplication::setApplicationName(QStringLiteral("qt-panel"));
    QGuiApplication::setOrganizationName(QStringLiteral("qt-panel"));
    QGuiApplication app(argc, argv);

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("Native Widget Panel"));
    parser.addHelpOption();
    const QCommandLineOption noHelperOption(
        QStringLiteral("no-helper"),
        QStringLiteral("Disable the taskbar helper listener and helper process."));
    const QCommandLineOption profileOption(
        QStringLiteral("profile"),
        QStringLiteral("Use an isolated settings/log profile."),
        QStringLiteral("name"));
    const QCommandLineOption exitAfterOption(
        QStringLiteral("exit-after-ms"),
        QStringLiteral("Exit automatically after the given number of milliseconds."),
        QStringLiteral("milliseconds"));
    const QCommandLineOption diagFitModeOption(
        QStringLiteral("diag-fitmode"),
        QStringLiteral("Capture the built-in fit-mode diagnostic screenshots."));
    const QCommandLineOption rendererOption(
        QStringLiteral("renderer"),
        QStringLiteral("Select auto, vulkan, or d3d11 rendering."),
        QStringLiteral("backend"),
        QStringLiteral("auto"));
    const QCommandLineOption startModeOption(
        QStringLiteral("start-mode"),
        QStringLiteral("Open directly in base, news, monitor, or live mode."),
        QStringLiteral("mode"),
        QStringLiteral("base"));
    const QCommandLineOption diagIslandUrlOption(
        QStringLiteral("diag-island-url"),
        QStringLiteral("Open a URL in the embedded web island for bounded diagnostics."),
        QStringLiteral("url"));
    const QCommandLineOption compositionOption(
    QStringLiteral("composition"),
    QStringLiteral("Host the panel on the Windows composition backdrop "
                   "(DesktopAcrylicController) instead of the DWM window backdrop."));
const QCommandLineOption diagPressReaderOption(
        QStringLiteral("diag-pressreader"),
        QStringLiteral("Open the dedicated PressReader spotlight without automatic login."));
    parser.addOption(noHelperOption);
    parser.addOption(profileOption);
    parser.addOption(exitAfterOption);
    parser.addOption(diagFitModeOption);
    parser.addOption(rendererOption);
    parser.addOption(startModeOption);
    parser.addOption(diagIslandUrlOption);
    parser.addOption(diagPressReaderOption);
    parser.addOption(compositionOption);
    parser.process(app);

    const QString startMode = parser.value(startModeOption).trimmed().toLower();
    const QString diagIslandUrl = parser.value(diagIslandUrlOption).trimmed();
    const QStringList validModes = {
        QStringLiteral("base"), QStringLiteral("news"),
        QStringLiteral("monitor"), QStringLiteral("live")
    };
    if (!validModes.contains(startMode)) {
        qCritical() << "[startup] --start-mode must be base, news, monitor, or live";
        return 5;
    }

    const QString appData = QString::fromLocal8Bit(qgetenv("APPDATA"));
    const QString profile = safeProfileName(parser.value(profileOption));
    QString dataDir = appData + QStringLiteral("/qt-panel");
    if (!profile.isEmpty())
        dataDir += QStringLiteral("/profiles/") + profile;
    QDir().mkpath(dataDir);
    initLogging(dataDir + QStringLiteral("/qt-panel.log"));
    QObject::connect(&app, &QCoreApplication::aboutToQuit, [] {
        qInfo() << "[startup] exiting cleanly";
    });
    qInfo() << "[startup] profile="
            << (profile.isEmpty() ? QStringLiteral("default") : profile)
            << "dataDir=" << QDir::toNativeSeparators(dataDir);

    bool exitAfterOk = false;
    const int exitAfterMs = parser.value(exitAfterOption).toInt(&exitAfterOk);
    if (parser.isSet(exitAfterOption) && (!exitAfterOk || exitAfterMs <= 0)) {
        qCritical() << "[startup] --exit-after-ms must be a positive integer";
        return 2;
    }

    // Single instance: forward a toggle to the running panel and exit.
    const QString instanceName = profile.isEmpty()
        ? QString::fromLatin1(kInstanceName)
        : QString::fromLatin1(kInstanceName) + QLatin1Char('-') + profile;
    {
        QLocalSocket probe;
        probe.connectToServer(instanceName);
        if (probe.waitForConnected(250)) {
            probe.write("toggle\n");
            probe.waitForBytesWritten(250);
            qInfo() << "second instance — forwarded toggle";
            return 0;
        }
    }
    QLocalServer instanceServer;
    QLocalServer::removeServer(instanceName);
    if (!instanceServer.listen(instanceName)) {
        qCritical() << "[startup] single-instance listener failed:"
                    << instanceServer.errorString();
        return 3;
    }

    const QString renderer = parser.value(rendererOption).trimmed().toLower();
    if (renderer == QLatin1String("vulkan")) {
        QQuickWindow::setGraphicsApi(QSGRendererInterface::Vulkan);
        qInfo() << "[render] forced Vulkan";
    } else if (renderer == QLatin1String("d3d11")) {
        QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
        qInfo() << "[render] forced D3D11";
    } else if (renderer == QLatin1String("auto")) {
        // D3D11 is Qt's reliable Windows RHI backend and does not require a
        // Vulkan SDK/runtime. Vulkan remains available as an explicit test.
        QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
        qInfo() << "[render] auto selected D3D11";
    } else {
        qCritical() << "[startup] --renderer must be auto, vulkan, or d3d11";
        return 4;
    }

    SettingsStore settings(dataDir + QStringLiteral("/settings.json"));
    if (profile.isEmpty())
        settings.importLegacyIfEmpty(appData + QStringLiteral("/widget-panel/config.json"));
    if (parser.isSet(diagFitModeOption)) {
        settings.set(QStringLiteral("wp-pinned"), true);
        settings.set(QStringLiteral("wp-pinned-opacity"), QStringLiteral("1"));
    }
    const QString legacyPressReaderUrl = settings.get(
        QStringLiteral("wp-pressreader-url")).toString().trimmed();
    if (legacyPressReaderUrl.contains(
            QLatin1String("pressreader.com.ezproxy.bibliothequedequebec.qc.ca"),
            Qt::CaseInsensitive)) {
        settings.set(QStringLiteral("wp-pressreader-url"),
                     PressReaderService::defaultEntryUrl());
        qInfo() << "[pressreader] migrated legacy rewritten catalog URL to library entry point";
    }

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
        const QJsonObject pressCreds = QJsonDocument::fromJson(
            settings.get(QStringLiteral("wp-pressreader-auth")).toString().toUtf8()).object();
        const QString user = pressCreds.value(QLatin1String("u")).toString(
            pressCreds.value(QLatin1String("user")).toString());
        const QString pass = pressCreds.value(QLatin1String("p")).toString(
            pressCreds.value(QLatin1String("pass")).toString());
        if (!user.isEmpty() && !vault.has(QStringLiteral("pressreader-user")))
            vault.set(QStringLiteral("pressreader-user"), user);
        if (!pass.isEmpty() && !vault.has(QStringLiteral("pressreader-password")))
            vault.set(QStringLiteral("pressreader-password"), pass);
        if (!user.isEmpty() || !pass.isEmpty()) {
            settings.remove(QStringLiteral("wp-pressreader-auth"));
            qInfo() << "[vault] migrated PressReader credentials to Credential Manager";
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

    QQuickWebEngineProfile webProfile(QStringLiteral("qt-panel-island"), &app);
    const QString webDataDir = dataDir + QStringLiteral("/webengine");
    const QString webCacheDir = dataDir + QStringLiteral("/webengine-cache");
    QDir().mkpath(webDataDir);
    QDir().mkpath(webCacheDir);
    webProfile.setOffTheRecord(false);
    webProfile.setPersistentStoragePath(webDataDir);
    webProfile.setCachePath(webCacheDir);
    webProfile.setHttpCacheType(QQuickWebEngineProfile::DiskHttpCache);
    webProfile.setPersistentCookiesPolicy(QQuickWebEngineProfile::ForcePersistentCookies);
    webProfile.setPersistentPermissionsPolicy(
        QQuickWebEngineProfile::PersistentPermissionsPolicy::AskEveryTime);
    webProfile.setHttpAcceptLanguage(QStringLiteral("fr-CA,fr;q=0.9,en-CA;q=0.8,en;q=0.7"));
    webProfile.setDownloadPath(QStandardPaths::writableLocation(QStandardPaths::DownloadLocation));
    QObject::connect(&webProfile, &QQuickWebEngineProfile::downloadRequested,
                     [](QQuickWebEngineDownloadRequest* request) {
        if (request)
            request->accept();
    });
    qInfo() << "[web] persistent Qt WebEngine profile at"
            << QDir::toNativeSeparators(webDataDir);

    QQuickWebEngineProfile pressReaderProfile(QStringLiteral("qt-panel-pressreader"), &app);
    const QString pressReaderDataDir = dataDir + QStringLiteral("/webengine-pressreader");
    const QString pressReaderCacheDir = dataDir + QStringLiteral("/webengine-pressreader-cache");
    QDir().mkpath(pressReaderDataDir);
    QDir().mkpath(pressReaderCacheDir);
    pressReaderProfile.setOffTheRecord(false);
    pressReaderProfile.setPersistentStoragePath(pressReaderDataDir);
    pressReaderProfile.setCachePath(pressReaderCacheDir);
    pressReaderProfile.setHttpCacheType(QQuickWebEngineProfile::DiskHttpCache);
    pressReaderProfile.setPersistentCookiesPolicy(
        QQuickWebEngineProfile::ForcePersistentCookies);
    pressReaderProfile.setPersistentPermissionsPolicy(
        QQuickWebEngineProfile::PersistentPermissionsPolicy::AskEveryTime);
    pressReaderProfile.setHttpAcceptLanguage(
        QStringLiteral("fr-CA,fr;q=0.9,en-CA;q=0.8,en;q=0.7"));
    pressReaderProfile.setDownloadPath(
        QStandardPaths::writableLocation(QStandardPaths::DownloadLocation));
    QObject::connect(&pressReaderProfile, &QQuickWebEngineProfile::downloadRequested,
                     [](QQuickWebEngineDownloadRequest* request) {
        if (request)
            request->accept();
    });
    qInfo() << "[pressreader] isolated WebEngine profile at"
            << QDir::toNativeSeparators(pressReaderDataDir);

    HelperServer helper;
    PanelWindowController controller(&settings, &helper, &webProfile);

    HttpClient http;
    WeatherService weather(&settings, &http);
    WorkstationClient workstation;
    StocksModel stocks(&settings, &vault, &http);
    NewsService news(&settings, &http);
    MsGraphService msGraph(&settings, &http);
    LiveFeedService live(&http);
    ReaderService reader(&http);
    PressReaderService pressReader(&settings, &vault, profile.isEmpty());
    StarvisService starvis(&settings, &vault, &http, &weather, &stocks, &news, &workstation);
    auto* cameraProvider = new CameraImageProvider(); // engine takes ownership
    CameraClient camera(&settings, &vault, cameraProvider);
    DirectCameraClient directCamera(&settings, &vault);
    DiagnosticsService diagnostics(&settings, &vault, &controller, &pressReader,
                                   &msGraph, &live,
                                   &workstation, &camera, &directCamera, &starvis, &stocks);

    // Outlook unread count → AppBar pill badge (and any future overlay).
    QObject::connect(&msGraph, &MsGraphService::unreadCountChanged, &helper,
                     [&] { helper.sendBadge(msGraph.unreadCount()); });
    QObject::connect(&msGraph, &MsGraphService::authUrlReady, &controller,
                     [&controller](const QString& url) { controller.openIsland(url); });
    QObject::connect(&msGraph, &MsGraphService::authStateChanged, &controller,
                     [&msGraph, &controller] {
        if (msGraph.authState() != QLatin1String("ok") || !controller.islandOpen())
            return;
        const QString url = controller.islandUrl();
        if (url.contains(QLatin1String("login.microsoftonline.com"), Qt::CaseInsensitive)
            || url.contains(QLatin1String("localhost:47340"), Qt::CaseInsensitive))
            controller.closeIsland();
    });
    QObject::connect(&controller, &PanelWindowController::tradingViewSessionCaptured,
                     &stocks, &StocksModel::refreshWatchlists);
    QObject::connect(&pressReader, &PressReaderService::openRequested,
                     &controller, &PanelWindowController::openPressReader);
    QObject::connect(&pressReader, &PressReaderService::closeRequested,
                     &controller, &PanelWindowController::closeIsland);
    QObject::connect(&controller, &PanelWindowController::islandChanged,
                     &pressReader, [&controller, &pressReader] {
        if (!controller.islandOpen()
            || controller.islandKind() != QLatin1String("pressreader"))
            pressReader.surfaceClosed();
    });

    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Panel", &controller);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Store", &settings);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Weather", &weather);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Workstation", &workstation);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Stocks", &stocks);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "News", &news);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "MsGraph", &msGraph);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Live", &live);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Reader", &reader);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "PressReader", &pressReader);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Starvis", &starvis);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Camera", &camera);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "DirectCamera", &directCamera);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Diagnostics", &diagnostics);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Vault", &vault);

    SystemTheme systemTheme;
    SoundFx soundFx(&settings);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "Sys", &systemTheme);
    qmlRegisterSingletonInstance("QtPanel.Native", 1, 0, "SoundFx", &soundFx);

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("StartupMode"), startMode);
    engine.rootContext()->setContextProperty(QStringLiteral("WebProfile"), &webProfile);
    engine.rootContext()->setContextProperty(QStringLiteral("PressReaderProfile"),
                                             &pressReaderProfile);
    QmlNetworkFactory netFactory;
    engine.setNetworkAccessManagerFactory(&netFactory);
    engine.addImageProvider(QStringLiteral("camera"), cameraProvider);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app,
                     [] { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    // --composition hosts the scene in a Windows composition tree so the panel
    // sits on DesktopAcrylicController's material -- the shell's own acrylic,
    // including the luminosity blend our in-scene stack cannot reproduce.
    // Both paths coexist so they can be compared at runtime; the windowed path
    // stays the default until this one has earned it.
    // The scene's window in both modes. In composition mode it is offscreen and
    // must never be shown; it is still the right object for the QML context and
    // for the renderer interface.
    QQuickWindow* window = nullptr;
    std::unique_ptr<CompositionPanelHost> compositionHost;
    if (parser.isSet(compositionOption)) {
        controller.setCompositionMode(true);
        compositionHost = std::make_unique<CompositionPanelHost>();
        // PanelSurface, not Main: QQuickRenderControl needs an Item root, and
        // Main.qml is only a Window wrapper around exactly this item.
        if (!compositionHost->initialize(&engine, QStringLiteral("QtPanel"),
                                         QStringLiteral("PanelSurface"),
                                         QSize(715, 1166))) {
            // Fall back rather than refusing to start: a panel on the ordinary
            // backdrop is far better than no panel, and the reason is logged.
            qWarning() << "[composition] unavailable - falling back to the windowed path";
            compositionHost.reset();
            controller.setCompositionMode(false);
        }
    }
    if (compositionHost) {
        window = compositionHost->quickWindow();
        controller.setSystemTheme(&systemTheme);
        controller.attachTarget(new CompositionSurfaceTarget(compositionHost.get()),
                                window);
        // Blur-hide. attach() gets this from QWindow::activeChanged; there is no
        // QWindow here, so the host window's WM_ACTIVATE stands in. Without it
        // the panel stays up after you click into another application, which is
        // the one shell behaviour the composition path silently dropped.
        QObject::connect(compositionHost.get(), &CompositionPanelHost::hostActiveChanged,
                         &controller, [&controller](bool) {
                             controller.notifySurfaceActiveChanged();
                         });
        // Drive the acrylic from the shell's own palette. AccentDark2 is where
        // the Start menu actually sits once composited -- StartColorMenu is a
        // tint the shell composites at high opacity over a darkened backdrop,
        // and used directly it lands far too light (#586579 -> #515B6B against
        // Start's measured #2E3542).
        //
        // Unlike the in-scene path, these are Fluent's own constants used as
        // intended: DesktopAcrylicController applies the recipe once, itself,
        // so there is no double-tinting to compensate for.
        // Read out of DesktopAcrylicController itself (composition-spike
        // --defaults), NOT from documentation or memory:
        //
        //   Base (what Start uses)  TintOpacity 0.000  LuminosityOpacity 0.900
        //   Thin (flyouts, menus)   TintOpacity 0.000  LuminosityOpacity 0.440
        //
        // Start applies NO tint wash. Its whole character is the luminosity
        // blend -- the layer that re-maps the backdrop's brightness rather than
        // covering it, which is exactly the "amplifies light while blurring"
        // quality we could never reproduce by compositing over a finished
        // surface. Overriding these to 0.8/0.85, as this did, is close to
        // inverting the recipe.
        //
        // So: do not override them. Leaving the controller alone means the
        // material IS Start's material, by construction rather than by
        // approximation. Only the theme is set, because that is what the
        // controller resolves its internal colours against.
        // TintColor is still set -- it feeds the LUMINOSITY layer as well as the
        // tint layer, so at Start's tint opacity of 0 it casts the accent
        // through the material instead of washing over it. Removing it entirely
        // took the blue out with the slab, which was one correction too many.
        // The opacities stay untouched at Windows' own 0.0 / 0.9.
        // Start DOES tint blue -- with ColorPrevalence on, the shell applies the
        // accent to it. An earlier theory that Start preserves the backdrop's
        // own hue was wrong: leaving the controller neutral makes the panel pick
        // up the wallpaper and read grey-olive next to a Start menu that is
        // clearly blue. So the accent tint is right, and the difference is
        // strength rather than colour.
        //
        // At Windows' default TintOpacity of 0 the accent only reaches the
        // surface through the luminosity colour, which is a weak path -- enough
        // to tint, not enough to carry. wp-composition-tint is the lever, held
        // well below Fluent's 0.8: that much wash is what made the surface a
        // slab in the first place.
        //
        // Measured from ONE screenshot holding both surfaces at the same moment
        // -- the only comparison that was ever valid here:
        //
        //   panel gutter      #41403F  hue  30  sat 0.016  B-R  -2
        //   start left        #424752  hue 221  sat 0.108  B-R +16
        //   start right pane  #626672  hue 225  sat 0.075  B-R +16
        //   start lower       #3F4453  hue 225  sat 0.137  B-R +20
        //
        // Brightness matched almost exactly (0.251 vs 0.286), so this was never
        // about lightness. The panel simply had no colour. And Start holds
        // B-R +16..+20 across three regions over DIFFERENT parts of the
        // wallpaper: that consistency means its blue is an applied tint strong
        // enough to dominate the backdrop, not the backdrop showing through.
        //
        // Which means reading TintOpacity 0.0 off a fresh DesktopAcrylicController
        // said nothing about Start. Those are the property's UNSET defaults; the
        // shell configures its own. The same caveat was noted for TintColor and
        // then not applied to the opacities.
        //
        // From the sweep over this wallpaper, B-R ~= -20 + 45*t, so B-R +18
        // needs t ~= 0.84 -- essentially Fluent's sc_defaultTintColor alpha of
        // 0.8. The constant was right all along; what made the surface a slab
        // earlier was the decorative sheen shaders, since removed.
        const double tintStrength = [&settings] {
            bool ok = false;
            const double v = settings.get(QStringLiteral("wp-composition-tint"),
                                          QStringLiteral("0.8")).toString().toDouble(&ok);
            return ok ? qBound(0.0, v, 1.0) : 0.8;
        }();
        auto applyTint = [&systemTheme, &compositionHost, tintStrength] {
            const QVariantList palette = systemTheme.accentPalette();
            const QColor tint = palette.size() >= 6 ? palette.at(5).value<QColor>()
                                                    : QColor(0x34, 0x3C, 0x51);
            compositionHost->setTint(tint, static_cast<float>(tintStrength), 0.9f);
            compositionHost->setDarkTheme(!systemTheme.lightTheme());
            qInfo() << "[composition] tint" << tint.name()
                    << "strength" << tintStrength << "luminosity 0.9; dark"
                    << !systemTheme.lightTheme();
        };
        applyTint();
        // Follow accent and light/dark changes live, the same way the in-scene
        // material does.
        QObject::connect(&systemTheme, &SystemTheme::accentChanged, &controller, applyTint);
        QObject::connect(&systemTheme, &SystemTheme::appearanceChanged, &controller, applyTint);

        qInfo() << "[startup] composition host attached";
    } else {
        engine.loadFromModule("QtPanel", "Main");
        if (engine.rootObjects().isEmpty()) {
            qCritical() << "failed to load QML root";
            return 1;
        }

        window = qobject_cast<QQuickWindow*>(engine.rootObjects().constFirst());
        if (!window) {
            qCritical() << "QML root object is not a window";
            return 1;
        }
        controller.setSystemTheme(&systemTheme);
        controller.attach(window);
        qInfo() << "[startup] QML root attached";
    }

    QObject::connect(&instanceServer, &QLocalServer::newConnection, &controller, [&] {
        while (QLocalSocket* peer = instanceServer.nextPendingConnection()) {
            QObject::connect(peer, &QLocalSocket::disconnected, peer, &QObject::deleteLater);
            controller.togglePanel();
        }
    });

    const bool noHelper = parser.isSet(noHelperOption);
    if (noHelper) {
        qInfo() << "[helper] disabled by --no-helper";
    } else {
        helper.start(true);
    }

    // Temporary diagnostic: reproduce the settings-stepper column change and
    // dump scene grabs before/after to verify rendering survives the resize.
    if (parser.isSet(diagFitModeOption)
        && (!diagIslandUrl.isEmpty() || parser.isSet(diagPressReaderOption))) {
        QTimer::singleShot(8000, window, [window, &dataDir] {
            window->grabWindow().save(dataDir + QStringLiteral("/diag-web-island.png"));
            qInfo() << "[diag] web island grab saved, window" << window->geometry();
        });
    } else if (parser.isSet(diagFitModeOption) && startMode == QStringLiteral("base")) {
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
    } else if (parser.isSet(diagFitModeOption)) {
        const int captureDelayMs = startMode == QStringLiteral("live") ? 12000 : 5000;
        QTimer::singleShot(captureDelayMs, window, [window, &dataDir, startMode] {
            const QString path = dataDir + QStringLiteral("/diag-") + startMode
                               + QStringLiteral(".png");
            window->grabWindow().save(path);
            qInfo() << "[diag]" << startMode << "grab saved, window" << window->geometry();
        });
    }

    controller.showPanel();
    if (startMode != QStringLiteral("base")) {
        QVariantMap columnWidths;
        const QVariant rawWidths = settings.get(QStringLiteral("wp-col-widths"));
        if (rawWidths.canConvert<QVariantMap>()) {
            columnWidths = rawWidths.toMap();
        } else {
            const QJsonDocument widthsDocument = QJsonDocument::fromJson(
                rawWidths.toString().toUtf8());
            if (widthsDocument.isObject())
                columnWidths = widthsDocument.object().toVariantMap();
        }
        const int baseColumns = settings.getInt(QStringLiteral("wp-base-columns"), 3);
        int startColumns = baseColumns;
        if (startMode == QStringLiteral("news")) {
            startColumns = settings.getInt(QStringLiteral("wp-news-columns"), baseColumns);
        } else if (startMode == QStringLiteral("monitor")
                   || startMode == QStringLiteral("live")) {
            startColumns = 6;
        }
        controller.fitMode(startMode, startColumns, columnWidths);
    }
    if (!diagIslandUrl.isEmpty()) {
        QTimer::singleShot(350, &controller,
                           [&controller, diagIslandUrl] { controller.openIsland(diagIslandUrl); });
    } else if (parser.isSet(diagPressReaderOption)) {
        QTimer::singleShot(350, &pressReader, &PressReaderService::openCatalog);
    }
    qInfo() << "[startup] ready";
    if (exitAfterOk) {
        qInfo() << "[startup] bounded run; exiting after" << exitAfterMs << "ms";
        QTimer::singleShot(exitAfterMs, &app, &QCoreApplication::quit);
    }
    const int rc = app.exec();
    live.prepareShutdown();
    QEventLoop multimediaShutdownLoop;
    QTimer::singleShot(600, &multimediaShutdownLoop, &QEventLoop::quit);
    multimediaShutdownLoop.exec();
    settings.flush();
    return rc;
}
