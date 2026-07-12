import QtQuick

Rectangle {
    id: btn

    property string glyph: ""
    property bool active: false
    signal clicked()

    implicitWidth: 28
    implicitHeight: 28
    radius: 6
    color: !btn.enabled ? "transparent"
        : mouse.containsMouse ? Theme.hover
        : btn.active ? Theme.activeFill : "transparent"

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
}
