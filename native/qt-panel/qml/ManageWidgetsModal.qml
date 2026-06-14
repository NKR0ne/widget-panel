import QtQuick
import QtQuick.Dialogs
import QtPanel.Native

// Enable/disable widgets and news categories (writes wp-config.activeIds), and
// import a new Feedly OPML. Port of the Electron CategoryManager.
Item {
    id: modal
    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0
    property bool open: false

    function show() { open = true; Panel.setModalOpen(true) }
    function dismiss() { open = false; Panel.setModalOpen(false) }

    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }

    // System widget catalog (mirrors renderer/config/widgets.js SYS + qt-panel extras).
    readonly property var catalog: [
        { id: "weather", label: "Prévisions" },
        { id: "traffic", label: "Circulation" },
        { id: "stocks", label: "Marchés" },
        { id: "calendar", label: "Calendrier" },
        { id: "clock", label: "Horloge" },
        { id: "agenda", label: "Outlook Agenda" },
        { id: "mail", label: "Outlook Mail" },
        { id: "todo", label: "Microsoft To-Do" },
        { id: "starvis", label: "Starvis" },
        { id: "camera", label: "Caméra" },
        { id: "pressreader", label: "PressReader" },
        { id: "euronews", label: "Euronews" },
        { id: "news-3d", label: "Manchettes 3D" },
        { id: "live-bloomberg", label: "Bloomberg Live" },
        { id: "live-radio-canada", label: "Radio-Canada.info" },
        { id: "live-france24", label: "France 24" },
        { id: "live-cbc-news", label: "CBC News" },
        { id: "live-lcn", label: "LCN" },
        { id: "workstation-cpu", label: "CPU" },
        { id: "workstation-gpu", label: "GPU" },
        { id: "workstation-ram", label: "RAM" },
        { id: "workstation-disk", label: "Disque" },
        { id: "workstation-network", label: "Réseau" },
    ]

    property int rev: 0
    function config() { rev; let c = {}; try { c = JSON.parse(Store.get("wp-config", "{}")) } catch (e) {} return c }
    function activeIds() { const c = config(); return c.activeIds || [] }
    function allIds() {
        const ids = []
        for (const entry of catalog)
            ids.push(entry.id)
        for (const label of News.allCategories)
            ids.push("cat:" + label)
        return ids
    }
    function isOn(id) { const a = activeIds(); return a.length === 0 || a.indexOf(id) >= 0 }
    function toggle(id, isCat) {
        const c = config()
        let a = c.activeIds || []
        if (a.length === 0)
            a = allIds()
        else
            a = a.slice()
        const i = a.indexOf(id)
        if (i >= 0) a.splice(i, 1); else a.push(id)
        c.activeIds = a
        Store.set("wp-config", JSON.stringify(c))
        rev++
        if (isCat) News.reload()
    }

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.6)
        MouseArea { anchors.fill: parent; enabled: modal.open; onClicked: modal.dismiss() }
    }

    Rectangle {
        anchors.centerIn: parent
        width: Math.min(560, parent.width - 48)
        height: Math.min(560, parent.height - 48)
        radius: Theme.radiusPanel
        color: "#15181f"
        border.color: Theme.cardStroke
        scale: modal.open ? 1 : 0.96
        Behavior on scale { NumberAnimation { duration: Motion.normalMs; easing.type: Easing.OutCubic } }
        MouseArea { anchors.fill: parent }

        Column {
            anchors.fill: parent
            anchors.margins: 18
            spacing: 14

            Row {
                width: parent.width
                Text {
                    text: "Gérer les widgets"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                }
                Item { width: parent.width - x - mClose.width; height: 1 }
                IconButton { id: mClose; glyph: ""; onClicked: modal.dismiss() }
            }

            Row {
                width: parent.width
                height: parent.height - 90
                spacing: 18

                // System widgets
                Flickable {
                    width: (parent.width - 18) / 2
                    height: parent.height
                    clip: true
                    contentHeight: sysCol.height
                    Column {
                        id: sysCol
                        width: parent.width
                        spacing: 0
                        Text {
                            text: "WIDGETS"; color: Theme.textSecondary; font.pixelSize: 10
                            font.letterSpacing: 1; bottomPadding: 8
                        }
                        Repeater {
                            model: modal.catalog
                            delegate: Row {
                                required property var modelData
                                width: sysCol.width
                                height: 34
                                spacing: 8
                                Text {
                                    width: parent.width - tg.width - 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData.label
                                    color: Theme.textPrimary
                                    font.pixelSize: Theme.fontSizeBody
                                    elide: Text.ElideRight
                                }
                                Rectangle {
                                    id: tg
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: 30; height: 16; radius: 8
                                    color: (modal.rev, modal.isOn(modelData.id)) ? Theme.accent : Qt.rgba(1,1,1,0.12)
                                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                                    Rectangle {
                                        width: 12; height: 12; radius: 6; y: 2
                                        x: (modal.rev, modal.isOn(modelData.id)) ? parent.width - 14 : 2
                                        color: "#fff"
                                        Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                                    }
                                    MouseArea {
                                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                        onClicked: modal.toggle(modelData.id, false)
                                    }
                                }
                            }
                        }
                    }
                }

                Rectangle { width: 1; height: parent.height; color: Theme.cardStroke }

                // News categories
                Flickable {
                    width: (parent.width - 18) / 2 - 1
                    height: parent.height
                    clip: true
                    contentHeight: catCol.height
                    Column {
                        id: catCol
                        width: parent.width
                        spacing: 0
                        Text {
                            text: "CATÉGORIES"; color: Theme.textSecondary; font.pixelSize: 10
                            font.letterSpacing: 1; bottomPadding: 8
                        }
                        Repeater {
                            model: News.allCategories
                            delegate: Row {
                                required property string modelData
                                width: catCol.width
                                height: 34
                                spacing: 8
                                Text {
                                    width: parent.width - ctg.width - 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData
                                    color: Theme.textPrimary
                                    font.pixelSize: Theme.fontSizeBody
                                    elide: Text.ElideRight
                                }
                                Rectangle {
                                    id: ctg
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: 30; height: 16; radius: 8
                                    color: (modal.rev, modal.isOn("cat:" + modelData)) ? Theme.accent : Qt.rgba(1,1,1,0.12)
                                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                                    Rectangle {
                                        width: 12; height: 12; radius: 6; y: 2
                                        x: (modal.rev, modal.isOn("cat:" + modelData)) ? parent.width - 14 : 2
                                        color: "#fff"
                                        Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                                    }
                                    MouseArea {
                                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                        onClicked: modal.toggle("cat:" + modelData, true)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Rectangle {
                width: opmlLabel.implicitWidth + 24
                height: 30
                radius: 7
                color: opmlMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                Text {
                    id: opmlLabel; anchors.centerIn: parent; text: "Charger un OPML…"
                    color: Theme.textPrimary; font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: opmlMouse; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor; onClicked: opmlDialog.open()
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
            if (n > 0) modal.rev++
        }
    }
}
