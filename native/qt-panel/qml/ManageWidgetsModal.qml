import QtQuick
import QtQuick.Dialogs
import QtPanel.Native

// Mode-aware widget/category selector. It writes the same wp-config.activeIds
// contract as the Electron CategoryManager, then PanelColumns applies it per
// mode.
Item {
    id: modal
    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0

    property bool open: false
    property string selectedMode: "base"
    property int rev: 0

    readonly property var modes: [
        { id: "base", label: "Base" },
        { id: "news", label: "News" },
        { id: "monitor", label: "Station" },
        { id: "live", label: "Direct" },
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
        { id: "camera-direct", label: "Camera directe", note: "IP camera", color: "#60a5fa", modes: ["base"] },
        { id: "pressreader", label: "PressReader", note: "Brave island", color: "#f7a64f", modes: ["base"] },
        { id: "news-3d", label: "Manchettes 3D", note: "News stage", color: "#4ff7c8", modes: ["base"] },
        { id: "euronews", label: "Euronews", note: "HLS", color: "#1e4ba8", modes: ["base", "live"] },
        { id: "live-bloomberg", label: "Bloomberg Live", note: "YouTube live", color: "#2f6dff", modes: ["base", "live"] },
        { id: "live-radio-canada", label: "Radio-Canada.info", note: "YouTube live", color: "#2f6dff", modes: ["base", "live"] },
        { id: "live-france24", label: "France 24", note: "YouTube live", color: "#2f6dff", modes: ["base", "live"] },
        { id: "live-cbc-news", label: "CBC News", note: "YouTube live", color: "#2f6dff", modes: ["base", "live"] },
        { id: "live-lcn", label: "LCN", note: "HLS", color: "#2f6dff", modes: ["base", "live"] },
        { id: "workstation-cpu", label: "CPU", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-gpu", label: "GPU", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-ram", label: "RAM", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-disk", label: "Disque", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
        { id: "workstation-network", label: "Reseau", note: "Workstation pipe", color: "#53f0c5", modes: ["base", "monitor"] },
    ]

    function show(mode) {
        selectedMode = mode || "base"
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

    function activeIds() {
        const c = config()
        return c.activeIds || []
    }

    function allIds() {
        const ids = []
        for (const entry of catalog)
            ids.push(entry.id)
        for (const label of News.allCategories)
            ids.push("cat:" + label)
        return ids
    }

    function activeListForWrite() {
        const active = activeIds()
        return active.length === 0 ? allIds() : active.slice()
    }

    function isOn(id) {
        const active = activeIds()
        return active.length === 0 || active.indexOf(id) >= 0
    }

    function colorForCategory(index) {
        const palette = ["#4f8ef7", "#5cc8a8", "#b07ef7", "#f7a64f", "#f74f7e", "#4ff7c8", "#c8f74f"]
        return palette[index % palette.length]
    }

    function entriesForMode(mode) {
        if (mode === "news") {
            const cats = []
            for (let i = 0; i < News.allCategories.length; i++) {
                const label = News.allCategories[i]
                cats.push({
                    id: "cat:" + label,
                    label: label,
                    note: "RSS category",
                    color: colorForCategory(i),
                    isCat: true,
                })
            }
            return cats
        }
        const out = []
        for (const entry of catalog) {
            if (entry.modes.indexOf(mode) >= 0)
                out.push(entry)
        }
        return out
    }

    function currentEntries() {
        return entriesForMode(selectedMode)
    }

    function enabledCount(entries) {
        let count = 0
        for (const entry of entries)
            if (isOn(entry.id))
                count++
        return count
    }

    function saveActiveIds(next, reloadNews) {
        const cfg = config()
        cfg.activeIds = next
        Store.set("wp-config", JSON.stringify(cfg))
        rev++
        if (reloadNews)
            News.reload()
    }

    function toggle(id, isCat) {
        const next = activeListForWrite()
        const i = next.indexOf(id)
        if (i >= 0)
            next.splice(i, 1)
        else
            next.push(id)
        saveActiveIds(next, isCat)
    }

    function setEntriesOn(entries, on) {
        let next = activeListForWrite()
        let reloadNews = false
        for (const entry of entries) {
            const i = next.indexOf(entry.id)
            if (on && i < 0)
                next.push(entry.id)
            if (!on && i >= 0)
                next.splice(i, 1)
            if (entry.isCat)
                reloadNews = true
        }
        saveActiveIds(next, reloadNews)
    }

    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-config")
                modal.rev++
        }
    }

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.62)
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
                Item { width: parent.width - x - closeBtn.width; height: 1 }
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
                        width: (parent.width - 12) / 4
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
                                color: (modal.rev, modal.isOn(modelData.id)) ? Theme.accent : Qt.rgba(1,1,1,0.12)
                                Rectangle {
                                    width: 14; height: 14; radius: 7; y: 2
                                    x: (modal.rev, modal.isOn(modelData.id)) ? parent.width - width - 2 : 2
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
                                onClicked: modal.toggle(modelData.id, modelData.isCat === true)
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
