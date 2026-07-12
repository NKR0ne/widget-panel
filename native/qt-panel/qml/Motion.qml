pragma Singleton
import QtQuick
import QtPanel.Native

// Motion spec — one easing vocabulary for the whole app. The 390ms panel
// signature matches the Electron app (and the helper-side timing assumptions).
QtObject {
    readonly property bool enabled: !Ui.reducedMotion && Sys.animationsEnabled
    readonly property int fastMs: enabled ? 90 : 0
    readonly property int normalMs: enabled ? 210 : 0
    readonly property int panelMs: enabled ? 390 : 0

    // Bezier control points: c1x, c1y, c2x, c2y, end.
    readonly property var emphasized: [0.2, 0.0, 0.0, 1.0, 1.0, 1.0]
    readonly property var exit: [0.3, 0.0, 0.8, 0.15, 1.0, 1.0]
}
