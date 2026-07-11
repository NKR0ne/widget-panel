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
    readonly property bool youtube: Live.isYouTube(feedId)
    readonly property string ytId: Live.videoId(feedId)

    function htmlEscape(text) {
        return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    }

    function zoomUrl() {
        const web = Live.webUrl(card.feedId)
        const src = card.hlsUrl || (card.youtube ? "" : web)
        if (!src)
            return web
        const html = "<!doctype html><html><head><meta charset='utf-8'>"
            + "<style>html,body{margin:0;width:100%;height:100%;background:#05070a;color:#dbeafe;font-family:Segoe UI,Arial,sans-serif}"
            + "#wrap{position:fixed;inset:0;display:grid;grid-template-rows:auto 1fr}"
            + "#bar{height:36px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#0b1020;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px}"
            + "video{width:100%;height:100%;background:#000;object-fit:contain}</style>"
            + "<script src='https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'></script></head>"
            + "<body><div id='wrap'><div id='bar'><b>" + htmlEscape(card.title)
            + "</b><span id='state'>Loading HLS</span></div><video id='v' controls autoplay></video></div>"
            + "<script>var src=" + JSON.stringify(src) + ";var v=document.getElementById('v');var s=document.getElementById('state');"
            + "function note(x){s.textContent=x}if(window.Hls&&Hls.isSupported()){var h=new Hls({lowLatencyMode:true});"
            + "h.on(Hls.Events.ERROR,function(_,d){note(d&&d.details?d.details:'HLS error')});"
            + "h.loadSource(src);h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){note('Ready');v.play().catch(function(){note('Press play')})})}"
            + "else{v.src=src;v.addEventListener('loadedmetadata',function(){note('Ready');v.play().catch(function(){note('Press play')})});"
            + "v.addEventListener('error',function(){note('Playback error')})}</script></body></html>"
        return "data:text/html;charset=utf-8," + encodeURIComponent(html)
    }

    function openZoom() {
        Panel.openIsland(zoomUrl())
    }

    function openCompactEmbed() {
        Panel.openIsland(Live.embedUrl(card.feedId))
    }

    function retryNow() {
        failed = false
        statusText = card.youtube ? "Resolution YouTube..." : "Resolution du flux..."
        retryTimer.stop()
        Live.resolve(feedId, true)
    }

    Component.onCompleted: {
        card.statusText = card.youtube ? "Resolution YouTube..." : "Resolution du flux..."
        Live.resolve(feedId)
    }

    Connections {
        target: Live
        function onFeedResolved(id, hlsUrl) {
            if (id !== card.feedId)
                return
            card.failed = false
            card.hlsUrl = hlsUrl
            card.statusText = "Connexion…"
            player.source = hlsUrl
            player.play()
        }
        function onFeedFailed(id, error) {
            if (id !== card.feedId)
                return
            if (card.youtube) {
                card.failed = false
                card.hlsUrl = ""
                card.statusText = "Lecture via navigateur"
                return
            }
            card.failed = true
            card.statusText = error || "Flux indisponible"
            retryTimer.start()
        }
    }

    Timer {
        id: retryTimer
        interval: 45000
        running: false
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
                    text: Live.sourceLabel(card.feedId)
                    color: Theme.textSecondary
                    font.pixelSize: 8
                }
            }
            Item { width: Math.max(1, parent.width - x - zoomBtn.width - speaker.width - 8); height: 1 }
            Rectangle {
                id: zoomBtn
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
                    onClicked: card.openZoom()
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
                Row {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 6
                    Rectangle {
                        width: openYoutubeLabel.implicitWidth + 24
                        height: 28
                        radius: 7
                        color: openYoutubeMouse.containsMouse ? Qt.rgba(0.97, 0.18, 0.18, 0.35)
                                                               : Qt.rgba(0.97, 0.18, 0.18, 0.22)
                        border.color: Qt.rgba(1, 1, 1, 0.24)
                        Text {
                            id: openYoutubeLabel
                            anchors.centerIn: parent
                            text: "Watch"
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeCaption
                        }
                        MouseArea {
                            id: openYoutubeMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.openZoom()
                        }
                    }
                    Rectangle {
                        width: embedYoutubeLabel.implicitWidth + 18
                        height: 28
                        radius: 7
                        color: embedYoutubeMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.08)
                        border.color: Theme.cardStroke
                        Text {
                            id: embedYoutubeLabel
                            anchors.centerIn: parent
                            text: "Embed"
                            color: Theme.textSecondary
                            font.pixelSize: Theme.fontSizeCaption
                        }
                        MouseArea {
                            id: embedYoutubeMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.openCompactEmbed()
                        }
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
                    Rectangle {
                        width: webLabel.implicitWidth + 22
                        height: 26
                        radius: 6
                        color: webMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.28)
                                                       : Qt.rgba(0.31, 0.56, 0.97, 0.16)
                        border.color: Qt.rgba(0.31, 0.56, 0.97, 0.45)
                        Text {
                            id: webLabel
                            anchors.centerIn: parent
                            text: "Web"
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeCaption
                        }
                        MouseArea {
                            id: webMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.openZoom()
                        }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                z: 1
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    if (card.failed || card.hlsUrl === "") {
                        card.openZoom()
                    } else {
                        Live.requestAudio(Live.audioFeedId === card.feedId ? "" : card.feedId)
                    }
                }
            }
        }
    }
}
