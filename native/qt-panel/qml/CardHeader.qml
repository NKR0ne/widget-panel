import QtQuick

Item {
    id: header

    property string title: ""
    property string subtitle: ""
    property string status: ""
    property color statusColor: "transparent"
    property bool expandable: false
    default property alias actions: actionRow.data
    signal expandRequested()

    implicitHeight: subtitle === "" ? 22 : 34

    Column {
        anchors.left: parent.left
        anchors.right: actionRow.left
        anchors.rightMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        spacing: 1
        Text {
            width: parent.width
            text: header.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1
            elide: Text.ElideRight
        }
        Text {
            visible: header.subtitle !== ""
            width: parent.width
            text: header.subtitle
            color: Theme.textSecondary
            opacity: 0.76
            font.pixelSize: 9
            elide: Text.ElideRight
        }
    }

    Row {
        id: actionRow
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: 3

        Rectangle {
            visible: header.status !== ""
            width: statusLabel.implicitWidth + 17
            height: 20
            radius: 5
            color: Theme.cardFill
            border.color: Theme.cardStroke
            Rectangle {
                width: 6; height: 6; radius: 3
                color: header.statusColor
                anchors.left: parent.left
                anchors.leftMargin: 5
                anchors.verticalCenter: parent.verticalCenter
            }
            Text {
                id: statusLabel
                anchors.right: parent.right
                anchors.rightMargin: 5
                anchors.verticalCenter: parent.verticalCenter
                text: header.status
                color: Theme.textSecondary
                font.pixelSize: 8
            }
        }

        IconButton {
            visible: header.expandable
            buttonSize: 22
            glyph: "\uE740"
            tooltip: "Ouvrir le d\u00e9tail"
            accessibleName: "Ouvrir " + header.title
            onClicked: header.expandRequested()
        }
    }
}
