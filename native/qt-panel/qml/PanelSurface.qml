import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// The in-scene half of the show/hide choreography: the native window fades
// while this surface slides, and the window is only hidden after slideOut
// lands (Panel.hideAnimationDone).
Item {
    id: surface

    Shortcut { sequence: "Ctrl+1"; onActivated: surface.switchMode("base") }
    Shortcut { sequence: "Ctrl+2"; onActivated: surface.switchMode("news") }
    Shortcut { sequence: "Ctrl+3"; onActivated: surface.switchMode("monitor") }
    Shortcut { sequence: "Ctrl+4"; onActivated: surface.switchMode("live") }
    Shortcut { sequence: "Ctrl+R"; onActivated: surface.refreshData() }
    Shortcut { sequence: "Ctrl+Comma"; onActivated: settingsModal.show() }

    // base | news | monitor | live — drives both window width (Panel.fitMode)
    // and the column arrangement (PanelColumns).
    property string panelMode: StartupMode
    property string modeSwitchError: ""
    property int storeRevision: 0
    readonly property int baseColumnCount: {
        storeRevision
        return Math.max(3, Math.min(6, Number(Store.get("wp-base-columns", 3)) || 3))
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-base-columns")
                surface.storeRevision++
        }
    }

    function fitCurrentWindowMode(mode) {
        let widths = {}
        try { widths = JSON.parse(Store.get("wp-col-widths", "{}")) } catch (e) {}
        return Panel.fitMode(mode, Number(Store.get("wp-base-columns", 3)) || 3, widths)
    }

    function switchMode(mode) {
        const targetMode = (panelMode === mode && mode !== "base") ? "base" : mode
        if (panelMode === targetMode)
            return
        const previousMode = panelMode
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

    function adjustBaseColumns(delta) {
        const next = Math.max(3, Math.min(6, baseColumnCount + delta))
        if (next === baseColumnCount)
            return
        Store.set("wp-base-columns", next)
        fitCurrentWindowMode("base")
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

    // Resting x must NOT be bound to surface.width: the binding would fire on
    // every window resize (fit modes, column changes) and yank the whole
    // surface off-screen. Off-screen starts come from slideIn.from instead,
    // which is re-evaluated each time the animation starts.
    transform: Translate {
        id: slide
        x: 0
    }

    NumberAnimation {
        id: slideIn
        target: slide
        property: "x"
        from: -(surface.width + 24)
        to: 0
        duration: Motion.panelMs
        easing.type: Easing.BezierSpline
        easing.bezierCurve: Motion.emphasized
    }

    NumberAnimation {
        id: slideOut
        target: slide
        property: "x"
        to: -(surface.width + 24)
        duration: Motion.panelMs
        easing.type: Easing.BezierSpline
        easing.bezierCurve: Motion.exit
        onFinished: Panel.hideAnimationDone()
    }

    Connections {
        target: Panel
        function onSlideInRequested() {
            slideOut.stop()
            slideIn.restart()
        }
        function onSlideOutRequested() {
            slideIn.stop()
            slideOut.restart()
        }
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
            property real time: 0
            property real aspect: width / Math.max(1, height)
            property real cursorX: 0.5
            property real cursorY: 0.3
            property real cursorOn: 0
            fragmentShader: "effects/panel_depth.frag.qsb"
            NumberAnimation on time {
                running: Panel.panelVisible && Motion.enabled
                from: 0; to: 100000; duration: 100000000; loops: Animation.Infinite
            }
            Behavior on cursorOn { NumberAnimation { duration: Motion.normalMs } }
            // Smooth the glow's travel so it eases toward the pointer.
            Behavior on cursorX { NumberAnimation { duration: 220; easing.type: Easing.OutQuad } }
            Behavior on cursorY { NumberAnimation { duration: 220; easing.type: Easing.OutQuad } }
        }

        HoverHandler {
            id: panelHover
            onPointChanged: {
                depthFx.cursorX = point.position.x / Math.max(1, chrome.width)
                depthFx.cursorY = point.position.y / Math.max(1, chrome.height)
            }
            onHoveredChanged: depthFx.cursorOn = hovered ? 1 : 0
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
                Item { width: 10; height: 1 }

                // Mode switcher
                Row {
                    spacing: 2
                    Repeater {
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
                            color: surface.panelMode === modelData.id ? Theme.activeFill
                                 : modeMouse.containsMouse ? Theme.hover : "transparent"
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

                Text {
                    visible: surface.modeSwitchError !== ""
                    text: surface.modeSwitchError
                    color: "#fca5a5"
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }

                Row {
                    visible: surface.panelMode === "base"
                    spacing: 2
                    Layout.alignment: Qt.AlignVCenter

                    Rectangle {
                        width: 20; height: 20; radius: 5
                        opacity: surface.baseColumnCount > 3 ? 1 : 0.35
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
                            enabled: surface.baseColumnCount > 3
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: surface.adjustBaseColumns(-1)
                        }
                    }
                    Text {
                        width: 14
                        text: surface.baseColumnCount
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        horizontalAlignment: Text.AlignHCenter
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Rectangle {
                        width: 20; height: 20; radius: 5
                        opacity: surface.baseColumnCount < 6 ? 1 : 0.35
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
                            enabled: surface.baseColumnCount < 6
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: surface.adjustBaseColumns(1)
                        }
                    }
                }

                Item { Layout.fillWidth: true }
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
            property real aspect: width / Math.max(1, height)
            property real cursorX: depthFx.cursorX
            property real cursorY: depthFx.cursorY
            property real cursorOn: depthFx.cursorOn
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
    }

    NewsMatrixOverlay {
        anchors.fill: parent
    }

    SettingsModal {
        id: settingsModal
        anchors.fill: parent
    }

    ManageWidgetsModal {
        id: manageModal
        anchors.fill: parent
    }

    ServiceStatusDrawer {
        anchors.fill: parent
        z: 90
    }

    ToastOverlay {
        anchors.fill: parent
        z: 200
    }

    // Web island toolbar: occupies the area beside the panel while the
    // brave-host shell (a native HWND above us) shows the page below it.
    Rectangle {
        id: islandChrome
        visible: Panel.islandOpen
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
                    running: Panel.islandLoading
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
