pragma Singleton
import QtQuick
QtObject {
    property var stations: []
    property var favorites: []
    property bool favoritesMode: false
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
    function toggleFavorite(id) {
        if (favorites.some(function(station) { return station.id === id }))
            favorites = favorites.filter(function(station) { return station.id !== id })
        else {
            const station = stations.find(function(station) { return station.id === id })
            if (station) favorites = favorites.concat([station])
        }
    }
    function play() { playing = true }
    function toggle() { playing = !playing }
    function previous() {}
    function next() {}
}
