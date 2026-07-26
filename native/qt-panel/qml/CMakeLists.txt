set_source_files_properties(Theme.qml Motion.qml Ui.qml ModeSettings.qml
    PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(qtpanel_ui
    STATIC
    URI QtPanel
    VERSION 1.0
    QML_FILES
        Main.qml
        PanelSurface.qml
        PanelColumns.qml
        WidgetHost.qml
        GlassCard.qml
        ScrimBackdrop.qml
        GrainOverlay.qml
        IconButton.qml
        CardHeader.qml
        StatusBanner.qml
        ToastOverlay.qml
        DetailWorkspace.qml
        ServiceStatusDrawer.qml
        Theme.qml
        Motion.qml
        Ui.qml
        ModeSettings.qml
        SettingsModal.qml
        SettingsSlider.qml
        SettingsToggle.qml
        ManageWidgetsModal.qml
        ClockWidget.qml
        CalendarWidget.qml
        WeatherWidget.qml
        TrafficWidget.qml
        StocksWidget.qml
        PowerGauge.qml
        TemperatureBar.qml
        WorkstationWidget.qml
        WebIsland.qml
        MonitorStage.qml
        LiveFeedWidget.qml
        LiveDetailView.qml
        LiveStage.qml
        NewsWidget.qml
        NewsStage.qml
        NewsMatrixOverlay.qml
        StarvisWidget.qml
        CameraWidget.qml
        DirectCameraWidget.qml
        PressReaderWidget.qml
        PressReaderSpotlight.qml
        pressreader/PressReaderAutomation.js
        NewsStage3D.qml
        ArticleReaderPane.qml
        ReaderOverlay.qml
        AgendaWidget.qml
        MailWidget.qml
        TodoWidget.qml
        MsStatePane.qml
    RESOURCES
        web/traffic-map.html
        textures/acrylic-noise.png
)

qt_add_shaders(qtpanel_ui "qtpanel_shaders"
    PREFIX "/qt/qml/QtPanel"
    FILES
        effects/panel_depth.frag
        effects/spotlight.frag
)
