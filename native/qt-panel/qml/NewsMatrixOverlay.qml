import QtQuick
import QtPanel.Native

// Native version of the Electron "theme matrix" stage: a modal scanner for
// all stories in one news category, with direct handoff into ReaderOverlay.
Item {
    id: overlay

    property bool open: false
    // Panel content to blur behind the matrix; set by PanelSurface.
    property Item backdropSource: null
    property string categoryLabel: ""
    property var items: []
    property var feedLabels: []

    function compactText(value, fallback) {
        return String(value || fallback || "").replace(/\s+/g, " ").trim()
    }

    function hostFromUrl(url) {
        const match = String(url || "").match(/^https?:\/\/([^\/?#]+)/i)
        if (!match)
            return ""
        return match[1].replace(/^www\./, "")
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
        const out = []
        for (let i = 0; i < labels.length && i < 6; i++)
            out.push({ label: labels[i], count: counts[labels[i]] })
        return out
    }

    function show(label) {
        categoryLabel = label || "News"
        items = News.itemsFor(categoryLabel)
        feedLabels = News.feedLabelsFor(categoryLabel)
        open = true
        Panel.setModalOpen(true)
    }

    function dismiss() {
        open = false
        Panel.setModalOpen(false)
    }

    function openArticle(item) {
        if (!item || !item.link)
            return
        dismiss()
        Reader.open(item.link, item.title || "", item.source || "",
                    item.image || "", item.description || "")
    }

    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0

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
                overlay.items = News.itemsFor(label)
                overlay.feedLabels = News.feedLabelsFor(label)
            }
        }
    }

    ScrimBackdrop {
        anchors.fill: parent
        source: overlay.backdropSource
        active: overlay.open
        dim: 0.62
        MouseArea {
            anchors.fill: parent
            enabled: overlay.open
            onClicked: overlay.dismiss()
        }
    }

    Rectangle {
        id: matrixCard
        anchors.fill: parent
        anchors.margins: 26
        radius: Theme.radiusPanel
        color: "#10141d"
        border.color: Theme.cardStroke
        scale: overlay.open ? 1 : 0.97
        clip: true

        Behavior on scale {
            NumberAnimation {
                duration: Motion.normalMs
                easing.type: Easing.BezierSpline
                easing.bezierCurve: Motion.emphasized
            }
        }

        MouseArea { anchors.fill: parent }

        Column {
            anchors.fill: parent
            anchors.margins: 18
            spacing: 12

            Row {
                width: parent.width
                spacing: 10

                Rectangle {
                    width: 8
                    height: 8
                    radius: 4
                    color: Theme.accent
                    anchors.verticalCenter: parent.verticalCenter
                }

                Column {
                    width: parent.width - closeBtn.width - 28
                    spacing: 2
                    Text {
                        width: parent.width
                        text: overlay.categoryLabel || "News"
                        color: Theme.textPrimary
                        font.pixelSize: 19
                        font.weight: Font.DemiBold
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: overlay.items.length + " stories / " + overlay.feedLabels.length + " feeds"
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                        elide: Text.ElideRight
                    }
                }

                Rectangle {
                    id: closeBtn
                    width: 28
                    height: 28
                    radius: 6
                    color: closeMouse.containsMouse ? Theme.hover : "transparent"
                    Text {
                        anchors.centerIn: parent
                        text: "X"
                        color: Theme.textSecondary
                        font.pixelSize: 12
                        font.weight: Font.DemiBold
                    }
                    MouseArea {
                        id: closeMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: overlay.dismiss()
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 1
                color: Theme.cardStroke
            }

            Flickable {
                width: parent.width
                height: parent.height - y
                contentHeight: content.height + 16
                clip: true
                boundsBehavior: Flickable.StopAtBounds

                Column {
                    id: content
                    width: parent.width
                    spacing: 12

                    Flow {
                        width: parent.width
                        spacing: 8
                        Repeater {
                            model: overlay.feedLabels.length ? overlay.feedLabels : overlay.sourceStats()
                            delegate: Rectangle {
                                required property var modelData
                                width: Math.min(176, statLabel.implicitWidth + 18)
                                height: 24
                                radius: 7
                                color: Qt.rgba(1, 1, 1, 0.045)
                                border.color: Theme.cardStroke
                                Text {
                                    id: statLabel
                                    anchors.centerIn: parent
                                    text: modelData.count !== undefined
                                          ? modelData.label + " x" + modelData.count
                                          : modelData.label
                                    color: Theme.textSecondary
                                    font.pixelSize: 9
                                    elide: Text.ElideRight
                                }
                            }
                        }
                    }

                    Grid {
                        id: storyGrid
                        width: parent.width
                        columns: Math.max(1, Math.floor(width / 220))
                        spacing: 10

                        Repeater {
                            model: overlay.items
                            delegate: Rectangle {
                                id: tile
                                required property var modelData

                                width: Math.floor((storyGrid.width
                                                   - Math.max(0, storyGrid.columns - 1) * storyGrid.spacing)
                                                  / storyGrid.columns)
                                height: 214
                                radius: 8
                                color: tileMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.16)
                                                               : Qt.rgba(1, 1, 1, 0.045)
                                border.color: tileMouse.containsMouse ? Theme.accent : Theme.cardStroke
                                clip: true

                                Image {
                                    anchors.fill: parent
                                    source: tile.modelData.image || ""
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                    visible: (tile.modelData.image || "") !== ""
                                    opacity: 0.62
                                }

                                Rectangle {
                                    anchors.fill: parent
                                    visible: (tile.modelData.image || "") === ""
                                    color: Qt.rgba(0.08, 0.12, 0.18, 1)
                                }

                                Rectangle {
                                    anchors.fill: parent
                                    color: Qt.rgba(0, 0, 0, tile.modelData.image ? 0.42 : 0.0)
                                }

                                Column {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.bottom: parent.bottom
                                    anchors.margins: 12
                                    spacing: 8

                                    Row {
                                        width: parent.width
                                        spacing: 8
                                        Text {
                                            width: Math.max(40, parent.width - timeText.width - 8)
                                            text: overlay.compactText(tile.modelData.source,
                                                                      overlay.hostFromUrl(tile.modelData.link))
                                            color: Theme.textSecondary
                                            font.pixelSize: 9
                                            elide: Text.ElideRight
                                        }
                                        Text {
                                            id: timeText
                                            text: tile.modelData.time || ""
                                            color: Theme.textSecondary
                                            font.pixelSize: 9
                                        }
                                    }

                                    Text {
                                        width: parent.width
                                        text: tile.modelData.title || "Untitled story"
                                        color: Theme.textPrimary
                                        font.pixelSize: 15
                                        font.weight: Font.DemiBold
                                        wrapMode: Text.WordWrap
                                        maximumLineCount: 3
                                        elide: Text.ElideRight
                                        lineHeight: 1.1
                                    }

                                    Text {
                                        width: parent.width
                                        text: tile.modelData.description || "Open the story for the reader view."
                                        color: Theme.textSecondary
                                        font.pixelSize: 10
                                        wrapMode: Text.WordWrap
                                        maximumLineCount: 3
                                        elide: Text.ElideRight
                                    }
                                }

                                MouseArea {
                                    id: tileMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: tile.modelData.link ? Qt.PointingHandCursor : Qt.ArrowCursor
                                    onClicked: overlay.openArticle(tile.modelData)
                                }
                            }
                        }
                    }

                    Text {
                        visible: overlay.items.length === 0
                        width: parent.width
                        text: "Stories for this theme are still loading."
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeBody
                        horizontalAlignment: Text.AlignHCenter
                    }
                }
            }
        }
    }
}
