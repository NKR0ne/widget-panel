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
        compare(stage.selectedItems.length, 40)
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
    function test_categoryRemovedWhileFocused() {
        focusArticle()
        News.categories = ["Quebec"]
        tryCompare(stage, "focusProgress", 0, 1000)
        compare(stage.focusedCategory, "")
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
