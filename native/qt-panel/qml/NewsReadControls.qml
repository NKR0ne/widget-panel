import QtQuick
import QtPanel.Native

Row {
    id: controls
    property var items: []
    property int revision: 0
    readonly property bool unreadOnly: { revision; return Store.get("wp-news-unread-only", false) === true }
    spacing: 3
    Connections {
        target: Store
        function onChanged(key) { if (key === "wp-news-unread-only") controls.revision++ }
    }
    IconButton {
        buttonSize: 24; glyph: "\uE71C"
        active: controls.unreadOnly
        tooltip: "Afficher uniquement les articles non lus"
        onClicked: Store.set("wp-news-unread-only", !controls.unreadOnly)
    }
    IconButton {
        buttonSize: 24; glyph: "\uE73E"
        tooltip: "Marquer cette s\u00e9lection comme lue"
        onClicked: NewsRead.markAllRead(controls.items)
    }
}
