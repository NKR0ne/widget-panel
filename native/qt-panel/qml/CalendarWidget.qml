import QtQuick
import QtQuick.Controls.Basic

GlassCard {
    id: card
    title: "Calendrier"
    implicitHeight: body.implicitHeight + 24

    property date today: new Date()
    property date displayDate: new Date(today.getFullYear(), today.getMonth(), 1)

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

        DayOfWeekRow {
            width: parent.width
            locale: Qt.locale("fr_CA")
            delegate: Text {
                required property var model
                text: model.shortName
                color: Theme.textSecondary
                font.pixelSize: 9
                font.weight: Font.DemiBold
                horizontalAlignment: Text.AlignHCenter
            }
        }

        MonthGrid {
            width: parent.width
            month: card.displayDate.getMonth()
            year: card.displayDate.getFullYear()
            locale: Qt.locale("fr_CA")
            spacing: 0

            delegate: Item {
                required property var model
                implicitHeight: 24

                Rectangle {
                    anchors.centerIn: parent
                    width: 22
                    height: 22
                    radius: 11
                    color: model.today ? Theme.accent : "transparent"
                }
                Text {
                    anchors.centerIn: parent
                    text: model.day
                    color: model.today ? "#ffffff"
                         : model.month === card.displayDate.getMonth() ? Theme.textPrimary
                         : Qt.rgba(1, 1, 1, 0.22)
                    font.pixelSize: 10
                    font.weight: model.today ? Font.DemiBold : Font.Normal
                }
            }
        }
    }
}
