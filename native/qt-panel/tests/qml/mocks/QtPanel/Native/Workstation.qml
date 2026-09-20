pragma Singleton
import QtQuick
QtObject {
    property bool connected: false
    property bool stale: false
    property var snapshot: ({})
}
