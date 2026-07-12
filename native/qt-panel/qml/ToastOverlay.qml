import QtQuick

Item {
    id: overlay
    anchors.fill: parent
    visible: toast.opacity > 0
    z: 200

    property int seenRevision: -1

    Connections {
        target: Ui
        function onToastRevisionChanged() {
            if (!Ui.toastText)
                return
            overlay.seenRevision = Ui.toastRevision
            toast.opacity = 1
            hideTimer.restart()
        }
    }

    Timer {
        id: hideTimer
        interval: 3200
        onTriggered: toast.opacity = 0
    }

    StatusBanner {
        id: toast
        width: Math.min(460, parent.width - 40)
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 24
        message: Ui.toastText
        tone: Ui.toastTone
        opacity: 0
        Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }
    }
}
