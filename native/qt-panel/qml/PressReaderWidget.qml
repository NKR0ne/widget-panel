import QtQuick
import QtPanel.Native

// PressReader stays web-based (library ezproxy auth); the card opens the
// catalog in a brave-host island beside the panel, matching the plan's
// "web island" approach for auth-heavy sites.
GlassCard {
    id: card
    title: "PressReader"
    implicitHeight: body.implicitHeight + 24

    readonly property string catalogUrl:
        "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog/featured"

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 10

        Text {
            text: card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
        }

        Text {
            width: parent.width
            text: "Journaux et magazines via la Bibliothèque de Québec"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }

        Rectangle {
            width: openLabel.implicitWidth + 24
            height: 30
            radius: 7
            color: openMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.28)
                                           : Qt.rgba(0.31, 0.56, 0.97, 0.16)
            border.color: Qt.rgba(0.31, 0.56, 0.97, 0.45)

            Text {
                id: openLabel
                anchors.centerIn: parent
                text: "Ouvrir le catalogue"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
            }
            MouseArea {
                id: openMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: Panel.openIsland(card.catalogUrl)
            }
        }
    }
}
