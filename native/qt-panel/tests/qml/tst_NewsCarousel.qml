import QtQuick
import QtTest
import QtPanel.Native
TestCase {
    id: testCase
    name: "NewsCarouselReadState"
    width: 400; height: 340
    visible: true; when: windowShown
    Component { id: component; NewsCarouselUnderTest { width: 360; height: 300; categoryLabel: "Quebec"; forceCarouselPresentation: true } }
    function init() { Store.values = ({}); NewsRead.states = ({}); NewsRead.revision++; Motion.enabled = true }
    function test_rotationWrapNeverMarksRead() {
        const card = createTemporaryObject(component, testCase)
        verify(card)
        const items = News.itemsFor("Quebec")
        for (const item of items) NewsRead.setRead(item, false)
        const count = NewsRead.unreadCount(items)
        card.carouselIndex = card.carouselCount - 1
        card.syncCarouselFace()
        card.rotateCarousel(1)
        tryCompare(card, "flipRunning", false, 1000)
        compare(card.carouselIndex, 0)
        compare(NewsRead.unreadCount(items), count)
        Store.set("wp-news-unread-only", true)
        NewsRead.setRead(items[0], true)
        compare(card.presentationItems.length, count - 1)
        compare(NewsRead.unreadCount(items), count - 1)
    }
}
