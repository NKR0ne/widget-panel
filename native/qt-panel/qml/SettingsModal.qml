import QtQuick
import QtPanel.Native

// Native settings sheet: opacities, card glass, autostart, workspace columns.
// Holds the modal guard while open, like every other overlay.
Item {
    id: modal

    property bool open: false
    // Panel content to blur behind the sheet; set by PanelSurface.
    property Item backdropSource: null
    focus: open
    Keys.onEscapePressed: dismiss()

    function show() {
        columnCountDraft = Number(Store.get("wp-base-columns", 3)) || 3
        autostartDraft = Panel.autostart()
        open = true
        Panel.setModalOpen(true)
    }
    function dismiss() {
        open = false
        Panel.setModalOpen(false)
    }
    function jumpTo(section) {
        let target = generalSection
        if (section === "services") target = starvisSection
        else if (section === "accounts") target = pressSection
        else if (section === "validation") target = validationSection
        else if (section === "interface") target = interfaceSection
        const point = target.mapToItem(sheet, 0, 0)
        scroll.contentY = Math.max(0, Math.min(scroll.contentHeight - scroll.height, point.y - 8))
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
    function cameraAuth() {
        return parseJson(Store.get("wp-camera-auth", ""), {})
    }
    function cameraAuthValue(key, fallback) {
        const auth = cameraAuth()
        const value = auth[key]
        return value === undefined || value === null || value === "" ? fallback : String(value)
    }
    function setCameraAuthValue(key, value) {
        const auth = cameraAuth()
        auth[key] = value
        Store.set("wp-camera-auth", JSON.stringify(auth))
    }
    function clearCameraAuth() {
        Store.set("wp-camera-auth", "")
        Vault.remove("camera-password")
    }
    function clearTradingView() {
        const keys = [
            "wp-tv-session", "wp-tv-cookies", "wp-tv-csrf", "wp-tv-user",
            "wp-tv-raw-lists", "wp-tv-watchlist-ids", "wp-tv-lists-cache",
            "wp-tv-lists-cache-at", "wp-tv-capture-status"
        ]
        for (const key of keys)
            Store.set(key, "")
    }
    function pressReaderUrl() {
        return Store.get("wp-pressreader-url",
                         "https://ezproxy.bibliothequedequebec.qc.ca/login?url=https%3A%2F%2Fwww.pressreader.com")
    }
    function diagColor(state) {
        if (state === "ok")
            return "#34d399"
        if (state === "warn")
            return "#fbbf24"
        if (state === "error")
            return "#f87171"
        if (state === "setup")
            return "#60a5fa"
        return Theme.accent
    }

    property int columnCountDraft: 3
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

    ScrimBackdrop {
        anchors.fill: parent
        source: modal.backdropSource
        active: modal.open
        dim: 0.5
        MouseArea {
            anchors.fill: parent
            enabled: modal.open
            onClicked: modal.dismiss()
        }
    }

    Rectangle {
        id: panel
        anchors.centerIn: parent
        width: Math.min(520, parent.width - 48)
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
                    tooltip: "Fermer"
                }
            }

            Flickable {
                width: parent.width
                height: 26
                contentWidth: settingsNav.width
                clip: true
                Row {
                    id: settingsNav
                    spacing: 4
                    Repeater {
                        model: [
                            { id: "general", label: "G\u00e9n\u00e9ral" },
                            { id: "services", label: "Services" },
                            { id: "accounts", label: "Comptes" },
                            { id: "validation", label: "Validation" },
                            { id: "interface", label: "Interface" }
                        ]
                        delegate: Rectangle {
                            required property var modelData
                            width: navLabel.implicitWidth + 16
                            height: 24
                            radius: 6
                            color: navMouse.containsMouse ? Theme.hover : Theme.cardFill
                            border.color: Theme.cardStroke
                            Accessible.role: Accessible.Button
                            Accessible.name: modelData.label
                            Text {
                                id: navLabel
                                anchors.centerIn: parent
                                text: parent.modelData.label
                                color: Theme.textSecondary
                                font.pixelSize: 9
                            }
                            MouseArea {
                                id: navMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: modal.jumpTo(parent.modelData.id)
                            }
                        }
                    }
                }
            }

            Item { id: generalSection; width: 1; height: 1 }

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

            SettingsToggle {
                width: parent.width
                label: "\u00c9clairage des surfaces"
                description: "Active les reflets, les liser\u00e9s et la profondeur"
                checked: Ui.surfaceLighting
                onToggled: function(value) { Ui.surfaceLighting = value; Ui.save() }
            }
            SettingsToggle {
                width: parent.width
                label: "Fond mica"
                // Following the system forces acrylic, because that is what the
                // Start menu uses -- effectiveMica() is micaBackdrop && !follow-
                // SystemMaterial, and bgTint returns before it reads this at
                // all. The toggle was still live and still showed its old state,
                // so it looked like a setting that did nothing.
                enabled: !Ui.followSystemMaterial
                description: Ui.followSystemMaterial
                    ? "Sans effet : le mat\u00e9riau Windows impose l'acrylique"
                    : "Teinte le fond d'\u00e9cran au lieu de flouter le bureau (acrylique)"
                checked: Panel.micaBackdrop && !Ui.followSystemMaterial
                onToggled: function(value) { Panel.setMicaBackdrop(value) }
            }
            SettingsToggle {
                width: parent.width
                label: "Mat\u00e9riau Windows"
                description: Sys.accentOnSurfaces
                    ? "Utilise la teinte du menu D\u00e9marrer"
                    : "Sans effet : couleur d'accentuation d\u00e9sactiv\u00e9e pour D\u00e9marrer"
                checked: Ui.followSystemMaterial
                onToggled: function(value) { Ui.followSystemMaterial = value; Ui.save() }
            }
            Text {
                width: parent.width
                visible: !Sys.transparencyEnabled
                text: "Effets de transparence d\u00e9sactiv\u00e9s dans Windows : surfaces opaques."
                color: Theme.textSecondary
                font.pixelSize: 9
                wrapMode: Text.WordWrap
            }
            SettingsSlider {
                width: parent.width
                enabled: Ui.surfaceLighting
                opacity: enabled ? 1 : 0.45
                label: "Intensit\u00e9 lumineuse"
                from: 0.35; to: 1.5
                value: Ui.lightingStrength
                onMoved: function(value) { Ui.lightingStrength = value; Ui.save() }
            }
            SettingsSlider {
                width: parent.width
                label: "Profondeur des ombres"
                from: 0; to: 1.5
                value: Ui.shadowDepth
                onMoved: function(value) { Ui.shadowDepth = value; Ui.save() }
            }

            SettingsToggle {
                width: parent.width
                label: "R\u00e9duire les animations"
                description: "D\u00e9sactive les transitions non essentielles"
                checked: Ui.reducedMotion
                onToggled: function(value) { Ui.reducedMotion = value; Ui.save() }
            }
            SettingsToggle {
                width: parent.width
                label: "Halo du pointeur"
                description: "Fait suivre la lumi\u00e8re au pointeur"
                enabled: Ui.surfaceLighting
                opacity: enabled ? 1 : 0.45
                checked: Ui.mouseHalo
                onToggled: function(value) { Ui.mouseHalo = value; Ui.save() }
            }
            SettingsToggle {
                width: parent.width
                label: "Contraste renforc\u00e9"
                description: "Augmente les contours et le contraste du texte"
                checked: Ui.highContrast
                onToggled: function(value) { Ui.highContrast = value; Ui.save() }
            }
            SettingsToggle {
                width: parent.width
                label: "Densit\u00e9 confortable"
                description: "Ajoute de l'espace aux surfaces tactiles"
                checked: Ui.density === "comfortable"
                onToggled: function(value) {
                    Ui.density = value ? "comfortable" : "compact"
                    Ui.save()
                }
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
                    property bool secret: true
                    width: sheet.width; height: 28; radius: 6
                    color: Qt.rgba(1,1,1,0.05)
                    border.color: kf.activeFocus ? Theme.accent : Theme.cardStroke
                    TextInput {
                        id: kf
                        anchors.fill: parent; anchors.margins: 7
                        verticalAlignment: TextInput.AlignVCenter
                        color: Theme.textPrimary; font.pixelSize: 10; clip: true
                        echoMode: parent.secret && !activeFocus ? TextInput.Password : TextInput.Normal
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

            Component {
                id: cameraUserField
                Rectangle {
                    width: sheet.width; height: 28; radius: 6
                    color: Qt.rgba(1,1,1,0.05)
                    border.color: cameraUserInput.activeFocus ? Theme.accent : Theme.cardStroke
                    TextInput {
                        id: cameraUserInput
                        anchors.fill: parent; anchors.margins: 7
                        verticalAlignment: TextInput.AlignVCenter
                        color: Theme.textPrimary; font.pixelSize: 10; clip: true
                        Component.onCompleted: text = modal.cameraAuthValue("u", "")
                        onEditingFinished: modal.setCameraAuthValue("u", text.trim())
                        Text {
                            visible: cameraUserInput.text === "" && !cameraUserInput.activeFocus
                            text: "Utilisateur XProtect"; color: Qt.rgba(1,1,1,0.25)
                            font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                }
            }

            Text {
                id: starvisSection
                text: "STARVIS"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "model"; item.fallback = "gpt-5.5"; item.placeholder = "Modèle Starvis" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "baseUrl"; item.fallback = "https://api.openai.com/v1"; item.placeholder = "Base URL OpenAI compatible" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "maxTokens"; item.fallback = "1800"; item.placeholder = "Maximum tokens" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "ttsModel"; item.fallback = "gpt-4o-mini-tts"; item.placeholder = "Modèle vocal" } }
            Loader { sourceComponent: starvisField; onLoaded: { item.configKey = "ttsVoice"; item.fallback = "alloy"; item.placeholder = "Voix TTS" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-starvis-workspace"; item.fallback = ""; item.placeholder = "Racine workspace Starvis" } }

            Row {
                width: parent.width
                spacing: 8
                Text {
                    text: "Execution des actions"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - starvisExecToggle.width; height: 1 }
                Rectangle {
                    id: starvisExecToggle
                    width: 34; height: 18; radius: 9
                    anchors.verticalCenter: parent.verticalCenter
                    color: Starvis.executionEnabled ? Theme.accent : Qt.rgba(1,1,1,0.12)
                    Rectangle {
                        width: 14; height: 14; radius: 7; y: 2
                        x: Starvis.executionEnabled ? parent.width - width - 2 : 2
                        color: "#fff"
                        Behavior on x { NumberAnimation { duration: Motion.fastMs } }
                    }
                    MouseArea {
                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: Starvis.executionEnabled = !Starvis.executionEnabled
                    }
                }
            }

            Text {
                text: "CAMÉRA XPROTECT"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-url"; item.fallback = "https://securitycenter.local:8082"; item.placeholder = "URL serveur XProtect" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-id"; item.fallback = ""; item.placeholder = "GUID caméra par défaut" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-name-hint"; item.fallback = "HikVision"; item.placeholder = "Indice nom caméra" } }
            Text {
                width: parent.width
                text: Camera.discoveryStatus || Store.get("wp-camera-name", "")
                visible: text !== ""
                color: Theme.textSecondary
                font.pixelSize: 10
                elide: Text.ElideRight
            }

            Loader { sourceComponent: cameraUserField }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "camera-password"; item.placeholder = "Mot de passe XProtect"; item.secret = true } }
            Row {
                id: cameraLoginTypeRow
                width: parent.width
                spacing: 4
                property string selected: modal.cameraAuthValue("loginType", "auto")
                function pick(value) {
                    selected = value
                    modal.setCameraAuthValue("loginType", value)
                }
                Repeater {
                    model: [
                        { label: "Auto", value: "auto" },
                        { label: "Windows", value: "Windows" },
                        { label: "Basic", value: "Basic" },
                        { label: "SDK", value: "" }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        width: (cameraLoginTypeRow.width - 12) / 4
                        height: 22
                        radius: 5
                        color: cameraLoginTypeRow.selected === modelData.value ? Theme.activeFill
                             : loginTypeMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: cameraLoginTypeRow.selected === modelData.value ? Theme.accent : Theme.cardStroke
                        Text {
                            anchors.centerIn: parent
                            text: modelData.label
                            color: cameraLoginTypeRow.selected === modelData.value ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: loginTypeMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: cameraLoginTypeRow.pick(modelData.value)
                        }
                    }
                }
            }
            Row {
                width: parent.width
                spacing: 6
                Rectangle {
                    width: cameraDiscoverLabel.implicitWidth + 18; height: 24; radius: 6
                    color: cameraDiscoverMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: cameraDiscoverLabel; anchors.centerIn: parent; text: "Découvrir"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: cameraDiscoverMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Camera.discoverCameras()
                    }
                }
                Rectangle {
                    width: cameraStartLabel.implicitWidth + 18; height: 24; radius: 6
                    color: cameraStartMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: cameraStartLabel; anchors.centerIn: parent; text: "Reconnecter"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: cameraStartMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Camera.start()
                    }
                }
                Rectangle {
                    width: cameraForgetLabel.implicitWidth + 18; height: 24; radius: 6
                    color: cameraForgetMouse.containsMouse ? Qt.rgba(0.97,0.45,0.45,0.22) : Qt.rgba(1,1,1,0.05)
                    border.color: Qt.rgba(0.97,0.45,0.45,0.35)
                    Text { id: cameraForgetLabel; anchors.centerIn: parent; text: "Oublier"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: cameraForgetMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: { modal.clearCameraAuth(); Camera.stop() }
                    }
                }
            }

            Text {
                text: "CAMÉRA DIRECTE"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-direct-url"; item.fallback = "http://ipcam1.local/doc/page/preview.asp"; item.placeholder = "Page de l'appareil (détection de l'hôte)" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-direct-stream-url"; item.fallback = "rtsp://ipcam1.local:554/ISAPI/Streaming/channels/102"; item.placeholder = "URL du flux RTSP" } }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-camera-direct-user"; item.fallback = ""; item.placeholder = "Utilisateur de la caméra directe" } }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "camera-direct-password"; item.placeholder = "Mot de passe de la caméra directe"; item.secret = true } }
            Text {
                width: parent.width
                text: DirectCamera.endpoint + "  ·  " + DirectCamera.status
                      + (DirectCamera.verified ? "  ·  vérifiée"
                         : "  ·  " + DirectCamera.authAttemptsRemaining + " essais protégés")
                color: DirectCamera.status === "error" || DirectCamera.status === "blocked"
                       ? Theme.danger : Theme.textSecondary
                font.pixelSize: 9
                elide: Text.ElideMiddle
            }
            Row {
                width: parent.width
                spacing: 6
                Rectangle {
                    width: directStartLabel.implicitWidth + 18; height: 24; radius: 6
                    color: directStartMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: directStartLabel; anchors.centerIn: parent; text: "Connecter"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: directStartMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Diagnostics.openDirectCamera()
                    }
                }
                Rectangle {
                    width: directStopLabel.implicitWidth + 18; height: 24; radius: 6
                    color: directStopMouse.containsMouse ? Theme.hover : Qt.rgba(1,1,1,0.05)
                    border.color: Theme.cardStroke
                    Text { id: directStopLabel; anchors.centerIn: parent; text: "Arrêter"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: directStopMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: DirectCamera.stop()
                    }
                }
                Rectangle {
                    width: directForgetLabel.implicitWidth + 18; height: 24; radius: 6
                    color: directForgetMouse.containsMouse ? Qt.rgba(0.97,0.45,0.45,0.22) : Qt.rgba(1,1,1,0.05)
                    border.color: Qt.rgba(0.97,0.45,0.45,0.35)
                    Text { id: directForgetLabel; anchors.centerIn: parent; text: "Oublier"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: directForgetMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: DirectCamera.forgetCredentials()
                    }
                }
            }

            Text {
                id: pressSection
                text: "PRESSREADER"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Loader { sourceComponent: storeField; onLoaded: { item.storeKey = "wp-pressreader-url"; item.fallback = "https://ezproxy.bibliothequedequebec.qc.ca/login?url=https%3A%2F%2Fwww.pressreader.com"; item.placeholder = "URL d'acces de la bibliotheque" } }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "pressreader-user"; item.placeholder = "No d'usager de la bibliotheque"; item.secret = false } }
            Loader { sourceComponent: keyField; onLoaded: { item.vaultKey = "pressreader-password"; item.placeholder = "Mot de passe de la bibliotheque"; item.secret = true } }
            Row {
                width: parent.width
                spacing: 6
                Rectangle {
                    width: pressOpenLabel.implicitWidth + 18; height: 24; radius: 6
                    color: pressOpenMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: pressOpenLabel; anchors.centerIn: parent; text: "Ouvrir"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: pressOpenMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: PressReader.openCatalog()
                    }
                }
                Rectangle {
                    width: pressForgetLabel.implicitWidth + 18; height: 24; radius: 6
                    color: pressForgetMouse.containsMouse ? Qt.rgba(0.97,0.45,0.45,0.22) : Qt.rgba(1,1,1,0.05)
                    border.color: Qt.rgba(0.97,0.45,0.45,0.35)
                    Text { id: pressForgetLabel; anchors.centerIn: parent; text: "Oublier"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: pressForgetMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: PressReader.forgetCredentials()
                    }
                }
            }

            Text {
                text: "TRADINGVIEW"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Row {
                id: marketProviderRow
                width: parent.width
                spacing: 4
                property string selected: Store.get("wp-market-provider", "auto") || "auto"
                function pick(value) {
                    selected = value
                    Store.set("wp-market-provider", value)
                }
                Repeater {
                    model: [
                        { label: "Auto", value: "auto" },
                        { label: "Yahoo", value: "yahoo" },
                        { label: "Finnhub", value: "finnhub" }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        width: (marketProviderRow.width - 8) / 3
                        height: 22
                        radius: 5
                        color: marketProviderRow.selected === modelData.value ? Theme.activeFill
                             : marketProviderMouse.containsMouse ? Theme.hover : "transparent"
                        border.color: marketProviderRow.selected === modelData.value ? Theme.accent : Theme.cardStroke
                        Text {
                            anchors.centerIn: parent
                            text: modelData.label
                            color: marketProviderRow.selected === modelData.value ? Theme.textPrimary : Theme.textSecondary
                            font.pixelSize: 9
                        }
                        MouseArea {
                            id: marketProviderMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: marketProviderRow.pick(modelData.value)
                        }
                    }
                }
            }
            Text {
                width: parent.width
                text: Store.get("wp-tv-capture-status", "") || (Store.get("wp-tv-user", "") !== "" ? ("Connecte: " + Store.get("wp-tv-user", "")) : "Session non connectee")
                color: Theme.textSecondary
                font.pixelSize: 10
                elide: Text.ElideRight
            }
            Row {
                width: parent.width
                spacing: 6
                Rectangle {
                    width: tvSignInLabel.implicitWidth + 18; height: 24; radius: 6
                    color: tvSignInMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: tvSignInLabel; anchors.centerIn: parent; text: "Connexion"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: tvSignInMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Panel.openIsland("https://www.tradingview.com/accounts/signin/")
                    }
                }
                Rectangle {
                    width: tvSyncLabel.implicitWidth + 18; height: 24; radius: 6
                    color: tvSyncMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(1,1,1,0.05)
                    border.color: Theme.cardStroke
                    Text { id: tvSyncLabel; anchors.centerIn: parent; text: "Sync"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: tvSyncMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Stocks.refreshWatchlists()
                    }
                }
                Rectangle {
                    width: tvCaptureLabel.implicitWidth + 18; height: 24; radius: 6
                    color: tvCaptureMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(1,1,1,0.05)
                    border.color: Theme.cardStroke
                    Text { id: tvCaptureLabel; anchors.centerIn: parent; text: "Capture"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: tvCaptureMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Panel.captureTradingViewSession()
                    }
                }
                Rectangle {
                    width: tvForgetLabel.implicitWidth + 18; height: 24; radius: 6
                    color: tvForgetMouse.containsMouse ? Qt.rgba(0.97,0.45,0.45,0.22) : Qt.rgba(1,1,1,0.05)
                    border.color: Qt.rgba(0.97,0.45,0.45,0.35)
                    Text { id: tvForgetLabel; anchors.centerIn: parent; text: "Oublier"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: tvForgetMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: modal.clearTradingView()
                    }
                }
            }

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

            // Runtime validation
            Text {
                id: validationSection
                text: "VALIDATION"; color: Theme.textSecondary; font.pixelSize: 9
                font.letterSpacing: 1; topPadding: 4
            }
            Row {
                width: parent.width
                spacing: 6
                Rectangle {
                    width: diagRunLabel.implicitWidth + 18; height: 24; radius: 6
                    color: diagRunMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(0.31,0.56,0.97,0.15)
                    border.color: Qt.rgba(0.31,0.56,0.97,0.45)
                    Text { id: diagRunLabel; anchors.centerIn: parent; text: Diagnostics.running ? "..." : "Preflight"; color: Theme.textPrimary; font.pixelSize: 9 }
                    MouseArea {
                        id: diagRunMouse; anchors.fill: parent; hoverEnabled: true
                        enabled: !Diagnostics.running
                        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: Diagnostics.runPreflight()
                    }
                }
                Rectangle {
                    width: diagShellLabel.implicitWidth + 18; height: 24; radius: 6
                    color: diagShellMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(1,1,1,0.05)
                    border.color: Theme.cardStroke
                    Text { id: diagShellLabel; anchors.centerIn: parent; text: "Island"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: diagShellMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Diagnostics.probeShellIsland()
                    }
                }
                Rectangle {
                    width: diagPressLabel.implicitWidth + 18; height: 24; radius: 6
                    color: diagPressMouse.containsMouse ? Qt.rgba(0.31,0.56,0.97,0.28) : Qt.rgba(1,1,1,0.05)
                    border.color: Theme.cardStroke
                    Text { id: diagPressLabel; anchors.centerIn: parent; text: "PressReader"; color: Theme.textSecondary; font.pixelSize: 9 }
                    MouseArea {
                        id: diagPressMouse; anchors.fill: parent; hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: Diagnostics.openPressReader()
                    }
                }
            }
            Text {
                width: parent.width
                text: Diagnostics.status
                color: Diagnostics.running ? Theme.accent : Theme.textSecondary
                font.pixelSize: 10
                elide: Text.ElideRight
            }
            Column {
                width: parent.width
                spacing: 4
                Repeater {
                    model: Diagnostics.rows
                    delegate: Row {
                        required property var modelData
                        width: parent.width
                        height: Math.max(24, diagDetail.implicitHeight)
                        spacing: 6
                        Rectangle {
                            width: 7; height: 7; radius: 3.5
                            color: modal.diagColor(modelData.state)
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Text {
                            width: 72
                            text: modelData.label
                            color: Theme.textPrimary
                            font.pixelSize: 9
                            elide: Text.ElideRight
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Text {
                            id: diagDetail
                            width: Math.max(40, parent.width - 85)
                            text: modelData.detail
                            color: Theme.textSecondary
                            font.pixelSize: 9
                            wrapMode: Text.WordWrap
                        }
                    }
                }
            }

            Row {
                width: parent.width
                spacing: 8
                Text {
                    id: interfaceSection
                    text: "Carrousel des nouvelles"; color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                    anchors.verticalCenter: parent.verticalCenter
                }
                Item { width: parent.width - x - carToggle.width; height: 1 }
                Rectangle {
                    id: carToggle
                    property bool on: Store.get("wp-news-carousel", "") === ""
                                      || Store.get("wp-news-carousel", "") === true
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
                property int intervalDraft: Math.max(20000, Math.min(60000, Number(Store.get("wp-news-carousel-ms", 20000)) || 20000))
                function saveInterval(value) {
                    intervalDraft = Math.max(20000, Math.min(60000, value))
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

            // Shared workspace column count stepper
            Row {
                width: parent.width
                spacing: 8
                Text {
                    text: "Colonnes par mode"
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
                            modal.columnCountDraft = Math.max(3, modal.columnCountDraft - 1)
                            Store.set("wp-base-columns", modal.columnCountDraft)
                            Panel.fitMode("base", modal.columnCountDraft, {})
                        }
                    }
                    Text {
                        text: modal.columnCountDraft
                        color: Theme.textPrimary
                        font.pixelSize: Theme.fontSizeBody
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    IconButton {
                        glyph: "+"
                        onClicked: {
                            modal.columnCountDraft = Math.min(6, modal.columnCountDraft + 1)
                            Store.set("wp-base-columns", modal.columnCountDraft)
                            Panel.fitMode("base", modal.columnCountDraft, {})
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
