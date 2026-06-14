import QtQuick
import QtMultimedia
import QtPanel.Native

// One live TV card: HLS via Qt Multimedia (FFmpeg backend), muted by default.
// Clicking the video claims the single audio slot (Live.audioFeedId).
GlassCard {
    id: card

    property string feedId: ""

    title: Live.title(feedId)
    implicitHeight: header.implicitHeight + videoFrame.height + 24 + 8

    property bool failed: false
    property string statusText: "Résolution du flux…"

    Component.onCompleted: Live.resolve(feedId)

    Connections {
        target: Live
        function onFeedResolved(id, hlsUrl) {
            if (id !== card.feedId)
                return
            card.failed = false
            card.statusText = "Connexion…"
            player.source = hlsUrl
            player.play()
        }
        function onFeedFailed(id, error) {
            if (id !== card.feedId)
                return
            card.failed = true
            card.statusText = "Flux indisponible"
            retryTimer.start()
        }
    }

    Timer {
        id: retryTimer
        interval: 45000
        onTriggered: Live.resolve(card.feedId, true)
    }

    MediaPlayer {
        id: player
        videoOutput: videoOut
        audioOutput: AudioOutput {
            muted: Live.audioFeedId !== card.feedId
            volume: 0.72
        }

        onPlaybackStateChanged: {
            Live.notePlayback(card.feedId,
                playbackState === MediaPlayer.PlayingState ? "playing"
              : playbackState === MediaPlayer.PausedState ? "paused" : "stopped")
        }
        onMediaStatusChanged: {
            const names = ["nomedia", "loading", "loaded", "stalled", "buffering",
                           "buffered", "endofmedia", "invalidmedia"]
            Live.notePlayback(card.feedId, "status: " + (names[mediaStatus] || mediaStatus))
            if (mediaStatus === MediaPlayer.EndOfMedia
                || mediaStatus === MediaPlayer.InvalidMedia) {
                retryTimer.interval = 8000
                retryTimer.start()
            }
        }
        onErrorOccurred: function(error, errorString) {
            Live.notePlayback(card.feedId, "error: " + errorString)
            card.failed = true
            card.statusText = "Erreur de lecture"
            // Manifest likely expired — force a fresh resolution.
            retryTimer.interval = 8000
            retryTimer.start()
        }
    }

    Column {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        Row {
            id: header
            width: parent.width
            spacing: 6

            Text {
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
            }
            Row {
                spacing: 4
                visible: player.playbackState === MediaPlayer.PlayingState
                anchors.verticalCenter: parent.verticalCenter

                Rectangle {
                    width: 6; height: 6; radius: 3
                    color: "#f87171"
                    anchors.verticalCenter: parent.verticalCenter

                    SequentialAnimation on opacity {
                        loops: Animation.Infinite
                        running: visible
                        NumberAnimation { to: 0.3; duration: 900 }
                        NumberAnimation { to: 1.0; duration: 900 }
                    }
                }
                Text {
                    text: "EN DIRECT"
                    color: "#f87171"
                    font.pixelSize: 8
                    font.weight: Font.DemiBold
                    font.letterSpacing: 1
                }
            }
            Item { width: parent.width - x - speaker.width; height: 1 }
            Text {
                id: speaker
                text: Live.audioFeedId === card.feedId ? "" : ""  // Volume / Mute
                font.family: "Segoe Fluent Icons"
                font.pixelSize: 12
                color: Live.audioFeedId === card.feedId ? Theme.accent : Theme.textSecondary
                anchors.verticalCenter: parent.verticalCenter
            }
        }

        Rectangle {
            id: videoFrame
            width: parent.width
            height: Math.round(width * 9 / 16)
            radius: 8
            color: "#0a0a0c"
            clip: true

            VideoOutput {
                id: videoOut
                anchors.fill: parent
                fillMode: VideoOutput.PreserveAspectCrop
            }

            Text {
                anchors.centerIn: parent
                visible: player.playbackState !== MediaPlayer.PlayingState
                text: card.statusText
                color: card.failed ? "#f87171" : Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: Live.requestAudio(
                    Live.audioFeedId === card.feedId ? "" : card.feedId)
            }
        }
    }
}
