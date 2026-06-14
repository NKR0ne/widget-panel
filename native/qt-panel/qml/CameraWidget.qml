import QtQuick
import QtPanel.Native

// Milestone XProtect camera. Frames arrive as JPEGs from CameraClient and are
// served through image://camera; frameId bumps the source to force a reload.
GlassCard {
    id: card
    title: "Caméra"
    implicitHeight: body.implicitHeight + 24

    Component.onCompleted: if (Camera.configured) Camera.start()

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
            }
            Rectangle {
                width: 6; height: 6; radius: 3
                anchors.verticalCenter: parent.verticalCenter
                color: Camera.status === "streaming" ? "#34d399"
                     : Camera.status === "error" ? "#f87171" : "#fbbf24"
            }
            Item { width: parent.width - x - camGear.width; height: 1 }
            Text {
                id: camGear
                text: ""  // Settings gear
                font.family: "Segoe Fluent Icons"; font.pixelSize: 11
                color: camGearMouse.containsMouse ? Theme.accent : Theme.textSecondary
                anchors.verticalCenter: parent.verticalCenter
                MouseArea {
                    id: camGearMouse; anchors.fill: parent; anchors.margins: -4
                    hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                    onClicked: camIdRow.visible = !camIdRow.visible
                }
            }
        }

        // Camera id editor (XProtect GUID). Change + reconnect.
        Row {
            id: camIdRow
            width: parent.width
            spacing: 6
            visible: false
            Rectangle {
                width: parent.width - camApply.width - 6; height: 26; radius: 6
                color: Qt.rgba(1,1,1,0.05)
                border.color: camId.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: camId
                    anchors.fill: parent; anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary; font.pixelSize: 9; clip: true
                    Component.onCompleted: text = Store.get("wp-camera-id", "")
                    Text {
                        visible: camId.text === "" && !camId.activeFocus
                        text: "GUID caméra"; color: Qt.rgba(1,1,1,0.25); font.pixelSize: 9
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
            Rectangle {
                id: camApply
                width: 54; height: 26; radius: 6
                color: camApplyMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                Text { anchors.centerIn: parent; text: "Appliquer"; color: Theme.textPrimary; font.pixelSize: 9 }
                MouseArea {
                    id: camApplyMouse; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: { Store.set("wp-camera-id", camId.text.trim()); camIdRow.visible = false; Camera.start() }
                }
            }
        }

        // Video frame
        Rectangle {
            width: parent.width
            height: Math.round(width * 9 / 16)
            radius: 8
            color: "#0a0a0c"
            clip: true
            visible: Camera.status === "streaming"

            Image {
                anchors.fill: parent
                fillMode: Image.PreserveAspectCrop
                cache: false
                asynchronous: true
                source: Camera.frameId > 0
                    ? "image://camera/frame?n=" + Camera.frameId : ""
            }
        }

        // Status / login affordances
        Text {
            visible: Camera.status !== "streaming"
            width: parent.width
            text: Camera.status === "connecting" ? "Connexion à la caméra…"
                : Camera.status === "login" ? "Authentification…"
                : Camera.status === "error" ? ("Erreur : " + Camera.error)
                : Camera.configured ? "Caméra prête" : "Identifiants requis"
            color: Camera.status === "error" ? "#f87171" : Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }

        // Inline login form when no stored credentials (or after an error)
        Column {
            visible: !Camera.configured || Camera.status === "error"
            width: parent.width
            spacing: 6

            Rectangle {
                width: parent.width; height: 28; radius: 6
                color: Qt.rgba(1, 1, 1, 0.05)
                border.color: userInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: userInput
                    anchors.fill: parent
                    anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    clip: true
                    Text {
                        visible: userInput.text === "" && !userInput.activeFocus
                        text: "Utilisateur"
                        color: Qt.rgba(1, 1, 1, 0.25)
                        font.pixelSize: Theme.fontSizeCaption
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
            Rectangle {
                width: parent.width; height: 28; radius: 6
                color: Qt.rgba(1, 1, 1, 0.05)
                border.color: passInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: passInput
                    anchors.fill: parent
                    anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    echoMode: TextInput.Password
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    clip: true
                    onAccepted: if (userInput.text) Camera.start(userInput.text, passInput.text, "auto")
                    Text {
                        visible: passInput.text === "" && !passInput.activeFocus
                        text: "Mot de passe"
                        color: Qt.rgba(1, 1, 1, 0.25)
                        font.pixelSize: Theme.fontSizeCaption
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
            Rectangle {
                width: connectLabel.implicitWidth + 22
                height: 26
                radius: 6
                color: connectMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.25)
                                                  : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                border.color: Qt.rgba(0.31, 0.56, 0.97, 0.4)
                Text {
                    id: connectLabel
                    anchors.centerIn: parent
                    text: "Connecter"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: connectMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: if (userInput.text) Camera.start(userInput.text, passInput.text, "auto")
                }
            }
        }
    }
}
