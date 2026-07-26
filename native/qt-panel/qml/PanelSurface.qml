import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// The surface stays fixed inside the native window. PanelWindowController
// moves the whole window so the acrylic backdrop never remains behind as an
// empty rectangle during show/hide transitions.
Item {
    id: surface

    Shortcut { sequence: "Ctrl+1"; onActivated: surface.switchMode("base") }
    Shortcut { sequence: "Ctrl+2"; onActivated: surface.switchMode("news") }
    Shortcut { sequence: "Ctrl+3"; onActivated: surface.switchMode("monitor") }
    Shortcut { sequence: "Ctrl+4"; onActivated: surface.switchMode("live") }
    Shortcut { sequence: "Ctrl+5"; onActivated: PressReader.toggle() }
    Shortcut { sequence: "Ctrl+R"; onActivated: surface.refreshData() }
    Shortcut { sequence: "Ctrl+Comma"; onActivated: settingsModal.show() }

    // base | news | monitor | live — drives both window width (Panel.fitMode)
    // and the column arrangement (PanelColumns).
    property string panelMode: StartupMode
    property string modeSwitchError: ""
    property int storeRevision: 0
    readonly property int columnCount: {
        storeRevision
        if (panelMode === "monitor" || panelMode === "live")
            return 6
        const key = panelMode === "news" ? "wp-news-columns" : "wp-base-columns"
        const fallback = Number(Store.get("wp-base-columns", 3)) || 3
        return Math.max(3, Math.min(6, Number(Store.get(key, fallback)) || fallback))
    }
    readonly property real newsUiScale: {
        storeRevision
        return Math.max(0.85, Math.min(1.35,
            Number(Store.get("wp-news-ui-scale", 1.0)) || 1.0))
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-base-columns" || key === "wp-news-columns"
                    || key === "wp-news-ui-scale")
                surface.storeRevision++
        }
    }

    function fitCurrentWindowMode(mode) {
        let widths = {}
        try { widths = JSON.parse(Store.get("wp-col-widths", "{}")) } catch (e) {}
        let count = Number(Store.get("wp-base-columns", 3)) || 3
        if (mode === "news")
            count = Number(Store.get("wp-news-columns", count)) || count
        else if (mode === "monitor" || mode === "live")
            count = 6
        return Panel.fitMode(mode, Math.max(3, Math.min(6, count)), widths)
    }

    function switchMode(mode) {
        const targetMode = (panelMode === mode && mode !== "base") ? "base" : mode
        if (panelMode === targetMode)
            return
        const previousMode = panelMode
        Reader.close()
        if (Ui.detailOpen)
            Ui.closeDetail()
        if (Live.detailOpen)
            Live.closeDetail()
        if (Panel.islandOpen)
            Panel.closeIsland()
        panelMode = targetMode
        modeSwitchError = ""
        if (!fitCurrentWindowMode(targetMode)) {
            panelMode = previousMode
            fitCurrentWindowMode(previousMode)
            modeSwitchError = "Mode indisponible"
        }
    }

    function adjustColumns(delta) {
        if (panelMode === "monitor" || panelMode === "live")
            return
        const next = Math.max(3, Math.min(6, columnCount + delta))
        if (next === columnCount)
            return
        Store.set(panelMode === "news" ? "wp-news-columns" : "wp-base-columns", next)
        fitCurrentWindowMode(panelMode)
    }

    function adjustNewsUiScale(delta) {
        const next = Math.max(0.85, Math.min(1.35,
            Math.round((newsUiScale + delta) * 20) / 20))
        if (Math.abs(next - newsUiScale) < 0.001)
            return
        Store.set("wp-news-ui-scale", next)
    }

    function refreshData() {
        Ui.notify("Actualisation en cours", "info")
        Weather.refresh()
        Stocks.refresh()
        Stocks.refreshEarnings()
        Stocks.refreshIpos()
        News.refresh()
        MsGraph.refreshAll()
        if (panelMode === "live") {
            for (const id of Live.feedIds())
                Live.resolve(id, true)
        }
        SoundFx.tap()
    }

    Rectangle {
        id: chrome
        anchors.fill: parent
        radius: Theme.radiusPanel
        color: Theme.bgTint
        border.color: Theme.cardStroke
        border.width: 1
        clip: true

        // GPU depth/sheen/grain layer (qsb shader, Vulkan RHI). Behind content;
        // if the shader fails to load it simply shows the flat bgTint. The
        // accent glow tracks the pointer for a tactile, "alive" surface.
        ShaderEffect {
            id: depthFx
            anchors.fill: parent
            visible: Ui.surfaceLighting
            property real time: 0
            property real aspect: width / Math.max(1, height)
            property real cursorX: 0.5
            property real cursorY: 0.3
            property real cursorOn: Ui.surfaceLighting && Ui.mouseHalo && panelHover.hovered ? 1 : 0
            property real lightingStrength: Ui.lightingStrength
            property color accentColor: Theme.accent
            fragmentShader: "effects/panel_depth.frag.qsb"
            NumberAnimation on time {
                running: Panel.panelVisible && Motion.decorativeEnabled
                from: 0; to: 100000; duration: 100000000; loops: Animation.Infinite
            }
            Behavior on cursorOn { NumberAnimation { duration: Motion.normalMs } }
            // Smooth the glow's travel so it eases toward the pointer.
            Behavior on cursorX { NumberAnimation { duration: 220; easing.type: Easing.OutQuad } }
            Behavior on cursorY { NumberAnimation { duration: 220; easing.type: Easing.OutQuad } }
        }

        HoverHandler {
            id: panelHover
            enabled: Ui.surfaceLighting && Ui.mouseHalo
            onPointChanged: {
                depthFx.cursorX = point.position.x / Math.max(1, chrome.width)
                depthFx.cursorY = point.position.y / Math.max(1, chrome.height)
            }
        }

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: 14
            anchors.rightMargin: 14
            height: 1
            z: 2
            visible: Ui.surfaceLighting
            opacity: 0.55 * Ui.lightingStrength
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0.0; color: "transparent" }
                GradientStop { position: 0.18; color: Theme.keylineMuted }
                GradientStop { position: 0.5; color: Theme.keyline }
                GradientStop { position: 0.82; color: Theme.keylineMuted }
                GradientStop { position: 1.0; color: "transparent" }
            }
        }

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.leftMargin: Theme.radiusPanel
            anchors.rightMargin: Theme.radiusPanel
            height: 1
            z: 2
            visible: Ui.surfaceLighting
            color: Qt.rgba(0, 0, 0, 0.28 * Math.min(1, Ui.shadowDepth))
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Theme.gap
            spacing: Theme.gap

            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                Text {
                    text: "Widget Panel"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                }
                Rectangle {
                    visible: false
                    width: apiLabel.implicitWidth + 12
                    height: apiLabel.implicitHeight + 6
                    radius: height / 2
                    color: Theme.cardFill
                    border.color: Theme.cardStroke
                    Text {
                        id: apiLabel
                        anchors.centerIn: parent
                        text: Panel.graphicsApiName
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                    }
                }
                Item { implicitWidth: 10; implicitHeight: 1 }

                // Mode switcher
                Item {
                    id: modeSwitcher
                    readonly property var modeIds: ["base", "news", "monitor", "live"]
                    readonly property int selectedIndex: modeIds.indexOf(surface.panelMode)
                    implicitWidth: modeRow.implicitWidth
                    implicitHeight: 20

                    function syncSelection() {
                        const selected = modeRepeater.itemAt(selectedIndex)
                        if (!selected)
                            return
                        modeSelection.x = selected.x
                        modeSelection.width = selected.width
                    }

                    onSelectedIndexChanged: Qt.callLater(syncSelection)
                    Component.onCompleted: Qt.callLater(syncSelection)

                    Rectangle {
                        id: modeSelection
                        x: 0
                        width: 0
                        height: parent.height
                        radius: 5
                        color: Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.15)
                        border.width: 1
                        border.color: Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.30)
                        Behavior on x {
                            NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic }
                        }
                        Behavior on width {
                            NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic }
                        }
                    }

                    Row {
                        id: modeRow
                        spacing: 2
                        Repeater {
                            id: modeRepeater
                            model: [
                            { id: "base", label: "Panneau" },
                            { id: "news", label: "Nouvelles" },
                            { id: "monitor", label: "Station" },
                            { id: "live", label: "Direct" },
                        ]
                            delegate: Rectangle {
                            required property var modelData
                            width: modeLabel.implicitWidth + 14
                            height: 20
                            radius: 5
                            color: surface.panelMode !== modelData.id && modeMouse.containsMouse
                                   ? Theme.hover : "transparent"
                            border.width: activeFocus ? 1 : 0
                            border.color: Theme.accent
                            activeFocusOnTab: true
                            Accessible.role: Accessible.Button
                            Accessible.name: "Mode " + modelData.label
                            Behavior on color { ColorAnimation { duration: Motion.fastMs } }

                            Text {
                                id: modeLabel
                                anchors.centerIn: parent
                                text: parent.modelData.label
                                color: surface.panelMode === parent.modelData.id
                                       ? Theme.textPrimary : Theme.textSecondary
                                font.pixelSize: 10
                            }
                            MouseArea {
                                id: modeMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: surface.switchMode(parent.modelData.id)
                            }
                            Keys.onReturnPressed: surface.switchMode(modelData.id)
                            Keys.onEnterPressed: surface.switchMode(modelData.id)
                            Keys.onSpacePressed: surface.switchMode(modelData.id)
                            }
                        }
                    }
                }

                Text {
                    visible: surface.modeSwitchError !== ""
                    text: surface.modeSwitchError
                    color: "#fca5a5"
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }

                Row {
                    spacing: 2
                    Layout.alignment: Qt.AlignVCenter
                    visible: surface.panelMode === "base" || surface.panelMode === "news"

                    Rectangle {
                        width: 20; height: 20; radius: 5
                        opacity: surface.columnCount > 3 ? 1 : 0.35
                        color: fewerMouse.containsMouse ? Theme.hover : "transparent"
                        Text {
                            anchors.centerIn: parent
                            text: "-"
                            color: Theme.textSecondary
                            font.pixelSize: 13
                        }
                        MouseArea {
                            id: fewerMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            enabled: surface.columnCount > 3
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: surface.adjustColumns(-1)
                        }
                    }
                    Text {
                        width: 14
                        text: surface.columnCount
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        horizontalAlignment: Text.AlignHCenter
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Rectangle {
                        width: 20; height: 20; radius: 5
                        opacity: surface.columnCount < 6 ? 1 : 0.35
                        color: moreMouse.containsMouse ? Theme.hover : "transparent"
                        Text {
                            anchors.centerIn: parent
                            text: "+"
                            color: Theme.textSecondary
                            font.pixelSize: 13
                        }
                        MouseArea {
                            id: moreMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            enabled: surface.columnCount < 6
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: surface.adjustColumns(1)
                        }
                    }
                }

                Row {
                    visible: surface.panelMode === "news"
                    spacing: 2
                    Layout.alignment: Qt.AlignVCenter

                    Rectangle {
                        width: 26; height: 20; radius: 5
                        opacity: surface.newsUiScale > 0.85 ? 1 : 0.35
                        color: smallerNewsMouse.containsMouse ? Theme.hover : "transparent"
                        Text {
                            anchors.centerIn: parent
                            text: "A-"
                            color: Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: smallerNewsMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            enabled: surface.newsUiScale > 0.85
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: surface.adjustNewsUiScale(-0.1)
                        }
                    }
                    Rectangle {
                        width: 26; height: 20; radius: 5
                        opacity: surface.newsUiScale < 1.35 ? 1 : 0.35
                        color: largerNewsMouse.containsMouse ? Theme.hover : "transparent"
                        Text {
                            anchors.centerIn: parent
                            text: "A+"
                            color: Theme.textSecondary
                            font.pixelSize: 10
                        }
                        MouseArea {
                            id: largerNewsMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            enabled: surface.newsUiScale < 1.35
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: surface.adjustNewsUiScale(0.1)
                        }
                    }
                }

                Item { Layout.fillWidth: true }
                IconButton {
                    glyph: "\uE82D"
                    active: PressReader.open
                    onClicked: PressReader.toggle()
                    tooltip: "PressReader"
                }
                IconButton {
                    glyph: "\uE9D9"
                    onClicked: Ui.openStatus()
                    tooltip: "\u00c9tat des services"
                }
                IconButton {
                    glyph: "\uE72C"
                    onClicked: surface.refreshData()
                    tooltip: "Actualiser les donn\u00e9es"
                }
                IconButton {
                    glyph: ""   // GridView: manage widgets
                    onClicked: manageModal.show(surface.panelMode)
                    tooltip: "G\u00e9rer les widgets"
                }
                IconButton {
                    glyph: ""   // Settings gear
                    onClicked: settingsModal.show()
                    tooltip: "R\u00e9glages"
                }
                IconButton {
                    glyph: ""   // Segoe Fluent Icons: Pin
                    active: Panel.pinned
                    onClicked: Panel.togglePin()
                    tooltip: Panel.pinned ? "D\u00e9s\u00e9pingler" : "\u00c9pingler"
                }
                IconButton {
                    glyph: ""   // ChevronLeft: slide the panel away
                    onClicked: Panel.hidePanel(false)
                    tooltip: "Masquer le panneau"
                }
            }

            PanelColumns {
                Layout.fillWidth: true
                Layout.fillHeight: true
                mode: surface.panelMode
            }
        }

        // Cursor-tracked specular pool over the cards (additive, input-transparent).
        ShaderEffect {
            anchors.fill: parent
            z: 50
            visible: Ui.surfaceLighting && Ui.mouseHalo
            property real aspect: width / Math.max(1, height)
            property real cursorX: depthFx.cursorX
            property real cursorY: depthFx.cursorY
            property real cursorOn: depthFx.cursorOn
            property real lightingStrength: Ui.lightingStrength
            property color accentColor: Theme.accent
            fragmentShader: "effects/spotlight.frag.qsb"
            blending: true
        }
    }

    DetailWorkspace {
        anchors.fill: parent
        z: 68
    }

    LiveDetailView {
        anchors.fill: parent
        z: 70
    }

    ReaderOverlay {
        anchors.fill: parent
        presentationEnabled: surface.panelMode !== "news"
        backdropSource: chrome
    }

    NewsMatrixOverlay {
        anchors.fill: parent
        backdropSource: chrome
    }

    SettingsModal {
        id: settingsModal
        anchors.fill: parent
        backdropSource: chrome
    }

    ManageWidgetsModal {
        id: manageModal
        anchors.fill: parent
        backdropSource: chrome
    }

    ServiceStatusDrawer {
        anchors.fill: parent
        z: 90
        backdropSource: chrome
    }

    ToastOverlay {
        anchors.fill: parent
        z: 200
    }

    // Retained only as a non-instantiated layout reference while WebIsland
    // owns the active Qt WebEngine surface below.
    Rectangle {
        id: islandChrome
        visible: false
        x: Panel.islandX
        width: parent.width - Panel.islandX
        height: parent.height
        color: Qt.rgba(0.03, 0.04, 0.07, 0.92)
        radius: Theme.radiusPanel

        Row {
            x: 12
            width: parent.width - 24
            height: 42
            spacing: 8

            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""   // ChevronLeft / Back
                enabled: Panel.islandCanGoBack && !Panel.islandLoading
                onClicked: Panel.backIsland()
                tooltip: "Retour"
            }
            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""   // ChevronRight / Forward
                enabled: Panel.islandCanGoForward && !Panel.islandLoading
                onClicked: Panel.forwardIsland()
                tooltip: "Suivant"
            }
            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""   // Refresh
                enabled: !Panel.islandLoading
                onClicked: Panel.reloadIsland()
                tooltip: "Actualiser"
            }
            Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: Math.max(80, (Panel.islandOpen ? surface.width - Panel.islandX : 0) - 370)
                height: 26
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.06)
                border.color: addr.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: addr
                    anchors.fill: parent
                    anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    clip: true
                    text: Panel.islandUrl
                    onAccepted: Panel.navigateIsland(text)
                }
            }
            Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 5
                width: 132
                height: 26
                Rectangle {
                    width: 7
                    height: 7
                    radius: 3.5
                    anchors.verticalCenter: parent.verticalCenter
                    color: Panel.islandError !== "" ? "#f87171"
                         : Panel.islandLoading ? "#fbbf24" : "#34d399"
                }
                Text {
                    width: parent.width - 12
                    anchors.verticalCenter: parent.verticalCenter
                    text: Panel.islandError !== "" ? Panel.islandError
                          : Panel.islandLoading ? Panel.islandStatus
                          : Panel.islandTitle !== "" ? Panel.islandTitle
                          : Panel.islandStatus !== "" ? Panel.islandStatus : "Ready"
                    color: Panel.islandError !== "" ? "#fca5a5" : Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }
            }
            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""  // OpenInNewWindow
                onClicked: {
                    Panel.openExternal(Panel.islandUrl)
                    Panel.closeIsland()
                }
                tooltip: "Ouvrir dans le navigateur"
            }
            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""  // ChromeClose
                onClicked: Panel.closeIsland()
                tooltip: "Fermer"
            }
        }

        Rectangle {
            visible: Panel.islandLoading
            x: 0
            y: 40
            width: parent.width
            height: 2
            color: Qt.rgba(1, 1, 1, 0.06)
            clip: true
            Rectangle {
                id: islandLoadPulse
                width: Math.max(64, islandChrome.width * 0.26)
                height: parent.height
                radius: 1
                color: Theme.accent
                NumberAnimation on x {
                    running: false
                    loops: Animation.Infinite
                    from: -islandLoadPulse.width
                    to: islandChrome.width
                    duration: 950
                    easing.type: Easing.InOutQuad
                }
            }
        }
    }

    // Right-edge resize handle; the controller polls the cursor globally so
    // the drag keeps working past the window edge.
    MouseArea {
        width: 6
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.right: parent.right
        cursorShape: Qt.SizeHorCursor
        onPressed: Panel.startResize()
        onReleased: Panel.endResize()
    }
}
