import QtQuick
import QtPanel.Native

// Optional dashboard summary. The PressReader service and spotlight remain
// available from the global header even when this card is disabled.
GlassCard {
    id: card
    title: "PressReader"
    implicitHeight: body.implicitHeight + 24

    function stateColor() {
        if (PressReader.state === "rejected" || PressReader.state === "offline")
            return Theme.danger
        if (PressReader.state === "catalog-ready"
                || PressReader.state === "publication-ready")
            return Theme.success
        if (PressReader.hasCredentials)
            return Theme.warning
        return Qt.rgba(1, 1, 1, 0.24)
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 9

        Row {
            width: parent.width
            spacing: 6
            Text {
                text: "PRESSREADER"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 0
            }
            Item { width: Math.max(0, parent.width - x - sessionText.width); height: 1 }
            Text {
                id: sessionText
                text: PressReader.sessionRemainingMinutes > 0
                      ? (PressReader.sessionRemainingMinutes >= 60
                         ? Math.floor(PressReader.sessionRemainingMinutes / 60) + " h"
                         : PressReader.sessionRemainingMinutes + " min")
                      : ""
                color: Theme.textSecondary
                font.pixelSize: 9
            }
        }

        Text {
            width: parent.width
            text: "Journaux et magazines via la Bibliotheque de Quebec"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }

        Row {
            width: parent.width
            spacing: 6
            Rectangle {
                width: 7
                height: 7
                radius: 4
                anchors.verticalCenter: parent.verticalCenter
                color: card.stateColor()
            }
            Text {
                width: parent.width - x
                text: PressReader.status
                color: Theme.textSecondary
                font.pixelSize: 10
                elide: Text.ElideRight
            }
        }

        Row {
            width: parent.width
            spacing: 6
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
                    text: PressReader.open ? "Fermer" : "Ouvrir le catalogue"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: openMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: PressReader.toggle()
                }
            }
            Rectangle {
                width: accountLabel.implicitWidth + 18
                height: 30
                radius: 7
                color: accountMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.05)
                border.color: Theme.cardStroke
                Text {
                    id: accountLabel
                    anchors.centerIn: parent
                    text: "Compte"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: accountMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (!PressReader.open)
                            PressReader.openCatalog()
                        PressReader.showCredentials()
                    }
                }
            }
        }
    }
}
