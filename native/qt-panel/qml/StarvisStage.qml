import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtPanel.Native

Item {
    id: stage
    property int rev: 0
    Connections {
        target: Starvis
        function onConfiguredChanged() { stage.rev++ }
        function onLocalModelsStateChanged() { stage.rev++ }
    }
    readonly property var status: { rev; return Starvis.providerStatus() }
    readonly property var starvisState: Starvis.state
    readonly property bool compact: width < 900
    readonly property string stateLabel: {
        const names = { idle: "En veille", listening: "À l'écoute", reasoning: "Réflexion",
                        speaking: "Parole", analyzing: "Analyse caméra", alert: "Alerte" }
        return names[starvisState ? starvisState.state : "idle"] || "En veille"
    }
    property var metrics: []
    function sampleVisuals() {
        const s = starvisState
        metrics = [
            { label: "Débit estimé", value: (s ? s.tokensPerSec : 0).toFixed(1) + " tok/s",
              effect: "Intensité de la réflexion" },
            { label: "Niveau audio", value: Math.round((s ? s.audioLevel : 0) * 100) + " %",
              effect: "Amplitude en écoute / parole" }
        ].concat(avatar.visualMetrics).concat([
            { label: "Animation", value: Panel.panelVisible && Motion.decorativeEnabled ? "Active" : "En pause",
              effect: "Visibilité et préférence de mouvement" },
            { label: "Alerte", value: s && s.state === "alert" ? "2 Hz" : "Inactive",
              effect: "Clignotement prioritaire" }
        ])
    }
    Timer {
        interval: 250
        running: stage.visible && Panel.panelVisible
        repeat: true
        triggeredOnStart: true
        onTriggered: stage.sampleVisuals()
    }

    Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: workspace.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        ScrollBar.vertical: ScrollBar { policy: stage.compact ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff }

        GridLayout {
            id: workspace
            width: parent.width
            height: stage.compact ? implicitHeight : stage.height
            columns: stage.compact ? 1 : 3
            columnSpacing: 16
            rowSpacing: 20

            Flickable {
                id: statusRail
                Layout.preferredWidth: stage.compact ? workspace.width : Math.max(220, workspace.width * 0.23)
                Layout.fillWidth: stage.compact
                Layout.fillHeight: !stage.compact
                Layout.preferredHeight: stage.compact ? Math.min(540, railColumn.height) : stage.height
                Layout.minimumWidth: 0
                contentHeight: railColumn.height
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
                Column {
                    id: railColumn
                    width: Math.max(0, statusRail.width - 12)
                    spacing: 12
                    Text {
                        text: "Starvis · État des services"
                        width: parent.width
                        wrapMode: Text.WordWrap
                        color: Theme.textPrimary
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: !stage.status.localModelsEnabled ? "Modèles locaux désactivés"
                            : stage.status.localModelsTransitioning ? "Mise à jour des services…"
                            : "Modèles et fournisseurs"
                        color: Theme.textSecondary
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                    }
                    Repeater {
                        model: stage.status.services || []
                        delegate: Rectangle {
                            id: serviceRow
                            required property var modelData
                            width: railColumn.width
                            height: serviceBody.implicitHeight + 24
                            radius: 6
                            color: Theme.cardFill
                            border.color: Theme.cardStroke
                            Column {
                                id: serviceBody
                                x: 12; y: 12
                                width: parent.width - 24
                                spacing: 6
                                RowLayout {
                                    width: parent.width
                                    Text {
                                        Layout.fillWidth: true
                                        text: serviceRow.modelData.label
                                        color: Theme.textSecondary
                                        font.pixelSize: 11
                                        elide: Text.ElideRight
                                    }
                                    Rectangle {
                                        Layout.preferredWidth: 6
                                        Layout.preferredHeight: 6
                                        radius: 3
                                        color: serviceRow.modelData.ready ? "#55d9ae" : "#e9ae60"
                                    }
                                }
                                Text {
                                    width: parent.width
                                    text: serviceRow.modelData.model || "Modèle non confirmé"
                                    color: Theme.textPrimary
                                    font.pixelSize: 12
                                    font.weight: Font.DemiBold
                                    wrapMode: Text.WrapAnywhere
                                }
                                Text {
                                    width: parent.width
                                    text: serviceRow.modelData.backend + " · "
                                        + (!serviceRow.modelData.ready ? "Indisponible"
                                           : serviceRow.modelData.confirmed ? "Chargé · confirmé"
                                           : "Configuré / prêt")
                                    color: serviceRow.modelData.ready ? "#80dfc1" : "#efbc80"
                                    font.pixelSize: 10
                                    wrapMode: Text.WordWrap
                                }
                                Text {
                                    width: parent.width
                                    text: serviceRow.modelData.detail
                                    color: Theme.textSecondary
                                    font.pixelSize: 10
                                    wrapMode: Text.WordWrap
                                }
                            }
                        }
                    }
                    Rectangle { width: parent.width; height: 1; color: Theme.cardStroke }
                    Text {
                        text: "Session"
                        color: Theme.textPrimary
                        font.pixelSize: 12
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: {
                            const s = stage.starvisState
                            return s ? s.sessionInputTokens + " jetons entrants · " + s.sessionOutputTokens
                                + " sortants\nCoût estimé : $" + s.sessionCostUsd.toFixed(3) : "Aucune utilisation"
                        }
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                        font.pixelSize: 11
                    }
                    Text {
                        width: parent.width
                        text: "Présence : " + (Sentry.presence === "absent" ? "absente"
                            : Sentry.presence === "present" ? "détectée" : "accueillie")
                        color: Theme.textPrimary
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                    }
                    Text {
                        width: parent.width
                        text: stage.starvisState && stage.starvisState.lastAlert.text
                            ? stage.starvisState.lastAlert.text : "Aucune alerte récente"
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                        font.pixelSize: 11
                    }
                }
            }

            Flickable {
                id: center
                Layout.fillWidth: true
                Layout.fillHeight: !stage.compact
                Layout.minimumWidth: 0
                Layout.preferredHeight: stage.compact ? 900 : stage.height
                contentHeight: centerBody.height
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
                Column {
                    id: centerBody
                    width: Math.max(0, center.width - 12)
                    spacing: 10
                    StarvisAvatar {
                        id: avatar
                        width: Math.min(parent.width, 330)
                        height: width
                        anchors.horizontalCenter: parent.horizontalCenter
                    }
                    Text {
                        width: parent.width
                        text: stage.stateLabel
                        horizontalAlignment: Text.AlignHCenter
                        color: Theme.textPrimary
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    RowLayout {
                        width: parent.width
                        Text {
                            Layout.fillWidth: true
                            text: "Dynamique visuelle"
                            color: Theme.textPrimary
                            font.pixelSize: 12
                        }
                        Text {
                            text: avatar.activeRenderer
                            color: Theme.textSecondary
                            font.pixelSize: 10
                        }
                    }
                    Grid {
                        id: metricGrid
                        width: parent.width
                        columns: width >= 440 ? 2 : 1
                        columnSpacing: 18
                        rowSpacing: 10
                        Repeater {
                          model: stage.metrics
                          delegate: Column {
                            required property var modelData
                            width: (metricGrid.width - metricGrid.columnSpacing * (metricGrid.columns - 1)) / metricGrid.columns
                            spacing: 2
                            RowLayout {
                                width: parent.width
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.label
                                    color: Theme.textSecondary
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                }
                                Text {
                                    text: modelData.value
                                    color: Theme.textPrimary
                                    font.pixelSize: 11
                                    font.family: "Consolas"
                                }
                            }
                            Text {
                                width: parent.width
                                text: modelData.effect
                                color: Theme.textSecondary
                                font.pixelSize: 10
                                wrapMode: Text.WordWrap
                            }
                          }
                        }
                    }
                    StarvisVisionPanel {
                        width: parent.width
                        height: Math.max(300, center.height - y)
                    }
                }
            }

            Flickable {
                id: interactionRail
                Layout.preferredWidth: stage.compact ? workspace.width : Math.max(340, workspace.width * 0.34)
                Layout.fillWidth: stage.compact
                Layout.fillHeight: !stage.compact
                Layout.minimumWidth: 0
                Layout.preferredHeight: stage.compact ? 700 : stage.height
                contentHeight: interactionBody.height
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
                Column {
                    id: interactionBody
                    width: Math.max(0, interactionRail.width - 12)
                    spacing: 12
                    Text {
                        text: "Interaction"
                        color: Theme.textPrimary
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    StarvisVoicePanel { width: parent.width }
                    StarvisWidget {
                        width: parent.width
                        transcriptMinimumHeight: 180
                        transcriptMaximumHeight: Math.max(260, interactionRail.height * 0.45)
                    }
                    StarvisSentryPanel { width: parent.width }
                }
            }
        }
    }
}
