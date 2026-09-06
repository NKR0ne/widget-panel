pragma Singleton
import QtQuick
QtObject {
    property bool enabled: true
    readonly property int panelMs: enabled ? 390 : 0
    readonly property int fastMs: enabled ? 90 : 0
    readonly property int normalMs: enabled ? 210 : 0
    readonly property var emphasized: [0.2, 0.0, 0.0, 1.0, 1.0, 1.0]
}
