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
    property var activeFilter: null
    readonly property var displayedStations: Radio.favoritesMode ? Radio.favorites : Radio.stations
    function isFavorite(id) {
        return Radio.favorites.some(function(station) { return station.id === id })
    }
    function closeFilter() { activeFilter = null }
    function openFilter(selector) {
        if (activeFilter === selector) { closeFilter(); return }
        activeFilter = selector
        filterOptions.currentIndex = selector.currentIndex
        filterOptions.forceActiveFocus()
        filterOptions.positionViewAtIndex(selector.currentIndex, ListView.Contain)
    }
    function chooseFilter(index) {
        const selector = activeFilter
        if (!selector || index < 0 || index >= selector.model.length) return
        closeFilter()
        selector.activated(index)
        selector.forceActiveFocus()
    }
    onVisibleChanged: if (!visible) closeFilter()
    TapHandler {
        onPressedChanged: {
            if (!pressed || !card.activeFilter) return
            const p = filterRow.mapFromItem(card, point.position.x, point.position.y)
            const inMenu = p.x >= filterMenu.x && p.x <= filterMenu.x + filterMenu.width
                && p.y >= filterMenu.y && p.y <= filterMenu.y + filterMenu.height
            if (!inMenu && (p.y < 0 || p.y > filterRow.height)) card.closeFilter()
        }
    }

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

    component FilterCombo: Basic.Button {
        id: selector
        property string accessibleLabel
        property var model: []
        property int currentIndex: 0
        signal activated(int index)
        font.pixelSize: 9
        leftPadding: 8
        rightPadding: 22
        Accessible.name: accessibleLabel
        Accessible.role: Accessible.ComboBox
        onClicked: card.openFilter(selector)
        Keys.onDownPressed: card.openFilter(selector)
        Keys.onUpPressed: card.openFilter(selector)
        contentItem: Text {
            text: selector.model[selector.currentIndex].label
            font: selector.font
            color: Theme.textPrimary
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        Text {
            x: selector.width - width - 7
            anchors.verticalCenter: parent.verticalCenter
            text: card.activeFilter === selector ? "\uE70E" : "\uE70D"
            font.family: "Segoe Fluent Icons"
            font.pixelSize: 8
            color: Theme.textSecondary
        }
        background: Rectangle {
            radius: 6
            color: selector.hovered ? Theme.hover : Qt.rgba(1, 1, 1, 0.05)
            border.color: selector.activeFocus ? Theme.accent : Theme.cardStroke
        }
    }

    Keys.onSpacePressed: Radio.toggle()
    Keys.onLeftPressed: Radio.previous()
    Keys.onRightPressed: Radio.next()
    Keys.onUpPressed: Radio.volume = Math.min(1, Radio.volume + 0.05)
    Keys.onDownPressed: Radio.volume = Math.max(0, Radio.volume - 0.05)

    Component.onCompleted: {
        if (!Radio.favoritesMode && Radio.stations.length === 0 && !Radio.loading)
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
            height: 26
            spacing: 4
            Repeater {
                model: ["Stations", "Favoris"]
                delegate: Basic.Button {
                    required property int index
                    required property string modelData
                    objectName: index === 1 ? "radioFavoritesTab" : "radioStationsTab"
                    width: (parent.width - parent.spacing) / 2
                    height: 26
                    checked: Radio.favoritesMode === (index === 1)
                    text: modelData
                    Accessible.role: Accessible.PageTab
                    contentItem: Text {
                        text: parent.text
                        color: parent.checked ? Theme.textPrimary : Theme.textSecondary
                        font.pixelSize: 10
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    background: Rectangle {
                        radius: 6
                        color: parent.checked ? Theme.activeFill : parent.hovered ? Theme.hover : "transparent"
                    }
                    onClicked: {
                        card.closeFilter()
                        Radio.favoritesMode = index === 1
                        if (!Radio.favoritesMode && Radio.stations.length === 0 && !Radio.loading)
                            card.runBrowse()
                    }
                }
            }
        }

        Item {
            id: filterRow
            visible: !Radio.favoritesMode
            z: 10
            width: parent.width
            height: 28

            FilterCombo {
                id: regionFilter
                objectName: "radioRegionFilter"
                width: (parent.width - 7) * 0.40
                height: parent.height
                model: card.regionOptions
                currentIndex: card.optionIndex(card.regionOptions, Radio.region)
                accessibleLabel: "Filtrer par r\u00e9gion"
                onActivated: function(index) {
                    Radio.browse(stationSearch.text, card.regionOptions[index].value, Radio.category)
                }
            }
            FilterCombo {
                id: categoryFilter
                objectName: "radioCategoryFilter"
                x: regionFilter.width + 7
                width: parent.width - x
                height: parent.height
                model: card.categoryOptions
                currentIndex: card.optionIndex(card.categoryOptions, Radio.category)
                accessibleLabel: "Filtrer par type ou genre"
                onActivated: function(index) {
                    Radio.browse(stationSearch.text, Radio.region, card.categoryOptions[index].value)
                }
            }

            // Stay in the card's scene subtree: no host/window/overlay coordinates.
            Rectangle {
                id: filterMenu
                objectName: "radioFilterMenu"
                visible: card.activeFilter !== null
                x: card.activeFilter ? card.activeFilter.x : 0
                y: filterRow.height + 3
                width: card.activeFilter ? Math.min(filterRow.width - x, Math.max(132, card.activeFilter.width)) : 0
                height: Math.min(260, filterOptions.contentHeight + 8,
                                 Math.max(36, filterRow.parent.height - filterRow.y - y))
                radius: 6
                color: Theme.panelSolid
                border.color: Theme.cardStroke
                ListView {
                    id: filterOptions
                    objectName: "radioFilterOptions"
                    anchors.fill: parent
                    anchors.margins: 4
                    model: card.activeFilter ? card.activeFilter.model : []
                    clip: true
                    keyNavigationEnabled: true
                    keyNavigationWraps: true
                    boundsBehavior: Flickable.StopAtBounds
                    Keys.onReturnPressed: card.chooseFilter(currentIndex)
                    Keys.onEnterPressed: card.chooseFilter(currentIndex)
                    Keys.onSpacePressed: card.chooseFilter(currentIndex)
                    Keys.onEscapePressed: {
                        const selector = card.activeFilter
                        card.closeFilter()
                        if (selector) selector.forceActiveFocus()
                    }
                    Keys.onTabPressed: {
                        const selector = card.activeFilter
                        card.closeFilter()
                        if (selector) selector.nextItemInFocusChain().forceActiveFocus()
                    }
                    ScrollBar.vertical: Basic.ScrollBar {
                        width: 5
                        padding: 0
                        contentItem: Rectangle { radius: 2; color: Theme.textSecondary; implicitHeight: 20 }
                        background: Item {}
                    }
                    delegate: Basic.ItemDelegate {
                        id: filterOption
                        required property int index
                        required property var modelData
                        width: filterOptions.width - 6
                        height: 28
                        highlighted: filterOptions.currentIndex === index
                        contentItem: Text {
                            text: filterOption.modelData.label
                            font.pixelSize: 9
                            color: Theme.textPrimary
                            verticalAlignment: Text.AlignVCenter
                            elide: Text.ElideRight
                        }
                        background: Rectangle {
                            radius: 4
                            color: filterOption.highlighted ? Theme.activeFill
                                  : filterOption.hovered ? Theme.hover : "transparent"
                        }
                        onClicked: card.chooseFilter(index)
                    }
                }
            }
        }

        Rectangle {
            visible: !Radio.favoritesMode
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
            model: card.displayedStations
            boundsBehavior: Flickable.StopAtBounds
            Text {
                anchors.centerIn: parent
                visible: Radio.favoritesMode && stationList.count === 0
                text: "Aucune station favorite"
                color: Theme.textSecondary
                font.pixelSize: 10
            }
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
                    anchors.right: favoriteButton.left
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
                Basic.Button {
                    id: favoriteButton
                    objectName: "radioFavorite-" + stationRow.modelData.id
                    anchors.right: parent.right
                    width: 26
                    height: parent.height
                    readonly property bool saved: card.isFavorite(stationRow.modelData.id)
                    Accessible.name: (saved ? "Retirer des favoris : " : "Ajouter aux favoris : ") + stationRow.modelData.name
                    Basic.ToolTip.visible: hovered
                    Basic.ToolTip.delay: 600
                    Basic.ToolTip.text: saved ? "Retirer des favoris" : "Ajouter aux favoris"
                    contentItem: Text {
                        text: favoriteButton.saved ? "\uE735" : "\uE734"
                        font.family: "Segoe Fluent Icons"
                        font.pixelSize: 12
                        color: favoriteButton.saved ? Theme.accent : Theme.textSecondary
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                    background: Rectangle { radius: 4; color: parent.hovered ? Theme.hover : "transparent" }
                    onClicked: Radio.toggleFavorite(stationRow.modelData.id)
                }
            }
        }

        Text {
            id: stationFooter
            objectName: "radioFooter"
            width: parent.width
            horizontalAlignment: Text.AlignRight
            text: (Radio.favoritesMode ? "Favoris" : Radio.libraryMode ? "Biblioth\u00e8que locale" : "R\u00e9sultats")
                  + "  \u00b7  " + card.displayedStations.length + " stations  \u00b7  Radio Browser"
            color: Qt.rgba(1, 1, 1, 0.28)
            font.pixelSize: 8
        }
    }
}
