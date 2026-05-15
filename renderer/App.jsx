import { useState, useEffect, useRef, useCallback, useMemo } from "react";

function hexToRgb(hex) {
  const h = hex.replace('#','')
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`
}

// ── API endpoints ────────────────────────────────────────────────────────────
const PROXY1   = "https://api.allorigins.win/raw?url=";
const PROXY2   = "https://api.rss2json.com/v1/api.json?rss_url=";
const METEO    = "https://api.open-meteo.com/v1/forecast";
const FINNHUB  = "https://finnhub.io/api/v1";
const TOMTOM   = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json";
const YF_QUOTE = (sym) => PROXY1 + encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`);

// ── Storage keys ─────────────────────────────────────────────────────────────
const SK_CONFIG   = "wp-config";
const SK_COLW     = "wp-col-widths";
const SK_EXPANDED = "wp-expanded";
const SK_MS_CLIENT = "wp-ms-client";
const SK_MS_TOKENS = "wp-ms-tokens";

// ── Palette & system widget defs ─────────────────────────────────────────────
const PALETTE = ["#4f8ef7","#5cc8a8","#b07ef7","#f7a64f","#f74f7e","#4ff7c8","#f7f74f","#c8f74f"];
const SYS = [
  { id:"weather", label:"Prévisions",       note:"Open-Meteo · no key",           color:"#f7c94f" },
  { id:"traffic", label:"Circulation",      note:"TomTom · free key",             color:"#f77f4f" },
  { id:"stocks",  label:"Marchés",          note:"Finnhub · free key",            color:"#5cc8a8" },
  { id:"calendar",label:"Calendrier",       note:"No API needed",                 color:"#9c27b0" },
  { id:"clock",   label:"Horloge",          note:"No API needed",                 color:"#e8e8f0" },
  { id:"agenda",  label:"Outlook Agenda",   note:"Microsoft Graph · OAuth",       color:"#0078d4" },
  { id:"mail",    label:"Outlook Mail",     note:"Microsoft Graph · OAuth",       color:"#0078d4" },
  { id:"todo",    label:"Microsoft To-Do",  note:"Microsoft Graph · OAuth",       color:"#2564cf" },
  { id:"camera",  label:"Caméra",           note:"Security Center · local",       color:"#5e8af5" },
  { id:"euronews",label:"Euronews",          note:"HLS · Antik",                   color:"#1e4ba8" },
];

const EURONEWS_HLS_URL = 'https://dash4.antik.sk/live/test_euronews/playlist.m3u8';
const HLS_JS_URL       = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';

const CAMERA_BASE_URL    = "https://securitycenter.local:8082";
const CAMERA_SDK_URL     = `${CAMERA_BASE_URL}/XPMobileSDK/XPMobileSDK.js`;
const CAMERA_ID          = "11ae9771-dcc4-430b-b47c-20caa6175566";
const CAMERA_NAME_HINT   = "HikVision";  // substring of the desired camera name

const PRESSREADER_URL = "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog/featured";

const DEFAULT_TV_SYMBOLS = [
  {s:'AMEX:GLD',   d:'Gold ETF'},
  {s:'NASDAQ:NVDA',d:'NVIDIA'},
  {s:'NASDAQ:IBIT',d:'Bitcoin ETF'},
  {s:'NASDAQ:MSFT',d:'Microsoft'},
  {s:'NASDAQ:GOOG',d:'Alphabet'},
  {s:'AMEX:VOO',   d:'S&P 500 ETF'},
  {s:'NASDAQ:BOTZ',d:'Robotics & AI ETF'},
  {s:'NASDAQ:SMCI',d:'Super Micro'},
  {s:'NASDAQ:AAPL',d:'Apple'},
  {s:'NASDAQ:INTC',d:'Intel'},
  {s:'NASDAQ:AMD', d:'AMD'},
];

// Built-in "Marchés" overview — replaces TV's default "Liste de surveillance"
// tab. `s` is the TradingView symbol (used for the click-through to TV's chart);
// `y` is the Yahoo Finance symbol (used for the quote/sparkline fetch). When
// `y` is absent we fall back to the part after the colon in `s`.
const MARKETS_OVERVIEW_LIST = {
  id:   'wp-markets-overview',
  name: 'Marchés',
  symbols: [
    {s:'SP:SPX',        y:'^GSPC',   d:'S&P 500'},
    {s:'DJ:DJI',        y:'^DJI',    d:'Dow Jones'},
    {s:'NASDAQ:IXIC',   y:'^IXIC',   d:'NASDAQ Composite'},
    {s:'TVC:NI225',     y:'^N225',   d:'Nikkei 225'},
    {s:'TVC:UKX',       y:'^FTSE',   d:'FTSE 100'},
    {s:'XETR:DAX',      y:'^GDAXI',  d:'DAX'},
    {s:'EURONEXT:PX1',  y:'^FCHI',   d:'CAC 40'},
    {s:'TSX:TSX',       y:'^GSPTSE', d:'S&P/TSX Composite'},
  ],
};

// Bloomberg Live — third tab in the Marchés card. bloomberg.com/live/us is
// paywalled, and Bloomberg disables iframe embed on their YouTube live stream
// (error 153). Workaround: load the full /watch?v= page and let the
// VideoEmbed isolation script find the <video> and hide the YouTube chrome
// (header, sidebar, recommendations, comments). The video ID is Bloomberg
// Television's permanent 24/7 stream — if it rotates, fetch a fresh one from
// https://www.youtube.com/channel/UCIALMKvObZNtJ6AmdCLP7Lg/live.
const BLOOMBERG_LIVE_TAB = {
  id:      'wp-bloomberg-live',
  name:    'Bloomberg Live',
  kind:    'video',
  url:     'https://www.youtube.com/watch?v=iEpJwprxDdk',
  isolate: true,
};

// Finviz sector heatmap — interactive treemap of US sectors. Loaded in a
// dedicated webview partition so its cookies/state don't share with
// Bloomberg's YouTube partition.
const FINVIZ_HEATMAP_TAB = {
  id:   'wp-finviz-heatmap',
  name: 'Heatmap',
  kind: 'heatmap',
  url:  'https://finviz.com/map?t=sec',
};

// ── Mock fallback data ───────────────────────────────────────────────────────
const MOCK_NEWS = [
  { id:"1", title:"RISC-V chips are closing the gap with x86 in datacenter benchmarks",   source:"arstechnica.com", link:"#", time:"12m", image:null },
  { id:"2", title:"Firefox 127 ships with improved memory isolation on Windows",           source:"theregister.com", link:"#", time:"34m", image:null },
  { id:"3", title:"EU regulators open formal probe into Microsoft AI bundling practices",  source:"reuters.com",     link:"#", time:"1h",  image:null },
  { id:"4", title:"Apple acquires UK startup behind on-device LLM inference engine",       source:"ft.com",          link:"#", time:"2h",  image:null },
  { id:"5", title:"Nvidia Blackwell supply ramp expected to ease H200 constraints in Q3",  source:"tomshardware.com",link:"#", time:"3h",  image:null },
];
const MOCK_NEWS_FR = [
  { id:"f1", title:"Le gouvernement Legault dépose son budget 2025 avec surplus de 1,2 G$", source:"lapresse.ca",     link:"#", time:"5m",  image:null },
  { id:"f2", title:"Québec annonce 800 nouveaux logements sociaux dans la région de Québec",source:"radio-canada.ca", link:"#", time:"28m", image:null },
  { id:"f3", title:"Pont de Québec : les travaux de réfection majeures débutent cet été",   source:"lesoleil.com",    link:"#", time:"1h",  image:null },
  { id:"f4", title:"Feux de forêt : alerte préventive levée pour la Côte-Nord",             source:"tvanouvelles.ca", link:"#", time:"2h",  image:null },
  { id:"f5", title:"Le Canadien repêche en 5e position au prochain repêchage LNH",          source:"rds.ca",          link:"#", time:"3h",  image:null },
];
const MOCK_WX = {
  current:{ temperature_2m:7, apparent_temperature:3, weather_code:2, wind_speed_10m:19, relative_humidity_2m:68 },
  hourly:{
    time: Array.from({length:24},(_,i)=>{ const d=new Date(); d.setHours(d.getHours()+i,0,0,0); return d.toISOString(); }),
    temperature_2m:[7,8,9,9,8,6,5,4,4,5,7,9,10,10,9,8,6,5,4,3,3,3,3,4],
    weather_code:  [2,1,1,1,2,61,61,63,63,61,2,1,1,2,2,61,61,63,3,3,3,2,2,2],
  },
  daily:{
    time: Array.from({length:5},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return d.toISOString().slice(0,10); }),
    weather_code:[61,2,1,2,71], temperature_2m_max:[9,14,16,11,8], temperature_2m_min:[2,5,7,4,1],
  },
};
const MOCK_STOCKS  = { AAPL:{c:213.49,pc:211.20,h:214.80}, MSFT:{c:417.72,pc:414.55,h:419.10}, NVDA:{c:875.40,pc:859.20,h:882.00}, SPY:{c:521.30,pc:518.80,h:523.50} };
const MOCK_TRAFFIC = { currentSpeed:72, freeFlowSpeed:100, confidence:0.87 };
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function relTime(str) {
  if (!str) return "";
  const s = (Date.now() - new Date(str)) / 1000;
  if (s < 60)    return Math.floor(s) + "s";
  if (s < 3600)  return Math.floor(s/60) + "m";
  if (s < 86400) return Math.floor(s/3600) + "h";
  return Math.floor(s/86400) + "d";
}
function wmo(code) {
  if (code===0) return ["Clear","☀️"]; if (code<=2) return ["Partly cloudy","⛅"];
  if (code===3) return ["Overcast","☁️"]; if (code<=49) return ["Foggy","🌫"];
  if (code<=59) return ["Drizzle","🌦"]; if (code<=69) return ["Rain","🌧"];
  if (code<=79) return ["Snow","❄️"];    if (code<=84) return ["Showers","🌧"];
  if (code<=94) return ["Thunderstorm","⛈"]; return ["Storm","🌩"];
}
function catColor(label, idx) {
  const l=(label||"").toLowerCase();
  if (l.includes("tech"))                      return "#4f8ef7";
  if (l.includes("world")||l.includes("news")) return "#5cc8a8";
  if (l.includes("actual")||l.includes("info")||l.includes("nouv")) return "#5cc8a8";
  if (l.includes("sci"))  return "#b07ef7";
  if (l.includes("sport")) return "#f77f4f";
  if (l.includes("fin")||l.includes("busi"))   return "#f7c94f";
  if (l.includes("ai")||l.includes("ml"))      return "#f74f7e";
  return PALETTE[idx%PALETTE.length];
}
function mockForCategory(label) {
  const l=(label||"").toLowerCase();
  return (l.includes("actual")||l.includes("nouv")||l.includes("info")) ? MOCK_NEWS_FR : MOCK_NEWS;
}
function parseOPML(xml) {
  const doc=new DOMParser().parseFromString(xml,"text/xml"), cats={};
  Array.from(doc.querySelectorAll("body > outline")).forEach(top => {
    const children=Array.from(top.querySelectorAll("outline[xmlUrl]"));
    if (!children.length) {
      const url=top.getAttribute("xmlUrl");
      if (url) { if (!cats["Uncategorized"]) cats["Uncategorized"]={label:"Uncategorized",feeds:[]}; cats["Uncategorized"].feeds.push({url,title:top.getAttribute("title")||url}); }
      return;
    }
    const label=top.getAttribute("title")||top.getAttribute("text")||"Category";
    if (!cats[label]) cats[label]={label,feeds:[]};
    children.forEach(f=>{ const url=f.getAttribute("xmlUrl"); if (url) cats[label].feeds.push({url,title:f.getAttribute("title")||url}); });
  });
  return Object.values(cats);
}

// Extract thumbnail from a feed item element — checks enclosure, media:thumbnail, media:content
function extractImage(it) {
  // <enclosure url="..." type="image/..."/>
  const enc = it.querySelector("enclosure");
  if (enc && enc.getAttribute("type")?.startsWith("image")) {
    const u = enc.getAttribute("url"); if (u) return u;
  }
  // <media:thumbnail url="..."/> or plain <thumbnail url="..."/>
  for (const tag of ["thumbnail","content"]) {
    // querySelectorAll can't use colons; try both qualified and local name
    const els = Array.from(it.getElementsByTagName("media:" + tag))
      .concat(Array.from(it.getElementsByTagName(tag)));
    for (const el of els) {
      const u = el.getAttribute("url");
      const med = el.getAttribute("medium") || "";
      if (u && (med === "image" || tag === "thumbnail")) return u;
    }
  }
  // Try <image><url>...</url></image> inside the item
  const imgEl = it.querySelector("image url");
  if (imgEl?.textContent) return imgEl.textContent.trim() || null;
  return null;
}

function parseXML(xml) {
  const doc=new DOMParser().parseFromString(xml,"text/xml");
  return Array.from(doc.querySelectorAll("item, entry")).map(it=>{
    const get=tag=>it.querySelector(tag)?.textContent?.trim()||"";
    const link=it.querySelector("link[href]")?.getAttribute("href")||it.querySelector("link")?.textContent?.trim()||get("guid");
    const image = extractImage(it);
    const pubDate = get("pubDate")||get("published")||get("updated");
    return { id:get("guid")||link, title:get("title"), link, image,
      source:(()=>{try{return new URL(link).hostname.replace("www.","");}catch{return "";}})(),
      time:relTime(pubDate), _pubDate:pubDate };
  }).filter(it=>it.title&&it.link);
}
async function fetchRSS(url) {
  // Cache-buster injected into the TARGET url so proxies are forced to re-fetch
  const bucket = Math.floor(Date.now() / 300000); // rotates every 5 min
  const cbUrl = url + (url.includes('?') ? '&' : '?') + `_cb=${bucket}`;
  try { const res=await window.electronAPI.rss.fetch(url); if(res?.ok){const items=parseXML(res.text).slice(0,7);if(items.length)return items;} } catch {}
  try { const r=await fetch(PROXY1+encodeURIComponent(cbUrl)); if(r.ok){const items=parseXML(await r.text()).slice(0,7);if(items.length)return items;} } catch {}
  try { const r=await fetch(PROXY2+encodeURIComponent(cbUrl)+"&count=6"); const d=await r.json(); if(d.status==="ok") return d.items.map(it=>({id:it.guid||it.link,title:it.title,link:it.link,image:it.thumbnail||it.enclosure?.link||null,source:(()=>{try{return new URL(it.link).hostname.replace("www.","");}catch{return "";}})(),time:relTime(it.pubDate)})); } catch {}
  try { const r=await fetch("https://corsproxy.io/?"+encodeURIComponent(cbUrl)); if(r.ok){const items=parseXML(await r.text()).slice(0,7);if(items.length)return items;} } catch {}
  return null;
}

// ── Yahoo Finance fallback ───────────────────────────────────────────────────
async function fetchYahooQuote(sym) {
  try {
    const r = await fetch(YF_QUOTE(sym));
    if (!r.ok) return null;
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return { c: meta.regularMarketPrice, pc: meta.chartPreviousClose || meta.previousClose, h: meta.regularMarketDayHigh };
  } catch { return null; }
}

// ── Persistent storage ───────────────────────────────────────────────────────
const api = window.electronAPI;
async function storageSave(data) {
  try { await api.store.set(SK_CONFIG, JSON.stringify(data)); } catch {}
}
async function storageLoad() {
  try { const r = await api.store.get(SK_CONFIG); return r ? JSON.parse(r) : null; } catch { return null; }
}

