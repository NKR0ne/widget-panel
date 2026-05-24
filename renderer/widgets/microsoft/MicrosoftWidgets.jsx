import { useEffect, useState } from 'react';
import DemoBadge from '../../ui/DemoBadge.jsx';
import Skel from '../../ui/Skel.jsx';
import { C } from '../../ui/theme.js';
import {
  SK_AGENDA_CAL_IDS,
  SK_AGENDA_HEIGHT,
  SK_MAIL_HEIGHT,
  SK_MS_CLIENT,
  SK_MS_TOKENS,
  SK_TODO_LIST_ID,
} from '../../config/storageKeys.js';
import { api } from '../../services/electronApi.js';

const MOCK_EVENTS = (() => {
  const today = new Date(); today.setHours(0,0,0,0);
  const fmt = (d, h, m) => { const x=new Date(d); x.setHours(h,m,0,0); return x.toISOString(); };
  return [
    { id:"e1", subject:"Standup",       start:{dateTime:fmt(today,9,0)},  end:{dateTime:fmt(today,9,30)},  location:{displayName:"Teams"} },
    { id:"e2", subject:"Sprint review", start:{dateTime:fmt(today,14,0)}, end:{dateTime:fmt(today,15,0)},  location:{displayName:"Salle A"} },
    { id:"e3", subject:"1:1 Manager",   start:{dateTime:fmt(today,16,30)},end:{dateTime:fmt(today,17,0)},  location:{displayName:""} },
    { id:"e4", subject:"Architecture review", start:{dateTime:fmt(new Date(today.getTime()+86400000),10,0)}, end:{dateTime:fmt(new Date(today.getTime()+86400000),11,0)}, location:{displayName:"Teams"} },
  ];
})();
const MOCK_TASKS = [
  { id:"t1", title:"Review PR #247",         status:"notStarted", importance:"high" },
  { id:"t2", title:"Update architecture docs",status:"notStarted", importance:"normal" },
  { id:"t3", title:"Deploy to staging",       status:"inProgress", importance:"normal" },
  { id:"t4", title:"Write sprint retro notes",status:"notStarted", importance:"low" },
];
const MOCK_MAIL = [
  { id:"m1", subject:"Sprint planning agenda", from:{emailAddress:{name:"Marie Tremblay"}}, bodyPreview:"Hi team, here's the agenda for tomorrow's planning session…", receivedDateTime:new Date(Date.now()-1800000).toISOString(), isRead:false },
  { id:"m2", subject:"Re: PR #247 — feedback", from:{emailAddress:{name:"Olivier Lapointe"}}, bodyPreview:"Looks good overall, just a few minor comments on the auth flow.", receivedDateTime:new Date(Date.now()-7200000).toISOString(), isRead:false },
  { id:"m3", subject:"Weekly report — Apr 25",  from:{emailAddress:{name:"Reports"}},        bodyPreview:"Performance summary for the week including key metrics…", receivedDateTime:new Date(Date.now()-86400000).toISOString(),isRead:true },
  { id:"m4", subject:"Lunch tomorrow?",         from:{emailAddress:{name:"Pierre"}},         bodyPreview:"Free for a quick bite around 12:30?",                       receivedDateTime:new Date(Date.now()-90000000).toISOString(),isRead:true },
];

