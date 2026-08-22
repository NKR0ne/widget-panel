import QtQuick
import QtQuick3D
import QtPanel.Native

// Quick3D avatar: a noise-displaced sphere with a fresnel emissive rim and
// two counter-rotating rings. Color/shape/motion follow StarvisState:
//   idle       deep blue, slow breathing
//   listening  green, pulse follows the mic level
//   reasoning  violet, boil speed follows tokens/sec
//   speaking   amber, amplitude follows the output level
//   analyzing  steel blue, steady scan
//   alert      red, 2 Hz flash, decays service-side after 10 s
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
    readonly property real moodAmp: {
        if (mood === "reasoning")
            return 0.16 + Math.min(0.3, Math.log2(1 + tokensRate) * 0.05)
        if (mood === "listening") return 0.10 + audioLevel * 0.30
        if (mood === "speaking") return 0.12 + audioLevel * 0.34
        if (mood === "alert") return 0.42
        if (mood === "analyzing") return 0.12
        return 0.06 // idle breathing
    }
    readonly property real moodSpeed: {
        if (mood === "reasoning")
            return 0.55 + Math.min(1.6, Math.log2(1 + tokensRate) * 0.28)
        if (mood === "alert") return 1.6
        if (mood === "speaking") return 0.8
        if (mood === "analyzing") return 0.45
        return 0.18
    }
    readonly property real moodGlow: mood === "idle" ? 0.5 : 1.0

    Component.onCompleted: console.info("[starvis.avatar] 3d avatar loaded")

    View3D {
        anchors.fill: parent
        environment: SceneEnvironment {
            backgroundMode: SceneEnvironment.Transparent
            antialiasingMode: SceneEnvironment.MSAA
            antialiasingQuality: SceneEnvironment.High
        }

        PerspectiveCamera {
            z: 340
            fieldOfView: 42
        }

        DirectionalLight {
            eulerRotation.x: -25
            eulerRotation.y: -35
            brightness: 0.7
        }

        Model {
            id: orb
            source: "#Sphere"
            scale: Qt.vector3d(1.35, 1.35, 1.35)

            // 2 Hz flash in alert; smooth elsewhere.
            SequentialAnimation on opacity {
                running: root.mood === "alert"
                loops: Animation.Infinite
                NumberAnimation { to: 0.45; duration: 250 }
                NumberAnimation { to: 1.0; duration: 250 }
            }
            opacity: 1

            materials: CustomMaterial {
                shadingMode: CustomMaterial.Shaded
                vertexShader: "effects/avatar.vert"
                fragmentShader: "effects/avatar.frag"

                property real uTime: 0
                property real uFreq: 2.6
                property real uAmp: root.moodAmp * 40 // sphere primitive radius is ~50
                property real uSpeed: root.moodSpeed
                property real uGlow: root.moodGlow
                property color uColor: root.moodColor

                Behavior on uAmp { NumberAnimation { duration: 400; easing.type: Easing.OutCubic } }
                Behavior on uSpeed { NumberAnimation { duration: 400 } }
                Behavior on uGlow { NumberAnimation { duration: 400 } }
                Behavior on uColor { ColorAnimation { duration: 400 } }

                NumberAnimation on uTime {
                    running: Panel.panelVisible && Motion.decorativeEnabled
                    from: 0; to: 100000
                    duration: 100000000
                    loops: Animation.Infinite
                }
            }
        }

    }

    // Orbit rings drawn in 2D over the View3D (#Torus is not a Quick3D
    // built-in primitive). Tilted ellipse outlines, spin follows the mood.
    Item {
        anchors.centerIn: parent
        width: parent.width
        height: parent.height

        Rectangle {
            id: ring2dA
            anchors.centerIn: parent
            width: Math.min(parent.width, parent.height) * 0.82
            height: width
            radius: width / 2
            color: "transparent"
            border.width: 1.5
            border.color: Qt.rgba(root.moodColor.r, root.moodColor.g, root.moodColor.b, 0.30)
            transform: [
                Scale { origin.x: ring2dA.width / 2; origin.y: ring2dA.height / 2; yScale: 0.34 },
                Rotation {
                    origin.x: ring2dA.width / 2; origin.y: ring2dA.height / 2
                    NumberAnimation on angle {
                        running: Panel.panelVisible && Motion.decorativeEnabled
                        from: 0; to: 360
                        duration: Math.max(6000, 26000 / Math.max(0.2, root.moodSpeed))
                        loops: Animation.Infinite
                    }
                }
            ]
        }
        Rectangle {
            id: ring2dB
            anchors.centerIn: parent
            width: Math.min(parent.width, parent.height) * 0.94
            height: width
            radius: width / 2
            color: "transparent"
            border.width: 1
            border.color: Qt.rgba(root.moodColor.r, root.moodColor.g, root.moodColor.b, 0.18)
            transform: [
                Scale { origin.x: ring2dB.width / 2; origin.y: ring2dB.height / 2; yScale: 0.5 },
                Rotation {
                    origin.x: ring2dB.width / 2; origin.y: ring2dB.height / 2
                    NumberAnimation on angle {
                        running: Panel.panelVisible && Motion.decorativeEnabled
                        from: 360; to: 0
                        duration: Math.max(8000, 34000 / Math.max(0.2, root.moodSpeed))
                        loops: Animation.Infinite
                    }
                }
            ]
        }
    }
}
