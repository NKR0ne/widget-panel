import QtQuick
import QtPanel.Native

// Full-panel native reader: opens instantly with seed data from the news
// item, fills in extracted paragraphs when the fetch lands. While open it
// holds the modal guard so blur-to-hide leaves the panel alone.
Item {
    id: overlay

    property bool presentationEnabled: true
    property bool open: false
    // Panel content to blur behind the reader; set by PanelSurface.
    property Item backdropSource: null
    property var articleImages: {
        const out = []
        const hero = Reader.article.image || ""
        if (hero)
            out.push(hero)
        const images = Reader.article.images || []
        for (const image of images) {
            if (image && out.indexOf(image) < 0)
                out.push(image)
        }
        return out
    }
    property var articleParagraphs: Reader.article.paragraphs || []
    property var articleAttempts: Reader.article.attempts || []
    property bool imageViewerOpen: false
    property int imageIndex: 0

    function show() {
        open = true
        imageViewerOpen = false
        Panel.setModalOpen(true)
    }
    function dismiss() {
        open = false
        imageViewerOpen = false
        Panel.setModalOpen(false)
        Reader.close()
    }
    function openImage(index) {
        if (articleImages.length === 0)
            return
        imageIndex = Math.max(0, Math.min(index, articleImages.length - 1))
        imageViewerOpen = true
    }
    function stepImage(delta) {
        if (articleImages.length === 0)
            return
        imageIndex = (imageIndex + delta + articleImages.length) % articleImages.length
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
        target: Reader
        function onOpened() {
            if (overlay.presentationEnabled)
                overlay.show()
        }
    }

    onPresentationEnabledChanged: {
        if (!presentationEnabled && open) {
            open = false
            imageViewerOpen = false
            Panel.setModalOpen(false)
        }
    }

    // Scrim — click outside the card closes.
    ScrimBackdrop {
        anchors.fill: parent
        source: overlay.backdropSource
        active: overlay.open
        dim: 0.55
        MouseArea {
            anchors.fill: parent
            enabled: overlay.open
            onClicked: overlay.dismiss()
        }
    }

    Rectangle {
        id: readerCard
        anchors.fill: parent
        anchors.margins: 26
        radius: Theme.radiusPanel
        color: "#11141c"
        border.color: Theme.cardStroke
        scale: overlay.open ? 1 : 0.97
        Behavior on scale {
            NumberAnimation {
                duration: Motion.normalMs
                easing.type: Easing.BezierSpline
                easing.bezierCurve: Motion.emphasized
            }
        }

        MouseArea { anchors.fill: parent } // swallow scrim clicks

        Column {
            anchors.fill: parent
            anchors.margins: 18
            spacing: 10

            Row {
                width: parent.width
                spacing: 8

                Column {
                    width: parent.width - closeBtn.width - openExt.width - openIsland.width - 24
                    spacing: 2
                    Text {
                        width: parent.width
                        text: Reader.article.title || "…"
                        color: Theme.textPrimary
                        font.pixelSize: 17
                        font.weight: Font.DemiBold
                        wrapMode: Text.WordWrap
                        maximumLineCount: 3
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: [Reader.article.sourceLabel || "", Reader.article.source || "",
                               Reader.article.byline || ""].filter(Boolean).join(" | ")
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                        elide: Text.ElideRight
                    }
                }
                IconButton {
                    id: openIsland
                    glyph: ""  // Globe: open beside the panel.
                    onClicked: {
                        const url = Reader.article.url
                        overlay.dismiss()
                        Panel.openIsland(url)
                    }
                }
                IconButton {
                    id: openExt
                    glyph: ""  // OpenInNewWindow
                    onClicked: Qt.openUrlExternally(Reader.article.url)
                }
                IconButton {
                    id: closeBtn
                    glyph: ""  // ChromeClose
                    onClicked: overlay.dismiss()
                }
            }

            Rectangle {
                width: parent.width
                height: 1
                color: Theme.cardStroke
            }

            Rectangle {
                visible: Reader.busy
                width: parent.width
                height: 2
                radius: 1
                color: Qt.rgba(1, 1, 1, 0.06)
                clip: true
                Rectangle {
                    id: readerProgress
                    width: Math.max(80, parent.width * 0.28)
                    height: parent.height
                    radius: 1
                    color: Theme.accent
                    NumberAnimation on x {
                        running: Reader.busy
                        loops: Animation.Infinite
                        from: -readerProgress.width
                        to: readerCard.width
                        duration: 1150
                        easing.type: Easing.InOutQuad
                    }
                }
            }

            Text {
                width: parent.width
                visible: !Reader.busy
                text: {
                    const parts = []
                    parts.push(Reader.article.sourceLabel || "direct")
                    parts.push(overlay.articleParagraphs.length + " paragraphs")
                    if (overlay.articleImages.length > 0)
                        parts.push(overlay.articleImages.length + " images")
                    if (Reader.article.fallbackUsed)
                        parts.push("fallback parser")
                    if (Reader.article.seedFallback)
                        parts.push("feed summary")
                    if (Reader.article.publisherFeedFallback)
                        parts.push("publisher feed")
                    if (Reader.article.paywall)
                        parts.push("paywall detected")
                    if (Reader.article.challenge)
                        parts.push("challenge detected")
                    return parts.join(" | ")
                }
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                elide: Text.ElideRight
            }

            Flickable {
                width: parent.width
                height: parent.height - y
                contentHeight: articleColumn.height + 24
                clip: true
                boundsBehavior: Flickable.StopAtBounds

                Column {
                    id: articleColumn
                    width: Math.min(parent.width, 640)
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 12

                    Rectangle {
                        width: parent.width
                        height: visible ? Math.round(width * 9 / 21) : 0
                        radius: 8
                        visible: (Reader.article.image || "") !== ""
                        color: Qt.rgba(1, 1, 1, 0.04)
                        clip: true
                        Image {
                            anchors.fill: parent
                            source: Reader.article.image || ""
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                        }
                        MouseArea {
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: overlay.openImage(0)
                        }
                    }

                    Row {
                        width: parent.width
                        spacing: 8
                        visible: overlay.articleImages.length > 1
                        Repeater {
                            model: Math.min(3, Math.max(0, overlay.articleImages.length - 1))
                            delegate: Rectangle {
                                width: Math.floor((articleColumn.width - 16) / 3)
                                height: 74
                                radius: 7
                                color: Qt.rgba(1, 1, 1, 0.04)
                                border.color: Theme.cardStroke
                                clip: true

                                Image {
                                    anchors.fill: parent
                                    source: overlay.articleImages[index + 1] || ""
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: overlay.openImage(index + 1)
                                }
                            }
                        }
                    }

                    Text {
                        visible: Reader.busy
                        text: "Extraction de l'article…"
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeBody
                        font.italic: true
                    }
                    Column {
                        width: parent.width
                        spacing: 8
                        visible: !Reader.busy
                                 && overlay.articleParagraphs.length === 0

                        Text {
                            width: parent.width
                            text: Reader.article.challenge
                                  ? "Le site bloque la lecture automatique. Essayez la version archivee ou ouvrez l'article dans le navigateur."
                                  : (Reader.article.paywall
                                     ? "Lecture bloquee par un paywall. Essayez la version archivee ou ouvrez l'article dans le navigateur."
                                     : "Extraction impossible - essayez la version archivee.")
                            color: Theme.textSecondary
                            font.pixelSize: Theme.fontSizeBody
                            wrapMode: Text.WordWrap
                        }
                        Rectangle {
                            width: archiveLabel.implicitWidth + 22
                            height: 26
                            radius: 6
                            color: archiveMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.25)
                                                              : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                            border.color: Qt.rgba(0.31, 0.56, 0.97, 0.4)

                            Text {
                                id: archiveLabel
                                anchors.centerIn: parent
                                text: "Version archivée (Wayback)"
                                color: Theme.textPrimary
                                font.pixelSize: Theme.fontSizeCaption
                            }
                            MouseArea {
                                id: archiveMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: Reader.openArchive(Reader.article.url)
                            }
                        }
                        Column {
                            width: parent.width
                            spacing: 4
                            visible: overlay.articleAttempts.length > 0

                            Text {
                                width: parent.width
                                text: "Tentatives de lecture"
                                color: Theme.textPrimary
                                font.pixelSize: Theme.fontSizeCaption
                                font.weight: Font.DemiBold
                            }
                            Repeater {
                                model: overlay.articleAttempts
                                delegate: Text {
                                    required property var modelData
                                    width: parent.width
                                    text: [
                                        modelData.source || "reader",
                                        modelData.status || "",
                                        (modelData.bytes || 0) + " bytes",
                                        (modelData.paragraphs || 0) + " paragraphs",
                                        modelData.fallback ? "fallback" : "",
                                        modelData.paywall ? "paywall" : "",
                                        modelData.error || "",
                                        modelData.challenge || ""
                                    ].filter(Boolean).join(" | ")
                                    color: Theme.textSecondary
                                    font.pixelSize: Theme.fontSizeCaption
                                    wrapMode: Text.WordWrap
                                }
                            }
                        }
                    }

                    Repeater {
                        model: overlay.articleParagraphs
                        delegate: Text {
                            required property string modelData
                            width: articleColumn.width
                            text: modelData
                            color: "#d6dae6"
                            font.pixelSize: 13
                            lineHeight: 1.45
                            wrapMode: Text.WordWrap
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        visible: overlay.imageViewerOpen
        anchors.fill: parent
        z: 20
        color: Qt.rgba(0, 0, 0, 0.86)

        MouseArea {
            anchors.fill: parent
            onClicked: overlay.imageViewerOpen = false
        }

        Image {
            anchors.fill: parent
            anchors.margins: 54
            source: overlay.articleImages[overlay.imageIndex] || ""
            fillMode: Image.PreserveAspectFit
            asynchronous: true
        }

        Rectangle {
            width: imageCountLabel.implicitWidth + 18
            height: 28
            radius: 7
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 18
            color: Qt.rgba(1, 1, 1, 0.10)
            border.color: Theme.cardStroke
            Text {
                id: imageCountLabel
                anchors.centerIn: parent
                text: (overlay.imageIndex + 1) + " / " + overlay.articleImages.length
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
            }
        }

        IconButton {
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.margins: 16
            glyph: ""
            onClicked: overlay.imageViewerOpen = false
        }

        IconButton {
            visible: overlay.articleImages.length > 1
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: 16
            glyph: ""
            onClicked: overlay.stepImage(-1)
        }

        IconButton {
            visible: overlay.articleImages.length > 1
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.rightMargin: 16
            glyph: ""
            onClicked: overlay.stepImage(1)
        }
    }
}
