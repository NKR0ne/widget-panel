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
        : mouse.containsMouse ? Theme.hover
        : btn.active ? Theme.activeFill : "transparent"
    border.width: activeFocus ? 1 : 0
    border.color: Theme.accent
    activeFocusOnTab: true

    Accessible.role: Accessible.Button
    Accessible.name: accessibleName || tooltip
    Accessible.description: tooltip

    Behavior on color {
        ColorAnimation { duration: Motion.fastMs }
    }

    Text {
        anchors.centerIn: parent
        text: btn.glyph
        color: !btn.enabled ? Qt.rgba(1, 1, 1, 0.22)
            : btn.active ? Theme.accent : Theme.textSecondary
        font.family: "Segoe Fluent Icons"
        font.pixelSize: 13
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
