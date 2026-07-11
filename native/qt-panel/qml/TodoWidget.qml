import QtQuick
import QtQuick.Controls.Basic
import QtPanel.Native

GlassCard {
    id: card
    title: "Microsoft To-Do"
    implicitHeight: body.implicitHeight + 24

    function submitTask() {
        const title = newTask.text.trim()
        if (title === "" || MsGraph.authState !== "ok"
                || MsGraph.selectedTodoListId === "")
            return
        MsGraph.addTodoTask(title)
        newTask.clear()
        SoundFx.tap()
    }

    Column {
        id: body
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

        Flow {
            width: parent.width
            spacing: 4
            visible: MsGraph.authState === "ok" && MsGraph.todoLists.length > 1

            Repeater {
                model: MsGraph.todoLists
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    readonly property bool selected:
                        MsGraph.selectedTodoListId === modelData.id
                        || (MsGraph.selectedTodoListId === "" && index === 0)
                    height: 18
                    width: listName.implicitWidth + 14
                    radius: 5
                    color: selected ? Theme.activeFill : "transparent"
                    border.color: selected ? Theme.accent : Theme.cardStroke
                    Text {
                        id: listName
                        anchors.centerIn: parent
                        text: modelData.name
                        color: parent.selected ? Theme.textPrimary : Theme.textSecondary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: MsGraph.setTodoList(parent.modelData.id)
                    }
                }
            }
        }

        Text {
            visible: MsGraph.authState === "ok" && MsGraph.todoTasks.length === 0
            width: parent.width
            text: "Aucune t\u00e2che en cours \u2713"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            horizontalAlignment: Text.AlignHCenter
            topPadding: 8
        }

        Repeater {
            model: MsGraph.todoTasks
            delegate: Item {
                id: taskRow
                required property var modelData
                width: body.width
                height: Math.max(34, taskText.implicitHeight + 12)

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 1
                    color: Qt.rgba(1, 1, 1, 0.04)
                }
                Rectangle {
                    id: check
                    width: 16
                    height: 16
                    radius: 8
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    color: checkMouse.containsMouse
                        ? Qt.rgba(0.15, 0.39, 0.81, 0.18) : "transparent"
                    border.color: checkMouse.containsMouse ? "#2564cf" : Theme.textSecondary
                    border.width: 1.2

                    MouseArea {
                        id: checkMouse
                        anchors.fill: parent
                        anchors.margins: -4
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            MsGraph.completeTodoTask(taskRow.modelData.id)
                            SoundFx.tap()
                        }
                    }
                }
                Column {
                    anchors.left: check.right
                    anchors.leftMargin: 9
                    anchors.right: importanceDot.left
                    anchors.rightMargin: 8
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 1

                    Text {
                        id: taskText
                        width: parent.width
                        text: taskRow.modelData.title
                        color: Theme.textPrimary
                        font.pixelSize: 11
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                    Text {
                        visible: taskRow.modelData.due !== ""
                        text: taskRow.modelData.due
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                }
                Rectangle {
                    id: importanceDot
                    width: 5
                    height: 5
                    radius: 2.5
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    color: taskRow.modelData.important
                        ? "#f74f7e" : Qt.rgba(1, 1, 1, 0.16)
                }
            }
        }

        Text {
            visible: MsGraph.authState === "ok" && MsGraph.todoTasks.length > 0
            text: MsGraph.todoTasks.length + " t\u00e2che"
                + (MsGraph.todoTasks.length > 1 ? "s" : "")
            color: Theme.textSecondary
            font.pixelSize: 9
        }

        Row {
            visible: MsGraph.authState === "ok"
            width: parent.width
            spacing: 6

            TextField {
                id: newTask
                width: parent.width - addButton.width - parent.spacing
                height: 28
                placeholderText: "Nouvelle t\u00e2che..."
                color: Theme.textPrimary
                placeholderTextColor: Theme.textSecondary
                font.pixelSize: 10
                leftPadding: 8
                rightPadding: 8
                background: Rectangle {
                    radius: 6
                    color: Qt.rgba(1, 1, 1, 0.05)
                    border.color: newTask.activeFocus ? Theme.accent : Theme.cardStroke
                }
                onAccepted: card.submitTask()
            }
            Rectangle {
                id: addButton
                width: 28
                height: 28
                radius: 6
                color: addMouse.containsMouse ? Theme.activeFill : Qt.rgba(1, 1, 1, 0.06)
                opacity: newTask.text.trim() === "" ? 0.45 : 1
                Text {
                    anchors.centerIn: parent
                    text: "+"
                    color: Theme.textPrimary
                    font.pixelSize: 15
                }
                MouseArea {
                    id: addMouse
                    anchors.fill: parent
                    enabled: newTask.text.trim() !== ""
                    hoverEnabled: true
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: card.submitTask()
                }
            }
        }
    }
}