// ── Microsoft auth hook (shared store keys: wp-ms-client + wp-ms-tokens) ─────
function useMsAuth() {
  const [clientId,   setCid]    = useState('');
  const [tokens,     setTokens] = useState(null);
  const [step,       setStep]   = useState('loading');
  // step: loading | setup | authenticating | ok | error
  const [cidDraft,   setCidDraft] = useState('');
  const msApi = window.electronAPI?.msGraph;

  useEffect(() => {
    Promise.all([api.store.get(SK_MS_CLIENT), api.store.get(SK_MS_TOKENS)]).then(([cid, tokStr]) => {
      const cid_ = cid || '';
      setCid(cid_);
      setCidDraft(cid_);
      if (!cid_) { setStep('setup'); return; }
      const tok = tokStr ? (() => { try { return JSON.parse(tokStr); } catch { return null; } })() : null;
      if (!tok) { setStep('setup'); return; }
      if (tok.expiry < Date.now() + 60000) { doRefresh(cid_, tok.refreshToken); }
      else { setTokens(tok); setStep('ok'); }
    });
  }, []);

  // Auto-refresh 5 min before expiry
  useEffect(() => {
    if (step !== 'ok' || !tokens) return;
    const ttl = tokens.expiry - Date.now() - 5 * 60 * 1000;
    const t = setTimeout(() => doRefresh(clientId, tokens.refreshToken), Math.max(0, ttl));
    return () => clearTimeout(t);
  }, [tokens?.expiry, step]);

  async function doRefresh(cid, rt) {
    try {
      const res = await msApi?.tokenRefresh(cid, rt);
      if (res?.body?.access_token) {
        saveTok({ accessToken: res.body.access_token, refreshToken: res.body.refresh_token || rt,
                  expiry: Date.now() + (res.body.expires_in || 3600) * 1000 });
      } else { setStep('setup'); }
    } catch { setStep('setup'); }
  }

  function saveTok(tok) {
    setTokens(tok);
    api.store.set(SK_MS_TOKENS, JSON.stringify(tok));
    setStep('ok');
  }

  async function startAuth(cid) {
    // Mail.ReadWrite is required for PATCH /messages/{id} (markRead); Mail.Read
    // alone would let us list emails but the markRead button would 403.
    const scopes = ['Calendars.Read', 'Mail.ReadWrite', 'Tasks.ReadWrite', 'offline_access', 'User.Read'];
    setCid(cid);
    api.store.set(SK_MS_CLIENT, cid);
    setStep('authenticating');
    try {
      const res = await msApi?.authPkce(cid, scopes);
      if (res?.body?.access_token) {
        saveTok({ accessToken: res.body.access_token, refreshToken: res.body.refresh_token,
                  expiry: Date.now() + (res.body.expires_in || 3600) * 1000 });
      } else { setStep('error'); }
    } catch { setStep('error'); }
  }

  function signOut() {
    setTokens(null); setStep('setup');
    api.store.delete(SK_MS_TOKENS);
  }

  return { clientId, tokens, step, cidDraft, setCidDraft, startAuth, signOut };
}

