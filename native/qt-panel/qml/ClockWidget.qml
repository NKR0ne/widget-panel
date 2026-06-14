import QtQuick

GlassCard {
    id: card
    title: "Horloge"
    implicitHeight: body.implicitHeight + 24

    property date now: new Date()

    Timer {
        interval: 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: card.now = new Date()
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 2

        Text {
            text: card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
        }

        Row {
            spacing: 6

            Text {
                text: Qt.formatTime(card.now, "HH:mm")
                color: Theme.textPrimary
                font.pixelSize: 34
                font.weight: Font.Light
            }
            Text {
                anchors.baseline: parent.children[0].baseline
                text: Qt.formatTime(card.now, "ss")
                color: Theme.accent
                font.pixelSize: 16
                font.weight: Font.DemiBold
            }
        }

        Text {
            text: {
                const s = card.now.toLocaleDateString(Qt.locale("fr_CA"), "dddd d MMMM")
                return s.charAt(0).toUpperCase() + s.slice(1)
            }
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeBody
        }
    }
}
