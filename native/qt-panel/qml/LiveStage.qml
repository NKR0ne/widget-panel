import QtQuick
import QtPanel.Native

// Coordinated Direct workspace. All feeds share Live.audioFeedId, so only one
// MediaPlayer can own audio while the grid remains active.
Item {
    id: stage

    property int storeRevision: 0
    readonly property var activeIds: {
        storeRevision
        let config = {}
        try { config = JSON.parse(Store.get("wp-config", "{}")) } catch (e) {}
        return config.activeIds || []
    }
    readonly property var feeds: {
        const all = Live.feedIds()
        if (activeIds.length === 0)
            return all
        return all.filter(id => activeIds.indexOf(id) >= 0)
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-config")
                stage.storeRevision++
        }
    }

    function refreshAll() {
        for (const id of feeds)
            Live.resolve(id, true)
    }

    Component.onDestruction: Live.requestAudio("")

    Column {
        anchors.fill: parent
        spacing: 8

        Row {
            width: parent.width
            height: 28
            spacing: 8

            Text {
                text: "Direct"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeTitle
                font.weight: Font.DemiBold
                anchors.verticalCenter: parent.verticalCenter
            }
            Text {
                width: Math.max(60, parent.width - x - refreshButton.width - muteButton.width - 16)
                text: Live.audioFeedId === ""
                      ? feeds.length + " flux / audio coupe"
                      : feeds.length + " flux / audio: " + Live.title(Live.audioFeedId)
                color: Theme.textSecondary
                font.pixelSize: 10
                elide: Text.ElideRight
                anchors.verticalCenter: parent.verticalCenter
            }
            Rectangle {
                id: refreshButton
                width: refreshLabel.implicitWidth + 16
                height: 24
                radius: 6
                color: refreshMouse.containsMouse ? Theme.activeFill : Theme.cardFill
                border.color: refreshMouse.containsMouse ? Theme.accent : Theme.cardStroke
                Text {
                    id: refreshLabel
                    anchors.centerIn: parent
                    text: "Actualiser"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: refreshMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: stage.refreshAll()
                }
            }
            Rectangle {
                id: muteButton
                width: muteLabel.implicitWidth + 16
                height: 24
                radius: 6
                color: muteMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text {
                    id: muteLabel
                    anchors.centerIn: parent
                    text: "Couper audio"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: muteMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Live.requestAudio("")
                }
            }
        }

        Flickable {
            id: liveScroll
            width: parent.width
            height: parent.height - y
            contentHeight: liveGrid.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Grid {
                id: liveGrid
                width: liveScroll.width
                columns: width >= 920 ? 2 : 1
                spacing: 8

                Repeater {
                    model: stage.feeds
                    delegate: LiveFeedWidget {
                        required property string modelData
                        feedId: modelData
                        width: (liveGrid.width - Math.max(0, liveGrid.columns - 1) * liveGrid.spacing)
                               / liveGrid.columns
                    }
                }
            }

            Text {
                visible: stage.feeds.length === 0
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: 32
                text: "Aucun flux actif"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeBody
            }
        }
    }
}
