import QtQuick
import QtPanel.Native

// Avatar chooser: wp-starvis-avatar-mode = auto | 3d | 2d. auto tries the
// Quick3D orb and falls back to the 2D variant if the loader errors (e.g. a
// render path where Quick3D offscreen fails).
Item {
    id: root

    property int storeRev: 0
    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-starvis-avatar-mode")
                root.storeRev++
        }
    }
    readonly property string mode: {
        storeRev
        const value = String(Store.get("wp-starvis-avatar-mode", "auto") || "auto")
        return value === "2d" || value === "3d" ? value : "auto"
    }

    Loader {
        id: avatarLoader
        anchors.fill: parent
        source: root.mode === "2d" ? "StarvisAvatar2D.qml" : "StarvisAvatar3D.qml"
        onStatusChanged: {
            if (status === Loader.Error && source.toString().indexOf("2D") < 0) {
                console.warn("[starvis.avatar] 3d avatar failed to load, falling back to 2d")
                source = "StarvisAvatar2D.qml"
            }
        }
    }
}
