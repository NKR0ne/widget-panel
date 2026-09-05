import QtQuick
import QtQuick.Dialogs
import QtPanel.Native

// Mode-aware widget/category selector. Each workspace owns an explicit card
// selection; the legacy activeIds list is only used to initialize old profiles.
Item {
    id: modal
    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0

    property bool open: false
    // Panel content to blur behind the sheet; set by PanelSurface.
    property Item backdropSource: null
    property string selectedMode: "base"
    property int rev: 0

    readonly property var modes: [
        { id: "base", label: "Base" },
        { id: "news", label: "Nouvelles" },
        // Label only — the persisted mode id stays "monitor".
        { id: "monitor", label: "Performance" },
    ]

    readonly property var catalog: [
        { id: "weather", label: "Previsions", note: "Open-Meteo", color: "#f7c94f", modes: ["base", "monitor"] },
        { id: "traffic", label: "Circulation", note: "TomTom", color: "#f77f4f", modes: ["base"] },
        { id: "stocks", label: "Marches", note: "Yahoo/Finnhub/TradingView", color: "#5cc8a8", modes: ["base", "monitor"] },
        { id: "calendar", label: "Calendrier", note: "Local", color: "#b07ef7", modes: ["base"] },
        { id: "clock", label: "Horloge", note: "Local", color: "#e8e8f0", modes: ["base", "monitor"] },
        { id: "agenda", label: "Outlook Agenda", note: "Microsoft Graph", color: "#0078d4", modes: ["base"] },
        { id: "mail", label: "Outlook Mail", note: "Microsoft Graph", color: "#0078d4", modes: ["base"] },
        { id: "todo", label: "Microsoft To-Do", note: "Microsoft Graph", color: "#2564cf", modes: ["base"] },
        { id: "starvis", label: "Starvis", note: "AI assistant", color: "#62e6ff", modes: ["base"] },
        { id: "camera", label: "Camera", note: "XProtect", color: "#5e8af5", modes: ["base"] },
        { id: "camera-direct", label: "Camera directe", note: "RTSP natif", color: "#60a5fa", modes: ["base"] },
        { id: "euronews", label: "Euronews", note: "En direct | HLS", color: "#1e4ba8", modes: ["live"] },
        { id: "live-bloomberg", label: "Bloomberg Live", note: "En direct | YouTube", color: "#2f6dff", modes: ["live"] },
        { id: "live-radio-canada", label: "Radio-Canada.info", note: "En direct | Pluto TV", color: "#2f6dff", modes: ["live"] },
        { id: "live-france24", label: "France 24", note: "En direct | YouTube", color: "#2f6dff", modes: ["live"] },
        { id: "live-cbc-news", label: "CBC News", note: "En direct | YouTube", color: "#2f6dff", modes: ["live"] },
        { id: "live-lcn", label: "LCN", note: "En direct | HLS", color: "#2f6dff", modes: ["live"] },
        { id: "workstation-cpu", label: "CPU", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-gpu", label: "GPU", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-ram", label: "RAM", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-disk", label: "Disque", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-network", label: "Reseau", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
    ]

    function show(mode) {
        selectedMode = mode === "live" ? "news" : (mode || "base")
        open = true
        Panel.setModalOpen(true)
    }

    function dismiss() {
        open = false
        Panel.setModalOpen(false)
    }

    function config() {
        rev
        let c = {}
        try { c = JSON.parse(Store.get("wp-config", "{}")) } catch (e) {}
        return c
    }

    function colorForCategory(index) {
        const palette = ["#4f8ef7", "#5cc8a8", "#b07ef7", "#f7a64f", "#f74f7e", "#4ff7c8", "#c8f74f"]
        return palette[index % palette.length]
    }

    function entriesForMode(mode) {
        if (mode === "news") {
            const entries = []
            for (let i = 0; i < News.allCategories.length; i++) {
                const label = News.allCategories[i]
                entries.push({
                    id: "cat:" + label,
                    label: label,
                    note: "Cartes et lecture | RSS",
                    color: colorForCategory(i),
                    isCat: true,
                    settingsMode: "news",
                })
            }
            for (const entry of catalog) {
                if (entry.modes.indexOf("live") < 0)
                    continue
                entries.push({
                    id: entry.id,
                    label: entry.label,
                    note: entry.note,
                    color: entry.color,
                    settingsMode: "live",
                })
            }
            return entries
        }
        const out = []
        for (const entry of catalog) {
            if (entry.modes.indexOf(mode) >= 0)
                out.push({
                    id: entry.id,
                    label: entry.label,
                    note: entry.note,
                    color: entry.color,
                    settingsMode: mode,
                })
        }
        return out
    }

    function currentEntries() {
        return entriesForMode(selectedMode)
    }

    function idsForSettingsMode(mode) {
        const ids = []
        if (mode === "news") {
            for (const label of News.allCategories)
                ids.push("cat:" + label)
            return ids
        }
        if (mode === "live") {
            for (const entry of catalog) {
                if (entry.modes.indexOf("live") >= 0)
                    ids.push(entry.id)
            }
            return ids
        }
        for (const entry of entriesForMode(mode)) {
            if ((entry.settingsMode || mode) === mode)
                ids.push(entry.id)
        }
        return ids
    }

    function allowedIdsByMode() {
        return {
            base: idsForSettingsMode("base"),
            news: idsForSettingsMode("news"),
            monitor: idsForSettingsMode("monitor"),
            live: idsForSettingsMode("live"),
        }
    }

    function activeIds(mode) {
        const targetMode = mode || selectedMode
        return ModeSettings.activeIds(config(), targetMode,
                                      idsForSettingsMode(targetMode))
    }

    function activeListForWrite(mode) {
        return activeIds(mode || selectedMode).slice()
    }

    function isOn(entry) {
        const mode = entry.settingsMode || selectedMode
        return activeIds(mode).indexOf(entry.id) >= 0
    }

    function enabledCount(entries) {
        let count = 0
        for (const entry of entries)
            if (isOn(entry))
                count++
        return count
    }

    function saveActiveIds(next, reloadNews, mode) {
        const targetMode = mode || selectedMode
        const cfg = ModeSettings.initialize(config(), allowedIdsByMode())
        cfg.modeActiveIds[targetMode] = ModeSettings.sanitizedIds(
                    next, idsForSettingsMode(targetMode))
        Store.set("wp-config", JSON.stringify(cfg))
        rev++
        if (reloadNews)
            News.reload()
    }

    function toggle(entry) {
        const mode = entry.settingsMode || selectedMode
        const next = activeListForWrite(mode)
        const i = next.indexOf(entry.id)
        if (i >= 0)
            next.splice(i, 1)
        else
            next.push(entry.id)
        saveActiveIds(next, entry.isCat === true, mode)
    }

    function setEntriesOn(entries, on) {
        const cfg = ModeSettings.initialize(config(), allowedIdsByMode())
        const nextByMode = {}
        let reloadNews = false
        for (const entry of entries) {
            const mode = entry.settingsMode || selectedMode
            if (nextByMode[mode] === undefined)
                nextByMode[mode] = ModeSettings.activeIds(
                            cfg, mode, idsForSettingsMode(mode)).slice()
            const next = nextByMode[mode]
            const i = next.indexOf(entry.id)
            if (on && i < 0)
                next.push(entry.id)
            if (!on && i >= 0)
                next.splice(i, 1)
            if (entry.isCat)
                reloadNews = true
        }
        for (const mode in nextByMode) {
            cfg.modeActiveIds[mode] = ModeSettings.sanitizedIds(
                        nextByMode[mode], idsForSettingsMode(mode))
        }
        Store.set("wp-config", JSON.stringify(cfg))
        rev++
        if (reloadNews)
            News.reload()
    }

    function resetLayout() {
        const cfg = config()
        cfg.columns = {}
        Store.set("wp-config", JSON.stringify(cfg))
        Store.set("wp-col-widths", "{}")
        Store.set("wp-expanded", "{}")
        Ui.notify("Disposition r\u00e9initialis\u00e9e", "success")
    }

    function currentNewsSubMode() {
        const stored = String(Store.get("wp-news-view-mode", "carousel") || "carousel")
        return stored === "reader" || stored === "live"
               || stored === "pressreader" ? stored : "carousel"
    }

    function newsColumnKey(mode) {
        return "wp-news-columns-" + mode
    }

    function newsColumnCount(mode) {
        const baseCount = Number(Store.get("wp-base-columns", 3)) || 3
        const legacy = Number(Store.get("wp-news-columns", baseCount)) || baseCount
        return Number(Store.get(newsColumnKey(mode), legacy)) || legacy
    }

    function allNewsColumnCounts() {
        return {
            carousel: newsColumnCount("carousel"),
            reader: newsColumnCount("reader"),
            live: newsColumnCount("live"),
            pressreader: newsColumnCount("pressreader"),
        }
    }

    function columnCountForMode(mode) {
        if (mode === "monitor" || mode === "live")
            return 6
        const baseCount = Number(Store.get("wp-base-columns", 3)) || 3
        if (mode === "news")
            return newsColumnCount(currentNewsSubMode())
        return baseCount
    }

    function saveLayoutPreset() {
        let widths = {}
        try { widths = JSON.parse(Store.get("wp-col-widths", "{}")) } catch (e) {}
        const cfg = config()
        Store.set("wp-layout-preset-" + selectedMode, JSON.stringify({
            columns: cfg.columns || {},
            widths: widths,
            columnCount: columnCountForMode(selectedMode),
            newsColumnCounts: selectedMode === "news"
                              ? allNewsColumnCounts() : undefined,
        }))
        Ui.notify("Disposition enregistr\u00e9e", "success")
    }

    function restoreLayoutPreset() {
        let preset = null
        try { preset = JSON.parse(Store.get("wp-layout-preset-" + selectedMode, "")) } catch (e) {}
        if (!preset) {
            Ui.notify("Aucune disposition enregistr\u00e9e", "warning")
            return
        }
        const cfg = config()
        cfg.columns = preset.columns || {}
        Store.set("wp-config", JSON.stringify(cfg))
        Store.set("wp-col-widths", JSON.stringify(preset.widths || {}))
        const savedCount = preset.columnCount || preset.baseColumns
        if (selectedMode === "news" && preset.newsColumnCounts) {
            const counts = preset.newsColumnCounts
            for (const subMode of ["carousel", "reader", "live", "pressreader"]) {
                if (counts[subMode] !== undefined) {
                    Store.set(newsColumnKey(subMode),
                              Math.max(3, Math.min(6, Number(counts[subMode]))))
                }
            }
        }
        if (savedCount) {
            const count = Math.max(3, Math.min(6, Number(savedCount)))
            if (selectedMode === "news")
                Store.set(newsColumnKey(currentNewsSubMode()), count)
            else if (selectedMode === "base")
                Store.set("wp-base-columns", count)
            // A restored preset carries its own column widths, so the mode's
            // remembered window width is recomputed from them.
            Panel.fitMode(selectedMode,
                          selectedMode === "monitor" || selectedMode === "live" ? 6 : count,
                          preset.widths || {}, true)
        }
        Ui.notify("Disposition restaur\u00e9e", "success")
    }

    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-config")
                modal.rev++
        }
    }

    ScrimBackdrop {
        anchors.fill: parent
        source: modal.backdropSource
        active: modal.open
        dim: 0.62
        MouseArea { anchors.fill: parent; enabled: modal.open; onClicked: modal.dismiss() }
    }

    Rectangle {
        id: panel
        anchors.centerIn: parent
        width: Math.min(620, parent.width - 48)
        height: Math.min(620, parent.height - 48)
        radius: Theme.radiusPanel
        color: "#15181f"
        border.color: Theme.cardStroke
        scale: modal.open ? 1 : 0.96
        Behavior on scale { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
        MouseArea { anchors.fill: parent }

        Column {
            anchors.fill: parent
            anchors.margins: 18
            spacing: 12

            Row {
                width: parent.width
                Text {
                    text: "Selection widgets"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                }
                Item { width: parent.width - x - saveButton.width - restoreButton.width
                              - resetButton.width - closeBtn.width - 12; height: 1 }
                IconButton {
                    id: saveButton
                    glyph: "\uE74E"
                    tooltip: "Enregistrer cette disposition"
                    onClicked: modal.saveLayoutPreset()
                }
                IconButton {
                    id: restoreButton
                    glyph: "\uE72C"
                    tooltip: "Restaurer la disposition enregistr\u00e9e"
                    onClicked: modal.restoreLayoutPreset()
                }
                IconButton {
                    id: resetButton
                    glyph: "\uE777"
                    tooltip: "R\u00e9initialiser la disposition"
                    onClicked: modal.resetLayout()
                }
                IconButton { id: closeBtn; glyph: ""; onClicked: modal.dismiss() }
            }

            Row {
                width: parent.width
                height: 24
                spacing: 4
                Repeater {
                    model: modal.modes
                    delegate: Rectangle {
                        required property var modelData
                        width: (parent.width - Math.max(0, modal.modes.length - 1) * 4)
                               / Math.max(1, modal.modes.length)
                        height: 24
                        radius: 6
                        color: modal.selectedMode === modelData.id ? Theme.activeFill
                             : tabMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: modal.selectedMode === modelData.id ? Theme.accent : Theme.cardStroke
                        Text {
                            anchors.centerIn: parent
                            text: modelData.label
                            color: modal.selectedMode === modelData.id ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 10
                            elide: Text.ElideRight
                        }
                        MouseArea {
                            id: tabMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: modal.selectedMode = modelData.id
                        }
                    }
                }
            }

            Row {
                id: actionRow
                width: parent.width
                spacing: 6
                property var entries: modal.currentEntries()
                Text {
                    width: Math.max(80, parent.width - enableAll.width - disableAll.width - 14)
                    text: modal.enabledCount(parent.entries) + "/" + parent.entries.length + " actifs"
                    color: Theme.textSecondary
                    font.pixelSize: 10
                    elide: Text.ElideRight
                    anchors.verticalCenter: parent.verticalCenter
                }
                Rectangle {
                    id: enableAll
                    width: enableAllLabel.implicitWidth + 18; height: 24; radius: 6
                    color: enableAllMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: enableAllLabel; anchors.centerIn: parent; text: "Tout activer"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: enableAllMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: modal.setEntriesOn(actionRow.entries, true)
                    }
                }
                Rectangle {
                    id: disableAll
                    width: disableAllLabel.implicitWidth + 18; height: 24; radius: 6
                    color: disableAllMouse.containsMouse ? Qt.rgba(0.97,0.45,0.45,0.22) : Qt.rgba(1,1,1,0.05)
                    border.color: Qt.rgba(0.97,0.45,0.45,0.35)
                    Text { id: disableAllLabel; anchors.centerIn: parent; text: "Tout masquer"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: disableAllMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: modal.setEntriesOn(actionRow.entries, false)
                    }
                }
            }

            Flickable {
                id: listFlick
                width: parent.width
                height: parent.height - y - opmlButton.height - 10
                clip: true
                contentHeight: listCol.height
                boundsBehavior: Flickable.StopAtBounds

                Column {
                    id: listCol
                    width: listFlick.width
                    spacing: 4
                    Repeater {
                        model: modal.currentEntries()
                        delegate: Rectangle {
                            required property var modelData
                            width: listCol.width
                            height: 42
                            radius: 7
                            color: rowMouse.containsMouse ? Theme.hover : "transparent"
                            border.color: Theme.cardStroke

                            Rectangle {
                                width: 7; height: 7; radius: 3.5
                                x: 8
                                anchors.verticalCenter: parent.verticalCenter
                                color: modelData.color
                            }
                            Column {
                                x: 24
                                width: Math.max(80, parent.width - x - toggleBox.width - 18)
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 1
                                Text {
                                    width: parent.width
                                    text: modelData.label
                                    color: Theme.textPrimary
                                    font.pixelSize: Theme.fontSizeBody
                                    elide: Text.ElideRight
                                }
                                Text {
                                    width: parent.width
                                    text: modelData.note
                                    color: Theme.textSecondary
                                    font.pixelSize: 9
                                    elide: Text.ElideRight
                                }
                            }
                            Rectangle {
                                id: toggleBox
                                width: 34; height: 18; radius: 9
                                anchors.right: parent.right
                                anchors.rightMargin: 8
                                anchors.verticalCenter: parent.verticalCenter
                                color: (modal.rev, modal.isOn(modelData)) ? Theme.accent : Qt.rgba(1,1,1,0.12)
                                Rectangle {
                                    width: 14; height: 14; radius: 7; y: 2
                                    x: (modal.rev, modal.isOn(modelData)) ? parent.width - width - 2 : 2
                                    color: "#ffffff"
                                    Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                                }
                                Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                            }
                            MouseArea {
                                id: rowMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: modal.toggle(modelData)
                            }
                        }
                    }
                }
            }

            Rectangle {
                id: opmlButton
                width: opmlLabel.implicitWidth + 24
                height: 30
                radius: 7
                color: opmlMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                Text {
                    id: opmlLabel
                    anchors.centerIn: parent
                    text: "Charger un OPML"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: opmlMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: opmlDialog.open()
                }
            }
        }
    }

    FileDialog {
        id: opmlDialog
        title: "Choisir un fichier OPML"
        nameFilters: ["OPML (*.opml *.xml)", "Tous (*)"]
        onAccepted: {
            const n = News.importOpml(selectedFile)
            if (n > 0) {
                selectedMode = "news"
                rev++
            }
        }
    }
}
