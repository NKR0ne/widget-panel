import QtQuick
import QtPanel.Native

// Live traffic via TomTom raster tiles (base map + traffic-flow overlay),
// centered on wp-location. Native equivalent of the Electron TomTom iframe;
// tap opens the full interactive map in a brave-host island.
GlassCard {
    id: card
    title: "Circulation"
    implicitHeight: body.implicitHeight + 24

    property int vaultRev: 0
    property string apiKey: { vaultRev; return Vault.get("tomtom-key") }
    property int storeRev: 0
    Connections {
        target: Vault
        function onChanged(key) {
            if (key === "tomtom-key")
                card.vaultRev++
        }
    }
    Connections {
        target: Store
        function onChanged(key) { if (key === "wp-location" || key === "wp-traffic-zoom" || key === "wp-traffic-theme") card.storeRev++ }
    }

    function loc() {
        storeRev
        let raw = Store.get("wp-location", "")
        try { return typeof raw === "string" ? JSON.parse(raw) : raw } catch (e) {}
        return { name: "Québec", lat: 46.81, lon: -71.21 }
    }
    property var location: loc()
    property int zoom: { storeRev; return Math.max(6, Math.min(15, Number(Store.get("wp-traffic-zoom", 11)) || 11)) }
    property string theme: { storeRev; return Store.get("wp-traffic-theme", "auto") }
    readonly property bool night: theme === "night"
        || (theme === "auto" && (new Date().getHours() >= 20 || new Date().getHours() < 6))

    // lon/lat → slippy tile x/y at the current zoom.
    readonly property int n: Math.pow(2, zoom)
    readonly property int tileX: Math.floor((location.lon + 180) / 360 * n)
    readonly property int tileY: {
        const r = location.lat * Math.PI / 180
        return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)
    }

    function setZoom(z) { Store.set("wp-traffic-zoom", Math.max(6, Math.min(15, z))) }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        Row {
            width: parent.width
            spacing: 6
            Text {
                text: card.title; color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase; font.letterSpacing: 1.2
            }
            Item { width: parent.width - x - themeRow.width; height: 1 }
            Row {
                id: themeRow
                spacing: 2
                visible: card.apiKey !== ""
                Repeater {
                    model: [{ id: "auto", l: "Auto" }, { id: "day", l: "Jour" }, { id: "night", l: "Nuit" }]
                    delegate: Rectangle {
                        required property var modelData
                        width: tl.implicitWidth + 10; height: 16; radius: 4
                        color: card.theme === modelData.id ? Theme.activeFill : "transparent"
                        Text { id: tl; anchors.centerIn: parent; text: modelData.l
                               color: card.theme === modelData.id ? Theme.textPrimary : Theme.textSecondary
                               font.pixelSize: 9 }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: Store.set("wp-traffic-theme", modelData.id) }
                    }
                }
            }
        }

        // Map tile (base + traffic overlay)
        Rectangle {
            width: parent.width
            height: Math.round(width * 0.66)
            radius: 8
            color: "#0a0a0c"
            clip: true
            visible: card.apiKey !== ""

            Image {
                id: baseTile
                anchors.fill: parent
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: true
                source: card.apiKey === "" ? "" :
                    "https://api.tomtom.com/map/1/tile/basic/" + (card.night ? "night" : "main")
                    + "/" + card.zoom + "/" + card.tileX + "/" + card.tileY
                    + ".png?tileSize=512&key=" + card.apiKey
            }
            Image {
                anchors.fill: parent
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: true
                source: card.apiKey === "" ? "" :
                    "https://api.tomtom.com/traffic/map/4/tile/flow/"
                    + (card.night ? "relative0-dark" : "relative0")
                    + "/" + card.zoom + "/" + card.tileX + "/" + card.tileY
                    + ".png?tileSize=512&key=" + card.apiKey
            }

            // Zoom controls
            Column {
                anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 6
                spacing: 4
                Repeater {
                    model: [{ t: "+", d: 1 }, { t: "−", d: -1 }]
                    delegate: Rectangle {
                        required property var modelData
                        width: 22; height: 22; radius: 5
                        color: zm.containsMouse ? Theme.hover : Qt.rgba(0,0,0,0.5)
                        border.color: Theme.cardStroke
                        Text { anchors.centerIn: parent; text: modelData.t; color: Theme.textPrimary; font.pixelSize: 14 }
                        MouseArea { id: zm; anchors.fill: parent; hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: card.setZoom(card.zoom + modelData.d) }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: Panel.openIsland("https://www.google.com/maps/@"
                    + card.location.lat + "," + card.location.lon + "," + card.zoom + "z/data=!5m1!1e1")
            }
        }

        Text {
            visible: card.apiKey !== ""
            text: card.location.name ? String(card.location.name).split(",")[0] : ""
            color: Theme.textSecondary
            font.pixelSize: 10
        }

        // No key state
        Column {
            visible: card.apiKey === ""
            width: parent.width
            spacing: 6
            Text {
                width: parent.width
                text: "Ajoutez une clé TomTom dans les réglages pour afficher la circulation."
                color: Theme.textSecondary; font.pixelSize: Theme.fontSizeCaption
                wrapMode: Text.WordWrap
            }
        }
    }
}
