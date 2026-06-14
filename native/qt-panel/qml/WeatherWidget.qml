import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Prévisions"
    implicitHeight: body.implicitHeight + 24

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 10

        Text {
            text: Weather.locationName || card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
            elide: Text.ElideRight
            width: parent.width
        }

        Row {
            spacing: 10
            visible: Weather.ready

            Text {
                text: Weather.current.emoji || ""
                font.pixelSize: 30
                anchors.verticalCenter: parent.verticalCenter
            }
            Column {
                spacing: 0
                Text {
                    text: Weather.ready ? Math.round(Weather.current.tempC) + "°" : "—"
                    color: Theme.textPrimary
                    font.pixelSize: 30
                    font.weight: Font.Light
                }
                Text {
                    text: Weather.current.label || ""
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeBody
                }
            }
        }

        Text {
            visible: Weather.ready
            text: Weather.ready
                ? "Ressenti " + Math.round(Weather.current.apparentC) + "° · "
                  + Math.round(Weather.current.humidityPct) + "% · "
                  + Math.round(Weather.current.windKmh) + " km/h"
                : ""
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }

        Text {
            visible: !Weather.ready
            text: Weather.error ? "Météo indisponible" : "Chargement…"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeBody
        }

        // Hourly strip (next 8 hours)
        Row {
            visible: Weather.ready && Weather.hourly.length > 0
            width: parent.width
            spacing: 4

            Repeater {
                model: Weather.hourly.slice(0, 8)
                delegate: Column {
                    required property var modelData
                    width: (body.width - 7 * 4) / 8
                    spacing: 2
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: modelData.hour
                        color: Theme.textSecondary
                        font.pixelSize: 9
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: modelData.emoji
                        font.pixelSize: 12
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: Math.round(modelData.tempC) + "°"
                        color: Theme.textPrimary
                        font.pixelSize: 10
                    }
                }
            }
        }

        // Daily rows (5 days)
        Column {
            visible: Weather.ready && Weather.daily.length > 0
            width: parent.width
            spacing: 4

            Repeater {
                model: Weather.daily
                delegate: Row {
                    required property var modelData
                    width: parent.width
                    spacing: 6

                    Text {
                        width: 34
                        text: modelData.day
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                    }
                    Text {
                        width: 18
                        text: modelData.emoji
                        font.pixelSize: 11
                    }
                    Text {
                        text: Math.round(modelData.minC) + "°"
                        color: Theme.textSecondary
                        font.pixelSize: Theme.fontSizeCaption
                    }
                    Text {
                        text: Math.round(modelData.maxC) + "°"
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeCaption
                        font.weight: Font.DemiBold
                    }
                    Item { width: 4; height: 1 }
                    Text {
                        visible: Number(modelData.precipPct) >= 20
                        text: Math.round(modelData.precipPct) + "%"
                        color: "#6fb7ff"
                        font.pixelSize: 10
                    }
                }
            }
        }
    }
}
