import QtQuick
import QtQuick.Layouts
import QtPanel.Native

Rectangle {
    id: card

    readonly property bool hasArticle: String(Reader.article.url || "") !== ""

    radius: Theme.radiusCard
    color: Qt.rgba(1, 1, 1, 0.045)
    border.color: Theme.cardStroke
    border.width: 1
    clip: true

    RowLayout {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 7

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            Text {
                Layout.fillWidth: true
                text: card.hasArticle ? (Reader.article.title || "Article") : "Lecture"
                color: Theme.textPrimary
                font.pixelSize: 15
                font.weight: Font.DemiBold
                maximumLineCount: 2
                elide: Text.ElideRight
                wrapMode: Text.WordWrap
            }
            Text {
                Layout.fillWidth: true
                visible: card.hasArticle
                text: (Reader.article.source || "")
                      + (Reader.article.byline ? "  ·  " + Reader.article.byline : "")
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                elide: Text.ElideRight
            }
        }

        IconButton {
            visible: card.hasArticle
            glyph: "\uE774"
            onClicked: Panel.openIsland(Reader.article.url)
        }
        IconButton {
            visible: card.hasArticle
            glyph: "\uE8A7"
            onClicked: Qt.openUrlExternally(Reader.article.url)
        }
        IconButton {
            visible: card.hasArticle
            glyph: "\uE8BB"
            onClicked: Reader.close()
        }
    }

    Rectangle {
        id: divider
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: header.bottom
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        anchors.topMargin: 10
        height: 1
        color: Theme.cardStroke
    }

    Column {
        anchors.centerIn: parent
        width: Math.min(320, parent.width - 48)
        spacing: 8
        visible: !card.hasArticle

        Text {
            width: parent.width
            text: "Sélectionnez un article"
            color: Theme.textPrimary
            font.pixelSize: 16
            font.weight: Font.DemiBold
            horizontalAlignment: Text.AlignHCenter
        }
        Text {
            width: parent.width
            text: "Son contenu apparaîtra ici sans masquer les catégories ni la liste."
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeBody
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignHCenter
        }
    }

    Flickable {
        id: articleScroll
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: divider.bottom
        anchors.bottom: parent.bottom
        anchors.topMargin: 10
        visible: card.hasArticle
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        contentWidth: width
        contentHeight: articleColumn.height + 28

        Column {
            id: articleColumn
            width: Math.min(720, articleScroll.width - 36)
            x: Math.round((articleScroll.width - width) / 2)
            spacing: 13

            Rectangle {
                width: parent.width
                height: visible ? Math.min(270, Math.round(width * 0.42)) : 0
                visible: String(Reader.article.image || "") !== ""
                radius: 7
                color: "#0b0d13"
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
                text: "Extraction de l'article..."
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeBody
                font.italic: true
            }

            Column {
                width: parent.width
                spacing: 9
                visible: !Reader.busy
                         && (Reader.article.paragraphs || []).length === 0
                Text {
                    width: parent.width
                    text: "Le contenu simplifié n'est pas disponible pour cette page."
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeBody
                    wrapMode: Text.WordWrap
                }
                Rectangle {
                    width: archiveText.implicitWidth + 20
                    height: 27
                    radius: 5
                    color: archiveMouse.containsMouse ? Theme.hover : Theme.cardFill
                    border.color: Theme.cardStroke
                    Text {
                        id: archiveText
                        anchors.centerIn: parent
                        text: "Essayer la version archivée"
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
                    color: "#d9dce6"
                    font.pixelSize: 13
                    lineHeight: 1.42
                    wrapMode: Text.WordWrap
                }
            }
        }
    }
}
