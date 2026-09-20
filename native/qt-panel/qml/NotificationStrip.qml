import QtQuick
import QtQuick.Layouts
import QtQuick.Controls

Item {
    id: strip
    implicitHeight: 28
    implicitWidth: 260
    clip: true
    readonly property var entry: Notifications.current
    readonly property bool compact: width < 170
    onEntryChanged: if (!Ui.reducedMotion) entrance.restart()
    opacity: Notifications.enabled ? 1 : 0
    RowLayout {
        anchors.fill: parent
        spacing: 4
        Rectangle {
            id: message
            Layout.fillWidth: true
            Layout.minimumWidth: 0
            Layout.fillHeight: true
            radius: 5
            color: mouse.containsMouse ? Theme.hover : "transparent"
            Text {
                anchors.fill: parent
                anchors.margins: 5
                verticalAlignment: Text.AlignVCenter
                text: strip.entry ? (strip.compact ? "\uEA8F" : strip.entry.text) : ""
                font.family: strip.compact ? "Segoe Fluent Icons" : "Segoe UI"
                font.pixelSize: Theme.fontSizeCaption
                color: strip.entry && strip.entry.urgent ? Theme.warning : Theme.textSecondary
                elide: Text.ElideRight
                textFormat: Text.PlainText
            }
            MouseArea {
                id: mouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: strip.entry ? Qt.PointingHandCursor : Qt.ArrowCursor
                onEntered: Notifications.hovered = true
                onExited: Notifications.hovered = false
                onClicked: Notifications.openEntry(strip.entry)
            }
            activeFocusOnTab: !!strip.entry
            Accessible.role: Accessible.Button
            Accessible.name: strip.entry ? strip.entry.text : "Notifications"
            onActiveFocusChanged: Notifications.hovered = activeFocus
            Keys.onReturnPressed: Notifications.openEntry(strip.entry)
            Keys.onSpacePressed: Notifications.openEntry(strip.entry)
            ToolTip.visible: mouse.containsMouse && !!strip.entry
            ToolTip.text: strip.entry ? strip.entry.text : ""
        }
        IconButton {
            buttonSize: 24
            glyph: "\uEA8F"
            active: Notifications.unreadCount > 0
            tooltip: "Notifications : " + Notifications.unreadCount + " non lues"
            onClicked: Notifications.historyOpen = !Notifications.historyOpen
            Text {
                anchors.right: parent.right
                anchors.top: parent.top
                text: Notifications.unreadCount || ""
                color: Theme.accent
                font.pixelSize: 8
            }
        }
    }
    NumberAnimation {
        id: entrance
        target: message; property: "opacity"; from: 0.25; to: 1; duration: 220
    }
}
