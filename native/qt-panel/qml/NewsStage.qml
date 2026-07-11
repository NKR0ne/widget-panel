import QtQuick
import QtQuick.Dialogs
import QtPanel.Native

// News-focused workspace: category navigation on the left and live category
// cards in an adaptive grid. Matrix and article-reader actions remain owned by
// NewsWidget so the same end-to-end path is used in Base and News modes.
Item {
    id: stage

    property string selectedCategory: ""
    property int newsRevision: 0
    readonly property real railWidth: Math.min(250, Math.max(210, width * 0.16))

    function categoriesForGrid() {
        newsRevision
        if (selectedCategory !== "")
            return [selectedCategory]
        return News.categories
    }

    function selectCategory(label) {
        selectedCategory = label || ""
    }

    Connections {
        target: News
        function onCategoriesChanged() {
            stage.newsRevision++
            if (stage.selectedCategory !== ""
                    && News.categories.indexOf(stage.selectedCategory) < 0)
                stage.selectedCategory = ""
        }
        function onCategoryUpdated() { stage.newsRevision++ }
    }

    FileDialog {
        id: opmlDialog
        title: "Importer OPML"
        nameFilters: ["OPML (*.opml *.xml)", "Tous les fichiers (*)"]
        onAccepted: News.importOpml(selectedFile)
    }

    Item {
        id: categoryRail
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: stage.railWidth

        Column {
            anchors.fill: parent
            spacing: 8

            Row {
                width: parent.width
                height: 28
                spacing: 5

                Text {
                    width: Math.max(40, parent.width - refreshButton.width - importButton.width - 10)
                    text: "Nouvelles"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                    anchors.verticalCenter: parent.verticalCenter
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
                    border.color: importMouse.containsMouse ? Theme.accent : Theme.cardStroke
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
                width: parent.width
                height: parent.height - y
                contentHeight: categoryColumn.height
                clip: true
                boundsBehavior: Flickable.StopAtBounds

                Column {
                    id: categoryColumn
                    width: parent.width
                    spacing: 5

                    Rectangle {
                        width: parent.width
                        height: 34
                        radius: 6
                        color: stage.selectedCategory === "" ? Theme.activeFill
                             : allMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: stage.selectedCategory === "" ? Theme.accent : "transparent"
                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            text: "Toutes les categories"
                            color: Theme.textPrimary
                            font.pixelSize: 10
                        }
                        Text {
                            anchors.right: parent.right
                            anchors.rightMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            text: News.categories.length
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
                        model: stage.newsRevision, News.categories
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
    }

    Flickable {
        id: newsScroll
        anchors.left: categoryRail.right
        anchors.leftMargin: 8
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        contentHeight: newsContent.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: newsContent
            width: newsScroll.width
            spacing: 8

            Text {
                visible: News.categories.length === 0
                width: parent.width
                height: visible ? 44 : 0
                text: "Aucune categorie configuree"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeBody
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
            }

            Grid {
                id: newsGrid
                width: parent.width
                columns: stage.selectedCategory !== ""
                       ? 1 : Math.max(1, Math.min(5, Math.floor(width / 360)))
                spacing: 8

                Repeater {
                    model: stage.newsRevision, stage.categoriesForGrid()
                    delegate: NewsWidget {
                        required property string modelData
                        categoryLabel: modelData
                        width: (newsGrid.width - Math.max(0, newsGrid.columns - 1) * newsGrid.spacing)
                               / newsGrid.columns
                    }
                }
            }
        }
    }
}