// Shared setup UI used by both MS widgets
function MsSetupPane({ step, cidDraft, setCidDraft, startAuth }) {
  if (step === 'setup' || step === 'error') return (
    <div style={{paddingTop:6}}>
      <div style={{fontSize:11,color:"#c4c4d4",lineHeight:1.7,marginBottom:8}}>
        {step === 'error' ? "Auth failed. " : ""}Enter your <span style={{color:"#dcdcec"}}>Azure app client ID</span> to connect Microsoft.
      </div>
      <div style={{display:"flex",gap:6}}>
        <input value={cidDraft} onChange={e=>setCidDraft(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          style={{...C.inp,flex:1,fontSize:10,fontFamily:"DM Mono,monospace"}}/>
        {cidDraft && <button onClick={()=>startAuth(cidDraft)} style={C.btn}>→</button>}
      </div>
      <div style={{fontSize:9,color:"#252530",marginTop:8,lineHeight:1.7}}>
        portal.azure.com → App registrations → New → grant <em>Calendars.Read</em> + <em>Mail.Read</em> + <em>Tasks.ReadWrite</em> → enable public client flows
      </div>
    </div>
  );
  if (step === 'authenticating') return (
    <div style={{paddingTop:6,display:"flex",alignItems:"center",gap:8}}>
      <div style={{width:8,height:8,border:"1.5px solid #333",borderTop:"1.5px solid #888",borderRadius:"50%",animation:"spin 1s linear infinite",flexShrink:0}}/>
      <span style={{fontSize:11,color:"#d0d0e0"}}>Signing in… complete the browser window.</span>
    </div>
  );
  return null;
}

function HeaderKeyButton({ onClick, title = 'Se d\u00e9connecter' }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={{
        width: 19,
        height: 19,
        borderRadius: 5,
        border: '1px solid rgba(238,248,255,0.32)',
        background: 'rgba(31,111,255,0.12)',
        color: 'rgba(255,255,255,0.88)',
        cursor: 'pointer',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 10px rgba(31,111,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.5" cy="15.5" r="4.2" />
        <path d="M10.6 12.4 21 2" />
        <path d="m15.5 7.5 2.1 2.1" />
        <path d="m18.2 4.8 2.1 2.1" />
      </svg>
    </button>
  );
}

function HeaderBadgeGroup({ children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      {children}
    </span>
  );
}

// ── Outlook Agenda widget ─────────────────────────────────────────────────────
function AgendaWidget() {
  const auth = useMsAuth();
  const [events,      setEvents]      = useState([]);
  const [calendars,   setCalendars]   = useState([]);
  const [selCals,     setSelCals]     = useState(null); // null = all
  const [showSettings,setShowSettings]= useState(false);
  const [demo,        setDemo]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [cardHeight,  setCardHeight]  = useState(360);

  useEffect(() => {
    api.store.get(SK_AGENDA_CAL_IDS).then(v => {
      if (v) try { setSelCals(new Set(JSON.parse(v))); } catch {}
    });
    api.store.get(SK_AGENDA_HEIGHT).then(v => {
      const h = parseInt(v || '0');
      if (h >= 80) setCardHeight(h);
    });
  }, []);

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(80, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set(SK_AGENDA_HEIGHT, String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (auth.step !== 'ok' || !auth.tokens) return;
    const go = () => fetchAll(auth.tokens.accessToken);
    go();
    const t = setInterval(go, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [auth.step, auth.tokens?.accessToken]);

  async function fetchAll(token) {
    setLoading(true);
    try {
      const calsRes = await window.electronAPI.msGraph.fetch(
        'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,hexColor,color&$top=50', token);
      if (calsRes.status === 401) { auth.signOut(); setLoading(false); return; }
      const cals = calsRes.body?.value || [];
      setCalendars(cals);

      const now = new Date();
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() + 1);
      const timeQ = `startDateTime=${now.toISOString()}&endDateTime=${cutoff.toISOString()}`
        + `&$select=subject,start,end,location,isAllDay&$top=200`;

      // Fetch per calendar so we know which calendar each event belongs to
      const chunks = await Promise.all(cals.map(async cal => {
        const res = await window.electronAPI.msGraph.fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${cal.id}/calendarView?${timeQ}`, token);
        if (res.status !== 200 || !res.body?.value) return [];
        return res.body.value.map(ev => ({ ...ev, _calId: cal.id }));
      }));
      const toMs = e => { const s = e.start.dateTime || e.start.date; return new Date(s.endsWith('Z') ? s : s + 'Z'); };
      const sorted = chunks.flat().sort((a, b) => toMs(a) - toMs(b));
      setEvents(sorted); setDemo(false);
    } catch { setEvents(MOCK_EVENTS); setDemo(true); }
    setLoading(false); setLastUpdated(Date.now());
  }

  function toggleCal(id) {
    setSelCals(prev => {
      const base = prev || new Set(calendars.map(c => c.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id); else next.add(id);
      const isAll = next.size === calendars.length;
      api.store.set(SK_AGENDA_CAL_IDS, isAll ? null : JSON.stringify([...next]));
      return isAll ? null : next;
    });
  }

  function calColor(calId) {
    const cal = calendars.find(c => c.id === calId);
    if (!cal) return '#0078d4';
    if (cal.hexColor) return cal.hexColor;
    const MAP = { lightBlue:'#4fc3f7', lightGreen:'#7bc67a', lightOrange:'#ffba57',
                  lightGray:'#868686', lightYellow:'#f7d57e', lightTeal:'#4ec7c2',
                  lightPink:'#f0808e', lightBrown:'#a47858', lightRed:'#e36d6d' };
    return MAP[cal.color] || '#0078d4';
  }

  function toUtc(dt) { return new Date(dt.endsWith('Z') ? dt : dt + 'Z'); }
  function fmtTime(dt) {
    return toUtc(dt).toLocaleTimeString("fr-CA", { hour:"2-digit", minute:"2-digit" });
  }
  function fmtDur(start, end) {
    if (!start || !end) return '';
    const m = Math.round((toUtc(end) - toUtc(start)) / 60000);
    const h = Math.floor(m / 60), rm = m % 60;
    if (h === 0) return `${m}min`;
    return rm ? `${h}h${rm}` : `${h}h`;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today.getTime() + 86400000);
  function dayKey(ev) {
    const d = new Date(ev.start.dateTime || ev.start.date); d.setHours(0,0,0,0);
    if (d.getTime() === today.getTime()) return "Aujourd'hui";
    if (d.getTime() === tomorrow.getTime()) return "Demain";
    return d.toLocaleDateString("fr-CA", { weekday:"long", month:"short", day:"numeric" });
  }

  const visible = selCals ? events.filter(ev => selCals.has(ev._calId)) : events;
  const groups = {};
  visible.forEach(ev => { const k = dayKey(ev); (groups[k] = groups[k]||[]).push(ev); });

  const showAuth = ['loading','setup','authenticating','error'].includes(auth.step);

  const settingsBtn = auth.step === 'ok' && calendars.length > 0
    ? <button onClick={e=>{e.stopPropagation();setShowSettings(p=>!p);}}
        title="Calendriers"
        style={{width:19,height:19,borderRadius:5,border:'1px solid rgba(238,248,255,0.32)',background:showSettings?'rgba(31,111,255,0.22)':'rgba(31,111,255,0.10)',color:'#fff',fontSize:11,cursor:"pointer",padding:0,lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 10px rgba(31,111,255,0.16), inset 0 0 0 1px rgba(255,255,255,0.05)'}}>⚙</button>
    : null;
  const agendaBadge = auth.step === 'ok'
    ? <HeaderBadgeGroup>{settingsBtn}<HeaderKeyButton onClick={auth.signOut} /></HeaderBadgeGroup>
    : settingsBtn;

  return { color:"#0078d4", title:"Outlook Agenda", lastUpdated, badge: agendaBadge,
    content:(
      <div>
        {showAuth && <MsSetupPane {...auth}/>}
        {auth.step === 'ok' && (
          <div>
            {showSettings && calendars.length > 0 && (
              <div style={{paddingBottom:10,marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                {calendars.map(cal => {
                  const checked = !selCals || selCals.has(cal.id);
                  const color = calColor(cal.id);
                  return (
                    <div key={cal.id} onClick={()=>toggleCal(cal.id)}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",cursor:"pointer"}}>
                      <div style={{width:10,height:10,borderRadius:2,background:checked?color:"transparent",
                        border:`1.5px solid ${color}`,flexShrink:0,transition:"background 0.15s"}}/>
                      <span style={{fontSize:11,color:checked?"#bbb":"#444"}}>{cal.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {loading && <Skel n={2}/>}
            {!loading && (
              <div>
                {demo && <DemoBadge/>}
                {Object.keys(groups).length === 0 && (
                  <div style={{paddingTop:10,fontSize:11,color:"#dcdcec",textAlign:"center"}}>Aucun événement à venir</div>
                )}
                <div style={{height:cardHeight,overflowY:"auto",paddingRight:2}}>
                {Object.entries(groups).map(([day, evs], gi) => (
                  <div key={day} style={{marginTop: gi > 0 ? 12 : 0}}>
                    {day === "Aujourd'hui" ? (
                      <div style={{marginBottom:6}}>
                        <div style={{fontSize:11,fontWeight:600,color:"#d0d0e0",textTransform:"uppercase",letterSpacing:0.9}}>{day}</div>
                        <div style={{fontSize:10,color:"#d0d0e0",marginTop:1,textTransform:"capitalize"}}>
                          {today.toLocaleDateString("fr-CA",{weekday:"long",day:"numeric",month:"long"})}
                        </div>
                      </div>
                    ) : (
                      <div style={{...C.title,marginBottom:6}}>{day}</div>
                    )}
                    {evs.map((ev, i) => {
                      const dot = calColor(ev._calId);
                      if (ev.isAllDay) return (
                        <div key={ev.id} style={{fontSize:10,color:"#666",padding:"5px 0",
                          borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none"}}>
                          Toute la journée · {ev.subject}
                        </div>
                      );
                      return (
                        <div key={ev.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
                          borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none"}}>
                          <div style={{width:7,height:7,borderRadius:"50%",background:dot,flexShrink:0}}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,color:"#d8d8e8",lineHeight:1.35}}>{ev.subject}</div>
                            {ev.location?.displayName && (
                              <div style={{fontSize:10,color:"#d0d0e0",marginTop:1}}>{ev.location.displayName}</div>
                            )}
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:10,color:"#dcdcec",fontFamily:"DM Mono,monospace"}}>{fmtTime(ev.start.dateTime)}</div>
                            <div style={{fontSize:9,color:"#d0d0e0"}}>{fmtDur(ev.start.dateTime, ev.end.dateTime)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                </div>
                <div onMouseDown={onResizeMouseDown}
                  style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
                    display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
                  <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

// ── Outlook Mail widget ──────────────────────────────────────────────────────
function MailWidget({ onOpenWebContent } = {}) {
  const auth = useMsAuth();
  const [messages,    setMessages]    = useState([]);
  const [demo,        setDemo]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [cardHeight,  setCardHeight]  = useState(360);

  useEffect(() => {
    api.store.get(SK_MAIL_HEIGHT).then(v => {
      const h = parseInt(v || '0');
      if (h >= 80) setCardHeight(h);
    });
  }, []);

  useEffect(() => {
    if (auth.step !== 'ok' || !auth.tokens) return;
    const go = () => fetchAll(auth.tokens.accessToken);
    go();
    const t = setInterval(go, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [auth.step, auth.tokens?.accessToken]);

  async function fetchAll(token) {
    setLoading(true);
    try {
      const res = await window.electronAPI.msGraph.fetch(
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$select=subject,from,receivedDateTime,bodyPreview,isRead,importance,webLink', token);
      if (res.status === 401) { auth.signOut(); setLoading(false); return; }
      const msgs = res.body?.value || [];
      setMessages(msgs); setDemo(false);
    } catch { setMessages(MOCK_MAIL); setDemo(true); }
    setLoading(false); setLastUpdated(Date.now());
  }

  async function markRead(id) {
    if (!auth.tokens?.accessToken || demo) return;
    // Optimistic UI — mark locally so the unread dot + bold weight clear
    // immediately. Graph PATCH runs in the background; refetch (every 5min)
    // will reconcile any divergence.
    setMessages(prev => prev.map(m => m.id === id ? { ...m, isRead: true } : m));
    try {
      await window.electronAPI.msGraph.patch(
        `https://graph.microsoft.com/v1.0/me/messages/${id}`,
        auth.tokens.accessToken,
        { isRead: true }
      );
    } catch (e) {
      console.error('[mail] markRead failed', e);
    }
  }

  // Move a message to a well-known folder (e.g. deleteditems, junkemail).
  // Optimistic UI: remove from the list immediately; if Graph rejects, refetch
  // so the message reappears at its real position.
  async function moveTo(id, destinationId) {
    if (!auth.tokens?.accessToken || demo) return;
    const prev = messages;
    setMessages(prev.filter(m => m.id !== id));
    try {
      const res = await window.electronAPI.msGraph.post(
        `https://graph.microsoft.com/v1.0/me/messages/${id}/move`,
        auth.tokens.accessToken,
        { destinationId }
      );
      if (res?.status && res.status >= 400) {
        console.error('[mail] move failed', destinationId, res);
        fetchAll(auth.tokens.accessToken);
      }
    } catch (e) {
      console.error('[mail] move error', destinationId, e);
      fetchAll(auth.tokens.accessToken);
    }
  }

  function openInOutlook(msg, event) {
    console.log('[mail] openInOutlook', { id: msg.id, hasWebLink: !!msg.webLink, webLink: msg.webLink });
    if (msg.webLink) {
      if (onOpenWebContent) {
        onOpenWebContent({
          url: msg.webLink,
          title: msg.subject || 'Outlook message',
          source: 'Outlook Mail',
          partition: null,
          authUrl: 'https://outlook.office.com/mail/',
          flavor: 'outlook',
        }, event);
      } else {
        api.browser.open(msg.webLink);
      }
      // Opening in Outlook implies the user has read the email — flip the
      // unread state locally and on the server. Graph won't auto-flip when
      // OWA is opened externally.
      if (!msg.isRead) markRead(msg.id);
    } else if (auth.tokens?.accessToken) {
      // No webLink on this message — refresh the list so future clicks work,
      // and warn the user the email couldn't be opened this time.
      console.warn('[mail] no webLink, re-fetching');
      fetchAll(auth.tokens.accessToken);
    }
  }

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(80, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set(SK_MAIL_HEIGHT, String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("fr-CA", { hour:"2-digit", minute:"2-digit" });
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString("fr-CA", { weekday:"short" });
    return d.toLocaleDateString("fr-CA", { day:"numeric", month:"short" });
  }

  const showAuth = ['loading','setup','authenticating','error'].includes(auth.step);
  const unreadCount = messages.filter(m => !m.isRead).length;
  const mailUnreadBadge = unreadCount > 0
    ? <span style={{ ...C.badge, background:"#0078d4", color:"#fff" }}>{unreadCount}</span>
    : null;
  const mailBadge = auth.step === 'ok'
    ? <HeaderBadgeGroup>{mailUnreadBadge}<HeaderKeyButton onClick={auth.signOut} /></HeaderBadgeGroup>
    : mailUnreadBadge;

  return { color:"#0078d4", title:"Outlook Mail", lastUpdated,
    badge: mailBadge,
    content:(
      <div>
        {showAuth && <MsSetupPane {...auth}/>}
        {auth.step === 'ok' && (
          <div>
            {loading && <Skel n={3}/>}
            {!loading && (
              <div>
                {demo && <DemoBadge/>}
                {messages.length === 0 && (
                  <div style={{paddingTop:10,fontSize:11,color:"#dcdcec",textAlign:"center"}}>Aucun message</div>
                )}
                <div style={{height:cardHeight,overflowY:"auto",paddingRight:2}}>
                  {messages.map((msg, i) => (
                    <div key={msg.id}
                      onClick={(event)=>openInOutlook(msg, event)}
                      title="Ouvrir dans Outlook"
                      style={{display:"flex",alignItems:"flex-start",gap:8,padding:"7px 0",
                      borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none",
                      opacity:msg.isRead?0.65:1, cursor:'pointer'}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:msg.isRead?"transparent":"#0078d4",flexShrink:0,marginTop:6}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"baseline"}}>
                          <div style={{fontSize:11,color:"#d8d8e8",fontWeight:msg.isRead?400:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown'}
                          </div>
                          <div style={{fontSize:9,color:"#dcdcec",fontFamily:"DM Mono,monospace",flexShrink:0}}>{fmtTime(msg.receivedDateTime)}</div>
                        </div>
                        <div style={{fontSize:11,color:"#dcdcec",fontWeight:msg.isRead?400:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>
                          {msg.subject || '(Sans objet)'}
                        </div>
                        {msg.bodyPreview && (
                          <div style={{fontSize:10,color:"#888",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>
                            {msg.bodyPreview}
                          </div>
                        )}
                      </div>
                      <div style={{display:'flex',gap:2,flexShrink:0,marginTop:2}}>
                        {!msg.isRead && (
                          <button onClick={(e)=>{e.stopPropagation(); markRead(msg.id);}}
                            title="Marquer comme lu"
                            style={{background:'none',border:'none',cursor:'pointer',
                              color:'#888',padding:'4px',
                              display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                            </svg>
                          </button>
                        )}
                        <button onClick={(e)=>{e.stopPropagation(); moveTo(msg.id,'deleteditems');}}
                          title="Supprimer"
                          style={{background:'none',border:'none',cursor:'pointer',
                            color:'#888',padding:'4px',
                            display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                          </svg>
                        </button>
                        <button onClick={(e)=>{e.stopPropagation(); moveTo(msg.id,'junkemail');}}
                          title="Signaler comme indésirable"
                          style={{background:'none',border:'none',cursor:'pointer',
                            color:'#888',padding:'4px',
                            display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z"/>
                        </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div onMouseDown={onResizeMouseDown}
                  style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
                    display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
                  <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

// ── Camera widget — direct XPMobileSDK integration ──────────────────────────
// Loads the SDK script from the Mobile Server, authenticates with stored
// credentials, and renders incoming frames into an <img> sized to the widget.
// No webview, no chrome to strip. Credentials prompted on first use, stored// ── Microsoft To-Do widget ────────────────────────────────────────────────────
function TodoWidget() {
  const auth = useMsAuth();
  const [tasks,        setTasks]       = useState([]);
  const [lists,        setLists]       = useState([]);
  const [activeListId, setActiveListId]= useState(null);
  const [demo,         setDemo]        = useState(false);
  const [loading,      setLoading]     = useState(false);
  const [lastUpdated,  setLastUpdated] = useState(null);

  useEffect(() => {
    api.store.get(SK_TODO_LIST_ID).then(id => { if (id) setActiveListId(id); });
  }, []);

  useEffect(() => {
    if (auth.step !== 'ok' || !auth.tokens) return;
    const go = () => fetchLists(auth.tokens.accessToken);
    go();
    const t = setInterval(go, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [auth.step, auth.tokens?.accessToken]);

  async function fetchLists(token) {
    setLoading(true);
    try {
      const res = await window.electronAPI.msGraph.fetch(
        'https://graph.microsoft.com/v1.0/me/todo/lists', token);
      if (res.status === 401) { auth.signOut(); return; }
      const all = res.body?.value || [];
      setLists(all);
      const targetId = activeListId
        || all.find(l => l.wellknownListName === 'defaultList')?.id
        || all[0]?.id;
      if (targetId) {
        if (!activeListId) { setActiveListId(targetId); api.store.set(SK_TODO_LIST_ID, targetId); }
        await loadTasks(token, targetId);
      }
    } catch { setTasks(MOCK_TASKS); setDemo(true); }
    setLoading(false); setLastUpdated(Date.now());
  }

  async function loadTasks(token, lid) {
    const res = await window.electronAPI.msGraph.fetch(
      `https://graph.microsoft.com/v1.0/me/todo/lists/${lid}/tasks`
      + `?$filter=status ne 'completed'&$orderby=importance desc,createdDateTime&$top=20`, token);
    if (res.body?.value) { setTasks(res.body.value); setDemo(false); }
    else { setTasks(MOCK_TASKS); setDemo(true); }
    setLastUpdated(Date.now());
  }

  async function switchList(id) {
    setActiveListId(id);
    api.store.set(SK_TODO_LIST_ID, id);
    if (!auth.tokens) return;
    setLoading(true);
    try { await loadTasks(auth.tokens.accessToken, id); } catch {}
    setLoading(false);
  }

  async function complete(taskId) {
    setTasks(p => p.filter(t => t.id !== taskId));
    if (!demo && activeListId && auth.tokens) {
      await window.electronAPI.msGraph.patch(
        `https://graph.microsoft.com/v1.0/me/todo/lists/${activeListId}/tasks/${taskId}`,
        auth.tokens.accessToken, { status: 'completed' });
    }
  }

  const [newTitle, setNewTitle] = useState('');

  async function addTask(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !activeListId || !auth.tokens) return;
    setNewTitle('');
    const tmp = { id: 'tmp-' + Date.now(), title, importance: 'normal', status: 'notStarted' };
    setTasks(p => [tmp, ...p]);
    try {
      const res = await window.electronAPI.msGraph.post(
        `https://graph.microsoft.com/v1.0/me/todo/lists/${activeListId}/tasks`,
        auth.tokens.accessToken, { title });
      if (res.body?.id) setTasks(p => p.map(t => t.id === tmp.id ? res.body : t));
    } catch { setTasks(p => p.filter(t => t.id !== tmp.id)); }
  }

  const importanceColor = i => i === 'high' ? '#f74f7e' : i === 'normal' ? '#555' : '#333';
  const showAuth = ['loading','setup','authenticating','error'].includes(auth.step);
  const activeList = lists.find(l => l.id === activeListId);
  const todoBadge = auth.step === 'ok' ? <HeaderKeyButton onClick={auth.signOut} /> : null;

  return { color:"#2564cf", title:"Microsoft To-Do", lastUpdated, badge: todoBadge,
    content:(
      <div>
        {showAuth && <MsSetupPane {...auth}/>}
        {auth.step === 'ok' && (
          <div>
            {lists.length > 1 && (
              <select value={activeListId||''} onChange={e=>switchList(e.target.value)}
                style={{width:"100%",marginBottom:10,background:"rgba(255,255,255,0.05)",
                  border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,
                  color:"#b8b8cc",fontSize:11,padding:"5px 8px",cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif",outline:"none"}}>
                {lists.map(l => <option key={l.id} value={l.id} style={{background:"#18181c"}}>{l.displayName}</option>)}
              </select>
            )}
            {loading && <Skel n={3}/>}
            {!loading && (
              <div>
                {demo && <DemoBadge/>}
                {tasks.length === 0 && (
                  <div style={{paddingTop:10,fontSize:11,color:"#2a2a34",textAlign:"center"}}>Aucune tâche en cours ✓</div>
                )}
                {tasks.map((task, i) => (
                  <div key={task.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
                    borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none"}}>
                    <button onClick={()=>complete(task.id)} title="Mark complete"
                      style={{width:16,height:16,borderRadius:"50%",border:"1.5px solid #333",background:"none",
                        cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center",
                        transition:"border-color 0.15s,background 0.15s"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor="#2564cf";e.currentTarget.style.background="rgba(37,100,207,0.15)";}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor="#333";e.currentTarget.style.background="none";}}>
                    </button>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:"#dcdcec",lineHeight:1.35}}>{task.title}</div>
                    </div>
                    <div style={{width:5,height:5,borderRadius:"50%",background:importanceColor(task.importance),flexShrink:0}}/>
                  </div>
                ))}
                {tasks.length > 0 && <div style={{fontSize:9,color:"#222228",marginTop:10}}>{tasks.length} tâche{tasks.length>1?"s":""} · {activeList?.displayName||''}</div>}
                <form onSubmit={addTask} style={{display:"flex",gap:6,marginTop:10}}>
                  <input value={newTitle} onChange={e=>setNewTitle(e.target.value)}
                    placeholder="Nouvelle tâche…"
                    style={{...C.inp,flex:1,fontSize:11,padding:"5px 8px"}}/>
                  {newTitle.trim() && <button type="submit" style={{...C.btn,padding:"5px 10px",fontSize:13,lineHeight:1}}>+</button>}
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

export { AgendaWidget, MailWidget, TodoWidget };
