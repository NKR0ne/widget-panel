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
    property string hlsUrl: ""
    property string statusText: "Résolution du flux…"
    property int retryCount: 0
    property bool restricted: false
    property bool pausedForDetail: false
    readonly property int maxAutoRetries: 3
    readonly property bool youtube: Live.isYouTube(feedId)
    readonly property string ytId: Live.videoId(feedId)

    function openDetail() {
        if (card.hlsUrl)
            Live.openDetail(card.feedId, card.hlsUrl)
    }

    function openExternal() {
        Panel.openExternal(Live.webUrl(card.feedId))
    }

    function retryNow() {
        retryCount = 0
        beginResolve(true)
    }

    function beginResolve(force) {
        failed = false
        restricted = false
        statusText = card.youtube ? "Resolution YouTube..." : "Resolution du flux..."
        retryTimer.stop()
        playbackWatchdog.stop()
        resolveWatchdog.restart()
        Live.resolve(feedId, force)
    }

    function useExternalFallback(message, networkRestricted) {
        Live.cancelResolve(card.feedId)
        resolveWatchdog.stop()
        playbackWatchdog.stop()
        retryTimer.stop()
        player.stop()
        card.hlsUrl = ""
        card.failed = false
        card.restricted = !!networkRestricted
        card.statusText = networkRestricted ? "Indisponible sur ce reseau"
                                             : (message || "Lecture native indisponible")
        if (Live.audioFeedId === card.feedId)
            Live.requestAudio("")
    }

    function scheduleRecovery(message) {
        resolveWatchdog.stop()
        playbackWatchdog.stop()
        player.stop()
        if (Live.audioFeedId === card.feedId)
            Live.requestAudio("")
        card.failed = true
        card.statusText = message || "Flux indisponible"
        if (retryTimer.running)
            return
        if (card.retryCount >= card.maxAutoRetries) {
            card.statusText += " - nouvelle tentative requise"
            return
        }
        retryTimer.interval = Math.min(45000, 8000 * Math.pow(2, card.retryCount))
        card.retryCount++
        retryTimer.restart()
    }

    Component.onCompleted: beginResolve(false)
    Component.onDestruction: {
        Live.cancelResolve(card.feedId)
        resolveWatchdog.stop()
        playbackWatchdog.stop()
        retryTimer.stop()
        player.stop()
        if (Live.audioFeedId === card.feedId)
            Live.requestAudio("")
    }

    Connections {
        target: Live
        function onFeedResolved(id, hlsUrl) {
            if (id !== card.feedId)
                return
            resolveWatchdog.stop()
            card.failed = false
            card.restricted = false
            card.hlsUrl = hlsUrl
            card.statusText = "Connexion…"
            playbackWatchdog.restart()
            player.stop()
            player.source = hlsUrl
            player.play()
        }
        function onFeedFailed(id, error) {
            if (id !== card.feedId)
                return
            if (card.youtube) {
                card.useExternalFallback(error || "Lecture native indisponible", false)
                return
            }
            card.scheduleRecovery(error || "Flux indisponible")
        }
        function onFeedRestricted(id, reason) {
            if (id !== card.feedId)
                return
            card.useExternalFallback(reason, true)
        }
        function onShutdownRequested() {
            resolveWatchdog.stop()
            playbackWatchdog.stop()
            retryTimer.stop()
            player.stop()
            player.source = ""
            card.hlsUrl = ""
        }
        function onDetailChanged() {
            if (Live.detailOpen && Live.detailFeedId === card.feedId) {
                card.pausedForDetail = true
                player.pause()
            } else if (card.pausedForDetail) {
                card.pausedForDetail = false
                if (card.hlsUrl && !card.failed)
                    player.play()
            }
        }
    }

    Timer {
        id: resolveWatchdog
        interval: 17000
        repeat: false
        onTriggered: {
            if (card.youtube)
                card.useExternalFallback("Resolution native impossible", false)
            else
                card.scheduleRecovery("Resolution du flux expiree")
        }
    }

    Timer {
        id: playbackWatchdog
        interval: 18000
        repeat: false
        onTriggered: {
            if (player.playbackState !== MediaPlayer.PlayingState)
                card.scheduleRecovery("Le flux ne demarre pas")
        }
    }

    Timer {
        id: retryTimer
        interval: 8000
        running: false
        repeat: false
        onTriggered: {
            card.failed = false
            card.hlsUrl = ""
            card.statusText = "Nouvelle tentative " + card.retryCount + "/" + card.maxAutoRetries
            player.stop()
            player.source = ""
            resolveWatchdog.restart()
            Live.resolve(card.feedId, true)
        }
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
            if (playbackState === MediaPlayer.PlayingState) {
                playbackWatchdog.stop()
                retryTimer.stop()
                card.retryCount = 0
                card.failed = false
                card.statusText = "En direct"
            }
        }
        onMediaStatusChanged: {
            const names = ["nomedia", "loading", "loaded", "stalled", "buffering",
                           "buffered", "endofmedia", "invalidmedia"]
            Live.notePlayback(card.feedId, "status: " + (names[mediaStatus] || mediaStatus))
            if (mediaStatus === MediaPlayer.EndOfMedia
                || mediaStatus === MediaPlayer.InvalidMedia)
                card.scheduleRecovery(mediaStatus === MediaPlayer.InvalidMedia
                                      ? "Format de flux non pris en charge"
                                      : "Le flux s'est termine")
        }
        onErrorOccurred: function(error, errorString) {
            Live.notePlayback(card.feedId, "error: " + errorString)
            card.scheduleRecovery(errorString || "Erreur de lecture")
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
                id: feedTitle
                width: Math.max(48, parent.width - liveBadge.width - sourceBadge.width
                                - zoomBtn.width - speaker.width - 36)
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                elide: Text.ElideRight
            }
            Row {
                id: liveBadge
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
            Rectangle {
                id: sourceBadge
                width: sourceText.implicitWidth + 10
                height: 18
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: Qt.rgba(1, 1, 1, 0.05)
                border.color: Theme.cardStroke
                Text {
                    id: sourceText
                    anchors.centerIn: parent
                    text: card.restricted ? "RESTRICTED" : Live.sourceLabel(card.feedId)
                    color: card.restricted ? "#fbbf24" : Theme.textSecondary
                    font.pixelSize: 8
                }
            }
            Item { width: Math.max(1, parent.width - x - zoomBtn.width - speaker.width - 8); height: 1 }
            Rectangle {
                id: zoomBtn
                visible: card.hlsUrl !== ""
                width: 22
                height: 18
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: zoomMouse.containsMouse ? Theme.activeFill : Qt.rgba(1, 1, 1, 0.04)
                border.color: zoomMouse.containsMouse ? Theme.accent : Theme.cardStroke
                Text {
                    anchors.centerIn: parent
                    text: ""
                    font.family: "Segoe Fluent Icons"
                    font.pixelSize: 10
                    color: Theme.textSecondary
                }
                MouseArea {
                    id: zoomMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.openDetail()
                }
            }
            Text {
                id: speaker
                visible: card.hlsUrl !== ""
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
                visible: card.hlsUrl !== ""
                fillMode: VideoOutput.PreserveAspectCrop
            }

            Image {
                anchors.fill: parent
                source: card.youtube && card.ytId !== "" ? "https://i.ytimg.com/vi/" + card.ytId + "/hqdefault.jpg" : ""
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                visible: card.youtube && card.hlsUrl === "" && (card.ytId !== "")
                opacity: 0.72
            }

            Rectangle {
                anchors.fill: parent
                visible: card.youtube && card.hlsUrl === "" && !card.failed
                color: Qt.rgba(0, 0, 0, 0.42)
            }

            Column {
                anchors.centerIn: parent
                visible: card.youtube && card.hlsUrl === "" && !card.failed
                z: 3
                spacing: 8
                Text {
                    width: videoFrame.width - 28
                    text: card.statusText
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    font.weight: Font.DemiBold
                    horizontalAlignment: Text.AlignHCenter
                }
                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: externalYoutubeRow.implicitWidth + 22
                    height: 28
                    radius: 7
                    color: openYoutubeMouse.containsMouse ? Qt.rgba(0.97, 0.18, 0.18, 0.35)
                                                           : Qt.rgba(0.97, 0.18, 0.18, 0.22)
                    border.color: Qt.rgba(1, 1, 1, 0.24)
                    Row {
                        id: externalYoutubeRow
                        anchors.centerIn: parent
                        spacing: 6
                        Text {
                            text: "î¢§"
                            font.family: "Segoe Fluent Icons"
                            font.pixelSize: 10
                            color: Theme.textPrimary
                        }
                        Text {
                            text: "Ouvrir dans le navigateur"
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeCaption
                        }
                    }
                    MouseArea {
                        id: openYoutubeMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: card.openExternal()
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                visible: card.hlsUrl === "" && !card.youtube && !card.failed
                text: card.statusText
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
            }

            Column {
                anchors.centerIn: parent
                visible: card.failed
                z: 2
                spacing: 8
                Text {
                    width: videoFrame.width - 24
                    text: card.statusText
                    color: "#f87171"
                    font.pixelSize: Theme.fontSizeCaption
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                }
                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 6
                    Rectangle {
                        width: retryLabel.implicitWidth + 22
                        height: 26
                        radius: 6
                        color: retryMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.06)
                        border.color: Theme.cardStroke
                        Text {
                            id: retryLabel
                            anchors.centerIn: parent
                            text: "Retry"
                            color: Theme.textSecondary
                            font.pixelSize: Theme.fontSizeCaption
                        }
                        MouseArea {
                            id: retryMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.retryNow()
                        }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                z: 1
                enabled: card.hlsUrl !== "" && !card.failed
                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: Live.requestAudio(Live.audioFeedId === card.feedId ? "" : card.feedId)
            }
        }
    }
}
