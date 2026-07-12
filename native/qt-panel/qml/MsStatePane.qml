import QtQuick
import QtPanel.Native

// Shared auth-state strip for the Microsoft widgets: silent while "ok",
// explains itself in every other state. Interactive sign-in opens in the
// native Brave island (PKCE + loopback callback).
Column {
    id: pane
    spacing: 4

    visible: MsGraph.authState !== "ok"
    property int storeRev: 0
    Connections {
        target: Store
        function onChanged(key) { if (key === "wp-ms-client") pane.storeRev++ }
    }

    Text {
        width: parent.width
        visible: MsGraph.authState === "refreshing"
        text: "Connexion à Microsoft…"
        color: Theme.textSecondary
        font.pixelSize: Theme.fontSizeCaption
    }
    Text {
        width: parent.width
        visible: MsGraph.authState === "authenticating"
        text: "Terminez la connexion dans le navigateur…"
        color: Theme.textSecondary
        font.pixelSize: Theme.fontSizeCaption
        wrapMode: Text.WordWrap
    }
    Rectangle {
        width: cancelLabel.implicitWidth + 18
        height: 22
        radius: 5
        visible: MsGraph.authState === "authenticating"
        color: cancelMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.05)
        border.color: Theme.cardStroke
        Text {
            id: cancelLabel
            anchors.centerIn: parent
            text: "Annuler"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }
        MouseArea {
            id: cancelMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: {
                MsGraph.cancelAuth()
                if (Panel.islandOpen)
                    Panel.closeIsland()
            }
        }
    }
    Column {
        width: parent.width
        spacing: 6
        visible: MsGraph.authState === "setup" || MsGraph.authState === "error"
                 || MsGraph.authState === "none"

        Text {
            width: parent.width
            text: MsGraph.authState === "error" && MsGraph.authError !== ""
                ? MsGraph.authError : "Reconnexion à Microsoft requise."
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }
        Rectangle {
            width: signInLabel.implicitWidth + 20
            height: 24
            radius: 6
            color: signInMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.25)
                                             : Qt.rgba(0.31, 0.56, 0.97, 0.15)
            border.color: Qt.rgba(0.31, 0.56, 0.97, 0.4)
            visible: { pane.storeRev; return Store.get("wp-ms-client", "") !== "" }

            Text {
                id: signInLabel
                anchors.centerIn: parent
                text: "Se connecter"
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
            }
            MouseArea {
                id: signInMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: MsGraph.startAuth(Store.get("wp-ms-client", ""))
            }
        }
    }
}
