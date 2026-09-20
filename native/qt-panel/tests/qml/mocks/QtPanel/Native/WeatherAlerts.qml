pragma Singleton
import QtQuick
QtObject {
    property var alerts: []
    property bool stale: false
    property string status: "ECCC"
    signal updated()
}
