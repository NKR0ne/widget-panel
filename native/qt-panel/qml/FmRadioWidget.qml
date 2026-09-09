import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Basic as Basic
import QtPanel.Native

GlassCard {
    id: card
    title: "Radio FM"
    implicitHeight: 365
    interactive: false
    activeFocusOnTab: true
    Accessible.role: Accessible.Pane
    Accessible.name: title

    readonly property var regionOptions: [
        { label: "R\u00e9gion", value: "local" },
        { label: "Canada", value: "canada" },
        { label: "Monde", value: "world" },
    ]
    readonly property var categoryOptions: [
        { label: "Tous les types", value: "all" },
        { label: "Musique", value: "music" },
        { label: "Actualit\u00e9s", value: "news" },
        { label: "Talk-radio", value: "talk" },
        { label: "Sports", value: "sports" },
        { label: "Pop", value: "pop" },
        { label: "Rock", value: "rock" },
        { label: "Jazz", value: "jazz" },
        { label: "Classique", value: "classical" },
        { label: "Country", value: "country" },
        { label: "\u00c9lectronique", value: "electronic" },
    ]

    function optionIndex(options, value) {
        const index = options.findIndex(function(option) { return option.value === value })
        return Math.max(0, index)
    }

    function runBrowse() {
        Radio.browse(stationSearch.text,
                     regionOptions[regionFilter.currentIndex].value,
                     categoryOptions[categoryFilter.currentIndex].value)
    }

    function returnToLibrary() {
        stationSearch.text = ""
        Radio.showLibrary()
    }

    component FilterCombo: Basic.ComboBox {
        id: selector
        property string accessibleLabel
        textRole: "label"
        font.pixelSize: 9
        leftPadding: 8
        rightPadding: 22
        Accessible.name: accessibleLabel
        onVisibleChanged: if (!visible) popup.close()
        contentItem: Text {
            text: selector.displayText
            font: selector.font
            color: Theme.textPrimary
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        indicator: Text {
            x: selector.width - width - 7
            anchors.verticalCenter: parent.verticalCenter
            text: "\uE70D"
            font.family: "Segoe Fluent Icons"
            font.pixelSize: 8
            color: Theme.textSecondary
        }
        background: Rectangle {
            radius: 6
            color: selector.hovered ? Theme.hover : Qt.rgba(1, 1, 1, 0.05)
            border.color: selector.activeFocus ? Theme.accent : Theme.cardStroke
        }
        delegate: Basic.ItemDelegate {
            id: option
            required property int index
            required property var modelData
            width: selector.popup.availableWidth
            height: 28
            highlighted: selector.highlightedIndex === index
            contentItem: Text {
                text: option.modelData.label
                font: selector.font
                color: Theme.textPrimary
                verticalAlignment: Text.AlignVCenter
                elide: Text.ElideRight
            }
            background: Rectangle {
                radius: 4
                color: option.highlighted ? Theme.activeFill
                      : option.hovered ? Theme.hover : "transparent"
            }
        }
        popup: Basic.Popup {
            id: filterPopup
            parent: Overlay.overlay
            popupType: Popup.Item
            width: Math.max(selector.width, 132)
            margins: 4
            padding: 4
            implicitHeight: Math.min(260,
                contentItem.implicitHeight + topPadding + bottomPadding)
            function positionAtSelector() {
                if (!parent) return
                const below = selector.mapToItem(parent, 0, selector.height + 3)
                const above = selector.mapToItem(parent, 0, -3)
                x = Math.max(4, Math.min(below.x, parent.width - width - 4))
                y = below.y + height <= parent.height - 4
                    ? below.y : Math.max(4, above.y - height)
            }
            onAboutToShow: positionAtSelector()
            Timer {
                interval: 16
                running: filterPopup.visible
                repeat: true
                onTriggered: filterPopup.positionAtSelector()
            }
            background: Rectangle {
                color: Theme.panelSolid
                radius: 6
                border.color: Theme.cardStroke
            }
            contentItem: ListView {
                implicitHeight: contentHeight
                clip: true
                model: selector.delegateModel
                currentIndex: selector.highlightedIndex
                boundsBehavior: Flickable.StopAtBounds
            }
        }
    }

    Keys.onSpacePressed: Radio.toggle()
    Keys.onLeftPressed: Radio.previous()
    Keys.onRightPressed: Radio.next()
    Keys.onUpPressed: Radio.volume = Math.min(1, Radio.volume + 0.05)
    Keys.onDownPressed: Radio.volume = Math.max(0, Radio.volume - 0.05)

    Component.onCompleted: {
        if (Radio.stations.length === 0 && !Radio.loading)
            Radio.browse(Radio.query, Radio.region, Radio.category)
    }

    Column {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        CardHeader {
            width: parent.width
            title: card.title
            status: Radio.loading ? "RECHERCHE"
                  : Radio.buffering ? "CONNEXION"
                  : Radio.playing ? "EN DIRECT"
                  : Radio.error !== "" ? "HORS LIGNE"
                  : !Radio.libraryMode ? "FILTR\u00c9" : "PR\u00caT"
            statusColor: Radio.error !== "" ? "#f87171"
                       : Radio.playing ? "#fb7185" : Theme.textSecondary
        }

        Row {
            width: parent.width
            height: 58
            spacing: 10

            Rectangle {
                width: 52; height: 52; radius: 12
                color: Qt.rgba(0.31, 0.56, 0.97, 0.13)
                border.color: Qt.rgba(0.31, 0.56, 0.97, 0.28)
                clip: true

                Image {
                    id: stationLogo
                    anchors.fill: parent
                    anchors.margins: 5
                    source: Radio.logoUrl
                    fillMode: Image.PreserveAspectFit
                    asynchronous: true
                    visible: status === Image.Ready
                }
                Text {
                    anchors.centerIn: parent
                    visible: !stationLogo.visible
                    text: Radio.frequency !== ""
                          ? Radio.frequency.replace(" FM", "") : "FM"
                    color: Theme.accent
                    font.pixelSize: Radio.frequency !== "" ? 13 : 18
                    font.weight: Font.DemiBold
                }
            }

            Column {
                width: parent.width - 62
                anchors.verticalCenter: parent.verticalCenter
                spacing: 3
                Text {
                    width: parent.width
                    text: Radio.stationName || "Choisir une station"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                }
                Text {
                    width: parent.width
                    text: Radio.frequency !== "" ? Radio.frequency : Radio.stationDetail
                    color: Theme.accent
                    font.pixelSize: Theme.fontSizeCaption
                    elide: Text.ElideRight
                }
                Text {
                    width: parent.width
                    text: Radio.nowPlaying !== "" ? Radio.nowPlaying
                        : Radio.error !== "" ? Radio.error : Radio.stationDetail
                    color: Radio.error !== "" ? "#fca5a5" : Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }
            }
        }

        Row {
            width: parent.width
            height: 38
            spacing: 10
            anchors.horizontalCenter: parent.horizontalCenter

            Repeater {
                model: [
                    { glyph: "\uE892", label: "Station pr\u00e9c\u00e9dente" },
                    { glyph: Radio.playing ? "\uE769" : "\uE768",
                      label: Radio.playing ? "Pause" : "Lecture" },
                    { glyph: "\uE893", label: "Station suivante" },
                ]
                delegate: Rectangle {
                    required property var modelData
                    required property int index
                    width: index === 1 ? 44 : 36
                    height: index === 1 ? 38 : 34
                    radius: width / 2
                    anchors.verticalCenter: parent.verticalCenter
                    color: controlHover.containsMouse
                        ? Qt.rgba(0.31, 0.56, 0.97, 0.30)
                        : index === 1 ? Theme.accent : Qt.rgba(1, 1, 1, 0.08)
                    border.color: index === 1
                        ? Qt.rgba(1, 1, 1, 0.26) : Theme.cardStroke

                    Text {
                        anchors.centerIn: parent
                        text: modelData.glyph
                        font.family: "Segoe Fluent Icons"
                        font.pixelSize: index === 1 ? 16 : 13
                        color: index === 1 ? "#fff" : Theme.textPrimary
                    }
                    MouseArea {
                        id: controlHover
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        Accessible.role: Accessible.Button
                        Accessible.name: modelData.label
                        onClicked: {
                            SoundFx.tap()
                            if (index === 0) Radio.previous()
                            else if (index === 1) Radio.toggle()
                            else Radio.next()
                        }
                    }
                }
            }
        }

        Row {
            width: parent.width
            height: 16
            spacing: 7
            Text {
                text: Radio.volume <= 0.01 ? "\uE74F" : "\uE767"
                font.family: "Segoe Fluent Icons"
                font.pixelSize: 11
                color: Theme.textSecondary
                anchors.verticalCenter: parent.verticalCenter
            }
            Rectangle {
                id: volumeTrack
                width: parent.width - 25
                height: 4; radius: 2
                anchors.verticalCenter: parent.verticalCenter
                color: Qt.rgba(1, 1, 1, 0.12)
                Rectangle {
                    width: parent.width * Radio.volume
                    height: parent.height; radius: parent.radius
                    color: Theme.accent
                }
                Rectangle {
                    width: 10; height: 10; radius: 5
                    x: Math.max(-5, Math.min(parent.width - 5,
                                             parent.width * Radio.volume - 5))
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#fff"
                    border.color: Theme.accent
                }
                MouseArea {
                    anchors.fill: parent
                    anchors.margins: -6
                    cursorShape: Qt.PointingHandCursor
                    function apply(mouseX) {
                        Radio.volume = Math.max(0, Math.min(1, mouseX / width))
                    }
                    onPressed: function(mouse) { apply(mouse.x) }
                    onPositionChanged: function(mouse) {
                        if (pressed) apply(mouse.x)
                    }
                }
            }
        }

        Row {
            width: parent.width
            height: 28
            spacing: 7

            FilterCombo {
                id: regionFilter
                objectName: "radioRegionFilter"
                width: (parent.width - parent.spacing) * 0.40
                height: parent.height
                model: card.regionOptions
                currentIndex: card.optionIndex(card.regionOptions, Radio.region)
                accessibleLabel: "Filtrer par r\u00e9gion"
                onActivated: card.runBrowse()
            }
            FilterCombo {
                id: categoryFilter
                objectName: "radioCategoryFilter"
                width: parent.width - regionFilter.width - parent.spacing
                height: parent.height
                model: card.categoryOptions
                currentIndex: card.optionIndex(card.categoryOptions, Radio.category)
                accessibleLabel: "Filtrer par type ou genre"
                onActivated: card.runBrowse()
            }
        }

        Rectangle {
            width: parent.width
            height: 28
            radius: 7
            color: Qt.rgba(1, 1, 1, 0.05)
            border.color: stationSearch.activeFocus ? Theme.accent : Theme.cardStroke
            TextInput {
                id: stationSearch
                text: Radio.query
                anchors.fill: parent
                anchors.leftMargin: Radio.libraryMode ? 8 : 34
                anchors.rightMargin: 30
                verticalAlignment: TextInput.AlignVCenter
                color: Theme.textPrimary
                font.pixelSize: 10
                clip: true
                onAccepted: card.runBrowse()
                Text {
                    visible: stationSearch.text === "" && !stationSearch.activeFocus
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Rechercher une station\u2026"
                    color: Qt.rgba(1, 1, 1, 0.30)
                    font.pixelSize: 10
                }
            }
            Text {
                visible: !Radio.libraryMode
                anchors.left: parent.left
                anchors.leftMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: "\uE72B"
                font.family: "Segoe Fluent Icons"
                color: Theme.accent
                font.pixelSize: 12
            }
            MouseArea {
                visible: !Radio.libraryMode
                anchors.left: parent.left
                width: 30
                height: parent.height
                cursorShape: Qt.PointingHandCursor
                Accessible.role: Accessible.Button
                Accessible.name: "Retour \u00e0 la biblioth\u00e8que"
                onClicked: {
                    SoundFx.tap()
                    card.returnToLibrary()
                }
            }
            Text {
                anchors.right: parent.right
                anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: "\uE721"
                font.family: "Segoe Fluent Icons"
                color: Theme.textSecondary
                font.pixelSize: 13
            }
            MouseArea {
                anchors.right: parent.right
                width: 30; height: parent.height
                cursorShape: Qt.PointingHandCursor
                Accessible.role: Accessible.Button
                Accessible.name: "Rechercher"
                onClicked: card.runBrowse()
            }
        }

        ListView {
            id: stationList
            objectName: "radioStationList"
            width: parent.width
            height: Math.max(40, parent.height - y - stationFooter.height - parent.spacing)
            clip: true
            spacing: 2
            model: Radio.stations
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: Basic.ScrollBar {
                width: 6
                padding: 0
                contentItem: Rectangle {
                    implicitWidth: 6; implicitHeight: 24; radius: 3
                    color: Theme.textSecondary
                    opacity: parent.active || parent.hovered ? 0.85 : 0.45
                }
                background: Item {}
            }
            delegate: Rectangle {
                id: stationRow
                required property var modelData
                width: stationList.width - 10
                height: 24
                radius: 5
                color: modelData.id === Radio.currentStationId
                    ? Qt.rgba(0.31, 0.56, 0.97, 0.18)
                    : rowHover.containsMouse ? Theme.hover : "transparent"
                Text {
                    anchors.left: parent.left
                    anchors.right: detail.left
                    anchors.leftMargin: 7
                    anchors.rightMargin: 6
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.name
                    color: modelData.id === Radio.currentStationId
                        ? Theme.textPrimary : Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }
                Text {
                    id: detail
                    anchors.right: parent.right
                    anchors.rightMargin: 7
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.frequency || modelData.codec
                    color: Theme.accent
                    font.pixelSize: 8
                }
                MouseArea {
                    id: rowHover
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    Accessible.role: Accessible.ListItem
                    Accessible.name: modelData.name
                    onClicked: {
                        Radio.selectStation(modelData.id)
                        Radio.play()
                    }
                }
            }
        }

        Text {
            id: stationFooter
            objectName: "radioFooter"
            width: parent.width
            horizontalAlignment: Text.AlignRight
            text: (Radio.libraryMode ? "Biblioth\u00e8que locale" : "R\u00e9sultats")
                  + "  \u00b7  " + Radio.stations.length + " stations  \u00b7  Radio Browser"
            color: Qt.rgba(1, 1, 1, 0.28)
            font.pixelSize: 8
        }
    }
}
