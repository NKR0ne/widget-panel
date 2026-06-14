import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Marchés"
    implicitHeight: body.implicitHeight + 24

    readonly property color upColor: "#34d399"
    readonly property color downColor: "#f87171"

    // Tabs: one per watchlist + IPO + Heatmap (the last two are special).
    property int tab: 0   // 0..N-1 = lists, N = IPO
    readonly property int listCount: Stocks.listNames.length
    readonly property bool iposTab: tab === listCount

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 6

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
                        names.push("IPO")
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
                                else Stocks.refreshIpos()
                            }
                        }
                    }
                }
                Rectangle {
                    height: 18
                    width: heatmapLabel.implicitWidth + 14
                    radius: 5
                    color: heatmapMouse.containsMouse ? Theme.hover : Theme.cardFill
                    border.color: Theme.cardStroke
                    Text { id: heatmapLabel; anchors.centerIn: parent; text: "Heatmap"
                           color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: heatmapMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Panel.openIsland("https://www.tradingview.com/heatmap/stock/")
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
                    Text { width: 42; text: modelData.date; color: Theme.accent; font.pixelSize: 10 }
                    Column {
                        width: parent.width - 90
                        Text { width: parent.width; text: modelData.name; color: Theme.textPrimary
                               font.pixelSize: Theme.fontSizeCaption; elide: Text.ElideRight }
                        Text { width: parent.width; text: modelData.exchange; color: Theme.textSecondary
                               font.pixelSize: 9; elide: Text.ElideRight }
                    }
                    Text { text: modelData.priceRange; color: Theme.textSecondary; font.pixelSize: 9
                           anchors.verticalCenter: parent.verticalCenter }
                }
            }
        }

        Repeater {
            model: card.iposTab ? 0 : Stocks

            delegate: Item {
                id: row

                required property string display
                required property double price
                required property double pct
                required property var closes
                required property bool hasData
                required property bool up

                width: body.width
                height: 30

                Text {
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.width * 0.38
                    text: row.display
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                    elide: Text.ElideRight
                }

                Canvas {
                    id: spark
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.verticalCenter: parent.verticalCenter
                    width: row.width * 0.22
                    height: 16
                    visible: row.hasData && row.closes.length > 1

                    onPaint: {
                        const ctx = getContext("2d")
                        ctx.reset()
                        const points = row.closes
                        if (!points || points.length < 2)
                            return
                        let min = points[0], max = points[0]
                        for (const v of points) {
                            if (v < min) min = v
                            if (v > max) max = v
                        }
                        const span = (max - min) || 1
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

                Column {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 0

                    Text {
                        anchors.right: parent.right
                        text: row.hasData
                            ? Number(row.price).toLocaleString(Qt.locale("fr_CA"),
                                  "f", row.price >= 1000 ? 0 : 2)
                            : "—"
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeCaption
                    }
                    Text {
                        anchors.right: parent.right
                        text: row.hasData
                            ? (row.up ? "+" : "") + row.pct.toFixed(2) + " %"
                            : ""
                        color: row.up ? card.upColor : card.downColor
                        font.pixelSize: 10
                    }
                }
            }
        }
    }
}
