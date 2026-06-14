import QtQuick
import QtQuick3D
import QtPanel.Native

// A rotating 3D ring of recent headlines — the native successor to the
// three.js NewsMatrixStage. Each headline is a textured plane on a slowly
// spinning carousel, with cursor parallax tilt. Runs on the Vulkan RHI.
GlassCard {
    id: card
    title: "Manchettes 3D"
    implicitHeight: 12 + header.height + stage.height + 12

    // Pull the freshest headlines across all active categories.
    function gatherHeadlines() {
        const out = []
        for (const label of News.categories) {
            const items = News.itemsFor(label)
            for (let i = 0; i < items.length && out.length < 8; i++)
                out.push({ title: items[i].title, source: items[i].source })
            if (out.length >= 8) break
        }
        return out
    }
    property var headlines: gatherHeadlines()
    Connections {
        target: News
        function onCategoryUpdated() { card.headlines = card.gatherHeadlines() }
    }

    Column {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 10

        Text {
            id: header
            text: card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
        }

        Item {
            id: stage
            width: parent.width
            height: Math.round(width * 0.62)

            // Cursor parallax: tilt the ring slightly toward the pointer.
            property real tiltX: 0
            property real tiltY: 0
            HoverHandler {
                id: hh
                onPointChanged: {
                    stage.tiltY = (point.position.x / stage.width - 0.5) * 18
                    stage.tiltX = (point.position.y / stage.height - 0.5) * -10
                }
                onHoveredChanged: if (!hovered) { stage.tiltX = 0; stage.tiltY = 0 }
            }
            Behavior on tiltX { NumberAnimation { duration: 400; easing.type: Easing.OutQuad } }
            Behavior on tiltY { NumberAnimation { duration: 400; easing.type: Easing.OutQuad } }

            View3D {
                anchors.fill: parent
                camera: cam
                renderMode: View3D.Offscreen

                environment: SceneEnvironment {
                    clearColor: "transparent"
                    backgroundMode: SceneEnvironment.Transparent
                    antialiasingMode: SceneEnvironment.MSAA
                    antialiasingQuality: SceneEnvironment.High
                }

                PerspectiveCamera {
                    id: cam
                    z: 420
                    fieldOfView: 55
                }

                DirectionalLight {
                    eulerRotation.x: -25
                    eulerRotation.y: -20
                    brightness: 1.1
                }
                PointLight {
                    x: 200; y: 180; z: 300
                    color: "#6fa0ff"
                    brightness: 2.0
                    quadraticFade: 0.00002
                }

                Node {
                    id: ring
                    eulerRotation.x: stage.tiltX
                    eulerRotation.y: value + stage.tiltY

                    property real value: 0
                    NumberAnimation on value {
                        from: 0; to: 360; duration: 38000; loops: Animation.Infinite
                    }

                    Repeater3D {
                        model: Math.max(1, card.headlines.length)

                        Node {
                            required property int index
                            readonly property real ang: index * 360.0 / Math.max(1, card.headlines.length)
                            eulerRotation.y: ang
                            // Place each panel on a circle facing outward.
                            position: Qt.vector3d(Math.sin(ang * Math.PI / 180) * 230,
                                                  0,
                                                  Math.cos(ang * Math.PI / 180) * 230)

                            Model {
                                source: "#Rectangle"
                                // #Rectangle is a 100x100 plane; scale to a card.
                                scale: Qt.vector3d(1.7, 1.0, 1.0)
                                // Face outward from the ring centre.
                                eulerRotation.y: 180
                                materials: PrincipledMaterial {
                                    baseColorMap: Texture {
                                        sourceItem: headlineTexture
                                    }
                                    opacityChannel: PrincipledMaterial.A
                                    alphaMode: PrincipledMaterial.Blend
                                    roughness: 0.45
                                    metalness: 0.0
                                }

                                Item {
                                    id: headlineTexture
                                    width: 340; height: 200
                                    visible: false
                                    layer.enabled: true

                                    Rectangle {
                                        anchors.fill: parent
                                        radius: 18
                                        color: Qt.rgba(0.07, 0.10, 0.18, 0.92)
                                        border.color: Qt.rgba(0.31, 0.45, 0.97, 0.5)
                                        border.width: 3
                                    }
                                    Column {
                                        anchors.fill: parent
                                        anchors.margins: 22
                                        spacing: 14
                                        Text {
                                            width: parent.width
                                            text: (card.headlines[index]
                                                   ? card.headlines[index].source : "").toUpperCase()
                                            color: "#6fa0ff"
                                            font.pixelSize: 18
                                            font.weight: Font.DemiBold
                                            font.letterSpacing: 2
                                            elide: Text.ElideRight
                                        }
                                        Text {
                                            width: parent.width
                                            text: card.headlines[index]
                                                  ? card.headlines[index].title : "…"
                                            color: "#eef2fb"
                                            font.pixelSize: 26
                                            font.weight: Font.Bold
                                            wrapMode: Text.WordWrap
                                            maximumLineCount: 4
                                            elide: Text.ElideRight
                                            lineHeight: 1.1
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                visible: card.headlines.length === 0
                text: "Chargement des manchettes…"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
            }
        }
    }
}
