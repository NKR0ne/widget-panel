import QtQuick
import QtQuick.Controls.Basic

GlassCard {
    id: card
    title: "Calendrier"
    implicitHeight: body.implicitHeight + 24

    readonly property date today: new Date()

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        Row {
            width: parent.width

            Text {
                width: parent.width
                text: {
                    const s = card.today.toLocaleDateString(Qt.locale("fr_CA"), "MMMM yyyy")
                    return s.charAt(0).toUpperCase() + s.slice(1)
                }
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeBody
                font.weight: Font.DemiBold
            }
        }

        DayOfWeekRow {
            width: parent.width
            locale: Qt.locale("fr_CA")
            delegate: Text {
                required property var model
                text: model.shortName
                color: Theme.textSecondary
                font.pixelSize: 10
                horizontalAlignment: Text.AlignHCenter
            }
        }

        MonthGrid {
            width: parent.width
            month: card.today.getMonth()
            year: card.today.getFullYear()
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
                         : model.month === card.today.getMonth() ? Theme.textPrimary
                         : Qt.rgba(1, 1, 1, 0.22)
                    font.pixelSize: 11
                    font.weight: model.today ? Font.DemiBold : Font.Normal
                }
            }
        }
    }
}
