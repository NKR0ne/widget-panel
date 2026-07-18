import QtQuick
import QtPanel.Native

// One card per OPML category (cat:* widget ids). Items come from NewsService;
// article activation either opens Reader directly or delegates to the owning
// stage so the dedicated News workspace can keep reading in place.
GlassCard {
    id: card

    property string categoryLabel: ""
    property bool delegateArticleOpening: false
    property bool forceCarouselPresentation: false
    signal articleRequested(var item)

    title: categoryLabel
    implicitHeight: body.implicitHeight + 24

    property var items: News.itemsFor(categoryLabel)
    property int storeRev: 0
    property int carouselIndex: 0
    property real carouselHeight: clampCarouselHeight(Number(Store.get(newsHeightKey(), 210)) || 210)
    property int flipDirection: 1
    readonly property int carouselCount: items.length
    readonly property var activeItem: carouselCount > 0
        ? items[Math.max(0, Math.min(carouselIndex, carouselCount - 1))]
        : ({})

    function openMatrix() {
        Store.set("wp-news-matrix-request", JSON.stringify({
            label: categoryLabel,
            at: Date.now()
        }))
    }

    function newsHeightKey() {
        return "wp-news-card-height:" + categoryLabel
    }

    function clampCarouselHeight(value) {
        const n = Number(value)
        if (!isFinite(n))
            return 210
        return Math.max(150, Math.min(420, n))
    }

    function openItem(item) {
        if (!item || !item.link)
            return
        if (delegateArticleOpening) {
            articleRequested(item)
            return
        }
        Reader.open(item.link, item.title || "", item.source || "",
                    item.image || "", item.description || "")
    }

    function setCarouselItem(index) {
        if (carouselCount < 1)
            return
        flipDirection = index >= carouselIndex ? 1 : -1
        carouselIndex = (index + carouselCount) % carouselCount
        carouselFlip.restart()
    }

    function rotateCarousel(delta) {
        if (carouselCount < 2)
            return
        flipDirection = delta >= 0 ? 1 : -1
        carouselIndex = (carouselIndex + delta + carouselCount) % carouselCount
        carouselFlip.restart()
    }

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
            if (key === card.newsHeightKey())
                card.carouselHeight = card.clampCarouselHeight(Number(Store.get(key, 210)) || 210)
        }
    }

    // Carousel (wp-news-carousel): Electron-style one-story feature card.
    readonly property bool carouselEnabled: {
        storeRev
        const stored = Store.get("wp-news-carousel", "")
        return stored === "" || stored === true || stored === "1" || stored === "true"
    }
    readonly property bool carouselPresentation: forceCarouselPresentation || carouselEnabled
    onItemsChanged: carouselIndex = Math.min(carouselIndex, Math.max(0, carouselCount - 1))

    Timer {
        running: card.carouselPresentation && card.carouselEnabled && card.carouselCount > 1
        repeat: true
        interval: {
            card.storeRev
            return Math.max(20000, Number(Store.get("wp-news-carousel-ms", 20000)) || 20000)
        }
        onTriggered: card.rotateCarousel(1)
    }
    SequentialAnimation {
        id: carouselFlip
        NumberAnimation {
            target: carouselFace; property: "opacity"; to: 0.36
            duration: Motion.fastMs
        }
        ParallelAnimation {
            NumberAnimation {
                target: carouselFace; property: "opacity"; to: 1
                duration: Motion.normalMs
                easing.type: Easing.BezierSpline
                easing.bezierCurve: Motion.emphasized
            }
            NumberAnimation {
                target: carouselTilt; property: "angle"; from: card.flipDirection >= 0 ? 6 : -6; to: 0
                duration: Motion.normalMs
                easing.type: Easing.OutCubic
            }
        }
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        Row {
            width: parent.width
            height: Math.max(categoryTitle.implicitHeight, matrixButton.height)
            spacing: 6

            Text {
                id: categoryTitle
                width: Math.max(40, parent.width - matrixButton.width - 6)
                anchors.verticalCenter: parent.verticalCenter
                text: card.categoryLabel
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                elide: Text.ElideRight
            }

            Rectangle {
                id: matrixButton
                width: matrixLabel.implicitWidth + 12
                height: 20
                radius: 5
                opacity: card.items.length > 0 ? 1 : 0.42
                anchors.verticalCenter: parent.verticalCenter
                color: matrixMouse.containsMouse ? Theme.activeFill : Qt.rgba(1, 1, 1, 0.04)
                border.color: matrixMouse.containsMouse ? Theme.accent : Theme.cardStroke
                Text {
                    id: matrixLabel
                    anchors.centerIn: parent
                    text: "Matrix"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: matrixMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: card.items.length > 0 ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: if (card.items.length > 0) card.openMatrix()
                }
            }
        }

        Text {
            visible: card.items.length === 0
            text: "Chargement des flux…"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }

        Rectangle {
            id: carouselCard
            visible: card.carouselPresentation && card.carouselCount > 0
            width: parent.width
            height: card.carouselHeight
            radius: 8
            color: Qt.rgba(1, 1, 1, 0.045)
            border.color: Theme.cardStroke
            clip: true

            HoverHandler { id: carouselHover }

            transform: Rotation {
                id: carouselTilt
                origin.x: carouselCard.width / 2
                origin.y: carouselCard.height / 2
                axis { x: 0; y: 1; z: 0 }
                angle: 0
            }

            Item {
                id: carouselFace
                anchors.fill: parent

                Image {
                    anchors.fill: parent
                    source: card.activeItem.image || ""
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    visible: (card.activeItem.image || "") !== ""
                    opacity: 0.72
                }

                Rectangle {
                    anchors.fill: parent
                    color: (card.activeItem.image || "") !== ""
                        ? Qt.rgba(0, 0, 0, 0.34)
                        : Qt.rgba(0.06, 0.10, 0.17, 1)
                }

                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: Qt.rgba(0.02, 0.04, 0.08, 0.14) }
                        GradientStop { position: 0.62; color: Qt.rgba(0.02, 0.04, 0.08, 0.76) }
                        GradientStop { position: 1.0; color: Qt.rgba(0.02, 0.04, 0.08, 0.94) }
                    }
                }

                Column {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.margins: 14
                    anchors.leftMargin: 42
                    anchors.rightMargin: 42
                    spacing: 8

                    Row {
                        width: parent.width
                        spacing: 8
                        Text {
                            width: Math.max(40, parent.width - timeText.width - 8)
                            text: card.activeItem.source || ""
                            color: "#dcdcec"
                            font.pixelSize: 10
                            elide: Text.ElideRight
                        }
                        Text {
                            id: timeText
                            text: card.activeItem.time || ""
                            color: "#dcdcec"
                            font.pixelSize: 10
                        }
                    }

                    Text {
                        width: parent.width
                        text: card.activeItem.title || ""
                        color: "#ffffff"
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                        wrapMode: Text.WordWrap
                        maximumLineCount: 3
                        elide: Text.ElideRight
                        lineHeight: 1.16
                    }

                    Text {
                        visible: (card.activeItem.description || "") !== ""
                        width: parent.width
                        text: card.activeItem.description || ""
                        color: Qt.rgba(0.96, 0.98, 1.0, 0.82)
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }

                    Row {
                        width: parent.width
                        spacing: 5
                        Repeater {
                            model: card.carouselCount
                            delegate: Rectangle {
                                required property int index
                                width: index === card.carouselIndex ? 15 : 5
                                height: 5
                                radius: 3
                                color: index === card.carouselIndex ? Theme.accent : Qt.rgba(1, 1, 1, 0.36)
                                Behavior on width { NumberAnimation { duration: Motion.fastMs } }
                                MouseArea {
                                    anchors.fill: parent
                                    anchors.margins: -5
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: card.setCarouselItem(index)
                                }
                            }
                        }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: card.openItem(card.activeItem)
            }

            Rectangle {
                visible: card.carouselCount > 1 && (carouselHover.hovered || prevMouse.containsMouse)
                x: 8
                anchors.verticalCenter: parent.verticalCenter
                width: 32
                height: 52
                radius: 8
                color: prevMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.24)
                                               : Qt.rgba(0, 0, 0, 0.28)
                Text {
                    anchors.centerIn: parent
                    text: "<"
                    color: Theme.textPrimary
                    font.pixelSize: 24
                    font.weight: Font.Light
                }
                MouseArea {
                    id: prevMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.rotateCarousel(-1)
                }
            }

            Rectangle {
                visible: card.carouselCount > 1 && (carouselHover.hovered || nextMouse.containsMouse)
                anchors.right: parent.right
                anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                width: 32
                height: 52
                radius: 8
                color: nextMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.24)
                                               : Qt.rgba(0, 0, 0, 0.28)
                Text {
                    anchors.centerIn: parent
                    text: ">"
                    color: Theme.textPrimary
                    font.pixelSize: 24
                    font.weight: Font.Light
                }
                MouseArea {
                    id: nextMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.rotateCarousel(1)
                }
            }

            Rectangle {
                visible: carouselHover.hovered || resizeArea.pressed
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 10
                color: "transparent"
                Rectangle {
                    width: 46
                    height: 3
                    radius: 2
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.verticalCenter: parent.verticalCenter
                    color: resizeArea.pressed ? Theme.accent : Qt.rgba(1, 1, 1, 0.32)
                }
                MouseArea {
                    id: resizeArea
                    anchors.fill: parent
                    cursorShape: Qt.SizeVerCursor
                    property real startY: 0
                    property real startH: 0
                    onPressed: function(mouse) {
                        startY = mouse.y
                        startH = card.carouselHeight
                    }
                    onPositionChanged: function(mouse) {
                        if (!pressed)
                            return
                        card.carouselHeight = card.clampCarouselHeight(startH + mouse.y - startY)
                    }
                    onReleased: Store.set(card.newsHeightKey(), Math.round(card.carouselHeight))
                }
            }
        }

        Repeater {
            model: card.carouselPresentation ? [] : card.items

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
                    onClicked: card.openItem(row.modelData)
                }
            }
        }
    }
}
