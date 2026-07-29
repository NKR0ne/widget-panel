import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// Standalone Station workspace. Optional support cards use one logical column;
// selected telemetry cards consume the remaining full-width grid.
Item {
    id: stage

    property int storeRevision: 0
    readonly property int configuredColumns: 6
    readonly property var allowedIds: [
        "clock", "weather", "stocks", "workstation-cpu", "workstation-gpu",
        "workstation-ram", "workstation-disk", "workstation-network",
    ]
    readonly property var activeIds: {
        storeRevision
        let config = {}
        try { config = JSON.parse(Store.get("wp-config", "{}")) } catch (e) {}
        return ModeSettings.activeIds(config, "monitor", allowedIds)
    }
    function isActive(id) {
        return activeIds.indexOf(id) >= 0
    }
    function activeCount(ids) {
        let count = 0
        for (const id of ids) {
            if (isActive(id))
                count++
        }
        return count
    }
    readonly property bool supportEnabled:
        isActive("clock") || isActive("weather") || isActive("stocks")
    readonly property bool telemetryEnabled:
        isActive("workstation-cpu") || isActive("workstation-gpu")
        || isActive("workstation-ram") || isActive("workstation-disk")
        || isActive("workstation-network")
    readonly property int telemetryColumnCount: Math.max(
        1, configuredColumns - (supportEnabled ? 1 : 0))
    readonly property real logicalColumnWidth: Math.max(
        1, (width - (configuredColumns - 1) * 8) / configuredColumns)
    readonly property real railWidth: supportEnabled ? logicalColumnWidth : 0
    readonly property real stageWidth: Math.max(
        1, width - railWidth - (supportEnabled ? 8 : 0))
    readonly property int primaryColumns: Math.max(1, Math.min(
        2, telemetryColumnCount,
        activeCount(["workstation-cpu", "workstation-gpu"])))
    readonly property int secondaryColumns: Math.max(1, Math.min(
        3, telemetryColumnCount,
        activeCount(["workstation-ram", "workstation-disk", "workstation-network"])))

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-config")
                stage.storeRevision++
        }
    }

    Flickable {
        id: supportScroll
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: stage.railWidth
        visible: stage.supportEnabled
        contentHeight: supportColumn.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: supportColumn
            width: supportScroll.width
            spacing: 6

            ClockWidget {
                width: parent.width
                visible: stage.isActive("clock")
            }
            WeatherWidget {
                width: parent.width
                visible: stage.isActive("weather")
            }
            StocksWidget {
                width: parent.width
                visible: stage.isActive("stocks")
            }
        }
    }

    Flickable {
        id: telemetryScroll
        anchors.left: supportScroll.right
        anchors.leftMargin: stage.supportEnabled ? 8 : 0
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        contentHeight: telemetryColumn.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: telemetryColumn
            width: telemetryScroll.width
            spacing: 8

            Row {
                width: parent.width
                height: 24
                spacing: 8

                Text {
                    text: "Station de travail"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                }
                Text {
                    width: Math.max(40, parent.width - x - statusDot.width - 12)
                    text: Workstation.connected
                          ? (Workstation.stale ? "Telemetrie en retard" : "Telemetrie en direct")
                          : "Service hors ligne"
                    color: Theme.textSecondary
                    font.pixelSize: 10
                    elide: Text.ElideRight
                    anchors.verticalCenter: parent.verticalCenter
                }
                Rectangle {
                    id: statusDot
                    width: 7
                    height: 7
                    radius: 3.5
                    color: Workstation.connected && !Workstation.stale
                           ? "#53f0c5" : Qt.rgba(1, 1, 1, 0.28)
                    anchors.verticalCenter: parent.verticalCenter
                }
            }

            Grid {
                id: primaryGrid
                width: parent.width
                columns: stage.primaryColumns
                spacing: 8
                height: childrenRect.height

                WorkstationWidget {
                    id: cpuCard
                    kind: "cpu"
                    visible: stage.isActive("workstation-cpu")
                    width: (primaryGrid.width - (primaryGrid.columns - 1) * primaryGrid.spacing)
                           / primaryGrid.columns
                    height: implicitHeight
                }
                WorkstationWidget {
                    kind: "gpu"
                    visible: stage.isActive("workstation-gpu")
                    width: (primaryGrid.width - (primaryGrid.columns - 1) * primaryGrid.spacing)
                           / primaryGrid.columns
                    height: cpuCard.height
                }
            }

            Grid {
                id: secondaryGrid
                width: parent.width
                columns: stage.secondaryColumns
                spacing: 8
                height: childrenRect.height

                WorkstationWidget {
                    id: ramCard
                    kind: "ram"
                    visible: stage.isActive("workstation-ram")
                    width: (secondaryGrid.width - (secondaryGrid.columns - 1) * secondaryGrid.spacing)
                           / secondaryGrid.columns
                    height: implicitHeight
                }
                WorkstationWidget {
                    kind: "disk"
                    visible: stage.isActive("workstation-disk")
                    width: (secondaryGrid.width - (secondaryGrid.columns - 1) * secondaryGrid.spacing)
                           / secondaryGrid.columns
                    height: ramCard.height
                }
                WorkstationWidget {
                    kind: "network"
                    visible: stage.isActive("workstation-network")
                    width: (secondaryGrid.width - (secondaryGrid.columns - 1) * secondaryGrid.spacing)
                           / secondaryGrid.columns
                    height: ramCard.height
                }
            }

            Text {
                visible: !stage.telemetryEnabled
                width: parent.width
                height: 60
                text: "Aucun moniteur actif"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeBody
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
            }
        }
    }
}
