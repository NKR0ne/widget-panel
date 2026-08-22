import QtQuick
import QtMultimedia
import QtPanel.Native

// What Starvis sees, and what it did about it. One tile per source: the live
// view on top, the last 24 h of its own actions underneath.
Item {
    id: vision

    // Snapshot polling only runs while this section is on screen.
    Component.onCompleted: Sentry.setLivePreview(true)
    Component.onDestruction: Sentry.setLivePreview(false)

    readonly property var sources: [
        {
            id: "direct",
            label: "Caméra directe",
            role: "Périmètre extérieur · flux RTSP HikVision",
            live: "image://starvis/live/direct",
        },
        {
            id: "webcam",
            label: "Webcam du poste",
            role: "Présence et accueil à l'écran",
            live: "image://starvis/live/webcam",
        },
    ]

    Text {
        id: visionTitle
        text: "VISION"
        color: Theme.textSecondary
        font.pixelSize: 9
        font.letterSpacing: 1
    }

    Row {
        anchors.top: visionTitle.bottom
        anchors.topMargin: 8
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        spacing: 8

        Repeater {
            model: vision.sources

            delegate: GlassCard {
                id: tile
                required property var modelData
                width: (vision.width - 8) / 2
                height: parent.height
                flat: true

                readonly property bool isWebcam: modelData.id === "webcam"
                readonly property bool armed: {
                    activityRev
                    return Sentry.cameraArmed(modelData.id)
                }
                readonly property bool sourceReady: isWebcam ? Sentry.webcamAvailable
                                                             : true
                property int activityRev: 0
                Connections {
                    target: Sentry
                    function onActivityChanged() { tile.activityRev++ }
                    function onConfigChanged() { tile.activityRev++ }
                }

                // ── Label: which camera this is and what it watches ──────
                Column {
                    id: tileHeader
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 10
                    spacing: 1
                    Text {
                        width: parent.width
                        text: tile.modelData.label
                        color: Theme.textPrimary
                        font.pixelSize: 11
                        font.weight: Font.DemiBold
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: tile.modelData.role
                        color: Theme.textSecondary
                        font.pixelSize: 8
                        elide: Text.ElideRight
                    }
                }

                // ── Live view ────────────────────────────────────────────
                Rectangle {
                    id: viewport
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: tileHeader.bottom
                    anchors.topMargin: 8
                    anchors.leftMargin: 10
                    anchors.rightMargin: 10
                    height: Math.round(tile.width * 0.5)
                    radius: 6
                    color: Qt.rgba(0, 0, 0, 0.45)
                    border.color: Theme.cardStroke
                    clip: true

                    // The RTSP camera gets its real video stream — the same
                    // one the base-mode card shows. Rebuilding the picture
                    // from periodic stills is both choppy and visibly uneven,
                    // because each snapshot is exposed independently.
                    Loader {
                        id: feedLoader
                        anchors.fill: parent
                        sourceComponent: tile.modelData.id === "direct"
                                         ? videoFeed : stillFeed
                    }

                    Component {
                        id: videoFeed
                        VideoOutput {
                            fillMode: VideoOutput.PreserveAspectCrop
                            // Only one render sink exists; the card reclaims
                            // it when base mode comes back into view.
                            Component.onCompleted: DirectCamera.attachVideoSink(videoSink)
                            Component.onDestruction: DirectCamera.detachVideoSink(videoSink)
                        }
                    }

                    Component {
                        id: stillFeed
                        StarvisLiveView {
                            active: tile.sourceReady
                            sourceBase: tile.modelData.live
                            // Per-source counter, so another feed's frame
                            // never makes this tile refetch the same image.
                            revision: {
                                Sentry.liveFrameId // re-evaluate on any frame
                                return Sentry.frameIdFor(tile.modelData.id)
                            }
                        }
                    }

                    Text {
                        anchors.centerIn: parent
                        width: parent.width - 20
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        visible: tile.modelData.id === "direct"
                                 ? DirectCamera.status !== "streaming"
                                 : !(feedLoader.item && feedLoader.item.hasFrame)
                        text: {
                            if (tile.modelData.id === "direct")
                                return DirectCamera.status === "error"
                                       ? "Flux indisponible" : "Connexion au flux…"
                            if (tile.isWebcam && !Sentry.webcamAvailable)
                                return "Aucune webcam détectée"
                            return "En attente d'image…"
                        }
                    }

                    // Armed indicator over the feed.
                    Row {
                        anchors.top: parent.top
                        anchors.right: parent.right
                        anchors.margins: 6
                        spacing: 4
                        Rectangle {
                            width: 6; height: 6; radius: 3
                            anchors.verticalCenter: parent.verticalCenter
                            color: tile.armed ? "#53f0c5" : Qt.rgba(1, 1, 1, 0.25)
                        }
                        Text {
                            text: tile.armed ? "ARMÉ" : "INACTIF"
                            color: tile.armed ? "#53f0c5" : Theme.textSecondary
                            font.pixelSize: 8
                            font.letterSpacing: 1
                        }
                    }
                }

                // ── Activity log (24 h) ──────────────────────────────────
                Text {
                    id: logHeader
                    anchors.top: viewport.bottom
                    anchors.left: parent.left
                    anchors.leftMargin: 10
                    anchors.topMargin: 8
                    text: "ACTIONS · 24 H"
                    color: Theme.textSecondary
                    font.pixelSize: 8
                    font.letterSpacing: 1
                }

                Flickable {
                    anchors.top: logHeader.bottom
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.topMargin: 6
                    anchors.leftMargin: 10
                    anchors.rightMargin: 10
                    anchors.bottomMargin: 10
                    clip: true
                    contentHeight: logColumn.height
                    boundsBehavior: Flickable.StopAtBounds

                    Column {
                        id: logColumn
                        width: parent.width
                        spacing: 4

                        Text {
                            width: parent.width
                            visible: logRepeater.count === 0
                            text: "Aucune action enregistrée."
                            color: Theme.textSecondary
                            font.pixelSize: 9
                        }

                        Repeater {
                            id: logRepeater
                            model: { tile.activityRev; return Sentry.activityFor(tile.modelData.id) }
                            delegate: Row {
                                required property var modelData
                                width: logColumn.width
                                spacing: 6

                                Rectangle {
                                    width: 3
                                    height: entryText.implicitHeight
                                    radius: 1.5
                                    color: modelData.kind === "alert" ? "#ff5a5a"
                                         : modelData.kind === "event" ? "#ffc266"
                                         : modelData.kind === "analysis" ? "#4aa3ff"
                                         : modelData.kind === "presence" ? "#58f0a6"
                                         : Qt.rgba(1, 1, 1, 0.18)
                                }
                                Text {
                                    width: 42
                                    text: modelData.time
                                    color: Theme.textSecondary
                                    font.pixelSize: 8
                                }
                                Text {
                                    id: entryText
                                    width: parent.width - 54
                                    text: modelData.text
                                    color: modelData.kind === "alert" ? "#ff8080"
                                                                      : Theme.textPrimary
                                    font.pixelSize: 9
                                    wrapMode: Text.WordWrap
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
