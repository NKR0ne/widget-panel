import QtQuick
import QtMultimedia
import QtPanel.Native

Item {
    id: detail

    property string statusText: "Loading"
    property bool failed: false
    property int retryCount: 0
    readonly property int maxAutoRetries: 3

    visible: Live.detailOpen
    focus: visible
    Keys.onEscapePressed: closeDetail()

    function startPlayback() {
        if (!Live.detailOpen || !Live.detailUrl)
            return
        failed = false
        statusText = "Connecting"
        playbackWatchdog.restart()
        player.stop()
        player.source = Live.detailUrl
        player.play()
    }

    function scheduleRecovery(message) {
        playbackWatchdog.stop()
        player.stop()
        Live.requestAudio("")
        failed = true
        statusText = message || "Stream unavailable"
        if (retryTimer.running)
            return
        if (retryCount >= maxAutoRetries) {
            statusText += " - manual retry required"
            return
        }
        retryTimer.interval = Math.min(30000, 5000 * Math.pow(2, retryCount))
        retryCount++
        retryTimer.restart()
    }

    function closeDetail() {
        playbackWatchdog.stop()
        retryTimer.stop()
        player.stop()
        Live.closeDetail()
    }

    Connections {
        target: Live
        function onDetailChanged() {
            if (Live.detailOpen) {
                detail.retryCount = 0
                detail.startPlayback()
                detail.forceActiveFocus()
            } else {
                playbackWatchdog.stop()
                retryTimer.stop()
                player.stop()
            }
        }
    }

    Timer {
        id: playbackWatchdog
        interval: 18000
        repeat: false
        onTriggered: {
            if (player.playbackState !== MediaPlayer.PlayingState)
                detail.scheduleRecovery("Stream did not start")
        }
    }

    Timer {
        id: retryTimer
        interval: 5000
        repeat: false
        onTriggered: detail.startPlayback()
    }

    MediaPlayer {
        id: player
        videoOutput: videoOut
        audioOutput: AudioOutput {
            muted: !Live.detailOpen || Live.audioFeedId !== Live.detailFeedId
            volume: 0.72
        }

        onPlaybackStateChanged: {
            Live.notePlayback(Live.detailFeedId, "detail: "
                + (playbackState === MediaPlayer.PlayingState ? "playing"
                   : playbackState === MediaPlayer.PausedState ? "paused" : "stopped"))
            if (playbackState === MediaPlayer.PlayingState) {
                playbackWatchdog.stop()
                retryTimer.stop()
                detail.retryCount = 0
                detail.failed = false
                detail.statusText = "Live"
            }
        }
        onMediaStatusChanged: {
            if (mediaStatus === MediaPlayer.EndOfMedia
                || mediaStatus === MediaPlayer.InvalidMedia) {
                detail.scheduleRecovery(mediaStatus === MediaPlayer.InvalidMedia
                                        ? "Unsupported stream format"
                                        : "Stream ended")
            } else if (mediaStatus === MediaPlayer.BufferingMedia) {
                detail.statusText = "Buffering"
            } else if (mediaStatus === MediaPlayer.BufferedMedia
                       && playbackState === MediaPlayer.PlayingState) {
                detail.statusText = "Live"
            }
        }
        onErrorOccurred: function(error, errorString) {
            detail.scheduleRecovery(errorString || "Playback error")
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#05070a"
        border.color: Theme.cardStroke
        radius: Theme.radiusPanel

        Column {
            anchors.fill: parent
            anchors.margins: 12
            spacing: 10

            Row {
                id: detailHeader
                width: parent.width
                height: 30
                spacing: 8

                Column {
                    width: Math.max(120, parent.width - audioButton.width
                                    - retryButton.width - closeButton.width - 32)
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 1
                    Text {
                        width: parent.width
                        text: Live.title(Live.detailFeedId)
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeTitle
                        font.weight: Font.DemiBold
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: detail.statusText
                        color: detail.failed ? "#fca5a5" : Theme.textSecondary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                }
                Item { width: Math.max(1, parent.width - x - audioButton.width
                                       - retryButton.width - closeButton.width - 16); height: 1 }
                IconButton {
                    id: audioButton
                    glyph: Live.audioFeedId === Live.detailFeedId ? "\uE767" : "\uE74F"
                    active: Live.audioFeedId === Live.detailFeedId
                    onClicked: Live.requestAudio(Live.audioFeedId === Live.detailFeedId
                                                 ? "" : Live.detailFeedId)
                }
                IconButton {
                    id: retryButton
                    glyph: "\uE72C"
                    onClicked: {
                        detail.retryCount = 0
                        detail.startPlayback()
                    }
                }
                IconButton {
                    id: closeButton
                    glyph: "\uE711"
                    onClicked: detail.closeDetail()
                }
            }

            Rectangle {
                id: videoFrame
                width: parent.width
                height: Math.max(120, parent.height - y)
                color: "#000000"
                border.color: Theme.cardStroke
                radius: 6
                clip: true

                VideoOutput {
                    id: videoOut
                    anchors.fill: parent
                    fillMode: VideoOutput.PreserveAspectFit
                }

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 30
                    color: Qt.rgba(0.02, 0.03, 0.05, 0.78)
                    Text {
                        anchors.centerIn: parent
                        text: detail.statusText
                        color: detail.failed ? "#fca5a5" : Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Live.requestAudio(Live.audioFeedId === Live.detailFeedId
                                                 ? "" : Live.detailFeedId)
                }
            }
        }
    }
}
