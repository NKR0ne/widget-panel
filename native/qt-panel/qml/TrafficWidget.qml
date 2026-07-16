import QtQuick
import QtPanel.Native

// Native slippy map using the same CARTO, Esri, and TomTom sources as the
// Electron Leaflet card. Panning is local; only zoom and theme are persisted.
GlassCard {
    id: card
    title: "Circulation"
    implicitHeight: body.implicitHeight + 24
    property bool detailMode: false
    flat: detailMode
    interactive: !detailMode

    property int vaultRev: 0
    property int storeRev: 0
    property int trafficRevision: 0
    property int trafficStatus: Image.Null
    property real trafficProgress: 0
    property string apiKey: { vaultRev; return Vault.get("tomtom-key").trim() }
    readonly property bool trafficConfigured: apiKey.length > 0
    readonly property bool trafficReady: trafficConfigured && trafficStatus === Image.Ready
    readonly property bool trafficFailed: trafficConfigured && trafficStatus === Image.Error

    function refreshTraffic() {
        trafficRevision++
        trafficStatus = trafficConfigured ? Image.Loading : Image.Null
        trafficProgress = 0
    }

    Connections {
        target: Vault
        function onChanged(key) {
            if (key === "tomtom-key") {
                card.vaultRev++
                card.refreshTraffic()
            }
        }
    }
    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-location" || key === "wp-traffic-zoom"
                    || key === "wp-traffic-theme")
                card.storeRev++
        }
    }

    function storedLocation() {
        storeRev
        const raw = Store.get("wp-location", "")
        try { return typeof raw === "string" ? JSON.parse(raw) : raw } catch (e) {}
        return { name: "Qu\u00e9bec", lat: 46.81, lon: -71.21 }
    }

    property var location: storedLocation()
    property real centerLat: Number(location.lat)
    property real centerLon: Number(location.lon)
    onLocationChanged: {
        centerLat = Number(location.lat)
        centerLon = Number(location.lon)
    }

    property int zoom: {
        storeRev
        return Math.max(6, Math.min(18,
            Number(Store.get("wp-traffic-zoom", 11)) || 11))
    }
    property string theme: {
        storeRev
        const value = String(Store.get("wp-traffic-theme", "auto"))
        return ["auto", "blueprint", "day-plan", "day-satellite"].indexOf(value) >= 0
            ? value : "auto"
    }
    property int currentHour: new Date().getHours()
    readonly property string effectiveTheme: theme === "auto"
        ? (currentHour >= 19 || currentHour < 7 ? "blueprint" : "day-plan")
        : theme

    Timer {
        interval: 60000
        running: true
        repeat: true
        onTriggered: card.currentHour = new Date().getHours()
    }

    Timer {
        interval: 120000
        running: card.trafficConfigured
        repeat: true
        onTriggered: card.refreshTraffic()
    }

    readonly property int n: Math.pow(2, zoom)
    readonly property real tileCenterX: (centerLon + 180) / 360 * n
    readonly property real tileCenterY: {
        const radians = centerLat * Math.PI / 180
        return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians))
            / Math.PI) / 2 * n
    }

    function setZoom(value) {
        Store.set("wp-traffic-zoom", Math.max(6, Math.min(18, value)))
    }
    function lonFromTile(value) {
        return value / n * 360 - 180
    }
    function latFromTile(value) {
        const radians = Math.atan(Math.sinh(Math.PI * (1 - 2 * value / n)))
        return Math.max(-85, Math.min(85, radians * 180 / Math.PI))
    }
    function setCenter(lat, lon) {
        centerLat = Math.max(-85, Math.min(85, lat))
        centerLon = Math.max(-180, Math.min(180, lon))
    }
    function tileCoords(dx, dy) {
        return {
            x: ((Math.floor(tileCenterX) + dx + n) % n),
            y: Math.max(0, Math.min(n - 1, Math.floor(tileCenterY) + dy))
        }
    }
    function baseTileUrl(dx, dy) {
        const tile = tileCoords(dx, dy)
        if (effectiveTheme === "day-satellite")
            return "https://server.arcgisonline.com/ArcGIS/rest/services/"
                + "World_Imagery/MapServer/tile/" + zoom + "/" + tile.y + "/" + tile.x
        const style = effectiveTheme === "day-plan"
            ? "light_nolabels" : "dark_nolabels"
        return "https://a.basemaps.cartocdn.com/" + style + "/" + zoom + "/"
            + tile.x + "/" + tile.y + ".png"
    }
    function labelTileUrl(dx, dy) {
        const tile = tileCoords(dx, dy)
        if (effectiveTheme === "day-satellite")
            return "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/"
                + "World_Boundaries_and_Places/MapServer/tile/"
                + zoom + "/" + tile.y + "/" + tile.x
        const style = effectiveTheme === "day-plan"
            ? "light_only_labels" : "dark_only_labels"
        return "https://a.basemaps.cartocdn.com/" + style + "/" + zoom + "/"
            + tile.x + "/" + tile.y + ".png"
    }
    function transportTileUrl(dx, dy) {
        if (effectiveTheme !== "day-satellite")
            return ""
        const tile = tileCoords(dx, dy)
        return "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/"
            + "World_Transportation/MapServer/tile/"
            + zoom + "/" + tile.y + "/" + tile.x
    }
    function trafficTileUrl(dx, dy) {
        if (!trafficConfigured)
            return ""
        const tile = tileCoords(dx, dy)
        return "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/"
            + zoom + "/" + tile.x + "/" + tile.y
            + ".png?key=" + encodeURIComponent(apiKey) + "&tileSize=256"
            + "#refresh-" + trafficRevision
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

        CardHeader {
            width: parent.width
            title: card.title
            subtitle: card.location.name ? String(card.location.name).split(",")[0] : ""
            status: !card.trafficConfigured ? "CARTE"
                : card.trafficFailed ? "ERREUR"
                : card.trafficReady ? "DIRECT" : "CHARG."
            statusColor: !card.trafficConfigured ? Theme.warning
                : card.trafficFailed ? Theme.danger
                : card.trafficReady ? Theme.success : Theme.accent
            expandable: !card.detailMode
            onExpandRequested: Ui.openDetail("traffic", "Circulation", {
                subtitle: card.location.name || ""
            })
            Row {
                id: themeRow
                spacing: 2

                Repeater {
                    model: [
                        { id: "auto", label: "Auto" },
                        { id: "blueprint", label: "Plan" },
                        { id: "day-plan", label: "Jour" },
                        { id: "day-satellite", label: "Sat." },
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        width: themeLabel.implicitWidth + 9
                        height: 17
                        radius: 4
                        color: card.theme === modelData.id
                            ? Theme.activeFill
                            : themeMouse.containsMouse ? Theme.hover : "transparent"

                        Text {
                            id: themeLabel
                            anchors.centerIn: parent
                            text: modelData.label
                            color: card.theme === modelData.id
                                ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 8
                        }
                        MouseArea {
                            id: themeMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: Store.set("wp-traffic-theme", parent.modelData.id)
                        }
                    }
                }
            }
            IconButton {
                visible: card.detailMode
                buttonSize: 20
                glyph: "\uE774"
                tooltip: "Ouvrir Google Maps"
                onClicked: Panel.openExternal("https://www.google.com/maps/@"
                    + card.centerLat + "," + card.centerLon + ","
                    + card.zoom + "z/data=!5m1!1e1")
            }
        }

        Rectangle {
            id: mapFrame
            width: parent.width
            height: card.detailMode ? Math.min(650, Math.max(360, width * 0.62))
                                    : Math.round(width * 0.66)
            radius: 8
            color: card.effectiveTheme === "day-plan"
                   || card.effectiveTheme === "day-satellite" ? "#eef3fb" : "#050914"
            clip: true

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
                    { x: -1, y: 1 },  { x: 0, y: 1 },  { x: 1, y: 1 },
                ]

                Repeater {
                    model: tileLayer.offsets
                    delegate: Item {
                        required property var modelData
                        x: tileLayer.width / 2
                           + (modelData.x - tileLayer.fracX) * tileLayer.tileSize
                           - tileLayer.tileSize / 2
                        y: tileLayer.height / 2
                           + (modelData.y - tileLayer.fracY) * tileLayer.tileSize
                           - tileLayer.tileSize / 2
                        width: tileLayer.tileSize
                        height: tileLayer.tileSize

                        Image {
                            anchors.fill: parent
                            fillMode: Image.Stretch
                            asynchronous: true
                            cache: true
                            source: card.baseTileUrl(modelData.x, modelData.y)
                        }
                        Image {
                            anchors.fill: parent
                            fillMode: Image.Stretch
                            asynchronous: true
                            cache: true
                            source: card.labelTileUrl(modelData.x, modelData.y)
                            opacity: card.effectiveTheme === "blueprint" ? 0.58 : 0.74
                        }
                        Image {
                            anchors.fill: parent
                            fillMode: Image.Stretch
                            asynchronous: true
                            cache: true
                            source: card.transportTileUrl(modelData.x, modelData.y)
                            opacity: 0.56
                        }
                        Image {
                            id: trafficImage
                            anchors.fill: parent
                            fillMode: Image.Stretch
                            asynchronous: true
                            cache: false
                            source: card.trafficTileUrl(modelData.x, modelData.y)
                            opacity: status === Image.Ready ? 0.95 : 0

                            readonly property bool centerTile:
                                modelData.x === 0 && modelData.y === 0

                            onStatusChanged: {
                                if (!centerTile)
                                    return
                                card.trafficStatus = status
                                if (status === Image.Ready)
                                    console.info("[traffic] center flow tile ready")
                                else if (status === Image.Error)
                                    console.warn("[traffic] center flow tile failed")
                            }
                            onProgressChanged: {
                                if (centerTile)
                                    card.trafficProgress = trafficImage.progress
                            }
                        }
                    }
                }
            }

            Rectangle {
                z: 3
                visible: card.trafficConfigured
                    && card.trafficStatus === Image.Loading
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                anchors.margins: 7
                width: loadingText.implicitWidth + 14
                height: 22
                radius: 5
                color: Qt.rgba(0, 0, 0, 0.68)
                border.color: Theme.cardStroke

                Text {
                    id: loadingText
                    anchors.centerIn: parent
                    text: "Trafic " + Math.round(card.trafficProgress * 100) + "%"
                    color: Theme.textPrimary
                    font.pixelSize: 9
                }
            }

            Rectangle {
                z: 3
                visible: card.trafficFailed
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 7
                height: 30
                radius: 5
                color: Qt.rgba(0.12, 0.03, 0.04, 0.9)
                border.color: Theme.danger

                Text {
                    anchors.left: parent.left
                    anchors.right: retryButton.left
                    anchors.leftMargin: 8
                    anchors.rightMargin: 6
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Flux TomTom indisponible"
                    color: Theme.textPrimary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }
                IconButton {
                    id: retryButton
                    anchors.right: parent.right
                    anchors.rightMargin: 4
                    anchors.verticalCenter: parent.verticalCenter
                    buttonSize: 22
                    glyph: "\uE72C"
                    tooltip: "Réessayer"
                    onClicked: card.refreshTraffic()
                }
            }

            Column {
                z: 2
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 6
                spacing: 4

                Repeater {
                    model: [{ glyph: "+", delta: 1 }, { glyph: "\u2212", delta: -1 }]
                    delegate: Rectangle {
                        required property var modelData
                        width: 22
                        height: 22
                        radius: 5
                        color: zoomMouse.containsMouse
                            ? Theme.hover : Qt.rgba(0, 0, 0, 0.5)
                        border.color: Theme.cardStroke

                        Text {
                            anchors.centerIn: parent
                            text: modelData.glyph
                            color: Theme.textPrimary
                            font.pixelSize: 14
                        }
                        MouseArea {
                            id: zoomMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.setZoom(card.zoom + parent.modelData.delta)
                        }
                    }
                }
            }

            MouseArea {
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
                    const size = Math.max(width, height)
                    card.setCenter(card.latFromTile(startTileY - dy / Math.max(1, size)),
                                   card.lonFromTile(startTileX - dx / Math.max(1, size)))
                }
                onReleased: {
                    if (!moved) {
                        if (!card.detailMode)
                            Ui.openDetail("traffic", "Circulation", {
                                subtitle: card.location.name || ""
                            })
                    }
                }
            }

            WheelHandler {
                acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                onWheel: function(event) {
                    card.setZoom(card.zoom + (event.angleDelta.y > 0 ? 1 : -1))
                }
            }
        }

        Text {
            width: parent.width
            text: (card.location.name
                ? String(card.location.name).split(",")[0] : "")
                + (!card.trafficConfigured ? " \u00b7 carte seulement"
                    : card.trafficFailed ? " \u00b7 trafic indisponible"
                    : card.trafficReady ? " \u00b7 trafic TomTom actualisé"
                    : " \u00b7 chargement du trafic")
            color: Theme.textSecondary
            font.pixelSize: 10
            elide: Text.ElideRight
        }

        Text {
            visible: !card.trafficConfigured
            width: parent.width
            text: "Ajoutez une cl\u00e9 TomTom pour superposer le flux de circulation."
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }
    }
}
