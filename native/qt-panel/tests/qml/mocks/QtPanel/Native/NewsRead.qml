pragma Singleton
import QtQuick
QtObject {
    property int revision: 0
    property var states: ({})
    function keyFor(item) { return String(item.link || item.url || item.id || "").split("#")[0] }
    function isUnread(item) { return states[keyFor(item)] === false }
    function setRead(item, read) { states[keyFor(item)] = read; revision++ }
    function unreadCount(items) { return items.filter(function(item) { return isUnread(item) }).length }
    function markAllRead(items) { for (const item of items) setRead(item, true) }
}
