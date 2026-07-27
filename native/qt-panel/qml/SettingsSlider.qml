import QtQuick

// Minimal slider (no Controls styling dependency): label + track + handle.
Item {
    id: slider

    property string label: ""
    property real from: 0
    property real to: 1
    property real value: 0
    signal moved(real value)

    // Item.enabled already blocks the MouseArea; these carry it through to
    // appearance so a control with no effect reads as inert rather than broken.
    property string disabledNote: ""
    opacity: slider.enabled ? 1 : 0.45
    Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }

    implicitHeight: disabledNote !== "" && !enabled ? 46 : 34

    Text {
        id: caption
        text: slider.label
        color: Theme.textSecondary
        font.pixelSize: Theme.fontSizeCaption
    }
    Text {
        anchors.top: caption.bottom
        anchors.topMargin: 1
        width: parent.width
        visible: !slider.enabled && slider.disabledNote !== ""
        text: slider.disabledNote
        color: Theme.textSecondary
        font.pixelSize: 9
        elide: Text.ElideRight
    }
    Text {
        anchors.right: parent.right
        text: slider.value.toFixed(2)
        color: Theme.textPrimary
        font.pixelSize: Theme.fontSizeCaption
    }

    Rectangle {
        id: track
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 6
        height: 4
        radius: 2
        color: Qt.rgba(1, 1, 1, 0.1)

        Rectangle {
            width: handle.x + handle.width / 2
            height: parent.height
            radius: parent.radius
            color: Theme.accent
            Behavior on width {
                NumberAnimation { duration: Motion.fastMs; easing.type: Easing.OutCubic }
            }
        }

        Rectangle {
            id: handle
            width: 12; height: 12; radius: 6
            y: -4
            x: (slider.value - slider.from) / (slider.to - slider.from)
               * (track.width - width)
            color: "#ffffff"
            border.color: Theme.accent
            border.width: 2
            scale: trackMouse.pressed ? 1.18 : trackMouse.containsMouse ? 1.08 : 1
            Behavior on scale {
                NumberAnimation { duration: Motion.fastMs; easing.type: Easing.OutCubic }
            }
        }

        MouseArea {
            id: trackMouse
            anchors.fill: parent
            anchors.margins: -8
            hoverEnabled: true
            cursorShape: slider.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
            onPressed: mouse => update(mouse.x - 8)
            onPositionChanged: mouse => { if (pressed) update(mouse.x - 8) }
            function update(mx) {
                const ratio = Math.max(0, Math.min(1, mx / track.width))
                const next = slider.from + ratio * (slider.to - slider.from)
                slider.value = next
                slider.moved(next)
            }
        }
    }
}
