import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Outlook Agenda"
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
                visible: MsGraph.authState === "ok"
                width: 6; height: 6; radius: 3
                color: "#34d399"
                anchors.verticalCenter: parent.verticalCenter
            }
        }

        MsStatePane { width: parent.width }

        // Calendar selection chips
        Flow {
            width: parent.width
            spacing: 4
            visible: MsGraph.authState === "ok" && MsGraph.calendars.length > 0
            Repeater {
                model: MsGraph.calendars
                delegate: Rectangle {
                    required property var modelData
                    readonly property bool on: MsGraph.selectedCalendarIds.length === 0
                        || MsGraph.selectedCalendarIds.indexOf(modelData.id) >= 0
                    height: 16
                    width: calName.implicitWidth + 18
                    radius: 8
                    color: on ? Qt.rgba(1, 1, 1, 0.10) : "transparent"
                    border.color: on ? modelData.color : Theme.cardStroke
                    Row {
                        anchors.centerIn: parent
                        spacing: 4
                        Rectangle { width: 6; height: 6; radius: 3; color: modelData.color
                                    anchors.verticalCenter: parent.verticalCenter }
                        Text { id: calName; text: modelData.name
                               color: on ? Theme.textPrimary : Theme.textSecondary
                               font.pixelSize: 9; anchors.verticalCenter: parent.verticalCenter }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: MsGraph.toggleCalendar(modelData.id) }
                }
            }
        }

        Text {
            visible: MsGraph.authState === "ok" && MsGraph.agendaEvents.length === 0
            text: "Aucun événement à venir"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }

        Repeater {
            model: MsGraph.agendaEvents

            delegate: Row {
                id: row
                required property var modelData
                width: body.width
                spacing: 8

                Rectangle {
                    width: 3
                    height: lines.implicitHeight
                    radius: 1.5
                    color: row.modelData.color ? row.modelData.color
                         : row.modelData.isToday ? Theme.accent : Qt.rgba(1, 1, 1, 0.15)
                }
                Column {
                    id: lines
                    width: parent.width - 11
                    spacing: 1
                    Text {
                        width: parent.width
                        text: row.modelData.subject
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeCaption
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: row.modelData.day + " · " + row.modelData.time
                              + (row.modelData.location ? " · " + row.modelData.location : "")
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                }
            }
        }
    }
}
