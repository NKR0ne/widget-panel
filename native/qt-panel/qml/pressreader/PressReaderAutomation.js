.pragma library

function probeScript() {
    return [
        "(() => {",
        "  const visible = el => {",
        "    if (!el) return false;",
        "    const box = el.getBoundingClientRect();",
        "    const style = getComputedStyle(el);",
        "    return box.width > 1 && box.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';",
        "  };",
        "  const attr = el => [el.id, el.name, el.autocomplete, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ').toLowerCase();",
        "  const label = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();",
        "  const controls = [...document.querySelectorAll('button,input[type=submit],input[type=button],input[type=image],a,[role=button]')].filter(visible);",
        "  const inputs = [...document.querySelectorAll('input')].filter(visible);",
        "  const password = inputs.find(input => (input.type || '').toLowerCase() === 'password' || /pass|mot|pin|nip|secret|code/.test(attr(input)));",
        "  const body = (document.body?.innerText || '').slice(0, 8000);",
        "  const rejection = /(?:invalid|incorrect|rejected|refus(?:e|\u00e9)?|failed|bloqu(?:e|\u00e9)|locked|suspendu|too many|trop de|invalide|erron(?:e|\u00e9)|non valide).{0,140}(?:password|pass|pin|nip|login|connexion|usager|card|barcode|identifiant|mot de passe)|(?:password|pass|pin|nip|login|connexion|usager|card|barcode|identifiant|mot de passe).{0,140}(?:invalid|incorrect|rejected|refus(?:e|\u00e9)?|failed|bloqu(?:e|\u00e9)|locked|suspendu|too many|trop de|invalide|erron(?:e|\u00e9)|non valide)/i;",
        "  const authRejected = rejection.test(body);",
        "  const hasStartReading = controls.some(el => /start reading|read now|commencer|lire maintenant|ouvrir la publication/i.test(label(el)));",
        "  const hasAccount = controls.some(el => /deconnexion|sign out|logout|mon compte|my account/i.test(label(el)));",
        "  const contentLinks = [...document.querySelectorAll('a[href]')].filter(visible).filter(el => /pressreader|catalog|publication|magazines|journaux/i.test(el.href || '')).length;",
        "  const pressReaderLink = [...document.querySelectorAll('a[href]')].filter(visible).find(el => /^pressreader$/i.test(label(el)) || /pressreader/i.test(el.href || ''));",
        "  const visibleImages = [...document.querySelectorAll('img')].filter(visible).length;",
        "  const host = location.hostname.toLowerCase();",
        "  const path = location.pathname.toLowerCase();",
        "  const proxyMenu = host.includes('ezproxy.bibliothequedequebec.qc.ca') && !password && !!pressReaderLink && /menu\.htm from the docs|default menu of databases|database menu/i.test(body);",
        "  const publication = host.includes('pressreader.com') && (/\\/(?:viewer|reader|issue|newspaper|magazine)\\b/.test(path) || !!document.querySelector('canvas'));",
        "  const hasSessionEvidence = publication || hasStartReading || hasAccount || (!password && host.includes('pressreader.com') && (contentLinks >= 4 || visibleImages >= 8));",
        "  if (!window.__qtPressReaderInteractionTracker) {",
        "    window.__qtPressReaderInteractionTracker = true;",
        "    document.addEventListener('pointerdown', event => { if (event.isTrusted) window.__qtPressReaderUserClick = Date.now(); }, true);",
        "  }",
        "  const recentInteraction = Date.now() - Number(window.__qtPressReaderUserClick || 0) < 15000;",
        "  const signature = [location.origin, location.pathname, attr(inputs[0]), attr(password)].join('|');",
        "  return { ok:true, url:location.href, title:document.title || '', authRejected, hasLogin:!!password, hasStartReading, hasSessionEvidence, publication, proxyMenu, recentInteraction, signature };",
        "})()",
    ].join("\n")
}

