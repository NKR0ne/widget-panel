import QtQuick
import QtTest
import QtPanel.Native

TestCase {
    id: testCase
    name: "FmRadioWidget"
    width: 440; height: 850
    visible: true
    when: windowShown
    property var card
    Rectangle { anchors.fill: parent; color: "#20252e"; z: -1 }
    Component { id: component; FmRadioWidget { width: 320; height: 365; color: "#2e353e" } }
    function init() {
        Radio.favorites = []
        Radio.favoritesMode = false
        Radio.playing = false
        Radio.currentStationId = ""
        Radio.browse("", "local", "all")
        const stations = []
        for (let i = 0; i < 30; ++i)
            stations.push({id: String(i), name: "Station " + i, frequency: "98.1 FM", codec: "MP3"})
        Radio.stations = stations
        card = createTemporaryObject(component, testCase)
        verify(card)
        waitForRendering(card)
    }
    function test_stationListFillsResizedCard() {
        const list = findChild(card, "radioStationList")
        const footer = findChild(card, "radioFooter")
        const compact = list.height
        card.height += 240
        waitForRendering(card)
        compare(list.height, compact + 240)
        const bottom = footer.mapToItem(card, 0, footer.height)
        verify(Math.abs(bottom.y - card.height + 12) < 1)
        grabImage(card).save("radio-expanded.png")
    }
    function test_filtersRestoreAcrossCardCreation() {
        const region = findChild(card, "radioRegionFilter")
        const category = findChild(card, "radioCategoryFilter")
        region.activated(2)
        category.activated(7)
        compare(Radio.region, "world")
        compare(Radio.category, "jazz")
        card.destroy()
        card = createTemporaryObject(component, testCase)
        waitForRendering(card)
        compare(findChild(card, "radioRegionFilter").currentIndex, 2)
        compare(findChild(card, "radioCategoryFilter").currentIndex, 7)
        card.returnToLibrary()
        compare(findChild(card, "radioRegionFilter").currentIndex, 0)
        compare(findChild(card, "radioCategoryFilter").currentIndex, 0)
    }
    function test_menusFollowCardAndCloseWhenHidden() {
        card.x = 30; card.y = 50
        const menu = findChild(card, "radioFilterMenu")
        for (const name of ["radioRegionFilter", "radioCategoryFilter"]) {
            const selector = findChild(card, name)
            mouseClick(selector, 30, 14)
            tryCompare(menu, "visible", true)
            card.y += 30
            card.width = 340
            card.scale = 0.85
            wait(70)
            const point = menu.mapToItem(selector, 0, 0)
            verify(Math.abs(point.x) < 1)
            verify(Math.abs(point.y - selector.height - 3) < 1)
            const bottom = menu.mapToItem(card, menu.width, menu.height)
            verify(bottom.x <= card.width - 12)
            verify(bottom.y <= card.height - 12)
            grabImage(testCase).save(name + "-popup.png")
            card.visible = false
            tryCompare(menu, "visible", false)
            compare(card.activeFilter, null)
            card.visible = true
        }
    }
    function test_menuMouseKeyboardAndDismiss() {
        const region = findChild(card, "radioRegionFilter")
        const menu = findChild(card, "radioFilterMenu")
        const options = findChild(card, "radioFilterOptions")
        mouseClick(region, 30, 14)
        tryCompare(menu, "visible", true)
        keyClick(Qt.Key_Down)
        keyClick(Qt.Key_Return)
        compare(Radio.region, "canada")
        compare(region.currentIndex, 1)
        mouseClick(region, 30, 14)
        keyClick(Qt.Key_Escape)
        compare(menu.visible, false)
        mouseClick(region, 30, 14)
        options.positionViewAtIndex(2, ListView.Contain)
        waitForRendering(card)
        const option = options.itemAtIndex(2)
        verify(option)
        mouseClick(option, 20, 14)
        compare(Radio.region, "world")
        compare(menu.visible, false)
        card.returnToLibrary()
        compare(region.currentIndex, 0)
        mouseClick(region, 30, 14)
        mouseClick(card, 20, 50)
        compare(menu.visible, false)
    }
    function test_favoritesWithoutSearchAndAcrossCardCreation() {
        const list = findChild(card, "radioStationList")
        tryCompare(list, "count", 30)
        const star = findChild(list, "radioFavorite-0")
        verify(star)
        mouseClick(star)
        compare(Radio.favorites.length, 1)
        compare(Radio.playing, false)
        mouseClick(findChild(card, "radioFavoritesTab"))
        tryCompare(list, "count", 1)
        verify(!findChild(card, "radioRegionFilter").visible)
        mouseClick(list, 20, 12)
        compare(Radio.currentStationId, "0")
        verify(Radio.playing)
        Radio.stations = []
        card.destroy()
        card = createTemporaryObject(component, testCase)
        waitForRendering(card)
        const restoredList = findChild(card, "radioStationList")
        tryCompare(restoredList, "count", 1)
        grabImage(card).save("radio-favorites.png")
        mouseClick(findChild(restoredList, "radioFavorite-0"))
        tryCompare(restoredList, "count", 0)
        compare(Radio.currentStationId, "0")
        verify(Radio.playing)
    }
}
