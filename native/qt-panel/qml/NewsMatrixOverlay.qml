import QtQuick
import QtQuick.Controls
import QtPanel.Native

// Full-category article matrix. Every story remains visible in a virtualized
// card grid while the selected article opens in an adjacent native reader.
Item {
    id: overlay

    property bool open: false
    property Item backdropSource: null
    property string categoryLabel: ""
    property var items: []
    property var feedLabels: []
    property bool readerOpen: false
    property string selectedUrl: ""

    function compactText(value, fallback) {
        return String(value || fallback || "").replace(/\s+/g, " ").trim()
    }

    function hostFromUrl(url) {
        const match = String(url || "").match(/^https?:\/\/([^\/?#]+)/i)
        return match ? match[1].replace(/^www\./, "") : ""
    }

    function feedDisplay(entry) {
        const label = compactText(entry && entry.label, "")
        if (/^https?:\/\//i.test(label))
            return hostFromUrl(label)
        return label || hostFromUrl(entry && entry.url)
    }

    function sourceStats() {
        const counts = {}
        const labels = []
        for (const item of items) {
            const source = compactText(item.source, hostFromUrl(item.link))
            if (!source)
                continue
            if (counts[source] === undefined) {
                counts[source] = 0
                labels.push(source)
            }
            counts[source] += 1
        }
        labels.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
        const result = []
        for (let i = 0; i < labels.length; i++)
            result.push({ label: labels[i], count: counts[labels[i]] })
        return result
    }

    function articlesFor(label) {
        const result = []
        for (const item of News.itemsFor(label)) {
            if (String(item.title || "").trim() !== "")
                result.push(item)
        }
        return result
    }

    function show(label) {
        categoryLabel = label || "Nouvelles"
        items = articlesFor(categoryLabel)
        feedLabels = News.feedLabelsFor(categoryLabel)
        selectedUrl = ""
        readerOpen = false
        Reader.close()
        open = true
        Panel.setModalOpen(true)
        Qt.callLater(function() { matrixGrid.forceActiveFocus() })
    }

    function closeReader() {
        readerOpen = false
        selectedUrl = ""
        Reader.close()
    }

    function dismiss() {
        closeReader()
        open = false
        Panel.setModalOpen(false)
    }

    function openArticle(item) {
        if (!item || !item.link)
            return
        selectedUrl = String(item.link)
        readerOpen = true
        Reader.open(item.link, item.title || "", item.source || "",
                    item.image || "", item.description || "")
    }

    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0
    focus: open
    Keys.onEscapePressed: readerOpen ? closeReader() : dismiss()

    Behavior on opacity {
        NumberAnimation {
            duration: Motion.normalMs
            easing.type: Easing.BezierSpline
            easing.bezierCurve: Motion.emphasized
        }
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key !== "wp-news-matrix-request")
                return
            let request = {}
            try { request = JSON.parse(Store.get(key, "{}")) } catch (e) {}
            if (request.label)
                overlay.show(request.label)
        }
    }

    Connections {
        target: News
        function onCategoryUpdated(label) {
            if (overlay.open && label === overlay.categoryLabel) {
                overlay.items = overlay.articlesFor(label)
                overlay.feedLabels = News.feedLabelsFor(label)
            }
        }
    }

    ScrimBackdrop {
        anchors.fill: parent
        source: overlay.backdropSource
        active: overlay.open
        dim: 0.5

        MouseArea {
            anchors.fill: parent
            enabled: overlay.open
            onClicked: overlay.dismiss()
        }
    }

    Rectangle {
        id: matrixSurface
        anchors.fill: parent
        anchors.margins: 12
        radius: Theme.radiusPanel
        color: Theme.compositionMaterial
               ? Qt.rgba(0.025, 0.035, 0.06, 0.94)
               : Qt.rgba(0.035, 0.045, 0.075, 0.97)
        border.color: Theme.keyline
        scale: overlay.open ? 1 : 0.975
        clip: true

        Behavior on scale {
            NumberAnimation {
                duration: Motion.deliberateMs
                easing.type: Easing.BezierSpline
                easing.bezierCurve: Motion.emphasized
            }
        }

        MouseArea { anchors.fill: parent }

        Rectangle {
            id: matrixHeader
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: 70
            color: Qt.rgba(1, 1, 1, 0.025)

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 1
                color: Theme.cardStroke
            }

            Rectangle {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: 3
                color: Theme.accent
                opacity: 0.88
            }

            Column {
                anchors.left: parent.left
                anchors.leftMargin: 20
                anchors.right: readerState.left
                anchors.rightMargin: 16
                anchors.verticalCenter: parent.verticalCenter
                spacing: 3

                Row {
                    width: parent.width
                    spacing: 10

                    Text {
                        text: "MATRIX"
                        color: Theme.accent
                        font.pixelSize: 9
                        font.weight: Font.DemiBold
                        font.letterSpacing: 1.4
                    }

                    Rectangle {
                        width: 4
                        height: 4
                        radius: 2
                        anchors.verticalCenter: parent.verticalCenter
                        color: Theme.textSecondary
                        opacity: 0.55
                    }

                    Text {
                        text: overlay.items.length + " ARTICLES"
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        font.weight: Font.Medium
                        font.letterSpacing: 0.8
                    }
                }

                Text {
                    width: parent.width
                    text: overlay.categoryLabel || "Nouvelles"
                    color: Theme.textPrimary
                    font.pixelSize: 20
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                }
            }

            Rectangle {
                id: readerState
                anchors.right: closeButton.left
                anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                width: readerStateText.implicitWidth + 20
                height: 28
                radius: 7
                visible: overlay.readerOpen
                color: Theme.activeFill
                border.color: Qt.rgba(Theme.accent.r, Theme.accent.g,
                                      Theme.accent.b, 0.44)

                Text {
                    id: readerStateText
                    anchors.centerIn: parent
                    text: "LECTURE ACTIVE"
                    color: Theme.textPrimary
                    font.pixelSize: 9
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0.8
                }
            }

            IconButton {
                id: closeButton
                anchors.right: parent.right
                anchors.rightMargin: 16
                anchors.verticalCenter: parent.verticalCenter
                glyph: "\uE711"
                tooltip: "Fermer la matrice"
                onClicked: overlay.dismiss()
            }
        }

        Item {
            id: matrixBody
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: matrixHeader.bottom
            anchors.bottom: parent.bottom
            anchors.margins: 12

            Item {
                id: gridPane
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: overlay.readerOpen
                       ? Math.max(420, parent.width * 0.58)
                       : parent.width

                Behavior on width {
                    NumberAnimation {
                        duration: Motion.deliberateMs
                        easing.type: Easing.BezierSpline
                        easing.bezierCurve: Motion.emphasized
                    }
                }

                ListView {
                    id: sourceRail
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    height: 30
                    orientation: ListView.Horizontal
                    spacing: 7
                    clip: true
                    boundsBehavior: Flickable.StopAtBounds
                    model: overlay.feedLabels.length
                           ? overlay.feedLabels : overlay.sourceStats()

                    delegate: Rectangle {
                        required property var modelData
                        width: Math.min(220, sourceLabel.implicitWidth + 18)
                        height: 24
                        radius: 7
                        color: Qt.rgba(1, 1, 1, 0.045)
                        border.color: Theme.cardStroke

                        Text {
                            id: sourceLabel
                            anchors.centerIn: parent
                            width: Math.min(202, implicitWidth)
                            text: modelData.count !== undefined
                                  ? overlay.feedDisplay(modelData) + "  " + modelData.count
                                  : overlay.feedDisplay(modelData)
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            font.weight: Font.Medium
                            elide: Text.ElideRight
                        }
                    }
                }

                GridView {
                    id: matrixGrid
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: sourceRail.bottom
                    anchors.bottom: parent.bottom
                    anchors.topMargin: 8
                    clip: true
                    boundsBehavior: Flickable.StopAtBounds
                    reuseItems: true
                    keyNavigationEnabled: true
                    model: overlay.items

                    readonly property int columnCount: Math.max(1, Math.min(
                        overlay.readerOpen ? 3 : 5,
                        Math.floor(width / (overlay.readerOpen ? 250 : 320))))
                    cellWidth: Math.floor(width / columnCount)
                    cellHeight: Math.max(226, Math.min(286, height * 0.34))

                    ScrollBar.vertical: ScrollBar {
                        policy: ScrollBar.AsNeeded
                        width: 7
                    }

                    delegate: Item {
                        id: tile
                        required property var modelData
                        required property int index

                        width: matrixGrid.cellWidth
                        height: matrixGrid.cellHeight
                        property bool entered: !Motion.enabled

                        Rectangle {
                            id: articleCard
                            anchors.fill: parent
                            anchors.margins: 5
                            radius: 8
                            color: Qt.rgba(1, 1, 1,
                                           cardMouse.containsMouse ? 0.09 : 0.045)
                            border.width: overlay.selectedUrl === String(tile.modelData.link || "")
                                          ? 2 : 1
                            border.color: overlay.selectedUrl === String(tile.modelData.link || "")
                                          ? Theme.accent
                                          : cardMouse.containsMouse
                                            ? Theme.keyline : Theme.cardStroke
                            clip: true
                            scale: cardMouse.pressed ? 0.985
                                   : cardMouse.containsMouse ? 1.012 : 1
                            opacity: tile.entered ? 1 : 0

                            Behavior on scale {
                                NumberAnimation {
                                    duration: Motion.fastMs
                                    easing.type: Easing.OutCubic
                                }
                            }
                            Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                            Behavior on border.color {
                                ColorAnimation { duration: Motion.fastMs }
                            }

                            NewsArticleVisual {
                                anchors.fill: parent
                                article: tile.modelData
                                textScale: 1.0
                                titleLines: 3
                                descriptionLines: 2
                                imageOpacity: 0.68
                                bottomInset: 16
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.top: parent.top
                                anchors.margins: 10
                                width: articleNumber.implicitWidth + 12
                                height: 22
                                radius: 6
                                color: Qt.rgba(0.02, 0.03, 0.055, 0.76)
                                border.color: Qt.rgba(1, 1, 1, 0.12)

                                Text {
                                    id: articleNumber
                                    anchors.centerIn: parent
                                    text: String(tile.index + 1).padStart(2, "0")
                                    color: Theme.textPrimary
                                    font.pixelSize: 9
                                    font.weight: Font.DemiBold
                                }
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.top: parent.top
                                height: 2
                                color: Theme.accent
                                opacity: cardMouse.containsMouse ? 0.9 : 0
                                Behavior on opacity {
                                    NumberAnimation { duration: Motion.fastMs }
                                }
                            }

                            MouseArea {
                                id: cardMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: tile.modelData.link
                                             ? Qt.PointingHandCursor : Qt.ArrowCursor
                                onClicked: overlay.openArticle(tile.modelData)
                            }
                        }

                        SequentialAnimation {
                            running: overlay.open && !tile.entered
                            PauseAnimation {
                                duration: Motion.enabled ? Math.min(tile.index * 18, 180) : 0
                            }
                            ParallelAnimation {
                                NumberAnimation {
                                    target: articleCard
                                    property: "opacity"
                                    from: 0
                                    to: 1
                                    duration: Motion.normalMs
                                    easing.type: Easing.OutCubic
                                }
                                NumberAnimation {
                                    target: articleCard
                                    property: "scale"
                                    from: 0.96
                                    to: 1
                                    duration: Motion.normalMs
                                    easing.type: Easing.OutCubic
                                }
                            }
                            ScriptAction { script: tile.entered = true }
                        }
                    }

                    Text {
                        anchors.centerIn: parent
                        visible: overlay.items.length === 0
                        text: "Les articles de cette categorie sont en cours de chargement."
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeBody
                    }
                }

                Rectangle {
                    anchors.left: matrixGrid.left
                    anchors.right: matrixGrid.right
                    anchors.bottom: matrixGrid.bottom
                    height: 34
                    visible: matrixGrid.contentHeight > matrixGrid.height
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: "transparent" }
                        GradientStop { position: 1.0; color: matrixSurface.color }
                    }
                }
            }

            Rectangle {
                anchors.left: gridPane.right
                anchors.leftMargin: 7
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: 1
                visible: overlay.readerOpen
                color: Theme.cardStroke
                opacity: overlay.readerOpen ? 1 : 0
                Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
            }

            ArticleReaderPane {
                anchors.left: gridPane.right
                anchors.leftMargin: 15
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                visible: overlay.readerOpen
                opacity: overlay.readerOpen ? 1 : 0
                active: overlay.readerOpen && overlay.selectedUrl !== ""
                onCloseRequested: overlay.closeReader()

                Behavior on opacity {
                    NumberAnimation {
                        duration: Motion.normalMs
                        easing.type: Easing.OutCubic
                    }
                }
            }
        }
    }
}
