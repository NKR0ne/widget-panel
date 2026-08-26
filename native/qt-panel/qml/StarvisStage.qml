import QtQuick
import QtPanel.Native

// Full-stage Starvis workspace (mode id "starvis"): status rail | avatar
// centerpiece | chat column. Voice controls and sentry tiles are appended by
// their phases.
Item {
    id: stage

    property int rev: 0
    Connections {
        target: Starvis
        function onConfiguredChanged() { stage.rev++ }
    }
    readonly property var status: { rev; return Starvis.providerStatus() }
    readonly property var starvisState: Starvis.state

    readonly property real railWidth: Math.max(230, width * 0.20)
    readonly property real chatWidth: Math.max(320, width * 0.30)


    // ── Left: status rail ────────────────────────────────────────────────────
    Flickable {
        id: statusRail
        width: stage.railWidth
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        contentHeight: railColumn.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: railColumn
            width: statusRail.width
            spacing: 10

            Text {
                text: "Starvis"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeTitle
                font.weight: Font.DemiBold
            }

            GlassCard {
                width: parent.width
                title: "Modèle"
                implicitHeight: modelColumn.implicitHeight + 46
                Column {
                    id: modelColumn
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 12
                    anchors.topMargin: 34
                    spacing: 4

                    Text {
                        width: parent.width
                        text: stage.status.model || "—"
                        color: Theme.textPrimary
                        font.pixelSize: 12
                        font.weight: Font.DemiBold
                        elide: Text.ElideMiddle
                    }
                    Text {
                        width: parent.width
                        text: stage.status.provider === "local"
                              ? (stage.status.ready ? "Local · CUDA · prêt" : "Local · démarrage…")
                              : stage.status.provider === "anthropic"
                                ? (stage.status.pinned ? "Anthropic · épinglé" : "Anthropic · auto")
                                : "OpenAI"
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        wrapMode: Text.WordWrap
                    }
                    Text {
                        width: parent.width
                        visible: stage.starvisState !== null
                        text: {
                            const s = stage.starvisState
                            if (!s || (s.sessionInputTokens === 0 && s.sessionOutputTokens === 0))
                                return "Session: aucune utilisation"
                            return "Session: " + s.sessionInputTokens + " in / "
                                   + s.sessionOutputTokens + " out · ~$"
                                   + s.sessionCostUsd.toFixed(3)
                        }
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        wrapMode: Text.WordWrap
                    }
                    Rectangle {
                        width: refreshLabel.implicitWidth + 14
                        height: 22
                        radius: 6
                        color: refreshMouse.containsMouse ? Theme.hover : Theme.cardFill
                        border.color: Theme.cardStroke
                        Text {
                            id: refreshLabel
                            anchors.centerIn: parent
                            text: "Résoudre le modèle"
                            color: Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: refreshMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: Starvis.refreshModel()
                        }
                    }
                }
            }

            // Voice card (functional once VoiceSession lands; see Loader below).
            Loader {
                id: voiceLoader
                width: parent.width
                source: "StarvisVoicePanel.qml"
                onStatusChanged: if (status === Loader.Error) active = false
            }

            // Sentry events (functional once SentryService lands).
            Loader {
                id: sentryLoader
                width: parent.width
                source: "StarvisSentryPanel.qml"
                onStatusChanged: if (status === Loader.Error) active = false
            }
        }
    }

    // ── Center: avatar above the Vision section ──────────────────────────────
    Item {
        id: centerColumn
        anchors.left: statusRail.right
        anchors.right: chatColumn.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.leftMargin: 12
        anchors.rightMargin: 12

        StarvisAvatar {
            id: avatar
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            width: Math.min(parent.width, visionSection.y) * 0.78
            height: width
        }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: avatar.bottom
            anchors.topMargin: 2
            text: {
                const s = stage.starvisState ? stage.starvisState.state : "idle"
                if (s === "reasoning") return "Réflexion en cours…"
                if (s === "listening") return "À l'écoute"
                if (s === "speaking") return "Parole"
                if (s === "analyzing") return "Analyse caméra"
                if (s === "alert") return "ALERTE"
                return "En veille"
            }
            color: Theme.textSecondary
            font.pixelSize: 11
            font.letterSpacing: 2
        }

        // What Starvis sees, and what it did about it.
        StarvisVisionPanel {
            id: visionSection
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: Math.max(260, parent.height * 0.48)
        }
    }

    // ── Right: chat (the compact card, full height) ──────────────────────────
    Flickable {
        id: chatColumn
        width: stage.chatWidth
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        contentHeight: chatCard.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        StarvisWidget {
            id: chatCard
            width: chatColumn.width
        }
    }
}