// ── Styles ───────────────────────────────────────────────────────────────────
const C = {
  card:  { background:"var(--card-bg,rgba(38,40,50,1))", borderRadius:12, border:"1px solid rgba(255,255,255,0.06)", overflow:"hidden" },
  title: { fontSize:11, fontWeight:500, color:"#d0d0e0", textTransform:"uppercase", letterSpacing:0.9 },
  dot:   { width:6, height:6, borderRadius:"50%", flexShrink:0, display:"inline-block" },
  badge: { fontSize:10, padding:"1px 6px", borderRadius:4, fontWeight:500 },
  chev:  { color:"#dcdcec", fontSize:16, lineHeight:1, display:"inline-block", flexShrink:0, transition:"transform 0.2s" },
  inp:   { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:8, padding:"7px 10px", color:"#e4e4f4", fontSize:12, outline:"none", fontFamily:"'DM Sans',sans-serif" },
  btn:   { background:"color-mix(in srgb, var(--accent) 15%, transparent)", border:"1px solid color-mix(in srgb, var(--accent) 30%, transparent)", borderRadius:8, color:"var(--accent)", fontSize:12, padding:"7px 14px", cursor:"pointer", fontWeight:500, fontFamily:"'DM Sans',sans-serif" },
  skel:  w=>({ height:10, borderRadius:4, background:"rgba(255,255,255,0.05)", width:w+"%", animation:"pulse 1.5s ease infinite", marginBottom:8 }),
};

function DemoBadge() {
  return <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:"rgba(255,255,255,0.06)", color:"#c4c4d4", fontFamily:"DM Mono,monospace", marginLeft:4 }}>demo</span>;
}


// ── Card shell ───────────────────────────────────────────────────────────────
function Shell({ color, title, sub, badge, expanded, onToggle, isDragging, onDragStart, onDragEnd, lastUpdated, transparent, children }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const ageLabel = (() => {
    if (!lastUpdated) return null;
    const mins = Math.floor((now - lastUpdated) / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h`;
  })();

  return (
    <div style={{ ...C.card, ...(transparent ? { background:'transparent', border:'1px solid rgba(255,255,255,0.08)' } : {}), opacity: isDragging ? 0.35 : 1, transition:"opacity 0.1s" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", cursor:"pointer", userSelect:"none" }} onClick={onToggle}>
        <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
          <span
            draggable
            onDragStart={e=>{ e.stopPropagation(); onDragStart?.(); }}
            onDragEnd={()=>onDragEnd?.()}
            onClick={e=>e.stopPropagation()}
            title="Drag to reorder"
            style={{ color:"#c4c4d4", fontSize:11, cursor:"grab", userSelect:"none", flexShrink:0, lineHeight:1, padding:"0 4px 0 0" }}>⠿</span>
          <span style={{ ...C.dot, background:color }} />
          <span style={C.title}>{title}</span>
          {sub && <span style={{ fontSize:10, color:"#c4c4d4", fontFamily:"DM Mono,monospace" }}>{sub}</span>}
          {badge}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }} onClick={e=>e.stopPropagation()}>
          {ageLabel && <span style={{ fontSize:9, color:"#2a2a38", fontFamily:"DM Mono,monospace" }}>{ageLabel}</span>}
          <span style={{ ...C.chev, transform:expanded?"rotate(90deg)":"rotate(0deg)" }} onClick={onToggle}>›</span>
        </div>
      </div>
      {expanded && <div style={{ padding:"0 14px 12px" }}>{children}</div>}
    </div>
  );
}

function Skel({ n=3 }) {
  return (
    <div style={{ paddingTop:8 }}>
      {Array.from({length:n}).map((_,i)=>(
        <div key={i}><div style={C.skel(52+(i*17)%36)}/><div style={{...C.skel(26),height:8,marginBottom:12}}/></div>
      ))}
    </div>
  );
}

// ── News widget ──────────────────────────────────────────────────────────────
function NewsWidget({ category, colorIdx, onUnreadChange, onOpenUrl }) {
  const color=catColor(category.label,colorIdx);
  const [items,setItems]=useState([]);
  const [demo,setDemo]=useState(false);
  const [status,setStatus]=useState("loading");
  const [readIds,setReadIds]=useState(new Set());
  const [lastUpdated,setLastUpdated]=useState(null);
  const unread=items.filter(i=>!readIds.has(i.id)).length;

  useEffect(()=>{ onUnreadChange?.(unread); },[unread]);

  useEffect(()=>{
    if (!category.feeds?.length){setItems(mockForCategory(category.label));setDemo(true);setStatus("ok");setLastUpdated(Date.now());return;}
    const doFetch = () => {
      setStatus("loading");
      // Try all feeds in parallel; filter to articles <30 days old; sort newest first
      Promise.all(category.feeds.map(f=>fetchRSS(f.url)))
        .then(results=>{
          const cutoff = Date.now() - 30 * 86400000;
          const live = results.flat().filter(Boolean)
            .filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i)
            .filter(v=>{ const d=new Date(v._pubDate); return !v._pubDate||isNaN(d)||d.getTime()>cutoff; })
            .sort((a,b)=>new Date(b._pubDate||0)-new Date(a._pubDate||0))
            .slice(0,7);
          if(live.length){setItems(live);setDemo(false);setStatus("ok");setLastUpdated(Date.now());}
          else{setItems(mockForCategory(category.label));setDemo(true);setStatus("ok");setLastUpdated(Date.now());}
        }).catch(()=>{setItems(mockForCategory(category.label));setDemo(true);setStatus("ok");setLastUpdated(Date.now());});
    };
    doFetch();
    const t = setInterval(doFetch, 30 * 60 * 1000); // refresh every 30 min
    return () => clearInterval(t);
  },[category.label]);

  const badgeEl=status==="loading"
    ?<span style={{fontSize:10,color:"#c4c4d4"}}>fetching…</span>
    :(status==="ok"&&unread>0&&!demo)?<span style={{...C.badge,background:color+"22",color}}>{unread}</span>:null;

  return { color, title:category.label, lastUpdated, badge:badgeEl,
    content:(
      <div>
        {status==="loading"&&<Skel/>}
        {status==="ok"&&<div>{demo&&<DemoBadge/>}{items.map((item,i)=>(
          <div key={item.id} style={{padding:"8px 0",cursor:"pointer",opacity:readIds.has(item.id)?0.35:1,borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none"}}
            onClick={()=>{
              setReadIds(p=>new Set([...p,item.id]));
              if(item.link&&item.link!=="#") onOpenUrl?.(item.link);
            }}>
            <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
              {item.image&&(
                <img src={item.image} loading="lazy" alt=""
                  style={{width:44,height:44,borderRadius:6,objectFit:"cover",flexShrink:0,background:"rgba(255,255,255,0.05)"}}
                  onError={e=>{e.target.style.display="none";}}/>
              )}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:"#d8d8e8",lineHeight:1.45,marginBottom:4}}>{item.title}</div>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:10,color:"#666"}}>{item.source}</span>
                  <span style={{fontSize:10,color:"#dcdcec",fontFamily:"DM Mono,monospace"}}>{item.time}</span>
                </div>
              </div>
            </div>
          </div>
        ))}</div>}
      </div>
    )
  };
}

// ── Weather widget ───────────────────────────────────────────────────────────
const DEFAULT_LOC = { name: "Lévis, QC", lat: 46.8123, lon: -71.1756, timezone: "America/Toronto" };

function WeatherWidget({ location = DEFAULT_LOC }) {
  const [wx,setWx]=useState(null);
  const [demo,setDemo]=useState(false);
  const [status,setStatus]=useState("loading");
  const [lastUpdated,setLastUpdated]=useState(null);

  useEffect(()=>{
    const url=METEO+`?latitude=${location.lat}&longitude=${location.lon}`
      +"&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
      +"&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min"
      +`&timezone=${encodeURIComponent(location.timezone)}&forecast_days=5`;
    setStatus("loading");
    const doFetch = () => {
      fetch(url).then(r=>r.ok?r.json():Promise.reject()).then(d=>{setWx(d);setDemo(false);setStatus("ok");setLastUpdated(Date.now());})
        .catch(()=>fetch(PROXY1+encodeURIComponent(url)).then(r=>r.json()).then(d=>{setWx(d);setDemo(false);setStatus("ok");setLastUpdated(Date.now());})
          .catch(()=>{setWx(MOCK_WX);setDemo(true);setStatus("ok");setLastUpdated(Date.now());}));
    };
    doFetch();
    const t = setInterval(doFetch, 30 * 60 * 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.lat, location.lon, location.timezone]);

  const cur=wx?.current, daily=wx?.daily, hourly=wx?.hourly;
  const nowIdx=hourly?Math.max(0,hourly.time.findIndex(t=>new Date(t)>new Date())-1):0;
  const [cond,icon]=cur?wmo(cur.weather_code):["","⛅"];

  return { color:"#f7c94f", title:"Prévisions", sub:location.name, lastUpdated,
    content:(
      <div>
        {status==="loading"&&<Skel n={2}/>}
        {status==="ok"&&cur&&(
          <div>
            {demo&&<DemoBadge/>}
            <div style={{display:"flex",alignItems:"flex-end",gap:12,padding:"4px 0 12px"}}>
              <span style={{fontSize:36,lineHeight:1}}>{icon}</span>
              <div>
                <div style={{fontSize:32,fontWeight:300,color:"#f0f0f0",letterSpacing:-1,lineHeight:1}}>{Math.round(cur.temperature_2m)}°</div>
                <div style={{fontSize:11,color:"#d0d0e0",marginTop:2}}>{cond} · feels {Math.round(cur.apparent_temperature)}°</div>
              </div>
              <div style={{marginLeft:"auto",textAlign:"right"}}>
                <div style={{fontSize:11,color:"#c4c4d4"}}>Humidity <span style={{color:"#777"}}>{cur.relative_humidity_2m}%</span></div>
                <div style={{fontSize:11,color:"#c4c4d4",marginTop:2}}>Wind <span style={{color:"#777"}}>{Math.round(cur.wind_speed_10m)} km/h</span></div>
              </div>
            </div>
            {hourly&&(
              <div style={{display:"flex",gap:2,paddingBottom:8,borderBottom:"1px solid rgba(255,255,255,0.05)",overflowX:"auto"}}>
                {hourly.time.slice(nowIdx,nowIdx+6).map((t,i)=>{
                  const [,ic]=wmo(hourly.weather_code[nowIdx+i]);
                  return(
                    <div key={t} style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"5px 9px",borderRadius:8,background:i===0?"rgba(247,201,79,0.1)":"transparent"}}>
                      <span style={{fontSize:10,color:i===0?"#f7c94f":"#aaa"}}>{i===0?"Now":new Date(t).toLocaleTimeString("fr-CA",{hour:"2-digit",minute:"2-digit"})}</span>
                      <span style={{fontSize:14}}>{ic}</span>
                      <span style={{fontSize:11,color:"#d0d0e0"}}>{Math.round(hourly.temperature_2m[nowIdx+i])}°</span>
                    </div>
                  );
                })}
              </div>
            )}
            {daily&&(
              <div style={{paddingTop:8}}>
                {daily.time.map((t,i)=>{
                  const [,ic]=wmo(daily.weather_code[i]);
                  const lbl=i===0?"Today":new Date(t+"T12:00").toLocaleDateString("fr-CA",{weekday:"short"});
                  return(
                    <div key={t} style={{display:"flex",alignItems:"center",padding:"4px 0",borderBottom:i<daily.time.length-1?"1px solid rgba(255,255,255,0.04)":"none"}}>
                      <span style={{fontSize:12,color:"#d0d0e0",width:44,textTransform:"capitalize"}}>{lbl}</span>
                      <span style={{fontSize:13,marginRight:8}}>{ic}</span>
                      <div style={{flex:1,display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                        <span style={{fontSize:12,color:"#c4c4d4"}}>{Math.round(daily.temperature_2m_min[i])}°</span>
                        <div style={{height:3,borderRadius:2,background:"linear-gradient(90deg,#4f8ef7,#f7c94f)",width:38,opacity:0.3}}/>
                        <span style={{fontSize:12,color:"#dcdcec"}}>{Math.round(daily.temperature_2m_max[i])}°</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

// ── TradingView watchlist widget ──────────────────────────────────────────────
function TickerAvatar({ ticker, size=52 }) {
  const COLORS = ['#26a69a','#ef5350','#42a5f5','#ffa726','#ab47bc','#ff7043','#5cc8a8','#78909c'];
  let h = 0; for (const c of ticker) h = (h*31 + c.charCodeAt(0)) & 0x7fffffff;
  const [imgOk, setImgOk] = useState(true);
  return (
    <div style={{width:size,height:size,borderRadius:'50%',flexShrink:0,overflow:'hidden',
      background:imgOk?'#16161c':COLORS[h%COLORS.length],
      display:'flex',alignItems:'center',justifyContent:'center',
      fontSize:Math.round(size*0.38),fontWeight:700,color:'#fff'}}>
      {imgOk
        ? <img src={`https://assets.parqet.com/logos/symbol/${ticker}?format=png`}
            alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}
            onError={()=>setImgOk(false)}/>
        : ticker[0]
      }
    </div>
  );
}

