import QtQuick
import QtPanel.Native

// One telemetry card per metric (kind: cpu | gpu | ram | disk | network),
// fed by the WorkstationMonitor named pipe at 1Hz. Dims when data is stale.
GlassCard {
    id: card

    property string kind: "cpu"

    title: ({ cpu: "CPU", gpu: "GPU", ram: "RAM", disk: "Disque", network: "Réseau" })[kind] || kind
    implicitHeight: body.implicitHeight + 24
    opacity: Workstation.connected && !Workstation.stale ? 1.0 : 0.45

    Behavior on opacity {
        NumberAnimation { duration: Motion.normalMs }
    }

    readonly property var metric: Workstation.snapshot[kind === "network" ? "network" : kind] || ({})

    readonly property double usagePct: {
        if (kind === "ram") return Number(metric.usedPct) || 0
        if (kind === "disk") return Number(metric.activityPct) || 0
        if (kind === "network") return Math.min(100, (Number(metric.downMbps) || 0) / 10)
        return Number(metric.usagePct) || 0
    }

    readonly property string headline: {
        if (!Workstation.connected) return "—"
        if (kind === "network") {
            const down = Number(metric.downMbps) || 0
            const upM = Number(metric.upMbps) || 0
            return "↓ " + down.toFixed(1) + " ↑ " + upM.toFixed(1) + " Mbps"
        }
        return Math.round(usagePct) + " %"
    }

    readonly property string detail: {
        if (!Workstation.connected) return "Service hors ligne"
        if (kind === "cpu") {
            const parts = []
            if (metric.temperatureC) parts.push(Math.round(metric.temperatureC) + "°C")
            if (metric.powerW) parts.push(Math.round(metric.powerW) + " W")
            if (metric.frequencyMHz) parts.push((metric.frequencyMHz / 1000).toFixed(1) + " GHz")
            return parts.join(" · ")
        }
        if (kind === "gpu") {
            const parts = []
            if (metric.temperatureC) parts.push(Math.round(metric.temperatureC) + "°C")
            if (metric.powerW) parts.push(Math.round(metric.powerW) + " W")
            if (metric.vramUsedMB && metric.vramTotalMB)
                parts.push((metric.vramUsedMB / 1024).toFixed(1) + "/"
                           + (metric.vramTotalMB / 1024).toFixed(0) + " Go VRAM")
            return parts.join(" · ")
        }
        if (kind === "ram") {
            if (metric.availableGB && metric.totalGB)
                return Number(metric.availableGB).toFixed(1) + " Go libres / "
                       + Math.round(metric.totalGB) + " Go"
            return ""
        }
        if (kind === "disk") return metric.model || ""
        if (kind === "network") return metric.adapter || ""
        return ""
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

        Row {
            width: parent.width
            spacing: 6

            Text {
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
            }
            Text {
                width: parent.width - x
                text: (card.kind === "cpu" || card.kind === "gpu") ? (card.metric.name || "") : ""
                color: Qt.rgba(1, 1, 1, 0.3)
                font.pixelSize: 9
                elide: Text.ElideRight
                anchors.verticalCenter: parent.verticalCenter
            }
        }

        Text {
            text: card.headline
            color: Theme.textPrimary
            font.pixelSize: 22
            font.weight: Font.Light
        }

        // Usage bar
        Rectangle {
            width: parent.width
            height: 5
            radius: 2.5
            color: Qt.rgba(1, 1, 1, 0.07)

            Rectangle {
                width: parent.width * Math.min(1, card.usagePct / 100)
                height: parent.height
                radius: parent.radius
                color: card.usagePct > 88 ? "#f87171"
                     : card.usagePct > 70 ? "#fbbf24"
                     : Theme.accent

                Behavior on width {
                    NumberAnimation {
                        duration: Motion.panelMs
                        easing.type: Easing.BezierSpline
                        easing.bezierCurve: Motion.emphasized
                    }
                }
            }
        }

        Text {
            width: parent.width
            text: card.detail
            color: Theme.textSecondary
            font.pixelSize: 10
            elide: Text.ElideRight
        }
    }
}
