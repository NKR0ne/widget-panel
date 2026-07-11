import QtQuick

GlassCard {
    id: card
    title: "Horloge"
    implicitHeight: body.implicitHeight + 24

    property date now: new Date()

    function drawHand(ctx, angle, length, backLength, color, width, cx, cy) {
        ctx.beginPath()
        ctx.moveTo(cx - Math.cos(angle) * backLength,
                   cy - Math.sin(angle) * backLength)
        ctx.lineTo(cx + Math.cos(angle) * length,
                   cy + Math.sin(angle) * length)
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.lineCap = "round"
        ctx.stroke()
    }

    Timer {
        interval: 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            card.now = new Date()
            clockFace.requestPaint()
        }
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 4

        Text {
            text: card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
        }

        Canvas {
            id: clockFace
            width: 128
            height: 128
            anchors.horizontalCenter: parent.horizontalCenter
            renderTarget: Canvas.FramebufferObject

            onPaint: {
                const ctx = getContext("2d")
                const cx = width / 2
                const cy = height / 2
                const radius = 54
                ctx.clearRect(0, 0, width, height)

                ctx.beginPath()
                ctx.arc(cx, cy, radius, 0, Math.PI * 2)
                ctx.fillStyle = Qt.rgba(1, 1, 1, 0.07)
                ctx.fill()
                ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.10)
                ctx.lineWidth = 1
                ctx.stroke()

                for (let index = 0; index < 60; ++index) {
                    const angle = (index * 6 - 90) * Math.PI / 180
                    const major = index % 5 === 0
                    const outer = radius - (major ? 1 : 0.5)
                    const inner = radius - (major ? 9 : 5)
                    ctx.beginPath()
                    ctx.moveTo(cx + Math.cos(angle) * outer,
                               cy + Math.sin(angle) * outer)
                    ctx.lineTo(cx + Math.cos(angle) * inner,
                               cy + Math.sin(angle) * inner)
                    ctx.strokeStyle = major
                        ? Qt.rgba(1, 1, 1, 0.45)
                        : Qt.rgba(1, 1, 1, 0.12)
                    ctx.lineWidth = major ? 1.5 : 0.75
                    ctx.lineCap = "round"
                    ctx.stroke()
                }

                const hours = card.now.getHours() % 12
                const minutes = card.now.getMinutes()
                const seconds = card.now.getSeconds()
                const hourAngle = (hours * 30 + minutes * 0.5 - 90) * Math.PI / 180
                const minuteAngle = (minutes * 6 + seconds * 0.1 - 90) * Math.PI / 180
                const secondAngle = (seconds * 6 - 90) * Math.PI / 180

                card.drawHand(ctx, hourAngle, 30, 9, Qt.rgba(1, 1, 1, 0.95), 3, cx, cy)
                card.drawHand(ctx, minuteAngle, 46, 10, Qt.rgba(1, 1, 1, 0.75), 1.75, cx, cy)
                card.drawHand(ctx, secondAngle, 47, 13, "#f74f7e", 1, cx, cy)

                ctx.beginPath()
                ctx.arc(cx, cy, 3.5, 0, Math.PI * 2)
                ctx.fillStyle = "#f74f7e"
                ctx.fill()
                ctx.beginPath()
                ctx.arc(cx, cy, 1.5, 0, Math.PI * 2)
                ctx.fillStyle = Qt.rgba(0.08, 0.08, 0.10, 0.8)
                ctx.fill()
            }
        }

        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 5

            Text {
                text: Qt.formatTime(card.now, "HH:mm:ss")
                color: Theme.textPrimary
                font.family: "Consolas"
                font.pixelSize: 12
                font.letterSpacing: 2
            }
            Text {
                anchors.baseline: parent.children[0].baseline
                text: card.now.getHours() < 12 ? "AM" : "PM"
                color: Theme.textSecondary
                font.pixelSize: 9
            }
        }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: {
                const value = card.now.toLocaleDateString(
                    Qt.locale("fr_CA"), "dddd d MMMM")
                return value.charAt(0).toUpperCase() + value.slice(1)
            }
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeBody
        }
    }
}
