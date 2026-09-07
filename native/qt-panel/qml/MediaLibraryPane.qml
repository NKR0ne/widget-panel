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
    property string query: ""
    property bool manageFolders: false
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
    function matches(item) { return [item.title || "", item.artist || "", item.album || ""].join(" ").toLowerCase().indexOf(query.toLowerCase()) >= 0 }
    readonly property var albums: WinMedia.albums.filter(function(a) { return matches(a) })
    readonly property var selected: WinMedia.albums.find(function(a) { return a.id === selectedAlbum }) || ({})
    readonly property var rows: {
        if (browseMode === 3) return WinMedia.queue
        if (browseMode === 2) return WinMedia.playlists.filter(function(p) { return matches(p) })
        let tracks = WinMedia.library.filter(function(t) { return (!selectedAlbum || t.albumId === selectedAlbum) && matches(t) })
        if (selectedAlbum) tracks.sort(function(a,b) { return Number(a.discNumber || 0) - Number(b.discNumber || 0) || Number(a.trackNumber || 0) - Number(b.trackNumber || 0) })
        return tracks
    }
    FileDialog { id: playlistDialog; title: "Importer une playlist"; nameFilters: ["Playlists (*.wpl *.m3u *.m3u8 *.pls *.xspf *.zpl)"]; onAccepted: WinMedia.importPlaylist(selectedFile) }
    FolderDialog { id: folderDialog; title: "Ajouter un dossier de musique"; onAccepted: WinMedia.addFolder(selectedFolder) }
    RowLayout {
        Layout.fillWidth: true
        Basic.TextField {
            id: search
            objectName: "mediaSearch"
            Layout.fillWidth: true; Layout.minimumWidth: 40; Layout.preferredHeight: 28
            placeholderText: "Album, artiste, titre..."; color: Theme.textPrimary; placeholderTextColor: Theme.textSecondary
            font.pixelSize: 11
            onTextChanged: searchDelay.restart()
            Timer { id: searchDelay; interval: 120; onTriggered: pane.query = search.text }
            background: Rectangle { radius: 4; color: Theme.cardFill; border.color: Theme.cardStroke }
        }
        IconButton { buttonSize: 24; glyph: "\uE8B7"; tooltip: "Dossiers Windows et personnels"; active: pane.manageFolders; onClicked: pane.manageFolders = !pane.manageFolders }
        IconButton { objectName: "mediaRefresh"; buttonSize: 24; glyph: "\uE72C"; tooltip: "Actualiser la bibliotheque"; enabled: !WinMedia.scanning; onClicked: WinMedia.scanLibrary() }
    }
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
                objectName: "mediaLibraryPopup"
                popupType: Popup.Item
                y: section.height + 4; width: Math.max(section.width, 168)
                padding: 4
                implicitHeight: contentItem.implicitHeight + topPadding + bottomPadding
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
        IconButton { visible: pane.browseMode === 2; buttonSize: 24; glyph: "\uE8B5"; tooltip: "Importer une playlist"; onClicked: playlistDialog.open() }
    }
    ColumnLayout {
        visible: pane.manageFolders
        Layout.fillWidth: true; spacing: 2
        RowLayout {
            Layout.fillWidth: true
            Text { text: "Bibliotheque Windows"; color: Theme.textSecondary; font.pixelSize: 10; Layout.fillWidth: true }
            IconButton { buttonSize: 24; glyph: "\uE710"; tooltip: "Ajouter un dossier"; onClicked: folderDialog.open() }
        }
        ListView {
            objectName: "mediaFolders"
            Layout.fillWidth: true; Layout.preferredHeight: Math.min(60, count * 30)
            clip: true; model: WinMedia.folders
            ScrollBar.vertical: LibraryScrollBar {}
            delegate: Item {
                required property string modelData
                width: ListView.view.width; height: 30
                Text { anchors.left: parent.left; anchors.right: remove.left; anchors.rightMargin: 8; anchors.verticalCenter: parent.verticalCenter; text: modelData; elide: Text.ElideMiddle; color: Theme.textSecondary; font.pixelSize: 9 }
                IconButton { id: remove; anchors.right: parent.right; anchors.rightMargin: 12; buttonSize: 24; glyph: "\uE711"; tooltip: "Masquer ce dossier dans Qt Panel"; onClicked: WinMedia.removeFolder(modelData) }
            }
        }
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
        cellWidth: width / Math.max(2, Math.floor(width / 135))
        cellHeight: cellWidth + 47
        model: pane.albums
        ScrollBar.vertical: LibraryScrollBar {}
        delegate: Item {
            required property var modelData
            width: grid.cellWidth; height: grid.cellHeight
            Rectangle {
                id: art
                x: 4; y: 4; width: parent.width - 12; height: width
                radius: 6; color: Qt.darker(Theme.cardFill, 1.3)
                Image { anchors.fill: parent; anchors.margins: 1; source: modelData.artwork || ""; sourceSize: Qt.size(320,320); fillMode: Image.PreserveAspectFit; asynchronous: true }
                Text { anchors.centerIn: parent; visible: !modelData.artwork; text: "\uE93C"; color: Theme.textSecondary; font.family: "Segoe Fluent Icons"; font.pixelSize: 30 }
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: pane.selectedAlbum = modelData.id }
            }
            Text { x: 4; y: art.height + 10; width: parent.width - 37; text: modelData.title; elide: Text.ElideRight; color: Theme.textPrimary; font.pixelSize: 11 }
            Text { x: 4; y: art.height + 27; width: parent.width - 37; text: modelData.artist || modelData.count + " titres"; elide: Text.ElideRight; color: Theme.textSecondary; font.pixelSize: 9 }
            IconButton { anchors.right: parent.right; anchors.rightMargin: 8; y: art.height + 10; buttonSize: 24; glyph: "\uE768"; tooltip: "Lire l'album"; enabled: !WinMedia.busy; onClicked: { WinMedia.playAlbum(modelData.id); pane.playRequested() } }
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
