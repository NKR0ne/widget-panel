import QtQuick
import QtQuick.Layouts
import QtPanel.Native

// Lays the implemented widgets out into the saved Electron column assignment:
// wp-config.columns (widget id → column), wp-col-widths (per-column px used as
// flex weights), wp-base-columns (legacy key shared by every workspace).
Item {
    id: root

    property string mode: "base"
    readonly property real spotlightX: Math.round(width / 2) + 3
    opacity: 1
    transform: Translate { id: modeShift; y: 0 }

    onModeChanged: {
        modeEntrance.stop()
        root.opacity = 0
        modeShift.y = 8
        modeEntrance.start()
    }

    ParallelAnimation {
        id: modeEntrance
        NumberAnimation {
            target: root
            property: "opacity"
            to: 1
            duration: Motion.normalMs
            easing.type: Easing.OutCubic
        }
        NumberAnimation {
            target: modeShift
            property: "y"
            to: 0
            duration: Motion.deliberateMs
            easing.type: Easing.BezierSpline
            easing.bezierCurve: Motion.emphasized
        }
    }

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
        { id: "stocks", source: "StocksWidget.qml", column: "left", props: {}, resize: true, minHeight: 260 },
        { id: "calendar", source: "CalendarWidget.qml", column: "mid", props: {} },
        { id: "agenda", source: "AgendaWidget.qml", column: "right", props: {}, resize: true },
        { id: "mail", source: "MailWidget.qml", column: "right", props: {}, resize: true },
        { id: "todo", source: "TodoWidget.qml", column: "right", props: {} },
        { id: "starvis", source: "StarvisWidget.qml", column: "right", props: {} },
        { id: "camera", source: "CameraWidget.qml", column: "left", props: {}, resize: true },
        { id: "camera-direct", source: "DirectCameraWidget.qml", column: "left", props: {}, resize: true },
        { id: "workstation-cpu", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "cpu" } },
        { id: "workstation-gpu", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "gpu" } },
        { id: "workstation-ram", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "ram" } },
        { id: "workstation-disk", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "disk" } },
        { id: "workstation-network", source: "WorkstationWidget.qml", column: "monitor", props: { kind: "network" } },
    ]

    // Stage cards are owned by their stage and never leak into Base columns.
    readonly property var registry: baseRegistry

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
    readonly property var allowedBaseIds: baseRegistry.map(entry => entry.id)
    readonly property var allowedMonitorIds: Object.keys(monitorModeColumns)
    readonly property var savedActiveIds: ModeSettings.activeIds(
        savedConfig, "base", allowedBaseIds)
    readonly property var monitorActiveIds: ModeSettings.activeIds(
        savedConfig, "monitor", allowedMonitorIds)

    // Base and Performance selections are independent even for shared cards.
    readonly property var activeIdSet: {
        const set = {}
        for (const id of savedActiveIds) set[id] = true
        return set
    }
    readonly property var monitorActiveIdSet: {
        const set = {}
        for (const id of monitorActiveIds) set[id] = true
        return set
    }
    function isActive(id) {
        return activeIdSet[id] === true
    }

    readonly property var savedColWidths: { storeRev; return parseStored("wp-col-widths", {}) }
    readonly property int baseColumnCount: {
        storeRev
        const stored = Number(Store.get("wp-base-columns", 3))
        return Math.max(3, Math.min(columnOrder.length, stored || 3))
    }
    readonly property var visibleColumns: {
        return columnOrder.slice(0, baseColumnCount)
    }
    readonly property bool workstationVisible: {
        storeRev
        if (mode === "news")
            return false
        if (mode === "monitor") {
            for (const id of workstationIds) {
                if (monitorActiveIdSet[id] === true)
                    return true
            }
            return false
        }
        for (const id of workstationIds) {
            if (!isActive(id))
                continue
            const assigned = savedColumns[id] || "monitor"
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
        ModeSettings.initialize(cfg, ({ base: allowedBaseIds }))
        cfg.modeActiveIds.base = nextIds
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
        if (mode === "base") {
            for (const entry of registry) {
                if (!isActive(entry.id))
                    continue
                const assigned = savedColumns[entry.id] || entry.column
                if (assigned === name)
                    result.push(entry)
            }
            return sortWidgets(result)
        }
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
        return sortWidgets(result)
    }

    Loader {
        anchors.fill: parent
        active: root.mode === "monitor"
        visible: active
        source: "MonitorStage.qml"
    }

    function setColumnWidth(name, width) {
        const next = parseStored("wp-col-widths", {})
        next[name] = Math.round(Math.max(160, Math.min(520, width)))
        Store.set("wp-col-widths", JSON.stringify(next))
        // Column widths changed: recompute the base width from them.
        Panel.fitMode("base", baseColumnCount, next, true)
    }

    Loader {
        id: newsStageLoader
        anchors.fill: parent
        active: root.mode === "news"
        visible: active
        source: "NewsStage.qml"
    }

    RowLayout {
        id: rowLayout
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: root.mode === "base" && Panel.islandOpen
               ? Math.max(0, root.spotlightX - 6) : root.width
        spacing: 6
        visible: root.mode === "base"

        Repeater {
            model: rowLayout.visible ? root.visibleColumns : []

            delegate: Flickable {
                id: columnFlick

                required property string modelData
                required property int index

                // Tags for the drag hit-test (columnAt walks rowLayout.children).
                property bool isColumn: true
                property string colName: modelData
                property real manualWidth: 0

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
                Layout.preferredWidth: manualWidth > 0 ? manualWidth
                    : (Number(root.savedColWidths[modelData]) || 240)

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
                            titleDragEnabled: modelData.titleDrag !== false
                            resizable: modelData.resize === true
                            minimumUserHeight: Number(modelData.minHeight || 120)
                        }
                    }
                }

                // Sits INSIDE the column, flush against its right edge. It was
                // centred on parent.right + half the spacing, which reads as the
                // obvious way to put it on the seam -- but the column Flickable
                // clips, and Qt delivers nothing to a child outside a clipping
                // parent. Nine of the twelve px fell outside, leaving a 3px grab
                // band, and the accent bar at the handle's centre was clipped
                // away entirely, so there was no hover feedback either. Measured
                // on a 314px column: handle at 319..331, clip ending at 322.
                //
                // Keeping the whole width inside makes all 12px catchable; the
                // bar is anchored to the handle's right edge so it still draws
                // on the column boundary.
                Item {
                    id: columnResizeHandle
                    visible: columnFlick.index < root.visibleColumns.length - 1
                    width: 12
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    anchors.right: parent.right
                    z: 20

                    Rectangle {
                        anchors.right: parent.right
                        width: 2
                        height: parent.height
                        radius: 1
                        color: Theme.accent
                        opacity: columnResize.active ? 0.9
                               : columnResizeHover.hovered ? 0.55 : 0
                        Behavior on opacity { NumberAnimation { duration: Motion.fastMs } }
                    }

                    HoverHandler { id: columnResizeHover; cursorShape: Qt.SizeHorCursor }
                    DragHandler {
                        id: columnResize
                        target: null
                        xAxis.enabled: true
                        yAxis.enabled: false
                        property real startWidth: 0
                        onActiveChanged: {
                            if (active) {
                                startWidth = columnFlick.width
                                columnFlick.manualWidth = startWidth
                            } else if (columnFlick.manualWidth > 0) {
                                root.setColumnWidth(columnFlick.modelData, columnFlick.manualWidth)
                                columnFlick.manualWidth = 0
                            }
                        }
                        onActiveTranslationChanged: {
                            if (active)
                                columnFlick.manualWidth = Math.max(160,
                                    Math.min(520, startWidth + activeTranslation.x))
                        }
                    }
                }
            }
        }
    }

    WebIsland {
        x: root.spotlightX
        y: 0
        width: Math.max(0, root.width - x)
        height: root.height
    }

    // One PressReader web view for the whole app. In news mode it is seated
    // inside the stage's content pane; elsewhere it stays the right-hand
    // spotlight surface.
    PressReaderSpotlight {
        id: pressReaderSurface
        readonly property bool newsInline: root.mode === "news"
            && newsStageLoader.item !== null
            && newsStageLoader.item.pressReaderSelected === true

        inlineRequest: newsInline
        x: newsInline ? newsStageLoader.item.contentPaneX : root.spotlightX
        y: newsInline ? newsStageLoader.item.contentPaneY : 0
        width: newsInline ? newsStageLoader.item.contentPaneWidth
                          : Math.max(0, root.width - x)
        height: newsInline ? newsStageLoader.item.contentPaneHeight : root.height
    }
}
