import QtQuick
import QtQuick.Dialogs
import QtPanel.Native

// The same article list moves from the overview into the focused category rail.
Item {
    id: stage
    clip: true

    property string selectedCategory: ""
    property string selectedUrl: ""
    property string focusedCategory: ""
    property bool categoryFocused: false
    property real overviewScrollY: 0
    property real focusProgress: categoryFocused ? 1 : 0
    readonly property bool focusTransitioning: focusAnimation.running
    Behavior on focusProgress {
        NumberAnimation {
            id: focusAnimation
            duration: Motion.panelMs
            easing.type: Easing.BezierSpline
            easing.bezierCurve: Motion.emphasized
        }
    }
    onFocusProgressChanged: {
        if (!categoryFocused && focusProgress === 0)
            finishClosingArticle()
    }
    property int newsRevision: 0
    property int storeRevision: 0
    property int carouselCascadeCursor: 0
    property int carouselCascadeDelay: 5000
    property int carouselCascadeLastIndex: -1
    property var carouselCascadeOrder: []
    property bool pressReaderWasOpen: false
    // True while a rail row is being dragged, so the drop doesn't also select.
    property bool draggingCategory: false

    // Content-pane rect, published so PanelColumns can seat the single shared
    // PressReader web view in this workspace (no second WebEngineView).
    readonly property bool pressReaderSelected: viewMode === "pressreader"
    readonly property real contentPaneX: 0
    readonly property real contentPaneY: 0
    readonly property real contentPaneWidth: width
    readonly property real contentPaneHeight: height
    readonly property string viewMode: {
        storeRevision
        const stored = String(Store.get("wp-news-view-mode", "carousel") || "carousel")
        if (stored === "reader" || stored === "live" || stored === "pressreader")
            return stored
        return "carousel"
    }
    readonly property int configuredColumns: {
        storeRevision
        const fallback = Number(Store.get("wp-base-columns", 3)) || 3
        const legacy = Number(Store.get("wp-news-columns", fallback)) || fallback
        const mode = viewMode === "reader" || viewMode === "live"
                     || viewMode === "pressreader" ? viewMode : "carousel"
        // Lecture is fixed at three panes (mirrors columnsForMode in C++).
        if (mode === "reader")
            return 3
        return Math.max(3, Math.min(6,
            Number(Store.get("wp-news-columns-" + mode, legacy)) || legacy))
    }
    readonly property real uiScale: {
        storeRevision
        return Math.max(0.85, Math.min(1.35,
            Number(Store.get("wp-news-ui-scale", 1.0)) || 1.0))
    }
    // Card size in Cartes view (1..5, 3 = default). Independent of uiScale,
    // which stays the text control: this one changes the card's dimensions.
    readonly property int cardSize: {
        storeRevision
        return Math.max(1, Math.min(5, Number(Store.get("wp-news-card-size", 3)) || 3))
    }
    // Bigger cards ⇒ fewer per row. Reader-view layout is untouched.
    readonly property int carouselColumns: Math.max(1, Math.min(6,
        configuredColumns + (3 - cardSize)))
    readonly property real cardSizeScale: 1.0 + (cardSize - 3) * 0.18
    // Independent rail widths for overview and focus; retain the legacy setting.
    readonly property real minPaneFraction: 0.22
    // >= 0 while a splitter is being dragged, otherwise the stored value shows.
    property real railFractionDraft: -1
    property real listFractionDraft: -1
    readonly property var storedReaderSplit: {
        storeRevision
        let parsed = {}
        const raw = Store.get("wp-news-reader-split", "")
        if (raw !== undefined && raw !== null && raw !== "") {
            if (typeof raw === "string") {
                try { parsed = JSON.parse(raw) } catch (e) { parsed = {} }
            } else {
                parsed = raw
            }
        }
        return stage.clampReaderSplit(Number(parsed.rail) || (1 / 3),
                                      Number(parsed.list) || (1 / 3))
    }
    readonly property real railFraction: railFractionDraft >= 0
                                         ? railFractionDraft : storedReaderSplit.rail
    readonly property real listFraction: listFractionDraft >= 0
                                         ? listFractionDraft : storedReaderSplit.list
    readonly property real railWidth: Math.max(1, Math.round(width * railFraction))
    readonly property real focusedRailWidth: Math.max(1, Math.round(width * listFraction))
    readonly property real dividerPosition: railWidth
        + (focusedRailWidth - railWidth) * focusProgress
    readonly property var selectedItems: {
        newsRevision
        const result = []
        const seen = {}
        const category = focusedCategory || selectedCategory
        const labels = category !== "" ? [category] : News.categories
        for (const label of labels) {
            for (const item of News.itemsFor(label)) {
                const key = item.link || (label + "|" + (item.title || ""))
                if (!seen[key]) {
                    seen[key] = true
                    result.push(Object.assign({}, item, { readingCategory: label }))
                }
            }
        }
        return result
    }

    function selectCategory(label) {
        resetReading()
        selectedCategory = label || ""
        articleList.positionViewAtBeginning()
    }

    function uiPx(value) {
        return Math.max(8, Math.round(Number(value) * uiScale))
    }

    function openArticle(item, category) {
        if (!item || !item.link)
            return
        const label = category || item.readingCategory || focusedCategory
            || selectedCategory || News.categories.find(function(label) {
                return News.itemsFor(label).some(function(candidate) {
                    return candidate.link === item.link
                })
            })
        if (!label)
            return
        if (focusedCategory === "")
            overviewScrollY = articleList.contentY - articleList.originY
        focusedCategory = label
        selectedUrl = String(item.link)
        categoryFocused = true
        articleListPane.forceActiveFocus()
        Reader.open(item.link, item.title || "", item.source || "",
                    item.image || "", item.description || "")
        Qt.callLater(function() {
            if (!stage.categoryFocused)
                return
            const index = stage.selectedItems.findIndex(function(candidate) {
                return String(candidate.link) === stage.selectedUrl
            })
            if (index >= 0)
                articleList.positionViewAtIndex(index, ListView.Contain)
        })
    }

    function closeArticle() {
        categoryFocused = false
        if (focusProgress === 0)
            finishClosingArticle()
    }

    function finishClosingArticle() {
        if (focusedCategory === "")
            return
        focusedCategory = ""
        selectedUrl = ""
        Reader.close()
        Qt.callLater(function() {
            if (stage.focusedCategory !== "")
                return
            articleList.contentY = articleList.originY + Math.max(0,
                Math.min(stage.overviewScrollY,
                         articleList.contentHeight - articleList.height))
        })
    }

    function resetReading() {
        categoryFocused = false
        focusedCategory = ""
        selectedUrl = ""
        overviewScrollY = 0
        Reader.close()
    }

    // Each layout has one splitter. Neither rail may crowd out its content pane.
    function clampReaderSplit(rail, list) {
        const minimum = minPaneFraction
        const safeRail = Number(rail) || (1 / 3)
        const safeList = Number(list) || (1 / 3)
        const clampedRail = Math.max(minimum,
            Math.min(0.5, safeRail))
        const clampedList = Math.max(minimum,
            Math.min(0.5, safeList))
        return { rail: clampedRail, list: clampedList }
    }

    function previewReaderSplit(rail, list) {
        const split = clampReaderSplit(rail, list)
        railFractionDraft = split.rail
        listFractionDraft = split.list
    }

    function commitReaderSplit() {
        if (railFractionDraft < 0 && listFractionDraft < 0)
            return
        const split = clampReaderSplit(railFraction, listFraction)
        railFractionDraft = -1
        listFractionDraft = -1
        Store.set("wp-news-reader-split", JSON.stringify(split))
    }

    function adjustCardSize(delta) {
        const next = Math.max(1, Math.min(5, cardSize + delta))
        if (next === cardSize)
            return
        Store.set("wp-news-card-size", next)
    }

    function setViewMode(mode) {
        const requested = mode === "cards" ? "carousel" : String(mode || "")
        const next = requested === "reader" || requested === "live"
                     || requested === "pressreader" ? requested : "carousel"
        if (next === viewMode) {
            if (next === "pressreader" && !PressReader.open)
                PressReader.openCatalog()
            return
        }
        resetReading()
        Store.set("wp-news-view-mode", next)
        if (next === "pressreader" && !PressReader.open)
            PressReader.openCatalog()
    }

    function openCarouselArticle(label, item) {
        setViewMode("reader")
        selectedCategory = label || ""
        openArticle(item, label)
    }

    function carouselCardIsVisible(card) {
        if (!card || !card.visible)
            return false
        const point = card.mapToItem(carouselScroll, 0, 0)
        return point.y + card.height > 0 && point.y < carouselScroll.height
    }

    function buildCarouselCascadeOrder() {
        const count = carouselCategoryRepeater.count
        const order = []
        for (let index = 0; index < count; ++index) {
            const card = carouselCategoryRepeater.itemAt(index)
            if (carouselCardIsVisible(card) && card.cascadeEligible)
                order.push(index)
        }

        // Fisher-Yates gives every eligible card one turn without producing a
        // distracting spatial wave across the grid.
        for (let index = order.length - 1; index > 0; --index) {
            const swapIndex = Math.floor(Math.random() * (index + 1))
            const value = order[index]
            order[index] = order[swapIndex]
            order[swapIndex] = value
        }
        if (order.length > 1 && order[0] === carouselCascadeLastIndex) {
            const swapIndex = 1 + Math.floor(Math.random() * (order.length - 1))
            const value = order[0]
            order[0] = order[swapIndex]
            order[swapIndex] = value
        }

        carouselCascadeOrder = order
        carouselCascadeCursor = 0
    }

    // Advances at most one card from a shuffled pass. Individual NewsWidget
    // indexes wrap independently through their articles.
    function advanceCarouselCascade() {
        if (carouselCascadeOrder.length === 0)
            buildCarouselCascadeOrder()
        if (carouselCascadeOrder.length === 0)
            return true

        while (carouselCascadeCursor < carouselCascadeOrder.length) {
            const index = carouselCascadeOrder[carouselCascadeCursor++]
            const card = carouselCategoryRepeater.itemAt(index)
            if (!carouselCardIsVisible(card) || !card.cascadeEligible)
                continue
            card.rotateCarousel(1)
            carouselCascadeLastIndex = index
            if (carouselCascadeCursor >= carouselCascadeOrder.length) {
                carouselCascadeOrder = []
                carouselCascadeCursor = 0
                return true
            }
            return false
        }

        carouselCascadeOrder = []
        carouselCascadeCursor = 0
        return true
    }

    function restartCarouselCascade() {
        carouselCascadeOrder = []
        carouselCascadeCursor = 0
        carouselCascadeDelay = 5000
        carouselCascadeTimer.restart()
    }

    Connections {
        target: News
        function onCategoriesChanged() {
            stage.newsRevision++
            if (stage.selectedCategory !== ""
                    && News.categories.indexOf(stage.selectedCategory) < 0)
                stage.selectCategory("")
            if (stage.focusedCategory !== ""
                    && News.categories.indexOf(stage.focusedCategory) < 0)
                stage.closeArticle()
        }
        function onCategoryUpdated() {
            stage.newsRevision++
        }
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-base-columns" || key === "wp-news-columns"
                    || key.indexOf("wp-news-columns-") === 0
                    || key === "wp-news-view-mode" || key === "wp-news-ui-scale"
                    || key === "wp-news-card-size"
                    || key === "wp-news-reader-split")
                stage.storeRevision++
        }
    }

    Connections {
        target: PressReader
        function onChanged() {
            if (PressReader.open) {
                stage.pressReaderWasOpen = true
            } else if (stage.pressReaderWasOpen
                       && stage.viewMode === "pressreader") {
                stage.pressReaderWasOpen = false
                Store.set("wp-news-view-mode", "carousel")
            }
        }
    }

    Component.onDestruction: Reader.close()
    Component.onCompleted: {
        if (viewMode === "carousel")
            restartCarouselCascade()
        else if (viewMode === "pressreader" && !PressReader.open)
            PressReader.openCatalog()
    }
    onViewModeChanged: {
        if (viewMode !== "reader")
            resetReading()
        if (viewMode === "carousel")
            restartCarouselCascade()
        else
            carouselCascadeTimer.stop()
        if (viewMode === "pressreader" && !PressReader.open)
            Qt.callLater(function() { PressReader.openCatalog() })
    }

    Timer {
        id: carouselCascadeTimer
        interval: stage.carouselCascadeDelay
        repeat: false
        onTriggered: {
            const passComplete = stage.advanceCarouselCascade()
            stage.carouselCascadeDelay = passComplete ? 6000 : 5000
            restart()
        }
    }

    FileDialog {
        id: opmlDialog
        title: "Importer OPML"
        nameFilters: ["OPML (*.opml *.xml)", "Tous les fichiers (*)"]
        onAccepted: News.importOpml(selectedFile)
    }

    Item {
        id: categoryRail
        visible: stage.viewMode === "reader" && stage.focusProgress < 1
        enabled: !stage.categoryFocused && !stage.focusTransitioning
        opacity: 1 - stage.focusProgress
        x: -width * stage.focusProgress
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: stage.railWidth

        Row {
            id: railHeader
            width: parent.width
            height: 30
            spacing: 5

            Text {
                width: Math.max(32, parent.width
                                - refreshButton.width - importButton.width - 10)
                anchors.verticalCenter: parent.verticalCenter
                text: "Nouvelles"
                color: Theme.textPrimary
                font.pixelSize: stage.uiPx(Theme.fontSizeTitle)
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }
            Rectangle {
                id: refreshButton
                width: refreshLabel.implicitWidth + 14
                height: 24
                radius: 6
                color: refreshMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text {
                    id: refreshLabel
                    anchors.centerIn: parent
                    text: "Actualiser"
                    color: Theme.textSecondary
                    font.pixelSize: stage.uiPx(9)
                }
                MouseArea {
                    id: refreshMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: News.refresh()
                }
            }
            Rectangle {
                id: importButton
                width: importLabel.implicitWidth + 14
                height: 24
                radius: 6
                color: importMouse.containsMouse ? Theme.activeFill : Theme.cardFill
                border.color: Theme.cardStroke
                Text {
                    id: importLabel
                    anchors.centerIn: parent
                    text: "OPML"
                    color: Theme.textSecondary
                    font.pixelSize: stage.uiPx(9)
                }
                MouseArea {
                    id: importMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: opmlDialog.open()
                }
            }
        }

        Flickable {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: railHeader.bottom
            anchors.bottom: parent.bottom
            anchors.topMargin: 8
            contentHeight: categoryColumn.height
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Column {
                id: categoryColumn
                width: parent.width
                spacing: 5

                Rectangle {
                    width: parent.width
                    height: Math.round(36 * stage.uiScale)
                    radius: 6
                    color: stage.selectedCategory === "" ? Theme.activeFill
                         : allMouse.containsMouse ? Theme.hover : "transparent"
                    border.color: stage.selectedCategory === "" ? Theme.accent : "transparent"

                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 10
                        anchors.right: allCount.left
                        anchors.rightMargin: 8
                        anchors.verticalCenter: parent.verticalCenter
                        text: "Toutes les categories"
                        color: Theme.textPrimary
                        font.pixelSize: stage.uiPx(10)
                        elide: Text.ElideRight
                    }
                    Text {
                        id: allCount
                        anchors.right: parent.right
                        anchors.rightMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                        text: stage.selectedCategory === "" ? stage.selectedItems.length : News.categories.length
                        color: Theme.textSecondary
                        font.pixelSize: stage.uiPx(9)
                    }
                    MouseArea {
                        id: allMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: stage.selectCategory("")
                    }
                }

                Repeater {
                    id: categoryRepeater
                    model: {
                        stage.newsRevision
                        return News.categories
                    }
                    delegate: Rectangle {
                        id: categoryRow
                        required property string modelData
                        required property int index
                        width: categoryColumn.width
                        height: Math.round(38 * stage.uiScale)
                        radius: 6
                        // Lift the row while it is being dragged to a new spot.
                        z: categoryDrag.active ? 10 : 0
                        scale: categoryDrag.active ? 1.02 : 1.0
                        Behavior on scale { NumberAnimation { duration: Motion.fastMs } }
                        color: categoryDrag.active ? Theme.activeFill
                             : stage.selectedCategory === modelData ? Theme.activeFill
                             : categoryMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: categoryDrag.active ? Theme.accent
                             : stage.selectedCategory === modelData ? Theme.accent : "transparent"

                        // Press-and-hold anywhere on the row to reorder; a short
                        // press falls through to the select click below.
                        transform: Translate { y: categoryDrag.active ? categoryDrag.activeTranslation.y : 0 }

                        DragHandler {
                            id: categoryDrag
                            target: null
                            yAxis.enabled: true
                            xAxis.enabled: false
                            dragThreshold: 6
                            onActiveChanged: {
                                if (categoryDrag.active) {
                                    stage.draggingCategory = true
                                    return
                                }
                                stage.draggingCategory = false
                                const rowHeight = Math.max(1, categoryRow.height + categoryColumn.spacing)
                                const steps = Math.round(categoryDrag.activeTranslation.y / rowHeight)
                                if (steps !== 0)
                                    News.moveCategory(categoryRow.index,
                                                      categoryRow.index + steps)
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            anchors.right: itemCount.left
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData
                            color: Theme.textPrimary
                            font.pixelSize: stage.uiPx(10)
                            elide: Text.ElideRight
                        }
                        Text {
                            id: itemCount
                            anchors.right: parent.right
                            anchors.rightMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            text: News.isLoading(modelData) ? "..." : News.itemsFor(modelData).length
                            color: News.isLoading(modelData) ? Theme.accent : Theme.textSecondary
                            font.pixelSize: stage.uiPx(9)
                        }
                        MouseArea {
                            id: categoryMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            // A drag consumed the gesture — don't also select.
                            onClicked: if (!stage.draggingCategory) stage.selectCategory(modelData)
                        }
                    }
                }

                // Rows glide to their new places after a reorder.
                move: Transition {
                    NumberAnimation {
                        properties: "y"
                        duration: Motion.normalMs
                        easing.type: Easing.BezierSpline
                        easing.bezierCurve: Motion.emphasized
                    }
                }

                // PressReader — pinned last, opens in the content pane.
                Rectangle {
                    visible: false
                    width: categoryColumn.width
                    height: Math.round(42 * stage.uiScale)
                    radius: 6
                    color: stage.pressReaderSelected ? Theme.activeFill
                         : pressMouse.containsMouse ? Theme.hover : "transparent"
                    border.color: stage.pressReaderSelected
                                  ? "#f7a64f" : Qt.rgba(0.97, 0.65, 0.31, 0.25)

                    Rectangle {
                        id: pressDot
                        anchors.left: parent.left
                        anchors.leftMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                        width: 6
                        height: 6
                        radius: 3
                        color: PressReader.open ? "#f7a64f" : Qt.rgba(0.97, 0.65, 0.31, 0.4)
                    }
                    Column {
                        anchors.left: pressDot.right
                        anchors.leftMargin: 8
                        anchors.right: parent.right
                        anchors.rightMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 1

                        Text {
                            width: parent.width
                            text: "PressReader"
                            color: Theme.textPrimary
                            font.pixelSize: stage.uiPx(10)
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: PressReader.sessionRemainingMinutes > 0
                                  ? PressReader.state + " · " + PressReader.sessionRemainingMinutes + " min"
                                  : PressReader.state
                            color: Theme.textSecondary
                            font.pixelSize: stage.uiPx(8)
                            elide: Text.ElideRight
                        }
                    }
                    MouseArea {
                        id: pressMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: stage.setViewMode("pressreader")
                    }
                }
            }
        }
    }

    Item {
        id: articleListPane
        objectName: "newsReadingArticles"
        visible: stage.viewMode === "reader"
        x: (stage.railWidth + 8) * (1 - stage.focusProgress)
        width: (stage.width - stage.railWidth - 8) * (1 - stage.focusProgress)
            + (stage.focusedRailWidth - 8) * stage.focusProgress
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        Keys.onEscapePressed: function(event) {
            if (stage.categoryFocused) {
                stage.closeArticle()
                event.accepted = true
            } else {
                event.accepted = false
            }
        }

        Row {
            id: listHeader
            width: parent.width
            height: 30
            spacing: 8

            IconButton {
                id: backToNews
                objectName: "newsReadingBack"
                visible: stage.focusedCategory !== ""
                opacity: stage.focusProgress
                enabled: stage.categoryFocused
                buttonSize: 26
                glyph: "\uE72B"
                tooltip: "Retour aux nouvelles"
                onClicked: stage.closeArticle()
            }
            Text {
                width: Math.max(0, parent.width - listCount.width - 8
                    - (backToNews.visible ? backToNews.width + 8 : 0))
                anchors.verticalCenter: parent.verticalCenter
                text: stage.focusedCategory || (stage.selectedCategory !== "" ? stage.selectedCategory
                    : "Toutes les nouvelles")
                color: Theme.textPrimary
                font.pixelSize: stage.uiPx(Theme.fontSizeTitle)
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }
            Text {
                id: listCount
                anchors.verticalCenter: parent.verticalCenter
                text: stage.selectedItems.length + " articles"
                color: Theme.textSecondary
                font.pixelSize: stage.uiPx(Theme.fontSizeCaption)
            }
        }

        ListView {
            id: articleList
            objectName: "newsReadingList"
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: listHeader.bottom
            anchors.bottom: parent.bottom
            anchors.topMargin: 8
            model: stage.selectedItems
            spacing: 6
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
                id: articleRow
                required property var modelData
                required property int index
                width: ListView.view.width
                height: Math.round(94 * stage.uiScale)
                radius: 6
                color: stage.selectedUrl === String(modelData.link || "") ? Theme.activeFill
                     : rowMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: stage.selectedUrl === String(modelData.link || "")
                              ? Theme.accent : Theme.cardStroke

                Rectangle {
                    id: thumbnailFrame
                    visible: (articleRow.modelData.image || "") !== ""
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    anchors.margins: 7
                    width: visible ? Math.min(108, articleRow.width * 0.3) : 0
                    radius: 5
                    color: Qt.rgba(1, 1, 1, 0.04)
                    clip: true

                    Image {
                        anchors.fill: parent
                        source: articleRow.modelData.image || ""
                        fillMode: Image.PreserveAspectCrop
                        asynchronous: true
                    }
                }

                Column {
                    anchors.left: thumbnailFrame.visible ? thumbnailFrame.right : parent.left
                    anchors.leftMargin: 9
                    anchors.right: parent.right
                    anchors.rightMargin: 9
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 4

                    Text {
                        width: parent.width
                        text: articleRow.modelData.title || "Article"
                        color: Theme.textPrimary
                        font.pixelSize: stage.uiPx(11)
                        font.weight: Font.DemiBold
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        wrapMode: Text.WordWrap
                    }
                    Text {
                        width: parent.width
                        text: articleRow.modelData.description || ""
                        visible: text !== ""
                        color: Theme.textSecondary
                        font.pixelSize: stage.uiPx(9)
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        wrapMode: Text.WordWrap
                    }
                    Text {
                        width: parent.width
                        text: [articleRow.modelData.source || "", articleRow.modelData.time || ""]
                              .filter(Boolean).join(" | ")
                        color: Theme.textSecondary
                        opacity: 0.78
                        font.pixelSize: stage.uiPx(8)
                        elide: Text.ElideRight
                    }
                }

                MouseArea {
                    id: rowMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: stage.openArticle(articleRow.modelData)
                }
            }

            Text {
                anchors.centerIn: parent
                width: parent.width - 32
                visible: articleList.count === 0
                text: News.categories.length === 0
                        ? "Aucune categorie configuree" : "Aucun article disponible"
                color: Theme.textSecondary
                font.pixelSize: stage.uiPx(Theme.fontSizeBody)
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }
        }
    }

    Rectangle {
        visible: stage.viewMode === "reader" && stage.focusProgress < 1
        x: categoryRail.x + categoryRail.width - 1
        opacity: 1 - stage.focusProgress
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 1
        color: Theme.cardStroke
    }

    Rectangle {
        visible: stage.viewMode === "reader" && stage.focusProgress > 0
        x: readerPane.x - 8
        opacity: stage.focusProgress
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 1
        color: Theme.cardStroke
    }

    // Keep the handle outside both clipping panes so its full hit area works.
    Item {
            id: splitter
            visible: stage.viewMode === "reader"
            enabled: !stage.focusTransitioning
            opacity: stage.focusTransitioning ? 0 : 1
            x: stage.dividerPosition - width / 2
            y: 0
            width: 12
            height: stage.height
            z: 30

            Rectangle {
                x: (splitter.width - width) / 2
                width: 2
                height: splitter.height
                radius: 1
                color: Theme.accent
                opacity: splitterDrag.active ? 0.9
                       : splitterHover.hovered ? 0.55 : 0
                Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
            }

            HoverHandler { id: splitterHover; cursorShape: Qt.SizeHorCursor }
            DragHandler {
                id: splitterDrag
                target: null
                xAxis.enabled: true
                yAxis.enabled: false
                property real startRail: 0
                property real startList: 0
                onActiveChanged: {
                    if (active) {
                        startRail = stage.railFraction
                        startList = stage.listFraction
                        stage.previewReaderSplit(startRail, startList)
                    } else {
                        stage.commitReaderSplit()
                    }
                }
                onActiveTranslationChanged: {
                    if (!active || stage.width <= 0)
                        return
                    const delta = activeTranslation.x / stage.width
                    if (stage.categoryFocused) {
                        stage.previewReaderSplit(startRail, startList + delta)
                    } else {
                        stage.previewReaderSplit(startRail + delta, startList)
                    }
                }
            }
    }

    // While PressReader is selected the content pane is filled by the
    // PressReader surface that PanelColumns seats into it.
    ArticleReaderPane {
        id: readerPane
        objectName: "newsReadingPane"
        visible: stage.viewMode === "reader" && stage.focusProgress > 0
        enabled: stage.categoryFocused
        opacity: stage.focusProgress
        x: stage.width + (stage.focusedRailWidth + 8 - stage.width) * stage.focusProgress
        width: Math.max(0, stage.width - stage.focusedRailWidth - 8)
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        active: stage.selectedUrl !== ""
        closeOnRequest: false
        onCloseRequested: stage.closeArticle()
    }

    Item {
        id: carouselMode
        visible: stage.viewMode === "carousel"
        anchors.fill: parent

        Row {
            id: carouselHeader
            width: parent.width
            height: 30
            spacing: 8

            Text {
                width: Math.max(60, parent.width - cardSizeControl.width
                                - carouselRefreshButton.width
                                - carouselImportButton.width - 24)
                anchors.verticalCenter: parent.verticalCenter
                text: "Nouvelles par categorie"
                color: Theme.textPrimary
                font.pixelSize: stage.uiPx(Theme.fontSizeTitle)
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }

            // Card size: changes the card's dimensions (not the text — that is
            // the separate UI-scale control in the panel header).
            Row {
                id: cardSizeControl
                spacing: 2
                anchors.verticalCenter: parent.verticalCenter

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Taille"
                    color: Theme.textSecondary
                    font.pixelSize: stage.uiPx(9)
                    rightPadding: 4
                }
                Rectangle {
                    width: 22
                    height: 24
                    radius: 6
                    color: cardMinusMouse.containsMouse && stage.cardSize > 1
                           ? Theme.hover : Theme.cardFill
                    border.color: Theme.cardStroke
                    opacity: stage.cardSize > 1 ? 1 : 0.35
                    Text {
                        anchors.centerIn: parent
                        text: "−"
                        color: Theme.textSecondary
                        font.pixelSize: stage.uiPx(11)
                    }
                    MouseArea {
                        id: cardMinusMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        enabled: stage.cardSize > 1
                        cursorShape: Qt.PointingHandCursor
                        onClicked: stage.adjustCardSize(-1)
                    }
                }
                Rectangle {
                    width: 22
                    height: 24
                    radius: 6
                    color: cardPlusMouse.containsMouse && stage.cardSize < 5
                           ? Theme.hover : Theme.cardFill
                    border.color: Theme.cardStroke
                    opacity: stage.cardSize < 5 ? 1 : 0.35
                    Text {
                        anchors.centerIn: parent
                        text: "+"
                        color: Theme.textSecondary
                        font.pixelSize: stage.uiPx(11)
                    }
                    MouseArea {
                        id: cardPlusMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        enabled: stage.cardSize < 5
                        cursorShape: Qt.PointingHandCursor
                        onClicked: stage.adjustCardSize(1)
                    }
                }
            }

            Rectangle {
                id: carouselRefreshButton
                width: carouselRefreshLabel.implicitWidth + 14
                height: 24
                radius: 6
                anchors.verticalCenter: parent.verticalCenter
                color: carouselRefreshMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text {
                    id: carouselRefreshLabel
                    anchors.centerIn: parent
                    text: "Actualiser"
                    color: Theme.textSecondary
                    font.pixelSize: stage.uiPx(9)
                }
                MouseArea {
                    id: carouselRefreshMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: News.refresh()
                }
            }

            Rectangle {
                id: carouselImportButton
                width: carouselImportLabel.implicitWidth + 14
                height: 24
                radius: 6
                anchors.verticalCenter: parent.verticalCenter
                color: carouselImportMouse.containsMouse ? Theme.activeFill : Theme.cardFill
                border.color: Theme.cardStroke
                Text {
                    id: carouselImportLabel
                    anchors.centerIn: parent
                    text: "OPML"
                    color: Theme.textSecondary
                    font.pixelSize: stage.uiPx(9)
                }
                MouseArea {
                    id: carouselImportMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: opmlDialog.open()
                }
            }
        }

        Flickable {
            id: carouselScroll
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: carouselHeader.bottom
            anchors.bottom: parent.bottom
            anchors.topMargin: 8
            contentWidth: width
            contentHeight: categoryGrid.height + 12
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Grid {
                id: categoryGrid
                width: carouselScroll.width
                height: childrenRect.height
                columns: stage.carouselColumns
                spacing: 8
                readonly property real cardWidth: Math.floor(
                    (width - Math.max(0, columns - 1) * spacing) / Math.max(1, columns))

                Repeater {
                    id: carouselCategoryRepeater
                    model: stage.newsRevision, News.categories
                    delegate: NewsWidget {
                        required property string modelData
                        width: categoryGrid.cardWidth
                        height: implicitHeight
                        categoryLabel: modelData
                        textScale: stage.uiScale
                        sizeScale: stage.cardSizeScale
                        delegateArticleOpening: true
                        forceCarouselPresentation: true
                        onArticleRequested: function(item) {
                            stage.openCarouselArticle(modelData, item)
                        }
                    }
                }
            }

            Text {
                visible: News.categories.length === 0
                width: carouselScroll.width
                anchors.top: parent.top
                anchors.topMargin: 80
                text: "Aucune categorie configuree"
                color: Theme.textSecondary
                font.pixelSize: stage.uiPx(Theme.fontSizeBody)
                horizontalAlignment: Text.AlignHCenter
            }
        }
    }

    Loader {
        id: liveStageLoader
        anchors.fill: parent
        active: stage.viewMode === "live"
        visible: active
        source: "LiveStage.qml"
    }
}
