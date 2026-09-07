import QtQuick
import QtTest
import QtPanel.Native

TestCase {
    id: testCase
    name: "MediaWidget"
    width: 420
    height: 600
    visible: true
    when: windowShown
    property var card
    Rectangle { anchors.fill: parent; color: "#20252e"; z: -1 }
    Component { id: component; MediaWidget { width: 320; height: 420; color: "#2e353e" } }
    function init() {
        Store.values = {}
        WinMedia.playback = {connected: true, title: "Un titre de musique assez long pour tester la disposition", artist: "Artiste", album: "Album", playing: true, canPause: true, canPlay: true, canSeek: true, start: 0, end: 180, position: 30}
        WinMedia.library = [{title: "Premier titre", folder: "Musique", format: "MP3", kind: "audio", url: "file:///C:/Music/one.mp3"}, {title: "Second film", folder: "Videos", format: "MP4", kind: "video", url: "file:///C:/Videos/two.mp4"}]
        WinMedia.albums = [{id: "one", title: "Premier album", artist: "Artiste", artwork: "", count: 1}, {id: "two", title: "Second album", artist: "Artiste", artwork: "", count: 1}]
        WinMedia.playlists = [{id: "mix", title: "Selection", source: "Media Player", count: 2}]
        WinMedia.queue = []
        WinMedia.busy = false
        WinMedia.error = ""
        WinMedia.lastAction = ""
        WinMedia.lastFile = ""
        card = createTemporaryObject(component, testCase)
        verify(card)
        waitForRendering(card)
    }
    function test_controlsAndCapabilities() {
        verify(!findChild(card, "mediaVolume"))
        const play = findChild(card, "mediaPlayPause")
        verify(play.enabled)
        mouseClick(play, 20, 20)
        compare(WinMedia.lastAction, "pause")
        WinMedia.busy = true
        verify(!play.enabled)
        WinMedia.busy = false
        WinMedia.playback = {connected: false}
        verify(!play.enabled)
        const open = findChild(card, "mediaQueueToggle")
        mouseClick(open, 12, 12)
        compare(card.view, "library")
    }
    function test_librarySearchSelectAndPersistence() {
        card.view = "library"
        compare(Store.get("wp-media-view"), "library")
        const search = findChild(card, "mediaSearch")
        search.text = "Premier"
        const section = findChild(card, "mediaLibrarySection")
        section.currentIndex = 1
        section.activated(1)
        const list = findChild(card, "mediaLibraryList")
        tryCompare(list, "count", 1)
        waitForRendering(list)
        mouseClick(list, 90, 24)
        compare(WinMedia.lastFile, "file:///C:/Music/one.mp3")
        compare(card.view, "play")
    }
    function test_seekCommitsUserPosition() {
        const seek = findChild(card, "mediaSeek")
        mousePress(seek, 50, seek.height / 2)
        mouseMove(seek, seek.width * 0.75, seek.height / 2, 20)
        const requested = seek.value
        mouseRelease(seek, seek.width * 0.75, seek.height / 2)
        compare(WinMedia.lastAction, "seek")
        verify(Math.abs(WinMedia.lastValue - requested) < 1)
        verify(WinMedia.lastValue > 100)
    }
    function test_albumAndPlaylistSelection() {
        card.view = "library"
        const browser = findChild(card, "mediaBrowser")
        const grid = findChild(card, "mediaAlbumGrid")
        waitForRendering(grid)
        compare(grid.count, 2)
        mouseClick(grid, 40, 40)
        compare(browser.selectedAlbum, "one")
        const playAlbum = findChild(card, "mediaAlbumPlay")
        mouseClick(playAlbum, 14, 14)
        compare(WinMedia.lastAction, "album:one")
        compare(card.view, "play")
        card.view = "library"
        browser.browseMode = 2
        const list = findChild(card, "mediaLibraryList")
        tryCompare(list, "count", 1)
        waitForRendering(list)
        mouseClick(list, 70, 24)
        compare(WinMedia.lastAction, "playlist:mix")
        compare(card.view, "play")
    }
    function test_compactAndTallLayouts() {
        for (const height of [330, 560]) {
            card.height = height
            for (const view of ["play", "library"]) {
                card.view = view
                waitForRendering(card)
                const child = findChild(card, view === "play" ? "mediaPlayPause" : "mediaAlbumGrid")
                const point = child.mapToItem(card, 0, 0)
                verify(point.y >= 0)
                verify(point.y + child.height <= card.height)
                const image = grabImage(card)
                compare(image.width, card.width)
                compare(image.height, card.height)
                image.save("media-" + view + "-" + height + ".png")
            }
        }
    }
    function test_themedPopupAndQueueScrollbar() {
        card.height = 330
        card.view = "library"
        const browser = findChild(card, "mediaBrowser")
        const queue = []
        for (let i = 0; i < 20; ++i) queue.push({title: "Titre " + i, artist: "Artiste", album: "Album"})
        WinMedia.queue = queue
        browser.browseMode = 3
        const list = findChild(card, "mediaLibraryList")
        tryCompare(list, "count", 20)
        const bar = findChild(card, "mediaTrackScrollBar")
        verify(bar.width <= 7)
        compare(bar.contentItem.color, Theme.textSecondary)
        waitForRendering(card)
        grabImage(card).save("media-queue-scrollbar.png")
        const section = findChild(card, "mediaLibrarySection")
        mouseClick(section, 40, 14)
        tryCompare(section.popup, "visible", true)
        compare(section.popup.background.color, Theme.panelSolid)
        waitForRendering(card)
        grabImage(testCase).save("media-library-popup.png")
        const listItem = section.popup.contentItem
        mouseClick(listItem, 50, 16)
        tryCompare(browser, "browseMode", 0)
        tryCompare(section.popup, "visible", false)
    }
}
