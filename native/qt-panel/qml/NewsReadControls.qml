import QtQuick
import QtQuick.Controls as Controls
import QtPanel.Native

Row {
    id: controls
    property var items: []
    property int revision: 0
    property bool labeledFilter: false
    readonly property bool unreadOnly: { revision; return Store.get("wp-news-unread-only", false) === true }
    spacing: 3
    Connections {
        target: Store
        function onChanged(key) { if (key === "wp-news-unread-only") controls.revision++ }
    }
    IconButton {
        visible: !controls.labeledFilter
        buttonSize: 24; glyph: "\uE71C"
        active: controls.unreadOnly
        tooltip: "Afficher uniquement les articles non lus"
        onClicked: Store.set("wp-news-unread-only", !controls.unreadOnly)
    }
    Controls.Switch {
        objectName: "newsUnreadOnlyToggle"
        visible: controls.labeledFilter
        text: "Non lus"
        checked: controls.unreadOnly
        onToggled: Store.set("wp-news-unread-only", checked)
        spacing: 6
        padding: 0
        indicator: Rectangle {
            implicitWidth: 30; implicitHeight: 16
            y: (parent.height - height) / 2
            radius: 8
            color: controls.unreadOnly ? Theme.accent : Theme.cardFill
            border.color: controls.unreadOnly ? Theme.accent : Theme.cardStroke
            Rectangle {
                x: controls.unreadOnly ? 16 : 2; y: 2
                width: 12; height: 12; radius: 6
                color: Theme.textPrimary
                Behavior on x { NumberAnimation { duration: Motion.fastMs } }
            }
        }
        contentItem: Text {
            text: parent.text
            leftPadding: 36
            color: Theme.textPrimary
            font.pixelSize: Theme.fontSizeCaption
            verticalAlignment: Text.AlignVCenter
        }
    }
    IconButton {
        buttonSize: 24; glyph: "\uE73E"
        tooltip: "Marquer cette s\u00e9lection comme lue"
        onClicked: NewsRead.markAllRead(controls.items)
    }
}
