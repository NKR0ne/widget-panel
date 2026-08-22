import QtQuick
import QtPanel.Native

// Sentry: per-camera arming, presence state, and the last detected events with
// their snapshots (image://starvis/event/<id>).
GlassCard {
    id: card
    title: "Sentinelle"
    implicitHeight: sentryBody.implicitHeight + 46

    Column {
        id: sentryBody
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        anchors.topMargin: 34
        spacing: 8

        Text {
            width: parent.width
            text: "Présence: " + (Sentry.presence === "absent" ? "absent"
                                : Sentry.presence === "present" ? "détecté"
                                : "accueilli")
            color: Theme.textSecondary
            font.pixelSize: 10
        }
        Text {
            id: scopeStatus
            width: parent.width
            property int rev: 0
            Connections {
                target: Sentry
                function onConfigChanged() { scopeStatus.rev++ }
            }
            text: {
                scopeStatus.rev
                return (Sentry.eventScope() === "intrusion"
                        ? "Alertes : intrusions du périmètre"
                        : "Alertes : tout mouvement")
                       + " · " + Sentry.eventSourceStatus()
            }
            color: Theme.textSecondary
            font.pixelSize: 9
            wrapMode: Text.WordWrap
        }

        Repeater {
            model: [
                { id: "webcam", label: "Webcam (présence)" },
                { id: "direct", label: "Caméra directe" },
                { id: "xprotect", label: "XProtect" },
            ]
            delegate: Row {
                required property var modelData
                width: sentryBody.width
                spacing: 6
                Text {
                    width: parent.width - armSwitch.width - 6
                    text: modelData.label
                          + (modelData.id === "webcam" && !Sentry.webcamAvailable
                             ? " — absente" : "")
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                    anchors.verticalCenter: parent.verticalCenter
                }
                Rectangle {
                    id: armSwitch
                    property int rev: 0
                    Connections {
                        target: Sentry
                        function onConfigChanged() { armSwitch.rev++ }
                    }
                    readonly property bool armed: { rev; return Sentry.cameraArmed(parent.modelData.id) }
                    width: 30; height: 16; radius: 8
                    anchors.verticalCenter: parent.verticalCenter
                    color: armed ? Theme.accent : Qt.rgba(1, 1, 1, 0.12)
                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                    Rectangle {
                        width: 12; height: 12; radius: 6; y: 2
                        x: armSwitch.armed ? parent.width - width - 2 : 2
                        color: "#fff"
                        Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Sentry.setCameraArmed(armSwitch.parent.modelData.id,
                                                         !armSwitch.armed)
                    }
                }
            }
        }

        Text {
            width: parent.width
            visible: Sentry.events.length === 0
            text: "Aucun événement détecté."
            color: Theme.textSecondary
            font.pixelSize: 9
            topPadding: 4
        }

        // Known people: naming one teaches Starvis to announce them by name.
        Column {
            width: parent.width
            spacing: 3
            visible: peopleRepeater.count > 0
            Text {
                text: "PERSONNES CONNUES"
                color: Theme.textSecondary
                font.pixelSize: 8
                font.letterSpacing: 1
                topPadding: 4
            }
            Repeater {
                id: peopleRepeater
                model: { peopleRev; return Sentry.knownPeople() }
                property int peopleRev: 0
                Connections {
                    target: Sentry
                    function onPeopleChanged() { peopleRepeater.peopleRev++ }
                }
                delegate: Row {
                    id: personRow
                    required property var modelData
                    width: sentryBody.width
                    height: 22
                    spacing: 6
                    Rectangle {
                        width: 30; height: 20; radius: 3
                        color: Qt.rgba(1, 1, 1, 0.05)
                        clip: true
                        anchors.verticalCenter: parent.verticalCenter
                        Image {
                            anchors.fill: parent
                            source: "file:///" + personRow.modelData.file
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                        }
                    }
                    Text {
                        width: parent.width - forgetButton.width - 42
                        text: personRow.modelData.name
                        color: Theme.textPrimary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Rectangle {
                        id: forgetButton
                        width: forgetLabel.implicitWidth + 10
                        height: 16
                        radius: 4
                        color: forgetMouse.containsMouse ? Qt.rgba(0.97, 0.45, 0.45, 0.22)
                                                         : "transparent"
                        border.color: Theme.cardStroke
                        anchors.verticalCenter: parent.verticalCenter
                        Text {
                            id: forgetLabel
                            anchors.centerIn: parent
                            text: "Oublier"
                            color: Theme.textSecondary
                            font.pixelSize: 8
                        }
                        MouseArea {
                            id: forgetMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: Sentry.forgetPerson(personRow.modelData.id)
                        }
                    }
                }
            }
        }

        Repeater {
            model: Sentry.events
            delegate: Row {
                required property var modelData
                width: sentryBody.width
                height: modelData.person ? 62 : 44
                spacing: 6

                Rectangle {
                    width: 64; height: 40; radius: 4
                    color: Qt.rgba(1, 1, 1, 0.05)
                    clip: true
                    Image {
                        anchors.fill: parent
                        visible: source !== ""
                        source: modelData.image || ""
                        fillMode: Image.PreserveAspectCrop
                        asynchronous: true
                        cache: false
                    }
                    Text {
                        anchors.centerIn: parent
                        visible: !modelData.image
                        text: "—"
                        color: Theme.textSecondary
                        font.pixelSize: 10
                    }
                }
                Column {
                    width: parent.width - 70
                    spacing: 2
                    Text {
                        width: parent.width
                        text: modelData.at + " · " + modelData.cameraId
                        color: modelData.threat === "alert" ? "#ff8080"
                             : modelData.threat === "notice" ? "#ffc266"
                             : Theme.textSecondary
                        font.pixelSize: 8
                    }
                    Text {
                        width: parent.width
                        text: modelData.description
                        color: Theme.textPrimary
                        font.pixelSize: 9
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        wrapMode: Text.WordWrap
                    }

                    // Naming the person here stores this very snapshot as the
                    // reference Starvis compares future events against.
                    Row {
                        width: parent.width
                        height: 18
                        spacing: 4
                        visible: modelData.person === true && modelData.image !== ""

                        Rectangle {
                            width: parent.width - saveName.width - 4
                            height: 18
                            radius: 4
                            color: Qt.rgba(1, 1, 1, 0.05)
                            border.color: nameField.activeFocus ? Theme.accent : Theme.cardStroke
                            TextInput {
                                id: nameField
                                anchors.fill: parent
                                anchors.margins: 4
                                verticalAlignment: TextInput.AlignVCenter
                                color: Theme.textPrimary
                                font.pixelSize: 8
                                clip: true
                                onAccepted: saveMouse.commit()
                                Text {
                                    visible: nameField.text === "" && !nameField.activeFocus
                                    text: "Nommer cette personne…"
                                    color: Qt.rgba(1, 1, 1, 0.28)
                                    font.pixelSize: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                            }
                        }
                        Rectangle {
                            id: saveName
                            width: saveLabel.implicitWidth + 12
                            height: 18
                            radius: 4
                            color: saveMouse.containsMouse ? Theme.hover : Theme.cardFill
                            border.color: Theme.cardStroke
                            Text {
                                id: saveLabel
                                anchors.centerIn: parent
                                text: "Retenir"
                                color: Theme.textSecondary
                                font.pixelSize: 8
                            }
                            MouseArea {
                                id: saveMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                function commit() {
                                    const label = nameField.text.trim()
                                    if (label === "")
                                        return
                                    if (Sentry.namePerson(modelData.id, label)) {
                                        Ui.notify(label + " sera reconnu", "success")
                                        nameField.text = ""
                                    } else {
                                        Ui.notify("Image de référence indisponible", "warning")
                                    }
                                }
                                onClicked: commit()
                            }
                        }
                    }
                }
            }
        }
    }
}
