import QtQuick

Item {
    id: gauge

    property real value: 0
    property real maximum: 100
    property string label: "Power"

    readonly property bool valueAvailable: isFinite(value) && value >= 0
    readonly property real ratio: valueAvailable
        ? Math.max(0, Math.min(1, value / Math.max(1, maximum))) : 0
    readonly property real dialSize: Math.max(34, Math.min(44, height - 4, width < 78 ? width : width * 0.52))
    readonly property bool showLegend: width >= 78

    implicitWidth: 92
    implicitHeight: 48

    function rangeColor(amount, alpha) {
        const t = Math.max(0, Math.min(1, amount))
        let from
        let to
        let local
        if (t <= 0.5) {
            from = [0, 140, 255]
            to = [255, 220, 0]
            local = t / 0.5
        } else if (t <= 0.75) {
            from = [255, 220, 0]
            to = [255, 140, 40]
            local = (t - 0.5) / 0.25
        } else {
            from = [255, 140, 40]
            to = [255, 40, 40]
            local = (t - 0.75) / 0.25
        }
        return Qt.rgba((from[0] + (to[0] - from[0]) * local) / 255,
                       (from[1] + (to[1] - from[1]) * local) / 255,
                       (from[2] + (to[2] - from[2]) * local) / 255,
                       alpha === undefined ? 1 : alpha)
    }

    Canvas {
        id: dial
        width: gauge.dialSize
        height: width
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        antialiasing: true

        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            ctx.clearRect(0, 0, width, height)
            const center = width / 2
            const radius = Math.max(4, center - 4)
            ctx.lineWidth = Math.max(3.5, width * 0.105)
            ctx.lineCap = "round"
            ctx.beginPath()
            ctx.arc(center, center, radius, -Math.PI / 2, Math.PI * 1.5)
            ctx.strokeStyle = "rgba(247,250,255,0.14)"
            ctx.stroke()
            if (gauge.ratio > 0) {
                ctx.beginPath()
                ctx.arc(center, center, radius, -Math.PI / 2,
                        -Math.PI / 2 + Math.PI * 2 * gauge.ratio)
                ctx.strokeStyle = gauge.rangeColor(gauge.ratio, 0.96)
                ctx.stroke()
            }
        }

        Connections {
            target: gauge
            function onRatioChanged() { dial.requestPaint() }
            function onDialSizeChanged() { dial.requestPaint() }
        }
        Component.onCompleted: requestPaint()

        Text {
            anchors.centerIn: parent
            text: gauge.valueAvailable ? String(Math.round(gauge.value)) : "--"
            color: Theme.textPrimary
            font.pixelSize: Math.max(8, Math.min(11, parent.width * 0.23))
            font.weight: Font.Medium
        }
    }

    Column {
        visible: gauge.showLegend
        anchors.left: dial.right
        anchors.leftMargin: 6
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2

        Text {
            width: parent.width
            text: gauge.label.toUpperCase()
            color: Theme.textSecondary
            font.pixelSize: 8
            elide: Text.ElideRight
        }
        Text {
            width: parent.width
            text: gauge.valueAvailable ? Math.round(gauge.value) + " W" : "--"
            color: Theme.textPrimary
            font.pixelSize: 10
            elide: Text.ElideRight
        }
        Text {
            width: parent.width
            text: "lim " + Math.round(Math.max(1, gauge.maximum)) + " W"
            color: Theme.textSecondary
            font.pixelSize: 7
            elide: Text.ElideRight
        }
    }
}
