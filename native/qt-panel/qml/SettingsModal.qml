import QtQuick
import QtPanel.Native

// Native settings sheet: opacities, card glass, autostart, base column count.
// Holds the modal guard while open, like every other overlay.
Item {
    id: modal

    property bool open: false

    function show() {
        baseColumnsDraft = Number(Store.get("wp-base-columns", 6)) || 6
        autostartDraft = Panel.autostart()
        open = true
        Panel.setModalOpen(true)
    }
    function dismiss() {
        open = false
        Panel.setModalOpen(false)
    }
    function parseJson(raw, fallback) {
        if (raw === undefined || raw === null || raw === "")
            return fallback
        if (typeof raw === "string") {
            try { return JSON.parse(raw) } catch (e) { return fallback }
        }
        return raw
    }
    function starvisConfig() {
        return parseJson(Store.get("wp-starvis-config", ""), {})
    }
    function starvisValue(key, fallback) {
        const cfg = starvisConfig()
        const value = cfg[key]
        return value === undefined || value === null || value === "" ? fallback : String(value)
    }
    function setStarvisValue(key, value) {
        const cfg = starvisConfig()
        cfg[key] = value
        if (key === "maxTokens")
            cfg[key] = Math.max(128, Math.min(8192, Number(value) || 1800))
        if (key === "baseUrl") {
            while (value.endsWith("/"))
                value = value.slice(0, -1)
            cfg[key] = value || "https://api.openai.com/v1"
            Store.set("wp-starvis-base-url", cfg[key])
        }
        Store.set("wp-starvis-config", JSON.stringify(cfg))
    }

    property int baseColumnsDraft: 6
    property bool autostartDraft: false

    Component {
        id: starvisField
        Rectangle {
            property string configKey: ""
            property string placeholder: ""
            property string fallback: ""
            width: sheet.width; height: 28; radius: 6
            color: Qt.rgba(1,1,1,0.05)
            border.color: sf.activeFocus ? Theme.accent : Theme.cardStroke
            TextInput {
                id: sf
                anchors.fill: parent; anchors.margins: 7
                verticalAlignment: TextInput.AlignVCenter
                color: Theme.textPrimary; font.pixelSize: 10; clip: true
                Component.onCompleted: text = modal.starvisValue(parent.configKey, parent.fallback)
                onEditingFinished: modal.setStarvisValue(parent.configKey, text.trim())
                Text {
                    visible: sf.text === "" && !sf.activeFocus
                    text: parent.parent.placeholder; color: Qt.rgba(1,1,1,0.25)
                    font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter
                }
            }
        }
    }

    Component {
        id: storeField
        Rectangle {
            property string storeKey: ""
            property string placeholder: ""
            property string fallback: ""
            width: sheet.width; height: 28; radius: 6
            color: Qt.rgba(1,1,1,0.05)
            border.color: stf.activeFocus ? Theme.accent : Theme.cardStroke
            TextInput {
                id: stf
                anchors.fill: parent; anchors.margins: 7
                verticalAlignment: TextInput.AlignVCenter
                color: Theme.textPrimary; font.pixelSize: 10; clip: true
                Component.onCompleted: text = Store.get(parent.storeKey, parent.fallback)
                onEditingFinished: Store.set(parent.storeKey, text.trim())
                Text {
                    visible: stf.text === "" && !stf.activeFocus
                    text: parent.parent.placeholder; color: Qt.rgba(1,1,1,0.25)
                    font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter
                }
            }
        }
    }

    anchors.fill: parent
    visible: opacity > 0
    opacity: open ? 1 : 0
    Behavior on opacity {
        NumberAnimation {
            duration: Motion.normalMs
            easing.type: Easing.BezierSpline
            easing.bezierCurve: Motion.emphasized
        }
    }

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.5)
        MouseArea {
            anchors.fill: parent
            enabled: modal.open
            onClicked: modal.dismiss()
        }
    }

    Rectangle {
        id: panel
        anchors.centerIn: parent
        width: Math.min(340, parent.width - 60)
        height: Math.min(parent.height - 48, sheet.implicitHeight + 36)
        radius: Theme.radiusPanel
        color: "#131722"
        border.color: Theme.cardStroke
        scale: modal.open ? 1 : 0.96
        Behavior on scale {
            NumberAnimation {
                duration: Motion.normalMs
                easing.type: Easing.BezierSpline
                easing.bezierCurve: Motion.emphasized
            }
        }

        MouseArea { anchors.fill: parent } // swallow

        Flickable {
            id: scroll
            anchors.fill: parent
            anchors.margins: 18
            clip: true
            contentWidth: width
            contentHeight: sheet.implicitHeight
            boundsBehavior: Flickable.StopAtBounds

            Column {
                id: sheet
                width: scroll.width
                spacing: 14

            Row {
                width: parent.width
                Text {
                    text: "Réglages"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeTitle
                    font.weight: Font.DemiBold
                }
                Item { width: parent.width - x - closeBtn.width; height: 1 }
                IconButton {
                    id: closeBtn
                    glyph: ""  // ChromeClose
                    onClicked: modal.dismiss()
                }
            }

            SettingsSlider {
                width: parent.width
                label: "Opacité du panneau"
                from: 0.3; to: 1.0
                value: Panel.windowOpacity()
                onMoved: value => Panel.setWindowOpacity(value)
            }
            SettingsSlider {
                width: parent.width
                label: "Opacité des cartes"
                from: 0.2; to: 2.0
                value: Ui.cardOpacity
                onMoved: value => { Ui.cardOpacity = value; Ui.save() }
            }
            SettingsSlider {
                width: parent.width
                label: "Opacité épinglée"
                from: 0.05; to: 1.0
                value: Panel.pinnedOpacityValue()
                onMoved: value => Panel.setPinnedOpacity(value)
            }

            // ── Location ──────────────────────────────────────────────
            Text {
                text: "EMPLACEMENT"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Rectangle {
                width: parent.width; height: 28; radius: 6
                color: Qt.rgba(1,1,1,0.05)
                border.color: locInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: locInput
                    anchors.fill: parent; anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary; font.pixelSize: Theme.fontSizeCaption; clip: true
                    onAccepted: Weather.searchLocation(text)
                    Text {
                        visible: locInput.text === "" && !locInput.activeFocus
                        text: "Rechercher une ville…"; color: Qt.rgba(1,1,1,0.25)
                        font.pixelSize: Theme.fontSizeCaption
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
            Column {
                width: parent.width
                spacing: 2
                Repeater {
                    id: locResults
                    model: []
                    delegate: Rectangle {
                        required property var modelData
                        width: parent.width; height: 24; radius: 5
                        color: locHover.containsMouse ? Theme.hover : "transparent"
                        Text {
                            anchors.fill: parent; anchors.leftMargin: 8
                            verticalAlignment: Text.AlignVCenter
                            text: modelData.name; color: Theme.textPrimary
                            font.pixelSize: 10; elide: Text.ElideRight
                        }
                        MouseArea {
                            id: locHover; anchors.fill: parent; hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                Weather.setLocation(modelData.name, modelData.lat,
                                                    modelData.lon, modelData.timezone)
                                locResults.model = []
                                locInput.text = ""
                            }
                        }
                    }
                }
            }
            Connections {
                target: Weather
                function onLocationResults(results) { locResults.model = results }
            }

            // ── API keys ──────────────────────────────────────────────
            Text {
                text: "CLÉS API"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Component {
                id: keyField
                Rectangle {
                    property string vaultKey: ""
                    property string placeholder: ""
                    width: sheet.width; height: 28; radius: 6
                    color: Qt.rgba(1,1,1,0.05)
                    border.color: kf.activeFocus ? Theme.accent : Theme.cardStroke
                    TextInput {
                        id: kf
                        anchors.fill: parent; anchors.margins: 7
                        verticalAlignment: TextInput.AlignVCenter
                        color: Theme.textPrimary; font.pixelSize: 10; clip: true
                        echoMode: activeFocus ? TextInput.Normal : TextInput.Password
                        Component.onCompleted: text = Vault.get(parent.vaultKey)
                        onEditingFinished: Vault.set(parent.vaultKey, text)
                        Text {
                            visible: kf.text === "" && !kf.activeFocus
                            text: parent.parent.placeholder; color: Qt.rgba(1,1,1,0.25)
                            font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                }
            }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "tomtom-key"; item.placeholder = "Clé TomTom (circulation)" } }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "finnhub-key"; item.placeholder = "Clé Finnhub (cotations)" } }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "starvis-openai-key"; item.placeholder = "Cle OpenAI (Starvis)" } }

            Text {
                text: "STARVIS"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "model"; item.fallback = "gpt-5.5"; item.placeholder = "Modèle Starvis" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "baseUrl"; item.fallback = "https://api.openai.com/v1"; item.placeholder = "Base URL OpenAI compatible" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "maxTokens"; item.fallback = "1800"; item.placeholder = "Maximum tokens" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "ttsModel"; item.fallback = "gpt-4o-mini-tts"; item.placeholder = "Modèle vocal" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "ttsVoice"; item.fallback = "alloy"; item.placeholder = "Voix TTS" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-starvis-workspace"; item.fallback = ""; item.placeholder = "Racine workspace Starvis" } }

            Text {
                text: "CAMÉRA"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-url"; item.fallback = "https://securitycenter.local"; item.placeholder = "URL serveur XProtect" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-id"; item.fallback = ""; item.placeholder = "GUID caméra par défaut" } }

            Text {
                text: "MICROSOFT"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Rectangle {
                width: parent.width; height: 28; radius: 6
                color: Qt.rgba(1,1,1,0.05)
                border.color: msClientInput.activeFocus ? Theme.accent : Theme.cardStroke
                TextInput {
                    id: msClientInput
                    anchors.fill: parent; anchors.margins: 7
                    verticalAlignment: TextInput.AlignVCenter
                    color: Theme.textPrimary; font.pixelSize: 10; clip: true
                    Component.onCompleted: text = Store.get("wp-ms-client", "")
                    onEditingFinished: Store.set("wp-ms-client", text.trim())
                    Text {
                        visible: msClientInput.text === "" && !msClientInput.activeFocus
                        text: "Client ID Azure (Outlook / To-Do)"; color: Qt.rgba(1,1,1,0.25)
                        font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }

            // ── News carousel ─────────────────────────────────────────
            Row {
                width: parent.width
                spacing: 8
                Text {
                    text: "Carrousel des nouvelles"; color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - carToggle.width; height: 1 }
                Rectangle {
                    id: carToggle
                    property bool on: Store.get("wp-news-carousel", "") === true
                                      || Store.get("wp-news-carousel", "") === "1"
                                      || Store.get("wp-news-carousel", "") === "true"
                    anchors.verticalCenter: parent.verticalCenter
                    width: 34; height: 18; radius: 9
                    color: on ? Theme.accent : Qt.rgba(1,1,1,0.12)
                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                    Rectangle {
                        width: 14; height: 14; radius: 7; y: 2
                        x: carToggle.on ? parent.width - width - 2 : 2
                        color: "#fff"
                        Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                    }
                    MouseArea {
                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: { carToggle.on = !carToggle.on; Store.set("wp-news-carousel", carToggle.on) }
                    }
                }
            }
            Row {
                width: parent.width
                spacing: 8
                property int intervalDraft: Math.max(2500, Math.min(60000, Number(Store.get("wp-news-carousel-ms", 8000)) || 8000))
                function saveInterval(value) {
                    intervalDraft = Math.max(2500, Math.min(60000, value))
                    Store.set("wp-news-carousel-ms", intervalDraft)
                }
                Text {
                    text: "Intervalle carrousel"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - intervalStepper.width; height: 1 }
                Row {
                    id: intervalStepper
                    spacing: 6
                    anchors.verticalCenter: parent.verticalCenter
                    IconButton {
                        glyph: "-"
                        onClicked: parent.parent.saveInterval(parent.parent.intervalDraft - 1000)
                    }
                    Text {
                        text: Math.round(parent.parent.intervalDraft / 1000) + "s"
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeBody
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    IconButton {
                        glyph: "+"
                        onClicked: parent.parent.saveInterval(parent.parent.intervalDraft + 1000)
                    }
                }
            }

            // Base column count stepper
            Row {
                width: parent.width
                spacing: 8
                Text {
                    text: "Colonnes visibles"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - stepper.width; height: 1 }
                Row {
                    id: stepper
                    spacing: 6
                    anchors.verticalCenter: parent.verticalCenter
                    IconButton {
                        glyph: "−"
                        onClicked: {
                            modal.baseColumnsDraft = Math.max(3, modal.baseColumnsDraft - 1)
                            Store.set("wp-base-columns", modal.baseColumnsDraft)
                            Panel.fitMode("base", modal.baseColumnsDraft, {})
                        }
                    }
                    Text {
                        text: modal.baseColumnsDraft
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeBody
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    IconButton {
                        glyph: "+"
                        onClicked: {
                            modal.baseColumnsDraft = Math.min(6, modal.baseColumnsDraft + 1)
                            Store.set("wp-base-columns", modal.baseColumnsDraft)
                            Panel.fitMode("base", modal.baseColumnsDraft, {})
                        }
                    }
                }
            }

            // Sound feedback toggle
            Row {
                width: parent.width
                spacing: 8
                Text {
                    text: "Sons d'interface"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - sndToggle.width; height: 1 }
                Rectangle {
                    id: sndToggle
                    width: 34; height: 18; radius: 9
                    anchors.verticalCenter: parent.verticalCenter
                    color: SoundFx.enabled ? Theme.accent : Qt.rgba(1, 1, 1, 0.12)
                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }
                    Rectangle {
                        width: 14; height: 14; radius: 7; y: 2
                        x: SoundFx.enabled ? parent.width - width - 2 : 2
                        color: "#ffffff"
                        Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                    }
                    MouseArea {
                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: { SoundFx.enabled = !SoundFx.enabled; SoundFx.tap() }
                    }
                }
            }

            // Autostart toggle
            Row {
                width: parent.width
                spacing: 8
                Text {
                    text: "Lancer au démarrage"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - toggle.width; height: 1 }
                Rectangle {
                    id: toggle
                    width: 34; height: 18; radius: 9
                    anchors.verticalCenter: parent.verticalCenter
                    color: modal.autostartDraft ? Theme.accent : Qt.rgba(1, 1, 1, 0.12)
                    Behavior on color { ColorAnimation { duration: Motion.fastMs } }

                    Rectangle {
                        width: 14; height: 14; radius: 7
                        y: 2
                        x: modal.autostartDraft ? parent.width - width - 2 : 2
                        color: "#ffffff"
                        Behavior on x {
                            NumberAnimation {
                                duration: Motion.fastMs
                                easing.type: Easing.OutCubic
                            }
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            modal.autostartDraft = !modal.autostartDraft
                            Panel.setAutostart(modal.autostartDraft)
                        }
                    }
                }
            }
        }
        }
    }
}
