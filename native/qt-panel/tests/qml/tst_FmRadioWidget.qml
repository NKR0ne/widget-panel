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
        region.currentIndex = 2
        region.activated(2)
        category.currentIndex = 7
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
        for (const name of ["radioRegionFilter", "radioCategoryFilter"]) {
            const selector = findChild(card, name)
            mouseClick(selector, 30, 14)
            tryCompare(selector.popup, "opened", true)
            card.y += 30
            card.width = 340
            wait(70)
            const point = selector.popup.background.mapToItem(selector, 0, 0)
            verify(Math.abs(point.x) < 1)
            verify(Math.abs(point.y - selector.height - 3) < 1)
            grabImage(testCase).save(name + "-popup.png")
            card.visible = false
            tryCompare(selector.popup, "visible", false)
            card.visible = true
        }
    }
}
