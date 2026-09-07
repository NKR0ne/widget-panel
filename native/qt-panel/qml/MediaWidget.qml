import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Basic as Basic
import QtQuick.Layouts
import QtQuick.Dialogs
import QtPanel.Native

GlassCard {
    id: card
    implicitHeight: 420
    interactive: false
    property string view: String(Store.get("wp-media-view", "play")) === "library" ? "library" : "play"
    readonly property var playback: WinMedia.playback
    onViewChanged: Store.set("wp-media-view", view)
    function timeLabel(seconds) {
        const n = Math.max(0, Math.floor(Number(seconds) || 0))
        return (n >= 3600 ? Math.floor(n / 3600) + ":" : "")
            + (n >= 3600 ? String(Math.floor(n / 60) % 60).padStart(2, "0") : Math.floor(n / 60))
            + ":" + String(n % 60).padStart(2, "0")
    }
    FileDialog {
        id: fileDialog
        title: "Ouvrir un fichier audio"
        nameFilters: ["Audio (*.mp3 *.flac *.m4a *.aac *.wav *.wma *.ogg *.opus *.aiff *.aif *.alac)"]
        onAccepted: WinMedia.playFile(selectedFile)
    }
    FolderDialog {
        id: folderDialog
        title: "Ajouter un dossier multimedia"
        onAccepted: WinMedia.addFolder(selectedFolder)
    }
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 8
        CardHeader {
            Layout.fillWidth: true
            title: "Media Player"
            status: card.playback.loading ? "CHARGEMENT" : card.playback.connected ? (card.playback.playing ? "LECTURE" : "PAUSE") : "NATIF"
            statusColor: Theme.accent
            IconButton {
                buttonSize: 24; glyph: "\uE8E5"; tooltip: "Ouvrir un fichier"
                enabled: !WinMedia.busy
                onClicked: fileDialog.open()
            }
            IconButton {
                objectName: "mediaQueueToggle"
                buttonSize: 24; glyph: "\uE8FD"; tooltip: "File de lecture"
                enabled: !WinMedia.busy
                onClicked: { card.view = "library"; libraryPane.browseMode = 3; libraryPane.selectedAlbum = "" }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 2
            Repeater {
                model: [{key:"play", label:"Lecture", icon:"\uE768"}, {key:"library", label:"Biblioth\u00e8que", icon:"\uE8F1"}]
                delegate: Rectangle {
                    required property var modelData
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                    radius: 5
                    color: card.view === modelData.key ? Theme.activeFill : "transparent"
                    border.color: card.view === modelData.key ? Theme.cardStroke : "transparent"
                    Row {
                        anchors.centerIn: parent; spacing: 7
                        Text { text: modelData.icon; font.family: "Segoe Fluent Icons"; color: Theme.textSecondary; font.pixelSize: 12 }
                        Text { text: modelData.label; color: card.view === modelData.key ? Theme.textPrimary : Theme.textSecondary; font.pixelSize: 11 }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: card.view = modelData.key }
                }
            }
        }
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            ColumnLayout {
                anchors.fill: parent
                visible: card.view === "play"
                spacing: 5
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.minimumHeight: 44
                    Image {
                        id: cover
                        anchors.centerIn: parent
                        width: Math.min(parent.width, parent.height)
                        height: width
                        source: card.playback.artwork || ""
                        fillMode: Image.PreserveAspectFit
                        visible: status === Image.Ready
                    }
                    Text {
                        anchors.centerIn: parent
                        visible: !cover.visible
                        text: "\uE8D6"
                        font.family: "Segoe Fluent Icons"
                        font.pixelSize: 42
                        color: Theme.textSecondary
                        opacity: 0.6
                    }
                }
                Text {
                    Layout.fillWidth: true
                    text: card.playback.title || (card.playback.connected ? "Media Player" : "Aucune lecture en cours")
                    color: Theme.textPrimary; font.pixelSize: 14; font.weight: Font.DemiBold
                    wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight
                    horizontalAlignment: Text.AlignHCenter
                }
                Text {
                    Layout.fillWidth: true
                    text: [card.playback.artist || "", card.playback.album || ""].filter(Boolean).join(" | ")
                    visible: text !== ""
                    color: Theme.textSecondary; font.pixelSize: 10; elide: Text.ElideRight
                    horizontalAlignment: Text.AlignHCenter
                }
                Basic.Slider {
                    id: seek
                    property real requestedPosition: 0
                    objectName: "mediaSeek"
                    Layout.fillWidth: true
                    Layout.preferredHeight: 22
                    from: Number(card.playback.start) || 0
                    to: Math.max(from + 1, Number(card.playback.end) || 0)
                    enabled: !!card.playback.canSeek && !WinMedia.busy && Number(card.playback.end) > from
                    Binding { target: seek; property: "value"; value: Number(card.playback.position) || 0; when: !seek.pressed }
                    onMoved: {
                        requestedPosition = value
                        if (!pressed) WinMedia.command("seek", requestedPosition)
                    }
                    onPressedChanged: {
                        if (pressed) requestedPosition = value
                        else if (enabled) WinMedia.command("seek", requestedPosition)
                    }
                    Accessible.name: "Position de lecture"
                    palette.highlight: Theme.accent
                    palette.button: Theme.textPrimary
                    background: Rectangle {
                        x: seek.leftPadding
                        y: seek.topPadding + seek.availableHeight / 2 - height / 2
                        width: seek.availableWidth; height: 4; radius: 2
                        color: Theme.cardStroke
                        Rectangle { width: seek.visualPosition * parent.width; height: parent.height; radius: 2; color: seek.enabled ? Theme.accent : Theme.textSecondary }
                    }
                    handle: Rectangle {
                        x: seek.leftPadding + seek.visualPosition * (seek.availableWidth - width)
                        y: seek.topPadding + seek.availableHeight / 2 - height / 2
                        width: 12; height: 12; radius: 6
                        color: seek.enabled ? Theme.textPrimary : Theme.textSecondary
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    Text { text: card.timeLabel(seek.value - seek.from); color: Theme.textSecondary; font.pixelSize: 9 }
                    Item { Layout.fillWidth: true }
                    Text { text: card.timeLabel(Number(card.playback.end) - seek.from); color: Theme.textSecondary; font.pixelSize: 9 }
                }
                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: 6
                    IconButton {
                        objectName: "mediaShuffle"; glyph: "\uE8B1"; tooltip: "Lecture aleatoire"
                        active: !!card.playback.shuffle; enabled: !!card.playback.canShuffle && !WinMedia.busy
                        onClicked: WinMedia.command("shuffle", card.playback.shuffle ? 0 : 1)
                    }
                    IconButton {
                        glyph: "\uE892"; tooltip: "Precedent"; enabled: !!card.playback.canPrevious && !WinMedia.busy
                        onClicked: WinMedia.command("previous")
                    }
                    IconButton {
                        objectName: "mediaPlayPause"; buttonSize: 40
                        glyph: card.playback.playing ? "\uE769" : "\uE768"
                        tooltip: card.playback.playing ? "Pause" : "Lecture"
                        active: true
                        enabled: !WinMedia.busy && (card.playback.playing ? !!card.playback.canPause : !!card.playback.canPlay)
                        onClicked: WinMedia.command(card.playback.playing ? "pause" : "play")
                    }
                    IconButton {
                        glyph: "\uE893"; tooltip: "Suivant"; enabled: !!card.playback.canNext && !WinMedia.busy
                        onClicked: WinMedia.command("next")
                    }
                    IconButton {
                        glyph: Number(card.playback.repeat) === 1 ? "\uE8ED" : "\uE8EE"
                        tooltip: Number(card.playback.repeat) === 1 ? "Repeter un titre" : Number(card.playback.repeat) === 2 ? "Repeter tout" : "Repetition desactivee"
                        active: Number(card.playback.repeat) > 0; enabled: !!card.playback.canRepeat && !WinMedia.busy
                        onClicked: WinMedia.command("repeat", ((Number(card.playback.repeat) || 0) + 1) % 3)
                    }
                    IconButton {
                        buttonSize: 24; glyph: "\uE71A"; tooltip: "Arreter"; enabled: !!card.playback.canStop && !WinMedia.busy
                        onClicked: WinMedia.command("stop")
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    IconButton { buttonSize: 24; glyph: Number(card.playback.volume) === 0 ? "\uE74F" : "\uE767"; tooltip: "Couper / retablir le son"; onClicked: WinMedia.command("volume", Number(card.playback.volume) > 0 ? 0 : 50) }
                    Basic.Slider {
                        id: volume
                        objectName: "mediaVolume"
                        property real requestedVolume: 50
                        Layout.fillWidth: true; Layout.preferredHeight: 22
                        from: 0; to: 100
                        Binding { target: volume; property: "value"; value: Number(card.playback.volume) || 0; when: !volume.pressed }
                        onMoved: { requestedVolume = value; if (!pressed) WinMedia.command("volume", requestedVolume) }
                        onPressedChanged: { if (pressed) requestedVolume = value; else WinMedia.command("volume", requestedVolume) }
                        Accessible.name: "Volume de la musique"
                        palette.highlight: Theme.accent
                    }
                    Text { text: Math.round(volume.value) + "%"; color: Theme.textSecondary; font.pixelSize: 9; Layout.preferredWidth: 30 }
                }
            }
            MediaLibraryPane {
                id: libraryPane
                anchors.fill: parent
                visible: card.view === "library"
                onPlayRequested: card.view = "play"
            }
        }
        Text {
            Layout.fillWidth: true
            Layout.maximumHeight: 44
            visible: text !== ""
            text: WinMedia.error || (card.view === "library" ? WinMedia.libraryStatus : "")
            wrapMode: Text.WordWrap; maximumLineCount: 3; elide: Text.ElideRight
            font.pixelSize: 9; color: Theme.textSecondary
        }
    }
}