// Embed an Electron <webview> for a video page. When the URL is a clean
// embed (e.g., youtube.com/embed/...) the whole page IS the player — no
// isolation needed. For a full news page like bloomberg.com/live, pass
// `isolate` to inject a script that hides the page chrome around <video>.
function VideoEmbed({ url, storeKey = 'wp-video-embed-height', isolate = false, partition = 'persist:bloomberg' }) {
  const wvRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(320);

  // Load persisted height.
  useEffect(() => {
    api.store.get(storeKey).then(v => {
      const h = parseInt(v || '0');
      if (h >= 160) setCardHeight(h);
    });
  }, [storeKey]);

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(160, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set(storeKey, String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !isolate) return;

    // YouTube is a React SPA that re-renders aggressively. DOM-mutation
    // isolation fights React and ends up blinking-then-blanking. Targeted
    // CSS injection sidesteps the conflict because it doesn't touch the
    // DOM — React happily re-renders elements that are still display:none
    // because of our stylesheet.
    const isYouTube = /(^|\.)youtube\.com$/i.test(new URL(url).hostname);
    const isFinviz  = /(^|\.)finviz\.com$/i.test(new URL(url).hostname);
    const youtubeCSS = `
      /* Neutralize containing-block triggers on YouTube's layout containers,
         otherwise our position:fixed on #player ends up relative to whichever
         transformed ancestor wraps it (which is animated -> black flash). */
      ytd-app, ytd-page-manager, ytd-watch-flexy, ytd-watch-flexy #primary,
      #primary, #primary-inner, #columns, #content, #page-manager {
        transform:none!important; filter:none!important;
        perspective:none!important; contain:none!important;
        will-change:auto!important; clip-path:none!important;
        overflow:visible!important;
      }
      /* Hide everything around the player. */
      ytd-masthead, #masthead-container, #masthead,
      ytd-mini-guide-renderer, tp-yt-app-drawer, ytd-guide-renderer,
      #secondary, #related, #comments, #chat, #chat-container,
      ytd-watch-metadata, #below, #info, #info-contents, #meta, #meta-contents,
      #top-row, #bottom-row, #description, #description-inline-expander,
      ytd-merch-shelf-renderer, ytd-popup-container, ytd-toast,
      ytd-engagement-panel-section-list-renderer,
      ytd-live-chat-frame, .ytp-pause-overlay, .ytp-ce-element, .ytp-endscreen-content,
      ytd-watch-next-secondary-results-renderer,
      ytd-comments, ytd-comments-header-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-banner-promo-renderer,
      ytd-mealbar-promo-renderer,
      ytd-consent-bump-v2-lightbox { display:none!important; }
      html, body, ytd-app, ytd-page-manager, ytd-watch-flexy, #primary, #primary-inner {
        background:#000!important; overflow:hidden!important;
        margin:0!important; padding:0!important;
        width:100vw!important; height:100vh!important;
        max-width:none!important; max-height:none!important;
      }
      /* Stretch every plausible player wrapper to viewport. Multiple
         selectors because YouTube swaps between layouts (theater, default,
         minimized) and class names change with A/B tests. */
      #player, #player-container, #player-container-outer, #player-container-inner,
      #player-theater-container, #player-full-bleed-container,
      #player.ytd-watch-flexy, #player-wide-container,
      ytd-player, .html5-video-player, #movie_player {
        position:fixed!important; top:0!important; left:0!important;
        right:0!important; bottom:0!important;
        width:100vw!important; height:100vh!important;
        max-width:none!important; max-height:none!important;
        min-width:0!important; min-height:0!important;
        z-index:2147483647!important; background:#000!important;
      }
      .html5-video-container { width:100%!important; height:100%!important; }
      video.html5-main-video, video {
        width:100%!important; height:100%!important;
        object-fit:contain!important; background:#000!important;
      }
    `;
    // Diagnostic dump 5s after the page loads — if it stays black we can
    // tell why (no <video>, transformed ancestor, hidden #player, etc.).
    const diagJS = `
      (function () {
        setTimeout(function () {
          var v = document.querySelector('video');
          var p = document.querySelector('#player');
          var pcs = p && getComputedStyle(p);
          var vcs = v && getComputedStyle(v);
          console.log('[wp-yt] diag: video=' + !!v +
            ' #player=' + !!p +
            (p ? ' playerDisplay=' + pcs.display + ' playerPosition=' + pcs.position : '') +
            (v ? ' videoDisplay=' + vcs.display + ' videoSize=' +
                Math.round(v.getBoundingClientRect().width) + 'x' +
                Math.round(v.getBoundingClientRect().height) +
                ' videoReady=' + v.readyState +
                ' videoPaused=' + v.paused : ''));
        }, 5000);
      })();
    `;
    if (isYouTube) {
      const apply = () => {
        try { wv.insertCSS(youtubeCSS); } catch {}
      };
      const onReady = () => {
        apply();
        try { wv.executeJavaScript(diagJS, true); } catch {}
        // Re-apply on a few delayed ticks — handles late-rendered states
        // (preroll ad finishes, layout flips, etc.).
        setTimeout(apply, 1500);
        setTimeout(apply, 4000);
        setTimeout(apply, 10000);
      };
      wv.addEventListener('dom-ready', onReady);
      wv.addEventListener('did-finish-load', apply);
      wv.addEventListener('did-navigate', apply);
      wv.addEventListener('did-navigate-in-page', apply);
      return () => {
        wv.removeEventListener('dom-ready', onReady);
        wv.removeEventListener('did-finish-load', apply);
        wv.removeEventListener('did-navigate', apply);
        wv.removeEventListener('did-navigate-in-page', apply);
      };
    }

    // Finviz heatmap — DOM manipulation kept losing the battle (Finviz reverts
    // our style changes via re-render). New strategy: don't touch the page at
    // all. Render the webview at a fixed large size (Finviz expects a "desktop"
    // layout), report .content.map's position back to React, and crop+scale the
    // webview itself with CSS transform — Finviz can't undo what's outside its
    // own page.
    if (isFinviz) {
      const finvizJS = `
        (function () {
          if (window.__wpFinvizV10) return;
          window.__wpFinvizV10 = true;
          // Direct selector — earlier diagnostic confirmed the treemap is a
          // <canvas class="chart initialized"> inside #canvas-wrapper.
          function findHeatmap() {
            return document.querySelector('canvas.chart.initialized')
                || document.querySelector('canvas.chart')
                || document.querySelector('#canvas-wrapper canvas')
                || document.querySelector('#canvas-wrapper')
                || document.querySelector('.content.map');
          }
          var lastRect = '';
          function report() {
            var hm = findHeatmap();
            if (!hm) return;
            var r = hm.getBoundingClientRect();
            if (r.width < 50 || r.height < 50) return;
            var x = Math.round(r.left + window.scrollX);
            var y = Math.round(r.top  + window.scrollY);
            var w = Math.round(r.width);
            var h = Math.round(r.height);
            var key = x + ',' + y + ',' + w + ',' + h;
            if (key === lastRect) return;  // coalesce — don't spam if unchanged
            lastRect = key;
            console.log('[wp-finviz-rect] x=' + x + ' y=' + y + ' w=' + w + ' h=' + h);
          }
          // Initial + a few retries while Finviz lays out, then stop the
          // interval. Resize listener handles later size changes. No more
          // recursive descent — direct selector is fast and quiet.
          report();
          var tries = 0;
          var iv = setInterval(function () {
            tries++; report();
            if (tries > 10) clearInterval(iv);  // 10s ceiling
          }, 1000);
          window.addEventListener('resize', report);
        })();
      `;
      const apply = () => {
        try { wv.executeJavaScript(finvizJS, true); } catch {}
      };
      const onConsole = (e) => {
        if (typeof e.message !== 'string') return;
        if (e.message.startsWith('[wp-finviz-rect]')) {
          // Parse "x=N y=N w=N h=N" and store on the webview element.
          var m = e.message.match(/x=(-?\d+) y=(-?\d+) w=(\d+) h=(\d+)/);
          if (m) {
            // Switch the webview to fixed 1280×900 the first time we receive
            // coords — load already succeeded so resizing now won't abort it.
            wv.style.width  = '1280px';
            wv.style.height = '900px';
            wv.style.display = 'block';
            wv.style.transformOrigin = '0 0';
            wv.dataset.hmX = m[1];
            wv.dataset.hmY = m[2];
            wv.dataset.hmW = m[3];
            wv.dataset.hmH = m[4];
            applyClip();
          }
        } else if (e.message.startsWith('[wp-finviz]')) {
          console.log('[finviz webview]', e.message);
        }
      };
      // Compute and apply the CSS transform on the webview itself so only the
      // heatmap area is visible in the wrapper. Wrapper sits at cardHeight,
      // overflow:hidden; webview oversized; transform translate+scale crops.
      const applyClip = () => {
        const x = parseFloat(wv.dataset.hmX || '0');
        const y = parseFloat(wv.dataset.hmY || '0');
        const w = parseFloat(wv.dataset.hmW || '0');
        const h = parseFloat(wv.dataset.hmH || '0');
        if (!w || !h) return;
        const wrap = wv.parentElement;
        if (!wrap) return;
        const wrapW = wrap.clientWidth || 1;
        const wrapH = wrap.clientHeight || 1;
        const scale = Math.min(wrapW / w, wrapH / h);
        wv.style.transformOrigin = '0 0';
        wv.style.transform = `translate(${-x * scale}px, ${-y * scale}px) scale(${scale})`;
      };
      const onResize = () => applyClip();
      wv.addEventListener('dom-ready', apply);
      wv.addEventListener('did-finish-load', apply);
      wv.addEventListener('did-navigate', apply);
      wv.addEventListener('did-navigate-in-page', apply);
      wv.addEventListener('console-message', onConsole);
      window.addEventListener('resize', onResize);
      return () => {
        wv.removeEventListener('dom-ready', apply);
        wv.removeEventListener('did-finish-load', apply);
        wv.removeEventListener('did-navigate', apply);
        wv.removeEventListener('did-navigate-in-page', apply);
        wv.removeEventListener('console-message', onConsole);
        window.removeEventListener('resize', onResize);
      };
    }

    // Source of the page-side isolation script. Runs inside the webview's
    // origin via wv.executeJavaScript(). Two-phase: first wait for a <video>
    // to exist (handles cookie consent + lazy player init), then neutralize
    // ancestor transforms, hide elements outside the video's ancestor chain,
    // and fullscreen-fix the <video> itself.
    const isolateJS = `
      (function () {
        if (window.__wpIsolating) return;
        window.__wpIsolating = true;

        // Recursive querySelector that descends into open shadow roots AND
        // same-origin iframes.
        function deepQuery(sel, root) {
          root = root || document;
          var hit = root.querySelector ? root.querySelector(sel) : null;
          if (hit) return hit;
          var hosts = root.querySelectorAll ? root.querySelectorAll('*') : [];
          for (var i = 0; i < hosts.length; i++) {
            if (hosts[i].shadowRoot) {
              var deep = deepQuery(sel, hosts[i].shadowRoot);
              if (deep) return deep;
            }
            if (hosts[i].tagName === 'IFRAME') {
              try {
                var doc = hosts[i].contentDocument;
                if (doc) {
                  var ihit = deepQuery(sel, doc);
                  if (ihit) return ihit;
                }
              } catch (e) { /* cross-origin */ }
            }
          }
          return null;
        }

        // Returns the <video> element if reachable, OR the iframe whose
        // (cross-origin) content most likely hosts the player.
        function findVideoOrPlayerFrame() {
          var v = deepQuery('video');
          if (v) { console.log('[wp-bb] found <video>', v); return v; }
          // Cross-origin iframes — can't inspect, target the iframe wrapper.
          var iframes = document.querySelectorAll('iframe');
          var best = null, bestArea = 0;
          for (var i = 0; i < iframes.length; i++) {
            var r = iframes[i].getBoundingClientRect();
            var area = r.width * r.height;
            // Player iframes are video-shaped (>=240x140) and visible.
            if (area > bestArea && r.width >= 240 && r.height >= 140) {
              best = iframes[i]; bestArea = area;
            }
          }
          if (best) console.log('[wp-bb] no <video>, using iframe', best.src, bestArea);
          return best;
        }

        // Heuristic activator: Bloomberg shows a clickable poster image
        // ("Bloomberg Television" overlay) that turns into the live <video>
        // when clicked. Try a few candidates in order of specificity.
        function tryActivate() {
          var candidates = [
            'button[aria-label*="play" i]',
            'button[aria-label*="watch" i]',
            '[class*="WatchLive" i]',
            '[class*="watch-live" i]',
            '[class*="LiveThumb" i]',
            '[class*="VideoPoster" i]',
            '[class*="play-button" i]',
            '[data-component*="live" i]'
          ];
          for (var i = 0; i < candidates.length; i++) {
            var el = deepQuery(candidates[i]);
            if (el) {
              console.log('[wp-bb] activating via', candidates[i], el);
              try { el.click(); return true; } catch (e) { console.warn(e); }
            }
          }
          // Fallback: click the largest image/figure in the viewport — most
          // likely the live thumbnail.
          // Require a real video-shaped rect — the Bloomberg header logo is
          // ~200px wide but only ~30px tall, so filter on height too.
          var imgs = document.querySelectorAll('img, figure, [role="img"], [class*="Thumb" i], [class*="thumb" i]');
          var best = null, bestArea = 0;
          for (var j = 0; j < imgs.length; j++) {
            var r = imgs[j].getBoundingClientRect();
            var area = r.width * r.height;
            if (area > bestArea && r.width >= 240 && r.height >= 140 &&
                r.top >= 0 && r.top < 800) {
              best = imgs[j]; bestArea = area;
            }
          }
          if (best) {
            console.log('[wp-bb] fallback click on largest image', best, bestArea);
            try { best.click(); return true; } catch (e) { console.warn(e); }
          }
          return false;
        }

        var mo = null;
        var loggedOnce = false;
        function isolate() {
          var target = findVideoOrPlayerFrame();
          if (!target) return false;
          if (mo) try { mo.disconnect(); } catch (e) {}
          // 1. Clear transform/filter/perspective on every ancestor — those
          //    properties create a containing block that makes position:fixed
          //    relative to the ancestor instead of the viewport. Without
          //    this, fixing the video doesn't actually fullscreen it.
          var anc = target.parentElement;
          while (anc && anc !== document.documentElement) {
            anc.style.setProperty('transform',   'none', 'important');
            anc.style.setProperty('filter',      'none', 'important');
            anc.style.setProperty('perspective', 'none', 'important');
            anc.style.setProperty('contain',     'none', 'important');
            anc.style.setProperty('will-change', 'auto', 'important');
            anc.style.setProperty('clip-path',   'none', 'important');
            anc.style.setProperty('overflow',    'visible', 'important');
            anc = anc.parentElement;
          }
          // 2. Build a set of all of <video>'s ancestors so we can hide
          //    everything OUTSIDE that chain (top-down).
          var chain = new Set();
          var n = target;
          while (n) { chain.add(n); n = n.parentElement; }
          // 3. Recursively hide every element that isn't in the chain AND
          //    isn't a descendant of the chain (which keeps the video's
          //    controls and overlay visible).
          function hideOutside(parent) {
            Array.prototype.forEach.call(parent.children, function (child) {
              if (chain.has(child)) {
                hideOutside(child); // still in chain — recurse to hide its non-video siblings
              } else if (child !== target) {
                child.style.setProperty('display', 'none', 'important');
              }
            });
          }
          hideOutside(document.body);
          // 4. Fullscreen-fix the <video> element directly.
          if (target.tagName === 'VIDEO') {
            target.style.cssText = 'position:fixed!important;top:0!important;left:0!important;' +
              'right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;' +
              'margin:0!important;padding:0!important;border:0!important;' +
              'object-fit:contain!important;background:#000!important;z-index:2147483647!important;';
            try { target.play && target.play(); } catch (e) {}
          } else if (target.tagName === 'IFRAME') {
            target.style.cssText = 'position:fixed!important;top:0!important;left:0!important;' +
              'right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;' +
              'border:0!important;background:#000!important;z-index:2147483647!important;';
          }
          // 5. Lock document so the page beneath can't scroll.
          document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
          document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
          if (mo) {
            try { mo.observe(document.body, { childList:true, subtree:true }); }
            catch (e) {}
          }
          if (!loggedOnce) {
            console.log('[wp-bb] isolated', target.tagName,
              'bodyChildren=' + document.body.children.length,
              'chainSize=' + chain.size);
            loggedOnce = true;
          }
          return true;
        }

        // Diagnostic dump 5s after script start — tells us if the player is
        // a <video>, an iframe (and from where), or something else entirely.
        setTimeout(function () {
          var ifs = document.querySelectorAll('iframe');
          console.log('[wp-bb] dump: location=' + location.href);
          console.log('[wp-bb] dump: <video> count=' + document.querySelectorAll('video').length);
          console.log('[wp-bb] dump: iframe count=' + ifs.length);
          for (var i = 0; i < ifs.length; i++) {
            var r = ifs[i].getBoundingClientRect();
            console.log('[wp-bb] dump iframe', i,
              (ifs[i].src || '(no src)').slice(0, 120),
              Math.round(r.width) + 'x' + Math.round(r.height));
          }
        }, 5000);

        if (isolate()) return;
        var tries = 0;
        var activated = false;
        var poll = setInterval(function () {
          tries++;
          if (isolate()) { clearInterval(poll); return; }
          // After 1.5s of no <video>, try to programmatically activate the
          // live player. Don't loop activations — one shot per poll cycle.
          if (!activated && tries === 3) {
            activated = tryActivate();
          }
          // After 6s, try activating again in case the first attempt missed.
          if (tries === 12) tryActivate();
          if (tries > 120) clearInterval(poll); // 60s ceiling
        }, 500);

        mo = new MutationObserver(function () { isolate(); });
        try { mo.observe(document.body, { childList:true, subtree:true }); } catch (e) {}
        // Belt-and-suspenders polling: every 2s, force a re-isolate in case
        // the MutationObserver missed a re-render or got disconnected by
        // Bloomberg replacing document.body.
        setInterval(function () { isolate(); }, 2000);
      })();
    `;

    const run = () => { try { wv.executeJavaScript(isolateJS, true); } catch {} };
    // Forward webview console messages so [wp-bb] logs surface in the panel's
    // own devtools instead of being trapped in the webview's separate one.
    const onConsole = (e) => {
      if (typeof e.message === 'string' && e.message.startsWith('[wp-bb]')) {
        console.log('[bloomberg webview]', e.message);
      }
    };
    wv.addEventListener('dom-ready', run);
    wv.addEventListener('did-finish-load', run);
    wv.addEventListener('did-navigate', run);
    wv.addEventListener('did-navigate-in-page', run);
    wv.addEventListener('console-message', onConsole);
    return () => {
      wv.removeEventListener('dom-ready', run);
      wv.removeEventListener('did-finish-load', run);
      wv.removeEventListener('did-navigate', run);
      wv.removeEventListener('did-navigate-in-page', run);
      wv.removeEventListener('console-message', onConsole);
    };
  }, []);

  // Finviz: load the webview at normal 100%×100% so the navigation doesn't
  // abort; the useEffect then resizes it to 1280×900 + applies transform once
  // .content.map's coords are reported (post-load).
  const isFinvizURL = (() => { try { return /(^|\.)finviz\.com$/i.test(new URL(url).hostname); } catch { return false; } })();
  return (
    <div>
      <div style={{width:'100%',height:cardHeight,borderRadius:8,
        overflow:'hidden',background:isFinvizURL?'#1a1a1a':'#000',
        position:'relative'}}>
        <webview ref={wvRef} src={url}
          partition={partition}
          style={{width:'100%',height:'100%',display:'inline-flex'}}/>
      </div>
      <div onMouseDown={onResizeMouseDown}
        style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
          display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
        <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
      </div>
    </div>
  );
}

