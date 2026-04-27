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
  { id:"weather", label:"Weather",          note:"Open-Meteo · no key",           color:"#f7c94f" },
  { id:"traffic", label:"Traffic",          note:"TomTom · free key",             color:"#f77f4f" },
  { id:"stocks",  label:"Stocks",           note:"Finnhub · free key",            color:"#5cc8a8" },
  { id:"clock",   label:"Clock",            note:"No API needed",                 color:"#e8e8f0" },
  { id:"agenda",  label:"Outlook Agenda",   note:"Microsoft Graph · OAuth",       color:"#0078d4" },
  { id:"todo",    label:"Microsoft To-Do",  note:"Microsoft Graph · OAuth",       color:"#2564cf" },
];

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
  card:  { background:"var(--card-bg,rgba(24,24,28,1))", borderRadius:12, border:"1px solid rgba(255,255,255,0.06)", overflow:"hidden" },
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

  return { color:"#f7c94f", title:"Weather", sub:location.name, lastUpdated,
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

// ── TradingView market overview widget ────────────────────────────────────────
const INDEX_SYMBOLS = [
  { yf:'^GSPC', label:'S&P 500',  tv:'FOREXCOM:SPXUSD' },
  { yf:'^DJI',  label:'Dow 30',   tv:'DJ:DJI'          },
  { yf:'^IXIC', label:'Nasdaq',   tv:'NASDAQ:COMP'     },
];

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

function TradingViewWidget({ onOpenUrl, symbols }) {
  const chartRef           = useRef(null);
  const [chartIdx, setChartIdx] = useState(0);
  const [quotes,   setQuotes]   = useState({});

  // Fetch all quotes (indices + watchlist) from Yahoo Finance
  useEffect(() => {
    let cancelled = false;
    const syms = symbols || DEFAULT_TV_SYMBOLS;
    const fetchAll = async () => {
      const keys = [
        ...INDEX_SYMBOLS.map(i => i.yf),
        ...syms.map(({ s }) => s.includes(':') ? s.split(':')[1] : s),
      ];
      const results = {};
      await Promise.all(keys.map(async ticker => {
        try {
          const res  = await fetch(YF_QUOTE(ticker));
          const data = await res.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta) {
            const prev = meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? meta.previousClose;
            results[ticker] = {
              price:  meta.regularMarketPrice,
              change: meta.regularMarketPrice - prev,
              pct:   (meta.regularMarketPrice - prev) / prev * 100,
            };
          }
        } catch {}
      }));
      if (!cancelled) setQuotes(results);
    };
    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  // Mini chart carousel
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.innerHTML = '';
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
    s.async = true;
    s.textContent = JSON.stringify({
      symbol: INDEX_SYMBOLS[chartIdx].tv,
      width:'100%', height:140, locale:'en', dateRange:'1D',
      colorTheme:'dark', isTransparent:true, autosize:false,
    });
    chartRef.current.appendChild(s);
  }, [chartIdx]);

  const navBtn = (onClick, label) => (
    <button onClick={onClick} style={{background:'rgba(255,255,255,0.07)',border:'none',color:'#c4c4d4',
      fontSize:15,width:22,height:20,borderRadius:4,cursor:'pointer',lineHeight:1,padding:0}}>{label}</button>
  );
  const fmtP = n => n == null ? '…' : n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtPct = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const fmtChg = n => n == null ? '' : (n >= 0 ? '+' : '') + Math.abs(n).toFixed(2);
  const clr = n => (n ?? 0) >= 0 ? '#26a69a' : '#ef5350';
  const syms = symbols || DEFAULT_TV_SYMBOLS;

  return { color:'#5cc8a8', title:'Markets', sub:'TradingView',
    content:(
      <div>
        {/* Mini chart carousel */}
        <div ref={chartRef} style={{width:'100%'}}/>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'2px 4px 8px'}}>
          {navBtn(()=>setChartIdx(i=>(i-1+INDEX_SYMBOLS.length)%INDEX_SYMBOLS.length),'‹')}
          <span style={{fontSize:10,color:'#888'}}>{INDEX_SYMBOLS[chartIdx].label}</span>
          {navBtn(()=>setChartIdx(i=>(i+1)%INDEX_SYMBOLS.length),'›')}
        </div>

        {/* Index summary cards */}
        <div style={{display:'flex',gap:4,paddingBottom:10}}>
          {INDEX_SYMBOLS.map(idx => {
            const q = quotes[idx.yf];
            return (
              <div key={idx.yf} onClick={()=>onOpenUrl?.(`https://www.tradingview.com/chart/?symbol=${idx.tv}`)}
                style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:7,padding:'6px 7px',cursor:'pointer'}}>
                <div style={{fontSize:9,color:'#666',marginBottom:2}}>{idx.label}</div>
                <div style={{fontSize:11,fontWeight:600,color:'#e4e4f4',lineHeight:1.2}}>{fmtP(q?.price)}</div>
                <div style={{fontSize:9,color:clr(q?.change),marginTop:1}}>{fmtPct(q?.pct)}</div>
              </div>
            );
          })}
        </div>

        {/* Watchlist */}
        <div style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
          {syms.map(({ s, d }) => {
            const ticker = s.includes(':') ? s.split(':')[1] : s;
            const q = quotes[ticker];
            const c = clr(q?.change);
            return (
              <div key={s} onClick={()=>onOpenUrl?.(`https://www.tradingview.com/chart/?symbol=${s}`)}
                style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                  padding:'7px 2px',borderBottom:'1px solid rgba(255,255,255,0.05)',cursor:'pointer'}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:'#e4e4f4'}}>{ticker}</div>
                  <div style={{fontSize:10,color:'#555'}}>{d}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:12,fontWeight:500,color:'#e4e4f4'}}>{fmtP(q?.price)}</div>
                  <div style={{fontSize:10,color:c}}>{fmtPct(q?.pct)}&nbsp;&nbsp;{fmtChg(q?.change)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )
  };
}

