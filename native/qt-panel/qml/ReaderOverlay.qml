import QtQuick
import QtPanel.Native

// Full-panel native reader: opens instantly with seed data from the news
// item, fills in extracted paragraphs when the fetch lands. While open it
// holds the modal guard so blur-to-hide leaves the panel alone.
Item {
    id: overlay

    property bool open: false
    property bool presentationEnabled: true

    function show() {
        open = true
        Panel.setModalOpen(true)
    }
    function dismiss() {
        open = false
        Panel.setModalOpen(false)
        Reader.close()
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
        if (!presentationEnabled && open)
            dismiss()
    }

    // Scrim — click outside the card closes.
    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.55)
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
                        text: (Reader.article.source || "")
                              + (Reader.article.byline ? " · " + Reader.article.byline : "")
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                        elide: Text.ElideRight
                    }
                }
                IconButton {
                    id: openIsland
                    glyph: ""  // Globe: open beside the panel in Brave
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
                                 && (Reader.article.paragraphs || []).length === 0

                        Text {
                            width: parent.width
                            text: "Extraction impossible — essayez la version archivée."
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
                    }

                    Repeater {
                        model: Reader.article.paragraphs || []
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
}