// Generic HLS live-stream widget. Loads hls.js from a CDN (lazily, only when
// this widget is first rendered) and plays an m3u8 in a native <video>.
// Used by Euronews; can be reused for any other HLS feed by swapping the URL.
let _hlsLoadingPromise = null;
function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (_hlsLoadingPromise) return _hlsLoadingPromise;
  _hlsLoadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HLS_JS_URL;
    s.async = true;
    s.onload  = () => resolve(window.Hls);
    s.onerror = () => { _hlsLoadingPromise = null; reject(new Error('hls.js load failed')); };
    document.head.appendChild(s);
  });
  return _hlsLoadingPromise;
}

function EuronewsWidget() {
  const [cardHeight, setCardHeight] = useState(280);
  const [errMsg,     setErrMsg]     = useState('');
  const [muted,      setMuted]      = useState(true);  // Chromium needs muted to autoplay
  const videoRef = useRef(null);
  const hlsRef   = useRef(null);
  // Watchdog state — last time we saw currentTime advance.
  const stallRef = useRef({ time: 0, since: Date.now() });

  useEffect(() => {
    api.store.get('wp-euronews-height').then(v => {
      const h = parseInt(v || '0');
      if (h >= 160) setCardHeight(h);
    });
  }, []);

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(160, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set('wp-euronews-height', String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Initialise (or re-initialise) hls.js + the stream. Called once on mount
  // and again by the watchdog when the stream stalls for too long.
  function attachStream() {
    const video = videoRef.current;
    if (!video || !window.Hls) return;
    const Hls = window.Hls;
    // Tear down the previous instance if any.
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    const hls = new Hls({ lowLatencyMode:true });
    hlsRef.current = hls;
    hls.loadSource(EURONEWS_HLS_URL);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      setErrMsg('');
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      console.error('[euronews] fatal hls error', data);
      setErrMsg((data.type || 'error') + ': ' + (data.details || ''));
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); } catch {}
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch {}
      } else {
        // Last resort — full reinit after a short backoff.
        setTimeout(() => attachStream(), 2000);
      }
    });
    // Reset stall watchdog.
    stallRef.current = { time: video.currentTime, since: Date.now() };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        // Chromium/Electron has no native HLS; load hls.js once globally.
        const Hls = await loadHlsJs();
        if (cancelled) return;
        if (!Hls?.isSupported?.()) {
          setErrMsg('HLS non supporté');
          return;
        }
        attachStream();
      } catch (e) {
        if (cancelled) return;
        console.error('[euronews]', e);
        setErrMsg(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stall watchdog — Antik's HLS endpoint occasionally just stops returning
  // fresh segments. hls.js doesn't always raise a fatal error in that case
  // (buffer drains silently), so we monitor currentTime ourselves and do a
  // full reinit if it hasn't advanced for ~15s while the player is meant
  // to be playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const id = setInterval(() => {
      if (video.paused || video.ended) return;
      const now = Date.now();
      if (video.currentTime !== stallRef.current.time) {
        stallRef.current = { time: video.currentTime, since: now };
        return;
      }
      if (now - stallRef.current.since > 15000) {
        console.warn('[euronews] stalled > 15s, reloading stream');
        stallRef.current.since = now;       // avoid hammering
        attachStream();
      }
    }, 3000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = (e) => {
    e?.stopPropagation?.();
    const v = videoRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next && v.paused) v.play().catch(() => {});
  };

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      v.requestFullscreen?.();
    }
  };

  return { color:'#1e4ba8', title:'Euronews', sub:'Live',
    badge: (
      <button onClick={(e)=>{e.stopPropagation(); attachStream();}}
        title="Recharger le flux"
        style={{background:'none',border:'none',cursor:'pointer',color:'#c4c4d4',
          padding:2,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
      </button>
    ),
    content:(
      <div>
        <div style={{position:'relative'}}>
          <video ref={videoRef} muted autoPlay playsInline
            onDoubleClick={toggleFullscreen}
            title="Double-cliquer pour plein écran"
            style={{width:'100%', height:cardHeight, display:'block',
              borderRadius:6, background:'#000', objectFit:'cover',
              cursor:'pointer'}}/>
          <button onClick={toggleMute}
            title={muted ? 'Activer le son' : 'Couper le son'}
            style={{position:'absolute', bottom:8, right:8,
              width:30, height:30, borderRadius:'50%', border:'none',
              background:'rgba(0,0,0,0.55)', color:'#fff', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              padding:0, backdropFilter:'blur(4px)'}}>
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            )}
          </button>
        </div>
        {errMsg && <div style={{fontSize:10,color:'#ef5350',marginTop:4}}>{errMsg}</div>}
        <div onMouseDown={onResizeMouseDown}
          style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
            display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
          <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
        </div>
      </div>
    )
  };
}

