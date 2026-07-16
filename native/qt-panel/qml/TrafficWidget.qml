import QtQuick
import QtWebEngine
import QtPanel.Native

// Leaflet owns map projection, gestures, tile lifecycle, and attribution. The
// surrounding controls and persisted state remain native QML.
GlassCard {
    id: card
    title: "Circulation"
    implicitHeight: body.implicitHeight + 24
    property bool detailMode: false
    flat: detailMode
    interactive: !detailMode

    property int vaultRev: 0
    property int storeRev: 0
    property bool componentReady: false
    property bool mapReady: false
    property bool mapLoading: false
    property string mapError: ""
    property int trafficStatus: Image.Null
    property real trafficProgress: 0
    property string apiKey: { vaultRev; return Vault.get("tomtom-key").trim() }
    readonly property bool trafficConfigured: apiKey.length > 0
    readonly property bool trafficReady: trafficConfigured && trafficStatus === Image.Ready
    readonly property bool trafficFailed: trafficConfigured && trafficStatus === Image.Error

    function storedLocation() {
        storeRev
        const raw = Store.get("wp-location", "")
        try { return typeof raw === "string" ? JSON.parse(raw) : raw } catch (e) {}
        return { name: "Qu\u00e9bec", lat: 46.81, lon: -71.21 }
    }

    property var location: storedLocation()
    property real centerLat: Number(location.lat)
    property real centerLon: Number(location.lon)
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

    onLocationChanged: {
        centerLat = Number(location.lat)
        centerLon = Number(location.lon)
    }
    onEffectiveThemeChanged: {
        if (componentReady)
            Qt.callLater(reloadMap)
    }

    function mapDocumentUrl() {
        const base = Qt.resolvedUrl("web/traffic-map.html").toString()
        return base
            + "?lat=" + encodeURIComponent(centerLat)
            + "&lon=" + encodeURIComponent(centerLon)
            + "&zoom=" + encodeURIComponent(zoom)
            + "&theme=" + encodeURIComponent(effectiveTheme)
    }

    function runMapScript(script) {
        if (mapReady)
            mapView.runJavaScript(script)
    }

    function applyTrafficKey() {
        if (!mapReady)
            return
        if (!trafficConfigured) {
            trafficStatus = Image.Null
            runMapScript("window.qtPanelMap.setTrafficKey('')")
            return
        }
        trafficStatus = Image.Loading
        trafficProgress = 0
        runMapScript("window.qtPanelMap.setTrafficKey(" + JSON.stringify(apiKey) + ")")
    }

    function refreshTraffic() {
        if (!trafficConfigured) {
            trafficStatus = Image.Null
            return
        }
        trafficStatus = Image.Loading
        trafficProgress = 0
        runMapScript("window.qtPanelMap.refreshTraffic()")
    }

    function reloadMap() {
        if (!componentReady)
            return
        mapReady = false
        mapLoading = true
        mapError = ""
        trafficStatus = trafficConfigured ? Image.Loading : Image.Null
        trafficProgress = 0
        mapView.url = mapDocumentUrl()
    }

    function applyStoredZoom() {
        runMapScript("window.qtPanelMap.setZoom(" + zoom + ")")
    }

    function handleMapMessage(message) {
        const value = String(message || "")
        if (value === "qtpanel:ready") {
            mapReady = true
            mapLoading = false
            mapError = ""
            applyTrafficKey()
            return
        }
        if (value.indexOf("qtpanel:state:") === 0) {
            try {
                const state = JSON.parse(value.substring(14))
                const lat = Number(state.lat)
                const lon = Number(state.lon)
                const nextZoom = Math.max(6, Math.min(18, Number(state.zoom)))
                if (isFinite(lat)) centerLat = lat
                if (isFinite(lon)) centerLon = lon
                if (isFinite(nextZoom) && nextZoom !== zoom)
                    Store.set("wp-traffic-zoom", nextZoom)
            } catch (error) {
                console.warn("[traffic] invalid map state")
            }
            return
        }
        if (value === "qtpanel:traffic:loading") {
            trafficStatus = Image.Loading
            trafficProgress = 0.35
        } else if (value === "qtpanel:traffic:ready") {
            trafficStatus = Image.Ready
            trafficProgress = 1
            console.info("[traffic] Leaflet flow layer ready")
        } else if (value === "qtpanel:traffic:error") {
            trafficStatus = Image.Error
            trafficProgress = 0
            console.warn("[traffic] Leaflet flow layer failed")
        } else if (value.indexOf("qtpanel:error:") === 0) {
            mapError = value.substring(14) || "Carte indisponible"
            mapLoading = false
        }
    }

    Connections {
        target: Vault
        function onChanged(key) {
            if (key === "tomtom-key") {
                card.vaultRev++
                Qt.callLater(card.applyTrafficKey)
            }
        }
    }
    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-location") {
                card.storeRev++
                Qt.callLater(card.reloadMap)
            } else if (key === "wp-traffic-theme") {
                card.storeRev++
            } else if (key === "wp-traffic-zoom") {
                card.storeRev++
                Qt.callLater(card.applyStoredZoom)
            }
        }
    }

    Timer {
        interval: 60000
        running: true
        repeat: true
        onTriggered: card.currentHour = new Date().getHours()
    }
    Timer {
        interval: 120000
        running: card.trafficConfigured && card.mapReady
        repeat: true
        onTriggered: card.refreshTraffic()
    }

    Component.onCompleted: {
        componentReady = true
        Qt.callLater(reloadMap)
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
            status: card.mapError !== "" ? "ERREUR"
                : !card.mapReady ? "CARTE"
                : !card.trafficConfigured ? "CARTE"
                : card.trafficFailed ? "ERREUR"
                : card.trafficReady ? "DIRECT" : "CHARG."
            statusColor: card.mapError !== "" || card.trafficFailed ? Theme.danger
                : card.trafficReady ? Theme.success
                : card.mapLoading ? Theme.accent : Theme.warning
            expandable: !card.detailMode
            onExpandRequested: Ui.openDetail("traffic", "Circulation", {
                subtitle: card.location.name || ""
            })

            Row {
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

            WebEngineView {
                id: mapView
                anchors.fill: parent
                profile: WebProfile
                url: "about:blank"
                backgroundColor: mapFrame.color
                focus: true

                settings.forceDarkMode: false
                settings.localContentCanAccessRemoteUrls: true
                settings.focusOnNavigationEnabled: true
                settings.scrollAnimatorEnabled: true

                onLoadingChanged: function(info) {
                    if (info.status === WebEngineView.LoadStartedStatus) {
                        card.mapLoading = true
                        card.mapError = ""
                    } else if (info.status === WebEngineView.LoadFailedStatus
                               && info.errorCode !== -3) {
                        card.mapLoading = false
                        card.mapReady = false
                        card.mapError = info.errorString || "Carte indisponible"
                    }
                }
                onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceId) {
                    card.handleMapMessage(message)
                }
                onRenderProcessTerminated: function(status, exitCode) {
                    card.mapReady = false
                    card.mapLoading = false
                    card.mapError = "Le moteur cartographique s'est arr\u00eat\u00e9"
                }
                onNewWindowRequested: function(request) {
                    Panel.openExternal(request.requestedUrl)
                }
            }

            IconButton {
                z: 2
                anchors.top: parent.top
                anchors.right: parent.right
                anchors.margins: 7
                buttonSize: 24
                glyph: "\uE81D"
                tooltip: "Recentrer la carte"
                enabled: card.mapReady
                onClicked: card.runMapScript("window.qtPanelMap.resetView()")
            }

            Rectangle {
                z: 3
                visible: card.mapLoading
                    || (card.trafficConfigured && card.trafficStatus === Image.Loading)
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                anchors.margins: 7
                width: loadingText.implicitWidth + 14
                height: 22
                radius: 5
                color: Qt.rgba(0, 0, 0, 0.72)
                border.color: Theme.cardStroke
                Text {
                    id: loadingText
                    anchors.centerIn: parent
                    text: card.mapLoading ? "Chargement de la carte" : "Trafic en direct"
                    color: Theme.textPrimary
                    font.pixelSize: 9
                }
            }

            Rectangle {
                z: 3
                visible: card.mapError !== "" || card.trafficFailed
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 7
                height: 30
                radius: 5
                color: Qt.rgba(0.12, 0.03, 0.04, 0.92)
                border.color: Theme.danger
                Text {
                    anchors.left: parent.left
                    anchors.right: retryButton.left
                    anchors.leftMargin: 8
                    anchors.rightMargin: 6
                    anchors.verticalCenter: parent.verticalCenter
                    text: card.mapError !== "" ? card.mapError : "Flux TomTom indisponible"
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
                    tooltip: "R\u00e9essayer"
                    onClicked: card.mapError !== "" ? card.reloadMap() : card.refreshTraffic()
                }
            }
        }

        Text {
            width: parent.width
            text: (card.location.name
                ? String(card.location.name).split(",")[0] : "")
                + (!card.mapReady ? " \u00b7 initialisation de la carte"
                    : !card.trafficConfigured ? " \u00b7 carte interactive"
                    : card.trafficFailed ? " \u00b7 trafic indisponible"
                    : card.trafficReady ? " \u00b7 trafic TomTom actualis\u00e9"
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
