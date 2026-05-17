import { useState, useEffect, useRef, useCallback } from "react";
import WidgetFrame from "./ui/WidgetFrame.jsx";
import { C } from "./ui/theme.js";
import {
  SK_AUTOSTART,
  SK_CARD_OPACITY,
  SK_COLW,
  SK_EXPANDED,
  SK_LOCATION,
  SK_OPACITY,
  SK_PINNED,
  SK_PINNED_OPACITY,
  SK_TV_SYMBOLS,
} from "./config/storageKeys.js";
import { SYS, SYSTEM_WIDGET_ID_SET, WORKSTATION_WIDGET_ID_SET, defaultColumns, getColumnForWidget, isKnownWidgetId } from "./config/widgets.js";
import { api } from "./services/electronApi.js";
import { playCardCollapseSound, playCardExpandSound, playPanelInSound, playPanelOutSound } from "./services/sound.service.js";
import { storageLoad, storageSave } from "./services/storage.service.js";
import CalendarWidget from "./widgets/calendar/CalendarWidget.jsx";
import CameraWidget from "./widgets/camera/CameraWidget.jsx";
import ClockWidget from "./widgets/clock/ClockWidget.jsx";
import EuronewsWidget from "./widgets/euronews/EuronewsWidget.jsx";
import { AgendaWidget, MailWidget, TodoWidget } from "./widgets/microsoft/MicrosoftWidgets.jsx";
import NewsWidget from "./widgets/news/NewsWidget.jsx";
import { parseOPML } from "./widgets/news/news.service.js";
import { getNewsCategoryColor } from "./widgets/news/news.theme.js";
import StocksWidget from "./widgets/stocks/StocksWidget.jsx";
import { DEFAULT_TV_SYMBOLS } from "./widgets/stocks/stocks.constants.js";
import TrafficWidget from "./widgets/traffic/TrafficWidget.jsx";
import WeatherWidget from "./widgets/weather/WeatherWidget.jsx";
import { CpuWidget, DiskWidget, GpuWidget, NetworkWidget, RamWidget } from "./widgets/workstation/WorkstationWidgets.jsx";
import { DEFAULT_LOC } from "./widgets/weather/weather.constants.js";