function loginScript(username, passwordValue) {
    const user = JSON.stringify(String(username || ""))
    const pass = JSON.stringify(String(passwordValue || ""))
    return [
        "(() => {",
        "  const username = " + user + ";",
        "  const passwordValue = " + pass + ";",
        "  const visible = el => { if (!el) return false; const box=el.getBoundingClientRect(); const style=getComputedStyle(el); return box.width>1 && box.height>1 && style.display!=='none' && style.visibility!=='hidden'; };",
        "  const attr = el => [el.id,el.name,el.autocomplete,el.placeholder,el.getAttribute('aria-label'),el.getAttribute('title')].filter(Boolean).join(' ').toLowerCase();",
        "  const label = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();",
        "  const inputs = [...document.querySelectorAll('input')].filter(visible);",
        "  const password = inputs.find(input => (input.type || '').toLowerCase()==='password' || /pass|mot|pin|nip|secret|code/.test(attr(input)));",
        "  const textInputs = inputs.filter(input => !['hidden','password','submit','button','checkbox','radio'].includes((input.type || 'text').toLowerCase()));",
        "  const userInput = textInputs.find(input => /user|usager|card|barcode|client|login|name|identifiant|dossier|numero|library|biblioth/.test(attr(input))) || textInputs[0];",
        "  if (!username || !passwordValue || !userInput || !password) return { ok:false, submitted:false, reason:'fields unavailable' };",
        "  const marker = [location.href,document.title || '',document.body?.innerText || '',attr(userInput),attr(password)].join(' ').slice(0,6000);",
        "  if (!/pressreader|ezproxy|connexion|login|biblioth|library|mot de passe|password|usager|card|barcode|identifiant/i.test(marker)) return { ok:false, submitted:false, reason:'untrusted form' };",
        "  const setValue = (el,value) => { const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; el.focus?.(); if (setter) setter.call(el,value); else el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };",
        "  const form = password.form || userInput.form;",
        "  let returnTargetRepaired = false;",
        "  if (form && location.hostname.toLowerCase()==='ezproxy.bibliothequedequebec.qc.ca') {",
        "    let returnInput = form.querySelector('input[type=hidden][name=url]');",
        "    if (!returnInput) { returnInput=document.createElement('input'); returnInput.type='hidden'; returnInput.name='url'; form.appendChild(returnInput); }",
        "    const destination='https://www.pressreader.com';",
        "    if (String(returnInput.value || '').trim() !== destination) { setValue(returnInput,destination); returnTargetRepaired=true; }",
        "  }",
        "  setValue(userInput, username);",
        "  setValue(password, passwordValue);",
        "  const controls = [...document.querySelectorAll('button,input[type=submit],input[type=button],input[type=image],[role=button]')].filter(visible);",
        "  const submit = controls.find(el => /connexion|connecter|se connecter|login|log in|sign in|submit|soumettre|valider|continue|continuer|ok/i.test(label(el))) || password.form?.querySelector('button[type=submit],input[type=submit],input[type=image]');",
        "  setTimeout(() => { if (submit) submit.click(); else if (password.form?.requestSubmit) password.form.requestSubmit(); else password.form?.submit?.(); }, 120);",
        "  return { ok:true, submitted:true, returnTargetRepaired };",
        "})()",
    ].join("\n")
}

function openPressReaderFromMenuScript() {
    return [
        "(() => {",
        "  const visible = el => { if (!el) return false; const box=el.getBoundingClientRect(); const style=getComputedStyle(el); return box.width>1 && box.height>1 && style.display!=='none' && style.visibility!=='hidden'; };",
        "  const label = el => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();",
        "  if (location.hostname.toLowerCase()!=='ezproxy.bibliothequedequebec.qc.ca') return { ok:false, clicked:false, reason:'unexpected host' };",
        "  const target=[...document.querySelectorAll('a[href]')].filter(visible).find(el => /^pressreader$/i.test(label(el)) || /pressreader/i.test(el.href || ''));",
        "  if (!target) return { ok:false, clicked:false, reason:'link unavailable' };",
        "  target.click();",
        "  return { ok:true, clicked:true };",
        "})()",
    ].join("\n")
}

function startReadingScript() {
    return [
        "(() => {",
        "  const visible = el => { if (!el) return false; const box=el.getBoundingClientRect(); const style=getComputedStyle(el); return box.width>1 && box.height>1 && style.display!=='none' && style.visibility!=='hidden'; };",
        "  const label = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();",
        "  const target = [...document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')].filter(visible).find(el => /start reading|read now|commencer|lire maintenant|ouvrir la publication/i.test(label(el)));",
        "  if (!target) return { ok:false, clicked:false };",
        "  target.click();",
        "  return { ok:true, clicked:true };",
        "})()",
    ].join("\n")
}

function proxyDarkScript() {
    return [
        "(() => {",
        "  const host=location.hostname.toLowerCase();",
        "  if (!host.includes('ezproxy') && !host.includes('bibliothequedequebec')) return false;",
        "  const id='qt-pressreader-proxy-dark';",
        "  if (document.getElementById(id)) return true;",
        "  const style=document.createElement('style');",
        "  style.id=id;",
        "  style.textContent=':root{color-scheme:dark!important}html,body{background:#101216!important;color:#f5f7fb!important}main,section,article,[role=main],[role=dialog],form{background-color:#171a20!important;color:#f5f7fb!important}input,button,select{background:#252a33!important;color:#f5f7fb!important;border-color:rgba(255,255,255,.24)!important}a{color:#8db7ff!important}';",
        "  (document.head || document.documentElement).appendChild(style);",
        "  return true;",
        "})()",
    ].join("\n")
}
