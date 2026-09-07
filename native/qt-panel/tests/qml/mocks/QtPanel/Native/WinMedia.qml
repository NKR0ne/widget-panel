pragma Singleton
import QtQuick
QtObject {
    property var playback: ({})
    property var library: []
    property var albums: []
    property var playlists: []
    property var queue: []
    property var folders: []
    property bool scanning: false
    property bool busy: false
    property string error: ""
    property string libraryStatus: ""
    property string lastAction: ""
    property real lastValue: 0
    property string lastFile: ""
    function command(action, value) { lastAction = action; lastValue = value || 0 }
    function openPlayer() { lastAction = "open" }
    function playFile(url) { lastFile = url }
    function playItems(items, index) { queue = items; lastFile = items[index || 0].url; lastAction = "queue" }
    function playAlbum(id) { lastAction = "album:" + id }
    function playPlaylist(id) { lastAction = "playlist:" + id }
    function importPlaylist(url) { lastFile = url.toString(); lastAction = "import" }
    function scanLibrary() { lastAction = "scan" }
    function addFolder(url) { folders = folders.concat([url.toString()]) }
    function removeFolder(path) { folders = folders.filter(function(f) { return f !== path }) }
}
