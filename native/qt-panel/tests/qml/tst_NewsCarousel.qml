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
    Component { id: controlsComponent; NewsReadControls { labeledFilter: true } }
    Component { id: visualComponent; NewsArticleVisual { width: 360; height: 220 } }
    function test_unreadToggleAndHighlightsPersist() {
        const item = News.itemsFor("Quebec")[0]
        NewsRead.setRead(item, false)
        const card = createTemporaryObject(component, testCase)
        const controls = createTemporaryObject(controlsComponent, testCase)
        const toggle = findChild(controls, "newsUnreadOnlyToggle")
        waitForRendering(controls)
        mouseClick(toggle, toggle.width / 2, toggle.height / 2)
        compare(Store.get("wp-news-unread-only", false), true)
        compare(card.presentationItems.length, 1)
        const restored = createTemporaryObject(controlsComponent, testCase)
        verify(findChild(restored, "newsUnreadOnlyToggle").checked)
        const visual = createTemporaryObject(visualComponent, testCase, {article: item})
        verify(findChild(visual, "newsArticleUnreadStripe").visible)
        NewsRead.setRead(item, true)
        compare(card.presentationItems.length, 0)
        verify(!findChild(visual, "newsArticleUnreadStripe").visible)
        compare(findChild(visual, "newsArticleReadTone").color, Theme.panelSolid)
        card.visible = false
        restored.visible = false
        visual.y = 40; visual.width = 190
        const unreadItem = News.itemsFor("Quebec")[1]
        NewsRead.setRead(unreadItem, false)
        createTemporaryObject(visualComponent, testCase, {article: unreadItem, x: 200, y: 40, width: 190})
        waitForRendering(testCase)
        grabImage(testCase).save("news-carousel-read-contrast.png")
    }
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
