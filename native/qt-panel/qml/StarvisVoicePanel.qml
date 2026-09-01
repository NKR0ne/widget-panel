import QtQuick
import QtPanel.Native

// Realtime voice session controls. The session never auto-connects: it is
// started here and closes itself on idle / session cap (cost guard).
GlassCard {
    id: card
    title: "Voix"
    implicitHeight: voiceBody.implicitHeight + 46

    readonly property var voice: Starvis.voice
    readonly property bool live: voice && voice.status === "live"
    readonly property bool connecting: voice && voice.status === "connecting"
    readonly property bool pushToTalk: voice && voice.pushToTalk

    Column {
        id: voiceBody
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        anchors.topMargin: 34
        spacing: 8

        Text {
            width: parent.width
            text: {
                if (!card.voice)
                    return "Service vocal indisponible."
                if (!card.voice.available)
                    return card.voice.unavailableReason
                if (card.connecting)
                    return "Connexion…"
                if (card.live) {
                    const labels = {
                        hearing: "Écoute",
                        transcribing: "Transcription",
                        reasoning: "Réflexion",
                        speaking: "Réponse",
                        listening: "En écoute",
                        ready: "Prêt à parler"
                    }
                    const phase = labels[card.voice.phase] || "En session"
                    return phase + " · " + Math.floor(card.voice.elapsedSec / 60)
                           + "m " + (card.voice.elapsedSec % 60) + "s"
                }
                return "Prêt — " + (card.voice.provider === "local"
                       ? "Qwen local, privé et sans frais."
                       : card.voice.provider === "groq"
                         ? "Groq pour la transcription."
                         : "dialogue OpenAI temps réel.")
            }
            color: card.live ? Theme.textPrimary : Theme.textSecondary
            font.pixelSize: 10
            wrapMode: Text.WordWrap
        }

        // Live mic / output level.
        Rectangle {
            width: parent.width
            height: 4
            radius: 2
            visible: card.live && (!card.pushToTalk || card.voice.pushToTalkHeld)
            color: Qt.rgba(1, 1, 1, 0.08)
            Rectangle {
                width: parent.width * Math.min(1, (Starvis.state
                        ? Starvis.state.audioLevel : 0) * 2.5)
                height: parent.height
                radius: 2
                color: Theme.accent
                Behavior on width { NumberAnimation { duration: 90 } }
            }
        }

        Flow {
            width: parent.width
            height: childrenRect.height
            spacing: 6

            Rectangle {
                width: startLabel.implicitWidth + 18
                height: 24
                radius: 6
                enabled: card.voice && card.voice.available
                         && (!card.pushToTalk || !card.live
                             || card.voice.phase === "ready"
                             || card.voice.phase === "listening"
                             || card.voice.phase === "hearing")
                opacity: enabled ? 1 : 0.4
                color: card.pushToTalk && card.voice && card.voice.pushToTalkHeld
                       ? Qt.rgba(0.97, 0.45, 0.45, startMouse.containsMouse ? 0.34 : 0.22)
                       : Qt.rgba(0.31, 0.56, 0.97, startMouse.containsMouse ? 0.32 : 0.15)
                border.color: card.pushToTalk && card.voice && card.voice.pushToTalkHeld
                              ? Qt.rgba(0.97, 0.45, 0.45, 0.50)
                              : Qt.rgba(0.31, 0.56, 0.97, 0.45)
                Text {
                    id: startLabel
                    anchors.centerIn: parent
                    text: card.pushToTalk
                          ? (card.voice && card.voice.pushToTalkHeld
                             ? "Relâcher pour envoyer" : "Maintenir pour parler")
                          : (card.live || card.connecting ? "Terminer" : "Parler")
                    color: Theme.textPrimary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: startMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: parent.enabled
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onPressed: {
                        if (card.pushToTalk)
                            card.voice.beginPushToTalk()
                    }
                    onReleased: {
                        if (card.pushToTalk)
                            card.voice.endPushToTalk()
                    }
                    onCanceled: {
                        if (card.pushToTalk)
                            card.voice.endPushToTalk()
                    }
                    onClicked: {
                        if (card.pushToTalk)
                            return
                        if (card.live || card.connecting)
                            card.voice.stop()
                        else
                            card.voice.start()
                    }
                }
            }

            Rectangle {
                width: endLabel.implicitWidth + 18
                height: 24
                radius: 6
                visible: card.pushToTalk && (card.live || card.connecting)
                color: endMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text {
                    id: endLabel
                    anchors.centerIn: parent
                    text: "Terminer"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: endMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.voice.stop()
                }
            }

            Rectangle {
                width: muteLabel.implicitWidth + 18
                height: 24
                radius: 6
                visible: card.live
                color: card.voice && card.voice.muted ? Theme.activeFill
                     : muteMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: card.voice && card.voice.muted ? Theme.accent : Theme.cardStroke
                Text {
                    id: muteLabel
                    anchors.centerIn: parent
                    text: card.voice && card.voice.muted ? "Micro coupé" : "Couper micro"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: muteMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.voice.muted = !card.voice.muted
                }
            }

            Rectangle {
                width: stopSpeechLabel.implicitWidth + 18
                height: 24
                visible: Starvis.speaking || Starvis.speechPending
                radius: 6
                color: stopSpeechMouse.containsMouse
                       ? Qt.rgba(0.97, 0.45, 0.45, 0.28)
                       : Qt.rgba(0.97, 0.45, 0.45, 0.14)
                border.color: Qt.rgba(0.97, 0.45, 0.45, 0.45)
                Text {
                    id: stopSpeechLabel
                    anchors.centerIn: parent
                    text: "Arrêter la voix"
                    color: Theme.textPrimary
                    font.pixelSize: 9
                }
                MouseArea {
                    id: stopSpeechMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Starvis.stopSpeaking()
                }
            }
        }
    }
}