// ── Leaflet traffic widget (ESRI satellite + TomTom flow tiles) ───────────────
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

  return { color:'#f77f4f', title:'Traffic', sub: `Satellite · ${location.name}`,
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

  return { color:"#e8e8f0", title:"Clock",
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
    const scopes = ['Calendars.Read', 'Tasks.ReadWrite', 'offline_access', 'User.Read'];
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
        portal.azure.com → App registrations → New → grant <em>Calendars.Read</em> + <em>Tasks.ReadWrite</em> → enable public client flows
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

  useEffect(() => {
    api.store.get('wp-agenda-cal-ids').then(v => {
      if (v) try { setSelCals(new Set(JSON.parse(v))); } catch {}
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
      const calsRes = await window.electronAPI.msGraph.fetch(
        'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,hexColor,color&$top=50', token);
      if (calsRes.status === 401) { auth.signOut(); setLoading(false); return; }
      const cals = calsRes.body?.value || [];
      setCalendars(cals);

      const now = new Date();
      const cutoff = new Date(now.getTime() + 7 * 86400000);
      const timeQ = `startDateTime=${now.toISOString()}&endDateTime=${cutoff.toISOString()}`
        + `&$select=subject,start,end,location,isAllDay&$top=50`;

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
                <div style={{maxHeight:360,overflowY:"auto",paddingRight:2}}>
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
                <button onClick={auth.signOut} style={{marginTop:14,background:"none",border:"none",fontSize:9,color:"#222228",cursor:"pointer",padding:0}}>Déconnecter</button>
              </div>
            )}
          </div>
        )}
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
  const stocksData  = id==="stocks"  ? TradingViewWidget({ onOpenUrl, symbols: tvSymbols, expanded, onToggle }) : null;
  const trafficData = id==="traffic" ? GoogleTrafficWidget({ location, apiKey: apiKeys?.traffic || '', expanded, onToggle }) : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const clockData   = id==="clock"   ? ClockWidget() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const agendaData  = id==="agenda"  ? AgendaWidget() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const todoData    = id==="todo"    ? TodoWidget()   : null;
  const d = newsData || weatherData || stocksData || trafficData || clockData || agendaData || todoData;
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
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:300,maxHeight:"82vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:14,fontWeight:500,color:"#e0e0e0"}}>Manage widgets</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#d0d0e0",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>News categories</div>
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
        <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,margin:"16px 0 8px"}}>System widgets</div>
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
        <button onClick={onReset} style={{marginTop:20,background:"none",border:"none",fontSize:11,color:"#282830",cursor:"pointer",padding:0,display:"block"}}>↺ Load a different OPML file</button>
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

