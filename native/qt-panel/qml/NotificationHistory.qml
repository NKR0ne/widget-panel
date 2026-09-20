import QtQuick
import QtQuick.Controls
import QtPanel.Native

Rectangle {
    id: history
    visible: Notifications.historyOpen
    width: Math.min(460, parent.width - 24)
    height: Math.min(480, parent.height - 70)
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.rightMargin: 12
    anchors.topMargin: 46
    radius: 8
    color: "#20242d"
    border.color: Theme.cardStroke
    z: 95
    focus: visible
    onVisibleChanged: Panel.setModalOpen(visible)
    Keys.onEscapePressed: Notifications.historyOpen = false
    Text {
        x: 12; y: 12
        text: "Notifications Starvis"
        color: Theme.textPrimary
        font.pixelSize: Theme.fontSizeTitle
    }
    Row {
        anchors.right: parent.right; anchors.top: parent.top; anchors.margins: 8
        IconButton { glyph: "\uE73E"; tooltip: "Tout marquer comme lu"; onClicked: Notifications.markAllRead() }
        IconButton { glyph: "\uE711"; tooltip: "Fermer"; onClicked: Notifications.historyOpen = false }
    }
    ListView {
        anchors.fill: parent
        anchors.margins: 12
        anchors.topMargin: 48
        clip: true
        spacing: 6
        model: Notifications.entries
        ScrollBar.vertical: ScrollBar {}
        delegate: Rectangle {
            required property var modelData
            width: ListView.view.width - 12
            height: label.implicitHeight + 34
            radius: 5
            color: hover.containsMouse ? Theme.hover : Theme.cardFill
            Text {
                id: label
                x: 8; y: 8; width: parent.width - 16
                text: modelData.text
                textFormat: Text.PlainText
                wrapMode: Text.WordWrap
                color: modelData.read ? Theme.textSecondary : Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
            }
            Text {
                x: 8; anchors.top: label.bottom; anchors.topMargin: 4
                text: Qt.formatDateTime(new Date(modelData.time), "dd MMM hh:mm")
                color: Theme.textSecondary
                font.pixelSize: 9
            }
            MouseArea {
                id: hover; anchors.fill: parent; hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: Notifications.openEntry(parent.modelData)
            }
        }
        Text {
            visible: !Notifications.entries.length
            anchors.centerIn: parent
            text: "Aucune notification"
            color: Theme.textSecondary
        }
    }
}
