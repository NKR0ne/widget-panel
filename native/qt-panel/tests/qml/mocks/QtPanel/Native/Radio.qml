pragma Singleton
import QtQuick
QtObject {
    property var stations: []
    property string query: ""
    property string region: "local"
    property string category: "all"
    property bool loading: false
    property bool playing: false
    property bool buffering: false
    property string error: ""
    property bool libraryMode: true
    property string currentStationId: ""
    property string stationName: "Station"
    property string stationDetail: "Quebec"
    property string frequency: "98.1 FM"
    property string logoUrl: ""
    property string nowPlaying: ""
    property real volume: 0.7
    function browse(search, area, type) {
        query = search; region = area; category = type
        libraryMode = search === "" && area === "local" && type === "all"
    }
    function showLibrary() { browse("", "local", "all") }
    function selectStation(id) { currentStationId = id }
    function play() { playing = true }
    function toggle() { playing = !playing }
    function previous() {}
    function next() {}
}
