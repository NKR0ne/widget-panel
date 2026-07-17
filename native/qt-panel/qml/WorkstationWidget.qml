import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtPanel.Native

// One telemetry card per metric (kind: cpu | gpu | ram | disk | network),
// fed by the WorkstationMonitor named pipe. Mirrors the Electron cards'
// graph/detail split using the same history fields from the telemetry JSON.
GlassCard {
    id: card

    property string kind: "cpu"
    property string tab: "graphs"
    property int snapRev: 0
    property bool detailMode: false
    property bool modelSyncQueued: false

    title: ({ cpu: "CPU", gpu: "GPU", ram: "RAM", disk: "Disque", network: "Reseau" })[kind] || kind
    implicitHeight: body.implicitHeight + 24
    flat: detailMode
    interactive: !detailMode
    opacity: Workstation.connected && !Workstation.stale ? 1.0 : 0.45

    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }

    readonly property bool live: Workstation.connected && !Workstation.stale
    readonly property var snapshot: { snapRev; return Workstation.snapshot || ({}) }
    readonly property var metric: snapshot[kind === "network" ? "network" : kind] || ({})

    readonly property double usagePct: {
        if (kind === "ram") return Number(metric.usedPct) || 0
        if (kind === "disk") return Number(metric.activityPct) || 0
        if (kind === "network") return Math.min(100, (Number(metric.downMbps) || 0) / Math.max(1, networkScale()) * 100)
        return Number(metric.usagePct) || 0
    }

    readonly property string headline: {
        if (!Workstation.connected) return "--"
        if (kind === "network") {
            const down = Number(metric.downMbps) || 0
            const upM = Number(metric.upMbps) || 0
            return "D " + down.toFixed(1) + " / U " + upM.toFixed(1) + " Mbps"
        }
        return Math.round(usagePct) + " %"
    }

    readonly property string subline: {
        if (!Workstation.connected) return "Service hors ligne"
        if (kind === "cpu") return metric.name || "Processor"
        if (kind === "gpu") return metric.name || "Graphics"
        if (kind === "ram") return metric.model || "System memory"
        if (kind === "disk") return metric.model || "PhysicalDrive0"
        if (kind === "network") return metric.adapter || "Network adapter"
        return ""
    }

    Connections {
        target: Workstation
        function onSnapshotChanged() {
            card.snapRev++
            card.scheduleModelSync()
        }
    }

    ListModel { id: graphModel; dynamicRoles: true }
    ListModel { id: detailModel; dynamicRoles: true }
    ListModel { id: footerModel; dynamicRoles: true }

    function syncListModel(model, values) {
        const next = values || []
        while (model.count > next.length)
            model.remove(model.count - 1)
        for (let i = 0; i < next.length; i++) {
            const row = { spec: next[i] }
            if (i < model.count)
                model.set(i, row)
            else
                model.append(row)
        }
    }

    function syncModels() {
        modelSyncQueued = false
        syncListModel(graphModel, graphSpecs())
        syncListModel(detailModel, detailRows())
        syncListModel(footerModel, footerTiles())
    }

    function scheduleModelSync() {
        if (modelSyncQueued)
            return
        modelSyncQueued = true
        Qt.callLater(syncModels)
    }

    onKindChanged: scheduleModelSync()
    Component.onCompleted: scheduleModelSync()

    function valuesOf(value) {
        const out = []
        const source = value || []
        for (let i = 0; i < source.length; i++) {
            const n = Number(source[i])
            if (isFinite(n))
                out.push(n)
        }
        return out
    }

    function latest(value) {
        const values = valuesOf(value)
        return values.length ? values[values.length - 1] : 0
    }

    function maxOf() {
        let max = 0
        for (let a = 0; a < arguments.length; a++) {
            const values = valuesOf(arguments[a])
            for (const n of values)
                if (n > max) max = n
            const single = Number(arguments[a])
            if (isFinite(single) && single > max)
                max = single
        }
        return max
    }

    function fmt(value, unit, decimals) {
        const n = Number(value)
        if (!isFinite(n))
            return "--"
        const d = decimals === undefined ? (Math.abs(n) >= 100 ? 0 : 1) : decimals
        return n.toFixed(d) + (unit || "")
    }

    function fmtInt(value) {
        const n = Number(value)
        return isFinite(n) ? String(Math.round(n)) : "--"
    }

    function fmtMemoryMB(value, decimals) {
        const n = Number(value)
        if (!isFinite(n))
            return "--"
        if (n >= 1024)
            return (n / 1024).toFixed(decimals === undefined ? 1 : decimals) + " GB"
        return Math.round(n) + " MB"
    }

    function uptime(seconds) {
        const s = Number(seconds)
        if (!isFinite(s) || s <= 0)
            return "--"
        const days = Math.floor(s / 86400)
        const hours = Math.floor((s % 86400) / 3600)
        return days > 0 ? (days + "d " + hours + "h") : (hours + "h")
    }

    function networkScale() {
        const net = snapshot.network || ({})
        return Math.max(1, maxOf(net.downHistory, net.upHistory, net.downMbps, net.upMbps))
    }

    function serviceRows() {
        return [
            { label: "Sampler", value: snapshot.sampling ? "Live" : "Paused" },
            { label: "Clients", value: fmtInt(snapshot.activeClients || 0) },
            { label: "Interval", value: fmt(snapshot.sampleIntervalMs, " ms", 0) }
        ]
    }

    function detailRows() {
        const rows = []
        if (kind === "cpu") {
            rows.push(
                { label: "Processor", value: metric.name || "--" },
                { label: "Utilization", value: fmt(metric.usagePct, "%") },
                { label: "Speed", value: fmt(metric.frequencyMHz, " MHz", 0) },
                { label: "Base speed", value: fmt(metric.baseFrequencyMHz, " MHz", 0) },
                { label: "Frequency source", value: metric.frequencySource || "--" },
                { label: "Processes", value: fmtInt(metric.processes) },
                { label: "Threads", value: fmtInt(metric.threads) },
                { label: "Handles", value: fmtInt(metric.handles) },
                { label: "Uptime", value: uptime(metric.uptimeSeconds) },
                { label: "Physical cores", value: fmtInt(metric.physicalCores) },
                { label: "Logical cores", value: fmtInt(metric.coreCount) },
                { label: "Temperature", value: fmt(metric.temperatureC, " C") },
                { label: "Temp source", value: metric.temperatureSource || "--" },
                { label: "Power limit", value: fmt(metric.powerLimitW, " W") }
            )
        } else if (kind === "gpu") {
            rows.push(
                { label: "GPU", value: metric.name || "--" },
                { label: "Utilization", value: fmt(metric.usagePct, "%") },
                { label: "Clock", value: fmt(metric.clockMHz, " MHz", 0) },
                { label: "Temperature", value: fmt(metric.temperatureC, " C") },
                { label: "Power", value: fmt(metric.powerW, " W") },
                { label: "Power limit", value: fmt(metric.powerLimitW, " W") },
                { label: "Dedicated used", value: fmtMemoryMB(metric.vramUsedMB) },
                { label: "Dedicated total", value: fmtMemoryMB(metric.vramTotalMB, 0) },
                { label: "Shared used", value: fmtMemoryMB(metric.sharedUsedMB) },
                { label: "Shared total", value: fmtMemoryMB(metric.sharedTotalMB, 0) },
                { label: "Hardware reserved", value: fmtMemoryMB(metric.dedicatedSystemMemoryMB, 0) },
                { label: "FPS", value: snapshot.fps && snapshot.fps.tracking ? fmt(snapshot.fps.current, "", 0) : "--" },
                { label: "FPS source", value: snapshot.fps ? (snapshot.fps.source || "--") : "--" },
                { label: "Driver version", value: metric.driverVersion || "--" },
                { label: "Driver date", value: metric.driverDate || "--" },
                { label: "DirectX", value: metric.directXVersion || "--" },
                { label: "PCI bus", value: metric.pciBusId || "--" }
            )
        } else if (kind === "ram") {
            const bw = metric.bandwidth || ({})
            rows.push(
                { label: "Module", value: metric.model || "--" },
                { label: "Used", value: fmt(metric.usedPct, "%") },
                { label: "Available", value: fmt(metric.availableGB, " GB", 1) },
                { label: "Total RAM", value: fmt(metric.totalGB, " GB", 1) },
                { label: "BW available", value: bw.available ? "Yes" : "No" },
                { label: "BW read", value: fmt(bw.readGBps, " GB/s", 1) },
                { label: "BW write", value: fmt(bw.writeGBps, " GB/s", 1) },
                { label: "BW total", value: fmt(bw.totalGBps, " GB/s", 1) },
                { label: "BW peak", value: fmt(bw.peakGBps, " GB/s", 1) },
                { label: "Theoretical peak", value: fmt(bw.theoreticalPeakGBps, " GB/s", 1) }
            )
        } else if (kind === "disk") {
            rows.push(
                { label: "Model", value: metric.model || "--" },
                { label: "Activity", value: fmt(metric.activityPct, "%", 1) },
                { label: "Peak 30s", value: fmt(maxOf(metric.history), "%") },
                { label: "State", value: (Number(metric.activityPct) || 0) > 2 ? "Active" : "Idle" },
                { label: "Source", value: "System IO counters" }
            )
        } else if (kind === "network") {
            rows.push(
                { label: "Adapter", value: metric.adapter || "--" },
                { label: "Link", value: metric.valid ? "Live" : "Offline" },
                { label: "Download", value: fmt(metric.downMbps, " Mbps", 3) },
                { label: "Upload", value: fmt(metric.upMbps, " Mbps", 3) },
                { label: "Peak down", value: fmt(maxOf(metric.downHistory), " Mbps", 3) },
                { label: "Peak up", value: fmt(maxOf(metric.upHistory), " Mbps", 3) },
                { label: "Graph scale", value: fmt(networkScale(), " Mbps", 1) }
            )
        }
        return rows.concat(serviceRows())
    }

    function graphSpecs() {
        const blue = "#7aa7ff"
        const green = "#5ff5be"
        const gold = "#fbbf24"
        const violet = "#c084fc"
        const specs = []
        if (kind === "cpu") {
            specs.push({ label: "Total usage", value: fmt(metric.usagePct, "%"),
                         max: 100, height: 48,
                         series: [{ values: valuesOf(metric.history), color: blue, fill: "rgba(64,115,255,0.16)" }] })
            const cores = metric.coreHistory || []
            for (let i = 0; i < cores.length && i < 12; i++) {
                specs.push({ label: "CPU " + i, value: fmt(latest(cores[i]), "%"),
                             max: 100, height: 28,
                             series: [{ values: valuesOf(cores[i]), color: blue, fill: "rgba(64,115,255,0.10)" }] })
            }
        } else if (kind === "gpu") {
            specs.push(
                { label: "3D", value: fmt(latest(metric.history3D), "%"), max: 100, height: 30,
                  series: [{ values: valuesOf(metric.history3D), color: green, fill: "rgba(64,255,184,0.14)" }] },
                { label: "Copy", value: fmt(latest(metric.historyCopy), "%"), max: 100, height: 30,
                  series: [{ values: valuesOf(metric.historyCopy), color: green }] },
                { label: "Encode", value: fmt(latest(metric.historyEncode), "%"), max: 100, height: 30,
                  series: [{ values: valuesOf(metric.historyEncode), color: green }] },
                { label: "Decode", value: fmt(latest(metric.historyDecode), "%"), max: 100, height: 30,
                  series: [{ values: valuesOf(metric.historyDecode), color: green }] },
                { label: "Dedicated memory", value: fmtMemoryMB(metric.vramUsedMB) + " / " + fmtMemoryMB(metric.vramTotalMB, 0),
                  max: 100, height: 36,
                  series: [{ values: valuesOf(metric.historyVRAM), color: blue, fill: "rgba(64,115,255,0.14)" }] },
                { label: "Shared memory", value: fmtMemoryMB(metric.sharedUsedMB) + " / " + fmtMemoryMB(metric.sharedTotalMB, 0),
                  max: 100, height: 36,
                  series: [{ values: valuesOf(metric.historySharedMemory), color: blue, fill: "rgba(64,115,255,0.12)" }] }
            )
        } else if (kind === "ram") {
            const bw = metric.bandwidth || ({})
            specs.push(
                { label: "Memory pressure", value: fmt(metric.usedPct, "%"), max: 100, height: 54,
                  series: [{ values: valuesOf(metric.history), color: gold, fill: "rgba(255,184,56,0.16)" }] },
                { label: "Memory bandwidth", value: fmt(bw.totalGBps, " GB/s", 1),
                  max: Math.max(1, maxOf(bw.peakGBps, bw.theoreticalPeakGBps, bw.history)), height: 54,
                  series: [{ values: valuesOf(bw.history), color: gold, fill: "rgba(255,184,56,0.12)" }] }
            )
        } else if (kind === "disk") {
            const max = Math.max(5, maxOf(metric.history))
            specs.push({ label: "Disk activity", value: fmt(metric.activityPct, "%", 1),
                         max: max, height: 54,
                         series: [{ values: valuesOf(metric.history), color: green, fill: "rgba(64,255,184,0.13)" }] })
        } else if (kind === "network") {
            specs.push({ label: "Network throughput",
                         value: "D " + fmt(metric.downMbps, "", 1) + " / U " + fmt(metric.upMbps, " Mbps", 1),
                         max: networkScale(), height: 54,
                         series: [
                             { values: valuesOf(metric.downHistory), color: violet, fill: "rgba(194,107,255,0.14)" },
                             { values: valuesOf(metric.upHistory), color: blue }
                         ] })
        }
        return specs
    }

    function graphWidth(index, availableWidth) {
        if (kind === "cpu")
            return index === 0 ? availableWidth : Math.max(88, (availableWidth - 15) / 4)
        if (kind === "gpu")
            return Math.max(132, (availableWidth - 5) / 2)
        return availableWidth
    }

    function graphBaseHeight(spec) {
        return Math.max(26, Number(spec.height) || 42) + 22
    }

    function graphFlowRows(availableWidth) {
        const specs = graphSpecs()
        let x = 0
        let rows = 0
        for (let i = 0; i < specs.length; i++) {
            const itemWidth = graphWidth(i, availableWidth)
            if (x > 0 && x + itemWidth > availableWidth + 0.5) {
                rows++
                x = 0
            }
            x += itemWidth + 5
        }
        return specs.length > 0 ? rows + 1 : 0
    }

    function graphFlowHeight(availableWidth) {
        const specs = graphSpecs()
        let x = 0
        let y = 0
        let rowHeight = 0
        for (let i = 0; i < specs.length; i++) {
            const itemWidth = graphWidth(i, availableWidth)
            const itemHeight = graphBaseHeight(specs[i])
            if (x > 0 && x + itemWidth > availableWidth + 0.5) {
                y += rowHeight + 5
                x = 0
                rowHeight = 0
            }
            x += itemWidth + 5
            rowHeight = Math.max(rowHeight, itemHeight)
        }
        return specs.length > 0 ? y + rowHeight : 0
    }

    function stretchedGraphHeight(spec, availableWidth, availableHeight) {
        const baseHeight = graphBaseHeight(spec)
        if (detailMode || tab !== "graphs")
            return baseHeight
        const rows = graphFlowRows(availableWidth)
        if (rows <= 0)
            return baseHeight
        const extraHeight = Math.max(
            0, availableHeight - graphFlowHeight(availableWidth))
        return baseHeight + extraHeight / rows
    }

    function footerTiles() {
        if (kind === "cpu")
            return [
                { label: "Clock", value: fmt(metric.frequencyMHz, " MHz", 0) },
                { label: "Threads", value: fmtInt(metric.threads) }
            ]
        if (kind === "gpu")
            return [
                { label: "Clock", value: fmt(metric.clockMHz, " MHz", 0) },
                { label: "VRAM", value: fmtMemoryMB(metric.vramUsedMB) },
                { label: "FPS", value: snapshot.fps && snapshot.fps.tracking
                    ? fmt(snapshot.fps.current, "", 0) : "--" }
            ]
        if (kind === "ram") {
            const bw = metric.bandwidth || ({})
            return [
                { label: "Free", value: fmt(metric.availableGB, " GB", 1) },
                { label: "Total", value: fmt(metric.totalGB, " GB", 0) },
                { label: "BW", value: fmt(bw.totalGBps, " GB/s", 1) }
            ]
        }
        if (kind === "disk")
            return [
                { label: "Activity", value: fmt(metric.activityPct, "%", 1) },
                { label: "Peak", value: fmt(maxOf(metric.history), "%") },
                { label: "State", value: (Number(metric.activityPct) || 0) > 2 ? "Active" : "Idle" }
            ]
        if (kind === "network")
            return [
                { label: "Up", value: fmt(metric.upMbps, " Mbps", 1) },
                { label: "Scale", value: fmt(networkScale(), " Mbps", 0) },
                { label: "Link", value: metric.valid ? "Live" : "Offline" }
            ]
        return []
    }

    ColumnLayout {
        id: body
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        CardHeader {
            Layout.fillWidth: true
            title: card.title
            subtitle: card.subline
            status: card.live ? "LIVE" : "STALE"
            statusColor: card.live ? Theme.success : Theme.warning
            expandable: !card.detailMode
            onExpandRequested: Ui.openDetail("station", card.title, {
                kind: card.kind,
                subtitle: card.subline
            })
        }

        Row {
            Layout.fillWidth: true
            spacing: 8
            Text {
                width: card.detailMode ? parent.width
                                       : Math.max(70, parent.width - tabRow.width - 8)
                text: card.headline
                color: Theme.textPrimary
                font.pixelSize: 21
                font.weight: Font.Light
                elide: Text.ElideRight
            }
            Row {
                id: tabRow
                visible: !card.detailMode
                spacing: 4
                anchors.verticalCenter: parent.verticalCenter
                Repeater {
                    model: [{ id: "graphs", label: "Graphiques" }, { id: "details", label: "Details" }]
                    delegate: Rectangle {
                        required property var modelData
                        width: tabLabel.implicitWidth + 12
                        height: 22
                        radius: 5
                        color: card.tab === modelData.id ? Theme.activeFill
                             : tabMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.035)
                        border.color: card.tab === modelData.id ? Theme.accent : Theme.cardStroke
                        Text {
                            id: tabLabel
                            anchors.centerIn: parent
                            text: modelData.label
                            color: Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: tabMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.tab = modelData.id
                        }
                    }
                }
            }
        }

        Text {
            visible: !Workstation.connected
            Layout.fillWidth: true
            text: "Telemetry service unavailable. Start WorkstationMonitor with telemetry enabled."
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }

        Flow {
            id: graphFlow
            visible: Workstation.connected
                     && (card.detailMode || card.tab === "graphs")
            readonly property real naturalHeight: {
                card.snapRev
                return visible ? card.graphFlowHeight(width) : 0
            }
            Layout.fillWidth: true
            Layout.fillHeight: visible && !card.detailMode
            Layout.minimumHeight: naturalHeight
            Layout.preferredHeight: naturalHeight
            spacing: 5

            Repeater {
                model: graphModel
                delegate: Rectangle {
                    id: graph
                    required property var spec
                    required property int index
                    width: card.graphWidth(index, graphFlow.width)
                    height: card.stretchedGraphHeight(
                        spec, graphFlow.width, graphFlow.height)
                    radius: 6
                    color: Qt.rgba(0.01, 0.03, 0.07, 0.28)
                    border.color: Theme.cardStroke

                    Text {
                        id: graphLabel
                        x: 7
                        y: 4
                        width: Math.max(40, parent.width - graphValue.width - 20)
                        text: graph.spec.label || ""
                        color: Theme.textSecondary
                        font.pixelSize: 8
                        elide: Text.ElideRight
                    }
                    Text {
                        id: graphValue
                        anchors.right: parent.right
                        anchors.rightMargin: 7
                        y: 4
                        text: graph.spec.value || "--"
                        color: Theme.textPrimary
                        font.pixelSize: 8
                    }
                    Canvas {
                        id: chart
                        x: 6
                        y: 19
                        width: parent.width - 12
                        height: parent.height - y - 5

                        Connections {
                            target: card
                            function onSnapRevChanged() { chart.requestPaint() }
                        }
                        Connections {
                            target: graph
                            function onSpecChanged() { chart.requestPaint() }
                        }

                        onPaint: {
                            const ctx = getContext("2d")
                            ctx.reset()
                            ctx.clearRect(0, 0, width, height)

                            // Task Manager-style grid, confined to the chart canvas.
                            ctx.lineWidth = 1
                            for (let valueStep = 1; valueStep <= 10; valueStep++) {
                                const ratio = valueStep / 10
                                const y = Math.round((1 - ratio) * (height - 1)) + 0.5
                                ctx.strokeStyle = valueStep === 10
                                    ? "rgba(255,255,255,0.13)"
                                    : "rgba(255,255,255,0.07)"
                                ctx.beginPath()
                                ctx.moveTo(0, y)
                                ctx.lineTo(width, y)
                                ctx.stroke()
                            }
                            ctx.strokeStyle = "rgba(255,255,255,0.08)"
                            const timeGrid = [1 / 3, 2 / 3]
                            for (const ratio of timeGrid) {
                                const x = Math.round(ratio * (width - 1)) + 0.5
                                ctx.beginPath()
                                ctx.moveTo(x, 0)
                                ctx.lineTo(x, height)
                                ctx.stroke()
                            }

                            const max = Math.max(1, Number(graph.spec.max) || 100)
                            const series = graph.spec.series || []
                            for (const line of series) {
                                const values = card.valuesOf(line.values)
                                if (values.length < 2)
                                    continue
                                const color = line.color || Theme.accent
                                if (line.fill) {
                                    ctx.beginPath()
                                    for (let i = 0; i < values.length; i++) {
                                        const x = i / (values.length - 1) * width
                                        const y = height - Math.max(0, Math.min(1, values[i] / max)) * (height - 2) - 1
                                        if (i === 0) ctx.moveTo(x, y)
                                        else ctx.lineTo(x, y)
                                    }
                                    ctx.lineTo(width, height)
                                    ctx.lineTo(0, height)
                                    ctx.closePath()
                                    ctx.fillStyle = line.fill
                                    ctx.fill()
                                }
                                ctx.beginPath()
                                for (let j = 0; j < values.length; j++) {
                                    const px = j / (values.length - 1) * width
                                    const py = height - Math.max(0, Math.min(1, values[j] / max)) * (height - 2) - 1
                                    if (j === 0) ctx.moveTo(px, py)
                                    else ctx.lineTo(px, py)
                                }
                                ctx.strokeStyle = color
                                ctx.lineWidth = line.width || 1.15
                                ctx.stroke()
                            }
                        }

                        onWidthChanged: requestPaint()
                        onHeightChanged: requestPaint()
                        Component.onCompleted: requestPaint()
                    }
                }
            }
        }

        Flickable {
            id: detailsView
            visible: Workstation.connected
                     && (card.detailMode || card.tab === "details")
            readonly property real naturalHeight: detailsColumn.implicitHeight
            Layout.fillWidth: true
            Layout.fillHeight: visible && !card.detailMode
            Layout.minimumHeight: card.detailMode ? naturalHeight : 72
            Layout.preferredHeight: card.detailMode
                ? naturalHeight : Math.max(72, card.graphFlowHeight(width))
            contentWidth: width
            contentHeight: detailsColumn.height
            clip: !card.detailMode
            interactive: !card.detailMode && contentHeight > height
            flickableDirection: Flickable.VerticalFlick
            boundsBehavior: Flickable.StopAtBounds

            ScrollBar.vertical: ScrollBar {
                id: detailsScrollBar
                policy: card.detailMode ? ScrollBar.AlwaysOff : ScrollBar.AsNeeded
                width: 5
            }

            Column {
                id: detailsColumn
                width: Math.max(1, detailsView.width - (card.detailMode ? 0 : 10))
                spacing: 0

                Rectangle {
                    visible: card.detailMode
                    width: parent.width
                    height: 1
                    color: Theme.cardStroke
                }

                Text {
                    visible: card.detailMode
                    width: parent.width
                    height: 28
                    text: "Details"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    font.weight: Font.DemiBold
                    verticalAlignment: Text.AlignVCenter
                }

                Repeater {
                    model: detailModel
                    delegate: Row {
                        required property var spec
                        width: parent.width
                        height: Math.max(labelText.implicitHeight, valueText.implicitHeight) + 8
                        spacing: 8
                        Text {
                            id: labelText
                            width: Math.max(76, parent.width * 0.43)
                            anchors.verticalCenter: parent.verticalCenter
                            text: spec.label
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            elide: Text.ElideRight
                        }
                        Text {
                            id: valueText
                            width: Math.max(40, parent.width - labelText.width - 8)
                            anchors.verticalCenter: parent.verticalCenter
                            text: spec.value
                            color: Theme.textPrimary
                            font.pixelSize: 10
                            horizontalAlignment: Text.AlignRight
                            wrapMode: Text.WrapAnywhere
                        }
                    }
                }
            }
        }

        Item {
            visible: !card.detailMode && !graphFlow.visible && !detailsView.visible
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 0
        }

        Grid {
            visible: Workstation.connected && card.kind !== "cpu" && card.kind !== "gpu"
            Layout.fillWidth: true
            columns: Math.min(footerModel.count, 4)
            spacing: 6
            Repeater {
                model: footerModel
                delegate: Column {
                    required property var spec
                    width: Math.floor((body.width - Math.max(0, parent.columns - 1) * parent.spacing)
                                      / Math.max(1, parent.columns))
                    spacing: 2
                    Text {
                        width: parent.width
                        text: spec.label
                        color: Theme.textSecondary
                        font.pixelSize: 8
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: spec.value
                        color: Theme.textPrimary
                        font.pixelSize: 9
                        elide: Text.ElideRight
                    }
                }
            }
        }

        Column {
            id: instrumentFooter
            visible: Workstation.connected && (card.kind === "cpu" || card.kind === "gpu")
            Layout.fillWidth: true
            spacing: 6

            Rectangle {
                width: parent.width
                height: 1
                color: Qt.rgba(0.97, 0.98, 1, 0.10)
            }

            Row {
                id: instrumentRow
                width: parent.width
                height: 48
                spacing: 6
                readonly property real powerWidth: width >= 360 ? 94 : 48
                readonly property real tempWidth: width >= 360 ? 74 : 52
                readonly property int metricCount: Math.max(1, footerModel.count)
                readonly property real metricWidth: Math.max(
                    22, (width - powerWidth - tempWidth
                         - spacing * (metricCount + 1)) / metricCount)

                Repeater {
                    model: footerModel
                    delegate: Column {
                        required property var spec
                        width: instrumentRow.metricWidth
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            width: parent.width
                            text: spec.label
                            color: Theme.textSecondary
                            font.pixelSize: 8
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: spec.value
                            color: Theme.textPrimary
                            font.pixelSize: 9
                            elide: Text.ElideRight
                        }
                    }
                }

                PowerGauge {
                    width: instrumentRow.powerWidth
                    height: parent.height
                    value: Number(card.metric.powerW)
                    maximum: {
                        const reported = Number(card.metric.powerLimitW)
                        if (isFinite(reported) && reported > 0)
                            return reported
                        return card.kind === "cpu" ? 130 : 320
                    }
                }

                TemperatureBar {
                    width: instrumentRow.tempWidth
                    height: parent.height
                    value: Number(card.metric.temperatureC)
                    maximum: {
                        const reported = Number(card.metric.tjMaxC)
                        if (isFinite(reported) && reported > 0)
                            return reported
                        return card.kind === "cpu" ? 100 : 95
                    }
                }
            }
        }
    }
}
