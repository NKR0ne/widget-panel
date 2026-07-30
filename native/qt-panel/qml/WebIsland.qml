import QtQuick
import QtWebEngine
import QtPanel.Native

Rectangle {
    id: island

    readonly property bool presented: Panel.islandOpen && Panel.islandKind === "web"
    visible: presented || opacity > 0.01
    enabled: presented
    opacity: presented ? 1 : 0
    color: "#080a10"
    radius: Theme.radiusPanel
    border.width: 1
    border.color: Theme.cardStroke
    clip: true
    z: 80

    transform: Translate {
        id: islandShift
        x: island.presented ? 0 : 14
        Behavior on x {
            NumberAnimation {
                duration: Motion.deliberateMs
                easing.type: Easing.BezierSpline
                easing.bezierCurve: Motion.emphasized
            }
        }
    }
    Behavior on opacity { NumberAnimation { duration: Motion.normalMs } }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: Theme.radiusCard
        anchors.rightMargin: Theme.radiusCard
        height: 1
        z: 10
        visible: Ui.surfaceLighting
        opacity: 0.7 * Ui.lightingStrength
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 0.5; color: Theme.keyline }
            GradientStop { position: 1; color: "transparent" }
        }
    }

    property int renderRecoveryCount: 0

    function reportState(error) {
        Panel.reportIslandState(String(webView.url || ""), webView.title || "",
                                webView.loading, webView.canGoBack,
                                webView.canGoForward, error || "")
    }

    function isPressReaderPage() {
        const current = String(webView.url || "").toLowerCase()
        return current.indexOf("pressreader") >= 0 || current.indexOf("ezproxy") >= 0
    }

    function pressReaderDarkScript() {
        return `(() => {
            if (window.__qtPanelDarkActive) return true;
            window.__qtPanelDarkActive = true;
            const panel = '#181a1d';
            const raised = '#202329';
            const text = '#f7faff';
            const styleId = 'qt-panel-dark-style';
            const skip = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CANVAS', 'VIDEO']);
            const css = [
              ':root{color-scheme:dark!important}',
              'html,body{background:#111214!important;color:#f7faff!important}',
              'body{scrollbar-color:rgba(170,180,195,.55) #111214!important}',
              'a,a *{color:#8db7ff!important}',
              '[role="toolbar"],[role="banner"],[class*="Toolbar"],[class*="Header"]{background:#181a1d!important;color:#f7faff!important}',
              'main,section,article,aside,footer,[role="main"],[role="region"],[role="dialog"]{background-color:#181a1d!important;color:#f7faff!important}',
              '[class*="publication"],[class*="Publication"],[class*="cover"],[class*="Cover"],[class*="thumb"],[class*="Thumb"],[class*="image"],[class*="Image"],picture,figure,img{background-color:#202329!important}',
              'img:not([src]),img[src=""],img[aria-busy="true"],img[loading]{background:linear-gradient(145deg,#202329,#16181b)!important}',
              'input,textarea,select,button{background-color:#24272d!important;color:#f7faff!important;border-color:rgba(238,248,255,.24)!important}',
              '::selection{background:rgba(47,109,255,.46)!important;color:#fff!important}'
            ].join('\\n');
            function parseRgb(value) {
              const match = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(value || '');
              if (!match) return null;
              return { r:Number(match[1]), g:Number(match[2]), b:Number(match[3]), a:match[4] == null ? 1 : Number(match[4]) };
            }
            function lightSurface(rgb) {
              if (!rgb || rgb.a < .45) return false;
              return Math.max(rgb.r, rgb.g, rgb.b) >= 112 && Math.min(rgb.r, rgb.g, rgb.b) >= 86;
            }
            function darkText(rgb) {
              return rgb && rgb.a >= .45 && Math.max(rgb.r, rgb.g, rgb.b) < 120;
            }
            function raisedLike(el) {
              const marker = ((el.className && String(el.className)) + ' ' + (el.getAttribute('role') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
              return /toolbar|command|header|button|menu|ribbon|bar|card|tile|modal|dialog/.test(marker);
            }
            function inject(doc) {
              try {
                const host = doc.head || doc.documentElement;
                if (!host || doc.getElementById(styleId)) return;
                const style = doc.createElement('style');
                style.id = styleId;
                style.textContent = css;
                host.appendChild(style);
              } catch {}
            }
            function recolor(root) {
              const doc = root && root.nodeType === 9 ? root : (root && root.ownerDocument) || document;
              inject(doc);
              const scope = root && root.querySelectorAll ? root : doc;
              const base = scope.nodeType === 9 ? [scope.documentElement, scope.body] : [scope];
              for (const el of [...base, ...scope.querySelectorAll('*')].filter(Boolean)) {
                if (skip.has(el.tagName)) continue;
                const style = doc.defaultView.getComputedStyle(el);
                if (lightSurface(parseRgb(style.backgroundColor))) {
                  el.style.setProperty('background-color', raisedLike(el) ? raised : panel, 'important');
                  el.style.setProperty('background-image', 'none', 'important');
                }
                if (darkText(parseRgb(style.color))) el.style.setProperty('color', text, 'important');
              }
            }
            function frames(doc) {
              for (const frame of doc.querySelectorAll('iframe')) {
                try {
                  if (!frame.contentDocument) continue;
                  recolor(frame.contentDocument);
                  watch(frame.contentDocument);
                  frames(frame.contentDocument);
                } catch {}
              }
            }
            let queued = false;
            function schedule(root) {
              if (queued) return;
              queued = true;
              requestAnimationFrame(() => {
                queued = false;
                try { recolor(root || document); frames(document); } catch {}
              });
            }
            function watch(doc) {
              try {
                if (!doc.documentElement || doc.__qtPanelDarkWatched) return;
                doc.__qtPanelDarkWatched = true;
                new MutationObserver(mutations => {
                  for (const mutation of mutations)
                    for (const node of mutation.addedNodes)
                      if (node.nodeType === 1) schedule(node);
                }).observe(doc.documentElement, { childList:true, subtree:true });
              } catch {}
            }
            watch(document);
            schedule(document);
            [250, 700, 1600, 3600].forEach(delay => setTimeout(() => schedule(document), delay));
            return true;
        })()`
    }

    function applySiteDarkMode() {
        if (isPressReaderPage())
            webView.runJavaScript(pressReaderDarkScript())
    }

    Connections {
        target: Panel
        function onIslandOpenRequested(url) {
            webView.url = url
            webView.forceActiveFocus()
        }
        function onIslandNavigateRequested(url) {
            if (Panel.islandKind === "web") webView.url = url
        }
        function onIslandReloadRequested() {
            if (Panel.islandKind === "web") webView.reload()
        }
        function onIslandBackRequested() {
            if (Panel.islandKind === "web") webView.goBack()
        }
        function onIslandForwardRequested() {
            if (Panel.islandKind === "web") webView.goForward()
        }
        function onIslandCloseRequested() {
            if (Panel.islandKind !== "web") return
            darkRetry.stop()
            webView.stop()
            webView.url = "about:blank"
        }
        function onIslandScriptRequested(id, script) {
            if (Panel.islandKind !== "web") return
            try {
                webView.runJavaScript(script, function(result) {
                    Panel.completeIslandScript(id, result, "")
                })
            } catch (error) {
                Panel.completeIslandScript(id, null, String(error))
            }
        }
        function onIslandChanged() {
            if (Panel.islandKind !== "web" && String(webView.url) !== "about:blank") {
                darkRetry.stop()
                webView.stop()
                webView.url = "about:blank"
            }
        }
    }

    Timer {
        id: darkRetry
        interval: 450
        repeat: false
        onTriggered: island.applySiteDarkMode()
    }

    Timer {
        id: recoveryReset
        interval: 15000
        repeat: false
        onTriggered: island.renderRecoveryCount = 0
    }

    Timer {
        id: renderRecovery
        interval: 700
        repeat: false
        onTriggered: {
            if (Panel.islandOpen && island.renderRecoveryCount <= 2)
                webView.reload()
        }
    }

    Row {
        id: toolbar
        x: 12
        width: parent.width - 24
        height: 42
        spacing: 8

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
            glyph: "\uE72C"
            enabled: !Panel.islandLoading
            onClicked: Panel.reloadIsland()
            tooltip: "Actualiser"
        }
        Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: Math.max(80, island.width - 370)
            height: 26
            radius: 6
            color: Qt.rgba(1, 1, 1, 0.06)
            border.color: address.activeFocus ? Theme.accent : Theme.cardStroke
            TextInput {
                id: address
                anchors.fill: parent
                anchors.margins: 7
                verticalAlignment: TextInput.AlignVCenter
                color: Theme.textPrimary
                font.pixelSize: Theme.fontSizeCaption
                clip: true
                text: Panel.islandUrl
                onAccepted: Panel.navigateIsland(text)
            }
        }
        Row {
            anchors.verticalCenter: parent.verticalCenter
            spacing: 5
            width: 132
            height: 26
            Rectangle {
                width: 7
                height: 7
                radius: 3.5
                anchors.verticalCenter: parent.verticalCenter
                color: Panel.islandError !== "" ? Theme.danger
                     : Panel.islandLoading ? Theme.warning : Theme.success
            }
            Text {
                width: parent.width - 12
                anchors.verticalCenter: parent.verticalCenter
                text: Panel.islandError !== "" ? Panel.islandError
                      : Panel.islandLoading ? Panel.islandStatus
                      : Panel.islandTitle !== "" ? Panel.islandTitle
                      : Panel.islandStatus !== "" ? Panel.islandStatus : "Ready"
                color: Panel.islandError !== "" ? "#fca5a5" : Theme.textSecondary
                font.pixelSize: 9
                elide: Text.ElideRight
            }
        }
        IconButton {
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE8A7"
            onClicked: {
                Panel.openExternal(Panel.islandUrl)
                Panel.closeIsland()
            }
            tooltip: "Ouvrir dans le navigateur"
        }
        IconButton {
            anchors.verticalCenter: parent.verticalCenter
            glyph: "\uE8BB"
            onClicked: Panel.closeIsland()
            tooltip: "Fermer"
        }
    }

    WebEngineView {
        id: webView
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: toolbar.bottom
        anchors.bottom: parent.bottom
        // Children render above Rectangle borders. Keep the native web surface
        // inside the stroke so it cannot cover the island perimeter.
        anchors.margins: 1
        profile: WebProfile
        backgroundColor: "#080a10"
        focus: island.presented

        settings.forceDarkMode: true
        settings.javascriptCanOpenWindows: true
        settings.localContentCanAccessRemoteUrls: true
        settings.playbackRequiresUserGesture: false
        settings.fullScreenSupportEnabled: true
        settings.backForwardCacheEnabled: true
        settings.focusOnNavigationEnabled: true
        settings.scrollAnimatorEnabled: true
        settings.pdfViewerEnabled: true

        onUrlChanged: island.reportState("")
        onTitleChanged: island.reportState("")
        onCanGoBackChanged: island.reportState("")
        onCanGoForwardChanged: island.reportState("")
        onLoadingChanged: function(loadingInfo) {
            let error = ""
            if (loadingInfo.status === WebEngineView.LoadFailedStatus
                    && loadingInfo.errorCode !== -3)
                error = loadingInfo.errorString || "Web page failed to load"
            island.reportState(error)
            if (loadingInfo.status === WebEngineView.LoadSucceededStatus) {
                recoveryReset.restart()
                darkRetry.restart()
            }
        }
        onNewWindowRequested: function(request) {
            request.openIn(webView)
        }
        onRenderProcessTerminated: function(terminationStatus, exitCode) {
            Panel.reportIslandRenderTerminated(terminationStatus, exitCode)
            if (island.renderRecoveryCount < 2) {
                island.renderRecoveryCount += 1
                renderRecovery.restart()
            }
        }
        // A page may call window.close() after redirects or popup handling.
        // Embedded content must not be able to dismiss the native spotlight.
        onWindowCloseRequested: console.info("[web] ignored page window-close request")
        onFullScreenRequested: function(request) { request.accept() }
    }

    Rectangle {
        visible: Panel.islandLoading
        x: 0
        y: 40
        width: parent.width
        height: 2
        color: Qt.rgba(1, 1, 1, 0.06)
        clip: true
        Rectangle {
            id: loadPulse
            width: Math.max(64, island.width * 0.26)
            height: parent.height
            radius: 1
            color: Theme.accent
            NumberAnimation on x {
                running: Panel.islandLoading
                loops: Animation.Infinite
                from: -loadPulse.width
                to: island.width
                duration: 950
                easing.type: Easing.InOutQuad
            }
        }
    }
}
