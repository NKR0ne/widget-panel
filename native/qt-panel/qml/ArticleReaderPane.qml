import QtQuick
import QtPanel.Native

GlassCard {
    id: pane

    signal closeRequested()
    // A transitioning host can retain the article until its exit completes.
    property bool closeOnRequest: true

    property bool active: false
    property int storeRevision: 0
    readonly property real textScale: {
        storeRevision
        return Math.max(0.85, Math.min(1.6,
            Number(Store.get("wp-news-reader-scale", 1.0)) || 1.0))
    }
    readonly property var paragraphs: Reader.article.paragraphs || []
    readonly property string articleUrl: Reader.article.url || ""
    onArticleUrlChanged: articleScroll.contentY = 0
    readonly property var images: {
        const result = []
        const hero = Reader.article.image || ""
        if (hero)
            result.push(hero)
        for (const image of Reader.article.images || []) {
            if (image && result.indexOf(image) < 0)
                result.push(image)
        }
        return result
    }

    interactive: false
    color: Qt.rgba(0.035, 0.045, 0.07, 0.78)

    function px(value) {
        return Math.max(8, Math.round(Number(value) * textScale))
    }

    function adjustTextScale(delta) {
        const next = Math.max(0.85, Math.min(1.6,
            Math.round((textScale + delta) * 20) / 20))
        if (Math.abs(next - textScale) < 0.001)
            return
        Store.set("wp-news-reader-scale", next)
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-news-reader-scale")
                pane.storeRevision++
        }
    }

    Item {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        height: 54

        Column {
            anchors.left: parent.left
            anchors.right: readerTextControls.left
            anchors.rightMargin: 10
            anchors.verticalCenter: parent.verticalCenter
            spacing: 3

            Text {
                width: parent.width
                text: pane.active ? (Reader.article.title || "Article") : "Lecture"
                color: Theme.textPrimary
                font.pixelSize: pane.px(Theme.fontSizeTitle)
                font.weight: Font.DemiBold
                maximumLineCount: 2
                elide: Text.ElideRight
                wrapMode: Text.WordWrap
            }
            Text {
                width: parent.width
                visible: pane.active
                text: [Reader.article.sourceLabel || "", Reader.article.source || "",
                       Reader.article.byline || ""].filter(Boolean).join(" | ")
                color: Theme.textSecondary
                font.pixelSize: pane.px(Theme.fontSizeCaption)
                elide: Text.ElideRight
            }
        }

        Row {
            id: readerTextControls
            anchors.right: browserButton.left
            anchors.rightMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            spacing: 2

            Rectangle {
                width: 26
                height: 26
                radius: 5
                opacity: pane.textScale > 0.85 ? 1 : 0.35
                color: readerSmallerMouse.containsMouse ? Theme.hover : "transparent"
                Text {
                    anchors.centerIn: parent
                    text: "A-"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: readerSmallerMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: pane.textScale > 0.85
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: pane.adjustTextScale(-0.1)
                }
            }
            Rectangle {
                width: 26
                height: 26
                radius: 5
                opacity: pane.textScale < 1.6 ? 1 : 0.35
                color: readerLargerMouse.containsMouse ? Theme.hover : "transparent"
                Text {
                    anchors.centerIn: parent
                    text: "A+"
                    color: Theme.textSecondary
                    font.pixelSize: 10
                }
                MouseArea {
                    id: readerLargerMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: pane.textScale < 1.6
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: pane.adjustTextScale(0.1)
                }
            }
        }

        IconButton {
            id: browserButton
            anchors.right: externalButton.left
            anchors.rightMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            enabled: pane.active && (Reader.article.url || "") !== ""
            glyph: "\uE774"
            tooltip: "Ouvrir dans le panneau web"
            onClicked: Panel.openIsland(Reader.article.url)
        }
        IconButton {
            id: externalButton
            anchors.right: closeButton.left
            anchors.rightMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            enabled: pane.active && (Reader.article.url || "") !== ""
            glyph: "\uE8A7"
            tooltip: "Ouvrir dans le navigateur"
            onClicked: Panel.openExternal(Reader.article.url)
        }
        IconButton {
            id: closeButton
            objectName: "articleReaderClose"
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            enabled: pane.active
            glyph: "\uE8BB"
            tooltip: "Fermer l'article"
            onClicked: {
                if (pane.closeOnRequest)
                    Reader.close()
                pane.closeRequested()
            }
        }
    }

    Rectangle {
        id: divider
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: header.bottom
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        height: 1
        color: Theme.cardStroke
    }

    Rectangle {
        id: progressTrack
        visible: pane.active && Reader.busy
        anchors.left: divider.left
        anchors.right: divider.right
        anchors.top: divider.bottom
        height: 2
        color: Qt.rgba(1, 1, 1, 0.05)
        clip: true

        Rectangle {
            id: progressPulse
            width: Math.max(72, progressTrack.width * 0.28)
            height: parent.height
            color: Theme.accent
            NumberAnimation on x {
                running: progressTrack.visible
                loops: Animation.Infinite
                from: -progressPulse.width
                to: progressTrack.width
                duration: 1050
                easing.type: Easing.InOutQuad
            }
        }
    }

    Text {
        anchors.centerIn: parent
        visible: !pane.active
        text: "Aucun article selectionne"
        color: Theme.textSecondary
        font.pixelSize: pane.px(Theme.fontSizeBody)
    }

    Flickable {
        id: articleScroll
        visible: pane.active
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: progressTrack.bottom
        anchors.bottom: parent.bottom
        anchors.margins: 14
        contentHeight: articleBody.height + 12
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: articleBody
            width: articleScroll.width
            spacing: 12

            Text {
                width: parent.width
                visible: !Reader.busy
                text: {
                    const parts = [pane.paragraphs.length + " paragraphes"]
                    if (pane.images.length > 0)
                        parts.push(pane.images.length + " images")
                    if (Reader.article.fallbackUsed)
                        parts.push("analyse secondaire")
                    if (Reader.article.paywall)
                        parts.push("paywall")
                    if (Reader.article.challenge)
                        parts.push("site protege")
                    return parts.join(" | ")
                }
                color: Theme.textSecondary
                font.pixelSize: pane.px(Theme.fontSizeCaption)
                elide: Text.ElideRight
            }

            Rectangle {
                width: parent.width
                height: visible ? Math.round(width * 9 / 21) : 0
                visible: pane.images.length > 0
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.04)
                clip: true

                Image {
                    anchors.fill: parent
                    source: pane.images.length > 0 ? pane.images[0] : ""
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                }
            }

            Text {
                width: parent.width
                visible: Reader.busy
                text: "Extraction de l'article..."
                color: Theme.textSecondary
                font.pixelSize: pane.px(Theme.fontSizeBody)
                font.italic: true
            }

            Column {
                width: parent.width
                spacing: 8
                visible: !Reader.busy && pane.paragraphs.length === 0

                Text {
                    width: parent.width
                    text: Reader.article.paywall || Reader.article.challenge
                          ? "Le site bloque la lecture integree."
                          : "Le contenu de cet article n'a pas pu etre extrait."
                    color: Theme.textSecondary
                    font.pixelSize: pane.px(Theme.fontSizeBody)
                    wrapMode: Text.WordWrap
                }
                Rectangle {
                    width: archiveLabel.implicitWidth + 22
                    height: 28
                    radius: 6
                    color: archiveMouse.containsMouse ? Theme.hover : Theme.activeFill
                    border.color: Theme.cardStroke

                    Text {
                        id: archiveLabel
                        anchors.centerIn: parent
                        text: "Version archivee"
                        color: Theme.textPrimary
                        font.pixelSize: pane.px(Theme.fontSizeCaption)
                    }
                    MouseArea {
                        id: archiveMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Reader.openArchive(Reader.article.url)
                    }
                }
            }

            Repeater {
                model: pane.paragraphs
                delegate: Text {
                    required property string modelData
                    width: articleBody.width
                    text: modelData
                    color: "#d6dae6"
                    font.pixelSize: pane.px(13)
                    lineHeight: 1.42
                    wrapMode: Text.WordWrap
                }
            }
        }
    }
}
