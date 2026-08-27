import QtQuick
import QtQuick.Controls
import QtPanel.Native

Item {
    id: drawer

    // Panel content to blur behind the drawer; set by PanelSurface.
    property Item backdropSource: null
    // Qt 6.10.3 can invalidate singleton property caches while this dynamic
    // component is finalized. PanelSurface resolves singletons and passes only
    // ordinary values into the drawer.
    property bool drawerOpen: false
    property int animationDuration: 180
    property color panelColor: "#202633"
    property color rowFill: "#2a3140"
    property color rowStroke: "#465064"
    property color rowTextPrimary: "#f3f6fb"
    property color rowTextSecondary: "#b8c0cd"
    property color rowSuccess: "#34d399"
    property color rowDanger: "#fb7185"
    property color rowInfo: "#60a5fa"
    property color rowWarning: "#fbbf24"
    property int rowCaptionSize: 10
    property int titleSize: 13
    signal closeRequested()

    visible: opacity > 0
    opacity: drawerOpen ? 1 : 0
    enabled: drawerOpen
    focus: drawerOpen
    Behavior on opacity { NumberAnimation { duration: drawer.animationDuration } }
    Keys.onEscapePressed: drawer.closeRequested()

    function fallbackRows() {
        return [
            { label: "Microsoft Graph", state: MsGraph.authState === "ok" ? "ok" : "warn",
              detail: MsGraph.authState === "ok" ? MsGraph.unreadCount + " non lus" : MsGraph.authState },
            { label: "March\u00e9s", state: Stocks.count > 0 ? "ok" : "warn",
              detail: Stocks.count + " valeurs" },
            { label: "Cam\u00e9ra", state: Camera.status === "streaming" ? "ok"
                  : Camera.status === "error" ? "error" : "warn", detail: Camera.status },
            { label: "Station", state: Workstation.connected && !Workstation.stale ? "ok" : "warn",
              detail: Workstation.connected ? (Workstation.stale ? "retard" : "direct") : "hors ligne" },
            { label: "Starvis", state: !Starvis.localModelsEnabled ? "warn"
                  : Starvis.configured ? "ok" : "setup",
              detail: !Starvis.localModelsEnabled ? "modèles locaux désactivés · GPU libéré"
                  : Starvis.configured ? Starvis.model : "configuration requise" }
        ]
    }

    function rows() {
        return Diagnostics.rows && Diagnostics.rows.length ? Diagnostics.rows : fallbackRows()
    }

    function tone(state) {
        return state === "ok" ? drawer.rowSuccess
            : state === "error" ? drawer.rowDanger
            : state === "setup" ? drawer.rowInfo : drawer.rowWarning
    }

    ScrimBackdrop {
        anchors.fill: parent
        source: drawer.backdropSource
        active: drawer.drawerOpen
        dim: 0.52
        MouseArea { anchors.fill: parent; onClicked: drawer.closeRequested() }
    }

    Rectangle {
        width: Math.min(400, parent.width - 24)
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.right: parent.right
        color: drawer.panelColor
        border.color: drawer.rowStroke

        Column {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Row {
                width: parent.width
                height: 30
                Text {
                    width: parent.width - runButton.width - closeButton.width - 12
                    text: "\u00c9tat des services"
                    color: drawer.rowTextPrimary
                    font.pixelSize: drawer.titleSize
                    font.weight: Font.DemiBold
                    anchors.verticalCenter: parent.verticalCenter
                    elide: Text.ElideRight
                }
                IconButton {
                    id: runButton
                    glyph: "\uE72C"
                    tooltip: "Actualiser l'\u00e9tat local"
                    active: Diagnostics.running
                    enabled: !Diagnostics.running
                    onClicked: Diagnostics.refreshSnapshot()
                }
                IconButton {
                    id: closeButton
                    glyph: "\uE8BB"
                    tooltip: "Fermer"
                    onClicked: drawer.closeRequested()
                }
            }

            StatusBanner {
                width: parent.width
                message: Diagnostics.status
                tone: Diagnostics.running ? "info" : "success"
            }

            Flickable {
                width: parent.width
                height: parent.height - y
                contentWidth: width
                contentHeight: serviceColumn.height
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

                Column {
                    id: serviceColumn
                    width: parent.width
                    spacing: 4
                    Repeater {
                        model: drawer.rows()
                        delegate: Rectangle {
                            required property var modelData
                            width: serviceColumn.width
                            height: 48
                            radius: 6
                            color: drawer.rowFill
                            border.color: drawer.rowStroke
                            Rectangle {
                                width: 7; height: 7; radius: 3.5
                                x: 10
                                anchors.verticalCenter: parent.verticalCenter
                                color: drawer.tone(modelData.state)
                            }
                            Column {
                                x: 28
                                width: parent.width - 38
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 2
                                Text {
                                    width: parent.width
                                    text: modelData.label || modelData.id || "Service"
                                    color: drawer.rowTextPrimary
                                    font.pixelSize: drawer.rowCaptionSize
                                    elide: Text.ElideRight
                                }
                                Text {
                                    width: parent.width
                                    text: modelData.detail || modelData.state || ""
                                    color: drawer.rowTextSecondary
                                    font.pixelSize: 9
                                    elide: Text.ElideRight
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
