set_source_files_properties(Theme.qml Motion.qml Ui.qml
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
        IconButton.qml
        Theme.qml
        Motion.qml
        Ui.qml
        SettingsModal.qml
        SettingsSlider.qml
        ManageWidgetsModal.qml
        ClockWidget.qml
        CalendarWidget.qml
        WeatherWidget.qml
        TrafficWidget.qml
        StocksWidget.qml
        WorkstationWidget.qml
        LiveFeedWidget.qml
        NewsWidget.qml
        NewsModeView.qml
        ArticleReaderCard.qml
        BrowserSpotlightCard.qml
        StarvisWidget.qml
        CameraWidget.qml
        PressReaderWidget.qml
        NewsStage3D.qml
        ReaderOverlay.qml
        AgendaWidget.qml
        MailWidget.qml
        TodoWidget.qml
        MsStatePane.qml
)

qt_add_shaders(qtpanel_ui "qtpanel_shaders"
    PREFIX "/qt/qml/QtPanel"
    FILES
        effects/panel_depth.frag
        effects/spotlight.frag
)
