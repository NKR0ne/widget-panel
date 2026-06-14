import QtQuick
import QtPanel.Native

// Starvis chat card: transcript + input against the OpenAI Responses API,
// with the local context bus injected service-side.
GlassCard {
    id: card
    title: "Starvis"
    implicitHeight: body.implicitHeight + 24

    ListModel { id: transcript }
    property bool agentMode: false

    function send(text) {
        const message = text.trim()
        if (message === "" || Starvis.busy)
            return
        const history = []
        for (let i = 0; i < transcript.count; i++) {
            const turn = transcript.get(i)
            history.push({ role: turn.role, text: turn.text })
        }
        transcript.append({ role: "user", text: message })
        input.text = ""
        // Agent mode enables the tool loop + web search.
        Starvis.chat(message, history, card.agentMode, card.agentMode)
    }

    Connections {
        target: Starvis
        function onReplyReceived(text, model, latencyMs) {
            transcript.append({ role: "assistant", text: text })
        }
        function onChatFailed(error) {
            transcript.append({ role: "assistant", text: "⚠ " + error })
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
            Item { width: parent.width - x - agentBtn.width - briefingBtn.width - 6; height: 1 }
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
                                width: 58; height: 18; radius: 4
                                color: apprMouse.containsMouse ? Qt.rgba(0.2, 0.83, 0.6, 0.3)
                                                               : Qt.rgba(0.2, 0.83, 0.6, 0.16)
                                border.color: "#34d399"
                                Text { anchors.centerIn: parent; text: "Approuver"; color: "#34d399"; font.pixelSize: 9 }
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

        // Input
        Rectangle {
            width: parent.width
            height: 30
            radius: 7
            color: Qt.rgba(1, 1, 1, 0.05)
            border.color: input.activeFocus ? Qt.rgba(0.31, 0.56, 0.97, 0.5) : Theme.cardStroke

            TextInput {
                id: input
                anchors.fill: parent
                anchors.margins: 8
                verticalAlignment: TextInput.AlignVCenter
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
                clip: true
                enabled: Starvis.configured && !Starvis.busy
                onAccepted: card.send(text)

                Text {
                    visible: input.text === "" && !input.activeFocus
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Demander à Starvis…"
                    color: Qt.rgba(1, 1, 1, 0.25)
                    font.pixelSize: Theme.fontSizeCaption
                }
            }
        }
    }
}
