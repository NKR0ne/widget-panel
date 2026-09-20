pragma Singleton
import QtQuick
QtObject {
    property var movers: []
    property var headlines: []
    property string status: ""
    property string newsStatus: ""
    signal refreshed()
    function refresh() {}
    function loadNews(symbol) {}
}
