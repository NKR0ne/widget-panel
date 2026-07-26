import QtQuick
import QtQuick.Controls
import QtPanel.Native

Item {
    id: drawer

    // Panel content to blur behind the drawer; set by PanelSurface.
    property Item backdropSource: null

    visible: opacity > 0
    opacity: Ui.statusOpen ? 1 : 0
    enabled: Ui.statusOpen
    focus: Ui.statusOpen
    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }
    Keys.onEscapePressed: Ui.closeStatus()

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
            { label: "Starvis", state: Starvis.configured ? "ok" : "setup",
              detail: Starvis.configured ? Starvis.model : "configuration requise" }
        ]
    }

    function rows() {
        return Diagnostics.rows && Diagnostics.rows.length ? Diagnostics.rows : fallbackRows()
    }

    function tone(state) {
        return state === "ok" ? Theme.success
            : state === "error" ? Theme.danger
            : state === "setup" ? Theme.info : Theme.warning
    }

    ScrimBackdrop {
        anchors.fill: parent
        source: drawer.backdropSource
        active: Ui.statusOpen
        dim: 0.52
        MouseArea { anchors.fill: parent; onClicked: Ui.closeStatus() }
    }

    Rectangle {
        width: Math.min(400, parent.width - 24)
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.right: parent.right
        color: Theme.panelSolid
        border.color: Theme.cardStroke

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
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
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
                    onClicked: Ui.closeStatus()
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
                            color: Theme.cardFill
                            border.color: Theme.cardStroke
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
                                    color: Theme.textPrimary
                                    font.pixelSize: Theme.fontSizeCaption
                                    elide: Text.ElideRight
                                }
                                Text {
                                    width: parent.width
                                    text: modelData.detail || modelData.state || ""
                                    color: Theme.textSecondary
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