function TradingViewWidget() {
  const [auth,      setAuth]      = useState(null); // null=loading, false=anon, {username}=ok
  const [lists,     setLists]     = useState([]);
  const [listIdx,   setListIdx]   = useState(0);
  const [quotes,    setQuotes]    = useState({});
  const [lastFetch, setLastFetch] = useState(null);
  const [err,       setErr]       = useState('');
  const [busy,      setBusy]      = useState(false);
  const [listHeight, setListHeight] = useState(380);

  useEffect(() => {
    (async () => {
      const session = await api.store.get('wp-tv-session');
      if (session) {
        const r = await api.tv.watchlists();
        if (r.ok && r.data?.length) {
          setLists(r.data);
          setAuth({ username: await api.store.get('wp-tv-user') || '' });
          const savedIdx = parseInt(await api.store.get('wp-tv-list-idx') || '0');
          if (savedIdx > 0 && savedIdx < r.data.length) setListIdx(savedIdx);
        } else { setAuth(false); }
      } else { setAuth(false); }
      const savedH = parseInt(await api.store.get('wp-tv-card-height') || '0');
      if (savedH >= 80) setListHeight(savedH);
    })();
  }, []);

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = listHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(80, startH + (ev.clientY - startY));
      setListHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set('wp-tv-card-height', String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Build the effective list set: prepend the built-in "Marchés" overview and
  // drop TV's default "Liste de surveillance" entry (the user's renamed lists
  // pass through unchanged).
  const effectiveLists = [
    MARKETS_OVERVIEW_LIST,
    ...lists.filter(l => (l?.name || '').trim().toLowerCase() !== 'liste de surveillance'),
    BLOOMBERG_LIVE_TAB,
    FINVIZ_HEATMAP_TAB,
  ];
  const symbols = effectiveLists[listIdx]?.symbols || [];

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    const fetchQ = async () => {
      const results = {};
      await Promise.all(symbols.map(async ({ s, y }) => {
        const ticker = y || (s.includes(':') ? s.split(':')[1] : s);
        try {
          const q = await api.tv.chart(ticker);
          if (q) results[ticker] = q;
        } catch {}
      }));
      if (!cancelled) { setQuotes(results); setLastFetch(Date.now()); }
    };
    fetchQ();
    const id = setInterval(fetchQ, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.map(x=>x.s).join(',')]);

  const doBrowserLogin = async () => {
    setBusy(true); setErr('');
    api.modal?.open();
    const res = await api.tv.browserLogin();
    api.modal?.close();
    if (res.ok) {
      const wl = await api.tv.watchlists();
      if (wl.ok && wl.data?.length) { setLists(wl.data); setAuth({ username: res.username || '' }); }
      else { setAuth({ username: res.username || '' }); setErr('Signed in — no watchlists found'); }
    } else { setErr(res.error || 'Login cancelled'); }
    setBusy(false);
  };

  const doLogout = async () => { await api.tv.logout(); setAuth(false); setLists([]); setQuotes({}); setLastFetch(null); };

  const fmtP   = n => n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const fmtChg = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2);
  const fmtPct = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const clr    = n => (n ?? 0) >= 0 ? '#4caf73' : '#ef5350';
  const fmtDate = d => d ? `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}` : '';

  if (auth === false) return { color:'#5cc8a8', title:'Marchés', sub:'TradingView',
    content:(
      <div style={{paddingTop:4}}>
        <div style={{fontSize:11,color:'#666',marginBottom:12}}>Sign in to load your TradingView watchlists</div>
        {err&&<div style={{fontSize:10,color:'#ef5350',marginBottom:8}}>{err}</div>}
        <button onClick={doBrowserLogin} disabled={busy} style={{...C.btn,width:'100%',opacity:busy?0.6:1}}>
          {busy?'Opening browser…':'Sign in to TradingView'}
        </button>
      </div>
    )
  };

  if (auth === null) return { color:'#5cc8a8', title:'Marchés', sub:'TradingView',
    content:<div style={{color:'#444',fontSize:11,paddingTop:8}}>Loading…</div>
  };

  const updatedAt = lastFetch
    ? new Date(lastFetch).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:false})
    : '';

  const tabs = effectiveLists.length > 1 && (
    <div style={{display:'flex',gap:4,marginBottom:8,overflowX:'auto'}}>
      {effectiveLists.map((l,i) => (
        <button key={l.id||i} onClick={()=>{ setListIdx(i); api.store.set('wp-tv-list-idx', String(i)); }}
          style={{background:i===listIdx?'rgba(255,255,255,0.1)':'none',border:'none',
            borderRadius:5,color:i===listIdx?'#e4e4f4':'#555',
            fontSize:10,padding:'3px 8px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
          {l.name}
        </button>
      ))}
    </div>
  );

  // Bloomberg Live (or any future kind === 'video' tab) — render the page
  // inside an Electron <webview> instead of an <iframe> so we can inject CSS
  // into the cross-origin Bloomberg DOM and hide everything that isn't the
  // video player itself (header nav, Subscribe button, sidebars).
  const activeTab = effectiveLists[listIdx];
  if (activeTab?.kind === 'video') {
    return { color:'#5cc8a8', title:'Marchés', sub: activeTab.name,
      content:(
        <div>
          {tabs}
          {/* key=activeTab.id forces React to unmount + remount when switching
              tabs. Without this, swapping between video/heatmap tabs mutates
              the same <webview>'s src + partition attributes mid-load and
              triggers ERR_ABORTED (-3) inside Electron. */}
          <VideoEmbed key={activeTab.id} url={activeTab.url} isolate={!!activeTab.isolate}/>
        </div>
      )
    };
  }
  if (activeTab?.kind === 'heatmap') {
    return { color:'#5cc8a8', title:'Marchés', sub: activeTab.name,
      content:(
        <div>
          {tabs}
          <VideoEmbed key={activeTab.id} url={activeTab.url} isolate={true}
            storeKey="wp-heatmap-height" partition="persist:finviz"/>
        </div>
      )
    };
  }

  return { color:'#5cc8a8', title: 'Marchés', sub: updatedAt ? `Last updated: ${updatedAt}` : 'TradingView',
    lastUpdated: lastFetch || undefined,
    content:(
      <div>
        {tabs}
        <div style={{height:listHeight,overflowY:'auto',marginRight:-4,paddingRight:4}}>
          {symbols.map(({ s, d, y }) => {
            const ticker = y || (s.includes(':') ? s.split(':')[1] : s);
            const q = quotes[ticker];
            const change = q?.change ?? 0;
            const pct = q?.pct ?? 0;
            const color = change >= 0 ? '#4caf73' : '#ef5350';   // sparkline tint
            const deltaColor = change > 0 ? '#4caf73' : change < 0 ? '#ef5350' : '#888';
            const arrow = change >= 0 ? '▲' : '▼';

            // Intraday sparkline: now ~78 5-min candles for US sessions, ~288
            // for crypto. Include the previous close in the y-axis range so
            // the reference line stays inside the viewBox.
            const points = q?.closes || [];
            const prevClose = q?.prev ?? null;
            const allY = prevClose != null ? [...points, prevClose] : points;
            const minPrice = allY.length ? Math.min(...allY) : q?.price ?? 0;
            const maxPrice = allY.length ? Math.max(...allY) : q?.price ?? 0;
            const range = Math.max(maxPrice - minPrice, 0.01);
            const sparklinePoints = points.map((p, i) => {
              const x = (i / Math.max(points.length - 1, 1)) * 100;
              const y = 20 - ((p - minPrice) / range) * 20;
              return `${x},${y}`;
            }).join(' ');
            // y-position of the previous close — drawn as a dashed reference
            // line so each row visually anchors to "yesterday".
            const prevY = prevClose != null
              ? 20 - ((prevClose - minPrice) / range) * 20
              : null;

            return (
              <div key={s} style={{display:'flex',alignItems:'center',gap:8,
                padding:'3px 0',cursor:'pointer',fontVariantNumeric:'tabular-nums'}}
                onClick={()=>api.browser.open(`https://www.tradingview.com/chart/?symbol=${s}`)}>

                {/* Left: name only on the Marchés overview tab (the indices
                    have descriptive names — the ^GSPC-style ticker codes are
                    noise). On user watchlists, keep the ticker + company name
                    two-line layout. */}
                <div style={{flex:1,minWidth:0}}>
                  {listIdx === 0 ? (
                    <div style={{fontSize:11,fontWeight:700,color:'#fff',lineHeight:1.1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {d || q?.name || ticker}
                    </div>
                  ) : (
                    <>
                      <div style={{fontSize:11,fontWeight:700,color:'#fff',lineHeight:1.1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {ticker}
                      </div>
                      <div style={{fontSize:8,color:'#888',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.1,marginTop:1}}>
                        {q?.name || d}
                      </div>
                    </>
                  )}
                </div>

                {/* Center: Sparkline */}
                {sparklinePoints ? (
                  <svg width="64" height="20" viewBox="0 0 100 24" preserveAspectRatio="none" style={{flexShrink:0}}>
                    <defs>
                      <linearGradient id={`grad-${ticker}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={color} stopOpacity="0.45"/>
                        <stop offset="100%" stopColor={color} stopOpacity="0.05"/>
                      </linearGradient>
                    </defs>
                    <polyline points={sparklinePoints + ' 100,24 0,24'} fill={`url(#grad-${ticker})`}/>
                    {prevY != null && (
                      <line x1="0" y1={prevY} x2="100" y2={prevY}
                        stroke="rgba(255,255,255,0.22)" strokeWidth="0.6"
                        strokeDasharray="2 2" vectorEffect="non-scaling-stroke"/>
                    )}
                    <polyline points={sparklinePoints} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke"/>
                  </svg>
                ) : (
                  <div style={{width:64,height:20,flexShrink:0}}/>
                )}

                {/* Right: Price + delta (text color encodes direction) */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1,minWidth:60,flexShrink:0}}>
                  <div style={{fontSize:11,color:'#fff',whiteSpace:'nowrap',lineHeight:1.1}}>
                    {fmtP(q?.price)}
                  </div>
                  {q?.change!=null && (
                    <div style={{fontSize:9,color:deltaColor,whiteSpace:'nowrap',lineHeight:1.2}}>
                      {change>0?'+':''}{fmtP(change)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!symbols.length&&(
            <div style={{color:'#444',fontSize:11,padding:'12px 0',textAlign:'center'}}>
              {lists.length?'Empty watchlist':'No watchlists found'}
            </div>
          )}
        </div>
        <div onMouseDown={onResizeMouseDown}
          style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
            display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
          <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
        </div>
        <button onClick={doLogout}
          style={{marginTop:8,background:'none',border:'none',color:'#333',fontSize:10,cursor:'pointer',padding:0}}>
          Sign out
        </button>
      </div>
    )
  };
}

// ── Calendar widget (year/month navigation) ──────────────────────────────────
function CalendarWidget() {
  const [date, setDate] = useState(new Date());
  const month = date.getMonth();
  const year = date.getFullYear();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const prevMonth = () => setDate(new Date(year, month - 1, 1));
  const nextMonth = () => setDate(new Date(year, month + 1, 1));
  const prevYear = () => setDate(new Date(year - 1, month, 1));
  const nextYear = () => setDate(new Date(year + 1, month, 1));

  const isToday = (d) => {
    if (!d) return false;
    const today = new Date();
    return d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{padding:'12px',color:'#e4e4f4',fontSize:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{display:'flex',gap:4}}>
          <button onClick={prevYear} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:10}}>◀◀</button>
          <button onClick={prevMonth} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:10}}>◀</button>
        </div>
        <div style={{fontWeight:600,textAlign:'center'}}>
          <div>{monthNames[month]}</div>
          <div style={{fontSize:10,opacity:0.8}}>{year}</div>
        </div>
        <div style={{display:'flex',gap:4}}>
          <button onClick={nextMonth} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:10}}>▶</button>
          <button onClick={nextYear} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:10}}>▶▶</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:2,marginBottom:8}}>
        {dayNames.map(d => <div key={d} style={{textAlign:'center',fontWeight:600,fontSize:9,opacity:0.7}}>{d}</div>)}
        {days.map((d, i) => (
          <div key={i} style={{
            textAlign:'center',
            padding:'4px',
            borderRadius:3,
            background:isToday(d) ? 'rgba(255,255,255,0.3)' : 'transparent',
            fontWeight:isToday(d) ? 600 : 400,
            opacity:d ? 1 : 0.3,
            fontSize:10,
          }}>
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leaflet traffic widget (Esri satellite + reference overlay + TomTom flow)─
function GoogleTrafficWidget({ location = DEFAULT_LOC, apiKey = '' }) {
  const [zoom, setZoom] = useState(() => {
    const stored = parseInt(api.store?.get?.('wp-traffic-zoom') || '');
    return isNaN(stored) ? 11 : stored;
  });
  const zoomRef = useRef(zoom);

  // Load persisted zoom on mount
  useEffect(() => {
    api.store.get('wp-traffic-zoom').then(v => {
      const z = parseInt(v || '');
      if (!isNaN(z)) { setZoom(z); zoomRef.current = z; }
    });
  }, []);

  // Listen for zoom changes sent by the iframe via postMessage
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type !== 'trafficZoom') return;
      const z = e.data.zoom;
      if (z === zoomRef.current) return;
      zoomRef.current = z;
      setZoom(z);
      api.store.set('wp-traffic-zoom', String(z));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const src = useMemo(() => {
    const lat = location.lat.toFixed(5);
    const lon = location.lon.toFixed(5);
    const key = apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : '';
    return `./traffic.html?lat=${lat}&lon=${lon}&zoom=${zoom}${key}`;
  // zoom deliberately excluded: iframe manages its own zoom after load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon, apiKey]);

  return { color:'#f77f4f', title:'Circulation', sub: `Satellite · ${location.name}`,
    content:(
      <div style={{margin:'4px -2px 0',borderRadius:10,overflow:'hidden',lineHeight:0}}>
        <iframe
          key={src}
          src={src}
          width="100%" height="260"
          style={{border:'none',display:'block',borderRadius:10}}
          title="Traffic map"
        />
      </div>
    )
  };
}

// ── Clock widget ─────────────────────────────────────────────────────────────
function ClockWidget() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);

  const h = t.getHours() % 12, m = t.getMinutes(), s = t.getSeconds();
  const cx = 64, cy = 64, r = 54;
  const toXY = (angle, len) => [cx + len * Math.cos(angle), cy + len * Math.sin(angle)];
  const hrA  = (h * 30 + m * 0.5 - 90) * Math.PI / 180;
  const minA = (m * 6 + s * 0.1 - 90) * Math.PI / 180;
  const secA = (s * 6 - 90) * Math.PI / 180;

  return { color:"#e8e8f0", title:"Horloge",
    content:(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:6,paddingBottom:2}}>
        <svg width={128} height={128} viewBox="0 0 128 128" style={{display:"block"}}>
          {/* Outer ring */}
          <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.10)" strokeWidth={1}/>
          {/* Hour markers */}
          {Array.from({length:60}).map((_,i) => {
            const a = (i * 6 - 90) * Math.PI / 180;
            const isMaj = i % 5 === 0;
            const [x1,y1] = toXY(a, r - (isMaj ? 1 : 0.5));
            const [x2,y2] = toXY(a, r - (isMaj ? 9 : 5));
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isMaj ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.12)"}
              strokeWidth={isMaj ? 1.5 : 0.75} strokeLinecap="round"/>;
          })}
          {/* Hour hand */}
          {(()=>{ const [x,y]=toXY(hrA,30), [bx,by]=toXY(hrA+Math.PI,9);
            return <line x1={bx} y1={by} x2={x} y2={y} stroke="rgba(255,255,255,0.95)" strokeWidth={3} strokeLinecap="round"/>; })()}
          {/* Minute hand */}
          {(()=>{ const [x,y]=toXY(minA,46), [bx,by]=toXY(minA+Math.PI,10);
            return <line x1={bx} y1={by} x2={x} y2={y} stroke="rgba(255,255,255,0.75)" strokeWidth={1.75} strokeLinecap="round"/>; })()}
          {/* Second hand */}
          {(()=>{ const [x,y]=toXY(secA,47), [bx,by]=toXY(secA+Math.PI,13);
            return <line x1={bx} y1={by} x2={x} y2={y} stroke="#f74f7e" strokeWidth={1} strokeLinecap="round"/>; })()}
          {/* Center cap */}
          <circle cx={cx} cy={cy} r={3.5} fill="#f74f7e"/>
          <circle cx={cx} cy={cy} r={1.5} fill="rgba(20,20,24,0.8)"/>
        </svg>
        <div style={{fontSize:11,color:"#d0d0e0",fontFamily:"DM Mono,monospace",letterSpacing:2,marginTop:4}}>
          {String(t.getHours()).padStart(2,"0")}:{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}
          <span style={{fontSize:9,color:"#c4c4d4",marginLeft:5}}>{t.getHours()<12?"AM":"PM"}</span>
        </div>
      </div>
    )
  };
}

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
    api.store.get('wp-agenda-cal-ids').then(v => {
      if (v) try { setSelCals(new Set(JSON.parse(v))); } catch {}
    });
    api.store.get('wp-agenda-height').then(v => {
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
      api.store.set('wp-agenda-height', String(cur));
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
      api.store.set('wp-agenda-cal-ids', isAll ? null : JSON.stringify([...next]));
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
        style={{background:"none",border:"none",color:showSettings?"#0078d4":"#333",fontSize:12,cursor:"pointer",padding:"0 2px",lineHeight:1}}>⚙</button>
    : null;

  return { color:"#0078d4", title:"Outlook Agenda", lastUpdated, badge: settingsBtn,
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
                <button onClick={auth.signOut} style={{marginTop:14,background:"none",border:"none",fontSize:9,color:"#222228",cursor:"pointer",padding:0}}>Déconnecter</button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

// ── Outlook Mail widget ──────────────────────────────────────────────────────
function MailWidget() {
  const auth = useMsAuth();
  const [messages,    setMessages]    = useState([]);
  const [demo,        setDemo]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [cardHeight,  setCardHeight]  = useState(360);

  useEffect(() => {
    api.store.get('wp-mail-height').then(v => {
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

  function openInOutlook(msg) {
    console.log('[mail] openInOutlook', { id: msg.id, hasWebLink: !!msg.webLink, webLink: msg.webLink });
    if (msg.webLink) {
      api.browser.open(msg.webLink);
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
      api.store.set('wp-mail-height', String(cur));
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

  return { color:"#0078d4", title:"Outlook Mail", lastUpdated,
    badge: unreadCount > 0 ? <span style={{ ...C.badge, background:"#0078d4", color:"#fff" }}>{unreadCount}</span> : null,
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
                      onClick={()=>openInOutlook(msg)}
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
                <button onClick={auth.signOut} style={{marginTop:14,background:"none",border:"none",fontSize:9,color:"#222228",cursor:"pointer",padding:0}}>Déconnecter</button>
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
// No webview, no chrome to strip. Credentials prompted on first use, stored
// in wp-camera-auth for subsequent sessions.
function CameraWidget() {
  const [cardHeight, setCardHeight] = useState(300);
  const [status, setStatus] = useState('init');   // 'init' | 'login' | 'connecting' | 'streaming' | 'error'
  const [errMsg, setErrMsg] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const imgRef = useRef(null);
  const streamRef = useRef(null);
  const lastBlobUrlRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const watchdogRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const credsRef = useRef({ u: '', p: '' });
  const pendingFrameRef = useRef(null);   // buffers a frame that arrives before <img> mounts
  const debugObsRef = useRef(null);       // holds the diagnostic observer so reconnect can remove it
  const STALE_FRAME_MS = 30000;       // no frame for 30s → reconnect
  const RECONNECT_DELAY_MS = 5000;    // backoff before reconnect attempt

  useEffect(() => {
    api.store.get('wp-camera-height').then(v => {
      const h = parseInt(v || '0');
      if (h >= 150) setCardHeight(h);
    });
  }, []);

  // Frame handler — replaces the <img> src and revokes the previous blob URL.
  // XPMobileSDK's VideoHeaderParser delivers frames as objects with .blob
  // (the JPEG payload). Older paths may give a raw Blob/ArrayBuffer/string.
  const onFrame = useCallback((frame) => {
    lastFrameAtRef.current = Date.now();
    let url;
    if (frame instanceof Blob) {
      url = URL.createObjectURL(frame);
    } else if (frame?.blob instanceof Blob) {
      url = URL.createObjectURL(frame.blob);
    } else if (typeof frame?.imageURL === 'string') {
      url = frame.imageURL;
    } else if (frame instanceof ArrayBuffer) {
      url = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
    } else if (frame?.data instanceof ArrayBuffer || ArrayBuffer.isView(frame?.data)) {
      url = URL.createObjectURL(new Blob([frame.data], { type: 'image/jpeg' }));
    } else if (typeof frame === 'string') {
      url = frame;
    } else {
      console.warn('[camera] unexpected frame type', frame);
      return;
    }
    // If <img> isn't mounted yet (status switched to streaming this tick but
    // React hasn't committed), buffer the frame for when it appears.
    if (!imgRef.current) {
      pendingFrameRef.current = url;
      return;
    }
    imgRef.current.src = url;
    if (lastBlobUrlRef.current && lastBlobUrlRef.current.startsWith('blob:')) {
      try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch {}
    }
    lastBlobUrlRef.current = url;
  }, []);

  // Drain the pending frame once <img> mounts (status === 'streaming').
  useEffect(() => {
    if (status !== 'streaming' || !imgRef.current || !pendingFrameRef.current) return;
    imgRef.current.src = pendingFrameRef.current;
    lastBlobUrlRef.current = pendingFrameRef.current;
    pendingFrameRef.current = null;
  }, [status]);

  // Schedule a reconnect using the stored credentials. Coalesces multiple
  // triggers (lost-connection event + stale-frame watchdog) into a single
  // attempt with a small backoff.
  function scheduleReconnect() {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      const { u, p } = credsRef.current;
      if (!u || !p) { console.warn('[camera] no creds for reconnect'); return; }
      console.log('[camera] reconnecting…');
      try {
        if (streamRef.current) { try { streamRef.current.close(); } catch {} streamRef.current = null; }
        await connectAndStream(u, p);
      } catch (e) {
        console.error('[camera] reconnect failed', e);
        scheduleReconnect(); // try again
      }
    }, RECONNECT_DELAY_MS);
  }

  // Watchdog — if the last frame is older than STALE_FRAME_MS while we're in
  // the streaming state, the upstream stopped (camera/equipment reset). Drop
  // the dead stream and reconnect.
  useEffect(() => {
    if (status !== 'streaming') return;
    lastFrameAtRef.current = Date.now();
    watchdogRef.current = setInterval(() => {
      if (Date.now() - lastFrameAtRef.current > STALE_FRAME_MS) {
        console.warn('[camera] no frames for', STALE_FRAME_MS, 'ms — reconnecting');
        clearInterval(watchdogRef.current); watchdogRef.current = null;
        scheduleReconnect();
      }
    }, 5000);
    return () => { if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function loadSdk() {
    // MobileServerURL must be set BEFORE the SDK script runs its initialize().
    // Connection.js does `self.server = XPMobileSDKSettings.MobileServerURL ||
    // window.location.origin` once during init and caches it. If we set the
    // URL afterward, every XHR goes to localhost:5173 (or wherever the panel
    // is loaded from) and fails with "Invalid URL".
    window.XPMobileSDKSettings = window.XPMobileSDKSettings || {};
    window.XPMobileSDKSettings.MobileServerURL = CAMERA_BASE_URL;

    if (!window.XPMobileSDK) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CAMERA_SDK_URL;
        s.async = true;
        s.onload  = () => resolve();
        s.onerror = () => reject(new Error('SDK script load failed: ' + CAMERA_SDK_URL));
        document.head.appendChild(s);
      });
    }
    // Belt-and-suspenders: re-apply in case the SDK's own defaults overwrote it.
    window.XPMobileSDKSettings.MobileServerURL = CAMERA_BASE_URL;

    if (window.XPMobileSDK.isLoaded?.()) return;
    await new Promise((resolve) => {
      const prev = window.XPMobileSDK.onLoad;
      window.XPMobileSDK.onLoad = function () {
        try { prev && prev(); } catch {}
        resolve();
      };
    });
  }

  // Bridge an observer-pattern SDK method to a Promise. Resolves on the first
  // success-event method, rejects on the first error-event method or timeout.
  function eventToPromise(sdk, successNames, errorNames, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const obs = {};
      let timer;
      const cleanup = () => { try { sdk.removeObserver(obs); } catch {} clearTimeout(timer); };
      timer = setTimeout(() => { cleanup(); reject(new Error('Timeout waiting for ' + successNames.join('/'))); }, timeoutMs);
      successNames.forEach(name => {
        obs[name] = (...args) => { console.log('[camera obs]', name, args); cleanup(); resolve(args[0]); };
      });
      errorNames.forEach(name => {
        obs[name] = (...args) => { console.error('[camera obs]', name, args); cleanup(); reject(new Error(name + ': ' + JSON.stringify(args[0] || {}))); };
      });
      sdk.addObserver(obs);
    });
  }

  async function connectAndStream(username, password) {
    setStatus('connecting'); setErrMsg('');
    try {
      await loadSdk();
      const sdk = window.XPMobileSDK;

      // ── Cleanup any prior session before a fresh connect ────────────────
      // Without this, a reconnect attempt stacks a new login on top of the old
      // session, which the Mobile Server rejects with SecurityError on
      // subsequent commands.
      if (streamRef.current) {
        try { streamRef.current.close(); } catch {}
        streamRef.current = null;
      }
      if (lastBlobUrlRef.current && lastBlobUrlRef.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch {}
        lastBlobUrlRef.current = null;
      }
      if (debugObsRef.current) {
        try { sdk.removeObserver(debugObsRef.current); } catch {}
        debugObsRef.current = null;
      }
      if (sdk.library?.Connection?.connectionId) {
        try { sdk.disconnect?.(); } catch (e) { console.warn('[camera] disconnect failed', e); }
      }
      if (sdk.library?.VideoConnectionPool) {
        try { sdk.library.VideoConnectionPool.pool = {}; } catch {}
      }

      // Belt-and-suspenders: force the Connection's cached server URL even if
      // settings.MobileServerURL got overwritten by the SDK's defaults during
      // its own var-redeclaration.
      window.XPMobileSDKSettings.MobileServerURL = CAMERA_BASE_URL;
      if (sdk.library?.Connection) sdk.library.Connection.server = CAMERA_BASE_URL;
      console.log('[camera] Connection.server =', sdk.library?.Connection?.server);
      console.log('[camera] settings.MobileServerURL =', window.XPMobileSDKSettings.MobileServerURL);

      // Stop the auto-RequestChallenges loop (server rejects with error 23)
      // without breaking login itself. Login uses DH (separate from CHAP);
      // only the auto-refresh observer needs to be neutered.
      if (sdk.requestChallenges) sdk.requestChallenges = () => {};
      if (window.XPMobileSDK?.requestChallenges) window.XPMobileSDK.requestChallenges = () => {};

      // Diagnostic observer — names taken straight from
      // XPMobileSDK.interfaces.ConnectionObserver in the SDK source.
      // Also include request-level events so we see when post-login commands
      // (RequestStream, LiveMessage, etc.) succeed or fail.
      const debugObs = {};
      [
        'connectionStateChanged',
        'connectionDidConnect','connectionFailedToConnect',
        'connectionDidConnectWithId','connectionFailedToConnectWithId',
        'connectionRequiresCode','connectionCodeError',
        'connectionDidLogIn','connectionFailedToLogIn',
        'connectionLostConnection','connectionProcessingDisconnect','connectionDidDisconnect',
        'connectionRequestSucceeded','connectionRequestFailed',
        'connectionVideoStreamStarted','connectionVideoStreamFailed','connectionVideoStreamEnded',
      ].forEach(n => debugObs[n] = (...a) => console.log('[camera evt]', n, a));
      sdk.addObserver(debugObs);
      debugObsRef.current = debugObs;

      // Auto-reconnect on lost connection (overnight equipment resets, etc).
      const reconnectObs = {
        connectionLostConnection: () => {
          console.warn('[camera] connection lost — scheduling reconnect');
          scheduleReconnect();
        },
      };
      sdk.addObserver(reconnectObs);

      // ── Connect ──────────────────────────────────────────────────────────
      const connectP = eventToPromise(sdk, ['connectionDidConnect'], ['connectionFailedToConnect']);
      console.log('[camera] sdk.connect()');
      sdk.connect();
      await connectP;
      console.log('[camera] connected');

      // ── Login (positional args!) ─────────────────────────────────────────
      // loginType: 'Windows' — 'Basic' was rejected with InvalidCredentials,
      // and the default (undefined) authenticated but the resulting session
      // had zero rights (every subsequent command returned SecurityError 19).
      // The user can log in successfully through the Web Client UI, so the
      // account is most likely a Windows/AD user.
      const loginP = eventToPromise(sdk, ['connectionDidLogIn'], ['connectionFailedToLogIn'], 30000);
      console.log('[camera] sdk.login(username, password, "Windows")');
      sdk.login(username, password, 'Windows');
      await loginP;
      console.log('[camera] logged in');

      await api.store.set('wp-camera-auth', JSON.stringify({ u: username, p: password }));
      credsRef.current = { u: username, p: password };

      // ── Discover cameras the account actually has access to ─────────────
      // The hardcoded GUID hit SecurityError 19 (insufficient rights). Picking
      // from getAllCameras gives us a GUID we know is accessible.
      console.log('[camera] sdk.getAllCameras()');
      const cameras = await new Promise((resolve, reject) => {
        sdk.getAllCameras(
          (cams) => resolve(cams),
          (err)  => reject(new Error('getAllCameras failed: ' + JSON.stringify(err)))
        );
      });
      console.log('[camera] cameras', cameras);
      const savedCamId = await api.store.get('wp-camera-id');
      const camList = Array.isArray(cameras) ? cameras : (cameras?.items || cameras?.cameras || []);
      // GetItems returns a hierarchy (groups → sub-groups → cameras). Recurse
      // and keep only Type==='Camera' leaves so we don't pick a group GUID.
      const flatten = (items, acc = []) => {
        for (const it of items || []) {
          if (it && it.Type === 'Camera' && it.Id) acc.push(it);
          if (Array.isArray(it?.Items)) flatten(it.Items, acc);
        }
        return acc;
      };
      const allCams = flatten(camList);
      console.log('[camera] flat list (', allCams.length, ' cameras)', allCams);
      // Pick the camera by name match first — different accounts have rights
      // to different cameras, and allCams[0] often picks one we can't stream
      // (which manifests as SecurityError 19 on requestStream). Match the
      // configured CAMERA_NAME_HINT (case-insensitive substring) before
      // falling back to ID/index.
      const nameMatch = (c) =>
        CAMERA_NAME_HINT && (c.Name || '').toLowerCase().includes(CAMERA_NAME_HINT.toLowerCase());
      const pick = allCams.find(c => c.Id === savedCamId)
                || allCams.find(nameMatch)
                || allCams.find(c => c.Id === CAMERA_ID)
                || allCams[0];
      if (!pick) throw new Error('No cameras available to this account (flatten found 0 of type=Camera)');
      const camId = pick.Id;
      console.log('[camera] using camera', pick.Name || camId, camId);
      await api.store.set('wp-camera-id', camId);

      // ── RequestStream in Pull mode ──────────────────────────────────────
      // The high-level sdk.requestStream() forces MethodType:'Push' which
      // opens wss://.../XProtectMobile/Video/<id>/ — that handshake fails
      // with HTTP 400 on this server. Use the low-level sdk.RequestStream
      // with MethodType:'Pull' so the SDK routes via PullConnection (AJAX)
      // instead of PushConnection (WebSocket).
      console.log('[camera] sdk.RequestStream Pull(', camId, pick.Name, ')');
      const videoStream = await new Promise((resolve, reject) => {
        sdk.RequestStream(
          {
            CameraId: camId,
            DestWidth: 800,
            DestHeight: 450,
            SignalType: 'Live',
            MethodType: 'Pull',
            Fps: 10,
            ComprLevel: 70,
            KeyFramesOnly: 'No',
            RequestSize: 'Yes',
            StreamType: 'Transcoded',
          },
          (vs)  => resolve(vs),
          (err) => reject(new Error('RequestStream failed: ' + JSON.stringify(err)))
        );
      });
      console.log('[camera] VideoStream from SDK', videoStream);
      if (!videoStream) throw new Error('RequestStream succeeded with null VideoStream');

      // ── The trap we just escaped ─────────────────────────────────────────
      // sdk.RequestStream's success callback returns an `XPMobileSDK.library`
      // VideoStream (the NEW class, defined in Lib/VideoStream.js). That class
      // wraps a <video-connection> custom element which ALWAYS opens a
      // WebSocket — regardless of MethodType. So calling videoStream.open()
      // here with our MethodType:'Pull' params would still try wss:// and
      // fail with HTTP 400 → black card.
      //
      // Workaround: there's an OLDER class XPMobileSDK.library.VideoConnection
      // (Lib/VideoConnection.js) that honors `request.parameters.MethodType`
      // and internally constructs a PullConnection (AJAX) for 'Pull'. We
      // extract the SDK-prepared request/response from the returned VideoStream
      // and feed it to VideoConnection manually. Do NOT call open() on the
      // discarded VideoStream — that would still kick off a WebSocket.
      const VC = sdk.library?.VideoConnection;
      if (typeof VC !== 'function') {
        throw new Error('XPMobileSDK.library.VideoConnection unavailable on this SDK build');
      }
      const fakeReq = {
        params:   videoStream.request?.parameters,
        options:  videoStream.request?.options,
        response: { outputParameters: videoStream.response?.parameters },
      };
      console.log('[camera] reconstructing VideoConnection from', fakeReq);
      const videoConnection = new VC(videoStream.videoId, fakeReq);
      console.log('[camera] VideoConnection', videoConnection,
        'isPush=', videoConnection.isPush);

      const vcObs = {
        videoConnectionReceivedFrame: (frame) => {
          // Only log frame metadata, not the binary blob itself.
          if (lastFrameAtRef.current === 0) {
            console.log('[camera vc] first frame', {
              hasBlob: !!frame?.blob,
              blobSize: frame?.blob?.size,
              keys: frame && Object.keys(frame),
            });
          }
          onFrame(frame);
        },
        videoConnectionFailed:           (...a) => console.error('[camera vc] failed', a),
        videoConnectionTemporaryDown:    (...a) => console.warn('[camera vc] temporaryDown', a),
        videoConnectionRecovered:        (...a) => console.log('[camera vc] recovered', a),
        videoConnectionChangedState:     (...a) => console.log('[camera vc] stateChanged', a),
        videoConnectionStreamingError:   (...a) => console.error('[camera vc] streamingError', a),
      };
      videoConnection.addObserver(vcObs);
      streamRef.current = videoConnection;
      setStatus('streaming');
      // Wait one animation frame so React commits the streaming-state render
      // (the <img> element) before frames start arriving.
      await new Promise(resolve => requestAnimationFrame(resolve));
      console.log('[camera] videoConnection.open()');
      videoConnection.open();

      // First-frame watchdog: if the stream opens but no frames arrive within
      // 8 seconds, dump the live state so we can see whether the channel is
      // running, closed, or stuck.
      const t0 = Date.now();
      setTimeout(() => {
        if (lastFrameAtRef.current >= t0) return;
        console.warn('[camera] no frames within 8s of open()');
        try {
          console.warn('[camera] post-open VC state', {
            videoId: videoConnection?.videoId,
            cameraId: videoConnection?.cameraId,
            isPush: videoConnection?.isPush,
            communication: videoConnection?.communication?.constructor?.name,
          });
        } catch (e) { console.warn('[camera] post-open inspect failed', e); }
      }, 8000);
    } catch (e) {
      console.error('[camera] error', e);
      setErrMsg(String(e?.message || e));
      // SDK error code 15 = InvalidCredentials. Clear the stored creds so the
      // login form shows blank inputs instead of auto-retrying bad creds.
      const msg = String(e?.message || '');
      if (msg.includes('"code":15')) {
        await api.store.delete('wp-camera-auth');
        setUser(''); setPass('');
      }
      setStatus('login');
    }
  }

  // Auto-attempt login if credentials are stored.
  useEffect(() => {
    api.store.get('wp-camera-auth').then(saved => {
      if (saved) {
        try {
          const c = JSON.parse(saved);
          if (c.u && c.p) {
            setUser(c.u); setPass(c.p);
            connectAndStream(c.u, c.p);
            return;
          }
        } catch {}
      }
      setStatus('login');
    });
    // Cleanup the stream on unmount.
    return () => {
      if (streamRef.current) { try { streamRef.current.close(); } catch {} streamRef.current = null; }
      if (lastBlobUrlRef.current && lastBlobUrlRef.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch {}
      }
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!user || !pass) return;
    connectAndStream(user, pass);
  };

  const handleLogout = async () => {
    if (streamRef.current) { try { streamRef.current.close(); } catch {} streamRef.current = null; }
    await api.store.delete('wp-camera-auth');
    setUser(''); setPass(''); setStatus('login'); setErrMsg('');
  };

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(150, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set('wp-camera-height', String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  let body;
  if (status === 'init' || status === 'connecting') {
    body = <div style={{height:cardHeight,display:'flex',alignItems:'center',justifyContent:'center',color:'#888',fontSize:11,background:'#000',borderRadius:6}}>
      {status === 'connecting' ? 'Connexion…' : 'Initialisation…'}
    </div>;
  } else if (status === 'login') {
    body = (
      <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:8,padding:'8px 0'}}>
        <input value={user} onChange={e=>setUser(e.target.value)}
               placeholder="Username" autoComplete="username" style={{...C.inp}} />
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
               placeholder="Password" autoComplete="current-password" style={{...C.inp}} />
        {errMsg && <div style={{fontSize:10,color:'#ef5350'}}>{errMsg}</div>}
        <button type="submit" style={{...C.btn}}>Connect</button>
      </form>
    );
  } else {
    body = <img ref={imgRef} alt="" style={{width:'100%',height:cardHeight,display:'block',borderRadius:6,background:'#000',objectFit:'cover'}} />;
  }

  const logoutBtn = streamRef.current
    ? <button onClick={e=>{ e.stopPropagation(); handleLogout(); }}
        title="Sign out"
        style={{background:"none",border:"none",color:"#444",fontSize:10,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
    : null;

  return { color:"#5e8af5", title:"Caméra", badge: logoutBtn,
    content:(
      <div>
        {body}
        <div onMouseDown={onResizeMouseDown}
          style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
            display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
          <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
        </div>
      </div>
    )
  };
}

// ── Microsoft To-Do widget ────────────────────────────────────────────────────
function TodoWidget() {
  const auth = useMsAuth();
  const [tasks,        setTasks]       = useState([]);
  const [lists,        setLists]       = useState([]);
  const [activeListId, setActiveListId]= useState(null);
  const [demo,         setDemo]        = useState(false);
  const [loading,      setLoading]     = useState(false);
  const [lastUpdated,  setLastUpdated] = useState(null);

  useEffect(() => {
    api.store.get('wp-todo-list-id').then(id => { if (id) setActiveListId(id); });
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
        if (!activeListId) { setActiveListId(targetId); api.store.set('wp-todo-list-id', targetId); }
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
    api.store.set('wp-todo-list-id', id);
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

  return { color:"#2564cf", title:"Microsoft To-Do", lastUpdated,
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
                <button onClick={auth.signOut} style={{marginTop:8,background:"none",border:"none",fontSize:9,color:"#222228",cursor:"pointer",padding:0,display:"block"}}>Déconnecter</button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

// ── Widget renderer ──────────────────────────────────────────────────────────
function WidgetCard({ id, categories, apiKeys, onSaveKey, colorIdx, onUnreadChange, onOpenUrl, location, tvSymbols, expanded, onToggle, isDragging, onDragStart, onDragEnd }) {
  const newsData    = id.startsWith("cat:") ? NewsWidget({ category: categories.find(c=>c.label===id.slice(4)), colorIdx, onUnreadChange, onOpenUrl, expanded, onToggle }) : null;
  const weatherData = id==="weather" ? WeatherWidget({ location, expanded, onToggle }) : null;
  const stocksData  = id==="stocks"  ? TradingViewWidget({ expanded, onToggle }) : null;
  const calendarData= id==="calendar"? { color:"#9c27b0", title:"Calendrier", content:<CalendarWidget/> } : null;
  const trafficData = id==="traffic" ? GoogleTrafficWidget({ location, apiKey: apiKeys?.traffic || '', expanded, onToggle }) : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clockData   = id==="clock"   ? ClockWidget() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const agendaData  = id==="agenda"  ? AgendaWidget() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const mailData    = id==="mail"    ? MailWidget()   : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const cameraData  = id==="camera"  ? CameraWidget() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const todoData    = id==="todo"    ? TodoWidget()   : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const euronewsData= id==="euronews"? EuronewsWidget() : null;
  const d = newsData || weatherData || stocksData || calendarData || trafficData || clockData || agendaData || mailData || cameraData || todoData || euronewsData;
  if (!d) return null;
  return (
    <Shell color={d.color} title={d.title} sub={d.sub} badge={d.badge} lastUpdated={d.lastUpdated}
      expanded={expanded} onToggle={onToggle} transparent={d.transparent}
      isDragging={isDragging} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {d.content}
    </Shell>
  );
}

// ── OPML drop screen ─────────────────────────────────────────────────────────
function OPMLDrop({ onLoaded }) {
  const [dragging,setDragging]=useState(false);
  const [error,setError]=useState("");
  const fileRef=useRef(null);
  function processFile(file) {
    if(!file)return;
    const reader=new FileReader();
    reader.onload=function(ev){
      try { const cats=parseOPML(ev.target.result); if(!cats.length){setError("No categories found in OPML.");return;} onLoaded(cats); }
      catch(e){setError("Could not parse file: "+e.message);}
    };
    reader.readAsText(file);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",justifyContent:"center",height:"100%",padding:24,maxWidth:380,margin:"0 auto"}}>
      <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false);processFile(e.dataTransfer.files[0]);}}
        onClick={()=>fileRef.current?.click()}
        style={{border:"1px dashed "+(dragging?"var(--accent)":"rgba(255,255,255,0.1)"),borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragging?"color-mix(in srgb, var(--accent) 6%, transparent)":"rgba(255,255,255,0.02)",transition:"all 0.15s",marginBottom:16}}>
        <div style={{fontSize:26,marginBottom:10,opacity:0.45}}>📰</div>
        <div style={{fontSize:13,color:"#c4c4d4",fontWeight:500,marginBottom:5}}>Drop your Feedly OPML here</div>
        <div style={{fontSize:11,color:"#c4c4d4"}}>or click to browse</div>
        <input ref={fileRef} type="file" accept=".opml,.xml" style={{display:"none"}} onChange={e=>processFile(e.target.files[0])}/>
      </div>
      {error&&<div style={{fontSize:11,color:"#f77f4f",marginBottom:12}}>{error}</div>}
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"12px 14px"}}>
        <div style={{fontSize:10,color:"#d0d0e0",fontWeight:500,textTransform:"uppercase",letterSpacing:0.8,marginBottom:8}}>How to export from Feedly</div>
        {[["1","Go to","feedly.com"],["2","Click avatar →","Organize"],["3","Scroll down →","Export OPML"]].map(([n,a,b])=>(
          <div key={n} style={{display:"flex",gap:8,marginBottom:5}}>
            <span style={{fontSize:10,color:"#2a2a34",width:14,fontFamily:"DM Mono,monospace",flexShrink:0}}>{n}</span>
            <span style={{fontSize:11,color:"#c4c4d4"}}>{a} <span style={{color:"#dcdcec"}}>{b}</span></span>
          </div>
        ))}
        <div style={{marginTop:10,fontSize:10,color:"#282830",lineHeight:1.5}}>Also works with Inoreader, NewsBlur, or any OPML file.</div>
      </div>
    </div>
  );
}

// ── Category manager ─────────────────────────────────────────────────────────
function CategoryManager({ categories, activeIds, setActiveIds, onClose, onReset }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:560,maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexShrink:0}}>
          <span style={{fontSize:14,fontWeight:500,color:"#e0e0e0"}}>Manage widgets</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#d0d0e0",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{display:"flex",gap:20,overflow:"hidden",flex:1}}>
          {/* System column */}
          <div style={{flex:"0 0 220px",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,marginBottom:8,flexShrink:0}}>System</div>
            <div style={{overflowY:"auto",flex:1}}>
              {SYS.map(w=>{
                const on=activeIds.includes(w.id);
                return(
                  <div key={w.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <span style={{...C.dot,background:w.color}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:"#e4e4f4"}}>{w.label}</div>
                      <div style={{fontSize:10,color:"#c4c4d4"}}>{w.note}</div>
                    </div>
                    <button onClick={()=>setActiveIds(p=>on?p.filter(x=>x!==w.id):[...p,w.id])}
                      style={{border:"1px solid",borderRadius:6,fontSize:11,padding:"3px 10px",cursor:"pointer",fontWeight:500,fontFamily:"'DM Sans',sans-serif",background:on?w.color+"22":"rgba(255,255,255,0.05)",color:on?w.color:"#d0d0e0",borderColor:on?w.color+"44":"rgba(255,255,255,0.08)"}}>
                      {on?"Pinned":"Add"}
                    </button>
                  </div>
                );
              })}
              <button onClick={onReset} style={{marginTop:16,background:"none",border:"none",fontSize:11,color:"#282830",cursor:"pointer",padding:0,display:"block"}}>↺ Load a different OPML file</button>
            </div>
          </div>
          {/* Divider */}
          <div style={{width:1,background:"rgba(255,255,255,0.06)",flexShrink:0}}/>
          {/* News column */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,marginBottom:8,flexShrink:0}}>News categories</div>
            <div style={{overflowY:"auto",flex:1}}>
              {categories.map((cat,i)=>{
                const id="cat:"+cat.label,on=activeIds.includes(id),col=catColor(cat.label,i);
                return(
                  <div key={cat.label} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <span style={{...C.dot,background:col}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:"#e4e4f4"}}>{cat.label}</div>
                      <div style={{fontSize:10,color:"#c4c4d4"}}>{cat.feeds.length} feed{cat.feeds.length!==1?"s":""}</div>
                    </div>
                    <button onClick={()=>setActiveIds(p=>on?p.filter(x=>x!==id):[...p,id])}
                      style={{border:"1px solid",borderRadius:6,fontSize:11,padding:"3px 10px",cursor:"pointer",fontWeight:500,fontFamily:"'DM Sans',sans-serif",background:on?col+"22":"rgba(255,255,255,0.05)",color:on?col:"#444",borderColor:on?col+"44":"rgba(255,255,255,0.08)"}}>
                      {on?"Pinned":"Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsSlider({ label, value, min, max, step=0.01, onChange }) {
  return (
    <div style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:13,color:"#e4e4f4"}}>{label}</div>
        <div style={{fontSize:11,color:"#d0d0e0",fontFamily:"DM Mono,monospace"}}>{Math.round(value*100)}%</div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:"100%",accentColor:"var(--accent)",cursor:"pointer"}}/>
    </div>
  );
}

function SettingsModal({ onClose, opacity, onOpacityChange, cardOpacity, onCardOpacityChange, pinnedOpacity, onPinnedOpacityChange, location, onLocationChange, apiKeys, onApiKeyChange }) {
  const [autostart, setAutostart] = useState(false);
  const [locDraft, setLocDraft] = useState('');
  const [tomtomDraft, setTomtomDraft] = useState(apiKeys?.traffic || '');
  const [locSearching, setLocSearching] = useState(false);
  const [locResult, setLocResult] = useState(null);
  const [locError, setLocError] = useState('');

  useEffect(()=>{ api.autostart?.get().then(v=>setAutostart(!!v)); },[]);

  function toggleAutostart() {
    const next=!autostart; setAutostart(next);
    api.autostart?.set(next); api.store.set('wp-autostart', next ? '1' : '');
  }

  async function searchLocation() {
    if (!locDraft.trim()) return;
    setLocSearching(true); setLocError(''); setLocResult(null);
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locDraft.trim())}&count=1&language=en&format=json`);
      const d = await r.json();
      if (d.results?.length) {
        const res = d.results[0];
        setLocResult({ name:`${res.name}, ${res.admin1||res.country}`, lat:res.latitude, lon:res.longitude, timezone:res.timezone });
      } else { setLocError('Location not found'); }
    } catch { setLocError('Search failed'); }
    setLocSearching(false);
  }

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:280,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:14,fontWeight:500,color:"#e0e0e0"}}>Settings</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#d0d0e0",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div>
            <div style={{fontSize:13,color:"#e4e4f4"}}>Start with Windows</div>
            <div style={{fontSize:10,color:"#c4c4d4",marginTop:2}}>Launch panel on login</div>
          </div>
          <button onClick={toggleAutostart} style={{
            width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",transition:"background 0.2s",position:"relative",
            background:autostart?"var(--accent)":"rgba(255,255,255,0.1)"
          }}>
            <span style={{position:"absolute",top:2,left:autostart?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",display:"block"}}/>
          </button>
        </div>
        <SettingsSlider label="Background opacity" min="0.2" max="1" value={opacity} onChange={onOpacityChange}/>
        <SettingsSlider label="Card opacity" min="0" max="1" value={cardOpacity} onChange={onCardOpacityChange}/>
        <SettingsSlider label="Pinned opacity" min="0.05" max="1" value={pinnedOpacity} onChange={onPinnedOpacityChange}/>
        <div style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{fontSize:13,color:"#e4e4f4",marginBottom:2}}>Location</div>
          <div style={{fontSize:10,color:"#c4c4d4",marginBottom:8}}>Weather &amp; traffic</div>
          <div style={{fontSize:11,color:"#888",marginBottom:8,fontFamily:"DM Mono,monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{location.name}</div>
          <div style={{display:"flex",gap:6}}>
            <input value={locDraft} onChange={e=>setLocDraft(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') searchLocation(); }}
              placeholder="Search city…"
              style={{...C.inp,flex:1,fontSize:11}}/>
            <button onClick={searchLocation} disabled={locSearching} style={C.btn}>{locSearching?'…':'↵'}</button>
          </div>
          {locError&&<div style={{fontSize:10,color:"#f77f4f",marginTop:6}}>{locError}</div>}
          {locResult&&(
            <div style={{marginTop:8,padding:"8px 10px",background:"rgba(255,255,255,0.04)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <span style={{fontSize:11,color:"#e4e4f4",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{locResult.name}</span>
              <button onClick={()=>{ onLocationChange(locResult); setLocResult(null); setLocDraft(''); }} style={{...C.btn,padding:"2px 10px",fontSize:11,flexShrink:0}}>Use</button>
            </div>
          )}
        </div>
        <div style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{fontSize:13,color:"#e4e4f4",marginBottom:2}}>Traffic API key</div>
          <div style={{fontSize:10,color:"#c4c4d4",marginBottom:8}}>TomTom · free tier at developer.tomtom.com</div>
          <div style={{display:"flex",gap:6}}>
            <input value={tomtomDraft} onChange={e=>setTomtomDraft(e.target.value)}
              placeholder="Paste TomTom key…"
              style={{...C.inp,flex:1,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
            <button onClick={()=>onApiKeyChange('traffic', tomtomDraft.trim())} style={C.btn}>Save</button>
          </div>
        </div>
        <div style={{fontSize:10,color:"#282830",marginTop:16,lineHeight:1.5}}>
          Panel position: left edge · Win+W to toggle
        </div>
      </div>
    </div>
  );
}

// ── Taskbar notification rotator ──────────────────────────────────────────────
function useNotificationRotator(snippets, totalUnread) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(()=>{
    if (!snippets.length) { setVisible(false); return; }
    setVisible(true);
    const t = setInterval(()=>setIdx(i=>(i+1)%snippets.length), 8000);
    return ()=>clearInterval(t);
  },[snippets.length]);

  useEffect(()=>{ api.badge?.set(totalUnread); },[totalUnread]);

  return { snippet: snippets[idx] || null, visible };
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [categories,   setCategories]   = useState(null);
  const [activeIds,    setActiveIds]    = useState([]);
  const [columns,      setColumns]      = useState({});
  const [apiKeys,      setApiKeys]      = useState({});
  const [showMgr,      setShowMgr]      = useState(false);
  const [refreshKey,   setRefreshKey]   = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [pinned,       setPinned]       = useState(false);
  const [time,         setTime]         = useState(new Date());
  const [visible,      setVisible]      = useState(false);
  const [opacity,       setOpacity]       = useState(0.55);
  const [cardOpacity,   setCardOpacity]   = useState(1);
  const [pinnedOpacity, setPinnedOpacity] = useState(0.25);
  const [location,      setLocation]      = useState(DEFAULT_LOC);
  const [tvSymbols,     setTvSymbols]     = useState(null);
  const [accentColor,    setAccentColor]    = useState('#202020');
  const [systemWindowColor, setSystemWindowColor] = useState('#1f1f1f');
  const [browserPane,  setBrowserPane]  = useState({ open: false, url: '', loading: false, braveX: 0 });

  // Column widths: left + mid + feed are fixed; right column is flex
  const [colWidths, setColWidths] = useState({ left: 220, mid: 240, feed: 260 });
  const colWidthsRef = useRef({ left: 220, mid: 240, feed: 260 });
  const panelBgRef = useRef(null);
  const storageReadyRef = useRef(false);
  const pendingShowRef  = useRef(false);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Expand/collapse state per widget id — persisted
  const [expandedMap, setExpandedMap] = useState({});

  function getExpanded(id)   { return expandedMap[id] !== false; }
  function toggleExpanded(id) {
    setExpandedMap(p => ({ ...p, [id]: !(p[id] !== false) }));
  }

  // Column divider drag — purely in-renderer
  function onColDividerDown(which) {
    return (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = colWidthsRef.current[which];
      const onMove = (ev) => {
        const newW = Math.max(150, Math.min(startW + (ev.clientX - startX), 500));
        setColWidths(p => ({ ...p, [which]: newW }));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        api.store.set(SK_COLW, JSON.stringify(colWidthsRef.current));
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
  }

  function openBrowser(url) {
    window.electronAPI?.browser?.open(url);
  }

  const [unreadMap, setUnreadMap] = useState({});
  const totalUnread = Object.values(unreadMap).reduce((a,b)=>a+b, 0);
  const [snippets, setSnippets] = useState([]);

  // Drag-and-drop reorder state
  const [dragId,     setDragId]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { col, beforeId } | null

  function handleDrop(fromId, targetCol, beforeId) {
    setColumns(p => ({ ...p, [fromId]: targetCol }));
    setActiveIds(prev => {
      const arr = prev.filter(x => x !== fromId);
      if (beforeId !== null) {
        const ti = arr.indexOf(beforeId);
        if (ti !== -1) { arr.splice(ti, 0, fromId); return arr; }
      }
      arr.push(fromId);
      return arr;
    });
  }

  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return ()=>clearInterval(t); },[]);

  // ── Slide animation ──────────────────────────────────────────────────────
  useEffect(() => {
    const panelApi = window.electronAPI?.panel;
    if (!panelApi) return;
    panelApi.onShow(() => {
      if (storageReadyRef.current) setVisible(true);
      else pendingShowRef.current = true;
    });
    panelApi.onHide(() => {
      setVisible(false);
      setShowSettings(false);
      setShowMgr(false);
      api.modal?.close();
      setTimeout(() => panelApi.hideDone(), 270);
    });
    panelApi.ready();
  }, []);

  // ── Browser pane (embedded Brave) ────────────────────────────────────────
  useEffect(() => {
    const bApi = window.electronAPI?.browser;
    if (!bApi) return;
    bApi.onPaneShow(({ url, braveX }) => setBrowserPane({ open: true, url, loading: false, braveX }));
    bApi.onPaneHide(() => {
      setBrowserPane(p => ({ ...p, open: false }));
      bApi.setIgnoreMouseEvents(false);
    });
    bApi.onLoading(v => setBrowserPane(p => ({ ...p, loading: v })));
    bApi.onUrl(u => setBrowserPane(p => ({ ...p, url: u })));
  }, []);

  // ── Resize drag handle (panel width) ────────────────────────────────────
  const onResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    window.electronAPI?.panel?.resizeStart(e.screenX, window.innerWidth);
    const onUp = () => {
      window.electronAPI?.panel?.resizeEnd();
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
  }, []);

  // ── Default column assignment ────────────────────────────────────────────
  function defaultColumns(cats) {
    const cols = {};
    (cats||[]).forEach(c => { cols["cat:" + c.label] = "feed"; });
    cols.weather = "left";
    cols.stocks  = "left";
    cols.traffic = "left";
    cols.clock   = "left";
    cols.agenda  = "right";
    cols.mail    = "right";
    cols.camera  = "left";
    cols.todo    = "right";
    return cols;
  }

  // Column resolver — falls back to "left" for system, "feed" for news
  function getColFor(id) {
    if (columns[id]) return columns[id];
    return id.startsWith("cat:") ? "feed" : "left";
  }

  // ── Load persisted config ────────────────────────────────────────────────
  useEffect(()=>{
    // Load visual settings first so panel renders at correct opacity/card-opacity immediately
    Promise.all([
      storageLoad(),
      api.store.get('wp-opacity'),
      api.store.get('wp-card-opacity'),
      api.store.get('wp-pinned-opacity'),
      api.store.get('wp-location'),
    ]).then(([saved, opv, cardv, pinnedv, locv]) => {
      if (saved?.categories?.length) {
        setCategories(saved.categories);
        // Strip orphan IDs (e.g. 'pressreader' left over from earlier sessions
        // when it was a widget). KNOWN_SYS in the column-split logic also
        // filters these out at render time, but persisting them clean here
        // means they stop being written back to wp-config.
        const VALID_SYS = new Set(['weather','traffic','stocks','calendar','clock','agenda','mail','camera','todo','euronews']);
        const knownCats = new Set((saved.categories||[]).map(c => 'cat:' + c.label));
        const cleaned = (saved.activeIds||[]).filter(id => VALID_SYS.has(id) || knownCats.has(id));
        setActiveIds(cleaned);
        const cols = saved.columns || {};
        const stale = cols.weather==="right" || cols.stocks==="right" || cols.traffic==="right";
        const hasMid = Object.values(cols).some(v => v === "mid");
        let finalCols;
        if (stale) {
          finalCols = defaultColumns(saved.categories);
        } else if (!hasMid && Object.keys(cols).length > 0) {
          finalCols = {};
          for (const [id, c] of Object.entries(cols)) {
            finalCols[id] = (c === "right" && id.startsWith("cat:")) ? "mid" : c;
          }
        } else {
          finalCols = cols;
        }
        // Migrate: cat:* widgets in "mid" from pre-feed-column saves → "feed"
        const hasFeed = Object.values(finalCols).some(v => v === "feed");
        if (!hasFeed) {
          for (const id of Object.keys(finalCols)) {
            if (id.startsWith("cat:") && finalCols[id] === "mid") finalCols[id] = "feed";
          }
        }
        setColumns(finalCols);
        setApiKeys(saved.apiKeys||{});
      }
      if (opv) setOpacity(parseFloat(opv));
      const cardVal = cardv ? parseFloat(cardv) : 1;
      setCardOpacity(cardVal);
      document.documentElement.style.setProperty('--card-bg', `rgba(38,40,50,${cardVal})`);
      if (pinnedv) setPinnedOpacity(parseFloat(pinnedv));
      if (locv) { try { setLocation(JSON.parse(locv)); } catch {} }
      api.store.get('wp-tv-symbols').then(v => {
        let syms = DEFAULT_TV_SYMBOLS;
        if (v) { try { syms = JSON.parse(v); } catch {} }
        setTvSymbols(syms);
      });
      setStorageReady(true);
    });

    api.pin?.get().then(p=>setPinned(!!p));
    api.pin?.onChange(p=>setPinned(!!p));
    api.store.get(SK_COLW).then(v=>{
      if (v) try {
        const p = JSON.parse(v);
        setColWidths(p);
        colWidthsRef.current = p;
      } catch {}
    });
    api.store.get(SK_EXPANDED).then(v=>{
      if (v) try { setExpandedMap(JSON.parse(v)); } catch {}
    });
    window.electronAPI?.system?.accentColor().then(c=>{ if (c) setAccentColor(c); });
    window.electronAPI?.system?.windowColor().then(c=>{ if (c) setSystemWindowColor(c); });
    window.electronAPI?.system?.onWindowColorChange?.(c=>{ if (c) setSystemWindowColor(c); });
  },[]);

  // Flush pending panel-show once storage is ready (cold-start race fix)
  useEffect(() => {
    storageReadyRef.current = storageReady;
    if (storageReady && pendingShowRef.current) {
      pendingShowRef.current = false;
      setVisible(true);
    }
  }, [storageReady]);

  // Persist main config on change
  useEffect(()=>{
    if (!storageReady || !categories) return;
    storageSave({ categories, activeIds, columns, apiKeys });
  },[categories, activeIds, columns, apiKeys, storageReady]);

  // Persist expanded map on change
  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_EXPANDED, JSON.stringify(expandedMap));
  },[expandedMap, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set('wp-opacity', String(opacity));
  },[opacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set('wp-card-opacity', String(cardOpacity));
    document.documentElement.style.setProperty('--card-bg', `rgba(38,40,50,${cardOpacity})`);
  },[cardOpacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set('wp-pinned-opacity', String(pinnedOpacity));
  },[pinnedOpacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set('wp-location', JSON.stringify(location));
  },[location, storageReady]);

  // Log and force repaint when panel becomes visible
  useEffect(() => {
    if (!visible || !storageReady) return;
    const el = panelBgRef.current;
    const computedBg = el ? window.getComputedStyle(el).backgroundColor : 'n/a';
    api.log?.(`panel visible: opacity=${opacity} storageReady=${storageReady} computedBg=${computedBg} el=${!!el}`);
    if (!el) return;
    requestAnimationFrame(() => {
      const bg2 = window.getComputedStyle(el).backgroundColor;
      api.log?.(`rAF1: computedBg=${bg2}`);
      el.style.outline = '1px solid transparent';
      requestAnimationFrame(() => {
        const bg3 = window.getComputedStyle(el).backgroundColor;
        api.log?.(`rAF2: computedBg=${bg3}`);
        el.style.outline = '';
      });
    });
  }, [visible, storageReady]);

  // Build notification snippets
  useEffect(()=>{
    const items=[];
    Object.entries(unreadMap).forEach(([id,count])=>{
      if (count>0) {
        const label=id.startsWith("cat:")?id.slice(4):id;
        items.push(`${count} unread · ${label}`);
      }
    });
    setSnippets(items);
  },[unreadMap]);

  const { snippet, visible: tickerVisible } = useNotificationRotator(snippets, totalUnread);

  function handleOPML(cats) {
    const defaults=[...cats.slice(0,2).map(c=>"cat:"+c.label),"weather","stocks","traffic"];
    setCategories(cats); setActiveIds(defaults); setColumns(defaultColumns(cats));
  }
  function resetColumns() { setColumns(defaultColumns(categories)); }
  function saveKey(service, key) {
    setApiKeys(p=>({...p,[service]:key}));
    setActiveIds(p=>p.includes(service)?p:[...p,service]);
  }
  function reset() {
    setCategories(null); setActiveIds([]); setColumns({}); setApiKeys({});
    setShowMgr(false); storageSave({});
  }
  async function togglePin() {
    const next = await api.pin?.toggle();
    setPinned(!!next);
    api.store.set('wp-pinned', next ? '1' : '');
  }

  const loaded = !!categories;
  // Filter out IDs that don't map to a known widget type — e.g. an old
  // 'pressreader' or removed cat:* left over in saved activeIds. Without
  // this, WidgetCard returns null but renderCol still renders the wrapping
  // .wi div, taking up space in whichever column the phantom ID was placed.
  const KNOWN_SYS = new Set(['weather','traffic','stocks','calendar','clock','agenda','mail','camera','todo','euronews']);
  const isKnownId = (id) =>
    KNOWN_SYS.has(id) ||
    (id.startsWith('cat:') && (categories||[]).some(c => c.label === id.slice(4)));
  const visibleIds = activeIds.filter(isKnownId);
  const leftIds  = visibleIds.filter(id => getColFor(id) === "left");
  const midIds   = visibleIds.filter(id => getColFor(id) === "mid");
  const feedIds  = visibleIds.filter(id => getColFor(id) === "feed");
  const rightIds = visibleIds.filter(id => getColFor(id) === "right");
  const newsIds  = visibleIds.filter(id => id.startsWith("cat:"));

  const onUnread = useCallback((id, count)=>{
    setUnreadMap(p=>({...p,[id]:count}));
  },[]);

  if (!storageReady) return (
    <div style={{display:"flex",height:"100vh",alignItems:"center",justifyContent:"center",background:"rgba(10,10,12,0.95)",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{fontSize:11,color:"#c4c4d4"}}>Loading…</div>
    </div>
  );

  // Shared WidgetCard renderer for a column.
  // Drop targets are the card wrappers themselves — top-half hover = insert before,
  // bottom-half hover = insert after. Border lines show the insertion point.
  function renderCol(ids, colName) {
    return ids.map((id, i) => {
      const nextId = ids[i + 1] ?? null;
      const dropBefore = dragId && dropTarget?.col === colName && dropTarget?.beforeId === id;
      const dropAfter  = dragId && dropTarget?.col === colName && dropTarget?.beforeId === nextId;
      return (
        <div key={`${id}-${refreshKey}`} className="wi" style={{
          animationDelay: (i*25)+"ms",
          borderTop:    dropBefore ? '2px solid var(--accent)' : '2px solid transparent',
          borderBottom: dropAfter  ? '2px solid var(--accent)' : '2px solid transparent',
          transition: 'border-color 0.06s',
        }}
        onDragOver={e=>{
          e.preventDefault(); e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          const target = { col: colName, beforeId: before ? id : nextId };
          if (!dropTarget || dropTarget.col !== colName || dropTarget.beforeId !== target.beforeId) {
            setDropTarget(target);
          }
        }}
        onDrop={e=>{
          e.preventDefault(); e.stopPropagation();
          if (dragId && dropTarget) handleDrop(dragId, dropTarget.col, dropTarget.beforeId);
        }}>
          <WidgetCard id={id} categories={categories||[]} apiKeys={apiKeys} onSaveKey={saveKey}
            colorIdx={newsIds.indexOf(id)}
            onUnreadChange={count=>onUnread(id,count)}
            onOpenUrl={openBrowser}
            location={location}
            tvSymbols={tvSymbols}
            expanded={getExpanded(id)}
            onToggle={()=>toggleExpanded(id)}
            isDragging={dragId === id}
            onDragStart={()=>{ setDragId(id); setDropTarget(null); }}
            onDragEnd={()=>{ setDragId(null); setDropTarget(null); }} />
        </div>
      );
    });
  }

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"'DM Sans',sans-serif",background:"transparent",overflow:"hidden","--accent":accentColor}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap');
        html,body{background:transparent;margin:0;padding:0}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:2px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28)}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:.18}50%{opacity:.44}}
        @keyframes ticker{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .wi{animation:fadeIn 0.2s ease both}
        input{color-scheme:dark}
        button:focus{outline:none}
        a{color:var(--accent)}
        /* Global text vibrancy */
        body{color:#eeeef8}
        .panel-wrap{
          transform: translateX(-100%);
          transition: transform 260ms cubic-bezier(0.32,0,0.16,1);
        }
        .panel-wrap.open{
          transform: translateX(0);
        }
        .resize-handle{
          width:5px;flex-shrink:0;cursor:ew-resize;
          background:rgba(255,255,255,0.04);
          transition:background 0.15s;
          position:relative;z-index:10;
        }
        .resize-handle:hover,.resize-handle:active{
          background:color-mix(in srgb, var(--accent) 30%, transparent);
        }
        .col-divider{
          width:4px;flex-shrink:0;cursor:col-resize;
          background:rgba(255,255,255,0.03);
          transition:background 0.15s;
          user-select:none;
        }
        .col-divider:hover{
          background:color-mix(in srgb, var(--accent) 20%, transparent);
        }
      `}</style>

      {/* ── Sliding wrapper ── */}
      <div className={`panel-wrap${visible?" open":""}`}
           style={{display:"flex",flexDirection:"row",height:"100vh",
                   width: browserPane.open ? browserPane.braveX : '100vw'}}>

        {/* ── Panel content ── */}
        <div ref={panelBgRef} style={{
          flex:"0 0 auto",
          width: browserPane.open ? browserPane.braveX : '100vw',
          overflow:"hidden",
          display:"flex",flexDirection:"row",
          background:`rgba(55,60,80,${pinned ? pinnedOpacity : opacity})`,
          transition:"width 280ms cubic-bezier(0.32,0,0.16,1)"}}>

          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* ── Header ── */}
            <div style={{padding:"10px 20px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:600,color:"#f2f2ff",letterSpacing:0.2,textTransform:"capitalize",display:"flex",alignItems:"baseline",gap:6}}>
                {time.toLocaleDateString("fr-CA",{weekday:"long"})}
                <span style={{fontSize:11,fontWeight:400,color:"#dcdcec",textTransform:"none"}}>
                  {time.toLocaleDateString("fr-CA",{day:"numeric",month:"long",year:"numeric"})}
                </span>
              </div>
              <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2}}>
                <button onClick={()=>api.browser?.open?.(PRESSREADER_URL)} title="PressReader"
                  style={{background:"none",border:"1px solid transparent",borderRadius:6,
                    cursor:"pointer",padding:"3px 4px",lineHeight:1,display:"flex",alignItems:"center"}}>
                  <svg width="16" height="16" viewBox="0 0 32 32" style={{display:"block"}}>
                    <path d="M6,4 H26 A4,4 0 0 1 30,8 V20 A4,4 0 0 1 26,24 H22 L24,30 L16,24 H6 A4,4 0 0 1 2,20 V8 A4,4 0 0 1 6,4 Z" fill="#1FAA8C"/>
                    <text x="16" y="15" fontSize="14" fontWeight="800" fill="#fff" textAnchor="middle"
                      fontFamily="'DM Sans',sans-serif" dominantBaseline="central">P</text>
                  </svg>
                </button>
                <button onClick={togglePin} title={pinned?"Unpin":"Pin to desktop"}
                  style={{background:pinned?"color-mix(in srgb, var(--accent) 15%, transparent)":"none",border:pinned?"1px solid color-mix(in srgb, var(--accent) 30%, transparent)":"1px solid transparent",
                    borderRadius:6,color:pinned?"var(--accent)":"#aaa",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}>
                  📌
                </button>
                {loaded&&<button onClick={()=>{setShowMgr(true);api.modal.open();}} title="Manage widgets"
                  style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#dcdcec",fontSize:15,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>⚙</button>}
                <button onClick={()=>{setShowSettings(true);api.modal.open();}} title="Settings"
                  style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#dcdcec",fontSize:13,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>≡</button>
                {loaded&&<button onClick={()=>setRefreshKey(k=>k+1)} title="Refresh data"
                  style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#dcdcec",fontSize:13,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>↺</button>}
              </div>
            </div>

            {/* ── Body ── */}
            {!loaded && <OPMLDrop onLoaded={handleOPML} />}
            {loaded && (
              <div style={{flex:1,overflow:"hidden",display:"flex"}}>

                {/* Column 1 */}
                <div style={{flexShrink:0,width:colWidths.left,overflowY:"auto",padding:"0px 6px 12px 10px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"left",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(leftIds, "left")}
                  {leftIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 1 | col 2 */}
                <div className="col-divider" onMouseDown={onColDividerDown('left')} />

                {/* Column 2 */}
                <div style={{flexShrink:0,width:colWidths.mid,overflowY:"auto",padding:"0px 6px 12px 6px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"mid",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(midIds, "mid")}
                  {midIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 2 | col 3 (feed) */}
                <div className="col-divider" onMouseDown={onColDividerDown('mid')} />

                {/* Column 3 — Feeds */}
                <div style={{flexShrink:0,width:colWidths.feed,overflowY:"auto",padding:"0px 6px 12px 6px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"feed",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(feedIds, "feed")}
                  {feedIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 3 | col 4 */}
                <div className="col-divider" onMouseDown={onColDividerDown('feed')} />

                {/* Column 4 — Personal (agenda, todo) */}
                <div style={{flex:1,overflowY:"auto",padding:"0px 10px 12px 6px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"right",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(rightIds, "right")}
                  {rightIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>
              </div>
            )}

            {/* ── Footer ── */}
            {loaded&&(
              <div style={{padding:"8px 16px",borderTop:"1px solid rgba(255,255,255,0.04)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
                <span style={{fontSize:9,color:"#c4c4d4",fontFamily:"DM Mono,monospace"}}>{categories.length} categories · OPML</span>
                <button onClick={()=>{setShowMgr(true);api.modal.open();}} style={{background:"none",border:"1px solid rgba(255,255,255,0.2)",color:"#e4e4f4",fontSize:10,padding:"3px 8px",borderRadius:5,cursor:"pointer"}}>+ Add widget</button>
              </div>
            )}
          </div>

          {/* Resize handle (panel width) */}
          <div className="resize-handle" onMouseDown={onResizeMouseDown} />
        </div>

      </div>

      {showMgr&&loaded&&<CategoryManager categories={categories} activeIds={activeIds} setActiveIds={setActiveIds} onClose={()=>{setShowMgr(false);api.modal.close();}} onReset={reset}/>}
      {showSettings&&<SettingsModal onClose={()=>{setShowSettings(false);api.modal.close();}}
        opacity={opacity} onOpacityChange={setOpacity}
        cardOpacity={cardOpacity} onCardOpacityChange={v=>{ setCardOpacity(v); document.documentElement.style.setProperty('--card-bg',`rgba(38,40,50,${v})`); }}
        pinnedOpacity={pinnedOpacity} onPinnedOpacityChange={setPinnedOpacity}
        location={location} onLocationChange={setLocation}
        apiKeys={apiKeys} onApiKeyChange={(service,key)=>saveKey(service,key)}/>}

      {/* ── Panel-color backdrop for the browser extension area ── */}
      {browserPane.open && (
        <div style={{
          position: 'fixed', left: browserPane.braveX, top: 0, right: 0, bottom: 0,
          background: `rgba(55,60,80,${pinned ? pinnedOpacity : opacity})`,
          zIndex: 9998, pointerEvents: 'none',
        }} />
      )}

      {/* ── Browser controls — two buttons painted on the panel backdrop ── */}
      {browserPane.open && (
        <div style={{
          position: 'fixed', top: 12, right: 20,
          display: 'flex', alignItems: 'center', gap: 4,
          zIndex: 9999, userSelect: 'none',
        }}>
          {browserPane.loading && (
            <div style={{width:12,height:12,border:'2px solid rgba(255,255,255,0.1)',borderTop:'2px solid #888',borderRadius:'50%',animation:'spin 0.7s linear infinite',marginRight:8}}/>
          )}
          <button
            onClick={() => window.electronAPI?.browser?.openExternal()}
            title="Open in Brave"
            style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#aaa",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color='#dcdcec'} onMouseLeave={e=>e.currentTarget.style.color='#aaa'}>
            ↗
          </button>
          <button
            onClick={() => window.electronAPI?.browser?.close()}
            title="Dismiss"
            style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#aaa",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color='#dcdcec'} onMouseLeave={e=>e.currentTarget.style.color='#aaa'}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

