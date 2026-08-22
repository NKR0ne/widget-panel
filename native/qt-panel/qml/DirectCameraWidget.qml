import QtQuick
import QtMultimedia
import QtPanel.Native

// Native RTSP camera card. This service is intentionally independent from the
// XProtect card and never retries an unverified credential set automatically.
GlassCard {
    id: card
    title: "Cam\u00e9ra directe"
    implicitHeight: body.implicitHeight + 24

    property bool configOpen: !DirectCamera.configured
    property int vaultRevision: 0
    property bool resetArmed: false
    readonly property bool busy: DirectCamera.status === "connecting"
    readonly property bool live: DirectCamera.status === "streaming"

    function hasStoredPassword() {
        const revision = vaultRevision
        return Vault.has("camera-direct-password")
    }

    function statusLabel() {
        if (live) return "LIVE"
        if (busy) return "CONNEXION"
        if (DirectCamera.status === "blocked") return "BLOQU\u00c9"
        if (DirectCamera.status === "error") return "ERREUR"
        if (DirectCamera.status === "ready") return "PR\u00caT"
        if (DirectCamera.status === "stopped") return "ARR\u00caT\u00c9"
        return "CONFIG"
    }

    function statusMessage() {
        if (DirectCamera.error !== "") return DirectCamera.error
        if (live) return "Flux RTSP direct"
        if (busy) return "Ouverture du flux RTSP\u2026"
        if (DirectCamera.status === "blocked")
            return "Protection active. V\u00e9rifiez ou modifiez les identifiants avant un nouvel essai."
        if (DirectCamera.configured)
            return DirectCamera.verified ? "Identifiants v\u00e9rifi\u00e9s" : "Connexion manuelle requise"
        return "Configurez les identifiants propres \u00e0 cette cam\u00e9ra."
    }

    function submit() {
        DirectCamera.configureAndStart(userInput.text, passInput.text, endpointInput.text)
        passInput.text = ""
    }

    function requestGuardReset() {
        if (!resetArmed) {
            resetArmed = true
            resetTimer.restart()
            return
        }
        resetTimer.stop()
        resetArmed = false
        DirectCamera.resetAttemptGuard()
    }

    Timer {
        id: resetTimer
        interval: 6000
        onTriggered: card.resetArmed = false
    }

    Component.onCompleted: {
        endpointInput.text = DirectCamera.endpoint
        userInput.text = Store.get("wp-camera-direct-user", "")
        DirectCamera.attachVideoSink(videoOutput.videoSink)
        DirectCamera.startIfVerified()
    }
    Component.onDestruction: {
        DirectCamera.detachVideoSink(videoOutput.videoSink)
    }
    // Only one render sink exists. The Starvis Vision tile takes it while that
    // stage is up, so the card claims it back whenever it is shown again —
    // otherwise its picture stays dead after a round trip through Starvis.
    onVisibleChanged: if (visible) DirectCamera.attachVideoSink(videoOutput.videoSink)

    Connections {
        target: DirectCamera
        function onConfigurationChanged() {
            if (!endpointInput.activeFocus)
                endpointInput.text = DirectCamera.endpoint
            if (!userInput.activeFocus)
                userInput.text = Store.get("wp-camera-direct-user", "")
        }
        function onStatusChanged() {
            if (DirectCamera.status === "blocked" || DirectCamera.status === "setup")
                card.configOpen = true
        }
    }
    Connections {
        target: Vault
        function onChanged(key) {
            if (key === "camera-direct-password")
                card.vaultRevision += 1
        }
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
            subtitle: DirectCamera.endpoint
            status: card.statusLabel()
            statusColor: card.live ? Theme.success
                       : DirectCamera.status === "error" || DirectCamera.status === "blocked"
                           ? Theme.danger
                           : card.busy ? Theme.warning : Theme.accent
            IconButton {
                buttonSize: 22
                glyph: "\uE713"
                tooltip: "Configurer la cam\u00e9ra directe"
                onClicked: card.configOpen = !card.configOpen
            }
        }

        Rectangle {
            width: parent.width
            height: Math.max(132, Math.round(width * 9 / 16))
            radius: 7
            color: "#080a0f"
            border.color: Theme.cardStroke
            clip: true

            VideoOutput {
                id: videoOutput
                anchors.fill: parent
                fillMode: VideoOutput.PreserveAspectCrop
                visible: card.live
            }

            Column {
                anchors.centerIn: parent
                width: Math.max(80, parent.width - 32)
                spacing: 5
                visible: !card.live
                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: card.busy ? "Connexion au flux\u2026" : "Aucun signal vid\u00e9o"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    font.weight: Font.DemiBold
                }
                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: card.statusMessage()
                    color: DirectCamera.status === "error" || DirectCamera.status === "blocked"
                           ? Theme.danger : Theme.textSecondary
                    font.pixelSize: 9
                    wrapMode: Text.WordWrap
                }
            }
        }

        Row {
            width: parent.width
            spacing: 6
            Text {
                width: Math.max(1, parent.width - actionRow.width - 6)
                anchors.verticalCenter: parent.verticalCenter
                text: card.statusMessage()
                color: DirectCamera.status === "error" || DirectCamera.status === "blocked"
                       ? Theme.danger : Theme.textSecondary
                font.pixelSize: 9
                elide: Text.ElideRight
            }
            Row {
                id: actionRow
                spacing: 5
                Rectangle {
                    visible: DirectCamera.configured && !card.busy && !card.live
                    width: retryLabel.implicitWidth + 16
                    height: 24
                    radius: 6
                    color: retryMouse.containsMouse ? Theme.activeFill : Theme.cardFill
                    border.color: Theme.cardStroke
                    Text {
                        id: retryLabel
                        anchors.centerIn: parent
                        text: "Connecter"
                        color: Theme.textPrimary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: retryMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: DirectCamera.start()
                    }
                }
                Rectangle {
                    visible: card.busy || card.live
                    width: stopLabel.implicitWidth + 16
                    height: 24
                    radius: 6
                    color: stopMouse.containsMouse ? Theme.hover : Theme.cardFill
                    border.color: Theme.cardStroke
                    Text {
                        id: stopLabel
                        anchors.centerIn: parent
                        text: "Arr\u00eater"
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: stopMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: DirectCamera.stop()
                    }
                }
            }
        }

        Text {
            visible: !DirectCamera.verified
            width: parent.width
            text: DirectCamera.authAttemptsRemaining
                  + " essais prot\u00e9g\u00e9s disponibles pour cette configuration"
            color: DirectCamera.authAttemptsRemaining === 0 ? Theme.danger : Theme.textSecondary
            font.pixelSize: 8
            elide: Text.ElideRight
        }

        Row {
            visible: DirectCamera.status === "blocked"
            width: parent.width
            spacing: 6
            Text {
                width: Math.max(1, parent.width - resetButton.width - 6)
                anchors.verticalCenter: parent.verticalCenter
                text: "R\u00e9armez uniquement apr\u00e8s avoir confirm\u00e9 les identifiants et la fin du verrouillage de la cam\u00e9ra."
                color: Theme.warning
                font.pixelSize: 8
                wrapMode: Text.WordWrap
            }
            Rectangle {
                id: resetButton
                width: resetLabel.implicitWidth + 16
                height: 25
                radius: 6
                color: resetMouse.containsMouse ? Qt.rgba(0.97, 0.45, 0.45, 0.20) : Theme.cardFill
                border.color: card.resetArmed ? Theme.danger : Theme.cardStroke
                Text {
                    id: resetLabel
                    anchors.centerIn: parent
                    text: card.resetArmed ? "Confirmer" : "R\u00e9armer"
                    color: card.resetArmed ? Theme.danger : Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: resetMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.requestGuardReset()
                }
            }
        }

        Column {
            visible: card.configOpen
            width: parent.width
            spacing: 6

            Text {
                width: parent.width
                text: "Le sous-flux 102 est utilis\u00e9 par d\u00e9faut. Aucun repli vers une autre URL ni nouvel essai automatique."
                color: Theme.textSecondary
                font.pixelSize: 8
                wrapMode: Text.WordWrap
            }

            Rectangle {
                width: parent.width
                height: 28
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.05)
                border.color: endpointInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: endpointInput
                    anchors.fill: parent
                    anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary
                    font.pixelSize: 9
                    clip: true
                    selectByMouse: true
                    Text {
                        visible: endpointInput.text === "" && !endpointInput.activeFocus
                        text: "rtsp://h\u00f4te:554/ISAPI/Streaming/channels/102"
                        color: Qt.rgba(1, 1, 1, 0.25)
                        font.pixelSize: 9
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 28
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.05)
                border.color: userInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: userInput
                    anchors.fill: parent
                    anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary
                    font.pixelSize: 9
                    clip: true
                    selectByMouse: true
                    Text {
                        visible: userInput.text === "" && !userInput.activeFocus
                        text: "Utilisateur de la cam\u00e9ra directe"
                        color: Qt.rgba(1, 1, 1, 0.25)
                        font.pixelSize: 9
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 28
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.05)
                border.color: passInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: passInput
                    anchors.fill: parent
                    anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    echoMode: TextInput.Password
                    color: Theme.textPrimary
                    font.pixelSize: 9
                    clip: true
                    selectByMouse: true
                    onAccepted: if (userInput.text !== "" && (text !== "" || card.hasStoredPassword())) card.submit()
                    Text {
                        visible: passInput.text === "" && !passInput.activeFocus
                        text: card.hasStoredPassword()
                              ? "Mot de passe enregistr\u00e9 (laisser vide)"
                              : "Mot de passe de la cam\u00e9ra directe"
                        color: Qt.rgba(1, 1, 1, 0.25)
                        font.pixelSize: 9
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }

            Row {
                spacing: 6
                Rectangle {
                    width: connectLabel.implicitWidth + 18
                    height: 25
                    radius: 6
                    color: connectMouse.containsMouse ? Theme.activeFill : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                    border.color: Theme.accent
                    opacity: userInput.text !== "" && (passInput.text !== "" || card.hasStoredPassword()) ? 1 : 0.45
                    Text {
                        id: connectLabel
                        anchors.centerIn: parent
                        text: "Enregistrer et connecter"
                        color: Theme.textPrimary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: connectMouse
                        anchors.fill: parent
                        enabled: userInput.text !== "" && (passInput.text !== "" || card.hasStoredPassword())
                        hoverEnabled: true
                        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: card.submit()
                    }
                }
                Rectangle {
                    visible: DirectCamera.configured
                    width: forgetLabel.implicitWidth + 16
                    height: 25
                    radius: 6
                    color: forgetMouse.containsMouse ? Qt.rgba(0.97, 0.45, 0.45, 0.20) : "transparent"
                    border.color: Qt.rgba(0.97, 0.45, 0.45, 0.35)
                    Text {
                        id: forgetLabel
                        anchors.centerIn: parent
                        text: "Oublier"
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: forgetMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            DirectCamera.forgetCredentials()
                            userInput.text = ""
                            passInput.text = ""
                        }
                    }
                }
            }
        }
    }
}