function SettingsModal({ onClose, opacity, onOpacityChange, cardOpacity, onCardOpacityChange, pinnedOpacity, onPinnedOpacityChange, location, onLocationChange, tvSymbols, onTvSymbolsChange, apiKeys, onApiKeyChange }) {
  const [autostart, setAutostart] = useState(false);
  const [locDraft, setLocDraft] = useState('');
  const [symDraft, setSymDraft] = useState(() => (tvSymbols||DEFAULT_TV_SYMBOLS).map(({s,d}) => `${s}  ${d}`).join('\n'));
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
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:280}}>
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
          <div style={{fontSize:13,color:"#e4e4f4",marginBottom:2}}>Markets</div>
          <div style={{fontSize:10,color:"#c4c4d4",marginBottom:8}}>One symbol per line · EXCHANGE:TICKER Name</div>
          <textarea
            value={symDraft}
            onChange={e=>setSymDraft(e.target.value)}
            rows={7}
            style={{...C.inp,width:'100%',resize:'vertical',fontSize:10,fontFamily:'DM Mono,monospace',lineHeight:1.6,boxSizing:'border-box'}}
          />
          <button onClick={()=>{
            const syms = symDraft.trim().split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
              const [s,...rest] = l.split(/\s+/);
              return { s, d: rest.join(' ') || s.split(':')[1] || s };
            });
            onTvSymbolsChange(syms);
          }} style={{...C.btn,marginTop:6,width:'100%'}}>Save watchlist</button>
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
    panelApi.onShow(() => setVisible(true));
    panelApi.onHide(() => {
      setVisible(false);
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
        setActiveIds(saved.activeIds||[]);
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
      document.documentElement.style.setProperty('--card-bg', `rgba(24,24,28,${cardVal})`);
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
    document.documentElement.style.setProperty('--card-bg', `rgba(24,24,28,${cardOpacity})`);
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
  const leftIds  = activeIds.filter(id => getColFor(id) === "left");
  const midIds   = activeIds.filter(id => getColFor(id) === "mid");
  const feedIds  = activeIds.filter(id => getColFor(id) === "feed");
  const rightIds = activeIds.filter(id => getColFor(id) === "right");
  const newsIds  = activeIds.filter(id => id.startsWith("cat:"));

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
        html,body{background:rgba(255,255,255,0.08);margin:0;padding:0}
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
          background:`rgba(55,55,70,${pinned ? pinnedOpacity : opacity})`,
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
                <button onClick={togglePin} title={pinned?"Unpin":"Pin to desktop"}
                  style={{background:pinned?"color-mix(in srgb, var(--accent) 15%, transparent)":"none",border:pinned?"1px solid color-mix(in srgb, var(--accent) 30%, transparent)":"1px solid transparent",
                    borderRadius:6,color:pinned?"var(--accent)":"#aaa",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}>
                  📌
                </button>
                {loaded&&<button onClick={()=>setShowMgr(true)} title="Manage widgets"
                  style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#dcdcec",fontSize:15,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>⚙</button>}
                <button onClick={()=>setShowSettings(true)} title="Settings"
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
                <button onClick={()=>setShowMgr(true)} style={{background:"none",border:"1px solid rgba(255,255,255,0.2)",color:"#e4e4f4",fontSize:10,padding:"3px 8px",borderRadius:5,cursor:"pointer"}}>+ Add widget</button>
              </div>
            )}
          </div>

          {/* Resize handle (panel width) */}
          <div className="resize-handle" onMouseDown={onResizeMouseDown} />
        </div>

      </div>

      {showMgr&&loaded&&<CategoryManager categories={categories} activeIds={activeIds} setActiveIds={setActiveIds} onClose={()=>setShowMgr(false)} onReset={reset}/>}
      {showSettings&&<SettingsModal onClose={()=>setShowSettings(false)}
        opacity={opacity} onOpacityChange={setOpacity}
        cardOpacity={cardOpacity} onCardOpacityChange={v=>{ setCardOpacity(v); document.documentElement.style.setProperty('--card-bg',`rgba(24,24,28,${v})`); }}
        pinnedOpacity={pinnedOpacity} onPinnedOpacityChange={setPinnedOpacity}
        location={location} onLocationChange={setLocation}
        tvSymbols={tvSymbols} onTvSymbolsChange={syms=>{ setTvSymbols(syms); api.store.set('wp-tv-symbols', JSON.stringify(syms)); }}
        apiKeys={apiKeys} onApiKeyChange={(service,key)=>saveKey(service,key)}/>}

      {/* ── Browser card (panel extension with Brave content rendered behind) ── */}
      {browserPane.open && (
        <div style={{
          position: 'fixed', left: browserPane.braveX + 8, top: 8, right: 8, bottom: 8,
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          zIndex: 9999, userSelect: 'none',
          // background transparent so Brave (in shell window behind) shows through
          background: 'transparent',
        }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            // Header is 41px tall — only the content area below it is click-through
            window.electronAPI.browser.setIgnoreMouseEvents(e.clientY > rect.top + 41);
          }}
          onMouseLeave={() => window.electronAPI.browser.setIgnoreMouseEvents(false)}
        >
          {/* Card header — opaque, captures clicks */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 41,
            background: '#18181c',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '9px 9px 0 0',
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
          }}>
            {browserPane.loading && (
              <div style={{width:13,height:13,border:'2px solid rgba(255,255,255,0.1)',borderTop:'2px solid #888',borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}/>
            )}
            <div style={{flex:1,fontSize:11,color:'#555',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:'DM Mono,monospace'}}>
              {browserPane.url}
            </div>
            <button
              onClick={() => window.electronAPI?.browser?.openExternal()}
              title="Open in Brave"
              style={{background:'none',border:'none',color:'#444',fontSize:13,cursor:'pointer',padding:'4px 6px',lineHeight:1,borderRadius:4,transition:'color 0.1s'}}
              onMouseEnter={e=>e.currentTarget.style.color='#aaa'} onMouseLeave={e=>e.currentTarget.style.color='#444'}>
              ↗
            </button>
            <button
              onClick={() => window.electronAPI?.browser?.close()}
              title="Dismiss"
              style={{background:'none',border:'none',color:'#444',fontSize:13,cursor:'pointer',padding:'4px 6px',lineHeight:1,borderRadius:4,transition:'color 0.1s'}}
              onMouseEnter={e=>e.currentTarget.style.color='#aaa'} onMouseLeave={e=>e.currentTarget.style.color='#444'}>
              ✕
            </button>
          </div>
          {/* Content area transparent — Brave renders in shell window behind this */}
        </div>
      )}
    </div>
  );
}

