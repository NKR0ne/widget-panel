import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Outlook Mail"
    implicitHeight: body.implicitHeight + 24

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

        Row {
            width: parent.width
            spacing: 6
            Text {
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
            }
            Rectangle {
                visible: MsGraph.unreadCount > 0
                width: unreadLabel.implicitWidth + 10
                height: 14
                radius: 7
                color: "#0078d4"
                anchors.verticalCenter: parent.verticalCenter
                Text {
                    id: unreadLabel
                    anchors.centerIn: parent
                    text: MsGraph.unreadCount
                    color: "#ffffff"
                    font.pixelSize: 9
                    font.weight: Font.DemiBold
                }
            }
        }

        MsStatePane { width: parent.width }

        Repeater {
            // Show the 8 most recent; unread first is Graph's natural order anyway.
            model: MsGraph.mailMessages.slice(0, 8)

            delegate: Item {
                id: row
                required property var modelData
                width: body.width
                height: lines.implicitHeight + 6

                Rectangle {
                    anchors.fill: parent
                    anchors.margins: -3
                    radius: 6
                    color: rowMouse.containsMouse ? Theme.hover : "transparent"
                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                }

                Rectangle {
                    id: dot
                    width: 6; height: 6; radius: 3
                    anchors.top: parent.top
                    anchors.topMargin: 5
                    color: row.modelData.isRead ? "transparent" : "#0078d4"
                }

                Column {
                    id: lines
                    anchors.left: dot.right
                    anchors.leftMargin: 7
                    anchors.right: parent.right
                    spacing: 1

                    Row {
                        width: parent.width
                        spacing: 6
                        Text {
                            width: parent.width - timeLabel.implicitWidth - 6
                            text: row.modelData.from
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeCaption
                            font.weight: row.modelData.isRead ? Font.Normal : Font.DemiBold
                            elide: Text.ElideRight
                        }
                        Text {
                            id: timeLabel
                            text: row.modelData.time
                            color: Theme.textSecondary
                            font.pixelSize: 9
                        }
                    }
                    Text {
                        width: parent.width
                        text: row.modelData.subject
                        color: row.modelData.isRead ? Theme.textSecondary : Theme.textPrimary
                        font.pixelSize: 10
                        elide: Text.ElideRight
                    }
                }

                MouseArea {
                    id: rowMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (!row.modelData.isRead)
                            MsGraph.markMailRead(row.modelData.id)
                        Qt.openUrlExternally(row.modelData.webLink)
                    }
                }
            }
        }
    }
}
