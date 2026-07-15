import QtQuick

GlassCard {
    id: card
    title: "Calendrier"
    implicitHeight: Math.max(232, body.implicitHeight + 24)

    property date today: new Date()
    property date displayDate: new Date(today.getFullYear(), today.getMonth(), 1)
    readonly property var weekLabels: ["D", "L", "M", "M", "J", "V", "S"]
    readonly property var calendarCells: buildCalendarCells()

    function buildCalendarCells() {
        const cells = []
        const year = displayDate.getFullYear()
        const month = displayDate.getMonth()
        const firstWeekday = new Date(year, month, 1).getDay()
        for (let index = 0; index < 42; index++) {
            const value = new Date(year, month, 1 - firstWeekday + index)
            cells.push({
                day: value.getDate(),
                currentMonth: value.getMonth() === month,
                today: value.getDate() === today.getDate()
                    && value.getMonth() === today.getMonth()
                    && value.getFullYear() === today.getFullYear(),
            })
        }
        return cells
    }

    function moveMonth(delta) {
        displayDate = new Date(displayDate.getFullYear(), displayDate.getMonth() + delta, 1)
        SoundFx.tap()
    }

    function moveYear(delta) {
        displayDate = new Date(displayDate.getFullYear() + delta, displayDate.getMonth(), 1)
        SoundFx.tap()
    }

    function resetToday() {
        today = new Date()
        displayDate = new Date(today.getFullYear(), today.getMonth(), 1)
        SoundFx.tap()
    }

    Timer {
        interval: 60000
        running: true
        repeat: true
        onTriggered: card.today = new Date()
    }

    component NavButton: Rectangle {
        id: navButton
        property string glyph: ""
        signal clicked()
        width: 24
        height: 22
        radius: 5
        color: navMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.07)
        border.color: Qt.rgba(1, 1, 1, 0.06)

        Text {
            anchors.centerIn: parent
            text: navButton.glyph
            color: Theme.textPrimary
            font.pixelSize: 14
        }
        MouseArea {
            id: navMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: navButton.clicked()
        }
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        Row {
            width: parent.width
            spacing: 4

            NavButton {
                glyph: "\u00ab"
                onClicked: card.moveYear(-1)
            }
            NavButton {
                glyph: "\u2039"
                onClicked: card.moveMonth(-1)
            }

            Item {
                width: Math.max(40, parent.width - 112)
                height: 28

                Column {
                    anchors.centerIn: parent
                    spacing: 0
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: {
                            const value = card.displayDate.toLocaleDateString(
                                Qt.locale("fr_CA"), "MMMM")
                            return value.charAt(0).toUpperCase() + value.slice(1)
                        }
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeBody
                        font.weight: Font.DemiBold
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: card.displayDate.getFullYear()
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.resetToday()
                }
            }

            NavButton {
                glyph: "\u203a"
                onClicked: card.moveMonth(1)
            }
            NavButton {
                glyph: "\u00bb"
                onClicked: card.moveYear(1)
            }
        }

        Grid {
            id: weekdayGrid
            width: parent.width
            height: 20
            columns: 7
            spacing: 0

            Repeater {
                model: card.weekLabels
                delegate: Item {
                    required property string modelData
                    width: weekdayGrid.width / 7
                    height: weekdayGrid.height

                    Text {
                        anchors.centerIn: parent
                        text: modelData
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        font.weight: Font.DemiBold
                    }
                }
            }
        }

        Grid {
            id: dateGrid
            width: parent.width
            height: 144
            columns: 7
            spacing: 0

            Repeater {
                model: card.calendarCells
                delegate: Item {
                    required property var modelData
                    width: dateGrid.width / 7
                    height: 24

                    Rectangle {
                        anchors.centerIn: parent
                        width: 22
                        height: 22
                        radius: 11
                        color: modelData.today ? Theme.accent : "transparent"
                    }
                    Text {
                        anchors.centerIn: parent
                        text: modelData.day
                        color: modelData.today ? "#ffffff"
                             : modelData.currentMonth ? Theme.textPrimary
                             : Qt.rgba(1, 1, 1, 0.22)
                        font.pixelSize: 10
                        font.weight: modelData.today ? Font.DemiBold : Font.Normal
                    }
                }
            }
        }
    }
}
