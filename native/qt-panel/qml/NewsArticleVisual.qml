import QtQuick
import QtPanel.Native

// Shared image-led article face used by carousel flips and matrix cards.
Item {
    id: visual

    property var article: ({})
    readonly property bool unread: { NewsRead.revision; return NewsRead.isUnread(article) }
    property real textScale: 1.0
    property bool showDescription: true
    property int titleLines: 3
    property int descriptionLines: 2
    property real imageOpacity: 0.74
    property real sideInset: 14
    property real bottomInset: 14

    function px(value) {
        const scale = Math.max(0.85, Math.min(1.35, Number(textScale) || 1))
        return Math.max(8, Math.round(Number(value) * scale))
    }

    function compactText(value, fallback) {
        return String(value || fallback || "").replace(/\s+/g, " ").trim()
    }

    function hostFromUrl(url) {
        const match = String(url || "").match(/^https?:\/\/([^\/?#]+)/i)
        return match ? match[1].replace(/^www\./, "") : ""
    }

    Image {
        anchors.fill: parent
        source: visual.article.image || ""
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
        visible: (visual.article.image || "") !== ""
        opacity: status === Image.Ready ? visual.imageOpacity * (visual.unread ? 1 : 0.5) : 0
        Behavior on opacity {
            NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic }
        }
    }

    Rectangle {
        objectName: "newsArticleReadTone"
        anchors.fill: parent
        color: !visual.unread ? Theme.panelSolid : (visual.article.image || "") !== ""
               ? Qt.rgba(0.018, 0.025, 0.045, 0.18)
               : Qt.rgba(0.055, 0.075, 0.12, 1)
        opacity: visual.unread ? 1 : 0.65
    }

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: Qt.rgba(0.015, 0.025, 0.05, 0.08) }
            GradientStop { position: 0.46; color: Qt.rgba(0.015, 0.025, 0.05, 0.34) }
            GradientStop { position: 0.72; color: Qt.rgba(0.012, 0.02, 0.04, 0.84) }
            GradientStop { position: 1.0; color: Qt.rgba(0.008, 0.014, 0.03, 0.97) }
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 1
        opacity: Ui.surfaceLighting ? 0.7 : 0
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: "transparent" }
            GradientStop { position: 0.3; color: Theme.keyline }
            GradientStop { position: 0.7; color: Theme.keyline }
            GradientStop { position: 1.0; color: "transparent" }
        }
    }

    Rectangle {
        objectName: "newsArticleUnreadStripe"
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 3
        color: Theme.accent
        visible: visual.unread
    }

    Rectangle {
        anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 12
        width: 7; height: 7; radius: 3.5
        color: Theme.accent
        opacity: visual.unread ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
    }

    Column {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.leftMargin: visual.sideInset
        anchors.rightMargin: visual.sideInset
        anchors.bottomMargin: visual.bottomInset
        spacing: 7

        Row {
            width: parent.width
            spacing: 8

            Text {
                width: Math.max(40, parent.width - articleTime.width - 8)
                text: visual.compactText(visual.article.source,
                                         visual.hostFromUrl(visual.article.link))
                color: Qt.rgba(0.92, 0.94, 1.0, 0.78)
                font.pixelSize: visual.px(10)
                font.weight: Font.Medium
                elide: Text.ElideRight
            }

            Text {
                id: articleTime
                text: visual.article.time || ""
                color: Qt.rgba(0.92, 0.94, 1.0, 0.66)
                font.pixelSize: visual.px(9)
            }
        }

        Text {
            width: parent.width
            text: (visual.unread ? "\u2022 " : "") + (visual.article.title || "Article")
            color: visual.unread ? Theme.textPrimary : Theme.textSecondary
            font.pixelSize: visual.px(15)
            font.weight: visual.unread ? Font.DemiBold : Font.Normal
            wrapMode: Text.WordWrap
            maximumLineCount: visual.titleLines
            elide: Text.ElideRight
            lineHeight: 1.12
        }

        Text {
            visible: visual.showDescription
                     && (visual.article.description || "") !== ""
            width: parent.width
            text: visual.compactText(visual.article.description, "")
            color: Qt.rgba(0.94, 0.96, 1.0, 0.76)
            opacity: visual.unread ? 1 : 0.72
            font.pixelSize: visual.px(10)
            wrapMode: Text.WordWrap
            maximumLineCount: visual.descriptionLines
            elide: Text.ElideRight
            lineHeight: 1.12
        }
    }
}
