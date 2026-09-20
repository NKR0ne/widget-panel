pragma Singleton
import QtQuick
QtObject {
    property bool ready: false
    property string error: ""
    property string locationName: "Test"
    property var current: ({})
    signal updated()
}
