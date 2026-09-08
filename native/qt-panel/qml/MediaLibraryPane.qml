import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Basic as Basic
import QtQuick.Layouts
import QtQuick.Dialogs
import QtPanel.Native

ColumnLayout {
    id: pane
    objectName: "mediaBrowser"
    spacing: 6
    property int browseMode: Math.max(0, Math.min(3, Number(Store.get("wp-media-browse", 0))))
    property string selectedAlbum: ""
    signal playRequested()
    component LibraryScrollBar: Basic.ScrollBar {
        id: bar
        width: 6
        padding: 0
        minimumSize: 0.08
        policy: Basic.ScrollBar.AsNeeded
        contentItem: Rectangle {
            implicitWidth: 6; implicitHeight: 24; radius: 3
            color: bar.pressed ? Theme.textPrimary : Theme.textSecondary
            opacity: bar.active || bar.hovered ? 0.85 : 0.45
        }
        background: Item {}
    }
    onBrowseModeChanged: { selectedAlbum = ""; Store.set("wp-media-browse", browseMode) }
    readonly property var albums: WinMedia.albums
    readonly property var selected: WinMedia.albums.find(function(a) { return a.id === selectedAlbum }) || ({})
    readonly property var rows: {
        if (browseMode === 3) return WinMedia.queue
        if (browseMode === 2) return WinMedia.playlists
        let tracks = WinMedia.library.filter(function(t) { return !selectedAlbum || t.albumId === selectedAlbum })
        if (selectedAlbum) tracks.sort(function(a,b) { return Number(a.discNumber || 0) - Number(b.discNumber || 0) || Number(a.trackNumber || 0) - Number(b.trackNumber || 0) })
        return tracks
    }
    FileDialog { id: playlistDialog; title: "Importer une playlist"; nameFilters: ["Playlists (*.wpl *.m3u *.m3u8 *.pls *.xspf *.zpl)"]; onAccepted: WinMedia.importPlaylist(selectedFile) }
    RowLayout {
        Layout.fillWidth: true
        Basic.ComboBox {
            id: section
            objectName: "mediaLibrarySection"
            Layout.preferredWidth: 145; Layout.preferredHeight: 28
            model: ["Albums", "Titres", "Playlists", "File de lecture"]
            currentIndex: pane.browseMode; onActivated: pane.browseMode = currentIndex
            font.pixelSize: 11
            leftPadding: 10; rightPadding: 28
            Accessible.name: "Vue de la bibliotheque"
            contentItem: Text {
                text: section.displayText; font: section.font; color: Theme.textPrimary
                verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight
            }
            indicator: Text {
                x: section.width - width - 10; anchors.verticalCenter: parent.verticalCenter
                text: "\uE70D"; font.family: "Segoe Fluent Icons"; font.pixelSize: 10
                color: Theme.textSecondary
            }
            background: Rectangle { radius: 4; color: section.hovered ? Theme.hover : Theme.cardFill; border.color: section.activeFocus ? Theme.accent : Theme.cardStroke }
            delegate: Basic.ItemDelegate {
                id: option
                required property int index
                required property string modelData
                width: section.popup.availableWidth; height: 32
                highlighted: section.highlightedIndex === index
                contentItem: Text {
                    text: option.modelData; font: section.font; color: Theme.textPrimary
                    verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight
                }
                background: Rectangle {
                    radius: 4
                    color: option.highlighted ? Theme.activeFill : option.hovered ? Theme.hover : "transparent"
                }
            }
            popup: Basic.Popup {
                id: libraryPopup
                objectName: "mediaLibraryPopup"
                parent: Overlay.overlay
                popupType: Popup.Item
                width: Math.max(section.width, 168)
                margins: 4
                padding: 4
                implicitHeight: contentItem.implicitHeight + topPadding + bottomPadding
                function positionAtSelector() {
                    if (!parent) return
                    // Use scene coordinates once, outside the card's layered
                    // and scrolling content in the composition host.
                    const below = section.mapToItem(parent, 0, section.height + 4)
                    const above = section.mapToItem(parent, 0, -4)
                    x = Math.max(4, Math.min(below.x, parent.width - width - 4))
                    y = below.y + height <= parent.height - 4 ? below.y : Math.max(4, above.y - height)
                }
                onAboutToShow: positionAtSelector()
                Timer { interval: 16; running: libraryPopup.visible; repeat: true; onTriggered: libraryPopup.positionAtSelector() }
                background: Rectangle { color: Theme.panelSolid; radius: 6; border.color: Theme.cardStroke }
                contentItem: ListView {
                    implicitHeight: contentHeight
                    clip: true; model: section.delegateModel; currentIndex: section.highlightedIndex
                    boundsBehavior: Flickable.StopAtBounds
                }
            }
        }
        Item { Layout.fillWidth: true }
        Text { text: WinMedia.scanning ? "Actualisation..." : (pane.browseMode === 0 && !pane.selectedAlbum ? pane.albums.length + " albums" : pane.rows.length + " elements"); color: Theme.textSecondary; font.pixelSize: 9 }
        IconButton { objectName: "mediaRefresh"; buttonSize: 24; glyph: "\uE72C"; tooltip: "Actualiser la bibliotheque"; enabled: !WinMedia.scanning; onClicked: WinMedia.scanLibrary() }
        IconButton { visible: pane.browseMode === 2; buttonSize: 24; glyph: "\uE8B5"; tooltip: "Importer une playlist"; onClicked: playlistDialog.open() }
    }
    RowLayout {
        visible: pane.selectedAlbum !== "" && pane.browseMode === 0
        Layout.fillWidth: true
        IconButton { objectName: "mediaAlbumBack"; buttonSize: 24; glyph: "\uE72B"; tooltip: "Tous les albums"; onClicked: pane.selectedAlbum = "" }
        Text { text: pane.selected.title || "Album"; Layout.fillWidth: true; elide: Text.ElideRight; color: Theme.textPrimary; font.pixelSize: 11 }
        IconButton { objectName: "mediaAlbumPlay"; buttonSize: 28; glyph: "\uE768"; tooltip: "Lire l'album"; enabled: !WinMedia.busy; onClicked: { WinMedia.playAlbum(pane.selectedAlbum); pane.playRequested() } }
    }
    GridView {
        id: grid
        objectName: "mediaAlbumGrid"
        Layout.fillWidth: true; Layout.fillHeight: true
        visible: pane.browseMode === 0 && !pane.selectedAlbum
        clip: true
        cellWidth: width / (2 * Math.max(2, Math.floor(width / 135)))
        cellHeight: cellWidth + 40
        model: pane.albums
        ScrollBar.vertical: LibraryScrollBar {}
        delegate: Item {
            required property var modelData
            width: grid.cellWidth; height: grid.cellHeight
            Rectangle {
                id: art
                x: 2; y: 2; width: parent.width - 6; height: width
                radius: 6; color: Qt.darker(Theme.cardFill, 1.3)
                Image { anchors.fill: parent; anchors.margins: 1; source: modelData.artwork || ""; sourceSize: Qt.size(320,320); fillMode: Image.PreserveAspectFit; asynchronous: true }
                Text { anchors.centerIn: parent; visible: !modelData.artwork; text: "\uE93C"; color: Theme.textSecondary; font.family: "Segoe Fluent Icons"; font.pixelSize: 30 }
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: pane.selectedAlbum = modelData.id }
            }
            Text { x: 2; y: art.height + 8; width: parent.width - 8; text: modelData.title; elide: Text.ElideRight; color: Theme.textPrimary; font.pixelSize: 10 }
            Text { x: 2; y: art.height + 25; width: parent.width - 30; text: modelData.artist || modelData.count + " titres"; elide: Text.ElideRight; color: Theme.textSecondary; font.pixelSize: 9 }
            IconButton { anchors.right: parent.right; anchors.rightMargin: 4; y: art.height + 21; buttonSize: 20; glyph: "\uE768"; tooltip: "Lire l'album"; enabled: !WinMedia.busy; onClicked: { WinMedia.playAlbum(modelData.id); pane.playRequested() } }
        }
        Text { anchors.centerIn: parent; width: parent.width - 12; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; visible: !grid.count && !WinMedia.scanning; text: "Aucun album"; color: Theme.textSecondary; font.pixelSize: 11 }
    }
    ListView {
        id: trackList
        objectName: "mediaLibraryList"
        Layout.fillWidth: true; Layout.fillHeight: true
        visible: pane.browseMode !== 0 || pane.selectedAlbum !== ""
        clip: true; spacing: 3; model: pane.rows
        ScrollBar.vertical: LibraryScrollBar { objectName: "mediaTrackScrollBar" }
        delegate: Rectangle {
            required property var modelData
            required property int index
            width: trackList.width - 12; height: 48; radius: 4
            color: pane.browseMode === 3 && Number(WinMedia.playback.queueIndex) === index ? Theme.activeFill : rowMouse.containsMouse ? Theme.hover : "transparent"
            Image { id: cover; x: 2; y: 5; width: 38; height: 38; source: modelData.artwork || ""; sourceSize: Qt.size(76,76); fillMode: Image.PreserveAspectFit; asynchronous: true }
            Text { anchors.centerIn: cover; visible: !modelData.artwork; text: pane.browseMode === 2 ? "\uE8FD" : "\uE8D6"; font.family: "Segoe Fluent Icons"; font.pixelSize: 18; color: Theme.textSecondary }
            Column {
                anchors.left: cover.right; anchors.leftMargin: 8; anchors.right: parent.right; anchors.rightMargin: 6
                anchors.verticalCenter: parent.verticalCenter; spacing: 3
                Text { width: parent.width; text: modelData.title; elide: Text.ElideRight; color: Theme.textPrimary; font.pixelSize: 11 }
                Text { width: parent.width; text: pane.browseMode === 2 ? modelData.count + " titres | " + modelData.source : (modelData.artist || modelData.folder || "") + (modelData.album ? " | " + modelData.album : ""); elide: Text.ElideRight; color: Theme.textSecondary; font.pixelSize: 9 }
            }
            MouseArea {
                id: rowMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; enabled: !WinMedia.busy
                onClicked: {
                    if (pane.browseMode === 2) WinMedia.playPlaylist(modelData.id)
                    else if (pane.browseMode === 3) WinMedia.command("index", index)
                    else WinMedia.playItems(pane.rows, index)
                    pane.playRequested()
                }
            }
        }
        Text { anchors.centerIn: parent; width: parent.width - 12; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; visible: !trackList.count && !WinMedia.scanning; text: pane.browseMode === 2 ? "Aucune playlist trouvee" : pane.browseMode === 3 ? "File de lecture vide" : "Aucun titre"; color: Theme.textSecondary; font.pixelSize: 11 }
    }
}
