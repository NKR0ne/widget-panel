import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Marchés"
    implicitHeight: body.implicitHeight + 24

    readonly property color upColor: "#34d399"
    readonly property color downColor: "#f87171"

    // Tabs: one per watchlist + earnings + IPO + Heatmap.
    property int tab: 0   // 0..N-1 = lists, N = earnings, N+1 = IPO
    property int knownListCount: 0
    readonly property int listCount: Stocks.listNames.length
    readonly property bool earningsTab: tab === listCount
    readonly property bool iposTab: tab === listCount + 1
    readonly property bool heatmapTab: tab === listCount + 2
    readonly property bool overviewTab: Stocks.currentList === 0
    property string heatmapPeriod: Store.get("wp-heatmap-period", "change") || "change"
    property int storeRevision: 0
    readonly property var heatmapPeriods: [
        { id: "change", label: "1D" },
        { id: "Perf.W", label: "1W" },
        { id: "Perf.1M", label: "1M" },
        { id: "Perf.3M", label: "3M" },
        { id: "Perf.6M", label: "6M" },
        { id: "Perf.YTD", label: "YTD" },
        { id: "Perf.Y", label: "1Y" },
    ]

    function eventDate(value, unavailable) {
        if (unavailable)
            return "À confirmer"
        const date = new Date(value || "")
        if (isNaN(date.getTime()))
            return ""
        return Qt.formatDateTime(date, "d MMM")
    }

    function revenueLabel(value) {
        const n = Number(value)
        if (!isFinite(n) || n <= 0)
            return ""
        if (n >= 1000000000)
            return "$" + (n / 1000000000).toFixed(1) + "B"
        if (n >= 1000000)
            return "$" + Math.round(n / 1000000) + "M"
        return "$" + Number(Math.round(n)).toLocaleString(Qt.locale("en_US"), "f", 0)
    }

    function ipoPriceLabel(item) {
        if (item.priceRange)
            return item.priceRange
        return item.exchange || ""
    }

    function chartUrl(symbol) {
        if (!symbol)
            return ""
        return "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(symbol)
    }

    function openSymbol(symbol) {
        const url = chartUrl(symbol)
        if (url)
            Panel.openIsland(url)
    }

    function openMarketEvent(item) {
        if (!item)
            return
        const symbol = item.symbol || item.tvSymbol || ""
        if (symbol) {
            openSymbol(symbol)
            return
        }
        const ticker = item.ticker || ""
        const exchange = item.exchange || ""
        if (ticker && exchange) {
            openSymbol(exchange + ":" + ticker)
            return
        }
        const query = item.name || item.desc || ticker
        if (query)
            Panel.openIsland("https://www.tradingview.com/search/?query="
                             + encodeURIComponent(query))
    }

    function openHeatmap(period) {
        heatmapPeriod = period || "change"
        Store.set("wp-heatmap-period", heatmapPeriod)
        Panel.openIsland(Stocks.heatmapUrl(heatmapPeriod, "width-scroll"))
    }

    function heatmapLabel() {
        for (const item of heatmapPeriods) {
            if (item.id === heatmapPeriod)
                return item.label
        }
        return "1D"
    }

    function heatmapTone(pct, hasData) {
        if (!hasData)
            return Qt.rgba(1, 1, 1, 0.04)
        const value = Number(pct)
        if (!isFinite(value))
            return Qt.rgba(1, 1, 1, 0.04)
        const alpha = Math.min(0.44, 0.10 + Math.abs(value) / 7.5 * 0.34)
        return value >= 0 ? Qt.rgba(0.20, 0.83, 0.60, alpha)
                          : Qt.rgba(0.97, 0.45, 0.45, alpha)
    }

    function heatmapText(pct, hasData) {
        if (!hasData)
            return "--"
        const value = Number(pct)
        if (!isFinite(value))
            return "--"
        return (value > 0 ? "+" : "") + value.toFixed(2) + "%"
    }

    function tradingViewUser() {
        const revision = storeRevision
        return Store.get("wp-tv-user", "") || ""
    }

    function tradingViewStatus() {
        const revision = storeRevision
        const capture = Store.get("wp-tv-capture-status", "")
        if (capture.indexOf("Capturing") === 0 || capture.indexOf("not found") >= 0
                || capture.indexOf("unavailable") >= 0)
            return capture
        const user = tradingViewUser()
        if (user)
            return "TV: " + user
        const hasSession = !!Store.get("wp-tv-session", "")
            || !!Store.get("wp-tv-cookies", "")
        if (hasSession)
            return "TV session active"
        return capture || "TV non connecte"
    }

    function clearTradingView() {
        const keys = [
            "wp-tv-session", "wp-tv-cookies", "wp-tv-csrf", "wp-tv-user",
            "wp-tv-raw-lists", "wp-tv-watchlist-ids", "wp-tv-lists-cache",
            "wp-tv-lists-cache-at", "wp-tv-list-id", "wp-tv-capture-status"
        ]
        for (const key of keys)
            Store.set(key, "")
        Stocks.reloadLists()
    }

    function calculateRsi(values, period) {
        const closes = []
        const source = values || []
        for (let i = 0; i < source.length; i++) {
            const n = Number(source[i])
            if (isFinite(n))
                closes.push(n)
        }
        const span = period || 14
        if (closes.length <= span)
            return null

        let gain = 0
        let loss = 0
        for (let i = 1; i <= span; i++) {
            const delta = closes[i] - closes[i - 1]
            if (delta >= 0) gain += delta
            else loss -= delta
        }

        let avgGain = gain / span
        let avgLoss = loss / span
        for (let i = span + 1; i < closes.length; i++) {
            const delta = closes[i] - closes[i - 1]
            const nextGain = delta > 0 ? delta : 0
            const nextLoss = delta < 0 ? -delta : 0
            avgGain = ((avgGain * (span - 1)) + nextGain) / span
            avgLoss = ((avgLoss * (span - 1)) + nextLoss) / span
        }

        if (avgLoss === 0 && avgGain === 0)
            return 50
        if (avgLoss === 0)
            return 100
        return 100 - (100 / (1 + (avgGain / avgLoss)))
    }

    function rsiTone(value) {
        if (value === null || value === undefined)
            return Qt.rgba(1, 1, 1, 0.38)
        if (value >= 70)
            return card.downColor
        if (value <= 30)
            return card.upColor
        return Theme.textSecondary
    }

    Component.onCompleted: {
        knownListCount = listCount
        if (Stocks.currentList >= 0 && Stocks.currentList < listCount)
            tab = Stocks.currentList
    }

    Connections {
        target: Stocks
        function onCurrentListChanged() {
            if (!card.earningsTab && !card.iposTab && !card.heatmapTab)
                card.tab = Stocks.currentList
        }
        function onListsChanged() {
            const oldCount = card.knownListCount
            const nextCount = Stocks.listNames.length
            const specialOffset = oldCount > 0 && card.tab >= oldCount
                ? card.tab - oldCount : -1
            card.knownListCount = nextCount
            if (specialOffset >= 0 && specialOffset <= 2)
                card.tab = nextCount + specialOffset
            else if (card.tab >= nextCount)
                card.tab = Math.max(0, nextCount - 1)
        }
    }
    Connections {
        target: Store
        function onChanged(key) {
            if (key.indexOf("wp-tv-") === 0 || key === "wp-market-provider")
                card.storeRevision += 1
        }
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

        Row {
            width: parent.width
            height: 20
            spacing: 6

            Text {
                text: card.title
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                anchors.verticalCenter: parent.verticalCenter
            }
            Item {
                width: Math.max(0, parent.width - x - providerLabel.implicitWidth
                    - providerDot.width - 10)
                height: 1
            }
            Rectangle {
                id: providerDot
                width: 6
                height: 6
                radius: 3
                color: Stocks.count > 0 ? "#34d399" : Qt.rgba(1, 1, 1, 0.24)
                anchors.verticalCenter: parent.verticalCenter
            }
            Text {
                id: providerLabel
                text: {
                    card.storeRevision
                    return String(Store.get("wp-market-provider", "auto")).toUpperCase()
                }
                color: Theme.textSecondary
                font.pixelSize: 8
                anchors.verticalCenter: parent.verticalCenter
            }
        }

        // Tab bar (horizontally scrollable)
        Flickable {
            width: parent.width
            height: 20
            contentWidth: tabRow.width
            clip: true
            Row {
                id: tabRow
                spacing: 4
                Repeater {
                    model: {
                        const names = Stocks.listNames.slice()
                        names.push("Revenus")
                        names.push("IPO")
                        names.push("Heatmap")
                        return names
                    }
                    delegate: Rectangle {
                        required property string modelData
                        required property int index
                        height: 18
                        width: tabLabel.implicitWidth + 14
                        radius: 5
                        color: card.tab === index ? Theme.activeFill
                             : tabMouse.containsMouse ? Theme.hover : "transparent"
                        Text {
                            id: tabLabel
                            anchors.centerIn: parent
                            text: modelData
                            color: card.tab === index ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: tabMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                card.tab = index
                                if (index < card.listCount) Stocks.setList(index)
                                else if (index === card.listCount) Stocks.refreshEarnings()
                                else if (index === card.listCount + 1) Stocks.refreshIpos()
                                else if (index === card.listCount + 2) {
                                    Stocks.setList(0)
                                    Stocks.refresh()
                                }
                            }
                        }
                    }
                }
            }
        }

        Text {
            visible: Stocks.watchlistsStatus !== ""
            width: parent.width
            text: Stocks.watchlistsStatus
            color: Stocks.watchlistsRefreshing ? Theme.accent : Theme.textSecondary
            font.pixelSize: 9
            elide: Text.ElideRight
        }

        Text {
            width: parent.width
            text: card.tradingViewStatus()
            color: Theme.textSecondary
            font.pixelSize: 9
            elide: Text.ElideRight
        }

        Row {
            width: parent.width
            spacing: 5
            Rectangle {
                id: loginBtn
                width: tvLoginLabel.implicitWidth + 12; height: 18; radius: 5
                color: tvLoginMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text { id: tvLoginLabel; anchors.centerIn: parent; text: "Login"; color: Theme.textSecondary; font.pixelSize: 9 }
                MouseArea {
                    id: tvLoginMouse; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Panel.openIsland("https://www.tradingview.com/accounts/signin/")
                }
            }
            Rectangle {
                id: captureBtn
                width: tvCaptureLabel.implicitWidth + 12; height: 18; radius: 5
                color: tvCaptureMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text { id: tvCaptureLabel; anchors.centerIn: parent; text: "Capture"; color: Theme.textSecondary; font.pixelSize: 9 }
                MouseArea {
                    id: tvCaptureMouse; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Panel.captureTradingViewSession()
                }
            }
            Rectangle {
                id: syncMini
                width: tvMiniSyncLabel.implicitWidth + 12; height: 18; radius: 5
                color: tvMiniSyncMouse.containsMouse ? Theme.hover : Theme.cardFill
                border.color: Theme.cardStroke
                Text { id: tvMiniSyncLabel; anchors.centerIn: parent; text: "Sync"; color: Theme.textSecondary; font.pixelSize: 9 }
                MouseArea {
                    id: tvMiniSyncMouse; anchors.fill: parent; hoverEnabled: true
                    enabled: !Stocks.watchlistsRefreshing
                    cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: Stocks.refreshWatchlists()
                }
            }
            Rectangle {
                id: forgetBtn
                width: tvForgetLabel.implicitWidth + 12; height: 18; radius: 5
                color: tvForgetMouse.containsMouse ? Qt.rgba(0.97,0.45,0.45,0.20) : Theme.cardFill
                border.color: Qt.rgba(0.97,0.45,0.45,0.32)
                Text { id: tvForgetLabel; anchors.centerIn: parent; text: "Forget"; color: Theme.textSecondary; font.pixelSize: 9 }
                MouseArea {
                    id: tvForgetMouse; anchors.fill: parent; hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.clearTradingView()
                }
            }
        }

        // Earnings calendar view
        Column {
            visible: card.earningsTab
            width: parent.width
            spacing: 5
            Text {
                visible: Stocks.earnings.length === 0
                text: "Aucune date de revenus"
                color: Theme.textSecondary; font.pixelSize: Theme.fontSizeCaption
            }
            Repeater {
                model: card.earningsTab ? Stocks.earnings : []
                delegate: Row {
                    required property var modelData
                    width: body.width
                    spacing: 6
                    TapHandler {
                        onTapped: card.openMarketEvent(modelData)
                    }
                    Text {
                        width: 48
                        text: card.eventDate(modelData.date, modelData.dateUnavailable)
                        color: modelData.dateUnavailable ? Theme.textSecondary : Theme.accent
                        font.pixelSize: 10
                        elide: Text.ElideRight
                    }
                    Column {
                        width: parent.width - 100
                        Text {
                            width: parent.width
                            text: modelData.ticker || modelData.symbol
                            color: Theme.textPrimary
                            font.pixelSize: Theme.fontSizeCaption
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: modelData.dateUnavailable
                                ? (modelData.name || "Date à confirmer")
                                : (card.revenueLabel(modelData.revenueAverage)
                                   || modelData.name || "Publication")
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            elide: Text.ElideRight
                        }
                    }
                    Text {
                        text: modelData.exchange || ""
                        color: Theme.textSecondary
                        font.pixelSize: 9
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
        }

        // IPO calendar view
        Column {
            visible: card.iposTab
            width: parent.width
            spacing: 5
            Text {
                visible: Stocks.ipos.length === 0
                text: "Calendrier des IPO indisponible"
                color: Theme.textSecondary; font.pixelSize: Theme.fontSizeCaption
            }
            Repeater {
                model: card.iposTab ? Stocks.ipos : []
                delegate: Row {
                    required property var modelData
                    width: body.width
                    spacing: 6
                    TapHandler {
                        onTapped: card.openMarketEvent(modelData)
                    }
                    Text { width: 42; text: modelData.date; color: Theme.accent; font.pixelSize: 10 }
                    Column {
                        width: parent.width - 90
                        Text { width: parent.width; text: modelData.name; color: Theme.textPrimary
                               font.pixelSize: Theme.fontSizeCaption; elide: Text.ElideRight }
                        Text { width: parent.width; text: modelData.exchange; color: Theme.textSecondary
                               font.pixelSize: 9; elide: Text.ElideRight }
                    }
                    Text { text: card.ipoPriceLabel(modelData); color: Theme.textSecondary; font.pixelSize: 9
                           anchors.verticalCenter: parent.verticalCenter }
                }
            }
        }

        // Heatmap controls; the actual TradingView widget opens in the Brave island.
        Column {
            visible: card.heatmapTab
            width: parent.width
            spacing: 6

            Row {
                width: parent.width
                height: 24
                spacing: 3
                Repeater {
                    model: card.heatmapPeriods
                    delegate: Rectangle {
                        required property var modelData
                        width: Math.max(22, (body.width - 18) / card.heatmapPeriods.length)
                        height: 22
                        radius: 4
                        color: card.heatmapPeriod === modelData.id ? Theme.activeFill
                             : periodMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: card.heatmapPeriod === modelData.id ? Theme.accent : Theme.cardStroke
                        Text {
                            anchors.centerIn: parent
                            text: modelData.label
                            color: card.heatmapPeriod === modelData.id ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 9
                            font.weight: Font.DemiBold
                        }
                        MouseArea {
                            id: periodMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: card.openHeatmap(modelData.id)
                        }
                    }
                }
            }

            Row {
                width: parent.width
                height: 28
                spacing: 6
                Text {
                    width: Math.max(40, parent.width - heatmapOpenBtn.width - 6)
                    text: "TradingView heatmap - " + card.heatmapLabel()
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    elide: Text.ElideRight
                    anchors.verticalCenter: parent.verticalCenter
                }
                Rectangle {
                    id: heatmapOpenBtn
                    width: heatmapOpenLabel.implicitWidth + 18
                    height: 24
                    radius: 6
                    color: heatmapOpenMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.28)
                                                          : Qt.rgba(0.31, 0.56, 0.97, 0.15)
                    border.color: Qt.rgba(0.31, 0.56, 0.97, 0.45)
                    Text {
                        id: heatmapOpenLabel
                        anchors.centerIn: parent
                        text: "Zoom"
                        color: Theme.textPrimary
                        font.pixelSize: 9
                    }
                    MouseArea {
                        id: heatmapOpenMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: card.openHeatmap(card.heatmapPeriod)
                    }
                }
            }

            Flow {
                id: nativeHeatmap
                width: parent.width
                height: childrenRect.height
                spacing: 4
                Repeater {
                    model: card.heatmapTab ? Stocks.heatmapRows : []
                    delegate: Rectangle {
                        required property var modelData
                        readonly property string display: modelData.display || ""
                        readonly property string ticker: modelData.ticker || ""
                        readonly property string tvSymbol: modelData.tvSymbol || ""
                        readonly property double pct: Number(modelData.pct || 0)
                        readonly property bool hasData: !!modelData.hasData

                        width: Math.max(64, Math.floor((nativeHeatmap.width - 4) / 2))
                        height: 42
                        radius: 6
                        color: card.heatmapTone(pct, hasData)
                        border.color: heatTileMouse.containsMouse ? Theme.accent : Theme.cardStroke

                        Column {
                            anchors.fill: parent
                            anchors.margins: 6
                            spacing: 1
                            Text {
                                width: parent.width
                                text: ticker || display
                                color: Theme.textPrimary
                                font.pixelSize: 10
                                font.weight: Font.DemiBold
                                elide: Text.ElideRight
                            }
                            Text {
                                width: parent.width
                                text: card.heatmapText(pct, hasData)
                                color: hasData ? Theme.textPrimary : Theme.textSecondary
                                font.pixelSize: 9
                                elide: Text.ElideRight
                            }
                        }

                        MouseArea {
                            id: heatTileMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: tvSymbol ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: card.openSymbol(tvSymbol)
                        }
                    }
                }
            }

            Text {
                visible: card.heatmapTab && Stocks.count === 0
                width: parent.width
                text: "No market data loaded"
                color: Theme.textSecondary
                font.pixelSize: Theme.fontSizeCaption
                horizontalAlignment: Text.AlignHCenter
            }

            Text {
                width: parent.width
                text: "Zoom opens the full TradingView heatmap; tiles open their chart."
                color: Theme.textSecondary
                font.pixelSize: 9
                wrapMode: Text.WordWrap
            }
        }

        Repeater {
            model: (card.iposTab || card.earningsTab || card.heatmapTab) ? 0 : Stocks

            delegate: Item {
                id: row

                required property string display
                required property string ticker
                required property string tvSymbol
                required property double price
                required property double change
                required property double pct
                required property double prevClose
                required property var closes
                required property bool hasData
                required property bool up

                width: body.width
                height: card.overviewTab ? 30 : 34
                property real priceWidth: 58
                property real rsiWidth: 28
                property real openWidth: 24
                property real chartWidth: Math.max(44, Math.min(88, width * 0.27))
                property real gap: 6
                property real nameWidth: Math.max(54, width - priceWidth - rsiWidth - chartWidth - openWidth - gap * 5 - 8)
                property var rsiValue: card.calculateRsi(closes, 14)

                Rectangle {
                    anchors.fill: parent
                    radius: 5
                    color: rowMouse.containsMouse ? Theme.hover : "transparent"
                }

                MouseArea {
                    id: rowMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: row.tvSymbol ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: card.openSymbol(row.tvSymbol)
                }

                Text {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.nameWidth
                    text: card.overviewTab ? row.display : row.ticker
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                }

                Text {
                    visible: !card.overviewTab
                    anchors.left: parent.left
                    anchors.top: parent.verticalCenter
                    width: row.nameWidth
                    text: row.display
                    color: Theme.textSecondary
                    font.pixelSize: 8
                    elide: Text.ElideRight
                }

                Text {
                    anchors.left: parent.left
                    anchors.leftMargin: row.nameWidth + row.gap
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.rsiWidth
                    horizontalAlignment: Text.AlignRight
                    text: row.rsiValue === null || row.rsiValue === undefined
                          ? "--" : Math.round(row.rsiValue)
                    color: card.rsiTone(row.rsiValue)
                    font.pixelSize: 10
                }

                Canvas {
                    id: spark
                    anchors.left: parent.left
                    anchors.leftMargin: row.nameWidth + row.rsiWidth + row.gap * 2
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.chartWidth
                    height: 18
                    visible: row.hasData && row.closes.length > 1

                    onPaint: {
                        const ctx = getContext("2d")
                        ctx.reset()
                        const points = row.closes
                        if (!points || points.length < 2)
                            return
                        let min = points[0], max = points[0]
                        if (row.prevClose > 0) {
                            min = Math.min(min, row.prevClose)
                            max = Math.max(max, row.prevClose)
                        }
                        for (const v of points) {
                            if (v < min) min = v
                            if (v > max) max = v
                        }
                        const span = (max - min) || 1
                        if (row.prevClose > 0) {
                            const py = height - 1 - (row.prevClose - min) / span * (height - 2)
                            ctx.strokeStyle = "rgba(255, 255, 255, 0.22)"
                            ctx.lineWidth = 0.8
                            ctx.beginPath()
                            for (let x = 0; x < width; x += 5) {
                                ctx.moveTo(x, py)
                                ctx.lineTo(Math.min(width, x + 2.5), py)
                            }
                            ctx.stroke()
                        }
                        ctx.strokeStyle = row.up ? card.upColor : card.downColor
                        ctx.lineWidth = 1.2
                        ctx.beginPath()
                        for (let i = 0; i < points.length; i++) {
                            const x = i / (points.length - 1) * width
                            const y = height - 1 - (points[i] - min) / span * (height - 2)
                            if (i === 0) ctx.moveTo(x, y)
                            else ctx.lineTo(x, y)
                        }
                        ctx.stroke()
                    }

                    Connections {
                        target: row
                        function onClosesChanged() { spark.requestPaint() }
                    }
                    Component.onCompleted: requestPaint()
                }

                Rectangle {
                    visible: row.tvSymbol !== ""
                    anchors.right: parent.right
                    anchors.rightMargin: row.priceWidth + row.gap
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.openWidth
                    height: 18
                    radius: 5
                    color: rowOpenMouse.containsMouse ? Theme.activeFill : Qt.rgba(1, 1, 1, 0.04)
                    border.color: rowOpenMouse.containsMouse ? Theme.accent : Theme.cardStroke
                    Text {
                        anchors.centerIn: parent
                        text: "TV"
                        color: Theme.textSecondary
                        font.pixelSize: 8
                        font.weight: Font.DemiBold
                    }
                    MouseArea {
                        id: rowOpenMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: card.openSymbol(row.tvSymbol)
                    }
                }

                Column {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.priceWidth
                    spacing: 0

                    Text {
                        width: parent.width
                        horizontalAlignment: Text.AlignRight
                        text: row.hasData
                            ? Number(row.price).toLocaleString(Qt.locale("fr_CA"),
                                  "f", row.price >= 1000 ? 0 : 2)
                            : "—"
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeCaption
                    }
                    Text {
                        width: parent.width
                        horizontalAlignment: Text.AlignRight
                        text: row.hasData
                            ? (row.change > 0 ? "+" : "") + Number(row.change).toLocaleString(
                                  Qt.locale("fr_CA"), "f", Math.abs(row.change) >= 1000 ? 0 : 2)
                            : ""
                        color: row.up ? card.upColor : card.downColor
                        font.pixelSize: 10
                    }
                }
            }
        }

        Text {
            visible: !card.iposTab && !card.earningsTab && !card.heatmapTab && Stocks.count === 0
            width: parent.width
            text: Stocks.listNames.length ? "Liste vide" : "Aucune liste trouvee"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            horizontalAlignment: Text.AlignHCenter
        }
    }
}
