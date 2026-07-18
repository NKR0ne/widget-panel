import QtQuick
import QtWebEngine
import QtPanel.Native
import "pressreader/PressReaderAutomation.js" as PressAutomation

Rectangle {
    id: spotlight

    visible: Panel.islandOpen && Panel.islandKind === "pressreader"
    color: "#0c0f14"
    radius: Theme.radiusCard
    border.width: 1
    border.color: Theme.cardStroke
    clip: true
    z: 82

    property int probePass: 0
    property int renderRecoveryCount: 0

    function stateColor() {
        if (PressReader.state === "rejected" || PressReader.state === "offline")
            return Theme.danger
        if (PressReader.state === "credentials-required"
                || PressReader.state === "paused"
                || PressReader.state === "session-expired"
                || PressReader.state === "signing-in"
                || PressReader.state === "opening")
            return Theme.warning
        if (PressReader.state === "catalog-ready"
                || PressReader.state === "publication-ready")
            return Theme.success
        return Theme.textSecondary
    }

    function reportState(error) {
        Panel.reportIslandState(String(webView.url || ""), webView.title || "",
                                webView.loading, webView.canGoBack,
                                webView.canGoForward, error || "")
    }

    function scheduleProbe(delay) {
        if (!visible || webView.loading)
            return
        probeTimer.interval = Math.max(120, delay || 350)
        probeTimer.restart()
    }

    function runProbe() {
        if (!visible || webView.loading)
            return
        webView.runJavaScript(PressAutomation.probeScript(), function(result) {
            if (!spotlight.visible || !result)
                return
            PressReader.applyProbe(result)
            const signature = String(result.signature || "")
            if (!result.authRejected && result.hasLogin
                    && PressReader.claimLoginAttempt(signature)) {
                webView.runJavaScript(PressAutomation.loginScript(
                    Vault.get("pressreader-user"),
                    Vault.get("pressreader-password")))
                spotlight.scheduleProbe(1500)
                return
            }
            if (result.hasStartReading && !result.recentInteraction
                    && PressReader.claimStartReading(signature + "|start")) {
                webView.runJavaScript(PressAutomation.startReadingScript())
                spotlight.scheduleProbe(900)
                return
            }
            spotlight.probePass += 1
            if (spotlight.probePass < 5
                    && (PressReader.state === "opening"
                        || PressReader.state === "signing-in"))
                spotlight.scheduleProbe(850)
            else if (spotlight.probePass >= 5
                     && PressReader.state === "signing-in")
                PressReader.automationTimedOut()
        })
    }

    function applyProxyDarkMode() {
        webView.runJavaScript(PressAutomation.proxyDarkScript())
    }

    component ActionButton: Rectangle {
        id: action
        property string label: ""
        property bool primary: false
        property bool destructive: false
        signal clicked()

        implicitWidth: actionLabel.implicitWidth + 22
        implicitHeight: 28
        radius: 6
        color: actionMouse.containsMouse
               ? (destructive ? Qt.rgba(0.97, 0.45, 0.45, 0.24)
                              : primary ? Qt.rgba(0.31, 0.56, 0.97, 0.30)
                                        : Theme.hover)
               : (destructive ? Qt.rgba(0.97, 0.45, 0.45, 0.12)
                              : primary ? Qt.rgba(0.31, 0.56, 0.97, 0.18)
                                        : Qt.rgba(1, 1, 1, 0.055))
        border.color: destructive ? Qt.rgba(0.97, 0.45, 0.45, 0.40)
                     : primary ? Qt.rgba(0.31, 0.56, 0.97, 0.48)
                               : Theme.cardStroke
        Text {
            id: actionLabel
            anchors.centerIn: parent
            text: action.label
            color: action.destructive ? "#fca5a5" : Theme.textPrimary
            font.pixelSize: 10
        }
        MouseArea {
            id: actionMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: action.clicked()
        }
    }

    Connections {
        target: Panel
        function onPressReaderOpenRequested(url) {
            spotlight.probePass = 0
            webView.url = url
            webView.forceActiveFocus()
        }
        function onIslandNavigateRequested(url) {
            if (Panel.islandKind === "pressreader")
                webView.url = url
        }
        function onIslandReloadRequested() {
            if (Panel.islandKind === "pressreader")
                webView.reload()
        }
        function onIslandBackRequested() {
            if (Panel.islandKind === "pressreader")
                webView.goBack()
        }
        function onIslandForwardRequested() {
            if (Panel.islandKind === "pressreader")
                webView.goForward()
        }
        function onIslandCloseRequested() {
            if (Panel.islandKind !== "pressreader")
                return
            probeTimer.stop()
            darkTimer.stop()
            webView.stop()
            webView.url = "about:blank"
        }
        function onIslandScriptRequested(id, script) {
            if (Panel.islandKind !== "pressreader")
                return
            try {
                webView.runJavaScript(script, function(result) {
                    Panel.completeIslandScript(id, result, "")
                })
            } catch (error) {
                Panel.completeIslandScript(id, null, String(error))
            }
        }
        function onIslandChanged() {
            if (Panel.islandKind !== "pressreader"
                    && String(webView.url) !== "about:blank") {
                probeTimer.stop()
                webView.stop()
                webView.url = "about:blank"
            }
        }
    }

    Connections {
        target: PressReader
        function onChanged() {
            if (accountGate.visible && !userInput.activeFocus)
                userInput.text = Vault.get("pressreader-user")
        }
    }

    Timer {
        id: probeTimer
        repeat: false
        onTriggered: spotlight.runProbe()
    }
    Timer {
        id: darkTimer
        interval: 320
        repeat: false
        onTriggered: spotlight.applyProxyDarkMode()
    }
    Timer {
        id: recoveryTimer
        interval: 700
        repeat: false
        onTriggered: {
            if (spotlight.visible && spotlight.renderRecoveryCount <= 2)
                webView.reload()
        }
    }

    Row {
        id: toolbar
        x: 10
        width: parent.width - 20
        height: 44
        spacing: 4

        Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "PRESSREADER"
            color: Theme.textPrimary
            font.pixelSize: 12
            font.weight: Font.DemiBold
            font.letterSpacing: 0
        }
        Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(230, statusRow.implicitWidth + 14)
            height: 24
            radius: 6
            color: Qt.rgba(1, 1, 1, 0.05)
            border.color: Theme.cardStroke
            Row {
                id: statusRow
                anchors.centerIn: parent
                spacing: 5
                Rectangle {
                    anchors.verticalCenter: parent.verticalCenter
                    width: 7
                    height: 7
                    radius: 4
                    color: spotlight.stateColor()
                }
                Text {
                    width: Math.min(194, implicitWidth)
                    text: PressReader.status
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    elide: Text.ElideRight
                }
            }
        }
        Item { width: 5; height: 1 }
        IconButton {
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE72B"
            enabled: Panel.islandCanGoBack && !Panel.islandLoading
            onClicked: Panel.backIsland()
            tooltip: "Retour"
        }
        IconButton {
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE72A"
            enabled: Panel.islandCanGoForward && !Panel.islandLoading
            onClicked: Panel.forwardIsland()
            tooltip: "Suivant"
        }
        IconButton {
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE80F"
            onClicked: PressReader.openCatalog()
            tooltip: "Catalogue PressReader"
        }
        IconButton {
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE72C"
            enabled: !Panel.islandLoading
            onClicked: Panel.reloadIsland()
            tooltip: "Actualiser"
        }
        Item { width: Math.max(0, toolbar.width - x - sessionTime.width
                               - accountButton.width - pauseButton.width - externalButton.width
                               - closeButton.width - 12); height: 1 }
        Text {
            id: sessionTime
            visible: PressReader.sessionRemainingMinutes > 0
            anchors.verticalCenter: parent.verticalCenter
            text: PressReader.sessionRemainingMinutes >= 60
                  ? Math.floor(PressReader.sessionRemainingMinutes / 60) + " h"
                  : PressReader.sessionRemainingMinutes + " min"
            color: Theme.textSecondary
            font.pixelSize: 9
        }
        IconButton {
            id: accountButton
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE77B"
            onClicked: PressReader.showCredentials()
            tooltip: "Compte de bibliotheque"
        }
        IconButton {
            id: pauseButton
            anchors.verticalCenter: parent.verticalCenter
            glyph: PressReader.automationBlocked ? "\uE768" : "\uE769"
            active: PressReader.automationBlocked
            enabled: PressReader.hasCredentials
            onClicked: {
                if (PressReader.automationBlocked) {
                    PressReader.resumeAutomation()
                    Panel.reloadIsland()
                } else {
                    PressReader.pauseAutomation(10)
                }
            }
            tooltip: PressReader.automationBlocked
                     ? "Reprendre la connexion automatique"
                     : "Suspendre la connexion automatique"
        }
        IconButton {
            id: externalButton
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE8A7"
            onClicked: Panel.openExternal(String(webView.url || PressReader.entryUrl))
            tooltip: "Ouvrir dans le navigateur"
        }
        IconButton {
            id: closeButton
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE8BB"
            onClicked: PressReader.close()
            tooltip: "Fermer PressReader"
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: toolbar.bottom
        height: 1
        color: Theme.cardStroke
    }

    WebEngineView {
        id: webView
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: toolbar.bottom
        anchors.bottom: parent.bottom
        anchors.margins: 1
        profile: PressReaderProfile
        backgroundColor: "#0c0f14"
        focus: spotlight.visible

        settings.forceDarkMode: false
        settings.javascriptCanOpenWindows: true
        settings.localContentCanAccessRemoteUrls: false
        settings.fullScreenSupportEnabled: true
        settings.backForwardCacheEnabled: true
        settings.focusOnNavigationEnabled: true
        settings.scrollAnimatorEnabled: true
        settings.pdfViewerEnabled: true

        onUrlChanged: {
            spotlight.reportState("")
            spotlight.scheduleProbe(550)
        }
        onTitleChanged: spotlight.reportState("")
        onCanGoBackChanged: spotlight.reportState("")
        onCanGoForwardChanged: spotlight.reportState("")
        onLoadingChanged: function(loadInfo) {
            let error = ""
            if (loadInfo.status === WebEngineView.LoadFailedStatus
                    && loadInfo.errorCode !== -3)
                error = loadInfo.errorString || "PressReader failed to load"
            spotlight.reportState(error)
            if (loadInfo.status === WebEngineView.LoadStartedStatus) {
                spotlight.probePass = 0
                PressReader.navigationStarted(String(webView.url || ""))
            } else if (loadInfo.status === WebEngineView.LoadSucceededStatus) {
                spotlight.renderRecoveryCount = 0
                darkTimer.restart()
                spotlight.scheduleProbe(420)
            } else if (loadInfo.status === WebEngineView.LoadFailedStatus
                       && loadInfo.errorCode !== -3) {
                PressReader.navigationFailed(error)
            }
        }
        onNewWindowRequested: function(request) { request.openIn(webView) }
        onWindowCloseRequested: console.info("[pressreader] ignored page window-close request")
        onFullScreenRequested: function(request) { request.accept() }
        onRenderProcessTerminated: function(status, exitCode) {
            Panel.reportIslandRenderTerminated(status, exitCode)
            PressReader.navigationFailed("Moteur PressReader interrompu")
            if (spotlight.renderRecoveryCount < 2) {
                spotlight.renderRecoveryCount += 1
                recoveryTimer.restart()
            }
        }
    }

    Rectangle {
        visible: Panel.islandLoading
        anchors.left: parent.left
        anchors.right: parent.right
        y: toolbar.height
        height: 2
        color: Qt.rgba(1, 1, 1, 0.05)
        clip: true
        Rectangle {
            id: progressPulse
            width: Math.max(72, spotlight.width * 0.24)
            height: parent.height
            radius: 1
            color: Theme.accent
            NumberAnimation on x {
                running: Panel.islandLoading
                loops: Animation.Infinite
                from: -progressPulse.width
                to: spotlight.width
                duration: 950
            }
        }
    }

    Rectangle {
        id: accountGate
        visible: PressReader.state === "credentials-required"
                 || PressReader.state === "rejected"
                 || PressReader.state === "paused"
                 || PressReader.state === "session-expired"
                 || PressReader.state === "offline"
        anchors.fill: webView
        color: Qt.rgba(0.035, 0.045, 0.065, 0.94)
        z: 4

        Rectangle {
            width: Math.min(430, parent.width - 40)
            height: gateContent.implicitHeight + 32
            anchors.centerIn: parent
            radius: 8
            color: "#181c24"
            border.color: Theme.cardStroke

            Column {
                id: gateContent
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 16
                spacing: 10

                Text {
                    width: parent.width
                    text: PressReader.state === "rejected" ? "Connexion refusee"
                          : PressReader.state === "offline" ? "PressReader indisponible"
                          : PressReader.state === "paused" ? "Connexion en pause"
                          : PressReader.state === "session-expired" ? "Session expiree"
                          : "Compte de bibliotheque"
                    color: Theme.textPrimary
                    font.pixelSize: 16
                    font.weight: Font.DemiBold
                }
                Text {
                    width: parent.width
                    text: PressReader.status
                    color: PressReader.state === "rejected" ? "#fca5a5" : Theme.textSecondary
                    font.pixelSize: 10
                    wrapMode: Text.WordWrap
                }
                Text {
                    visible: PressReader.state === "credentials-required"
                             || PressReader.state === "rejected"
                    text: "No d'usager"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                Rectangle {
                    visible: PressReader.state === "credentials-required"
                             || PressReader.state === "rejected"
                    width: parent.width
                    height: 32
                    radius: 6
                    color: Qt.rgba(1, 1, 1, 0.06)
                    border.color: userInput.activeFocus ? Theme.accent : Theme.cardStroke
                    TextInput {
                        id: userInput
                        anchors.fill: parent
                        anchors.margins: 8
                        verticalAlignment: TextInput.AlignVCenter
                        color: Theme.textPrimary
                        font.pixelSize: 11
                        selectByMouse: true
                    }
                }
                Text {
                    visible: PressReader.state === "credentials-required"
                             || PressReader.state === "rejected"
                    text: "Mot de passe"
                    color: Theme.textSecondary
                    font.pixelSize: 9
                }
                Rectangle {
                    visible: PressReader.state === "credentials-required"
                             || PressReader.state === "rejected"
                    width: parent.width
                    height: 32
                    radius: 6
                    color: Qt.rgba(1, 1, 1, 0.06)
                    border.color: passwordInput.activeFocus ? Theme.accent : Theme.cardStroke
                    TextInput {
                        id: passwordInput
                        anchors.fill: parent
                        anchors.margins: 8
                        verticalAlignment: TextInput.AlignVCenter
                        color: Theme.textPrimary
                        font.pixelSize: 11
                        echoMode: TextInput.Password
                        selectByMouse: true
                        onAccepted: {
                            PressReader.saveCredentials(userInput.text, text)
                            text = ""
                        }
                    }
                }
                Row {
                    width: parent.width
                    spacing: 6
                    ActionButton {
                        visible: PressReader.state === "credentials-required"
                                 || PressReader.state === "rejected"
                        label: "Enregistrer et connecter"
                        primary: true
                        onClicked: {
                            PressReader.saveCredentials(userInput.text, passwordInput.text)
                            passwordInput.text = ""
                        }
                    }
                    ActionButton {
                        label: PressReader.state === "offline" ? "Reessayer"
                             : PressReader.state === "session-expired" ? "Reconnecter"
                             : PressReader.state === "paused" ? "Reprendre"
                             : "Connexion manuelle"
                        onClicked: {
                            if (PressReader.state === "session-expired")
                                PressReader.openCatalog()
                            else if (PressReader.state === "offline")
                                Panel.reloadIsland()
                            else if (PressReader.state === "paused") {
                                PressReader.resumeAutomation()
                                Panel.reloadIsland()
                            } else
                                PressReader.openManual()
                        }
                    }
                    ActionButton {
                        visible: PressReader.hasCredentials
                        label: "Oublier"
                        destructive: true
                        onClicked: PressReader.forgetCredentials()
                    }
                }
                Text {
                    visible: !PressReader.automationAllowed
                    width: parent.width
                    text: "Profil de diagnostic: aucune soumission automatique."
                    color: Theme.textSecondary
                    font.pixelSize: 9
                    wrapMode: Text.WordWrap
                }
            }
        }
    }
}
