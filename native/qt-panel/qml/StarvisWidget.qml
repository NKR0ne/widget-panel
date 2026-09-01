import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtPanel.Native

// Starvis chat card: transcript + input against the OpenAI Responses API,
// with the local context bus injected service-side.
GlassCard {
    id: card
    title: "Starvis"
    implicitHeight: body.implicitHeight + 24

    ListModel { id: transcript }
    property bool agentMode: false
    property bool allowInternet: false
    property string lastUserMessage: ""
    property string pendingInternetRequest: ""
    property string pendingImageUrl: ""
    property string pendingImageName: ""
    // True while a streamed assistant bubble is open at the end of the
    // transcript (Anthropic path); replyReceived finalizes it in place.
    property bool streamOpen: false

    function send(text, forceInternet, appendUser) {
        const hasImage = pendingImageUrl !== ""
        const message = text.trim() || (hasImage ? "Analyse cette image." : "")
        if (message === "" || Starvis.busy)
            return
        const history = []
        for (let i = 0; i < transcript.count; i++) {
            const turn = transcript.get(i)
            history.push({ role: turn.role, text: turn.text })
        }
        if (appendUser !== false) {
            transcript.append({
                role: "user",
                text: message + (hasImage ? "\nImage · " + pendingImageName : "")
            })
            lastUserMessage = message
        }
        input.text = ""
        if (hasImage) {
            const imageUrl = pendingImageUrl
            pendingImageUrl = ""
            pendingImageName = ""
            Starvis.analyzeImageFile(imageUrl, message)
            return
        }
        Starvis.chat(message, history,
            forceInternet === true || card.allowInternet || card.agentMode,
            card.agentMode)
    }

    Connections {
        target: Starvis
        function onReplyStarted() {
            transcript.append({ role: "assistant", text: "" })
            card.streamOpen = true
        }
        function onReplyDelta(text) {
            if (!card.streamOpen)
                return
            const last = transcript.count - 1
            transcript.setProperty(last, "text", transcript.get(last).text + text)
        }
        function onReplyReceived(text, model, latencyMs) {
            if (text.indexOf("INTERNET_PERMISSION_REQUEST:") === 0)
                card.pendingInternetRequest = card.lastUserMessage
            else
                card.pendingInternetRequest = ""
            if (card.streamOpen) {
                // Replace the streamed bubble with the final text (identical
                // in the normal case; authoritative after tool loops).
                transcript.setProperty(transcript.count - 1, "text", text)
                card.streamOpen = false
            } else {
                transcript.append({ role: "assistant", text: text })
            }
        }
        function onChatFailed(error) {
            // Drop an empty half-open streamed bubble before surfacing.
            if (card.streamOpen) {
                const last = transcript.count - 1
                if (transcript.get(last).text === "")
                    transcript.remove(last)
                card.streamOpen = false
            }
            transcript.append({ role: "assistant", text: "⚠ " + error })
        }
    }

    // Voice turns land in the same transcript as typed ones.
    Connections {
        target: Starvis.voice
        function onTranscriptEvent(role, text) {
            transcript.append({ role: role, text: text })
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
            }
            Rectangle {
                width: 6; height: 6; radius: 3
                color: Starvis.configured ? "#62e6ff" : "#f87171"
                anchors.verticalCenter: parent.verticalCenter
                SequentialAnimation on opacity {
                    loops: Animation.Infinite
                    running: Starvis.busy
                    NumberAnimation { to: 0.25; duration: 500 }
                    NumberAnimation { to: 1.0; duration: 500 }
                }
            }
            Item {
                width: Math.max(0, parent.width - x - webBtn.width
                    - agentBtn.width - reasoningBtn.width - briefingBtn.width
                    - stopBtn.width - 24)
                height: 1
            }
            Rectangle {
                id: webBtn
                width: webLabel.implicitWidth + 14
                height: 20
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: card.allowInternet ? Theme.activeFill
                    : webMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: card.allowInternet ? Theme.accent : Theme.cardStroke
                Text {
                    id: webLabel
                    anchors.centerIn: parent
                    text: "Web"
                    color: card.allowInternet ? Theme.accent : Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: webMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        card.allowInternet = !card.allowInternet
                        SoundFx.tap()
                    }
                }
            }
            Rectangle {
                id: agentBtn
                width: agentLabel.implicitWidth + 16
                height: 20
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: card.agentMode ? Qt.rgba(0.38, 0.9, 1, 0.28)
                     : agentMouse.containsMouse ? Qt.rgba(0.38, 0.9, 1, 0.16) : Theme.cardFill
                border.color: card.agentMode ? "#62e6ff" : Theme.cardStroke
                Text {
                    id: agentLabel
                    anchors.centerIn: parent
                    text: "Agent"
                    color: card.agentMode ? "#62e6ff" : Theme.textSecondary
                    font.pixelSize: 10
                }
                MouseArea {
                    id: agentMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.agentMode = !card.agentMode
                }
            }
            Rectangle {
                id: reasoningBtn
                width: reasoningLabel.implicitWidth + 14
                height: 20
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: Starvis.reasoningEnabled ? Theme.activeFill
                    : reasoningMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Starvis.reasoningEnabled ? Theme.accent : Theme.cardStroke
                Text {
                    id: reasoningLabel
                    anchors.centerIn: parent
                    text: "Pensée"
                    color: Starvis.reasoningEnabled ? Theme.accent : Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: reasoningMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Starvis.reasoningEnabled = !Starvis.reasoningEnabled
                }
                ToolTip.visible: reasoningMouse.containsMouse
                ToolTip.text: "Raisonnement approfondi local"
            }
            Rectangle {
                id: briefingBtn
                width: briefingLabel.implicitWidth + 16
                height: 20
                radius: 5
                color: briefingMouse.containsMouse ? Qt.rgba(0.38, 0.9, 1, 0.2)
                                                   : Qt.rgba(0.38, 0.9, 1, 0.1)
                border.color: Qt.rgba(0.38, 0.9, 1, 0.3)
                anchors.verticalCenter: parent.verticalCenter

                Text {
                    id: briefingLabel
                    anchors.centerIn: parent
                    text: "Briefing"
                    color: "#62e6ff"
                    font.pixelSize: 10
                }
                MouseArea {
                    id: briefingMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (Starvis.busy)
                            return
                        transcript.append({ role: "user", text: "Briefing" })
                        Starvis.briefing()
                    }
                }
            }
            Rectangle {
                id: stopBtn
                visible: Starvis.busy
                width: visible ? 20 : 0
                height: 20
                radius: 5
                anchors.verticalCenter: parent.verticalCenter
                color: stopMouse.containsMouse ? Qt.rgba(0.97, 0.45, 0.45, 0.25)
                                               : Qt.rgba(0.97, 0.45, 0.45, 0.12)
                border.color: Qt.rgba(0.97, 0.45, 0.45, 0.5)
                Text {
                    anchors.centerIn: parent
                    text: "\uE71A"
                    font.family: "Segoe Fluent Icons"
                    font.pixelSize: 10
                    color: "#f87171"
                }
                MouseArea {
                    id: stopMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Starvis.cancelChat()
                }
                ToolTip.visible: stopMouse.containsMouse
                ToolTip.text: "Annuler la génération"
            }
        }

        Text {
            visible: !Starvis.configured
            width: parent.width
            text: "Clé OpenAI absente — configurez wp-starvis-openai-key."
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }

        // Transcript
        Flickable {
            width: parent.width
            height: Math.min(260, Math.max(60, transcriptColumn.height))
            contentHeight: transcriptColumn.height
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            onContentHeightChanged: contentY = Math.max(0, contentHeight - height)

            Column {
                id: transcriptColumn
                width: parent.width
                spacing: 6

                Repeater {
                    model: transcript

                    delegate: Rectangle {
                        required property string role
                        required property string text

                        width: transcriptColumn.width
                        height: bubble.implicitHeight + 14
                        radius: 8
                        color: role === "user" ? Qt.rgba(0.31, 0.56, 0.97, 0.12)
                                               : Qt.rgba(1, 1, 1, 0.05)
                        border.color: role === "user" ? Qt.rgba(0.31, 0.56, 0.97, 0.25)
                                                      : Theme.cardStroke

                        Text {
                            id: bubble
                            anchors.fill: parent
                            anchors.margins: 7
                            anchors.rightMargin: parent.role === "assistant" ? 26 : 7
                            text: parent.text
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeCaption
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            lineHeight: 1.25
                        }

                        Text {
                            visible: parent.role === "assistant"
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.margins: 6
                            text: Starvis.speaking ? "" : ""   // Stop / Volume
                            font.family: "Segoe Fluent Icons"
                            font.pixelSize: 11
                            color: speakMouse.containsMouse ? Theme.accent : Theme.textSecondary

                            MouseArea {
                                id: speakMouse
                                anchors.fill: parent
                                anchors.margins: -5
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: Starvis.speak(bubble.text)
                            }
                        }
                    }
                }

                Text {
                    visible: Starvis.busy
                    text: "Starvis réfléchit…"
                    color: Theme.textSecondary
                    font.pixelSize: 10
                    font.italic: true
                }
            }
        }

        // Pending agent actions (approval queue)
        Column {
            width: parent.width
            spacing: 5
            visible: Starvis.pendingActions.length > 0

            Row {
                width: parent.width
                spacing: 6
                Text {
                    text: "Actions proposées"
                    color: "#62e6ff"
                    font.pixelSize: 9
                    font.capitalization: Font.AllUppercase
                    font.letterSpacing: 1
                }
                Item { width: parent.width - x - execToggle.width; height: 1 }
                Text {
                    id: execToggle
                    text: Starvis.executionEnabled ? "exéc: ON" : "exéc: OFF"
                    color: Starvis.executionEnabled ? "#34d399" : Theme.textSecondary
                    font.pixelSize: 9
                    MouseArea {
                        anchors.fill: parent
                        anchors.margins: -4
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Starvis.executionEnabled = !Starvis.executionEnabled
                    }
                }
            }

            Repeater {
                model: Starvis.pendingActions
                delegate: Rectangle {
                    required property var modelData
                    width: parent.width
                    height: actionCol.implicitHeight + 12
                    radius: 6
                    color: Qt.rgba(1, 1, 1, 0.04)
                    border.color: modelData.verdict ? Qt.rgba(0.38, 0.9, 1, 0.3)
                                                    : Qt.rgba(0.97, 0.45, 0.45, 0.4)

                    Column {
                        id: actionCol
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 6
                        spacing: 3

                        Text {
                            width: parent.width
                            text: (modelData.actionType || "?") + " · " + (modelData.summary || "")
                            color: Theme.textPrimary
                            font.pixelSize: 10
                            wrapMode: Text.WordWrap
                            elide: Text.ElideRight
                            maximumLineCount: 2
                        }
                        Text {
                            width: parent.width
                            text: modelData.reason || ""
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            wrapMode: Text.WordWrap
                        }
                        Row {
                            spacing: 6
                            visible: modelData.verdict === true
                            Rectangle {
                                width: approveLabel.implicitWidth + 14; height: 18; radius: 4
                                color: apprMouse.containsMouse ? Qt.rgba(0.2, 0.83, 0.6, 0.3)
                                                               : Qt.rgba(0.2, 0.83, 0.6, 0.16)
                                border.color: "#34d399"
                                Text {
                                    id: approveLabel
                                    anchors.centerIn: parent
                                    text: modelData.confirmationArmed ? "Confirmer"
                                        : modelData.requiresSecondApproval ? "Approuver 1/2"
                                        : "Approuver"
                                    color: "#34d399"
                                    font.pixelSize: 9
                                }
                                MouseArea {
                                    id: apprMouse; anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: Starvis.approveAction(modelData.id)
                                }
                            }
                            Rectangle {
                                width: 50; height: 18; radius: 4
                                color: rejMouse.containsMouse ? Qt.rgba(0.97, 0.45, 0.45, 0.3)
                                                              : Qt.rgba(0.97, 0.45, 0.45, 0.14)
                                border.color: "#f87171"
                                Text { anchors.centerIn: parent; text: "Rejeter"; color: "#f87171"; font.pixelSize: 9 }
                                MouseArea {
                                    id: rejMouse; anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: Starvis.rejectAction(modelData.id)
                                }
                            }
                        }
                    }
                }
            }
        }

        Column {
            width: parent.width
            spacing: 4
            visible: card.agentMode && Starvis.recentActions.length > 0

            Text {
                text: "Activit\u00e9 r\u00e9cente"
                color: Theme.textSecondary
                font.pixelSize: 9
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1
            }

            Repeater {
                model: Math.min(3, Starvis.recentActions.length)
                delegate: Row {
                    required property int index
                    property var action: Starvis.recentActions[index]
                    width: parent.width
                    spacing: 6

                    Text {
                        width: 86
                        text: (parent.action.actionType || "?") + " \u00b7 "
                            + (parent.action.status || "")
                        color: parent.action.status === "failed" ? "#f87171"
                            : parent.action.status === "rejected" ? Theme.textSecondary
                            : "#34d399"
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                    Text {
                        width: Math.max(0, parent.width - x)
                        text: parent.action.result || parent.action.summary || ""
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                }
            }
        }

        Rectangle {
            visible: card.pendingInternetRequest !== ""
            width: parent.width
            height: permissionRow.implicitHeight + 14
            radius: 7
            color: Qt.rgba(0.31, 0.56, 0.97, 0.10)
            border.color: Qt.rgba(0.31, 0.56, 0.97, 0.32)

            Row {
                id: permissionRow
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 7
                spacing: 6

                Text {
                    width: Math.max(40, parent.width - allowOnce.width - denyOnce.width - 12)
                    text: "Acc\u00e8s Web requis pour cette demande"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    wrapMode: Text.WordWrap
                }
                Rectangle {
                    id: allowOnce
                    width: allowOnceLabel.implicitWidth + 14
                    height: 22
                    radius: 5
                    color: allowOnceMouse.containsMouse
                        ? Theme.activeFill : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                    border.color: Theme.accent
                    Text {
                        id: allowOnceLabel
                        anchors.centerIn: parent
                        text: "Une fois"
                        color: Theme.textPrimary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: allowOnceMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            const request = card.pendingInternetRequest
                            card.pendingInternetRequest = ""
                            card.send(request, true, false)
                        }
                    }
                }
                Rectangle {
                    id: denyOnce
                    width: denyOnceLabel.implicitWidth + 14
                    height: 22
                    radius: 5
                    color: denyOnceMouse.containsMouse ? Theme.hover : Theme.cardFill
                    border.color: Theme.cardStroke
                    Text {
                        id: denyOnceLabel
                        anchors.centerIn: parent
                        text: "Refuser"
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: denyOnceMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            card.pendingInternetRequest = ""
                            transcript.append({
                                role: "assistant",
                                text: "Compris. Je reste sur le contexte local."
                            })
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: card.pendingImageUrl !== ""
            width: parent.width
            height: visible ? 28 : 0
            radius: 6
            color: Qt.rgba(0.31, 0.56, 0.97, 0.10)
            border.color: Qt.rgba(0.31, 0.56, 0.97, 0.30)

            Text {
                anchors.left: parent.left
                anchors.right: clearImage.left
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: 8
                anchors.rightMargin: 6
                text: "Image · " + card.pendingImageName
                color: Theme.textSecondary
                font.pixelSize: 9
                elide: Text.ElideMiddle
            }
            Text {
                id: clearImage
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.rightMargin: 8
                text: "\uE711"
                font.family: "Segoe Fluent Icons"
                font.pixelSize: 9
                color: clearImageMouse.containsMouse ? Theme.accent : Theme.textSecondary
                MouseArea {
                    id: clearImageMouse
                    anchors.fill: parent
                    anchors.margins: -6
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        card.pendingImageUrl = ""
                        card.pendingImageName = ""
                    }
                }
            }
        }

        // Input and native image capture controls.
        Rectangle {
            id: inputShell
            width: parent.width
            height: 32
            radius: 7
            color: Qt.rgba(1, 1, 1, 0.05)
            border.color: input.activeFocus ? Qt.rgba(0.31, 0.56, 0.97, 0.5) : Theme.cardStroke

            TextInput {
                id: input
                anchors.left: parent.left
                anchors.right: attachButton.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.leftMargin: 8
                anchors.rightMargin: 4
                verticalAlignment: TextInput.AlignVCenter
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
                clip: true
                enabled: Starvis.configured && !Starvis.busy
                onAccepted: card.send(text, false, true)

                Text {
                    visible: input.text === "" && !input.activeFocus
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Demander à Starvis…"
                    color: Qt.rgba(1, 1, 1, 0.25)
                    font.pixelSize: Theme.fontSizeCaption
                }
            }

            Rectangle {
                id: attachButton
                anchors.right: screenButton.left
                anchors.verticalCenter: parent.verticalCenter
                width: 26; height: 26; radius: 5
                color: attachMouse.containsMouse ? Theme.hover : "transparent"
                Text {
                    anchors.centerIn: parent
                    text: "\uE723"
                    font.family: "Segoe Fluent Icons"
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }
                MouseArea {
                    id: attachMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: imageDialog.open()
                }
                ToolTip.visible: attachMouse.containsMouse
                ToolTip.text: "Joindre une image"
            }
            Rectangle {
                id: screenButton
                anchors.right: parent.right
                anchors.rightMargin: 3
                anchors.verticalCenter: parent.verticalCenter
                width: 26; height: 26; radius: 5
                color: screenMouse.containsMouse ? Theme.hover : "transparent"
                Text {
                    anchors.centerIn: parent
                    text: "\uE7C4"
                    font.family: "Segoe Fluent Icons"
                    font.pixelSize: 12
                    color: Theme.textSecondary
                }
                MouseArea {
                    id: screenMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        const source = Starvis.captureDesktop()
                        if (source === "") {
                            transcript.append({ role: "assistant",
                                                text: "Capture d'écran indisponible." })
                            return
                        }
                        card.pendingImageUrl = source
                        card.pendingImageName = "Capture d'écran"
                    }
                }
                ToolTip.visible: screenMouse.containsMouse
                ToolTip.text: "Capturer l'écran actif"
            }
        }
    }

    FileDialog {
        id: imageDialog
        title: "Joindre une image à Starvis"
        nameFilters: ["Images (*.png *.jpg *.jpeg *.webp *.bmp)", "Tous les fichiers (*)"]
        onAccepted: {
            const source = String(selectedFile)
            card.pendingImageUrl = source
            const parts = decodeURIComponent(source).split("/")
            card.pendingImageName = parts.length > 0 ? parts[parts.length - 1] : "Image"
        }
    }
}
