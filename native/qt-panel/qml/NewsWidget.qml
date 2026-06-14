import QtQuick
import QtPanel.Native

// One card per OPML category (cat:* widget ids). Items come from NewsService;
// clicking opens the article in the default browser (native reader card comes
// in the next increment).
GlassCard {
    id: card

    property string categoryLabel: ""

    title: categoryLabel
    implicitHeight: body.implicitHeight + 24

    property var items: News.itemsFor(categoryLabel)
    property int storeRev: 0

    Connections {
        target: News
        function onCategoryUpdated(label) {
            if (label === card.categoryLabel)
                card.items = News.itemsFor(label)
        }
    }
    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-news-carousel" || key === "wp-news-carousel-ms")
                card.storeRev++
        }
    }

    // Carousel (wp-news-carousel): rotate pages of 3 items on an interval.
    readonly property bool carouselEnabled: {
        storeRev
        const stored = Store.get("wp-news-carousel", "")
        return stored === true || stored === "1" || stored === "true"
    }
    property int carouselPage: 0
    readonly property int pageSize: 3
    readonly property int pageCount: carouselEnabled
        ? Math.max(1, Math.ceil(items.length / pageSize)) : 1
    readonly property var visibleItems: carouselEnabled
        ? items.slice(carouselPage * pageSize, carouselPage * pageSize + pageSize)
        : items
    onItemsChanged: carouselPage = 0

    Timer {
        running: card.carouselEnabled && card.pageCount > 1
        repeat: true
        interval: {
            card.storeRev
            return Math.max(2500, Number(Store.get("wp-news-carousel-ms", 8000)) || 8000)
        }
        onTriggered: pageFlip.restart()
    }
    SequentialAnimation {
        id: pageFlip
        NumberAnimation {
            target: body; property: "opacity"; to: 0
            duration: Motion.fastMs * 2
        }
        ScriptAction {
            script: card.carouselPage = (card.carouselPage + 1) % card.pageCount
        }
        NumberAnimation {
            target: body; property: "opacity"; to: 1
            duration: Motion.normalMs
            easing.type: Easing.BezierSpline
            easing.bezierCurve: Motion.emphasized
        }
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        Text {
            text: card.categoryLabel
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
            elide: Text.ElideRight
            width: parent.width
        }

        Text {
            visible: card.items.length === 0
            text: "Chargement des flux…"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }

        Repeater {
            model: card.visibleItems

            delegate: Item {
                id: row

                required property var modelData

                width: body.width
                height: Math.max(content.implicitHeight, thumb.visible ? 44 : 0) + 4

                Rectangle {
                    anchors.fill: parent
                    anchors.margins: -4
                    radius: 6
                    color: rowMouse.containsMouse ? Theme.hover : "transparent"
                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                }

                Rectangle {
                    id: thumb
                    width: 44
                    height: 44
                    radius: 6
                    visible: row.modelData.image !== ""
                    color: Qt.rgba(1, 1, 1, 0.04)
                    clip: true

                    Image {
                        anchors.fill: parent
                        source: row.modelData.image
                        fillMode: Image.PreserveAspectCrop
                        asynchronous: true
                        opacity: status === Image.Ready ? 1 : 0
                        Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }
                    }
                }

                Column {
                    id: content
                    anchors.left: thumb.visible ? thumb.right : parent.left
                    anchors.leftMargin: thumb.visible ? 8 : 0
                    anchors.right: parent.right
                    spacing: 2

                    Text {
                        width: parent.width
                        text: row.modelData.title
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeCaption
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        lineHeight: 1.15
                    }
                    Text {
                        width: parent.width
                        text: row.modelData.source
                              + (row.modelData.time ? " · " + row.modelData.time : "")
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                }

                MouseArea {
                    id: rowMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Reader.open(row.modelData.link, row.modelData.title,
                                           row.modelData.source, row.modelData.image)
                }
            }
        }
    }
}
