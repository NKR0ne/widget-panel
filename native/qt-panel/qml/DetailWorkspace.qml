import QtQuick
import QtQuick.Controls
import QtPanel.Native

Item {
    id: workspace

    visible: opacity > 0
    opacity: Ui.detailOpen ? 1 : 0
    enabled: Ui.detailOpen
    focus: Ui.detailOpen

    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }
    Keys.onEscapePressed: Ui.closeDetail()

    function refresh() {
        if (Ui.detailKind === "stocks") {
            Stocks.refresh()
            Stocks.refreshEarnings()
            Stocks.refreshIpos()
            Ui.notify("March\u00e9s actualis\u00e9s", "success")
        } else if (Ui.detailKind === "camera" && Camera.configured) {
            Camera.start()
            Ui.notify("Reconnexion de la cam\u00e9ra", "info")
        }
    }

    function detailStatus() {
        if (Ui.detailKind === "camera")
            return Camera.status === "streaming" ? "EN DIRECT" : Camera.status.toUpperCase()
        if (Ui.detailKind === "station")
            return Workstation.connected && !Workstation.stale ? "EN DIRECT" : "HORS LIGNE"
        if (Ui.detailKind === "traffic")
            return Vault.get("tomtom-key") ? "TRAFIC" : "CARTE"
        if (Ui.detailKind === "stocks")
            return Stocks.count + " VALEURS"
        return ""
    }

    function detailTone() {
        if (Ui.detailKind === "camera")
            return Camera.status === "streaming" ? Theme.success
                : Camera.status === "error" ? Theme.danger : Theme.warning
        if (Ui.detailKind === "station")
            return Workstation.connected && !Workstation.stale ? Theme.success : Theme.warning
        return Theme.info
    }

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0.035, 0.045, 0.065, 0.98)
    }

    Column {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 10

        Row {
            width: parent.width
            height: 34
            spacing: 8

            IconButton {
                glyph: "\uE72B"
                tooltip: "Retour"
                accessibleName: "Fermer le d\u00e9tail"
                onClicked: Ui.closeDetail()
            }
            Column {
                width: Math.max(80, parent.width - x - statusBadge.width - refreshButton.width - 28)
                anchors.verticalCenter: parent.verticalCenter
                spacing: 1
                Text {
                    width: parent.width
                    text: Ui.detailTitle
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                }
                Text {
                    width: parent.width
                    visible: !!(Ui.detailPayload && Ui.detailPayload.subtitle)
                    text: visible ? Ui.detailPayload.subtitle : ""
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }
            }
            Rectangle {
                id: statusBadge
                width: statusText.implicitWidth + 19
                height: 22
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: Theme.cardFill
                border.color: Theme.cardStroke
                Rectangle {
                    width: 6; height: 6; radius: 3
                    color: workspace.detailTone()
                    anchors.left: parent.left
                    anchors.leftMargin: 6
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    id: statusText
                    anchors.right: parent.right
                    anchors.rightMargin: 6
                    anchors.verticalCenter: parent.verticalCenter
                    text: workspace.detailStatus()
                    color: Theme.textSecondary
                    font.pixelSize: 8
                }
            }
            IconButton {
                id: refreshButton
                visible: Ui.detailKind === "stocks" || Ui.detailKind === "camera"
                glyph: "\uE72C"
                tooltip: "Actualiser"
                onClicked: workspace.refresh()
            }
        }

        Rectangle { width: parent.width; height: 1; color: Theme.cardStroke }

        Flickable {
            id: scroller
            width: parent.width
            height: parent.height - y
            contentWidth: width
            contentHeight: detailLoader.item ? detailLoader.item.implicitHeight : 0
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            Loader {
                id: detailLoader
                width: scroller.width
                sourceComponent: Ui.detailKind === "stocks" ? stocksDetail
                    : Ui.detailKind === "camera" ? cameraDetail
                    : Ui.detailKind === "station" ? stationDetail
                    : Ui.detailKind === "traffic" ? trafficDetail : emptyDetail
            }
        }
    }

    Component {
        id: stocksDetail
        StocksWidget { width: parent ? parent.width : 0; detailMode: true }
    }
    Component {
        id: cameraDetail
        CameraWidget { width: parent ? parent.width : 0; detailMode: true }
    }
    Component {
        id: stationDetail
        WorkstationWidget {
            width: parent ? parent.width : 0
            detailMode: true
            kind: Ui.detailPayload && Ui.detailPayload.kind ? Ui.detailPayload.kind : "cpu"
        }
    }
    Component {
        id: trafficDetail
        TrafficWidget { width: parent ? parent.width : 0; detailMode: true }
    }
    Component {
        id: emptyDetail
        Text {
            width: parent ? parent.width : 0
            height: 120
            text: "D\u00e9tail indisponible"
            color: Theme.textSecondary
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }
}
