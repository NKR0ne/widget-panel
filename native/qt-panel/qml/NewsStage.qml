import QtQuick
import QtQuick.Dialogs
import QtPanel.Native

// News workspace mapped onto the shared configured column span: one category
// column, then balanced article-list and reader spans using all remaining room.
Item {
    id: stage

    property string selectedCategory: ""
    property string selectedUrl: ""
    property int newsRevision: 0
    property int storeRevision: 0
    readonly property string viewMode: {
        storeRevision
        return Store.get("wp-news-view-mode", "reader") === "carousel"
            ? "carousel" : "reader"
    }
    readonly property int configuredColumns: {
        storeRevision
        return Math.max(3, Math.min(6,
            Number(Store.get("wp-base-columns", 3)) || 3))
    }
    readonly property int articleColumns: Math.max(
        1, Math.floor((configuredColumns - 1) / 2))
    readonly property real railWidth: Math.max(1, width / configuredColumns)
    readonly property real dividerPosition: Math.round(
        width * (1 + articleColumns) / configuredColumns)
    readonly property var selectedItems: {
        newsRevision
        const result = []
        const seen = {}
        const labels = selectedCategory !== "" ? [selectedCategory] : News.categories
        for (const label of labels) {
            for (const item of News.itemsFor(label)) {
                const key = item.link || (label + "|" + (item.title || ""))
                if (!seen[key]) {
                    seen[key] = true
                    result.push(item)
                }
            }
        }
        return result
    }

    function selectCategory(label) {
        selectedCategory = label || ""
        selectedUrl = ""
        Reader.close()
    }

    function openArticle(item) {
        if (!item || !item.link)
            return
        selectedUrl = String(item.link)
        Reader.open(item.link, item.title || "", item.source || "",
                    item.image || "", item.description || "")
    }

    function setViewMode(mode) {
        const next = mode === "carousel" ? "carousel" : "reader"
        if (next === viewMode)
            return
        selectedUrl = ""
        Reader.close()
        Store.set("wp-news-view-mode", next)
    }

    function openCarouselArticle(label, item) {
        setViewMode("reader")
        selectedCategory = label || ""
        openArticle(item)
    }

    Connections {
        target: News
        function onCategoriesChanged() {
            stage.newsRevision++
            if (stage.selectedCategory !== ""
                    && News.categories.indexOf(stage.selectedCategory) < 0)
                stage.selectCategory("")
        }
        function onCategoryUpdated() { stage.newsRevision++ }
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-base-columns" || key === "wp-news-view-mode")
                stage.storeRevision++
        }
    }

    Component.onDestruction: Reader.close()

    FileDialog {
        id: opmlDialog
        title: "Importer OPML"
        nameFilters: ["OPML (*.opml *.xml)", "Tous les fichiers (*)"]
        onAccepted: News.importOpml(selectedFile)
    }

    Item {
        id: categoryRail
        visible: stage.viewMode === "reader"
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: stage.railWidth

        Row {
            id: railHeader
            width: parent.width
            height: 30
            spacing: 5

            Text {
                width: Math.max(32, parent.width - newsViewSwitch.width
                                - refreshButton.width - importButton.width - 15)
                anchors.verticalCenter: parent.verticalCenter
                text: "Nouvelles"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeTitle
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }
            Rectangle {
                id: newsViewSwitch
                width: 78
                height: 24
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.035)
                border.color: Theme.cardStroke

                Row {
                    anchors.fill: parent
                    anchors.margins: 1

                    Repeater {
                        model: [
                            { id: "reader", label: "Lire" },
                            { id: "carousel", label: "Cartes" },
                        ]
                        delegate: Rectangle {
                            required property var modelData
                            width: 38
                            height: 22
                            radius: 5
                            color: stage.viewMode === modelData.id
                                   ? Theme.activeFill
                                   : viewChoiceMouse.containsMouse ? Theme.hover : "transparent"
                            Text {
                                anchors.centerIn: parent
                                text: parent.modelData.label
                                color: stage.viewMode === parent.modelData.id
                                       ? Theme.textPrimary : Theme.textSecondary
                                font.pixelSize: 8
                            }
                            MouseArea {
                                id: viewChoiceMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: stage.setViewMode(parent.modelData.id)
                            }
                        }
                    }
                }
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
                    font.pixelSize: 9
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
                    font.pixelSize: 9
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
                    height: 36
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
                        font.pixelSize: 10
                        elide: Text.ElideRight
                    }
                    Text {
                        id: allCount
                        anchors.right: parent.right
                        anchors.rightMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                        text: stage.selectedCategory === "" ? stage.selectedItems.length : News.categories.length
                        color: Theme.textSecondary
                        font.pixelSize: 9
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
                    model: {
                        stage.newsRevision
                        return News.categories
                    }
                    delegate: Rectangle {
                        required property string modelData
                        width: categoryColumn.width
                        height: 38
                        radius: 6
                        color: stage.selectedCategory === modelData ? Theme.activeFill
                             : categoryMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: stage.selectedCategory === modelData ? Theme.accent : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            anchors.right: itemCount.left
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData
                            color: Theme.textPrimary
                            font.pixelSize: 10
                            elide: Text.ElideRight
                        }
                        Text {
                            id: itemCount
                            anchors.right: parent.right
                            anchors.rightMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            text: News.isLoading(modelData) ? "..." : News.itemsFor(modelData).length
                            color: News.isLoading(modelData) ? Theme.accent : Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: categoryMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: stage.selectCategory(modelData)
                        }
                    }
                }
            }
        }
    }

    Item {
        id: articleListPane
        visible: stage.viewMode === "reader"
        anchors.left: categoryRail.right
        anchors.leftMargin: 8
        anchors.right: centerDivider.left
        anchors.rightMargin: 8
        anchors.top: parent.top
        anchors.bottom: parent.bottom

        Row {
            id: listHeader
            width: parent.width
            height: 30
            spacing: 8

            Text {
                width: Math.max(60, parent.width - listCount.width - 8)
                anchors.verticalCenter: parent.verticalCenter
                text: stage.selectedCategory !== "" ? stage.selectedCategory : "Toutes les nouvelles"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeTitle
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }
            Text {
                id: listCount
                anchors.verticalCenter: parent.verticalCenter
                text: stage.selectedItems.length + " articles"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
            }
        }

        ListView {
            id: articleList
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: listHeader.bottom
            anchors.bottom: parent.bottom
            anchors.topMargin: 8
            model: stage.newsRevision, stage.selectedItems
            spacing: 6
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
                id: articleRow
                required property var modelData
                required property int index
                width: ListView.view.width
                height: 94
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
                    width: visible ? 108 : 0
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
                        font.pixelSize: 11
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
                        font.pixelSize: 9
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
                        font.pixelSize: 8
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
                visible: articleList.count === 0
                text: News.categories.length === 0
                      ? "Aucune categorie configuree" : "Aucun article disponible"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeBody
            }
        }
    }

    Rectangle {
        id: centerDivider
        visible: stage.viewMode === "reader"
        x: stage.dividerPosition - 1
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 1
        color: Theme.cardStroke
    }

    ArticleReaderPane {
        id: readerPane
        visible: stage.viewMode === "reader"
        anchors.left: centerDivider.right
        anchors.leftMargin: 7
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        active: stage.selectedUrl !== ""
        onCloseRequested: stage.selectedUrl = ""
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
                width: Math.max(60, parent.width - carouselViewSwitch.width
                                - carouselRefreshButton.width
                                - carouselImportButton.width - 24)
                anchors.verticalCenter: parent.verticalCenter
                text: "Nouvelles par categorie"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeTitle
                font.weight: Font.DemiBold
                elide: Text.ElideRight
            }

            Rectangle {
                id: carouselViewSwitch
                width: 104
                height: 24
                radius: 6
                anchors.verticalCenter: parent.verticalCenter
                color: Qt.rgba(1, 1, 1, 0.035)
                border.color: Theme.cardStroke

                Row {
                    anchors.fill: parent
                    anchors.margins: 1

                    Repeater {
                        model: [
                            { id: "reader", label: "Lire" },
                            { id: "carousel", label: "Cartes" },
                        ]
                        delegate: Rectangle {
                            required property var modelData
                            width: 51
                            height: 22
                            radius: 5
                            color: stage.viewMode === modelData.id
                                   ? Theme.activeFill
                                   : carouselChoiceMouse.containsMouse ? Theme.hover : "transparent"
                            Text {
                                anchors.centerIn: parent
                                text: parent.modelData.label
                                color: stage.viewMode === parent.modelData.id
                                       ? Theme.textPrimary : Theme.textSecondary
                                font.pixelSize: 9
                            }
                            MouseArea {
                                id: carouselChoiceMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: stage.setViewMode(parent.modelData.id)
                            }
                        }
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
                    font.pixelSize: 9
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
                    font.pixelSize: 9
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
                columns: stage.configuredColumns
                spacing: 8
                readonly property real cardWidth: Math.floor(
                    (width - Math.max(0, columns - 1) * spacing) / Math.max(1, columns))

                Repeater {
                    model: stage.newsRevision, News.categories
                    delegate: NewsWidget {
                        required property string modelData
                        width: categoryGrid.cardWidth
                        height: implicitHeight
                        categoryLabel: modelData
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
                font.pixelSize: Theme.fontSizeBody
                horizontalAlignment: Text.AlignHCenter
            }
        }
    }
}
