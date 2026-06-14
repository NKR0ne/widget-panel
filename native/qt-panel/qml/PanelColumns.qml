import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// Lays the implemented widgets out into the saved Electron column assignment:
// wp-config.columns (widget id → column), wp-col-widths (per-column px used as
// flex weights), wp-base-columns (how many of the 6 columns are visible).
Item {
    id: root

    property string mode: "base"

    readonly property var columnOrder: ["left", "monitor", "mid", "feed", "right", "aux"]
    readonly property var workstationIds: [
        "workstation-cpu",
        "workstation-gpu",
        "workstation-ram",
        "workstation-disk",
        "workstation-network",
    ]

    // Stage-mode relocation of the workstation cards (WORKSTATION_MODE_COLUMNS).
    readonly property var monitorModeColumns: ({
        "workstation-cpu": "monitor",
        "workstation-disk": "monitor",
        "workstation-gpu": "mid",
        "workstation-ram": "feed",
        "workstation-network": "feed",
        "stocks": "left",
        "clock": "left",
        "weather": "left",
    })

    // Implemented widgets. `column` is the fallback when the saved config has
    // no assignment (mirrors defaultColumns()/getColumnForWidget()). News
    // categories (cat:*) are appended dynamically from NewsService.
    readonly property var baseRegistry: [
        { id: "clock", source: "ClockWidget.qml", column: "left", props: {} },
        { id: "weather", source: "WeatherWidget.qml", column: "left", props: {} },
        { id: "traffic", source: "TrafficWidget.qml", column: "left", props: {} },
        { id: "stocks", source: "StocksWidget.qml", column: "left", props: {} },
        { id: "calendar", source: "CalendarWidget.qml", column: "mid", props: {} },
        { id: "agenda", source: "AgendaWidget.qml", column: "right", props: {}, resize: true },
        { id: "mail", source: "MailWidget.qml", column: "right", props: {}, resize: true },
        { id: "todo", source: "TodoWidget.qml", column: "right", props: {} },
        { id: "starvis", source: "StarvisWidget.qml", column: "right", props: {} },
        { id: "camera", source: "CameraWidget.qml", column: "left", props: {}, resize: true },
        { id: "pressreader", source: "PressReaderWidget.qml", column: "mid", props: {} },
        { id: "news-3d", source: "NewsStage3D.qml", column: "feed", props: {}, resize: true },
        { id: "euronews", source: "LiveFeedWidget.qml", column: "feed", props: { feedId: "euronews" }, resize: true },
        { id: "live-bloomberg", source: "LiveFeedWidget.qml", column: "aux", props: { feedId: "live-bloomberg" }, resize: true },
        { id: "live-radio-canada", source: "LiveFeedWidget.qml", column: "aux", props: { feedId: "live-radio-canada" }, resize: true },
        { id: "live-france24", source: "LiveFeedWidget.qml", column: "aux", props: { feedId: "live-france24" }, resize: true },
        { id: "live-cbc-news", source: "LiveFeedWidget.qml", column: "aux", props: { feedId: "live-cbc-news" }, resize: true },
        { id: "live-lcn", source: "LiveFeedWidget.qml", column: "aux", props: { feedId: "live-lcn" }, resize: true },
        { id: "workstation-cpu", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "cpu" } },
        { id: "workstation-gpu", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "gpu" } },
        { id: "workstation-ram", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "ram" } },
        { id: "workstation-disk", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "disk" } },
        { id: "workstation-network", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "network" } },
    ]

    readonly property var registry: {
        const entries = baseRegistry.slice()
        for (const label of News.categories) {
            entries.push({
                id: "cat:" + label,
                source: "NewsWidget.qml",
                column: "feed",
                props: { categoryLabel: label },
            })
        }
        return entries
    }

    function parseStored(key, fallback) {
        const raw = Store.get(key)
        if (raw === undefined || raw === null || raw === "")
            return fallback
        if (typeof raw === "string") {
            try { return JSON.parse(raw) } catch (e) { return fallback }
        }
        return raw
    }

    // Bumped whenever the store changes so the Store.get() bindings below
    // re-evaluate (get() is an invokable, not a notifiable property).
    property int storeRev: 0
    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-base-columns" || key === "wp-config" || key === "wp-col-widths")
                root.storeRev++
        }
    }

    readonly property var savedConfig: { storeRev; return parseStored("wp-config", {}) }
    readonly property var savedColumns: savedConfig.columns || {}
    readonly property var savedActiveIds: savedConfig.activeIds || []

    // activeIds gate widget visibility (Manage panel). News categories are
    // already filtered by NewsService, so cat:* entries here are always active.
    readonly property var activeIdSet: {
        const set = {}
        for (const id of savedActiveIds) set[id] = true
        return set
    }
    function isActive(id) {
        if (id.indexOf("cat:") === 0) return true
        // Absent activeIds → everything on (fresh install).
        if (savedActiveIds.length === 0) return true
        return activeIdSet[id] === true
    }

    // Once activeIds exists, it is the user's manage-widget state. Missing or
    // empty activeIds keeps the fresh-install "everything on" behavior above.
    readonly property var savedColWidths: { storeRev; return parseStored("wp-col-widths", {}) }
    readonly property int baseColumnCount: {
        storeRev
        const stored = Number(Store.get("wp-base-columns", 6))
        return Math.max(3, Math.min(columnOrder.length, stored || 6))
    }
    readonly property var visibleColumns: {
        if (mode === "news" || mode === "live")
            return columnOrder
        if (mode === "monitor")
            return ["left", "monitor", "mid", "feed"]
        return columnOrder.slice(0, baseColumnCount)
    }
    readonly property bool workstationVisible: {
        storeRev
        if (mode === "news" || mode === "live")
            return false
        for (const id of workstationIds) {
            if (!isActive(id))
                continue
            const assigned = mode === "monitor"
                ? monitorModeColumns[id]
                : (savedColumns[id] || "monitor")
            if (assigned !== undefined && visibleColumns.indexOf(assigned) >= 0)
                return true
        }
        return false
    }
    onWorkstationVisibleChanged: Workstation.setActive(workstationVisible)
    Component.onCompleted: Workstation.setActive(workstationVisible)

    // ── Card management: drag a card to another column (base mode only) ───────
    property bool dragging: false

    function registryIndex(id) {
        for (let i = 0; i < registry.length; i++) {
            if (registry[i].id === id)
                return i
        }
        return 9999
    }

    function defaultActiveOrder() {
        const ids = []
        for (const entry of registry) {
            if (ids.indexOf(entry.id) < 0)
                ids.push(entry.id)
        }
        return ids
    }

    function activeOrderForWrite() {
        if (savedActiveIds.length > 0)
            return savedActiveIds.slice()
        return defaultActiveOrder()
    }

    function sortWidgets(items) {
        if (savedActiveIds.length === 0)
            return items
        const order = {}
        for (let i = 0; i < savedActiveIds.length; i++)
            order[savedActiveIds[i]] = i
        items.sort((a, b) => {
            const ai = order[a.id] !== undefined ? order[a.id] : 10000 + registryIndex(a.id)
            const bi = order[b.id] !== undefined ? order[b.id] : 10000 + registryIndex(b.id)
            return ai - bi
        })
        return items
    }

    // Scene-x -> column item/name, by hit-testing the laid-out column Flickables.
    function columnItemAt(sceneX) {
        const p = rowLayout.mapFromItem(null, sceneX, 0)
        for (let i = 0; i < rowLayout.children.length; i++) {
            const c = rowLayout.children[i]
            if (c && c.isColumn && p.x >= c.x && p.x < c.x + c.width)
                return c
        }
        return null
    }

    function columnAt(sceneX) {
        const col = columnItemAt(sceneX)
        return col ? col.colName : ""
    }

    function setWidgetPlacement(id, colName, beforeId) {
        const cfg = parseStored("wp-config", {})
        if (!cfg.columns)
            cfg.columns = {}
        cfg.columns[id] = colName

        const nextIds = []
        const currentIds = activeOrderForWrite()
        for (const currentId of currentIds) {
            if (currentId !== id && nextIds.indexOf(currentId) < 0)
                nextIds.push(currentId)
        }
        if (beforeId !== null && beforeId !== "" && beforeId !== id) {
            const targetIndex = nextIds.indexOf(beforeId)
            if (targetIndex >= 0)
                nextIds.splice(targetIndex, 0, id)
            else
                nextIds.push(id)
        } else {
            nextIds.push(id)
        }
        cfg.activeIds = nextIds
        Store.set("wp-config", JSON.stringify(cfg)) // storeRev bump → animated relayout
    }

    function dropWidget(id, sceneX, sceneY) {
        if (mode !== "base")
            return
        const col = columnItemAt(sceneX)
        if (col)
            setWidgetPlacement(id, col.colName, col.beforeIdAt(sceneY, id))
    }

    function widgetsForColumn(name) {
        const result = []
        if (mode === "news") {
            // News stage: categories only, round-robin across all columns.
            const cats = registry.filter(e => e.id.startsWith("cat:"))
            const columnIndex = columnOrder.indexOf(name)
            for (let i = 0; i < cats.length; i++) {
                if (i % columnOrder.length === columnIndex)
                    result.push(cats[i])
            }
            return sortWidgets(result)
        }
        if (mode === "live") {
            // Live stage: all feeds spread over the columns.
            const feeds = registry.filter(e => e.source === "LiveFeedWidget.qml")
            const columnIndex = columnOrder.indexOf(name)
            for (let i = 0; i < feeds.length; i++) {
                if (i % columnOrder.length === columnIndex)
                    result.push(feeds[i])
            }
            return sortWidgets(result)
        }
        for (const entry of registry) {
            if (!isActive(entry.id))
                continue
            let assigned
            if (mode === "monitor") {
                assigned = monitorModeColumns[entry.id]
                if (assigned === undefined)
                    continue
            } else {
                assigned = savedColumns[entry.id] || entry.column
            }
            if (assigned === name)
                result.push(entry)
        }
        return sortWidgets(result)
    }

    RowLayout {
        id: rowLayout
        anchors.fill: parent
        spacing: 6

        Repeater {
            model: root.visibleColumns

            delegate: Flickable {
                id: columnFlick

                required property string modelData
                required property int index

                // Tags for the drag hit-test (columnAt walks rowLayout.children).
                property bool isColumn: true
                property string colName: modelData

                function beforeIdAt(sceneY, draggedId) {
                    const p = columnContent.mapFromItem(null, 0, sceneY)
                    for (let i = 0; i < columnContent.children.length; i++) {
                        const child = columnContent.children[i]
                        if (!child || child.widgetId === undefined || child.widgetId === draggedId)
                            continue
                        if (p.y < child.y + child.height / 2)
                            return child.widgetId
                    }
                    return null
                }

                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredWidth: Number(root.savedColWidths[modelData]) || 240

                // Disable clipping while dragging so a card can visibly cross
                // column boundaries; interaction is frozen mid-drag.
                clip: !root.dragging
                interactive: !root.dragging
                contentHeight: columnContent.height
                boundsBehavior: Flickable.StopAtBounds

                Column {
                    id: columnContent
                    width: columnFlick.width
                    spacing: 6

                    // Fluid relayout when widgets are added or repositioned
                    // (mode switches, column-count changes, future reordering).
                    move: Transition {
                        NumberAnimation {
                            properties: "y"
                            duration: Motion.normalMs
                            easing.type: Easing.BezierSpline
                            easing.bezierCurve: Motion.emphasized
                        }
                    }
                    add: Transition {
                        NumberAnimation {
                            properties: "opacity"
                            from: 0; to: 1
                            duration: Motion.normalMs
                        }
                    }

                    Repeater {
                        // Re-evaluates when the panel mode changes.
                        model: root.mode, root.widgetsForColumn(columnFlick.modelData)

                        delegate: WidgetHost {
                            required property var modelData
                            required property int index
                            source: modelData.source
                            initialProperties: modelData.props
                            stagger: columnFlick.index * 50 + index * 70
                            widgetId: modelData.id
                            columns: root
                            dragEnabled: root.mode === "base"
                            resizable: modelData.resize === true
                        }
                    }
                }
            }
        }
    }
}
