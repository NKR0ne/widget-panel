import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// The in-scene half of the show/hide choreography: the native window fades
// while this surface slides, and the window is only hidden after slideOut
// lands (Panel.hideAnimationDone).
Item {
    id: surface

    // base | news | monitor | live — drives both window width (Panel.fitMode)
    // and the column arrangement (PanelColumns).
    property string panelMode: "base"

    function switchMode(mode) {
        if (panelMode === mode)
            return
        panelMode = mode
        let widths = {}
        try { widths = JSON.parse(Store.get("wp-col-widths", "{}")) } catch (e) {}
        Panel.fitMode(mode, Number(Store.get("wp-base-columns", 6)) || 6, widths)
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
                        }
                    }
                }

                Item { Layout.fillWidth: true }
                IconButton {
                    glyph: ""   // GridView: manage widgets
                    onClicked: manageModal.show()
                }
                IconButton {
                    glyph: ""   // Settings gear
                    onClicked: settingsModal.show()
                }
                IconButton {
                    glyph: ""   // Segoe Fluent Icons: Pin
                    active: Panel.pinned
                    onClicked: Panel.togglePin()
                }
                IconButton {
                    glyph: ""   // ChevronLeft: slide the panel away
                    onClicked: Panel.hidePanel(false)
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

    ReaderOverlay {
        anchors.fill: parent
    }

    SettingsModal {
        id: settingsModal
        anchors.fill: parent
    }

    // Web island toolbar: occupies the area beside the panel while the
    // brave-host shell (a native HWND above us) shows the page below it.
    Rectangle {
        visible: Panel.islandOpen
        x: Panel.islandX
        width: parent.width - Panel.islandX
        height: parent.height
        color: Qt.rgba(0.03, 0.04, 0.07, 0.92)
        radius: Theme.radiusPanel

        Row {
            x: 12
            height: 42
            spacing: 8

            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""   // Refresh
                onClicked: Panel.navigateIsland(Panel.islandUrl)
            }
            Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: Math.max(80, (Panel.islandOpen ? surface.width - Panel.islandX : 0) - 150)
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
            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""  // OpenInNewWindow
                onClicked: {
                    Qt.openUrlExternally(Panel.islandUrl)
                    Panel.closeIsland()
                }
            }
            IconButton {
                anchors.verticalCenter: parent.verticalCenter
                glyph: ""  // ChromeClose
                onClicked: Panel.closeIsland()
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
