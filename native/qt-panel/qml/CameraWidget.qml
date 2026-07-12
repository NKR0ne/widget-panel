import QtQuick
import QtPanel.Native

// Milestone XProtect camera. Frames arrive as JPEGs from CameraClient and are
// served through image://camera; frameId bumps the source to force a reload.
GlassCard {
    id: card
    title: "Caméra"
    implicitHeight: body.implicitHeight + 24
    property bool detailMode: false
    flat: detailMode
    interactive: !detailMode

    Component.onCompleted: if (!detailMode && Camera.configured) Camera.start()
    Component.onDestruction: if (!detailMode) Camera.stop()

    function forgetCredentials() {
        Camera.forgetCredentials()
        userInput.text = ""
        passInput.text = ""
        SoundFx.tap()
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        CardHeader {
            width: parent.width
            title: card.title
            subtitle: Store.get("wp-camera-name", "")
            status: Camera.status === "streaming" ? "LIVE" : Camera.status.toUpperCase()
            statusColor: Camera.status === "streaming" ? Theme.success
                       : Camera.status === "error" ? Theme.danger : Theme.warning
            expandable: !card.detailMode && Camera.status === "streaming"
            onExpandRequested: Ui.openDetail("camera", "Cam\u00e9ra", {
                subtitle: Store.get("wp-camera-name", "XProtect")
            })
            IconButton {
                buttonSize: 22
                glyph: "\uE713"
                tooltip: "Configurer la cam\u00e9ra"
                onClicked: camIdRow.visible = !camIdRow.visible
            }
        }

        // Camera id editor (XProtect GUID). Change + reconnect.
        Row {
            id: camIdRow
            width: parent.width
            spacing: 6
            visible: false
            Rectangle {
                width: parent.width - camDiscover.width - camApply.width - 12; height: 26; radius: 6
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
                id: camDiscover
                width: 58; height: 26; radius: 6
                color: camDiscoverMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text { anchors.centerIn: parent; text: "Scan"; color: Theme.textSecondary; font.pixelSize: 9 }
                MouseArea {
                    id: camDiscoverMouse; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Camera.discoverCameras()
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

        Column {
            visible: camIdRow.visible && Camera.cameras.length > 0
            width: parent.width
            spacing: 4
            Repeater {
                model: Camera.cameras
                delegate: Rectangle {
                    required property var modelData
                    width: body.width
                    height: 24
                    radius: 6
                    color: cameraPickMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.035)
                    border.color: Theme.cardStroke
                    Text {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.margins: 8
                        text: modelData.name || modelData.id
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                    MouseArea {
                        id: cameraPickMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            Store.set("wp-camera-id", modelData.id)
                            Store.set("wp-camera-name", modelData.name || modelData.id)
                            camId.text = modelData.id
                            camIdRow.visible = false
                            Camera.start()
                        }
                    }
                }
            }
        }

        // Video frame
        Rectangle {
            width: parent.width
            height: card.detailMode ? Math.min(620, Math.max(320, width * 0.62))
                                    : Math.round(width * 9 / 16)
            radius: 8
            color: "#0a0a0c"
            clip: true
            visible: Camera.status === "streaming"

            Image {
                anchors.fill: parent
                fillMode: card.detailMode ? Image.PreserveAspectFit : Image.PreserveAspectCrop
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

        Row {
            visible: Camera.configured && Camera.status === "error"
            spacing: 6

            Rectangle {
                width: retryLabel.implicitWidth + 18
                height: 26
                radius: 6
                color: retryMouse.containsMouse ? Theme.activeFill
                                                : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                border.color: Qt.rgba(0.31, 0.56, 0.97, 0.4)
                Text {
                    id: retryLabel
                    anchors.centerIn: parent
                    text: "R\u00e9essayer"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: retryMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Camera.start()
                }
            }
            Rectangle {
                width: forgetLabel.implicitWidth + 18
                height: 26
                radius: 6
                color: forgetMouse.containsMouse
                    ? Qt.rgba(0.97, 0.45, 0.45, 0.20) : "transparent"
                border.color: Qt.rgba(0.97, 0.45, 0.45, 0.32)
                Text {
                    id: forgetLabel
                    anchors.centerIn: parent
                    text: "Oublier"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: forgetMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.forgetCredentials()
                }
            }
        }

        // The login form never auto-submits and appears after credentials are
        // forgotten or rejected by the bounded authentication sequence.
        Column {
            visible: !Camera.configured
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
