import QtQuick

Item {
    id: control

    property string label: ""
    property string description: ""
    property bool checked: false
    signal toggled(bool checked)

    implicitHeight: description === "" ? 28 : 40
    activeFocusOnTab: true
    Accessible.role: Accessible.CheckBox
    Accessible.name: label
    Accessible.description: description
    Accessible.checked: checked

    Column {
        anchors.left: parent.left
        anchors.right: toggle.left
        anchors.rightMargin: 10
        anchors.verticalCenter: parent.verticalCenter
        spacing: 1
        Text {
            width: parent.width
            text: control.label
            color: Theme.textPrimary
            font.pixelSize: Theme.fontSizeCaption
            elide: Text.ElideRight
        }
        Text {
            visible: control.description !== ""
            width: parent.width
            text: control.description
            color: Theme.textSecondary
            font.pixelSize: 9
            elide: Text.ElideRight
        }
    }

    Rectangle {
        id: toggle
        width: 36
        height: 20
        radius: 10
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        color: control.checked ? Theme.accent : Qt.rgba(1, 1, 1, 0.12)
        border.width: control.activeFocus ? 1 : 0
        border.color: Theme.textPrimary
        Behavior on color { ColorAnimation { duration: Motion.fastMs } }
        Rectangle {
            width: 16; height: 16; radius: 8; y: 2
            x: control.checked ? parent.width - width - 2 : 2
            color: "white"
            Behavior on x { NumberAnimation { duration: Motion.fastMs } }
        }
    }

    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: control.toggled(!control.checked)
    }
    Keys.onSpacePressed: toggled(!checked)
    Keys.onReturnPressed: toggled(!checked)
}
