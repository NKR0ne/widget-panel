import QtQuick
import QtPanel.Native

// 2D fallback avatar: layered breathing circles, no Quick3D. Same state
// mapping as the 3D variant so the two are interchangeable.
Item {
    id: root

    readonly property var starvisState: Starvis.state
    readonly property string mood: starvisState ? starvisState.state : "idle"
    readonly property real tokensRate: starvisState ? starvisState.tokensPerSec : 0
    readonly property real audioLevel: starvisState ? starvisState.audioLevel : 0

    readonly property color moodColor: {
        if (mood === "listening") return "#58f0a6"
        if (mood === "reasoning") return "#a07bff"
        if (mood === "speaking") return "#ffc266"
        if (mood === "analyzing") return "#4aa3ff"
        if (mood === "alert") return "#ff5a5a"
        return "#62e6ff"
    }
    readonly property real activity: {
        if (mood === "reasoning") return 0.5 + Math.min(0.5, Math.log2(1 + tokensRate) * 0.1)
        if (mood === "listening") return 0.3 + audioLevel * 0.7
        if (mood === "speaking") return 0.4 + audioLevel * 0.6
        if (mood === "alert") return 1.0
        if (mood === "analyzing") return 0.35
        return 0.15
    }

    Component.onCompleted: console.info("[starvis.avatar] 2d avatar loaded")

    readonly property real base: Math.min(width, height) * 0.42
    readonly property var visualMetrics: [
        { label: "Activité", value: root.activity.toFixed(2), effect: "Expansion du halo" },
        { label: "Pulsation", value: (2 * Math.max(350, 1600 - root.activity * 1100) / 1000).toFixed(2) + " s", effect: "Période de respiration" },
        { label: "Échelle", value: pulse.scaleFactor.toFixed(3), effect: "Taille instantanée du noyau" },
        { label: "Couleur", value: root.moodColor.toString(), effect: "État prioritaire" }
    ]

    Behavior on activity { NumberAnimation { duration: 400 } }

    // Outer halo
    Rectangle {
        anchors.centerIn: parent
        width: root.base * (1.5 + root.activity * 0.5) * pulse.scaleFactor
        height: width
        radius: width / 2
        color: "transparent"
        border.width: 2
        border.color: Qt.rgba(root.moodColor.r, root.moodColor.g, root.moodColor.b, 0.25)
        Behavior on border.color { ColorAnimation { duration: 400 } }
    }
    // Mid glow
    Rectangle {
        anchors.centerIn: parent
        width: root.base * (1.15 + root.activity * 0.35) * pulse.scaleFactor
        height: width
        radius: width / 2
        color: Qt.rgba(root.moodColor.r, root.moodColor.g, root.moodColor.b, 0.10)
        Behavior on color { ColorAnimation { duration: 400 } }
    }
    // Core
    Rectangle {
        id: core
        anchors.centerIn: parent
        width: root.base * pulse.scaleFactor
        height: width
        radius: width / 2
        color: Qt.rgba(root.moodColor.r * 0.4, root.moodColor.g * 0.4,
                       root.moodColor.b * 0.4, 0.85)
        border.width: 2
        border.color: root.moodColor
        Behavior on color { ColorAnimation { duration: 400 } }
        Behavior on border.color { ColorAnimation { duration: 400 } }

        SequentialAnimation on opacity {
            running: root.mood === "alert"
            loops: Animation.Infinite
            NumberAnimation { to: 0.4; duration: 250 }
            NumberAnimation { to: 1.0; duration: 250 }
        }
        opacity: 1
    }

    QtObject {
        id: pulse
        property real scaleFactor: 1
        SequentialAnimation on scaleFactor {
            running: Panel.panelVisible && Motion.decorativeEnabled
            loops: Animation.Infinite
            NumberAnimation {
                to: 1 + 0.04 + root.activity * 0.10
                duration: Math.max(350, 1600 - root.activity * 1100)
                easing.type: Easing.InOutSine
            }
            NumberAnimation {
                to: 1
                duration: Math.max(350, 1600 - root.activity * 1100)
                easing.type: Easing.InOutSine
            }
        }
    }
}
