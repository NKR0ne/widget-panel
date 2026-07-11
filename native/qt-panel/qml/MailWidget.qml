import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Outlook Mail"
    implicitHeight: 420

    component ActionButton: Rectangle {
        id: actionButton
        property string glyph: ""
        property string hint: ""
        signal clicked()
        width: 22
        height: 22
        radius: 5
        color: actionMouse.containsMouse ? Theme.hover : "transparent"

        Text {
            anchors.centerIn: parent
            text: actionButton.glyph
            color: actionMouse.containsMouse ? Theme.textPrimary : Theme.textSecondary
            font.pixelSize: 12
        }
        Rectangle {
            visible: actionMouse.containsMouse
            anchors.bottom: parent.top
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottomMargin: 3
            width: hintLabel.implicitWidth + 10
            height: 18
            radius: 4
            color: "#111827"
            border.color: Theme.cardStroke
            z: 5
            Text {
                id: hintLabel
                anchors.centerIn: parent
                text: actionButton.hint
                color: Theme.textPrimary
                font.pixelSize: 8
            }
        }
        MouseArea {
            id: actionMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: actionButton.clicked()
        }
    }

    Column {
        id: headerArea
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

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
                visible: MsGraph.unreadCount > 0
                width: unreadLabel.implicitWidth + 10
                height: 15
                radius: 7
                color: "#0078d4"
                anchors.verticalCenter: parent.verticalCenter
                Text {
                    id: unreadLabel
                    anchors.centerIn: parent
                    text: MsGraph.unreadCount
                    color: "#ffffff"
                    font.pixelSize: 9
                    font.weight: Font.DemiBold
                }
            }
            Item {
                width: Math.max(0, parent.width - x - signOut.width)
                height: 1
            }
            Rectangle {
                id: signOut
                visible: MsGraph.authState === "ok"
                width: signOutLabel.implicitWidth + 12
                height: 19
                radius: 5
                color: signOutMouse.containsMouse ? Theme.hover : "transparent"
                border.color: Theme.cardStroke
                Text {
                    id: signOutLabel
                    anchors.centerIn: parent
                    text: "Sortir"
                    color: Theme.textSecondary
                    font.pixelSize: 8
                }
                MouseArea {
                    id: signOutMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: MsGraph.signOut()
                }
            }
        }

        MsStatePane { width: parent.width }
    }

    Flickable {
        id: mailFlick
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: headerArea.bottom
        anchors.bottom: parent.bottom
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        anchors.topMargin: 6
        anchors.bottomMargin: 12
        contentHeight: mailColumn.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        visible: MsGraph.authState === "ok"

        Column {
            id: mailColumn
            width: mailFlick.width

            Text {
                visible: MsGraph.mailMessages.length === 0
                width: parent.width
                text: "Aucun message"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                horizontalAlignment: Text.AlignHCenter
                topPadding: 10
            }

            Repeater {
                model: MsGraph.mailMessages
                delegate: Item {
                    id: messageRow
                    required property var modelData
                    width: mailColumn.width
                    height: 58

                    Rectangle {
                        anchors.fill: parent
                        radius: 6
                        color: rowMouse.containsMouse ? Theme.hover : "transparent"
                    }
                    Rectangle {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        height: 1
                        color: Qt.rgba(1, 1, 1, 0.04)
                    }
                    Rectangle {
                        width: 6
                        height: 6
                        radius: 3
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.topMargin: 10
                        color: messageRow.modelData.isRead
                            ? (messageRow.modelData.important ? "#f74f7e" : "transparent")
                            : "#0078d4"
                    }

                    Column {
                        anchors.left: parent.left
                        anchors.leftMargin: 13
                        anchors.right: actionRow.left
                        anchors.rightMargin: 4
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2

                        Row {
                            width: parent.width
                            spacing: 6
                            Text {
                                width: parent.width - receivedLabel.implicitWidth - 6
                                text: messageRow.modelData.from || "Inconnu"
                                color: Theme.textPrimary
                                font.pixelSize: 10
                                font.weight: messageRow.modelData.isRead
                                    ? Font.Normal : Font.DemiBold
                                elide: Text.ElideRight
                            }
                            Text {
                                id: receivedLabel
                                text: messageRow.modelData.time
                                color: Theme.textSecondary
                                font.family: "Consolas"
                                font.pixelSize: 8
                            }
                        }
                        Text {
                            width: parent.width
                            text: messageRow.modelData.subject || "(Sans objet)"
                            color: messageRow.modelData.isRead
                                ? Theme.textSecondary : Theme.textPrimary
                            font.pixelSize: 10
                            font.weight: messageRow.modelData.isRead
                                ? Font.Normal : Font.Medium
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: messageRow.modelData.preview
                            color: Qt.rgba(0.82, 0.82, 0.90, 0.58)
                            font.pixelSize: 9
                            elide: Text.ElideRight
                        }
                    }

                    Row {
                        id: actionRow
                        z: 2
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 0

                        ActionButton {
                            visible: !messageRow.modelData.isRead
                            glyph: "\u2713"
                            hint: "Marquer comme lu"
                            onClicked: MsGraph.markMailRead(messageRow.modelData.id)
                        }
                        ActionButton {
                            glyph: "\u00d7"
                            hint: "Supprimer"
                            onClicked: MsGraph.moveMail(
                                messageRow.modelData.id, "deleteditems")
                        }
                        ActionButton {
                            glyph: "!"
                            hint: "Ind\u00e9sirable"
                            onClicked: MsGraph.moveMail(
                                messageRow.modelData.id, "junkemail")
                        }
                    }

                    MouseArea {
                        id: rowMouse
                        z: 1
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (!messageRow.modelData.isRead)
                                MsGraph.markMailRead(messageRow.modelData.id)
                            if (messageRow.modelData.webLink)
                                Panel.openIsland(messageRow.modelData.webLink)
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: mailFlick.contentHeight > mailFlick.height
            width: 2
            radius: 1
            anchors.right: parent.right
            height: Math.max(18, mailFlick.height * mailFlick.height
                / Math.max(1, mailFlick.contentHeight))
            y: mailFlick.contentY / Math.max(1,
                mailFlick.contentHeight - mailFlick.height)
                * Math.max(0, mailFlick.height - height)
            color: Qt.rgba(1, 1, 1, 0.22)
        }
    }
}
