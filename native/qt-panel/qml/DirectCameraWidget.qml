import QtQuick
import QtPanel.Native

// Direct IP camera launcher. Authentication is intentionally left to the
// camera page so the panel never retries credentials against lockout-limited
// device firmware.
GlassCard {
    id: card
    title: "Camera directe"
    implicitHeight: body.implicitHeight + 24

    property int storeRevision: 0
    readonly property string defaultUrl: "http://ipcam1.local/doc/page/preview.asp"

    function cameraUrl() {
        const revision = storeRevision
        const value = Store.get("wp-camera-direct-url", defaultUrl) || defaultUrl
        return String(value).replace(/^(https?:\/\/)[^\/@]+@/i, "$1")
    }

    function openCamera() {
        Panel.openIsland(cameraUrl())
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-camera-direct-url")
                card.storeRevision += 1
        }
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
            spacing: 6
            Text {
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                anchors.verticalCenter: parent.verticalCenter
            }
            Rectangle {
                width: 6
                height: 6
                radius: 3
                color: "#60a5fa"
                anchors.verticalCenter: parent.verticalCenter
            }
            Item { width: Math.max(1, parent.width - x - openBtn.width - 6); height: 1 }
            Rectangle {
                id: openBtn
                width: openLabel.implicitWidth + 16
                height: 22
                radius: 6
                anchors.verticalCenter: parent.verticalCenter
                color: openMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.28)
                                               : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                border.color: Qt.rgba(0.31, 0.56, 0.97, 0.45)
                Text {
                    id: openLabel
                    anchors.centerIn: parent
                    text: "Ouvrir"
                    color: Theme.textPrimary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: openMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.openCamera()
                }
            }
        }

        Rectangle {
            width: parent.width
            height: 82
            radius: 8
            color: Qt.rgba(1, 1, 1, 0.04)
            border.color: Theme.cardStroke

            Column {
                anchors.fill: parent
                anchors.margins: 10
                spacing: 6
                Text {
                    width: parent.width
                    text: "Connexion directe"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                }
                Text {
                    width: parent.width
                    text: card.cameraUrl()
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideMiddle
                }
                Text {
                    width: parent.width
                    text: "Login manuel dans la page camera; aucun mot de passe stocke ici."
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    wrapMode: Text.WordWrap
                }
            }

            MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: card.openCamera()
            }
        }
    }
}
