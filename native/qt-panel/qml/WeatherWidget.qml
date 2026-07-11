import QtQuick
import QtPanel.Native

GlassCard {
    id: card
    title: "Pr\u00e9visions"
    implicitHeight: body.implicitHeight + 24

    property real dailyHeight: {
        const stored = Number(Store.get("wp-weather-daily-height", 164))
        return Math.max(110, Math.min(420, stored || 164))
    }
    property real resizeStartHeight: dailyHeight

    function precipitationLabel(value) {
        const amount = Number(value)
        if (!isFinite(amount))
            return "--"
        if (amount <= 0)
            return "0 mm"
        return (amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)) + " mm"
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 8

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
            width: parent.width
            spacing: 10
            visible: Weather.ready

            Text {
                text: Weather.current.emoji || ""
                font.pixelSize: 30
                anchors.verticalCenter: parent.verticalCenter
            }
            Column {
                spacing: 1
                Text {
                    text: Math.round(Weather.current.tempC) + "\u00b0"
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
            Item { width: Math.max(0, parent.width - 230); height: 1 }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 2
                Text {
                    text: "Humidit\u00e9  " + Math.round(Weather.current.humidityPct) + "%"
                    color: Theme.textSecondary
                    font.pixelSize: 10
                }
                Text {
                    text: "Vent  " + Math.round(Weather.current.windKmh) + " km/h"
                    color: Theme.textSecondary
                    font.pixelSize: 10
                }
            }
        }

        Text {
            visible: Weather.ready
            text: "Ressenti " + Math.round(Weather.current.apparentC) + "\u00b0"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
        }

        Text {
            visible: !Weather.ready
            text: Weather.error ? "M\u00e9t\u00e9o indisponible" : "Chargement..."
            color: Weather.error ? "#fca5a5" : Theme.textSecondary
            font.pixelSize: Theme.fontSizeBody
        }

        Row {
            visible: Weather.ready && Weather.hourly.length > 0
            width: parent.width
            spacing: 2

            Repeater {
                model: Weather.hourly.slice(0, 6)
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    width: (body.width - 10) / 6
                    height: 53
                    radius: 5
                    color: index === 0 ? Qt.rgba(0.97, 0.79, 0.31, 0.10) : "transparent"

                    Column {
                        anchors.centerIn: parent
                        spacing: 2
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: index === 0 ? "Maint." : modelData.hour
                            color: index === 0 ? "#f7c94f" : Theme.textSecondary
                            font.pixelSize: 8
                        }
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: modelData.emoji
                            font.pixelSize: 12
                        }
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: Math.round(modelData.tempC) + "\u00b0"
                            color: Theme.textPrimary
                            font.pixelSize: 10
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: Weather.ready && Weather.daily.length > 0
            width: parent.width
            height: 25
            color: Qt.rgba(0.12, 0.43, 1.0, 0.07)
            border.color: Qt.rgba(1, 1, 1, 0.06)

            Row {
                anchors.fill: parent
                anchors.leftMargin: 2
                anchors.rightMargin: 2
                spacing: 2
                property real usable: width - spacing * 5

                Repeater {
                    model: [
                        { text: "JOUR", ratio: 0.18, align: Text.AlignLeft },
                        { text: "CIEL", ratio: 0.10, align: Text.AlignHCenter },
                        { text: "MAX", ratio: 0.12, align: Text.AlignHCenter },
                        { text: "PR\u00c9CIP.", ratio: 0.20, align: Text.AlignHCenter },
                        { text: "VENT", ratio: 0.14, align: Text.AlignHCenter },
                        { text: "MIN/MAX", ratio: 0.26, align: Text.AlignHCenter },
                    ]
                    delegate: Text {
                        required property var modelData
                        width: parent.usable * modelData.ratio
                        anchors.verticalCenter: parent.verticalCenter
                        text: modelData.text
                        color: Qt.rgba(0.96, 0.98, 1, 0.56)
                        font.pixelSize: 7
                        horizontalAlignment: modelData.align
                        elide: Text.ElideRight
                    }
                }
            }
        }

        Flickable {
            id: dailyFlick
            visible: Weather.ready && Weather.daily.length > 0
            width: parent.width
            height: card.dailyHeight
            contentHeight: dailyRows.height
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Column {
                id: dailyRows
                width: dailyFlick.width

                Repeater {
                    model: Weather.daily
                    delegate: Item {
                        required property var modelData
                        required property int index
                        width: dailyRows.width
                        height: 32

                        Rectangle {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            height: 1
                            color: Qt.rgba(1, 1, 1, 0.04)
                        }

                        Row {
                            anchors.fill: parent
                            anchors.leftMargin: 2
                            anchors.rightMargin: 2
                            spacing: 2
                            property real usable: width - spacing * 5

                            Column {
                                width: parent.usable * 0.18
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 1
                                Text {
                                    text: modelData.day
                                    color: Theme.textPrimary
                                    font.pixelSize: 9
                                    elide: Text.ElideRight
                                    width: parent.width
                                }
                                Text {
                                    text: modelData.dateLabel
                                    color: Theme.textSecondary
                                    font.pixelSize: 8
                                }
                            }
                            Text {
                                width: parent.usable * 0.10
                                anchors.verticalCenter: parent.verticalCenter
                                text: modelData.emoji
                                font.pixelSize: 11
                                horizontalAlignment: Text.AlignHCenter
                            }
                            Text {
                                width: parent.usable * 0.12
                                anchors.verticalCenter: parent.verticalCenter
                                text: Math.round(modelData.maxC) + "\u00b0"
                                color: "#ff7169"
                                font.pixelSize: 11
                                horizontalAlignment: Text.AlignHCenter
                            }
                            Text {
                                width: parent.usable * 0.20
                                anchors.verticalCenter: parent.verticalCenter
                                text: card.precipitationLabel(modelData.precipMm)
                                color: Number(modelData.precipMm) > 0 ? "#70a8ff" : Theme.textSecondary
                                font.pixelSize: 8
                                horizontalAlignment: Text.AlignHCenter
                                elide: Text.ElideRight
                            }
                            Rectangle {
                                width: parent.usable * 0.14
                                height: 20
                                radius: 10
                                anchors.verticalCenter: parent.verticalCenter
                                color: Qt.rgba(1, 1, 1, 0.025)
                                border.color: Number(modelData.windKmh) >= 25
                                              ? Qt.rgba(0.97, 0.79, 0.31, 0.72)
                                              : Qt.rgba(0.96, 0.98, 1, 0.28)
                                Text {
                                    anchors.centerIn: parent
                                    text: Math.round(Number(modelData.windKmh)) || "--"
                                    color: Theme.textPrimary
                                    font.pixelSize: 8
                                }
                            }
                            Item {
                                width: parent.usable * 0.26
                                height: 20
                                anchors.verticalCenter: parent.verticalCenter
                                Text {
                                    anchors.left: parent.left
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: Math.round(modelData.minC) + "\u00b0"
                                    color: Theme.textSecondary
                                    font.pixelSize: 7
                                }
                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.leftMargin: 15
                                    anchors.rightMargin: 15
                                    anchors.verticalCenter: parent.verticalCenter
                                    height: 3
                                    radius: 2
                                    gradient: Gradient {
                                        orientation: Gradient.Horizontal
                                        GradientStop { position: 0; color: "#4f8ef7" }
                                        GradientStop { position: 1; color: "#f7c94f" }
                                    }
                                    opacity: 0.42
                                }
                                Text {
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: Math.round(modelData.maxC) + "\u00b0"
                                    color: Theme.textPrimary
                                    font.pixelSize: 7
                                }
                            }
                        }
                    }
                }
            }
        }

        Item {
            visible: Weather.ready && Weather.daily.length > 0
            width: parent.width
            height: 8

            Rectangle {
                width: 28
                height: 2
                radius: 1
                anchors.centerIn: parent
                color: Qt.rgba(1, 1, 1, resizeDrag.active ? 0.28 : 0.10)
            }

            DragHandler {
                id: resizeDrag
                target: null
                xAxis.enabled: false
                yAxis.enabled: true
                onActiveChanged: {
                    if (active) {
                        card.resizeStartHeight = card.dailyHeight
                    } else {
                        Store.set("wp-weather-daily-height", String(Math.round(card.dailyHeight)))
                    }
                }
                onActiveTranslationChanged: {
                    if (active)
                        card.dailyHeight = Math.max(110, Math.min(420,
                            card.resizeStartHeight + activeTranslation.y))
                }
            }
        }
    }
}
