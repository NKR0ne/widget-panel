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
    property real textScale: 1.0
    // Card-size multiplier from the Cartes size control. Scales the card body
    // only — text keeps its own scale (textScale) and the per-category height
    // the user dragged stays untouched in the store.
    property real sizeScale: 1.0
    signal articleRequested(var item)

    title: categoryLabel
    implicitHeight: body.implicitHeight + 24

    property var items: News.itemsFor(categoryLabel)
    property int storeRev: 0
    property int carouselIndex: 0
    property int pendingCarouselIndex: 0
    property var displayedItem: ({})
    property var incomingItem: ({})
    property real flipProgress: 0
    readonly property var presentationItems: {
        const result = []
        for (const item of items) {
            if (String(item.title || "").trim() !== "")
                result.push(item)
        }
        return result
    }
    // Stored height is the user's own per-category size; the size control
    // scales it for display without overwriting it.
    property real storedCarouselHeight: clampCarouselHeight(Number(Store.get(newsHeightKey(), 210)) || 210)
    readonly property real carouselHeight: clampCarouselHeight(
        storedCarouselHeight * Math.max(0.6, Math.min(1.8, Number(sizeScale) || 1)))
    property int flipDirection: 1
    readonly property int carouselCount: presentationItems.length
    readonly property bool flipRunning: carouselFlip.running

    function openMatrix() {
        Store.set("wp-news-matrix-request", JSON.stringify({
            label: categoryLabel,
            at: Date.now()
        }))
    }

    function px(value) {
        const boundedScale = Math.max(0.85, Math.min(1.35, Number(textScale) || 1))
        return Math.max(8, Math.round(Number(value) * boundedScale))
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

    function syncCarouselFace() {
        if (carouselCount < 1) {
            displayedItem = ({})
            incomingItem = ({})
            return
        }
        carouselIndex = Math.max(0, Math.min(carouselIndex, carouselCount - 1))
        displayedItem = presentationItems[carouselIndex]
        incomingItem = displayedItem
    }

    function startCarouselFlip(index, direction) {
        if (carouselCount < 2 || flipRunning)
            return
        const target = (index + carouselCount) % carouselCount
        if (target === carouselIndex)
            return
        pendingCarouselIndex = target
        flipDirection = direction >= 0 ? 1 : -1
        incomingItem = presentationItems[target]
        flipProgress = 0
        if (!Motion.enabled) {
            finishCarouselFlip()
            return
        }
        carouselFlip.start()
    }

    function finishCarouselFlip() {
        carouselIndex = Math.max(0, Math.min(pendingCarouselIndex,
                                             Math.max(0, carouselCount - 1)))
        displayedItem = carouselCount > 0 ? presentationItems[carouselIndex] : ({})
        incomingItem = displayedItem
        flipProgress = 0
    }

    function setCarouselItem(index) {
        const target = (index + carouselCount) % Math.max(1, carouselCount)
        startCarouselFlip(target, target >= carouselIndex ? 1 : -1)
    }

    function rotateCarousel(delta) {
        startCarouselFlip(carouselIndex + delta, delta)
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
                card.storedCarouselHeight = card.clampCarouselHeight(Number(Store.get(key, 210)) || 210)
        }
    }

    // Carousel (wp-news-carousel): native one-story feature card.
    readonly property bool carouselEnabled: {
        storeRev
        const stored = Store.get("wp-news-carousel", "")
        return stored === "" || stored === true || stored === "1" || stored === "true"
    }
    readonly property bool carouselPresentation: forceCarouselPresentation || carouselEnabled
    onPresentationItemsChanged: {
        carouselIndex = Math.min(carouselIndex, Math.max(0, carouselCount - 1))
        if (!flipRunning)
            syncCarouselFace()
    }
    onItemsChanged: Qt.callLater(function() {
        if (!flipRunning)
            syncCarouselFace()
    })
    Component.onCompleted: syncCarouselFace()

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
            target: card
            property: "flipProgress"
            from: 0
            to: 1
            duration: Motion.enabled ? 460 : 0
            easing.type: Easing.InOutCubic
        }
        ScriptAction { script: card.finishCarouselFlip() }
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
                font.pixelSize: card.px(Theme.fontSizeCaption)
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                elide: Text.ElideRight
            }

            Rectangle {
                id: matrixButton
                width: matrixLabel.implicitWidth + 12
                height: 20
                radius: 5
                opacity: card.presentationItems.length > 0 ? 1 : 0.42
                anchors.verticalCenter: parent.verticalCenter
                color: matrixMouse.containsMouse ? Theme.activeFill : Qt.rgba(1, 1, 1, 0.04)
                border.color: matrixMouse.containsMouse ? Theme.accent : Theme.cardStroke
                Text {
                    id: matrixLabel
                    anchors.centerIn: parent
                    text: "Matrix"
                    color: Theme.textSecondary
                    font.pixelSize: card.px(9)
                }
                MouseArea {
                    id: matrixMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: card.presentationItems.length > 0
                                 ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: if (card.presentationItems.length > 0) card.openMatrix()
                }
            }
        }

        Text {
            visible: card.presentationItems.length === 0
            text: "Chargement des flux…"
            color: Theme.textSecondary
            font.pixelSize: card.px(Theme.fontSizeCaption)
        }

        Rectangle {
            id: carouselCard
            visible: card.carouselPresentation && card.carouselCount > 0
            width: parent.width
            height: card.carouselHeight
            radius: 8
            color: Qt.rgba(1, 1, 1, 0.045)
            border.color: card.flipRunning
                          ? Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.62)
                          : Theme.cardStroke
            clip: true
            scale: 1 - Math.sin(card.flipProgress * Math.PI) * 0.018

            Behavior on border.color { ColorAnimation { duration: Motion.fastMs } }

            HoverHandler { id: carouselHover }

            Item {
                id: outgoingFace
                anchors.fill: parent
                visible: !card.flipRunning || card.flipProgress < 0.5
                opacity: card.flipRunning
                         ? Math.max(0.12, 1 - card.flipProgress * 1.55) : 1
                transform: Rotation {
                    origin.x: outgoingFace.width / 2
                    origin.y: outgoingFace.height / 2
                    axis { x: 0; y: 1; z: 0 }
                    angle: card.flipDirection * Math.min(1, card.flipProgress * 2) * 90
                }

                NewsArticleVisual {
                    anchors.fill: parent
                    article: card.displayedItem
                    textScale: card.textScale
                    sideInset: 42
                    bottomInset: 30
                }
            }

            Item {
                id: incomingFace
                anchors.fill: parent
                visible: card.flipRunning && card.flipProgress >= 0.5
                opacity: Math.min(1, Math.max(0.12, (card.flipProgress - 0.35) * 1.55))
                transform: Rotation {
                    origin.x: incomingFace.width / 2
                    origin.y: incomingFace.height / 2
                    axis { x: 0; y: 1; z: 0 }
                    angle: -card.flipDirection
                           * Math.max(0, 1 - (card.flipProgress - 0.5) * 2) * 90
                }

                NewsArticleVisual {
                    anchors.fill: parent
                    article: card.incomingItem
                    textScale: card.textScale
                    sideInset: 42
                    bottomInset: 30
                }
            }

            Rectangle {
                anchors.fill: parent
                radius: parent.radius
                color: "transparent"
                border.width: 2
                border.color: Theme.accent
                opacity: card.flipRunning
                         ? Math.sin(card.flipProgress * Math.PI) * 0.42 : 0
            }

            Row {
                z: 3
                anchors.left: parent.left
                anchors.leftMargin: 42
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 14
                spacing: 5
                Repeater {
                    model: card.carouselCount
                    delegate: Rectangle {
                        required property int index
                        width: index === (card.flipRunning
                                          ? card.pendingCarouselIndex
                                          : card.carouselIndex) ? 15 : 5
                        height: 5
                        radius: 3
                        color: index === (card.flipRunning
                                          ? card.pendingCarouselIndex
                                          : card.carouselIndex)
                               ? Theme.accent : Qt.rgba(1, 1, 1, 0.36)
                        Behavior on width { NumberAnimation { duration: Motion.fastMs } }
                        MouseArea {
                            anchors.fill: parent
                            anchors.margins: -5
                            enabled: !card.flipRunning
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: card.setCarouselItem(index)
                        }
                    }
                }
            }

            MouseArea {
                z: 1
                anchors.fill: parent
                enabled: !card.flipRunning
                cursorShape: Qt.PointingHandCursor
                onClicked: card.openItem(card.displayedItem)
            }

            Rectangle {
                z: 4
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
                    text: "\uE72B"
                    font.family: "Segoe Fluent Icons"
                    color: Theme.textPrimary
                    font.pixelSize: card.px(16)
                }
                MouseArea {
                    id: prevMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: !card.flipRunning
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.rotateCarousel(-1)
                }
            }

            Rectangle {
                z: 4
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
                    text: "\uE72A"
                    font.family: "Segoe Fluent Icons"
                    color: Theme.textPrimary
                    font.pixelSize: card.px(16)
                }
                MouseArea {
                    id: nextMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: !card.flipRunning
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.rotateCarousel(1)
                }
            }

            Rectangle {
                z: 5
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
                        startH = card.storedCarouselHeight
                    }
                    onPositionChanged: function(mouse) {
                        if (!pressed)
                            return
                        // Drag deltas are in displayed pixels; divide by the
                        // size scale so the stored height stays scale-neutral.
                        const scale = Math.max(0.6, Math.min(1.8, Number(card.sizeScale) || 1))
                        card.storedCarouselHeight = card.clampCarouselHeight(
                            startH + (mouse.y - startY) / scale)
                    }
                    onReleased: Store.set(card.newsHeightKey(), Math.round(card.storedCarouselHeight))
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
                        font.pixelSize: card.px(Theme.fontSizeCaption)
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
                        font.pixelSize: card.px(9)
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
