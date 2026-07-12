import QtQuick

Rectangle {
    id: banner

    property string message: ""
    property string tone: "info"
    property string actionText: ""
    signal actionRequested()

    readonly property color toneColor: tone === "success" ? Theme.success
        : tone === "warning" ? Theme.warning
        : tone === "error" ? Theme.danger : Theme.info

    visible: message !== ""
    implicitHeight: visible ? Math.max(30, messageLabel.implicitHeight + 14) : 0
    radius: 6
    color: Qt.rgba(toneColor.r, toneColor.g, toneColor.b, 0.12)
    border.color: Qt.rgba(toneColor.r, toneColor.g, toneColor.b, 0.36)

    Rectangle {
        width: 3
        radius: 1.5
        color: banner.toneColor
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.margins: 4
    }

    Text {
        id: messageLabel
        anchors.left: parent.left
        anchors.leftMargin: 12
        anchors.right: actionButton.visible ? actionButton.left : parent.right
        anchors.rightMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        text: banner.message
        color: Theme.textPrimary
        font.pixelSize: Theme.fontSizeCaption
        wrapMode: Text.WordWrap
    }

    Rectangle {
        id: actionButton
        visible: banner.actionText !== ""
        width: actionLabel.implicitWidth + 16
        height: 22
        radius: 5
        anchors.right: parent.right
        anchors.rightMargin: 6
        anchors.verticalCenter: parent.verticalCenter
        color: actionMouse.containsMouse ? Theme.hover : "transparent"
        border.color: banner.toneColor
        Accessible.role: Accessible.Button
        Accessible.name: banner.actionText
        Text {
            id: actionLabel
            anchors.centerIn: parent
            text: banner.actionText
            color: Theme.textPrimary
            font.pixelSize: 9
        }
        MouseArea {
            id: actionMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: banner.actionRequested()
        }
    }
}
