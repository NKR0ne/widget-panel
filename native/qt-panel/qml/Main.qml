import QtQuick

Window {
    id: root
    visible: false
    color: "transparent"
    flags: Qt.FramelessWindowHint | Qt.Tool | Qt.WindowStaysOnTopHint

    PanelSurface {
        anchors.fill: parent
    }
}
