import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Outlook Agenda"
    implicitHeight: 420

    property bool showCalendars: false

    function durationLabel(minutes) {
        const value = Number(minutes)
        if (!isFinite(value) || value <= 0)
            return ""
        if (value < 60)
            return value + " min"
        const hours = Math.floor(value / 60)
        const remainder = value % 60
        return remainder > 0 ? hours + " h " + remainder : hours + " h"
    }

    component HeaderButton: Rectangle {
        id: headerButton
        property string label: ""
        property bool active: false
        signal clicked()
        width: buttonLabel.implicitWidth + 12
        height: 19
        radius: 5
        color: active ? Theme.activeFill
            : buttonMouse.containsMouse ? Theme.hover : "transparent"
        border.color: Theme.cardStroke

        Text {
            id: buttonLabel
            anchors.centerIn: parent
            text: headerButton.label
            color: Theme.textSecondary
            font.pixelSize: 8
        }
        MouseArea {
            id: buttonMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: headerButton.clicked()
        }
    }

    Column {
        id: headerArea
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

        Row {
            width: parent.width
            spacing: 5

            Text {
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
            }
            Rectangle {
                visible: MsGraph.authState === "ok"
                width: 6
                height: 6
                radius: 3
                color: "#34d399"
                anchors.verticalCenter: parent.verticalCenter
            }
            Item {
                width: Math.max(0, parent.width - x - headerControls.width)
                height: 1
            }
            Row {
                id: headerControls
                spacing: 4

                HeaderButton {
                    visible: MsGraph.authState === "ok" && MsGraph.calendars.length > 0
                    label: "Cals"
                    active: card.showCalendars
                    onClicked: {
                        card.showCalendars = !card.showCalendars
                        SoundFx.tap()
                    }
                }
                HeaderButton {
                    visible: MsGraph.authState === "ok"
                    label: "Sortir"
                    onClicked: MsGraph.signOut()
                }
            }
        }

        MsStatePane { width: parent.width }

        Flow {
            width: parent.width
            spacing: 4
            visible: card.showCalendars && MsGraph.authState === "ok"
                && MsGraph.calendars.length > 0

            Repeater {
                model: MsGraph.calendars
                delegate: Rectangle {
                    required property var modelData
                    readonly property bool selected:
                        MsGraph.selectedCalendarIds.length === 0
                        || MsGraph.selectedCalendarIds.indexOf(modelData.id) >= 0
                    height: 18
                    width: calendarName.implicitWidth + 20
                    radius: 5
                    color: selected ? Qt.rgba(1, 1, 1, 0.08) : "transparent"
                    border.color: selected ? modelData.color : Theme.cardStroke

                    Row {
                        anchors.centerIn: parent
                        spacing: 4
                        Rectangle {
                            width: 7
                            height: 7
                            radius: 2
                            color: parent.parent.selected
                                ? parent.parent.modelData.color : "transparent"
                            border.color: parent.parent.modelData.color
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Text {
                            id: calendarName
                            text: modelData.name
                            color: parent.parent.selected
                                ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 9
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: MsGraph.toggleCalendar(parent.modelData.id)
                    }
                }
            }
        }
    }

    Flickable {
        id: eventFlick
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: headerArea.bottom
        anchors.bottom: parent.bottom
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        anchors.topMargin: 6
        anchors.bottomMargin: 12
        contentHeight: eventsColumn.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        visible: MsGraph.authState === "ok"

        Column {
            id: eventsColumn
            width: eventFlick.width
            spacing: 0

            Text {
                visible: MsGraph.agendaEvents.length === 0
                width: parent.width
                text: "Aucun \u00e9v\u00e9nement \u00e0 venir"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                horizontalAlignment: Text.AlignHCenter
                topPadding: 10
            }

            Repeater {
                model: MsGraph.agendaEvents
                delegate: Column {
                    id: eventDelegate
                    required property var modelData
                    required property int index
                    width: eventsColumn.width
                    spacing: 2

                    Text {
                        visible: eventDelegate.modelData.showDayHeader
                        width: parent.width
                        topPadding: index === 0 ? 2 : 10
                        bottomPadding: 4
                        text: eventDelegate.modelData.day
                        color: eventDelegate.modelData.isToday
                            ? Theme.accent : Theme.textSecondary
                        font.pixelSize: 10
                        font.weight: Font.DemiBold
                        font.capitalization: Font.AllUppercase
                        elide: Text.ElideRight
                    }

                    Item {
                        width: parent.width
                        height: eventDelegate.modelData.allDay ? 30 : 43

                        Rectangle {
                            width: eventDelegate.modelData.allDay ? 3 : 7
                            height: eventDelegate.modelData.allDay ? parent.height - 8 : 7
                            radius: width / 2
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            color: eventDelegate.modelData.color || Theme.accent
                        }
                        Column {
                            anchors.left: parent.left
                            anchors.leftMargin: 14
                            anchors.right: timeColumn.left
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 2

                            Text {
                                width: parent.width
                                text: eventDelegate.modelData.subject
                                color: Theme.textPrimary
                                font.pixelSize: 11
                                elide: Text.ElideRight
                            }
                            Text {
                                visible: eventDelegate.modelData.location !== ""
                                width: parent.width
                                text: eventDelegate.modelData.location
                                color: Theme.textSecondary
                                font.pixelSize: 9
                                elide: Text.ElideRight
                            }
                        }
                        Column {
                            id: timeColumn
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 1

                            Text {
                                anchors.right: parent.right
                                text: eventDelegate.modelData.allDay
                                    ? "Journ\u00e9e" : eventDelegate.modelData.time
                                color: Theme.textPrimary
                                font.family: "Consolas"
                                font.pixelSize: 9
                            }
                            Text {
                                visible: !eventDelegate.modelData.allDay
                                anchors.right: parent.right
                                text: card.durationLabel(
                                    eventDelegate.modelData.durationMinutes)
                                color: Theme.textSecondary
                                font.pixelSize: 8
                            }
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: eventFlick.contentHeight > eventFlick.height
            width: 2
            radius: 1
            anchors.right: parent.right
            height: Math.max(18, eventFlick.height * eventFlick.height
                / Math.max(1, eventFlick.contentHeight))
            y: eventFlick.contentY / Math.max(1,
                eventFlick.contentHeight - eventFlick.height)
                * Math.max(0, eventFlick.height - height)
            color: Qt.rgba(1, 1, 1, 0.22)
        }
    }
}
