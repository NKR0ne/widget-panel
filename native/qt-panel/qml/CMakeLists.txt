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
        acrylic.js
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
        NewsArticleVisual.qml
        NewsWidget.qml
        NewsStage.qml
        NewsMatrixOverlay.qml
        StarvisWidget.qml
        StarvisStage.qml
        StarvisAvatar.qml
        StarvisAvatar3D.qml
        StarvisAvatar2D.qml
        StarvisVoicePanel.qml
        StarvisSentryPanel.qml
        StarvisVisionPanel.qml
        StarvisLiveView.qml
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
        # Quick3D CustomMaterial snippets are compiled at runtime by Quick3D —
        # they must NOT go through qt_add_shaders/qsb.
        effects/avatar.vert
        effects/avatar.frag
)

qt_add_shaders(qtpanel_ui "qtpanel_shaders"
    PREFIX "/qt/qml/QtPanel"
    FILES
        effects/panel_depth.frag
        effects/spotlight.frag
)