function hexToRgb(hex) {
  const h = hex.replace('#','')
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`
}

// ── API endpoints ────────────────────────────────────────────────────────────
const PRESSREADER_URL = "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog/featured";
const DEFAULT_COL_WIDTHS = { left: 220, monitor: 220, mid: 240, feed: 260 };

// ── Widget renderer ──────────────────────────────────────────────────────────
function NewsWidgetCard(props) {
  const category = props.categories.find(c => c.label === props.id.slice(4));
  const data = category
    ? NewsWidget({ category, colorIdx: props.colorIdx, onUnreadChange: props.onUnreadChange, onOpenUrl: props.onOpenUrl })
    : null;
  return <WidgetFrame data={data} {...props} />;
}

function WeatherWidgetCard(props) {
  const data = WeatherWidget({ location: props.location });
  return <WidgetFrame data={data} {...props} />;
}

function StocksWidgetCard(props) {
  const data = StocksWidget();
  return <WidgetFrame data={data} {...props} />;
}

function CalendarWidgetCard(props) {
  const data = CalendarWidget();
  return <WidgetFrame data={data} {...props} />;
}

function TrafficWidgetCard(props) {
  const data = TrafficWidget({ location: props.location, apiKey: props.apiKeys?.traffic || '' });
  return <WidgetFrame data={data} {...props} />;
}

function ClockWidgetCard(props) {
  const data = ClockWidget();
  return <WidgetFrame data={data} {...props} />;
}

function AgendaWidgetCard(props) {
  const data = AgendaWidget();
  return <WidgetFrame data={data} {...props} />;
}

function MailWidgetCard(props) {
  const data = MailWidget();
  return <WidgetFrame data={data} {...props} />;
}

function CameraWidgetCard(props) {
  const data = CameraWidget();
  return <WidgetFrame data={data} {...props} />;
}

function TodoWidgetCard(props) {
  const data = TodoWidget();
  return <WidgetFrame data={data} {...props} />;
}

function EuronewsWidgetCard(props) {
  const data = EuronewsWidget({ expanded: props.expanded });
  return <WidgetFrame data={data} {...props} />;
}

function CpuWidgetCard(props) {
  const data = CpuWidget();
  return <WidgetFrame data={data} {...props} />;
}

function GpuWidgetCard(props) {
  const data = GpuWidget();
  return <WidgetFrame data={data} {...props} />;
}

function RamWidgetCard(props) {
  const data = RamWidget();
  return <WidgetFrame data={data} {...props} />;
}

function DiskWidgetCard(props) {
  const data = DiskWidget();
  return <WidgetFrame data={data} {...props} />;
}

function NetworkWidgetCard(props) {
  const data = NetworkWidget();
  return <WidgetFrame data={data} {...props} />;
}

const WIDGET_CARD_COMPONENTS = {
  weather: WeatherWidgetCard,
  traffic: TrafficWidgetCard,
  stocks: StocksWidgetCard,
  calendar: CalendarWidgetCard,
  clock: ClockWidgetCard,
  agenda: AgendaWidgetCard,
  mail: MailWidgetCard,
  camera: CameraWidgetCard,
  todo: TodoWidgetCard,
  euronews: EuronewsWidgetCard,
  'workstation-cpu': CpuWidgetCard,
  'workstation-gpu': GpuWidgetCard,
  'workstation-ram': RamWidgetCard,
  'workstation-disk': DiskWidgetCard,
  'workstation-network': NetworkWidgetCard,
};

// Widget renderer
function WidgetCard(props) {
  if (props.id.startsWith('cat:')) return <NewsWidgetCard {...props} />;
  const Component = WIDGET_CARD_COMPONENTS[props.id];
  return Component ? <Component {...props} /> : null;
}

// OPML drop screen
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

function ArticleReaderCard({ reader, onClose, onOpenExternal }) {
  const [progress, setProgress] = useState(12);
  const loading = reader.status === 'loading';
  const article = reader.article || {};
  const title = loading ? (reader.seed?.title || 'Preparing reader view') : (article.title || 'Reader view');
  const source = article.source || reader.seed?.source || '';
  const sourceLabel = article.sourceLabel === 'archive.org' ? 'archive.org snapshot' : 'direct source';
  const paragraphs = article.paragraphs || [];
  const hero = article.image || reader.seed?.image || '';

  useEffect(() => {
    if (!loading) { setProgress(reader.status === 'ready' ? 100 : 92); return; }
    setProgress(12);
    const timer = setInterval(() => {
      setProgress(value => Math.min(88, value + Math.max(2, (90 - value) * 0.12)));
    }, 180);
    return () => clearInterval(timer);
  }, [loading, reader.url, reader.status]);

  return (
    <div className="reader-stage">
      <article className="reader-card">
        <div className="reader-card-glow" />
        <div className="reader-topbar">
          <div className="reader-source">
            <span className="reader-dot" />
            <span>{source || 'Reader mode'}</span>
            {!loading && <span className="reader-source-mode">{sourceLabel}</span>}
          </div>
          <div className="reader-actions">
            <button className="reader-icon-button" onClick={() => onOpenExternal(reader.url)} title="Open in default browser">↗</button>
            <button className="reader-icon-button" onClick={onClose} title="Close">X</button>
          </div>
        </div>

        <div className="reader-progress-track" aria-hidden="true">
          <div className="reader-progress-fill" style={{ width: `${progress}%`, opacity: loading ? 1 : 0.55 }} />
        </div>

        <div className="reader-content">
          <div className="reader-copy">
            <h1>{title}</h1>
            {!loading && article.description && <p className="reader-deck">{article.description}</p>}
            {loading && (
              <div className="reader-loading">
                <div className="reader-scanline" />
                <div>
                  <div className="reader-loading-title">Fetching and purifying article content</div>
                  <div className="reader-loading-text">Removing menus, ads, trackers, duplicate links, and layout noise.</div>
                </div>
              </div>
            )}
            {!loading && reader.status === 'error' && (
              <div className="reader-error">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {article.paywall ? 'Subscription required.' : 'Reader extraction could not complete.'}
                </div>
                <div>{reader.error || article.error || 'The page resisted automatic cleanup.'}</div>
                {article.paywall && paragraphs.map((paragraph, index) => (
                  <p key={index} style={{ marginTop: 12, marginBottom: 0 }}>{paragraph}</p>
                ))}
                <button className="reader-open-fallback" onClick={() => onOpenExternal(reader.url)}>Open original article</button>
              </div>
            )}
            {!loading && reader.status === 'ready' && paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <aside className="reader-media">
            {hero ? (
              <img src={hero} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="reader-image-placeholder">Reader</div>
            )}
            {!loading && (
              <div className="reader-meta">
                <div><span>Paragraphs</span><strong>{paragraphs.length || '--'}</strong></div>
                <div><span>Images</span><strong>{article.images?.length || 0}</strong></div>
                <div><span>Mode</span><strong>{article.sourceLabel === 'archive.org' ? 'Archive' : 'Direct'}</strong></div>
              </div>
            )}
          </aside>
        </div>
      </article>
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
                const id="cat:"+cat.label,on=activeIds.includes(id),col=getNewsCategoryColor(cat.label,i);
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
    api.autostart?.set(next); api.store.set(SK_AUTOSTART, next ? '1' : '');
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
  const [reader, setReader] = useState({ open: false, status: 'idle', url: '', seed: null, article: null, error: '' });

  // Column widths: fixed lanes plus a flexible right column.
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  const colWidthsRef = useRef(DEFAULT_COL_WIDTHS);
  const panelBgRef = useRef(null);
  const storageReadyRef = useRef(false);
  const pendingShowRef  = useRef(false);
  const readerRequestRef = useRef(0);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Expand/collapse state per widget id — persisted
  const [expandedMap, setExpandedMap] = useState({});

  function getExpanded(id)   { return expandedMap[id] !== false; }
  function toggleExpanded(id) {
    setExpandedMap(p => {
      const wasExpanded = p[id] !== false;
      if (wasExpanded) playCardCollapseSound();
      else playCardExpandSound();
      return { ...p, [id]: !wasExpanded };
    });
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

  function openBrowser(target) {
    const seed = typeof target === 'string' ? null : target;
    const url = typeof target === 'string' ? target : target?.link;
    if (!url) return;
    const requestId = readerRequestRef.current + 1;
    readerRequestRef.current = requestId;
    setReader({ open: true, status: 'loading', url, seed, article: null, error: '' });
    api.reader?.fetch?.(url).then(article => {
      if (readerRequestRef.current !== requestId) return;
      if (article?.ok) setReader({ open: true, status: 'ready', url, seed, article, error: '' });
      else setReader({ open: true, status: 'error', url, seed, article, error: article?.error || 'Reader extraction failed.' });
    }).catch(error => {
      if (readerRequestRef.current !== requestId) return;
      setReader({ open: true, status: 'error', url, seed, article: null, error: error?.message || 'Reader extraction failed.' });
    });
  }

  function closeReader() {
    readerRequestRef.current += 1;
    setReader({ open: false, status: 'idle', url: '', seed: null, article: null, error: '' });
  }

  function openReaderExternal(url) {
    if (url) api.reader?.openExternal?.(url);
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
      playPanelInSound();
      if (storageReadyRef.current) setVisible(true);
      else pendingShowRef.current = true;
    });
    panelApi.onHide(() => {
      playPanelOutSound();
      setVisible(false);
      setShowSettings(false);
      setShowMgr(false);
      closeReader();
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
  function getColFor(id) {
    return getColumnForWidget(id, columns);
  }

  // ── Load persisted config ────────────────────────────────────────────────
  useEffect(()=>{
    // Load visual settings first so panel renders at correct opacity/card-opacity immediately
    Promise.all([
      storageLoad(),
      api.store.get(SK_OPACITY),
      api.store.get(SK_CARD_OPACITY),
      api.store.get(SK_PINNED_OPACITY),
      api.store.get(SK_LOCATION),
    ]).then(([saved, opv, cardv, pinnedv, locv]) => {
      if (saved?.categories?.length) {
        setCategories(saved.categories);
        // Strip orphan IDs (e.g. 'pressreader' left over from earlier sessions
        // when it was a widget). KNOWN_SYS in the column-split logic also
        // filters these out at render time, but persisting them clean here
        // means they stop being written back to wp-config.
        const knownCats = new Set((saved.categories||[]).map(c => 'cat:' + c.label));
        const cleaned = (saved.activeIds||[]).filter(id => SYSTEM_WIDGET_ID_SET.has(id) || knownCats.has(id));
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
        // Migrate workstation cards into the new telemetry lane once. After
        // that, manual drag/drop placement is preserved by the saved columns.
        const hasMonitor = Object.values(finalCols).some(v => v === "monitor");
        if (!hasMonitor) {
          for (const id of WORKSTATION_WIDGET_ID_SET) {
            finalCols[id] = "monitor";
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
      api.store.get(SK_TV_SYMBOLS).then(v => {
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
        const merged = { ...DEFAULT_COL_WIDTHS, ...p };
        setColWidths(merged);
        colWidthsRef.current = merged;
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
    api.store.set(SK_OPACITY, String(opacity));
  },[opacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_CARD_OPACITY, String(cardOpacity));
    document.documentElement.style.setProperty('--card-bg', `rgba(38,40,50,${cardOpacity})`);
  },[cardOpacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_PINNED_OPACITY, String(pinnedOpacity));
  },[pinnedOpacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_LOCATION, JSON.stringify(location));
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
    api.store.set(SK_PINNED, next ? '1' : '');
  }

  const loaded = !!categories;
  // Filter out IDs that don't map to a known widget type — e.g. an old
  // 'pressreader' or removed cat:* left over in saved activeIds. Without
  // this, WidgetCard returns null but renderCol still renders the wrapping
  // .wi div, taking up space in whichever column the phantom ID was placed.
  const visibleIds = activeIds.filter(id => isKnownWidgetId(id, categories));
  const leftIds  = visibleIds.filter(id => getColFor(id) === "left");
  const monitorIds = visibleIds.filter(id => getColFor(id) === "monitor");
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

  const panelAlpha = pinned ? pinnedOpacity : opacity;
  const panelLowAlpha = Math.max(0.18, panelAlpha - 0.14);
  const panelGlowAlpha = Math.min(0.16, Math.max(0.035, panelAlpha * 0.13));
  const acrylicCardTopAlpha = Math.max(0.18, Math.min(0.62, cardOpacity * 0.46));
  const acrylicCardBottomAlpha = Math.max(0.14, Math.min(0.48, cardOpacity * 0.34));

  return (
    <div style={{
      display:"flex",height:"100vh",fontFamily:"'DM Sans',sans-serif",background:"transparent",overflow:"hidden",
      "--accent":accentColor,
      "--acrylic-card-top":`rgba(10,18,34,${acrylicCardTopAlpha})`,
      "--acrylic-card-bottom":`rgba(8,10,18,${acrylicCardBottomAlpha})`
    }}>
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
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.20), rgba(31,111,255,0.25), rgba(244,250,255,0.16), transparent);
          transition:background 0.15s;
          position:relative;z-index:10;
        }
        .resize-handle:hover,.resize-handle:active{
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.40), rgba(31,111,255,0.48), rgba(244,250,255,0.28), transparent);
        }
        .col-divider{
          width:4px;flex-shrink:0;cursor:col-resize;
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.12), rgba(31,111,255,0.18), rgba(244,250,255,0.08), transparent);
          transition:background 0.15s;
          user-select:none;
        }
        .col-divider:hover{
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.26), rgba(31,111,255,0.34), rgba(244,250,255,0.18), transparent);
        }
        .panel-surface{
          position:relative;
        }
        .panel-surface::before{
          content:"";
          position:absolute;
          inset:0;
          pointer-events:none;
          border:1px solid rgba(238,248,255,0.48);
          box-shadow:
            inset 0 0 0 1px rgba(31,111,255,0.16),
            inset 0 1px 0 rgba(255,255,255,0.24),
            0 0 18px rgba(31,111,255,0.14);
          z-index:2;
        }
        .panel-surface::after{
          content:"";
          position:absolute;
          left:18px;right:18px;top:0;height:1px;
          pointer-events:none;
          background:linear-gradient(90deg, transparent, rgba(31,111,255,0.55), rgba(255,255,255,0.78), rgba(31,111,255,0.55), transparent);
          box-shadow:0 0 12px rgba(31,111,255,0.34);
          opacity:.56;
          z-index:3;
        }
        .panel-chrome-button{
          width:24px;
          height:24px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          border-radius:6px;
          border:1px solid rgba(122,178,255,0.24);
          background:rgba(31,111,255,0.045);
          color:rgba(235,247,255,0.86);
          cursor:pointer;
          padding:0;
          line-height:1;
          transition:background .15s,border-color .15s,box-shadow .15s,color .15s,transform .15s;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,0.035);
          text-shadow:0 0 8px rgba(31,111,255,0.34);
        }
        .panel-chrome-button:hover{
          border-color:rgba(190,224,255,0.64);
          background:rgba(31,111,255,0.14);
          color:#fff;
          box-shadow:0 0 14px rgba(31,111,255,0.24), inset 0 0 0 1px rgba(255,255,255,0.08);
        }
        .panel-chrome-button:active{
          transform:translateY(1px);
          background:rgba(31,111,255,0.20);
        }
        .panel-chrome-button.is-active{
          border-color:rgba(230,246,255,0.72);
          background:rgba(31,111,255,0.18);
          color:#fff;
          box-shadow:0 0 16px rgba(31,111,255,0.30), inset 0 0 0 1px rgba(255,255,255,0.11);
        }
        @keyframes readerZoom{
          from{opacity:0;transform:scale(.965) translateY(12px);filter:blur(8px)}
          to{opacity:1;transform:scale(1) translateY(0);filter:none}
        }
        @keyframes readerSweep{
          from{transform:translateX(-130%)}
          to{transform:translateX(130%)}
        }
        .reader-stage{
          flex:1;min-width:0;overflow:hidden;padding:0 10px 12px 6px;
          display:flex;flex-direction:column;
        }
        .reader-card{
          position:relative;flex:1;min-height:0;overflow:hidden;border-radius:8px;
          border:1px solid rgba(238,248,255,.58);
          background:
            linear-gradient(145deg, rgba(10,18,34,.74), rgba(5,9,18,.60)),
            radial-gradient(circle at 85% 12%, rgba(47,109,255,.20), transparent 28%);
          box-shadow:
            0 0 0 1px rgba(47,109,255,.22),
            0 18px 46px rgba(0,0,0,.30),
            0 0 38px rgba(47,109,255,.16),
            inset 0 1px 0 rgba(255,255,255,.18),
            inset 0 0 0 1px rgba(255,255,255,.08);
          backdrop-filter:blur(28px) saturate(180%);
          -webkit-backdrop-filter:blur(28px) saturate(180%);
          animation:readerZoom 260ms cubic-bezier(.22,1,.36,1) both;
        }
        .reader-card-glow{
          position:absolute;left:24px;right:24px;top:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(47,109,255,.74),rgba(255,255,255,.88),rgba(47,109,255,.74),transparent);
          box-shadow:0 0 18px rgba(47,109,255,.42);pointer-events:none;
        }
        .reader-topbar{
          height:42px;display:flex;align-items:center;justify-content:space-between;
          padding:0 12px 0 14px;border-bottom:1px solid rgba(247,250,255,.10);
        }
        .reader-source{display:flex;align-items:center;gap:8px;color:#f7faff;font-size:11px;min-width:0}
        .reader-dot{width:7px;height:7px;border-radius:50%;background:#2f6dff;box-shadow:0 0 12px rgba(47,109,255,.9);flex-shrink:0}
        .reader-source-mode{color:rgba(247,250,255,.55);font-family:'DM Mono',monospace;font-size:9px}
        .reader-actions{display:flex;gap:6px;flex-shrink:0}
        .reader-icon-button{
          width:25px;height:25px;border-radius:6px;border:1px solid rgba(238,248,255,.36);
          background:rgba(47,109,255,.10);color:#f7faff;cursor:pointer;font-size:12px;
          display:flex;align-items:center;justify-content:center;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 0 12px rgba(47,109,255,.14);
          transition:background .15s,border-color .15s,box-shadow .15s,transform .15s;
        }
        .reader-icon-button:hover{
          background:rgba(47,109,255,.22);border-color:rgba(255,255,255,.70);
          box-shadow:0 0 18px rgba(47,109,255,.30),inset 0 0 0 1px rgba(255,255,255,.10);
        }
        .reader-icon-button:active{transform:translateY(1px)}
        .reader-progress-track{height:2px;background:rgba(255,255,255,.06);overflow:hidden}
        .reader-progress-fill{
          height:100%;background:linear-gradient(90deg,rgba(47,109,255,.20),rgba(238,248,255,.95),rgba(47,109,255,.70));
          box-shadow:0 0 14px rgba(47,109,255,.58);transition:width .22s ease,opacity .35s;
        }
        .reader-content{height:calc(100% - 44px);display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px;padding:18px;overflow:hidden}
        .reader-copy{min-width:0;overflow-y:auto;padding-right:8px}
        .reader-copy h1{font-size:26px;line-height:1.08;color:#fff;font-weight:650;margin-bottom:12px;letter-spacing:0}
        .reader-copy p{font-size:14px;line-height:1.72;color:rgba(247,250,255,.88);margin:0 0 13px}
        .reader-deck{font-size:15px!important;color:rgba(247,250,255,.68)!important;line-height:1.55!important;margin-bottom:18px!important}
        .reader-media{min-width:0;display:flex;flex-direction:column;gap:10px}
        .reader-media img,.reader-image-placeholder{
          width:100%;aspect-ratio:4/3;border-radius:7px;object-fit:cover;
          border:1px solid rgba(238,248,255,.22);background:rgba(255,255,255,.05);
          box-shadow:0 0 20px rgba(47,109,255,.12);
        }
        .reader-image-placeholder{display:flex;align-items:center;justify-content:center;color:rgba(247,250,255,.38);font-family:'DM Mono',monospace;font-size:12px}
        .reader-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
        .reader-meta div{border:1px solid rgba(247,250,255,.10);background:rgba(255,255,255,.035);border-radius:6px;padding:7px 6px}
        .reader-meta span{display:block;color:rgba(247,250,255,.54);font-size:8.5px;text-transform:uppercase}
        .reader-meta strong{display:block;color:#fff;font-family:'DM Mono',monospace;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .reader-loading{
          position:relative;margin-top:20px;border:1px solid rgba(238,248,255,.18);border-radius:8px;
          background:rgba(47,109,255,.055);padding:18px;overflow:hidden;color:#f7faff;
        }
        .reader-scanline{
          position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(238,248,255,.16),transparent);
          animation:readerSweep 1.25s linear infinite;
        }
        .reader-loading-title{position:relative;font-size:14px;font-weight:650;margin-bottom:5px}
        .reader-loading-text{position:relative;font-size:11px;color:rgba(247,250,255,.62)}
        .reader-error{
          border:1px solid rgba(255,255,255,.18);background:rgba(47,109,255,.07);
          border-radius:8px;padding:16px;color:rgba(247,250,255,.82);font-size:13px;line-height:1.5;
        }
        .reader-open-fallback{
          margin-top:12px;border-radius:6px;border:1px solid rgba(238,248,255,.42);
          background:rgba(47,109,255,.14);color:#fff;font-size:11px;padding:7px 10px;cursor:pointer;
        }
      `}</style>

      {/* ── Sliding wrapper ── */}
      <div className={`panel-wrap${visible?" open":""}`}
           style={{display:"flex",flexDirection:"row",height:"100vh",
                   width: browserPane.open ? browserPane.braveX : '100vw'}}>

        {/* ── Panel content ── */}
        <div ref={panelBgRef} className="panel-surface" style={{
          flex:"0 0 auto",
          width: browserPane.open ? browserPane.braveX : '100vw',
          overflow:"hidden",
          display:"flex",flexDirection:"row",
          background:[
            `linear-gradient(145deg, rgba(48,58,88,${Math.min(0.42, panelAlpha * 0.58)}), rgba(10,16,30,${Math.min(0.30, panelLowAlpha * 0.76)}))`,
            `radial-gradient(circle at 88% 96%, rgba(31,111,255,${panelGlowAlpha}), transparent 25%)`,
            `radial-gradient(circle at 8% 2%, rgba(255,255,255,0.10), transparent 18%)`,
            `linear-gradient(90deg, rgba(255,255,255,0.10), transparent 16%, transparent 84%, rgba(255,255,255,0.055))`
          ].join(','),
          border:"1px solid rgba(238,248,255,0.34)",
          boxShadow:"inset 0 0 0 1px rgba(31,111,255,0.11), inset 0 1px 0 rgba(255,255,255,0.20), 0 0 30px rgba(31,111,255,0.12)",
          backdropFilter:"blur(28px) saturate(178%) contrast(104%)",
          WebkitBackdropFilter:"blur(28px) saturate(178%) contrast(104%)",
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
              <div style={{display:"flex",gap:5,alignItems:"center",marginTop:2}}>
                <button className="panel-chrome-button" onClick={()=>api.browser?.open?.(PRESSREADER_URL)} title="PressReader">
                  <svg width="16" height="16" viewBox="0 0 32 32" style={{display:"block"}}>
                    <path d="M6,4 H26 A4,4 0 0 1 30,8 V20 A4,4 0 0 1 26,24 H22 L24,30 L16,24 H6 A4,4 0 0 1 2,20 V8 A4,4 0 0 1 6,4 Z" fill="rgba(31,111,255,0.72)"/>
                    <text x="16" y="15" fontSize="14" fontWeight="800" fill="#fff" textAnchor="middle"
                      fontFamily="'DM Sans',sans-serif" dominantBaseline="central">P</text>
                  </svg>
                </button>
                <button className={`panel-chrome-button${pinned ? " is-active" : ""}`} onClick={togglePin} title={pinned?"Unpin":"Pin to desktop"} style={{fontSize:13}}>
                  📌
                </button>
                {loaded&&<button className="panel-chrome-button" onClick={()=>{setShowMgr(true);api.modal.open();}} title="Manage widgets" style={{fontSize:14}}>⚙</button>}
                <button className="panel-chrome-button" onClick={()=>{setShowSettings(true);api.modal.open();}} title="Settings" style={{fontSize:13}}>≡</button>
                {loaded&&<button className="panel-chrome-button" onClick={()=>setRefreshKey(k=>k+1)} title="Refresh data" style={{fontSize:13}}>↺</button>}
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

                {/* Column 2 - Workstation telemetry */}
                <div style={{flexShrink:0,width:colWidths.monitor,overflowY:"auto",padding:"0px 6px 12px 6px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"monitor",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(monitorIds, "monitor")}
                  {monitorIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 2 | col 3 */}
                <div className="col-divider" onMouseDown={onColDividerDown('monitor')} />

                {reader.open ? (
                  <ArticleReaderCard reader={reader} onClose={closeReader} onOpenExternal={openReaderExternal} />
                ) : (
                  <>
                {/* Column 3 */}
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
                  </>
                )}
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
