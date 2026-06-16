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
    readonly property real tileCenterX: (location.lon + 180) / 360 * n
    readonly property real tileCenterY: {
        const r = location.lat * Math.PI / 180
        return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n
    }
    readonly property int tileX: Math.floor((location.lon + 180) / 360 * n)
    readonly property int tileY: {
        const r = location.lat * Math.PI / 180
        return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)
    }

    function setZoom(z) { Store.set("wp-traffic-zoom", Math.max(6, Math.min(15, z))) }
    function lonFromTile(x) { return x / n * 360 - 180 }
    function latFromTile(y) {
        const v = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)))
        return Math.max(-85, Math.min(85, v * 180 / Math.PI))
    }
    function setCenter(lat, lon) {
        Store.set("wp-location", JSON.stringify({
            name: location.name || "Traffic",
            lat: Math.max(-85, Math.min(85, lat)),
            lon: Math.max(-180, Math.min(180, lon))
        }))
    }

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

            Item {
                id: tileLayer
                anchors.fill: parent
                readonly property real tileSize: Math.max(width, height)
                readonly property int baseX: Math.floor(card.tileCenterX)
                readonly property int baseY: Math.floor(card.tileCenterY)
                readonly property real fracX: card.tileCenterX - baseX
                readonly property real fracY: card.tileCenterY - baseY
                readonly property var offsets: [
                    { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
                    { x: -1, y: 0 },  { x: 0, y: 0 },  { x: 1, y: 0 },
                    { x: -1, y: 1 },  { x: 0, y: 1 },  { x: 1, y: 1 }
                ]

                Repeater {
                    model: tileLayer.offsets
                    delegate: Item {
                        required property var modelData
                        x: tileLayer.width / 2 + (modelData.x - tileLayer.fracX) * tileLayer.tileSize - tileLayer.tileSize / 2
                        y: tileLayer.height / 2 + (modelData.y - tileLayer.fracY) * tileLayer.tileSize - tileLayer.tileSize / 2
                        width: tileLayer.tileSize
                        height: tileLayer.tileSize

                        Image {
                            anchors.fill: parent
                            fillMode: Image.Stretch
                            asynchronous: true
                            cache: true
                            source: card.apiKey === "" ? "" :
                                "https://api.tomtom.com/map/1/tile/basic/" + (card.night ? "night" : "main")
                                + "/" + card.zoom + "/" + ((tileLayer.baseX + modelData.x + card.n) % card.n)
                                + "/" + Math.max(0, Math.min(card.n - 1, tileLayer.baseY + modelData.y))
                                + ".png?tileSize=512&key=" + card.apiKey
                        }
                        Image {
                            anchors.fill: parent
                            fillMode: Image.Stretch
                            asynchronous: true
                            cache: true
                            source: card.apiKey === "" ? "" :
                                "https://api.tomtom.com/traffic/map/4/tile/flow/"
                                + (card.night ? "relative0-dark" : "relative0")
                                + "/" + card.zoom + "/" + ((tileLayer.baseX + modelData.x + card.n) % card.n)
                                + "/" + Math.max(0, Math.min(card.n - 1, tileLayer.baseY + modelData.y))
                                + ".png?tileSize=512&key=" + card.apiKey
                        }
                    }
                }
            }

            // Zoom controls
            Column {
                z: 2
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
                id: panMouse
                z: 1
                anchors.fill: parent
                cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                property real startX: 0
                property real startY: 0
                property real startTileX: 0
                property real startTileY: 0
                property bool moved: false
                onPressed: function(mouse) {
                    startX = mouse.x
                    startY = mouse.y
                    startTileX = card.tileCenterX
                    startTileY = card.tileCenterY
                    moved = false
                }
                onPositionChanged: function(mouse) {
                    if (!pressed)
                        return
                    const dx = mouse.x - startX
                    const dy = mouse.y - startY
                    if (Math.abs(dx) + Math.abs(dy) > 8)
                        moved = true
                    const tileSize = Math.max(width, height)
                    const nextX = startTileX - dx / Math.max(1, tileSize)
                    const nextY = startTileY - dy / Math.max(1, tileSize)
                    card.setCenter(card.latFromTile(nextY), card.lonFromTile(nextX))
                }
                onReleased: function(mouse) {
                    if (!moved) {
                        Panel.openIsland("https://www.google.com/maps/@"
                            + card.location.lat + "," + card.location.lon + "," + card.zoom + "z/data=!5m1!1e1")
                    }
                }
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
