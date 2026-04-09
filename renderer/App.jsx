import { useState, useEffect, useRef, useCallback } from "react";

// ── API endpoints ────────────────────────────────────────────────────────────
const PROXY1   = "https://api.allorigins.win/raw?url=";
const PROXY2   = "https://api.rss2json.com/v1/api.json?rss_url=";
const METEO    = "https://api.open-meteo.com/v1/forecast";
const FINNHUB  = "https://finnhub.io/api/v1";
const TOMTOM   = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json";
// Yahoo Finance unofficial — zero key, used as Finnhub fallback
const YF_QUOTE = (sym) => PROXY1 + encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`);

// ── Storage keys ─────────────────────────────────────────────────────────────
const SK_CONFIG = "wp-config";

// ── Palette & system widget defs ─────────────────────────────────────────────
const PALETTE = ["#4f8ef7","#5cc8a8","#b07ef7","#f7a64f","#f74f7e","#4ff7c8","#f7f74f","#c8f74f"];
const SYS = [
  { id:"weather", label:"Weather", note:"Open-Meteo · no key", color:"#f7c94f" },
  { id:"traffic", label:"Traffic", note:"TomTom · free key",   color:"#f77f4f" },
  { id:"stocks",  label:"Stocks",  note:"Finnhub · free key",  color:"#5cc8a8" },
];

// ── Mock fallback data ───────────────────────────────────────────────────────
const MOCK_NEWS = [
  { id:"1", title:"RISC-V chips are closing the gap with x86 in datacenter benchmarks",   source:"arstechnica.com", link:"#", time:"12m" },
  { id:"2", title:"Firefox 127 ships with improved memory isolation on Windows",           source:"theregister.com", link:"#", time:"34m" },
  { id:"3", title:"EU regulators open formal probe into Microsoft AI bundling practices",  source:"reuters.com",     link:"#", time:"1h"  },
  { id:"4", title:"Apple acquires UK startup behind on-device LLM inference engine",       source:"ft.com",          link:"#", time:"2h"  },
  { id:"5", title:"Nvidia Blackwell supply ramp expected to ease H200 constraints in Q3",  source:"tomshardware.com",link:"#", time:"3h"  },
];
const MOCK_NEWS_FR = [
  { id:"f1", title:"Le gouvernement Legault dépose son budget 2025 avec surplus de 1,2 G$", source:"lapresse.ca",     link:"#", time:"5m"  },
  { id:"f2", title:"Québec annonce 800 nouveaux logements sociaux dans la région de Québec",source:"radio-canada.ca", link:"#", time:"28m" },
  { id:"f3", title:"Pont de Québec : les travaux de réfection majeures débutent cet été",   source:"lesoleil.com",    link:"#", time:"1h"  },
  { id:"f4", title:"Feux de forêt : alerte préventive levée pour la Côte-Nord",             source:"tvanouvelles.ca", link:"#", time:"2h"  },
  { id:"f5", title:"Le Canadien repêche en 5e position au prochain repêchage LNH",          source:"rds.ca",          link:"#", time:"3h"  },
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
const MOCK_STOCKS = { AAPL:{c:213.49,pc:211.20,h:214.80}, MSFT:{c:417.72,pc:414.55,h:419.10}, NVDA:{c:875.40,pc:859.20,h:882.00}, SPY:{c:521.30,pc:518.80,h:523.50} };
const MOCK_TRAFFIC = { currentSpeed:72, freeFlowSpeed:100, confidence:0.87 };

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
function parseXML(xml) {
  const doc=new DOMParser().parseFromString(xml,"text/xml");
  return Array.from(doc.querySelectorAll("item, entry")).map(it=>{
    const get=tag=>it.querySelector(tag)?.textContent?.trim()||"";
    const link=it.querySelector("link[href]")?.getAttribute("href")||it.querySelector("link")?.textContent?.trim()||get("guid");
    return { id:get("guid")||link, title:get("title"), link,
      source:(()=>{try{return new URL(link).hostname.replace("www.","");}catch{return "";}})(),
      time:relTime(get("pubDate")||get("published")||get("updated")) };
  }).filter(it=>it.title&&it.link);
}
async function fetchRSS(url) {
  try { const r=await fetch(PROXY1+encodeURIComponent(url)); if(r.ok){const items=parseXML(await r.text()).slice(0,7);if(items.length)return items;} } catch {}
  try { const r=await fetch(PROXY2+encodeURIComponent(url)+"&count=6"); const d=await r.json(); if(d.status==="ok") return d.items.map(it=>({id:it.guid||it.link,title:it.title,link:it.link,source:(()=>{try{return new URL(it.link).hostname.replace("www.","");}catch{return "";}})(),time:relTime(it.pubDate)})); } catch {}
  return null;
}

// ── Yahoo Finance fallback for stock quotes ──────────────────────────────────
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
  card:  { background:"#18181c", borderRadius:12, border:"1px solid rgba(255,255,255,0.06)", overflow:"hidden" },
  title: { fontSize:11, fontWeight:500, color:"#444", textTransform:"uppercase", letterSpacing:0.9 },
  dot:   { width:6, height:6, borderRadius:"50%", flexShrink:0, display:"inline-block" },
  badge: { fontSize:10, padding:"1px 6px", borderRadius:4, fontWeight:500 },
  chev:  { color:"#282830", fontSize:16, lineHeight:1, display:"inline-block", flexShrink:0, transition:"transform 0.2s" },
  inp:   { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:8, padding:"7px 10px", color:"#ccc", fontSize:12, outline:"none", fontFamily:"'DM Sans',sans-serif" },
  btn:   { background:"rgba(79,142,247,0.15)", border:"1px solid rgba(79,142,247,0.25)", borderRadius:8, color:"#4f8ef7", fontSize:12, padding:"7px 14px", cursor:"pointer", fontWeight:500, fontFamily:"'DM Sans',sans-serif" },
  skel:  w=>({ height:10, borderRadius:4, background:"rgba(255,255,255,0.05)", width:w+"%", animation:"pulse 1.5s ease infinite", marginBottom:8 }),
};

function DemoBadge() {
  return <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:"rgba(255,255,255,0.06)", color:"#333", fontFamily:"DM Mono,monospace", marginLeft:4 }}>demo</span>;
}
function ColButton({ col, current, onClick }) {
  const active = col===current;
  return (
    <button onClick={onClick} title={col==="left"?"Move to left column":"Move to right column"}
      style={{ background:"none", border:"none", cursor:"pointer", padding:"2px 4px", color:active?"#4f8ef7":"#252530", fontSize:10, lineHeight:1 }}>
      {col==="left"?"⬅":"➡"}
    </button>
  );
}

// ── Card shell ───────────────────────────────────────────────────────────────
function Shell({ color, title, sub, badge, expanded, onToggle, onMoveLeft, onMoveRight, col, children }) {
  return (
    <div style={C.card}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", cursor:"pointer", userSelect:"none" }} onClick={onToggle}>
        <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
          <span style={{ ...C.dot, background:color }} />
          <span style={C.title}>{title}</span>
          {sub && <span style={{ fontSize:10, color:"#333", fontFamily:"DM Mono,monospace" }}>{sub}</span>}
          {badge}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:2 }} onClick={e=>e.stopPropagation()}>
          <ColButton col="left"  current={col} onClick={onMoveLeft}  />
          <ColButton col="right" current={col} onClick={onMoveRight} />
          <span style={{ ...C.chev, transform:expanded?"rotate(90deg)":"rotate(0deg)", marginLeft:4 }} onClick={onToggle}>›</span>
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
function NewsWidget({ category, colorIdx, onUnreadChange }) {
  const color=catColor(category.label,colorIdx);
  const [items,setItems]=useState([]);
  const [demo,setDemo]=useState(false);
  const [status,setStatus]=useState("loading");
  const [readIds,setReadIds]=useState(new Set());
  const [expanded,setExpanded]=useState(true);
  const unread=items.filter(i=>!readIds.has(i.id)).length;

  useEffect(()=>{ onUnreadChange?.(unread); },[unread]);

  useEffect(()=>{
    if (!category.feeds?.length){setItems(mockForCategory(category.label));setDemo(true);setStatus("ok");return;}
    setStatus("loading");
    Promise.all(category.feeds.slice(0,2).map(f=>fetchRSS(f.url)))
      .then(results=>{
        const live=results.flat().filter(Boolean).filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i).slice(0,7);
        if(live.length){setItems(live);setDemo(false);setStatus("ok");}
        else{setItems(mockForCategory(category.label));setDemo(true);setStatus("ok");}
      }).catch(()=>{setItems(mockForCategory(category.label));setDemo(true);setStatus("ok");});
  },[category.label]);

  const badgeEl=status==="loading"
    ?<span style={{fontSize:10,color:"#333"}}>fetching…</span>
    :(status==="ok"&&unread>0&&!demo)?<span style={{...C.badge,background:color+"22",color}}>{unread}</span>:null;

  return { color, title:category.label, badge:badgeEl, expanded, onToggle:()=>setExpanded(e=>!e),
    content:(
      <div>
        {status==="loading"&&<Skel/>}
        {status==="ok"&&<div>{demo&&<DemoBadge/>}{items.map((item,i)=>(
          <div key={item.id} style={{padding:"8px 0",cursor:"pointer",opacity:readIds.has(item.id)?0.35:1,borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none"}}
            onClick={()=>{setReadIds(p=>new Set([...p,item.id]));if(item.link!=="#")window.open(item.link,"_blank");}}>
            <div style={{fontSize:12,color:"#a0a0a8",lineHeight:1.45,marginBottom:4}}>{item.title}</div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:10,color:"#2e2e38"}}>{item.source}</span>
              <span style={{fontSize:10,color:"#242430",fontFamily:"DM Mono,monospace"}}>{item.time}</span>
            </div>
          </div>
        ))}</div>}
      </div>
    )
  };
}

// ── Weather widget ───────────────────────────────────────────────────────────
function WeatherWidget() {
  const [wx,setWx]=useState(null);
  const [demo,setDemo]=useState(false);
  const [status,setStatus]=useState("loading");
  const [expanded,setExpanded]=useState(true);

  useEffect(()=>{
    const url=METEO+"?latitude=46.8123&longitude=-71.1756"
      +"&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
      +"&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min"
      +"&timezone=America%2FToronto&forecast_days=5";
    fetch(url).then(r=>r.ok?r.json():Promise.reject()).then(d=>{setWx(d);setDemo(false);setStatus("ok");})
      .catch(()=>fetch(PROXY1+encodeURIComponent(url)).then(r=>r.json()).then(d=>{setWx(d);setDemo(false);setStatus("ok");})
        .catch(()=>{setWx(MOCK_WX);setDemo(true);setStatus("ok");}));
  },[]);

  const cur=wx?.current, daily=wx?.daily, hourly=wx?.hourly;
  const nowIdx=hourly?Math.max(0,hourly.time.findIndex(t=>new Date(t)>new Date())-1):0;
  const [cond,icon]=cur?wmo(cur.weather_code):["","⛅"];

  return { color:"#f7c94f", title:"Weather", sub:"Lévis, QC", expanded, onToggle:()=>setExpanded(e=>!e),
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
                <div style={{fontSize:11,color:"#444",marginTop:2}}>{cond} · feels {Math.round(cur.apparent_temperature)}°</div>
              </div>
              <div style={{marginLeft:"auto",textAlign:"right"}}>
                <div style={{fontSize:11,color:"#333"}}>Humidity <span style={{color:"#777"}}>{cur.relative_humidity_2m}%</span></div>
                <div style={{fontSize:11,color:"#333",marginTop:2}}>Wind <span style={{color:"#777"}}>{Math.round(cur.wind_speed_10m)} km/h</span></div>
              </div>
            </div>
            {hourly&&(
              <div style={{display:"flex",gap:2,paddingBottom:8,borderBottom:"1px solid rgba(255,255,255,0.05)",overflowX:"auto"}}>
                {hourly.time.slice(nowIdx,nowIdx+6).map((t,i)=>{
                  const [,ic]=wmo(hourly.weather_code[nowIdx+i]);
                  return(
                    <div key={t} style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"5px 9px",borderRadius:8,background:i===0?"rgba(247,201,79,0.1)":"transparent"}}>
                      <span style={{fontSize:10,color:i===0?"#f7c94f":"#333"}}>{i===0?"Now":new Date(t).toLocaleTimeString("fr-CA",{hour:"2-digit",minute:"2-digit"})}</span>
                      <span style={{fontSize:14}}>{ic}</span>
                      <span style={{fontSize:11,color:"#aaa"}}>{Math.round(hourly.temperature_2m[nowIdx+i])}°</span>
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
                      <span style={{fontSize:12,color:"#444",width:44,textTransform:"capitalize"}}>{lbl}</span>
                      <span style={{fontSize:13,marginRight:8}}>{ic}</span>
                      <div style={{flex:1,display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                        <span style={{fontSize:12,color:"#333"}}>{Math.round(daily.temperature_2m_min[i])}°</span>
                        <div style={{height:3,borderRadius:2,background:"linear-gradient(90deg,#4f8ef7,#f7c94f)",width:38,opacity:0.3}}/>
                        <span style={{fontSize:12,color:"#bbb"}}>{Math.round(daily.temperature_2m_max[i])}°</span>
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

// ── Stocks widget — Finnhub primary, Yahoo Finance fallback ──────────────────
const TICKERS=["AAPL","MSFT","NVDA","SPY"];
function StocksWidget({ apiKey, onSaveKey }) {
  const [quotes,setQuotes]=useState({});
  const [demo,setDemo]=useState(false);
  const [source,setSource]=useState("");   // "finnhub" | "yahoo" | "demo"
  const [status,setStatus]=useState(apiKey?"loading":"yahoo");
  const [expanded,setExpanded]=useState(true);
  const [draft,setDraft]=useState("");

  useEffect(()=>{
    if (apiKey) {
      setStatus("loading");
      Promise.all(TICKERS.map(sym=>fetch(FINNHUB+"/quote?symbol="+sym+"&token="+apiKey).then(r=>r.json()).then(d=>[sym,d]).catch(()=>[sym,null])))
        .then(res=>{
          const m={};res.forEach(([sym,d])=>{if(d?.c)m[sym]=d;});
          if(Object.keys(m).length){setQuotes(m);setSource("finnhub");setStatus("ok");return;}
          return fetchYahoo();
        }).catch(fetchYahoo);
    } else {
      fetchYahoo();
    }
  },[apiKey]);

  function fetchYahoo() {
    setStatus("loading");
    Promise.all(TICKERS.map(sym=>fetchYahooQuote(sym).then(d=>[sym,d])))
      .then(res=>{
        const m={};res.forEach(([sym,d])=>{if(d?.c)m[sym]=d;});
        if(Object.keys(m).length){setQuotes(m);setSource("yahoo");setStatus("ok");}
        else{setQuotes(MOCK_STOCKS);setSource("demo");setDemo(true);setStatus("ok");}
      }).catch(()=>{setQuotes(MOCK_STOCKS);setSource("demo");setDemo(true);setStatus("ok");});
  }

  const subLabel = source==="finnhub"?"Finnhub":source==="yahoo"?"Yahoo Finance · no key":"demo";

  return { color:"#5cc8a8", title:"Stocks", sub:subLabel, expanded, onToggle:()=>setExpanded(e=>!e),
    content:(
      <div>
        {!apiKey&&status==="ok"&&source!=="demo"&&(
          <div style={{paddingBottom:8}}>
            <div style={{display:"flex",gap:6}}>
              <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Finnhub key for real-time data…" style={{...C.inp,flex:1,fontSize:11,fontFamily:"DM Mono,monospace"}}/>
              {draft&&<button onClick={()=>onSaveKey("finnhub",draft)} style={C.btn}>✓</button>}
            </div>
          </div>
        )}
        {status==="loading"&&<Skel n={4}/>}
        {status==="ok"&&(
          <div>
            {demo&&<DemoBadge/>}
            {TICKERS.map((sym,i)=>{
              const q=quotes[sym];if(!q)return null;
              const chg=q.c-(q.pc||q.c),pct=q.pc?((chg/q.pc)*100).toFixed(2):"0.00",up=chg>=0;
              return(
                <div key={sym} style={{display:"flex",alignItems:"center",padding:"7px 0",borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none"}}>
                  <span style={{fontSize:12,fontWeight:500,color:"#999",width:46,fontFamily:"DM Mono,monospace"}}>{sym}</span>
                  <div style={{flex:1,margin:"0 10px"}}>
                    <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,0.05)",overflow:"hidden"}}>
                      <div style={{height:"100%",width:Math.min(100,(q.c/(q.h||q.c))*100)+"%",background:up?"#5cc8a8":"#f77f4f",borderRadius:2}}/>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,color:"#ddd",fontFamily:"DM Mono,monospace"}}>${q.c.toFixed(2)}</div>
                    <div style={{fontSize:10,color:up?"#5cc8a8":"#f77f4f"}}>{up?"+":""}{pct}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )
  };
}

// ── Traffic widget ───────────────────────────────────────────────────────────
function TrafficWidget({ apiKey, onSaveKey }) {
  const [flow,setFlow]=useState(null);
  const [demo,setDemo]=useState(false);
  const [status,setStatus]=useState(apiKey?"loading":"nokey");
  const [expanded,setExpanded]=useState(true);
  const [draft,setDraft]=useState("");

  useEffect(()=>{
    if(!apiKey){setStatus("nokey");return;}
    setStatus("loading");
    fetch(TOMTOM+"?point=46.7900,-71.2900&key="+apiKey).then(r=>r.json())
      .then(d=>{if(d.flowSegmentData){setFlow(d.flowSegmentData);setDemo(false);setStatus("ok");}else{setFlow(MOCK_TRAFFIC);setDemo(true);setStatus("ok");}})
      .catch(()=>{setFlow(MOCK_TRAFFIC);setDemo(true);setStatus("ok");});
  },[apiKey]);

  const ratio=flow?Math.min(1,flow.currentSpeed/flow.freeFlowSpeed):0;
  const tColor=ratio>0.8?"#5cc8a8":ratio>0.5?"#f7c94f":"#f77f4f";
  const tLabel=ratio>0.8?"Free flow":ratio>0.5?"Moderate":"Heavy";

  return { color:"#f77f4f", title:"Traffic", sub:"TomTom · A-20 Lévis", expanded, onToggle:()=>setExpanded(e=>!e),
    content:(
      <div>
        {status==="nokey"&&(
          <div style={{paddingTop:8}}>
            <div style={{fontSize:11,color:"#3a3a44",lineHeight:1.6,marginBottom:8}}>Free key at <a href="https://developer.tomtom.com" target="_blank" rel="noreferrer">developer.tomtom.com</a></div>
            <div style={{display:"flex",gap:6}}>
              <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Paste TomTom key…" style={{...C.inp,flex:1,fontSize:11,fontFamily:"DM Mono,monospace"}}/>
              {draft&&<button onClick={()=>onSaveKey("tomtom",draft)} style={C.btn}>✓</button>}
            </div>
            <button onClick={()=>{setFlow(MOCK_TRAFFIC);setDemo(true);setStatus("ok");}} style={{marginTop:8,background:"none",border:"none",fontSize:11,color:"#333",cursor:"pointer",padding:0}}>Preview with demo data →</button>
          </div>
        )}
        {status==="loading"&&<Skel n={2}/>}
        {status==="ok"&&flow&&(
          <div>
            {demo&&<DemoBadge/>}
            <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                <span style={{fontSize:26,fontWeight:300,color:tColor,letterSpacing:-1}}>{Math.round(flow.currentSpeed)}<span style={{fontSize:11,color:"#444",marginLeft:2}}>km/h</span></span>
                <span style={{fontSize:11,color:"#333"}}>free flow {Math.round(flow.freeFlowSpeed)} km/h</span>
                <span style={{...C.badge,background:tColor+"22",color:tColor,marginLeft:"auto"}}>{tLabel}</span>
              </div>
              <div style={{marginTop:10,height:3,borderRadius:2,background:"rgba(255,255,255,0.06)",overflow:"hidden"}}>
                <div style={{height:"100%",width:(ratio*100)+"%",background:tColor,borderRadius:2,transition:"width 0.5s"}}/>
              </div>
              <div style={{fontSize:10,color:"#282830",marginTop:6}}>Confidence {Math.round((flow.confidence||0)*100)}%</div>
            </div>
          </div>
        )}
      </div>
    )
  };
}

// ── Widget renderer ──────────────────────────────────────────────────────────
function WidgetCard({ id, categories, apiKeys, onSaveKey, col, onMoveLeft, onMoveRight, colorIdx, onUnreadChange }) {
  const newsData    = id.startsWith("cat:") ? NewsWidget({ category: categories.find(c=>c.label===id.slice(4)), colorIdx, onUnreadChange }) : null;
  const weatherData = id==="weather" ? WeatherWidget() : null;
  const stocksData  = id==="stocks"  ? StocksWidget({ apiKey:apiKeys.finnhub, onSaveKey }) : null;
  const trafficData = id==="traffic" ? TrafficWidget({ apiKey:apiKeys.tomtom, onSaveKey }) : null;
  const d = newsData || weatherData || stocksData || trafficData;
  if (!d) return null;
  return (
    <Shell color={d.color} title={d.title} sub={d.sub} badge={d.badge}
      expanded={d.expanded} onToggle={d.onToggle}
      col={col} onMoveLeft={onMoveLeft} onMoveRight={onMoveRight}>
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
        style={{border:"1px dashed "+(dragging?"#4f8ef7":"rgba(255,255,255,0.1)"),borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragging?"rgba(79,142,247,0.06)":"rgba(255,255,255,0.02)",transition:"all 0.15s",marginBottom:16}}>
        <div style={{fontSize:26,marginBottom:10,opacity:0.45}}>📰</div>
        <div style={{fontSize:13,color:"#999",fontWeight:500,marginBottom:5}}>Drop your Feedly OPML here</div>
        <div style={{fontSize:11,color:"#333"}}>or click to browse</div>
        <input ref={fileRef} type="file" accept=".opml,.xml" style={{display:"none"}} onChange={e=>processFile(e.target.files[0])}/>
      </div>
      {error&&<div style={{fontSize:11,color:"#f77f4f",marginBottom:12}}>{error}</div>}
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"12px 14px"}}>
        <div style={{fontSize:10,color:"#444",fontWeight:500,textTransform:"uppercase",letterSpacing:0.8,marginBottom:8}}>How to export from Feedly</div>
        {[["1","Go to","feedly.com"],["2","Click avatar →","Organize"],["3","Scroll down →","Export OPML"]].map(([n,a,b])=>(
          <div key={n} style={{display:"flex",gap:8,marginBottom:5}}>
            <span style={{fontSize:10,color:"#2a2a34",width:14,fontFamily:"DM Mono,monospace",flexShrink:0}}>{n}</span>
            <span style={{fontSize:11,color:"#3a3a44"}}>{a} <span style={{color:"#666"}}>{b}</span></span>
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
          <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>News categories</div>
        {categories.map((cat,i)=>{
          const id="cat:"+cat.label,on=activeIds.includes(id),col=catColor(cat.label,i);
          return(
            <div key={cat.label} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
              <span style={{...C.dot,background:col}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:"#ccc"}}>{cat.label}</div>
                <div style={{fontSize:10,color:"#333"}}>{cat.feeds.length} feed{cat.feeds.length!==1?"s":""}</div>
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
                <div style={{fontSize:13,color:"#ccc"}}>{w.label}</div>
                <div style={{fontSize:10,color:"#333"}}>{w.note}</div>
              </div>
              <button onClick={()=>setActiveIds(p=>on?p.filter(x=>x!==w.id):[...p,w.id])}
                style={{border:"1px solid",borderRadius:6,fontSize:11,padding:"3px 10px",cursor:"pointer",fontWeight:500,fontFamily:"'DM Sans',sans-serif",background:on?w.color+"22":"rgba(255,255,255,0.05)",color:on?w.color:"#444",borderColor:on?w.color+"44":"rgba(255,255,255,0.08)"}}>
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
function SettingsModal({ onClose }) {
  const [autostart, setAutostart] = useState(false);
  useEffect(()=>{ api.autostart?.get().then(v=>setAutostart(!!v)); },[]);
  function toggleAutostart() {
    const next=!autostart;
    setAutostart(next);
    api.autostart?.set(next);
    api.store.set('wp-autostart', next ? '1' : '');
  }
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:280}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:14,fontWeight:500,color:"#e0e0e0"}}>Settings</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div>
            <div style={{fontSize:13,color:"#ccc"}}>Start with Windows</div>
            <div style={{fontSize:10,color:"#333",marginTop:2}}>Launch panel on login</div>
          </div>
          <button onClick={toggleAutostart} style={{
            width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",transition:"background 0.2s",position:"relative",
            background:autostart?"#4f8ef7":"rgba(255,255,255,0.1)"
          }}>
            <span style={{position:"absolute",top:2,left:autostart?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",display:"block"}}/>
          </button>
        </div>
        <div style={{fontSize:10,color:"#282830",marginTop:16,lineHeight:1.5}}>
          Panel position: left edge · Win+W to toggle
        </div>
      </div>
    </div>
  );
}

// ── Taskbar notification rotator ──────────────────────────────────────────────
// Cycles through a digest of live data snippets every 8s in a tooltip-style strip
// and sends badge counts to main via IPC.
function useNotificationRotator(snippets, totalUnread) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  // Rotate displayed snippet every 8 seconds if there are any
  useEffect(()=>{
    if (!snippets.length) { setVisible(false); return; }
    setVisible(true);
    const t = setInterval(()=>setIdx(i=>(i+1)%snippets.length), 8000);
    return ()=>clearInterval(t);
  },[snippets.length]);

  // Push badge to taskbar button
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
  const [showSettings, setShowSettings] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [pinned,       setPinned]       = useState(false);
  const [time,         setTime]         = useState(new Date());

  // Unread counts per widget id
  const [unreadMap, setUnreadMap] = useState({});
  const totalUnread = Object.values(unreadMap).reduce((a,b)=>a+b, 0);

  // Notification snippets — short strings rotated in the header ticker
  const [snippets, setSnippets] = useState([]);

  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return ()=>clearInterval(t); },[]);

  // Load persisted config
  useEffect(()=>{
    storageLoad().then(saved=>{
      if (saved?.categories?.length) {
        setCategories(saved.categories);
        setActiveIds(saved.activeIds||[]);
        setColumns(saved.columns||{});
        setApiKeys(saved.apiKeys||{});
      }
      setStorageReady(true);
    });
    // Restore pin state
    api.pin?.get().then(p=>setPinned(!!p));
    // Listen for pin changes from tray menu
    api.pin?.onChange(p=>setPinned(!!p));
  },[]);

  // Persist on change
  useEffect(()=>{
    if (!storageReady || !categories) return;
    storageSave({ categories, activeIds, columns, apiKeys });
  },[categories, activeIds, columns, apiKeys, storageReady]);

  // Build notification snippets when unread changes
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
    const cols={};
    // Left column: system widgets; Right column: news — ergonomic for left-edge panel
    cols.weather="left"; cols.stocks="left"; cols.traffic="left";
    cats.forEach(c=>{ cols["cat:"+c.label]="right"; });
    setCategories(cats); setActiveIds(defaults); setColumns(cols);
  }

  function saveKey(service, key) {
    setApiKeys(p=>({...p,[service]:key}));
    setActiveIds(p=>p.includes(service)?p:[...p,service]);
  }

  function moveWidget(id, dir) { setColumns(p=>({...p,[id]:dir})); }

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
  const leftIds  = activeIds.filter(id=>(columns[id]||"left")==="left");
  const rightIds = activeIds.filter(id=>(columns[id]||"right")==="right");
  const newsIds  = activeIds.filter(id=>id.startsWith("cat:"));

  const onUnread = useCallback((id, count)=>{
    setUnreadMap(p=>({...p,[id]:count}));
  },[]);

  if (!storageReady) return (
    <div style={{display:"flex",height:"100vh",alignItems:"center",justifyContent:"center",background:"#0a0a0c",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{fontSize:11,color:"#333"}}>Loading…</div>
    </div>
  );

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"'DM Sans',sans-serif",background:"#0a0a0c"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:.18}50%{opacity:.44}}
        @keyframes ticker{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .wi{animation:fadeIn 0.2s ease both}
        input{color-scheme:dark}
        a{color:#4f8ef7}
      `}</style>

      {/* ── Two-column panel — fills full width on left edge ── */}
      <div style={{width:680,display:"flex",flexDirection:"column",background:"#111114",borderRight:"1px solid rgba(255,255,255,0.06)",overflow:"hidden"}}>

        {/* Header */}
        <div style={{padding:"18px 20px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexShrink:0}}>
          <div>
            <div style={{fontSize:28,fontWeight:300,color:"#f0f0f0",letterSpacing:-1,lineHeight:1,fontFamily:"'DM Mono',monospace"}}>
              {String(time.getHours()).padStart(2,"0")}:{String(time.getMinutes()).padStart(2,"0")}
            </div>
            <div style={{fontSize:10,color:"#222",marginTop:4,textTransform:"capitalize"}}>
              {time.toLocaleDateString("fr-CA",{weekday:"long",month:"long",day:"numeric"})}
            </div>
            {/* Notification ticker */}
            {tickerVisible && snippet && (
              <div key={snippet} style={{fontSize:10,color:"#3a3a50",marginTop:6,fontFamily:"DM Mono,monospace",animation:"ticker 0.3s ease both"}}>
                {totalUnread > 0 && <span style={{color:"#4f8ef7",marginRight:6}}>●</span>}{snippet}
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:4,alignItems:"center",marginTop:2}}>
            {/* Pin button */}
            <button onClick={togglePin} title={pinned?"Unpin — float above apps":"Pin to desktop layer"}
              style={{background:pinned?"rgba(79,142,247,0.15)":"none",border:pinned?"1px solid rgba(79,142,247,0.25)":"1px solid transparent",
                borderRadius:6,color:pinned?"#4f8ef7":"#2a2a30",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}>
              📌
            </button>
            {loaded&&<button onClick={()=>setShowMgr(true)} title="Manage widgets"
              style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#2a2a30",fontSize:15,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>⚙</button>}
            <button onClick={()=>setShowSettings(true)} title="Settings"
              style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#1c1c22",fontSize:13,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>≡</button>
            {loaded&&<button onClick={reset} title="Reset / new OPML"
              style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#1c1c22",fontSize:13,cursor:"pointer",padding:"3px 6px",lineHeight:1}}>↺</button>}
          </div>
        </div>

        {/* Body */}
        {!loaded && <OPMLDrop onLoaded={handleOPML} />}

        {loaded && (
          <div style={{flex:1,overflow:"hidden",display:"flex",gap:0}}>
            {/* Left column — system widgets by default */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 8px 12px 12px",display:"flex",flexDirection:"column",gap:8,borderRight:"1px solid rgba(255,255,255,0.04)"}}>
              <div style={{fontSize:9,color:"#1e1e28",textTransform:"uppercase",letterSpacing:1.5,fontFamily:"DM Mono,monospace",marginBottom:2,paddingLeft:2}}>Left</div>
              {leftIds.map((id,i)=>(
                <div key={id} className="wi" style={{animationDelay:(i*25)+"ms"}}>
                  <WidgetCard id={id} categories={categories||[]} apiKeys={apiKeys} onSaveKey={saveKey}
                    col="left" onMoveLeft={()=>moveWidget(id,"left")} onMoveRight={()=>moveWidget(id,"right")}
                    colorIdx={newsIds.indexOf(id)}
                    onUnreadChange={count=>onUnread(id,count)}
                  />
                </div>
              ))}
              {leftIds.length===0&&(
                <div style={{textAlign:"center",color:"#1e1e28",fontSize:11,marginTop:40}}>⬅ Move widgets here</div>
              )}
            </div>

            {/* Right column — news by default */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 12px 12px 8px",display:"flex",flexDirection:"column",gap:8}}>
              <div style={{fontSize:9,color:"#1e1e28",textTransform:"uppercase",letterSpacing:1.5,fontFamily:"DM Mono,monospace",marginBottom:2,paddingLeft:2}}>Right</div>
              {rightIds.map((id,i)=>(
                <div key={id} className="wi" style={{animationDelay:(i*25)+"ms"}}>
                  <WidgetCard id={id} categories={categories||[]} apiKeys={apiKeys} onSaveKey={saveKey}
                    col="right" onMoveLeft={()=>moveWidget(id,"left")} onMoveRight={()=>moveWidget(id,"right")}
                    colorIdx={newsIds.indexOf(id)}
                    onUnreadChange={count=>onUnread(id,count)}
                  />
                </div>
              ))}
              {rightIds.length===0&&(
                <div style={{textAlign:"center",color:"#1e1e28",fontSize:11,marginTop:40}}>➡ Move widgets here</div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {loaded&&(
          <div style={{padding:"8px 16px",borderTop:"1px solid rgba(255,255,255,0.04)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <span style={{fontSize:9,color:"#1a1a22",fontFamily:"DM Mono,monospace"}}>{categories.length} categories · OPML</span>
            <button onClick={()=>setShowMgr(true)} style={{background:"none",border:"1px solid rgba(255,255,255,0.06)",color:"#282832",fontSize:10,padding:"3px 8px",borderRadius:5,cursor:"pointer"}}>+ Add widget</button>
          </div>
        )}
      </div>

      {/* Fake desktop — visible to the right of the panel */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",opacity:0.07}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#666",letterSpacing:2,textTransform:"uppercase"}}>Desktop</div>
          <div style={{fontSize:9,color:"#444",marginTop:3}}>Windows 11 · 25H2</div>
        </div>
      </div>

      {showMgr&&loaded&&<CategoryManager categories={categories} activeIds={activeIds} setActiveIds={setActiveIds} onClose={()=>setShowMgr(false)} onReset={reset}/>}
      {showSettings&&<SettingsModal onClose={()=>setShowSettings(false)}/>}
    </div>
  );
}
