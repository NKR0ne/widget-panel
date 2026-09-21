import QtQuick
import QtTest
import QtPanel.Native

TestCase {
    id: testCase
    name: "NewsReading"
    width: 1100
    height: 700
    visible: true
    when: windowShown
    property var stage
    Rectangle { anchors.fill: parent; color: "#20252e"; z: -1 }
    Component { id: stageComponent; NewsStage { width: testCase.width; height: testCase.height } }

    function init() {
        Store.values = { "wp-news-view-mode": "reader" }
        Motion.enabled = true
        News.categories = ["Quebec", "Science"]
        Reader.openCount = 0
        Panel.panelVisible = true
        NewsRead.states = ({})
        NewsRead.revision++
        stage = createTemporaryObject(stageComponent, testCase)
        verify(stage)
        waitForRendering(stage)
    }
    function list() { return findChild(stage, "newsReadingList") }
    function pane() { return findChild(stage, "newsReadingPane") }
    function focusArticle() {
        stage.openArticle(stage.selectedItems[23])
        tryCompare(stage, "focusProgress", 1, 1000)
    }
    function test_initialOverviewAndRefresh() {
          compare(stage.selectedItems.length, 40)
        compare(stage.selectedUrl, "")
        verify(!pane().visible)
        News.refresh()
        wait(50)
        compare(Reader.openCount, 0)
        verify(!pane().visible)
        const articles = findChild(stage, "newsReadingArticles")
        compare(Math.round(articles.x + articles.width), stage.width)
    }
    function test_unreadFilterAndReadControls() {
        const item = News.itemsFor("Quebec")[0]
        NewsRead.setRead(item, false)
        Store.set("wp-news-unread-only", true)
        compare(stage.selectedItems.length, 1)
        stage.openArticle(stage.selectedItems[0])
        NewsRead.setRead(item, true)
        compare(stage.selectedItems.length, 1) // Do not remove the actively read item.
        stage.closeArticle()
        tryCompare(stage, "focusedCategory", "", 1000)
        compare(stage.selectedItems.length, 0)
        Store.set("wp-news-unread-only", false)
        compare(stage.selectedItems.length, 40)
    }
    function test_countBadgesAndReadContrast() {
        mouseMove(stage, stage.width - 2, stage.height - 2)
        const item = stage.selectedItems[0]
        NewsRead.setRead(item, false)
        const badge = findChild(stage, "newsAllCountBadge")
        compare(badge.width, badge.height)
        compare(badge.radius, badge.width / 2)
        compare(badge.count, 1)
        verify(badge.highlighted)
        const unreadRow = findChild(stage, "newsReadingRow0")
        const readRow = findChild(stage, "newsReadingRow1")
        verify(unreadRow && readRow)
        tryCompare(unreadRow, "color", Theme.cardFill)
        compare(readRow.color, Qt.rgba(0, 0, 0, 0))
        verify(readRow.border.color.a > 0)
        waitForRendering(stage)
        grabImage(testCase).save("news-read-contrast.png")
        NewsRead.setRead(item, true)
        tryCompare(unreadRow, "color", Qt.rgba(0, 0, 0, 0))
        verify(!badge.highlighted)
        const listBadge = findChild(stage, "newsListCountBadge")
        compare(listBadge.width, listBadge.height)
        compare(listBadge.count, 0)
        verify(!listBadge.visible)
        verify(!badge.visible)
        verify(!findChild(stage, "newsCategoryCountBadge0").visible)
    }
    function test_topRightBadgeMarksVisibleSelectionRead() {
        const quebec = News.itemsFor("Quebec")[0]
        const science = News.itemsFor("Science")[0]
        NewsRead.setRead(quebec, false)
        NewsRead.setRead(science, false)
        stage.selectCategory("Quebec")
        const badge = findChild(stage, "newsListCountBadge")
        compare(badge.count, 1)
        verify(badge.visible)
        waitForRendering(stage)
        mouseClick(badge, badge.width / 2, badge.height / 2)
        verify(!NewsRead.isUnread(quebec))
        verify(NewsRead.isUnread(science))
        verify(!badge.visible)
        compare(findChild(stage, "newsAllCountBadge").count, 1)
        stage.selectCategory("")
        compare(badge.count, 1)
        verify(badge.visible)
        waitForRendering(stage)
        mouseClick(badge, badge.width / 2, badge.height / 2)
        verify(!NewsRead.isUnread(science))
        verify(!badge.visible)
        verify(!findChild(stage, "newsAllCountBadge").visible)
    }
    function test_readRequiresFiveSecondsOfContinuousDisplay() {
        Motion.enabled = false
        const first = News.itemsFor("Quebec")[0]
        const second = News.itemsFor("Quebec")[1]
        NewsRead.setRead(first, false)
        NewsRead.setRead(second, false)
        stage.openArticle(first)
        const timer = findChild(stage, "newsReadDwellTimer")
        compare(timer.interval, 5000)
        verify(timer.running)
        wait(4600)
        verify(NewsRead.isUnread(first))
        stage.openArticle(second)
        wait(600)
        verify(NewsRead.isUnread(first))
        verify(NewsRead.isUnread(second))
        Panel.panelVisible = false
        verify(!timer.running)
        Panel.panelVisible = true
        verify(timer.running)
        Reader.busy = true
        verify(!timer.running)
        Reader.busy = false
        Reader.article = Object.assign({}, Reader.article, {seedFallback: true})
        verify(!timer.running)
        Reader.article = Object.assign({}, Reader.article, {seedFallback: false})
        verify(timer.running)
        tryVerify(function() { return !NewsRead.isUnread(second) }, 5600)
        verify(NewsRead.isUnread(first))
        NewsRead.setRead(first, false)
        stage.openArticle(first)
        verify(timer.running)
        stage.closeArticle()
        verify(!timer.running)
    }
    function test_clickFocusAndCloseRestoresOverview() {
        list().contentY = 300
        const previousScroll = list().contentY - list().originY
        const articles = findChild(stage, "newsReadingArticles")
        mouseClick(list(), 180, 25)
        tryCompare(stage, "focusProgress", 1, 1000)
        compare(stage.focusedCategory, "Quebec")
        compare(stage.selectedItems.length, 20)
        compare(articles.x, 0)
        verify(pane().visible)
        verify(pane().x >= articles.width + 8)
        const close = findChild(stage, "articleReaderClose")
        mouseClick(close, close.width / 2, close.height / 2)
        verify(!stage.categoryFocused)
        verify(Reader.article.url !== undefined)
        tryCompare(stage, "focusProgress", 0, 1000)
        compare(stage.selectedCategory, "")
        tryCompare(stage, "focusedCategory", "", 1000)
        tryVerify(function() { return stage.selectedItems.length === 40 })
        verify(!pane().visible)
        tryVerify(function() { return Math.abs(list().contentY - list().originY - previousScroll) < 1 })
    }
    function test_allCategoriesResolveClickedCategory() {
        focusArticle()
        compare(stage.focusedCategory, "Science")
        compare(stage.selectedCategory, "")
        verify(stage.selectedItems.every(function(item) { return item.readingCategory === "Science" }))
        News.refresh()
        compare(Reader.openCount, 1)
        compare(stage.focusedCategory, "Science")
    }
    function test_transitionAndRapidReopen() {
        stage.openArticle(stage.selectedItems[23])
        wait(100)
        verify(stage.focusProgress > 0 && stage.focusProgress < 1)
        stage.closeArticle()
        wait(40)
        stage.openArticle(News.itemsFor("Quebec")[0], "Quebec")
        tryCompare(stage, "focusProgress", 1, 1000)
        compare(stage.focusedCategory, "Quebec")
        verify(Reader.article.url.indexOf("Quebec") >= 0)
        verify(pane().visible)
    }
    function test_reducedMotionAndBackButton() {
        Motion.enabled = false
        stage.selectCategory("Science")
        stage.openArticle(stage.selectedItems[0])
        compare(stage.focusProgress, 1)
        waitForRendering(stage)
        mouseClick(findChild(stage, "newsReadingBack"), 13, 13)
        compare(stage.focusProgress, 0)
        compare(stage.selectedCategory, "Science")
        verify(!pane().visible)
    }
    function test_splitPersistenceAndModeReset() {
        stage.previewReaderSplit(0.25, 0.4)
        stage.commitReaderSplit()
        compare(stage.railFraction, 0.25)
        compare(stage.listFraction, 0.4)
        focusArticle()
        stage.setViewMode("carousel")
        compare(stage.selectedUrl, "")
        wait(450)
        stage.setViewMode("reader")
        compare(stage.selectedUrl, "")
        verify(!pane().visible)
        compare(stage.railFraction, 0.25)
        compare(stage.listFraction, 0.4)
    }
    function test_carouselToReaderUsesReaderColumnCountImmediately() {
        Store.set("wp-news-columns-carousel", 6)
        Store.set("wp-news-columns-reader", 3)
        stage.setViewMode("carousel")
        compare(stage.configuredColumns, 6)
        stage.setViewMode("reader")
        compare(stage.configuredColumns, 3)
        verify(stage.viewMode === "reader")
    }
    function test_categoryRemovedWhileFocused() {
        focusArticle()
        News.categories = ["Quebec"]
        tryCompare(stage, "focusProgress", 0, 1000)
        tryCompare(stage, "focusedCategory", "", 1000)
        verify(!pane().visible)
    }
    function test_visualStates() {
        grabImage(testCase).save("news-overview.png")
        stage.openArticle(stage.selectedItems[23])
        wait(100)
        grabImage(testCase).save("news-transition.png")
        tryCompare(stage, "focusProgress", 1, 1000)
        waitForRendering(stage)
        grabImage(testCase).save("news-focused.png")
        stage.closeArticle()
        tryCompare(stage, "focusProgress", 0, 1000)
        waitForRendering(stage)
        grabImage(testCase).save("news-returned.png")
    }
}
