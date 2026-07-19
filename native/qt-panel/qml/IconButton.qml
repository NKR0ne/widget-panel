import QtQuick
import QtQuick.Controls

Rectangle {
    id: btn

    property string glyph: ""
    property bool active: false
    property string tooltip: ""
    property string accessibleName: tooltip
    property int buttonSize: 28
    signal clicked()

    implicitWidth: buttonSize
    implicitHeight: buttonSize
    radius: 6
    color: !btn.enabled ? "transparent"
        : mouse.pressed ? Theme.activeFill
        : mouse.containsMouse ? Theme.hover
        : btn.active ? Theme.activeFill : "transparent"
    border.width: activeFocus || (mouse.containsMouse && Ui.surfaceLighting) ? 1 : 0
    border.color: activeFocus ? Theme.accent : Theme.keyline
    activeFocusOnTab: true
    scale: mouse.pressed ? 0.94 : 1

    Accessible.role: Accessible.Button
    Accessible.name: accessibleName || tooltip
    Accessible.description: tooltip

    Behavior on color {
        ColorAnimation { duration: Motion.fastMs }
    }
    Behavior on scale {
        NumberAnimation { duration: Motion.fastMs; easing.type: Easing.OutCubic }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: 5
        anchors.rightMargin: 5
        height: 1
        visible: Ui.surfaceLighting && btn.enabled
        opacity: mouse.containsMouse ? 0.72 : 0
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 0.5; color: Theme.keyline }
            GradientStop { position: 1; color: "transparent" }
        }
        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
    }

    Rectangle {
        width: btn.active ? 10 : 0
        height: 2
        radius: 1
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 2
        color: Theme.accent
        opacity: btn.active ? 0.9 : 0
        Behavior on width { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
    }

    Text {
        anchors.centerIn: parent
        text: btn.glyph
        color: !btn.enabled ? Qt.rgba(1, 1, 1, 0.22)
            : btn.active ? Theme.accent : Theme.textSecondary
        font.family: "Segoe Fluent Icons"
        font.pixelSize: 13
        Behavior on color { ColorAnimation { duration: Motion.fastMs } }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: btn.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: btn.clicked()
    }

    Keys.onReturnPressed: if (enabled) clicked()
    Keys.onEnterPressed: if (enabled) clicked()
    Keys.onSpacePressed: if (enabled) clicked()

    ToolTip.visible: tooltip !== "" && mouse.containsMouse
    ToolTip.text: tooltip
    ToolTip.delay: 500
}
