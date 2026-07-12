import QtQuick

Item {
    id: bar

    property real value: 0
    property real maximum: 100
    property string label: "Temp"

    readonly property bool valueAvailable: isFinite(value) && value >= 0
    readonly property real ratio: valueAvailable
        ? Math.max(0, Math.min(1, value / Math.max(1, maximum))) : 0
    readonly property bool showMaximum: width >= 68

    implicitWidth: 72
    implicitHeight: 48

    Rectangle {
        id: track
        width: 11
        height: Math.min(42, parent.height - 4)
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        radius: 3
        clip: true
        color: Qt.rgba(0.05, 0.10, 0.18, 0.54)
        border.color: Qt.rgba(0.93, 0.97, 1, 0.30)

        Item {
            id: fillClip
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: Math.max(0, Math.round(parent.height * bar.ratio))
            clip: true

            Rectangle {
                width: fillClip.width
                height: track.height
                anchors.bottom: parent.bottom
                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#ff3030" }
                    GradientStop { position: 0.28; color: "#ff9228" }
                    GradientStop { position: 0.54; color: "#ffdc00" }
                    GradientStop { position: 1.0; color: "#008cff" }
                }
            }
        }
    }

    Column {
        anchors.left: track.right
        anchors.leftMargin: 6
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2

        Text {
            width: parent.width
            text: bar.label.toUpperCase()
            color: Theme.textSecondary
            font.pixelSize: 8
            elide: Text.ElideRight
        }
        Text {
            width: parent.width
            text: bar.valueAvailable ? Math.round(bar.value) + " C" : "--"
            color: Theme.textPrimary
            font.pixelSize: 10
            elide: Text.ElideRight
        }
        Text {
            visible: bar.showMaximum
            width: parent.width
            text: "max " + Math.round(Math.max(1, bar.maximum)) + " C"
            color: Theme.textSecondary
            font.pixelSize: 7
            elide: Text.ElideRight
        }
    }
}
