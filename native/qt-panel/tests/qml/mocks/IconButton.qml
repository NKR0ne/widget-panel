import QtQuick
Rectangle {
    property string glyph: ""
    property string tooltip: ""
    property int buttonSize: 28
    signal clicked()
    implicitWidth: buttonSize
    implicitHeight: buttonSize
    color: "transparent"
    Text { anchors.centerIn: parent; text: parent.glyph; color: Theme.textPrimary; font.family: "Segoe Fluent Icons" }
    MouseArea { anchors.fill: parent; onClicked: parent.clicked() }
}
