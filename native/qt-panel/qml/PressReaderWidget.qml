import QtQuick
import QtPanel.Native

// PressReader stays web-based (library ezproxy auth); the card opens the
// catalog in a brave-host island beside the panel, matching the plan's
// "web island" approach for auth-heavy sites.
GlassCard {
    id: card
    title: "PressReader"
    implicitHeight: body.implicitHeight + 24

    readonly property string fallbackCatalogUrl:
        "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog/featured"
    property string catalogUrl: fallbackCatalogUrl
    property bool hasSavedLogin: false
    property string automationRequestId: ""
    property string automationStatus: ""
    property int stateRev: 0

    function refreshState() {
        catalogUrl = Store.get("wp-pressreader-url", fallbackCatalogUrl)
        hasSavedLogin = Vault.has("pressreader-user") && Vault.has("pressreader-password")
        stateRev += 1
    }
    function guardrail() {
        stateRev
        try {
            const raw = Store.get("wp-pressreader-guardrail", "{}")
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
            return parsed || { blockedUntil: 0, reason: "" }
        } catch (e) {
            return { blockedUntil: 0, reason: "" }
        }
    }
    function guardrailBlocked() {
        return Number(guardrail().blockedUntil || 0) > Date.now()
    }
    function guardrailMessage() {
        const gate = guardrail()
        const remaining = Number(gate.blockedUntil || 0) - Date.now()
        if (remaining <= 0)
            return ""
        return "Auto-login paused " + Math.ceil(remaining / 60000)
            + " min" + (gate.reason ? ": " + gate.reason : "")
    }
    function setGuardrail(minutes, reason) {
        Store.set("wp-pressreader-guardrail", JSON.stringify({
            blockedUntil: Date.now() + Math.max(1, minutes) * 60000,
            reason: reason || "manual pause"
        }))
        refreshState()
    }
    function clearGuardrail() {
        Store.set("wp-pressreader-guardrail", JSON.stringify({ blockedUntil: 0, reason: "" }))
        automationStatus = ""
        refreshState()
    }
    function canAutomate() {
        return !guardrailBlocked()
    }
    function openCatalog() {
        automationStatus = "Ouverture du catalogue"
        Panel.openIsland(catalogUrl)
        if (canAutomate()) {
            automationTimer.interval = 1800
            automationTimer.restart()
        }
    }
    function openManual() {
        automationRequestTimeout.stop()
        automationRequestId = ""
        automationStatus = "Connexion manuelle"
        setGuardrail(30, "manual login session")
        Panel.openIsland(catalogUrl)
    }
    function runAutomation() {
        if (!canAutomate() || !Panel.islandOpen || automationRequestId)
            return
        const current = String(Panel.islandUrl || "").toLowerCase()
        if (current.indexOf("pressreader") < 0 && current.indexOf("ezproxy") < 0)
            return
        automationRequestId = Panel.runIslandScript(automationScript())
        if (automationRequestId)
            automationRequestTimeout.restart()
    }
    function automationScript() {
        const user = JSON.stringify(Vault.get("pressreader-user"))
        const pass = JSON.stringify(Vault.get("pressreader-password"))
        return [
            "(() => {",
            "  const username = " + user + ";",
            "  const passwordValue = " + pass + ";",
            "  const visible = el => {",
            "    if (!el) return false;",
            "    const box = el.getBoundingClientRect();",
            "    const style = getComputedStyle(el);",
            "    return box.width > 1 && box.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';",
            "  };",
            "  const attr = el => [el.id, el.name, el.autocomplete, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ').toLowerCase();",
            "  const label = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();",
            "  const setValue = (el, value) => {",
            "    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;",
            "    try { el.focus?.(); } catch {}",
            "    if (setter) setter.call(el, value); else el.value = value;",
            "    el.dispatchEvent(new Event('input', { bubbles: true }));",
            "    el.dispatchEvent(new Event('change', { bubbles: true }));",
            "    try { el.blur?.(); } catch {}",
            "  };",
            "  const clickElement = el => {",
            "    if (!el) return false;",
            "    try { el.scrollIntoView?.({ block: 'center', inline: 'center' }); } catch {}",
            "    try { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window })); } catch {}",
            "    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window })); } catch {}",
            "    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window })); } catch {}",
            "    try { el.click(); return true; } catch { return false; }",
            "  };",
            "  const controls = () => [...document.querySelectorAll('button, input[type=\"submit\"], input[type=\"button\"], input[type=\"image\"], a, [role=\"button\"]')].filter(visible);",
            "  const pageState = () => {",
            "    const inputs = [...document.querySelectorAll('input')].filter(visible);",
            "    const password = inputs.find(input => (input.type || '').toLowerCase() === 'password' || /pass|mot|pin|nip|secret|code/.test(attr(input)));",
            "    const body = (document.body?.innerText || '').slice(0, 5200);",
            "    const rejection = '(?:invalid|incorrect|rejected|refus(?:e|\\u00e9)?|erreur|failed|bloqu(?:e|\\u00e9)|locked|suspendu|too many|trop de|invalide|erron(?:e|\\u00e9)|non valide)';",
            "    const credential = '(?:password|pass|pin|nip|login|connexion|usager|card|barcode|identifiant|mot de passe)';",
            "    const authRejected = new RegExp(rejection + '.{0,120}' + credential + '|' + credential + '.{0,120}' + rejection, 'i').test(body);",
            "    const hasStartReading = controls().some(el => /start reading|read now|commencer|lire maintenant|ouvrir la publication/i.test(label(el)));",
            "    const hasAccount = controls().some(el => /deconnexion|sign out|logout|mon compte|my account/i.test(label(el)));",
            "    const contentLinks = [...document.querySelectorAll('a[href]')].filter(visible).filter(el => /pressreader|catalog|publication|magazines|journaux/i.test(el.href || '')).length;",
            "    const visibleImages = [...document.querySelectorAll('img')].filter(visible).length;",
            "    return { authRejected, hasLogin: !!password, hasStartReading, hasSessionEvidence: hasStartReading || hasAccount || (!password && contentLinks >= 4 && visibleImages >= 4) };",
            "  };",
            "  if (!window.__qtPressReaderInteractionTracker) {",
            "    window.__qtPressReaderInteractionTracker = true;",
            "    document.addEventListener('pointerdown', event => { if (event.isTrusted) window.__qtPressReaderUserClick = Date.now(); }, true);",
            "  }",
            "  const userIsInteracting = () => Date.now() - Number(window.__qtPressReaderUserClick || 0) < 15000;",
            "  const clickStartReading = () => {",
            "    if (userIsInteracting()) return false;",
            "    const target = controls().find(el => /start reading|read now|commencer|lire maintenant|ouvrir la publication/i.test(label(el)));",
            "    if (!target) return false;",
            "    const key = [location.href, label(target), Math.round(target.getBoundingClientRect().top)].join('|');",
            "    const last = window.__qtPressReaderStart || { key: '', at: 0 };",
            "    if (last.key === key && Date.now() - last.at < 2500) return true;",
            "    window.__qtPressReaderStart = { key, at: Date.now() };",
            "    return clickElement(target);",
            "  };",
            "  const attemptLogin = () => {",
            "    if (userIsInteracting()) return false;",
            "    if (!username || !passwordValue) return false;",
            "    const inputs = [...document.querySelectorAll('input')].filter(visible);",
            "    const password = inputs.find(input => (input.type || '').toLowerCase() === 'password' || /pass|mot|pin|nip|secret|code/.test(attr(input)));",
            "    const textInputs = inputs.filter(input => !['hidden', 'password', 'submit', 'button', 'checkbox', 'radio'].includes((input.type || 'text').toLowerCase()));",
            "    const userInput = textInputs.find(input => /user|usager|card|barcode|client|login|name|identifiant|dossier|numero|no|library|biblioth/.test(attr(input))) || textInputs[0];",
            "    if (!userInput || !password) return false;",
            "    const pageText = [location.href, document.title || '', document.body?.innerText || '', attr(userInput), attr(password)].join(' ').slice(0, 5000);",
            "    if (!/pressreader|ezproxy|connexion|login|biblioth|library|mot de passe|password|usager|card|barcode|identifiant/i.test(pageText)) return false;",
            "    if (password.value && userInput.value === username) return true;",
            "    const signature = [location.href, attr(userInput), attr(password)].join('|');",
            "    const loginState = window.__qtPressReaderLogin || { signature: '', submittedAt: 0 };",
            "    if (loginState.signature === signature && loginState.submittedAt > 0) return true;",
            "    setValue(userInput, username);",
            "    setValue(password, passwordValue);",
            "    const submit = controls().find(el => /connexion|connecter|se connecter|login|log in|sign in|submit|soumettre|valider|continue|continuer|ok/i.test(label(el))) || password.form?.querySelector('button[type=\"submit\"], input[type=\"submit\"], input[type=\"image\"]');",
            "    window.__qtPressReaderLogin = { signature, submittedAt: Date.now() };",
            "    setTimeout(() => {",
            "      if (submit) clickElement(submit);",
            "      else if (password.form?.requestSubmit) password.form.requestSubmit();",
            "      else if (password.form) password.form.submit?.();",
            "    }, 180);",
            "    return true;",
            "  };",
            "  if (window.__qtPressReaderAutomation) return Object.assign({ ok: true, active: true }, pageState());",
            "  let tries = 0;",
            "  const tick = () => {",
            "    tries += 1;",
            "    if (!/pressreader|ezproxy/i.test(location.href) && tries > 12) { clearInterval(window.__qtPressReaderAutomation); window.__qtPressReaderAutomation = null; return; }",
            "    const state = pageState();",
            "    clickStartReading();",
            "    if (!state.authRejected) attemptLogin();",
            "    if (tries >= 30) { clearInterval(window.__qtPressReaderAutomation); window.__qtPressReaderAutomation = null; }",
            "  };",
            "  window.__qtPressReaderAutomation = setInterval(tick, 900);",
            "  tick();",
            "  return Object.assign({ ok: true, installed: true }, pageState());",
            "})();"
        ].join("\n")
    }

    Component.onCompleted: refreshState()

    Timer {
        id: automationTimer
        interval: 1800
        repeat: false
        onTriggered: card.runAutomation()
    }

    Timer {
        id: automationRequestTimeout
        interval: 8000
        repeat: false
        onTriggered: {
            card.automationRequestId = ""
            card.automationStatus = "Automation sans reponse"
        }
    }

    Timer {
        interval: 30000
        repeat: true
        running: card.guardrailBlocked()
        onTriggered: {
            if (card.guardrailBlocked())
                card.stateRev += 1
            else
                card.clearGuardrail()
        }
    }

    Connections {
        target: Panel
        function onIslandScriptResult(requestId, result, error) {
            if (!card.automationRequestId || requestId !== card.automationRequestId)
                return
            automationRequestTimeout.stop()
            card.automationRequestId = ""
            if (error) {
                card.automationStatus = "Automation indisponible"
                return
            }
            const state = result || {}
            if (state.authRejected && card.hasSavedLogin) {
                card.automationStatus = "Identifiants rejetes - mise a jour requise"
                card.setGuardrail(120, "saved login rejected")
            } else if (state.hasStartReading) {
                card.automationStatus = "Publication prete"
            } else if (state.hasSessionEvidence) {
                card.automationStatus = "Session PressReader active"
            } else if (state.hasLogin) {
                card.automationStatus = card.hasSavedLogin ? "Connexion automatique" : "Connexion requise"
            } else {
                card.automationStatus = "Session en preparation"
            }
        }
        function onIslandChanged() {
            if (!Panel.islandOpen || Panel.islandLoading) {
                automationRequestTimeout.stop()
                card.automationRequestId = ""
                return
            }
            if (!card.canAutomate())
                return
            const current = String(Panel.islandUrl || "").toLowerCase()
            if (current.indexOf("pressreader") < 0 && current.indexOf("ezproxy") < 0)
                return
            automationTimer.interval = 650
            automationTimer.restart()
        }
    }

    Connections {
        target: Store
        function onChanged(key) {
            if (key === "wp-pressreader-url" || key === "wp-pressreader-guardrail")
                card.refreshState()
        }
    }

    Connections {
        target: Vault
        function onChanged(key) {
            if (key === "pressreader-user" || key === "pressreader-password") {
                card.automationStatus = ""
                card.refreshState()
            }
        }
    }

    Column {
        id: body
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        spacing: 10

        Text {
            text: card.title
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            font.capitalization: Font.AllUppercase
            font.letterSpacing: 1.2
        }

        Text {
            width: parent.width
            text: "Journaux et magazines via la Bibliothèque de Québec"
            color: Theme.textSecondary
            font.pixelSize: Theme.fontSizeCaption
            wrapMode: Text.WordWrap
        }

        Row {
            width: parent.width
            spacing: 6
            Rectangle {
                width: 7
                height: 7
                radius: 4
                anchors.verticalCenter: parent.verticalCenter
                color: card.hasSavedLogin ? "#42d392" : Qt.rgba(1, 1, 1, 0.22)
            }
            Text {
                width: parent.width - x
                text: card.guardrailBlocked() ? card.guardrailMessage()
                    : card.automationStatus ? card.automationStatus
                    : card.hasSavedLogin ? "Identifiants sauvegardes" : "Connexion manuelle si requise"
                color: Theme.textSecondary
                font.pixelSize: 10
                elide: Text.ElideRight
            }
        }

        Row {
            width: parent.width
            spacing: 6
            Rectangle {
                width: openLabel.implicitWidth + 24
                height: 30
                radius: 7
                color: openMouse.containsMouse ? Qt.rgba(0.31, 0.56, 0.97, 0.28)
                                               : Qt.rgba(0.31, 0.56, 0.97, 0.16)
                border.color: Qt.rgba(0.31, 0.56, 0.97, 0.45)

                Text {
                    id: openLabel
                    anchors.centerIn: parent
                    text: "Ouvrir le catalogue"
                    color: Theme.textPrimary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: openMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.openCatalog()
                }
            }
            Rectangle {
                width: pauseLabel.implicitWidth + 18
                height: 30
                radius: 7
                visible: card.hasSavedLogin
                color: pauseMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.05)
                border.color: Theme.cardStroke
                Text {
                    id: pauseLabel
                    anchors.centerIn: parent
                    text: card.guardrailBlocked() ? "Reprendre" : "Pause"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: pauseMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (card.guardrailBlocked())
                            card.clearGuardrail()
                        else
                            card.setGuardrail(10, "manual pause")
                    }
                }
            }
            Rectangle {
                width: manualLabel.implicitWidth + 18
                height: 30
                radius: 7
                visible: card.hasSavedLogin
                color: manualMouse.containsMouse ? Theme.hover : Qt.rgba(1, 1, 1, 0.05)
                border.color: Theme.cardStroke
                Text {
                    id: manualLabel
                    anchors.centerIn: parent
                    text: "Manuel"
                    color: Theme.textSecondary
                    font.pixelSize: Theme.fontSizeCaption
                }
                MouseArea {
                    id: manualMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: card.openManual()
                }
            }
        }
    }
}
