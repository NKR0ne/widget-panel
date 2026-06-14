import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Microsoft To-Do"
    implicitHeight: body.implicitHeight + 24

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

        Text {
            text: card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
        }

        MsStatePane { width: parent.width }

        // List selection chips
        Flow {
            width: parent.width
            spacing: 4
            visible: MsGraph.authState === "ok" && MsGraph.todoLists.length > 1
            Repeater {
                model: MsGraph.todoLists
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    readonly property bool on: MsGraph.selectedTodoListId === modelData.id
                        || (MsGraph.selectedTodoListId === "" && index === 0)
                    height: 16
                    width: listName.implicitWidth + 14
                    radius: 8
                    color: on ? Theme.activeFill : "transparent"
                    border.color: on ? Theme.accent : Theme.cardStroke
                    Text { id: listName; anchors.centerIn: parent; text: modelData.name
                           color: on ? Theme.textPrimary : Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                onClicked: MsGraph.setTodoList(modelData.id) }
                }
            }
        }

        Text {
            visible: MsGraph.authState === "ok" && MsGraph.todoTasks.length === 0
            text: "Aucune tâche ouverte"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }

        Repeater {
            model: MsGraph.todoTasks

            delegate: Item {
                id: row
                required property var modelData
                width: body.width
                height: taskLabel.implicitHeight + 8

                Rectangle {
                    id: check
                    width: 14; height: 14; radius: 7
                    anchors.verticalCenter: parent.verticalCenter
                    color: checkMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.3) : "transparent"
                    border.color: row.modelData.important ? "#fbbf24" : Theme.textSecondary
                    border.width: 1.2

                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }

                    MouseArea {
                        id: checkMouse
                        anchors.fill: parent
                        anchors.margins: -4
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: MsGraph.completeTodoTask(row.modelData.id)
                    }
                }

                Column {
                    anchors.left: check.right
                    anchors.leftMargin: 8
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 0

                    Text {
                        id: taskLabel
                        width: parent.width
                        text: row.modelData.title
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeCaption
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                    Text {
                        visible: row.modelData.due !== ""
                        text: row.modelData.due
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                }
            }
        }
    }
}
