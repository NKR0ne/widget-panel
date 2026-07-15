import QtQuick
import QtQuick.Layouts
import QtPanel.Native

Item {
    id: root

    property var colWidths: ({})
    property string selectedCategory: ""
    property var categoryItems: []
    property string selectedArticleId: ""
    property int newsRevision: 0
    readonly property real spotlightX: readerPane.x

    function chooseCategory(label) {
        if (!label)
            return
        selectedCategory = label
        categoryItems = News.itemsFor(label)
        selectedArticleId = ""
        Reader.close()
        articleList.positionViewAtBeginning()
    }

    function ensureCategory() {
        const categories = News.categories || []
        if (categories.length === 0) {
            selectedCategory = ""
            categoryItems = []
            return
        }
        if (categories.indexOf(selectedCategory) < 0)
            chooseCategory(categories[0])
    }

    function openArticle(item) {
        if (!item || !item.link)
            return
        selectedArticleId = item.id || item.link
        Reader.open(item.link, item.title, item.source, item.image)
    }

    Component.onCompleted: ensureCategory()

    Connections {
        target: News
        function onCategoriesChanged() { root.ensureCategory() }
        function onCategoryUpdated(label) {
            root.newsRevision++
            if (label === root.selectedCategory)
                root.categoryItems = News.itemsFor(label)
        }
    }

    RowLayout {
        anchors.fill: parent
        spacing: 6

        Rectangle {
            Layout.fillHeight: true
            Layout.fillWidth: true
            Layout.minimumWidth: 150
            Layout.preferredWidth: Number(root.colWidths.left) || 240
            radius: Theme.radiusCard
            color: Qt.rgba(1, 1, 1, 0.045)
            border.color: Theme.cardStroke

            Text {
                id: categoriesTitle
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 12
                text: "CATÉGORIES"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.weight: Font.DemiBold
                font.letterSpacing: 1.0
            }

            ListView {
                id: categoryList
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: categoriesTitle.bottom
                anchors.bottom: parent.bottom
                anchors.margins: 7
                anchors.topMargin: 10
                clip: true
                spacing: 3
                boundsBehavior: Flickable.StopAtBounds
                model: News.categories

                delegate: Rectangle {
                    id: categoryRow
                    required property var modelData
                    width: ListView.view.width
                    height: 36
                    radius: 5
                    color: root.selectedCategory === String(modelData)
                           ? Theme.activeFill
                           : categoryMouse.containsMouse ? Theme.hover : "transparent"

                    Rectangle {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        width: 3
                        height: 18
                        radius: 1.5
                        color: Theme.accent
                        visible: root.selectedCategory === String(parent.modelData)
                    }
                    Text {
                        anchors.left: parent.left
                        anchors.right: countText.left
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 10
                        anchors.rightMargin: 6
                        text: categoryRow.modelData
                        color: root.selectedCategory === String(categoryRow.modelData)
                               ? Theme.textPrimary : Theme.textSecondary
                        font.pixelSize: Theme.fontSizeBody
                        elide: Text.ElideRight
                    }
                    Text {
                        id: countText
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.rightMargin: 8
                        text: {
                            root.newsRevision
                            return News.itemsFor(String(categoryRow.modelData)).length
                        }
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: categoryMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.chooseCategory(String(categoryRow.modelData))
                    }
                }
            }
        }

        Rectangle {
            Layout.fillHeight: true
            Layout.fillWidth: true
            Layout.minimumWidth: 290
            Layout.preferredWidth: (Number(root.colWidths.monitor) || 240)
                                 + (Number(root.colWidths.mid) || 240) + 6
            radius: Theme.radiusCard
            color: Qt.rgba(1, 1, 1, 0.045)
            border.color: Theme.cardStroke
            clip: true

            RowLayout {
                id: listHeader
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 12
                spacing: 8
                Text {
                    Layout.fillWidth: true
                    text: root.selectedCategory || "Actualités"
                    color: Theme.textPrimary
                    font.pixelSize: 14
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                }
                Text {
                    text: root.categoryItems.length + " articles"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                }
                IconButton {
                    glyph: "\uE72C"
                    onClicked: News.refresh()
                }
            }

            ListView {
                id: articleList
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: listHeader.bottom
                anchors.bottom: parent.bottom
                anchors.leftMargin: 7
                anchors.rightMargin: 7
                anchors.topMargin: 8
                anchors.bottomMargin: 7
                model: root.categoryItems
                spacing: 5
                clip: true
                boundsBehavior: Flickable.StopAtBounds

                delegate: Rectangle {
                    id: articleRow
                    required property var modelData
                    required property int index
                    width: ListView.view.width
                    height: 86
                    radius: 6
                    color: root.selectedArticleId === (modelData.id || modelData.link)
                           ? Theme.activeFill
                           : articleMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.018)
                    border.color: root.selectedArticleId === (modelData.id || modelData.link)
                                  ? Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.45)
                                  : "transparent"

                    Rectangle {
                        id: thumb
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        anchors.margins: 7
                        width: visible ? 104 : 0
                        radius: 5
                        color: "#0b0d13"
                        visible: String(articleRow.modelData.image || "") !== ""
                        clip: true
                        Image {
                            anchors.fill: parent
                            source: articleRow.modelData.image || ""
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                        }
                    }

                    Column {
                        anchors.left: thumb.visible ? thumb.right : parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 9
                        anchors.rightMargin: 9
                        spacing: 5
                        Text {
                            width: parent.width
                            text: articleRow.modelData.title || "Article"
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeBody
                            font.weight: Font.Medium
                            wrapMode: Text.WordWrap
                            maximumLineCount: 3
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: (articleRow.modelData.source || "")
                                  + (articleRow.modelData.time ? "  ·  " + articleRow.modelData.time : "")
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            elide: Text.ElideRight
                        }
                    }

                    MouseArea {
                        id: articleMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: articleRow.modelData.link ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: root.openArticle(articleRow.modelData)
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                visible: root.categoryItems.length === 0
                text: root.selectedCategory ? "Chargement des articles..." : "Aucune catégorie active"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeBody
            }
        }

        ArticleReaderCard {
            id: readerPane
            Layout.fillHeight: true
            Layout.fillWidth: true
            Layout.minimumWidth: 420
            Layout.preferredWidth: (Number(root.colWidths.feed) || 240)
                                 + (Number(root.colWidths.right) || 240)
                                 + (Number(root.colWidths.aux) || 240) + 12
        }
    }
}
