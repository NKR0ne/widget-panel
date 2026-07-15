import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// QML chrome for the native browser viewport. The helper window is positioned
// only over `browserViewport`; the toolbar and card frame remain native QML.
Rectangle {
    id: card

    radius: Theme.radiusCard
    color: Qt.rgba(0.035, 0.045, 0.075, 0.96)
    border.color: Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.42)
    border.width: 1
    clip: true

    function schedulePlacement() {
        if (visible && Panel.islandOpen)
            geometrySync.restart()
    }

    function placeViewport() {
        if (!visible || !Panel.islandOpen || browserViewport.width < 80
                || browserViewport.height < 80)
            return
        const point = browserViewport.mapToItem(null, 0, 0)
        Panel.placeIsland(point.x, point.y,
                          browserViewport.width, browserViewport.height)
    }

    onXChanged: schedulePlacement()
    onYChanged: schedulePlacement()
    onWidthChanged: schedulePlacement()
    onHeightChanged: schedulePlacement()
    onVisibleChanged: schedulePlacement()
    Component.onCompleted: schedulePlacement()

    Timer {
        id: geometrySync
        interval: 0
        onTriggered: card.placeViewport()
    }

    Connections {
        target: Panel
        function onIslandChanged() {
            if (Panel.islandOpen) {
                address.text = Panel.islandUrl
                card.schedulePlacement()
            }
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 44
        color: Qt.rgba(1, 1, 1, 0.035)

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 8
            anchors.rightMargin: 8
            spacing: 5

            IconButton {
                glyph: "\uE72B"
                onClicked: Panel.backIsland()
            }
            IconButton {
                glyph: "\uE72A"
                onClicked: Panel.forwardIsland()
            }
            IconButton {
                glyph: "\uE72C"
                onClicked: Panel.reloadIsland()
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 28
                radius: 6
                color: Qt.rgba(1, 1, 1, 0.055)
                border.color: address.activeFocus ? Theme.accent : Theme.cardStroke

                TextInput {
                    id: address
                    anchors.fill: parent
                    anchors.leftMargin: 9
                    anchors.rightMargin: 9
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary
                    selectionColor: Theme.accent
                    selectedTextColor: "white"
                    font.pixelSize: Theme.fontSizeCaption
                    clip: true
                    text: Panel.islandUrl
                    onAccepted: Panel.navigateIsland(text)
                }
            }

            IconButton {
                glyph: "\uE8A7"
                onClicked: Qt.openUrlExternally(Panel.islandUrl)
            }
            IconButton {
                glyph: "\uE8BB"
                onClicked: Panel.closeIsland()
            }
        }
    }

    Rectangle {
        id: viewportFrame
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.leftMargin: 7
        anchors.rightMargin: 7
        anchors.topMargin: 50
        anchors.bottomMargin: 7
        radius: 8
        color: "#090b10"
        border.color: Theme.cardStroke
        clip: true

        Text {
            anchors.centerIn: parent
            text: "Chargement du contenu web..."
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeBody
        }

        Item {
            id: browserViewport
            anchors.fill: parent
            anchors.margins: 2
            onXChanged: card.schedulePlacement()
            onYChanged: card.schedulePlacement()
            onWidthChanged: card.schedulePlacement()
            onHeightChanged: card.schedulePlacement()
        }
    }
}
