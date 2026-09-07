import QtQuick
Item {
    id: header
    property string title: ""
    property string status: ""
    property color statusColor: "transparent"
    default property alias actions: actionRow.data
    implicitHeight: 22
    Text { anchors.verticalCenter: parent.verticalCenter; text: header.title; color: Theme.textPrimary }
    Row { id: actionRow; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter }
}
