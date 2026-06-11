import { useState, useEffect, useMemo, useRef, useCallback } from "react";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ═══════════════════════════════════════════════════════════
// SNAPPY GOLD CRM v5
// Six tabs: Fulfill / Process / Received / Follow Up / Purchased / Customers
// PIN: 5437
// ═══════════════════════════════════════════════════════════

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby82CuMrlr0us5SUSCusqzGoxZYHPQg9nQuzalIplObIjtbXNUpRBNPrJWuV1qimmJbgA/exec";
const CRM_KEY    = "snappy_crm_2026";
const PIN        = "5437";
const CACHE_KEY  = "sg_crm_v5b_cache";
const JUNK_KEY   = "sg_crm_junk_emails";

function getJunkList() { try { return JSON.parse(localStorage.getItem(JUNK_KEY)||"[]"); } catch { return []; } }
function addToJunkList(email) { try { const j=getJunkList(); if(!j.includes(email)) { j.push(email); localStorage.setItem(JUNK_KEY,JSON.stringify(j)); } } catch {} }

// ── Brand ─────────────────────────────────────────────────
const G = {
  gold:   "#C8953C", goldLt: "#E8B86D",
  dark:   "#1A1816", darker: "#120F0D",
  cream:  "#FAF6F0", bg:     "#F5EFE6",
  card:   "#FFFFFF", border: "#E2D9CC",
  text:   "#2C2420", muted:  "#8B7D70",
  green:  "#2E7D32", red:    "#B71C1C",
  blue:   "#1565C0", purple: "#6A1B9A",
  orange: "#E65100", teal:   "#00695C",
};

// ── Stages ────────────────────────────────────────────────
const STAGES = [
  "estimate_only", "ready_to_fulfill", "outbound_complete",
  "received", "inspected", "pending_response",
  "pending_payment", "pending_leadsonline", "complete",
  "returned", "dead"
];

const SL = {
  estimate_only:     "Estimate Only",
  ready_to_fulfill:  "Ready to Fulfill",
  outbound_complete: "Outbound Complete",
  received:          "Received",
  inspected:         "Inspected",
  pending_response:  "Pending Response",
  pending_payment:   "Pending Payment",
  pending_leadsonline: "Pending LeadsOnline",
  complete:          "Complete ✓",
  purchased:         "Purchased ✓",   // legacy — kept so any stray old value still renders
  offer_made:        "Offer Made",     // legacy
  returned:          "Returned",
  return_complete:   "Returned",
  dead:              "Dead",
};

const SC = {
  estimate_only:     "#9E9E9E",
  ready_to_fulfill:  "#6A1B9A",
  outbound_complete: "#2E7D32",
  received:          "#00695C",
  inspected:         "#00838F",
  pending_response:  "#F57F17",   // amber — awaiting customer
  pending_payment:   "#C62828",   // red — money owed, hard to miss
  pending_leadsonline: "#AD1457", // magenta — compliance owed, hard to miss
  complete:          "#1B5E20",   // deep green — done
  purchased:         "#1B5E20",   // legacy
  offer_made:        "#F57F17",   // legacy
  returned:          "#546E7A",
  return_complete:   "#546E7A",
  dead:              "#9E9E9E",
};

const FULFILL_STAGES   = ["ready_to_fulfill"];
const OUTBOUND_STAGES  = ["outbound_complete"];
// "In Progress" collapses all post-receipt work stages into one queue,
// with stage badges + per-stage counts doing the visual sorting.
const RECEIVED_STAGES  = ["received","inspected","pending_response","pending_payment","pending_leadsonline"];
const COMPLETE_STAGES  = ["complete","returned","purchased"];  // purchased kept for legacy safety

// ── Helpers ───────────────────────────────────────────────
function fmt$(n) { return n ? "$" + Number(n).toLocaleString() : "—"; }
function fmtPhone(p) {
  if (!p) return "";
  const d = String(p).replace(/\D/g,"");
  if (d.length===10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length===11&&d[0]==="1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return String(p);
}
function daysSince(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now()-d.getTime())/86400000);
}
// Compact relative time: "5m", "3h", "2d", "3w", "5mo"
function timeAgo(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const mins = Math.floor((Date.now()-d.getTime())/60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return hrs + "h";
  const days = Math.floor(hrs/24);
  if (days < 14) return days + "d";
  const weeks = Math.floor(days/7);
  if (weeks < 9) return weeks + "w";
  const months = Math.floor(days/30);
  return months + "mo";
}
// Pretty absolute date: "Apr 22 · 3:14 PM"
function fmtDateTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  const day = d.getDate();
  let hrs = d.getHours();
  const mins = String(d.getMinutes()).padStart(2,"0");
  const ampm = hrs >= 12 ? "PM" : "AM";
  hrs = hrs % 12 || 12;
  const yearSuffix = d.getFullYear() !== new Date().getFullYear() ? ", " + d.getFullYear() : "";
  return `${mo} ${day}${yearSuffix} · ${hrs}:${mins} ${ampm}`;
}
// Display the shipment's item, with customer_message as a fallback when item is empty.
// For direct-quote / limit-gate leads where AI never produced an item name,
// the customer's typed description lives in customer_message — show that instead
// of "(no item)". Returns truncated string.
function displayItem(shipment, max) {
  if (!shipment) return "(no item)";
  // 1. If we have a structured item_manifest with names, list them
  const manifest = Array.isArray(shipment.item_manifest) ? shipment.item_manifest : null;
  if (manifest && manifest.length > 0) {
    const names = manifest.map(it => String(it.name || "").trim()).filter(Boolean);
    if (names.length === 1) return names[0];
    if (names.length > 1) {
      const label = `${names.length} items: ${names.join(", ")}`;
      const limit = max || 80;
      return label.length > limit ? label.substring(0, limit - 1) + "…" : label;
    }
  }
  // 2. Fall back to top-level item field
  const item = String(shipment.item || "").trim();
  if (item) return item;
  // 3. Fall back to customer_message (first sentence/line, trimmed)
  const msg = String(shipment.customer_message || shipment.customer_edits_text || "").trim();
  if (!msg) return "(no item)";
  let s = msg;
  const brk = s.search(/[.\n]/);
  if (brk > 0 && brk < 100) s = s.substring(0, brk);
  const limit = max || 60;
  if (s.length > limit) s = s.substring(0, limit - 1) + "…";
  return s;
}
// Pick the most relevant date for a shipment based on its stage.
// Returns { label, ts, age } or null.
function stageRelevantDate(shipment) {
  if (!shipment) return null;
  const s = shipment.stage || "";
  // In Outbound: show when sent
  if (s === "outbound_complete" || s === "outbound_sent" || s === "in_transit") {
    if (shipment.sent_at) return { label: "sent", ts: shipment.sent_at };
  }
  // In Received or later: show when received
  if (s === "received" || s === "inspected" || s === "pending_response" ||
      s === "pending_payment" || s === "pending_leadsonline" || s === "complete" ||
      s === "returned" || s === "offer_made" || s === "purchased") {
    if (shipment.received_at) return { label: "received", ts: shipment.received_at };
  }
  // Default: lead intake / ready_to_fulfill — show when created
  if (shipment.created_at) return { label: "created", ts: shipment.created_at };
  return null;
}
// Determine if a shipment is "stuck" based on days in current stage (returns color or null)
function stuckColor(shipment, G) {
  const srd = stageRelevantDate(shipment);
  if (!srd) return null;
  const days = daysSince(srd.ts);
  if (days === null) return null;
  const s = shipment.stage || "";
  // Thresholds per stage
  const thresholds = {
    ready_to_fulfill:   { yellow: 3,  red: 7 },
    outbound_complete:  { yellow: 5,  red: 10 },
    outbound_sent:      { yellow: 5,  red: 10 },
    in_transit:         { yellow: 7,  red: 14 },
    received:           { yellow: 2,  red: 5 },
    inspected:          { yellow: 1,  red: 3 },   // priced item should get an offer fast
    pending_response:   { yellow: 2,  red: 3 },   // follow-up nudge at 2–3 days
    pending_payment:    { yellow: 1,  red: 2 },   // owe them money — pay fast
    pending_leadsonline:{ yellow: 1,  red: 2 },   // compliance owed — report fast
  };
  const t = thresholds[s];
  if (!t) return null;
  if (days >= t.red) return G.red || "#c03030";
  if (days >= t.yellow) return "#b8860b"; // amber
  return null;
}
function parseEstHigh(est) {
  if (!est) return 0;
  const nums = String(est).replace(/[$,]/g,"").split(/[–\-]/).map(p=>parseFloat(p.trim())).filter(n=>!isNaN(n));
  return nums.length ? Math.max(...nums) : 0;
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map(w=>w[0]).join("").toUpperCase().slice(0,2);
}
function avatarColor(str) {
  const colors=["#C8953C","#1565C0","#2E7D32","#6A1B9A","#00695C","#E65100","#B71C1C"];
  let h=0; for(let i=0;i<str.length;i++) h=str.charCodeAt(i)+((h<<5)-h);
  return colors[Math.abs(h)%colors.length];
}

// ── API ───────────────────────────────────────────────────
async function apiFetch(params) {
  const res = await fetch(SCRIPT_URL+"?"+new URLSearchParams(params).toString());
  return res.json();
}
async function apiPost(body) {
  const res = await fetch(SCRIPT_URL,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(body)});
  return res.json();
}

// ── Cache ─────────────────────────────────────────────────
function getCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)||"null"); } catch { return null; } }
function setCache(data) { try { localStorage.setItem(CACHE_KEY,JSON.stringify({...data,_ts:Date.now()})); } catch {} }

// ══════════════════════════════════════════════════════════
// ATOMS
// ══════════════════════════════════════════════════════════

function Badge({stage,sm}) {
  const c=SC[stage]||"#9E9E9E";
  return <span style={{background:c+"18",color:c,border:`1px solid ${c}33`,borderRadius:4,padding:sm?"1px 6px":"3px 9px",fontSize:sm?10:11,fontWeight:700,whiteSpace:"nowrap",letterSpacing:"0.02em"}}>{SL[stage]||stage}</span>;
}

function Avatar({name,size=36}) {
  const bg=avatarColor(name||"?");
  return <div style={{width:size,height:size,borderRadius:"50%",background:bg,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.36,fontWeight:700,flexShrink:0,fontFamily:"'Georgia',serif"}}>{initials(name)}</div>;
}

// MAY 22 PATCH: communication URL helpers
//   - smsHref: Quo deep link (openphone:// scheme works on Mac with Quo desktop app
//     installed, iOS with Quo app installed, and Android with Quo app installed).
//     Strips phone to digits. Falls back gracefully if no app installed (browser
//     will simply not handle the protocol).
//   - emailHref: Zoho web compose URL with To address pre-filled. Works in any
//     browser on any platform without touching OS defaults.
// JUN 1 PATCH: format DOB for display. Many records have full ISO timestamps
// like "1971-07-03T04:00:00.000Z" from the ID-photo OCR Vision call. We
// extract just the date part. Critical: parse the ISO date manually rather
// than via new Date() to avoid timezone shifts (Z time at 04:00 reads as the
// prior day in Eastern, e.g. 1971-07-03T04:00:00Z → "1971-07-02" in EDT).
function fmtDob(s) {
  if (!s) return '';
  // JUN 1 PATCH v2: handle Date instances (server may serialize Date cells
  // to JSON differently — covered defensively).
  if (s instanceof Date) {
    if (isNaN(s.getTime())) return '';
    const mm = String(s.getMonth() + 1).padStart(2, '0');
    const dd = String(s.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${s.getFullYear()}`;
  }
  const str = String(s).trim();
  // ISO with optional time: extract YYYY-MM-DD literally
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;  // → MM/DD/YYYY
  // Already MM/DD/YYYY
  const us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[1].padStart(2,'0')}/${us[2].padStart(2,'0')}/${us[3]}`;
  // JS Date.toString format: "Sat Jul 03 1971 00:00:00 GMT-0400 (...)"
  const monthMap = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
                     Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  const jsDate = str.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (jsDate && monthMap[jsDate[1]]) {
    return `${monthMap[jsDate[1]]}/${jsDate[2].padStart(2,'0')}/${jsDate[3]}`;
  }
  return str;
}

function smsHref(phone) {
  if (!phone) return '#';
  const digits = String(phone).replace(/\D/g, '');
  return `openphone://message?number=${digits}`;
}
function emailHref(email) {
  if (!email) return '#';
  return `https://mail.zoho.com/zm/#mail/compose?to=${encodeURIComponent(email)}`;
}

function Btn({children,onClick,v="ghost",disabled,small,style:st={}}) {
  const base={border:"none",borderRadius:6,cursor:disabled?"not-allowed":"pointer",fontWeight:600,fontSize:small?11:12,padding:small?"4px 10px":"6px 14px",opacity:disabled?0.45:1,transition:"all 0.12s",display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap"};
  const vars={gold:{background:G.gold,color:"#fff"},danger:{background:"#FFF0F0",color:G.red,border:`1px solid ${G.red}30`},ghost:{background:"#F0EAE0",color:G.text,border:`1px solid ${G.border}`},green:{background:"#F0FFF4",color:G.green,border:`1px solid ${G.green}30`},blue:{background:"#EEF4FF",color:G.blue,border:`1px solid ${G.blue}30`},purple:{background:"#F5F0FF",color:G.purple,border:`1px solid ${G.purple}30`},dark:{background:G.dark,color:G.cream},orange:{background:"#FFF3E0",color:G.orange,border:`1px solid ${G.orange}30`}};
  return <button onClick={disabled?undefined:onClick} style={{...base,...(vars[v]||vars.ghost),...st}} onMouseEnter={e=>{if(!disabled)e.currentTarget.style.filter="brightness(0.92)"}} onMouseLeave={e=>{e.currentTarget.style.filter=""}}>{children}</button>;
}

function Inp({label,value,onChange,type="text",placeholder="",rows,mono}) {
  const common={width:"100%",boxSizing:"border-box",background:"#FDFAF6",color:G.text,border:`1px solid ${G.border}`,borderRadius:6,padding:"7px 10px",fontSize:13,outline:"none",fontFamily:mono?"monospace":"inherit",transition:"border-color 0.15s"};
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {label&&<label style={{color:G.muted,fontSize:11,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</label>}
    {rows?<textarea value={value||""} onChange={onChange} rows={rows} placeholder={placeholder} style={{...common,resize:"vertical"}} onFocus={e=>e.currentTarget.style.borderColor=G.gold} onBlur={e=>e.currentTarget.style.borderColor=G.border}/>:<input type={type} value={value||""} onChange={onChange} placeholder={placeholder} style={common} onFocus={e=>e.currentTarget.style.borderColor=G.gold} onBlur={e=>e.currentTarget.style.borderColor=G.border}/>}
  </div>;
}

function Sel({label,value,onChange,options}) {
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {label&&<label style={{color:G.muted,fontSize:11,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</label>}
    <select value={value||""} onChange={onChange} style={{background:"#FDFAF6",color:G.text,border:`1px solid ${G.border}`,borderRadius:6,padding:"7px 10px",fontSize:13,outline:"none"}}>
      {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  </div>;
}

// ══════════════════════════════════════════════════════════
// PIN GATE
// ══════════════════════════════════════════════════════════

function PinGate({onUnlock}) {
  const [pin,setPin]=useState(""); const [err,setErr]=useState(false);
  function submit(){if(pin===PIN){onUnlock();}else{setErr(true);setTimeout(()=>setErr(false),800);setPin("");}}
  return <div style={{minHeight:"100vh",background:G.dark,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:24}}>
    <div style={{color:G.gold,fontSize:28,fontFamily:"'Georgia',serif",letterSpacing:"0.1em"}}>SNAPPY<span style={{color:G.cream}}>.GOLD</span></div>
    <div style={{color:G.muted,fontSize:13}}>CRM v5</div>
    <div style={{display:"flex",flexDirection:"column",gap:12,alignItems:"center"}}>
      <input type="password" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Enter PIN" autoFocus style={{background:err?"#3a1a1a":"#2a2420",color:G.cream,border:`1px solid ${err?G.red:G.gold}55`,borderRadius:8,padding:"12px 20px",fontSize:18,outline:"none",textAlign:"center",letterSpacing:"0.3em",width:160,transition:"all 0.15s"}}/>
      <Btn v="gold" onClick={submit} style={{width:160,justifyContent:"center"}}>Unlock</Btn>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════

function EditModal({shipment,customer,onSave,onClose}) {
  const [s,setS]=useState({...shipment}); const [c,setC]=useState({...customer}); const [saving,setSaving]=useState(false);
  function updS(f,v){setS(p=>({...p,[f]:v}));} function updC(f,v){setC(p=>({...p,[f]:v}));}
  async function save(){
    setSaving(true);
    try {
      await apiPost({action:"upsertCustomer",data:{email:c.email,name:c.name,phone:c.phone,address:c.address,source:c.source,notes:c.notes}});
      await apiPost({action:"updateShipment",shipment_id:s.shipment_id,updates:{stage:s.stage,shipping_type:s.shipping_type,item:s.item,estimate:s.estimate,outbound_tracking:s.outbound_tracking,return_tracking:s.return_tracking,purchase_price:s.purchase_price,appraised_value:s.appraised_value,payment_method:s.payment_method,payment_info:s.payment_info,notes:s.notes,bin_number:s.bin_number}});
      onSave({shipment:s,customer:c});
    } catch(e){alert("Save failed: "+e.message);}
    setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(680px,95vw)",maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{padding:"20px 24px",borderBottom:`1px solid ${G.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#fff",zIndex:1}}>
        <div style={{fontWeight:700,fontSize:16,color:G.text}}>Edit Record</div>
        <Btn v="ghost" onClick={onClose} small>✕ Close</Btn>
      </div>
      <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:20}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Customer</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Name" value={c.name} onChange={e=>updC("name",e.target.value)}/>
            <Inp label="Email" value={c.email} onChange={e=>updC("email",e.target.value)}/>
            <Inp label="Phone" value={c.phone} onChange={e=>updC("phone",e.target.value)}/>
            <Inp label="Source" value={c.source} onChange={e=>updC("source",e.target.value)}/>
          </div>
          <div style={{marginTop:12}}><Inp label="Address" value={c.address} onChange={e=>updC("address",e.target.value)}/></div>
          <div style={{marginTop:12}}><Inp label="Notes" value={c.notes} onChange={e=>updC("notes",e.target.value)} rows={2}/></div>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Shipment · {s.shipment_id}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Sel label="Stage" value={s.stage} onChange={e=>updS("stage",e.target.value)} options={STAGES.map(v=>({value:v,label:SL[v]||v}))}/>
            <Sel label="Shipping Type" value={s.shipping_type} onChange={e=>updS("shipping_type",e.target.value)} options={[{value:"",label:"—"},{value:"kit",label:"Kit"},{value:"label",label:"FedEx Label"},{value:"usps",label:"USPS Label"}]}/>
          </div>
          <div style={{marginTop:12}}><Inp label="Item Description" value={s.item} onChange={e=>updS("item",e.target.value)}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
            <Inp label="Estimate" value={s.estimate} onChange={e=>updS("estimate",e.target.value)}/>
            <Inp label="Outbound Tracking" value={s.outbound_tracking} onChange={e=>updS("outbound_tracking",e.target.value)} mono/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
            <Inp label="Return Tracking" value={s.return_tracking} onChange={e=>updS("return_tracking",e.target.value)} mono/>
            <Inp label="Purchase Price" value={s.purchase_price} type="number" onChange={e=>updS("purchase_price",e.target.value)}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
            <Inp label="Appraised Value" value={s.appraised_value} type="number" onChange={e=>updS("appraised_value",e.target.value)}/>
            <Inp label="Payment Method" value={s.payment_method} onChange={e=>updS("payment_method",e.target.value)}/>
          </div>
          <div style={{marginTop:12}}><Inp label="Payment Info" value={s.payment_info} onChange={e=>updS("payment_info",e.target.value)}/></div>
          <div style={{marginTop:12}}><Inp label="Notes" value={s.notes} onChange={e=>updS("notes",e.target.value)} rows={3}/></div>
          <div style={{marginTop:12}}><Inp label="Bin Number" value={s.bin_number} onChange={e=>updS("bin_number",e.target.value)} placeholder="e.g. 7"/></div>
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn v="ghost" onClick={onClose}>Cancel</Btn>
          <Btn v="gold" onClick={save} disabled={saving}>{saving?"Saving…":"Save Changes"}</Btn>
        </div>
      </div>
    </div>
  </div>;
}

function LogModal({shipment,customer,onSave,onClose}) {
  const [type,setType]=useState("call"); const [notes,setNotes]=useState(""); const [saving,setSaving]=useState(false);
  async function save(){
    if(!notes.trim())return; setSaving(true);
    try { await apiPost({action:"addContactLog",data:{customer_id:shipment.customer_id,type,notes,shipment_id:shipment.shipment_id}}); onSave({type,notes,timestamp:new Date().toISOString(),shipment_id:shipment.shipment_id}); }
    catch(e){alert("Failed: "+e.message);} setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(460px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontWeight:700,fontSize:16,marginBottom:16,color:G.text}}>Log Contact · {customer?.name||"Customer"}</div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {["call","text","email","note"].map(t=><button key={t} onClick={()=>setType(t)} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:12,fontWeight:600,background:type===t?G.gold:G.bg,color:type===t?"#fff":G.muted,border:`1px solid ${type===t?G.gold:G.border}`,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>)}
      </div>
      <Inp label="Notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={4} placeholder="What happened?"/>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
        <Btn v="ghost" onClick={onClose}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={saving||!notes.trim()}>{saving?"Saving…":"Save Log"}</Btn>
      </div>
    </div>
  </div>;
}

function StageModal({shipment,onSave,onClose}) {
  const [stage,setStage]=useState(shipment.stage); const [saving,setSaving]=useState(false);
  async function save(){
    setSaving(true);
    try { await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{stage}}); onSave(stage); }
    catch(e){alert("Failed: "+e.message);} setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(380px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontWeight:700,fontSize:15,marginBottom:16,color:G.text}}>Change Stage</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {STAGES.filter(s=>s!=="estimate_only").map(s=><button key={s} onClick={()=>setStage(s)} style={{padding:"8px 14px",borderRadius:7,textAlign:"left",background:stage===s?SC[s]+"18":"#fff",color:stage===s?SC[s]:G.text,border:`1px solid ${stage===s?SC[s]+"55":G.border}`,cursor:"pointer",fontSize:13,fontWeight:stage===s?700:400}}>{SL[s]}</button>)}
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
        <Btn v="ghost" onClick={onClose}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={saving||stage===shipment.stage}>{saving?"Saving…":"Update Stage"}</Btn>
      </div>
    </div>
  </div>;
}

function AddShipmentModal({customer,onSave,onClose}) {
  const [item,setItem]=useState(""); const [estimate,setEstimate]=useState(""); const [shippingType,setShippingType]=useState("kit"); const [notes,setNotes]=useState(""); const [saving,setSaving]=useState(false);
  async function save(){
    setSaving(true);
    try {
      const res=await apiPost({action:"createShipment",data:{customer_id:customer.customer_id,stage:"ready_to_fulfill",shipping_type:shippingType,item,estimate,notes,outbound_tracking:"",return_tracking:"",received_at:"",purchase_price:"",appraised_value:"",payment_method:"",payment_info:"",sent_at:""}});
      onSave({shipment_id:res,customer_id:customer.customer_id,stage:"ready_to_fulfill",shipping_type:shippingType,item,estimate,notes,created_at:new Date().toISOString()});
    } catch(e){alert("Failed: "+e.message);}
    setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(480px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontWeight:700,fontSize:16,marginBottom:4,color:G.text}}>New Shipment</div>
      <div style={{fontSize:12,color:G.muted,marginBottom:20}}>{customer?.name||customer?.email}</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Sel label="Shipping Type" value={shippingType} onChange={e=>setShippingType(e.target.value)} options={[{value:"kit",label:"Kit (mail kit to customer)"},{value:"label",label:"FedEx Label (email label)"},{value:"usps",label:"USPS Label (email via Shippo)"}]}/>
        <Inp label="Item Description" value={item} onChange={e=>setItem(e.target.value)} placeholder="e.g. 14K Yellow Gold Chain"/>
        <Inp label="Estimate" value={estimate} onChange={e=>setEstimate(e.target.value)} placeholder="e.g. $1,200 – $1,800"/>
        <Inp label="Notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Optional"/>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
        <Btn v="ghost" onClick={onClose}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={saving}>{saving?"Creating...":"Create Shipment"}</Btn>
      </div>
    </div>
  </div>;
}


// Manual entry: create a NEW customer + shipment in one go, for off-platform
// deals (high-value mail-ins, phone deals, FB leads handled by hand). Lets you
// set the stage + outbound tracking directly (e.g. when you already made the
// label outside the normal fulfill flow).
function ManualEntryModal({onSaved,onClose}) {
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [phone,setPhone]=useState(""); const [address,setAddress]=useState("");
  const [item,setItem]=useState(""); const [estimate,setEstimate]=useState("");
  const [stage,setStage]=useState("outbound_complete");
  const [shippingType,setShippingType]=useState("usps");
  const [tracking,setTracking]=useState(""); const [notes,setNotes]=useState("");
  const [saving,setSaving]=useState(false);
  const canSave = (name.trim()||email.trim()) && !saving;

  async function save(){
    setSaving(true);
    try {
      const res=await apiPost({action:"manualCustomerShipment",
        customer:{name:name.trim(),email:email.trim(),phone:phone.trim(),address:address.trim()},
        shipment:{stage,shipping_type:shippingType,item:item.trim(),estimate:estimate.trim(),outbound_tracking:tracking.trim(),notes:notes.trim()}});
      if(res&&res.success){ onSaved(); }
      else { alert("Failed: "+((res&&res.error)||"unknown")); setSaving(false); }
    } catch(e){ alert("Failed: "+(e&&e.message||e)); setSaving(false); }
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(520px,95vw)",maxHeight:"90vh",overflowY:"auto",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontWeight:700,fontSize:17,marginBottom:4,color:G.text}}>+ New Customer &amp; Shipment</div>
      <div style={{fontSize:12,color:G.muted,marginBottom:18}}>For off-platform entries — high-value mail-ins, phone deals, manually-handled leads. Dedupes by email if the customer already exists.</div>

      <div style={{fontSize:11,fontWeight:700,color:G.gold,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Customer</div>
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:18}}>
        <Inp label="Name" value={name} onChange={e=>setName(e.target.value)} placeholder="Full name"/>
        <Inp label="Email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@example.com"/>
        <Inp label="Phone" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(561) 555-1234"/>
        <Inp label="Address" value={address} onChange={e=>setAddress(e.target.value)} placeholder="123 Main St, City, ST, 12345"/>
      </div>

      <div style={{fontSize:11,fontWeight:700,color:G.gold,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Shipment</div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Inp label="Item Description" value={item} onChange={e=>setItem(e.target.value)} placeholder="e.g. 14K Yellow Gold Chain"/>
        <Inp label="Estimate" value={estimate} onChange={e=>setEstimate(e.target.value)} placeholder="e.g. $1,200 – $1,800"/>
        <Sel label="Stage" value={stage} onChange={e=>setStage(e.target.value)} options={[
          {value:"outbound_complete",label:"Outbound (label already sent)"},
          {value:"ready_to_fulfill",label:"Fulfill queue (needs a label)"},
          {value:"received",label:"Received (already have items)"},
        ]}/>
        <Sel label="Shipping Type" value={shippingType} onChange={e=>setShippingType(e.target.value)} options={[{value:"usps",label:"USPS"},{value:"label",label:"FedEx"},{value:"kit",label:"Kit"}]}/>
        <Inp label="Outbound Tracking" value={tracking} onChange={e=>setTracking(e.target.value)} placeholder="Tracking # (if label already created)" mono/>
        <Inp label="Notes" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Insured $7,500 via Secursus"/>
      </div>

      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
        <Btn v="ghost" onClick={onClose}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={!canSave}>{saving?"Creating...":"Create"}</Btn>
      </div>
    </div>
  </div>;
}


// ══════════════════════════════════════════════════════════
// PAYMENT & ID CAPTURE MODAL
// ══════════════════════════════════════════════════════════

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const ID_TYPES = [
  {value:"",label:"—"},
  {value:"driver_license",label:"Driver's License"},
  {value:"state_id",label:"State ID"},
  {value:"passport",label:"Passport"},
  {value:"military_id",label:"Military ID"},
  {value:"other",label:"Other"},
];

const PAYMENT_METHODS = [
  {value:"",label:"—"},
  {value:"ach",label:"ACH (bank transfer)"},
  {value:"paypal",label:"PayPal"},
  {value:"venmo",label:"Venmo"},
  {value:"zelle",label:"Zelle"},
  {value:"check",label:"Check"},
  {value:"cashapp",label:"CashApp"},
  {value:"other",label:"Other"},
];

// ─── LeadsOnline submission button ──────────────────────────────
// Validates readiness, posts to handlePushToLeadsOnline action, surfaces result inline.
function LeadsOnlineSubmitBtn({shipment, ready, missing, onSuccess}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, ticket }
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiPost({
        action: "pushToLeadsOnline",
        shipment_id: shipment.shipment_id
      });
      if (res && res.success) {
        // Ticket submitted + stamped server-side in ~1s. Show success NOW.
        setResult({ok:true, message:res.message || `Submitted as ${res.ticket_number}`, ticket:res.ticket_number, sandbox:res.sandbox});
        if (onSuccess) onSuccess(res);
        // Fire photo upload separately (non-blocking) — a slow upload no longer
        // holds up (or times out) the confirmation. Best-effort; ticket is done.
        if (res.photos_pending) {
          apiPost({action:"uploadLeadsOnlinePhotos", shipment_id:shipment.shipment_id})
            .then(p=>{ if(p&&p.message) setResult(r=>r&&r.ok?{...r, message:`Submitted as ${res.ticket_number} · ${p.message}`}:r); })
            .catch(()=>{ setResult(r=>r&&r.ok?{...r, message:`Submitted as ${res.ticket_number} · photos pending (retry photos if needed)`}:r); });
        }
      } else if (res && (res.message || res.error)) {
        setResult({ok:false, message:(res.message || res.error)});
      } else {
        // Empty/unparseable response — verify whether it actually landed.
        await verifyThenReport();
      }
    } catch (err) {
      // Network/timeout — the submit usually completed server-side. Verify.
      await verifyThenReport();
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  // After an unconfirmed response, re-fetch the shipment and check whether
  // leadsonline_submitted_at got stamped. Turns "maybe" into a definitive answer.
  async function verifyThenReport() {
    try {
      const check = await apiPost({action:"getShipment", shipment_id:shipment.shipment_id});
      const s = (check && (check.shipment || check.data || check)) || {};
      if (s && s.leadsonline_submitted_at) {
        setResult({ok:true, message:`Submitted (confirmed on re-check) — SG-${String(shipment.shipment_id).replace(/^SHP-/,"")}`, ticket:`SG-${String(shipment.shipment_id).replace(/^SHP-/,"")}`});
        if (onSuccess) onSuccess({success:true, ticket_number:`SG-${String(shipment.shipment_id).replace(/^SHP-/,"")}`, submitted_at:s.leadsonline_submitted_at});
        return;
      }
    } catch(e) {}
    // Genuinely couldn't confirm it landed.
    setResult({ok:false, unconfirmed:true,
      message:"Couldn't confirm the submit landed. Check the LeadsOnline monitor before retrying (a true resubmit is rejected as a duplicate)."});
  }

  if (!ready) {
    return <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button disabled style={{
          flex:1,padding:"10px 14px",fontSize:13,fontWeight:700,borderRadius:6,
          border:`1px solid ${G.border}`,background:"#F5F2EC",color:G.muted,cursor:"not-allowed",
          letterSpacing:"0.04em",textTransform:"uppercase"
        }}>📤 Push to LeadsOnline</button>
      </div>
      <div style={{fontSize:11,color:G.muted,lineHeight:1.5}}>
        <strong style={{color:G.orange}}>Cannot submit yet — missing:</strong> {missing.join(", ")}
      </div>
    </div>;
  }

  return <div style={{display:"flex",flexDirection:"column",gap:6}}>
    {!confirmOpen && !result && (
      <button
        onClick={()=>setConfirmOpen(true)}
        disabled={busy}
        style={{
          padding:"10px 14px",fontSize:13,fontWeight:700,borderRadius:6,
          border:`1px solid ${G.gold}`,background:G.gold,color:"#fff",cursor:"pointer",
          letterSpacing:"0.04em",textTransform:"uppercase"
        }}>📤 Push to LeadsOnline</button>
    )}

    {confirmOpen && !busy && !result && (
      <div style={{background:"#FFF9EE",border:`1px solid ${G.gold}`,borderRadius:8,padding:12,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{fontSize:12,color:G.text,lineHeight:1.5}}>
          Submit ticket <strong>SG-{String(shipment.shipment_id).replace(/^SHP-/,"")}</strong> to LeadsOnline?
          <br/>
          <span style={{color:G.muted,fontSize:11}}>This will push the transaction record + inventory photos. Cannot be undone (LeadsOnline rejects duplicate tickets).</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="gold" small onClick={submit}>Yes, submit</Btn>
          <Btn v="ghost" small onClick={()=>setConfirmOpen(false)}>Cancel</Btn>
        </div>
      </div>
    )}

    {busy && (
      <div style={{fontSize:12,color:G.muted,fontStyle:"italic",padding:"8px 0"}}>
        Submitting to LeadsOnline…
      </div>
    )}

    {result && (() => {
      // Three states: ok (green), unconfirmed (amber — may have submitted), failed (red)
      const tone = result.ok ? G.green : (result.unconfirmed ? G.orange : G.red);
      const bg = result.ok ? "#F0FFF4" : (result.unconfirmed ? "#FFF8EC" : "#FFF0F0");
      const icon = result.ok ? "✓ " : (result.unconfirmed ? "❓ " : "⚠ ");
      return (
      <div style={{
        background:bg,
        border:`1px solid ${tone}40`,
        borderRadius:8,padding:10,display:"flex",flexDirection:"column",gap:4
      }}>
        <div style={{fontSize:12,fontWeight:700,color:tone}}>
          {icon}{result.message}
        </div>
        {result.ok && result.sandbox === true && (
          <div style={{fontSize:10,color:G.orange,fontStyle:"italic"}}>⚠ Submitted to SANDBOX, not production. Flip LO_USE_SANDBOX in leadsonline.gs when ready.</div>
        )}
        {result.ok && result.photoError && (
          <div style={{fontSize:10,color:G.orange}}>Photo upload failed — retry separately. Error: {result.photoError}</div>
        )}
      </div>
      );
    })()}
  </div>;
}


// ConfirmRow — small "✓ Confirm" UI shown under each ID field after Vision parse.
// Operator must click confirm on each parsed field before Save will succeed.
// Catches typos like Becky's DOB by forcing visual review.
function ConfirmRow({field, parsed, current, confirmed, onConfirm}) {
  const matches = String(parsed).trim() === String(current).trim();
  const showConfirmButton = !confirmed;
  return <div style={{
    marginTop:4,padding:"4px 8px",fontSize:10,
    background: confirmed ? "#F0F7F0" : (matches ? "#FFFBEC" : "#FFF0F0"),
    border:`1px solid ${confirmed ? "#B5D5B5" : (matches ? G.gold : G.red)}40`,
    borderRadius:4,
    display:"flex",alignItems:"center",justifyContent:"space-between",gap:6
  }}>
    <span style={{color:confirmed?G.green:G.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
      {confirmed ? "✓ Confirmed: " : "Parsed: "}<strong>{parsed}</strong>
      {!matches && !confirmed && <span style={{color:G.red,marginLeft:6}}>(edited)</span>}
    </span>
    {showConfirmButton && (
      <button
        onClick={onConfirm}
        style={{
          padding:"2px 8px",fontSize:10,fontWeight:700,borderRadius:3,
          border:`1px solid ${G.green}`,background:G.green,color:"#fff",cursor:"pointer",flexShrink:0
        }}>✓ Confirm</button>
    )}
  </div>;
}


function PaymentIdModal({shipment, customer, onSave, onClose}) {
  // Pre-fill from customer (these fields reusable across transactions)
  const [idType, setIdType] = useState(customer?.id_type || shipment?.id_type || "");
  const [idNumber, setIdNumber] = useState(customer?.id_number || shipment?.id_number || "");
  const [idState, setIdState] = useState(customer?.id_state || shipment?.id_state || "");
  // JUN 3 PATCH: init via fmtDob. Stored date_birth can be a full ISO
  // timestamp ("1981-03-30T05:00:00.000Z") from OCR/Sheets date coercion;
  // feeding that raw into the field showed the ugly ISO string and broke
  // LeadsOnline submit. fmtDob → "MM/DD/YYYY" (matches the field placeholder);
  // backend _normalizeDob accepts MM/DD/YYYY and stores YYYY-MM-DD.
  const [dateBirth, setDateBirth] = useState(fmtDob(customer?.date_birth || shipment?.date_birth || ""));
  const [photoData, setPhotoData] = useState(null);
  const [photoName, setPhotoName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(shipment?.payment_method || "");
  const [paymentInfo, setPaymentInfo] = useState(shipment?.payment_info || "");
  // Sworn statement — required by FL Statute 538.32(2)(c) before payment can be remitted.
  // Pre-existing state: if either customer or shipment already has it, show as locked.
  const existingSworn = customer?.sworn_statement_at || shipment?.sworn_statement_at || "";
  const [swornAge, setSwornAge] = useState(!!existingSworn);
  const [swornPerjury, setSwornPerjury] = useState(!!existingSworn);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  // ── OCR / ID parse state ──
  // parseResult holds the Vision-extracted values + per-field confirmation flags.
  // Operator must click each field to "confirm" before save — protects against
  // silent wrong-fills (the bug that caused Becky's DOB typo).
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseResult, setParseResult] = useState(null);  // { id_type, id_number, id_state, date_birth, name, confidence }
  const [confirmed, setConfirmed] = useState({});         // { id_type: true, id_number: true, ... }
  const [nameWarning, setNameWarning] = useState("");

  function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Photo must be under 5MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoData(reader.result);
      setPhotoName(file.name);
      // Clear any prior parse — a new photo means re-parse from scratch
      setParseResult(null);
      setConfirmed({});
      setParseError("");
      setNameWarning("");
    };
    reader.readAsDataURL(file);
  }

  // ── Parse ID photo via Claude Vision (proxied through /api/analyze.js) ──
  async function parseIdPhoto() {
    if (!photoData) {
      alert("Upload a photo first.");
      return;
    }
    setParsing(true);
    setParseError("");
    setParseResult(null);

    try {
      const base64 = photoData.split(",")[1];
      const mediaTypeMatch = photoData.match(/^data:(image\/\w+);base64/);
      const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : "image/jpeg";

      const prompt = `You are looking at a photo of a US-issued identification document (driver's license, state ID, passport, or military ID). Extract the following fields and respond with a JSON object only — no markdown, no preamble, no backticks.

Fields:
- "id_type": one of "driver_license", "state_id", "passport", "military_id", or "other"
- "id_number": the ID number/license number exactly as printed (preserve format including dashes/spaces)
- "id_state": 2-letter US state code (e.g. "FL", "TX") of the issuing authority, or "" if not applicable
- "date_birth": date of birth in MM/DD/YYYY format
- "name": the full name exactly as printed
- "confidence": integer 0-100 representing your confidence that all fields are correctly extracted

If the image is not a valid ID, blurry, or you cannot extract a field reliably, leave that field as empty string "" and lower the confidence accordingly. Never guess.`;

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 }},
              { type: "text", text: prompt }
            ]
          }]
        })
      });

      if (!response.ok) {
        const t = await response.text();
        throw new Error(`Vision API error ${response.status}: ${t.substring(0,200)}`);
      }
      const data = await response.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      setParseResult(parsed);

      // Auto-fill any field that's currently empty; never overwrite existing typed values silently
      // (operator may already have started filling — don't blow away their work)
      const newConfirmed = {};
      if (parsed.id_type && !idType)       { setIdType(parsed.id_type); newConfirmed.id_type = false; }
      if (parsed.id_number && !idNumber)   { setIdNumber(parsed.id_number); newConfirmed.id_number = false; }
      if (parsed.id_state && !idState)     { setIdState(parsed.id_state); newConfirmed.id_state = false; }
      if (parsed.date_birth && !dateBirth) { setDateBirth(parsed.date_birth); newConfirmed.date_birth = false; }
      setConfirmed(newConfirmed);

      // Name cross-check — warn if extracted name doesn't reasonably match customer record
      if (parsed.name && customer?.name) {
        const norm = s => String(s).toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g," ").trim();
        const idName = norm(parsed.name);
        const custName = norm(customer.name);
        // Loose match: at least one shared token of length ≥ 3
        const idTokens = new Set(idName.split(" ").filter(t => t.length >= 3));
        const custTokens = custName.split(" ").filter(t => t.length >= 3);
        const sharedToken = custTokens.some(t => idTokens.has(t));
        if (!sharedToken) {
          setNameWarning(`Name on ID ("${parsed.name}") doesn't match customer record ("${customer.name}"). Verify this is the right person.`);
        }
      }
    } catch (err) {
      setParseError(err.message || String(err));
    } finally {
      setParsing(false);
    }
  }

  // Helper: is every parsed field confirmed? Used to gate the Save button
  // (Only counts fields the parse actually returned)
  function allParsedFieldsConfirmed() {
    if (!parseResult) return true;
    const need = ["id_type", "id_number", "id_state", "date_birth"]
      .filter(f => parseResult[f]);
    return need.every(f => confirmed[f]);
  }

  function toggleConfirm(field) {
    setConfirmed(c => ({...c, [field]: !c[field]}));
  }

  // ── Send self-serve link (operator sends customer a link to fill out themselves) ──
  // Lifesaver when:
  //   - Quo blocks SMS-based ID collection
  //   - Customer prefers to enter info themselves
  //   - Operator doesn't have all the info on hand right now
  const [sendingLink, setSendingLink] = useState(false)
  const [sendLinkResult, setSendLinkResult] = useState(null)  // { ok, message, url }

  async function sendSelfServeLink() {
    const promptAmount = window.prompt(
      "What's the offer amount for this customer?\n\n" +
      "Examples: 250.00 or $250.00 or 250\n\n" +
      "Leave blank to send a generic verification email without an offer figure.",
      shipment?.purchase_price ? String(shipment.purchase_price) : ""
    )
    if (promptAmount === null) return  // user hit Cancel

    // Normalize the offer amount to a clean string like "$250.00"
    let offerAmount = ""
    if (promptAmount.trim()) {
      const numeric = parseFloat(String(promptAmount).replace(/[^0-9.]/g, ""))
      if (!isNaN(numeric) && numeric > 0) {
        offerAmount = "$" + numeric.toFixed(2)
      } else {
        alert("Couldn't parse that as a dollar amount. Try '250' or '250.00'.")
        return
      }
    }

    // MAY 22 PATCH: collect a short description that appears under the offer
    // amount on the verify page. Lets DW contextualize a low offer ("mostly
    // nickel") or confirm a high one ("for your 14K gold necklace").
    // Skipped if no offer amount was entered.
    let offerDescription = ""
    if (offerAmount) {
      const promptDesc = window.prompt(
        "Add a short description that appears under the offer.\n\n" +
        "Examples: 'ring, made mostly of nickel' / 'for your 14K gold necklace' / '2 items as inspected'\n\n" +
        "Leave blank for no description.",
        shipment?.item ? "for " + shipment.item : ""
      )
      if (promptDesc === null) return  // user hit Cancel on description
      offerDescription = promptDesc.trim()
    }

    if (!confirm(
      "Send self-serve link to:\n\n" +
      customer?.name + " <" + customer?.email + ">\n\n" +
      (offerAmount ? "Offer: " + offerAmount + "\n" : "(no offer amount in email)\n") +
      (offerDescription ? "Description: " + offerDescription + "\n\n" : "\n") +
      "They'll get an email with a link to enter their ID, payment info, and personal statement."
    )) return

    setSendingLink(true)
    setSendLinkResult(null)
    try {
      const result = await apiPost({
        action: "generateSelfServeToken",
        shipment_id: shipment.shipment_id,
        customer_id: shipment.customer_id,
        offer_amount: offerAmount,
        offer_description: offerDescription,
        send_email: true,
      })
      if (result && result.success) {
        setSendLinkResult({
          ok: true,
          message: "Email sent to " + customer?.email,
          url: result.url,
        })
      } else {
        setSendLinkResult({ ok: false, message: result?.error || "Unknown error" })
      }
    } catch (e) {
      setSendLinkResult({ ok: false, message: e.message })
    }
    setSendingLink(false)
  }

  async function save() {
    if (!idType && !idNumber && !dateBirth && !paymentMethod) {
      alert("Fill at least one field before saving.");
      return;
    }
    // Block save if a parse happened and operator hasn't confirmed each filled field
    if (parseResult && !allParsedFieldsConfirmed()) {
      alert("Please review and confirm each ID field that was auto-filled by the photo parser.");
      return;
    }
    // Sworn statement is required by FL Statute 538.32(2)(c) before payment can be remitted.
    // Allow saving without it (operator may capture later) but warn if attempting payment with no attestation.
    const swornComplete = swornAge && swornPerjury;
    if (paymentMethod && !swornComplete && !existingSworn) {
      const ok = confirm("⚠️ Sworn statement not checked. FL Statute 538.32(2)(c) requires the seller's perjury attestation before payment is remitted. Save anyway? (You can capture the attestation later.)");
      if (!ok) return;
    }
    setSaving(true);
    try {
      const result = await apiPost({
        action: "capturePaymentId",
        shipment_id: shipment.shipment_id,
        customer_id: shipment.customer_id,
        data: {
          id_type: idType,
          id_number: idNumber,
          id_state: idState,
          date_birth: dateBirth,
          id_photo: photoData || "",
          payment_method: paymentMethod,
          payment_info: paymentInfo,
          // Only send sworn=true if both checkboxes ticked AND not already captured
          // (server is idempotent — won't overwrite existing sworn_statement_at)
          sworn_statement: swornComplete && !existingSworn ? true : undefined,
        }
      });
      if (result && result.success !== false) {
        const updates = {
          id_type: idType, id_number: idNumber, id_state: idState,
          date_birth: dateBirth,
          id_photo_url: result.photo_url || shipment.id_photo_url || "",
          payment_method: paymentMethod, payment_info: paymentInfo,
        };
        if (result.sworn_statement_at) {
          updates.sworn_statement_at = result.sworn_statement_at;
        }
        onSave(updates);
      } else {
        alert("Save failed: " + (result?.error || "unknown"));
      }
    } catch(e) {
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(640px,95vw)",maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{padding:"20px 24px",borderBottom:`1px solid ${G.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#fff",zIndex:1}}>
        <div>
          <div style={{fontWeight:700,fontSize:16,color:G.text}}>Capture Payment & ID</div>
          <div style={{fontSize:12,color:G.muted,marginTop:2}}>{customer?.name} · {shipment?.shipment_id}</div>
        </div>
        <Btn v="ghost" onClick={onClose} small>✕ Close</Btn>
      </div>

      <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:20}}>

        {/* ID Section */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Identification</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div>
              <Sel label="ID Type" value={idType} onChange={e=>{setIdType(e.target.value); if(confirmed.id_type===false) toggleConfirm("id_type");}} options={ID_TYPES}/>
              {parseResult?.id_type && <ConfirmRow field="id_type" parsed={parseResult.id_type} current={idType} confirmed={confirmed.id_type} onConfirm={()=>toggleConfirm("id_type")}/>}
            </div>
            <div>
              <Inp label="ID Number" value={idNumber} onChange={e=>{setIdNumber(e.target.value); if(confirmed.id_number===false) toggleConfirm("id_number");}} placeholder="e.g. D123-456-78-901-0"/>
              {parseResult?.id_number && <ConfirmRow field="id_number" parsed={parseResult.id_number} current={idNumber} confirmed={confirmed.id_number} onConfirm={()=>toggleConfirm("id_number")}/>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
            <div>
              <Sel label="Issuing State" value={idState} onChange={e=>{setIdState(e.target.value); if(confirmed.id_state===false) toggleConfirm("id_state");}} options={[{value:"",label:"—"}, ...US_STATES.map(s=>({value:s,label:s}))]}/>
              {parseResult?.id_state && <ConfirmRow field="id_state" parsed={parseResult.id_state} current={idState} confirmed={confirmed.id_state} onConfirm={()=>toggleConfirm("id_state")}/>}
            </div>
            <div>
              <Inp label="Date of Birth" value={dateBirth} onChange={e=>{setDateBirth(e.target.value); if(confirmed.date_birth===false) toggleConfirm("date_birth");}} placeholder="MM/DD/YYYY"/>
              {parseResult?.date_birth && <ConfirmRow field="date_birth" parsed={parseResult.date_birth} current={dateBirth} confirmed={confirmed.date_birth} onConfirm={()=>toggleConfirm("date_birth")}/>}
            </div>
          </div>
          <div style={{marginTop:12}}>
            <label style={{color:G.muted,fontSize:11,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>ID Photo (optional)</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}}/>
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:4,flexWrap:"wrap"}}>
              <Btn v="ghost" small onClick={()=>fileRef.current.click()}>{photoName ? "Change photo" : "Upload photo"}</Btn>
              {photoData && (
                <Btn v="gold" small onClick={parseIdPhoto} disabled={parsing}>
                  {parsing ? "Parsing…" : "🔍 Parse ID Photo"}
                </Btn>
              )}
              {photoName && <span style={{fontSize:12,color:G.green}}>✓ {photoName}</span>}
              {!photoName && shipment?.id_photo_url && <a href={shipment.id_photo_url} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:G.blue}}>Existing photo on file</a>}
            </div>
            {parseError && (
              <div style={{marginTop:8,padding:"8px 10px",background:"#FFF0F0",border:`1px solid ${G.red}40`,borderRadius:6,fontSize:11,color:G.red}}>
                Parse failed: {parseError}
              </div>
            )}
            {parseResult && !parseError && (
              <div style={{marginTop:8,padding:"8px 10px",background:"#F8F4EC",border:`1px solid ${G.gold}40`,borderRadius:6,fontSize:11,color:G.text,lineHeight:1.5}}>
                ✨ Auto-filled from photo · confidence {parseResult.confidence || "?"}%
                {parseResult.name && <> · Name on ID: <strong>{parseResult.name}</strong></>}
                <div style={{fontSize:10,color:G.muted,marginTop:4}}>Review each field below, then click ✓ to confirm before saving.</div>
              </div>
            )}
            {nameWarning && (
              <div style={{marginTop:8,padding:"8px 10px",background:"#FFF8E7",border:`1px solid ${G.orange}`,borderRadius:6,fontSize:11,color:G.orange,lineHeight:1.5}}>
                ⚠ {nameWarning}
              </div>
            )}
          </div>
        </div>

        {/* Payment Section */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Payment</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:12}}>
            <Sel label="Method" value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} options={PAYMENT_METHODS}/>
            <Inp label="Payment Info" value={paymentInfo} onChange={e=>setPaymentInfo(e.target.value)}
              placeholder={
                paymentMethod==="ach" ? "Routing: 123456789, Account: 987654321" :
                paymentMethod==="paypal" ? "email@example.com" :
                paymentMethod==="venmo" ? "@username" :
                paymentMethod==="zelle" ? "email or phone" :
                paymentMethod==="check" ? "Mailing address" :
                paymentMethod==="cashapp" ? "$cashtag" :
                "Payment details"
              }/>
          </div>
        </div>

        <div style={{background:G.bg,borderRadius:6,padding:"10px 12px",fontSize:11,color:G.muted,lineHeight:1.5}}>
          <strong style={{color:G.text}}>Note:</strong> ID info is stored on both the customer profile (reusable for future transactions) and a snapshot on this shipment (for the 2-year regulatory record per FL Statute 538).
        </div>

        {/* Sworn Statement — FL Statute 538.32(2)(c) */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Sworn Statement</div>
          {existingSworn ? (
            <div style={{background:"#F0F7F0",border:`1px solid #B5D5B5`,borderRadius:6,padding:"10px 12px",fontSize:12,color:"#2F5F2F"}}>
              ✓ Sworn statement on file (captured {fmtDateTime(existingSworn) || existingSworn})
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <label style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",fontSize:12,color:G.text,lineHeight:1.5}}>
                <input type="checkbox" checked={swornAge} onChange={e=>setSwornAge(e.target.checked)} style={{marginTop:2,flexShrink:0}}/>
                <span>Seller confirms they are <strong>of lawful age</strong> and the <strong>lawful owner</strong> of the goods with absolute authority to sell.</span>
              </label>
              <label style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",fontSize:12,color:G.text,lineHeight:1.5}}>
                <input type="checkbox" checked={swornPerjury} onChange={e=>setSwornPerjury(e.target.checked)} style={{marginTop:2,flexShrink:0}}/>
                <span>Seller declares <strong>under penalty of perjury</strong> that the foregoing is true and correct.</span>
              </label>
              <div style={{fontSize:10,color:G.muted,marginTop:2,lineHeight:1.4}}>
                Required by FL Statute 538.32(2)(c) before payment can be remitted. Capture verbally over phone/email/text from the seller, then check both boxes.
              </div>
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
          <Btn v="ghost" small onClick={sendSelfServeLink} disabled={sendingLink||!customer?.email}>
            {sendingLink ? "Sending…" : "✉️ Send link instead"}
          </Btn>
          <div style={{display:"flex",gap:10}}>
            <Btn v="ghost" onClick={onClose}>Cancel</Btn>
            <Btn v="gold" onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn>
          </div>
        </div>

        {sendLinkResult && (
          <div style={{
            padding:"10px 12px",
            background: sendLinkResult.ok ? "#F0FFF4" : "#FFF0F0",
            border:`1px solid ${sendLinkResult.ok ? G.green : G.red}40`,
            borderRadius:6,
            fontSize:12,
            color: sendLinkResult.ok ? G.green : G.red,
            display:"flex",flexDirection:"column",gap:6,
          }}>
            <div style={{fontWeight:600}}>
              {sendLinkResult.ok ? "✓ " : "⚠ "}{sendLinkResult.message}
            </div>
            {sendLinkResult.url && (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <code style={{fontSize:10,background:"#fff",padding:"2px 6px",borderRadius:3,border:`1px solid ${G.border}`,wordBreak:"break-all",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}>{sendLinkResult.url}</code>
                <button onClick={()=>{navigator.clipboard.writeText(sendLinkResult.url); alert("Copied!");}} style={{padding:"4px 8px",fontSize:10,fontWeight:700,border:`1px solid ${G.green}`,background:"#fff",color:G.green,borderRadius:4,cursor:"pointer",flexShrink:0}}>Copy</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </div>;
}


// ══════════════════════════════════════════════════════════
// INVENTORY PHOTOS PANEL
// Mobile-camera-first capture of received-item photos.
// These are the photos that get sent to LeadsOnline as the
// official "transaction photos" per FL Statute 538.32(4) —
// NOT the lead-intake customer phone photos.
// ══════════════════════════════════════════════════════════

function InventoryPhotosPanel({shipment, photos, onPhotoAdded}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef();

  // Filter photos to only inventory ones
  const inventoryPhotos = (photos || []).filter(p =>
    String(p.source || "").toLowerCase() === "inventory"
  );

  async function setPhotoStatus(photoId, newStatus) {
    try {
      await apiPost({action:"setPhotoStatus", photo_id:photoId, purchase_status:newStatus});
      if (onPhotoAdded) onPhotoAdded();  // refresh photos from server
    } catch(e) {
      alert("Couldn't update photo status: " + (e && e.message || e));
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      // Compress image client-side before upload — phone photos are often 3-8MB raw
      // which blows past Apps Script base64 limits. Resize to max 1600px and JPEG q=0.85.
      const base64 = await compressImage(file, 1600, 0.85);
      const sizeKB = Math.round(base64.length / 1024);
      console.log("[InventoryPhoto] uploading", file.name, "compressed to", sizeKB + "KB");
      // Apps Script soft limit is around 10MB total POST body; warn if approaching
      if (base64.length > 8 * 1024 * 1024) {
        setUploadError(`Photo too large after compression (${sizeKB}KB). Try a different photo.`);
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      const result = await apiPost({
        action: "addInventoryPhoto",
        shipment_id: shipment.shipment_id,
        image: base64,
      });
      console.log("[InventoryPhoto] result:", result);
      if (result && result.success) {
        if (onPhotoAdded) onPhotoAdded(result);
      } else {
        setUploadError("Upload failed: " + (result?.error || "no response from server"));
      }
    } catch(err) {
      console.error("[InventoryPhoto] error:", err);
      setUploadError("Upload failed: " + (err.message || String(err)));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Compress image to a max dimension and JPEG quality. Returns base64 data URL.
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          // Scale down if either dimension exceeds maxDim
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round(height * (maxDim / width));
              width = maxDim;
            } else {
              width = Math.round(width * (maxDim / height));
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsDataURL(file);
    });
  }

  function getDriveThumb(url) {
    if (!url) return "";
    const m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w200` : url;
  }

  return <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>
        📸 Inventory Photos {inventoryPhotos.length>0 && `(${inventoryPhotos.length})`}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{display:"none"}}
      />
      <Btn v="gold" small onClick={()=>fileRef.current?.click()} disabled={uploading}>
        {uploading ? "Uploading…" : "+ Add Photo"}
      </Btn>
    </div>
    {uploadError && <div style={{fontSize:11,color:G.red,background:"#FFF0F0",padding:"6px 8px",borderRadius:4}}>{uploadError}</div>}
    {inventoryPhotos.length === 0 && !uploading && (
      <div style={{fontSize:12,color:G.muted,fontStyle:"italic",lineHeight:1.5}}>
        No inventory photos yet. Take photos of the item(s) as received — these are the official transaction photos for FL Statute 538 compliance and LeadsOnline.
      </div>
    )}
    {inventoryPhotos.length > 0 && (
      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
        {inventoryPhotos.map(p => {
          const status = String(p.purchase_status||"").toLowerCase();
          const isReturned = status === "returned";
          return (
          <div key={p.photo_id} style={{width:84}}>
            <a href={p.drive_url} target="_blank" rel="noopener noreferrer"
               style={{display:"block",width:84,height:84,borderRadius:6,overflow:"hidden",border:`2px solid ${isReturned?"#C0392B":G.border}`,background:G.bg,position:"relative",opacity:isReturned?0.5:1}}
               title={`Uploaded ${p.uploaded_at ? fmtDateTime(p.uploaded_at) : ""}`}>
              <img src={getDriveThumb(p.drive_url)} alt="inventory"
                   style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                   onError={e=>{e.target.style.display="none";}}/>
              {isReturned && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(192,57,43,0.15)"}}>
                <span style={{background:"#C0392B",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 5px",borderRadius:3,letterSpacing:"0.04em"}}>RETURNED</span>
              </div>}
            </a>
            <div style={{display:"flex",gap:3,marginTop:3}}>
              <button onClick={()=>setPhotoStatus(p.photo_id, isReturned?"":"returned")}
                title={isReturned?"Mark as purchased (will report to LeadsOnline)":"Mark as returned (excluded from LeadsOnline)"}
                style={{flex:1,fontSize:9,fontWeight:700,padding:"2px 0",borderRadius:3,cursor:"pointer",border:`1px solid ${isReturned?"#C0392B":G.border}`,background:isReturned?"#C0392B":"#fff",color:isReturned?"#fff":G.muted}}>
                {isReturned?"↩ returned":"buying"}
              </button>
            </div>
          </div>
          );
        })}
      </div>
    )}
    <div style={{fontSize:10,color:G.muted,marginTop:8,lineHeight:1.4}}>
      Tap a photo's button to mark items you're <strong>returning</strong> (not buying). Returned items are excluded from the LeadsOnline report. Default is "buying."
    </div>
  </div>;
}


// ══════════════════════════════════════════════════════════
// CUSTOMER HISTORY (inline in detail pane)
// ══════════════════════════════════════════════════════════

function CustomerHistory({shipment,allShipments,allCustomers}) {
  const [peekShip,setPeekShip]=useState(null);
  if(!shipment||!allShipments) return null;
  const others=allShipments.filter(s=>s.customer_id===shipment.customer_id&&s.shipment_id!==shipment.shipment_id);
  if(others.length===0) return null;
  const sorted=[...others].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return <div style={{marginTop:16,background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`}}>
    <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Customer History ({others.length} other shipment{others.length!==1?"s":""})</div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {sorted.map(s=>{
        const high=parseEstHigh(s.estimate);
        return <div key={s.shipment_id}
          onClick={()=>setPeekShip(s)}
          title="Click for details"
          style={{display:"flex",gap:10,alignItems:"center",fontSize:12,padding:"6px 8px",borderRadius:6,background:G.bg,cursor:"pointer",transition:"background 0.1s"}}
          onMouseEnter={e=>{e.currentTarget.style.background="#F5EFE3";}}
          onMouseLeave={e=>{e.currentTarget.style.background=G.bg;}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:600,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayItem(s)}</div>
            <div style={{fontSize:10,color:G.muted,marginTop:2}}>{s.shipment_id} · {s.created_at?new Date(s.created_at).toLocaleDateString():""}</div>
          </div>
          {high>0&&<div style={{color:G.gold,fontWeight:700,flexShrink:0}}>{fmt$(high)}</div>}
          <Badge stage={s.stage} sm/>
          {s.purchase_price&&<div style={{color:G.green,fontWeight:700,fontSize:11,flexShrink:0}}>paid {fmt$(s.purchase_price)}</div>}
        </div>;
      })}
    </div>
    {peekShip&&<PastShipmentPeek shipment={peekShip} onClose={()=>setPeekShip(null)}/>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// PAST SHIPMENT PEEK MODAL (read-only view from customer history)
// ══════════════════════════════════════════════════════════

function PastShipmentPeek({shipment,onClose}) {
  const [photos,setPhotos]=useState([]);
  const [photosLoading,setPhotosLoading]=useState(false);

  useEffect(()=>{
    if(!shipment?.shipment_id) return;
    setPhotos([]);
    setPhotosLoading(true);
    apiFetch({action:"getPhotos",shipment_id:shipment.shipment_id})
      .then(res=>{
        let photoList=Array.isArray(res)?res:[];
        // Also check notes field for photo URLs (newer shipments before Photos tab backfill)
        const notesPhotoMatch=String(shipment.notes||'').match(/photo:\s*(https:\/\/drive\.google\.com\/[^\s|]+)/);
        if(notesPhotoMatch&&!photoList.find(p=>p.drive_url===notesPhotoMatch[1])) {
          photoList=[...photoList,{drive_url:notesPhotoMatch[1],source:'notes'}];
        }
        setPhotos(photoList);
        setPhotosLoading(false);
      })
      .catch(()=>setPhotosLoading(false));
  },[shipment?.shipment_id,shipment?.notes]);

  if(!shipment) return null;
  const stop=e=>e.stopPropagation();
  const driveThumb=(url)=>{
    if(!url) return "";
    const m=String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m?`https://drive.google.com/thumbnail?id=${m[1]}&sz=w300`:url;
  };

  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={stop} style={{background:"#fff",borderRadius:12,maxWidth:600,width:"100%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 50px rgba(0,0,0,0.3)"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${G.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#fff",zIndex:1,borderRadius:"12px 12px 0 0"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase"}}>Past Shipment · view only</div>
          <div style={{fontSize:16,fontWeight:700,color:G.text,marginTop:2}}>{shipment.shipment_id}</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,color:G.muted,cursor:"pointer",lineHeight:1,padding:"0 8px"}} title="Close">×</button>
      </div>
      <div style={{padding:20}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <Badge stage={shipment.stage}/>
          {shipment.created_at&&<div style={{fontSize:11,color:G.muted}}>Created {fmtDateTime(shipment.created_at)}</div>}
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Item</div>
          <div style={{fontSize:14,color:G.text}}>{displayItem(shipment)||"—"}</div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Estimate</div>
            <div style={{fontSize:14,color:G.gold,fontWeight:700}}>{shipment.estimate||"—"}</div>
          </div>
          {shipment.purchase_price&&<div>
            <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Paid</div>
            <div style={{fontSize:14,color:G.green,fontWeight:700}}>{fmt$(shipment.purchase_price)}</div>
          </div>}
          {shipment.shipping_type&&<div>
            <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Shipping</div>
            <div style={{fontSize:13,color:G.text}}>{shipment.shipping_type}</div>
          </div>}
          {shipment.payment_method&&<div>
            <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Payment</div>
            <div style={{fontSize:13,color:G.text}}>{shipment.payment_method}</div>
          </div>}
        </div>

        {(shipment.outbound_tracking||shipment.return_tracking)&&<div style={{marginBottom:14,padding:10,background:G.bg,borderRadius:6}}>
          {shipment.outbound_tracking&&<div style={{fontSize:11,color:G.text,marginBottom:shipment.return_tracking?4:0}}>
            <span style={{color:G.muted}}>Outbound: </span>{shipment.outbound_tracking}
          </div>}
          {shipment.return_tracking&&<div style={{fontSize:11,color:G.text}}>
            <span style={{color:G.muted}}>Return: </span>{shipment.return_tracking}
          </div>}
        </div>}

        {(() => {
          // MAY 29 PATCH: bottom Photos panel shows ONLY non-inventory photos.
          // Inventory photos render in InventoryPhotosPanel above. Without this
          // filter, an inventory upload appeared in both places.
          const customerPhotos = (photos || []).filter(p =>
            String(p.source || "").toLowerCase() !== "inventory"
          );
          return (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Customer Photos {customerPhotos.length>0&&`(${customerPhotos.length})`}</div>
          {photosLoading
            ? <div style={{fontSize:12,color:G.muted,fontStyle:"italic"}}>Loading photos…</div>
            : customerPhotos.length===0
              ? <div style={{fontSize:12,color:G.muted,fontStyle:"italic"}}>No customer photos on file</div>
              : <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {customerPhotos.map((p,i)=>{
                    const thumb=driveThumb(p.drive_url);
                    return <a key={i} href={p.drive_url} target="_blank" rel="noopener noreferrer"
                      title={p.source ? `Source: ${p.source}` : "Open in Drive"}
                      style={{display:"block",width:90,height:90,borderRadius:6,overflow:"hidden",border:`1px solid ${G.border}`,background:G.bg,flexShrink:0}}>
                      <img src={thumb} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={e=>{e.target.style.display="none";}}/>
                    </a>;
                  })}
                </div>}
        </div>
          );
        })()}

        {shipment.customer_message&&<div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Customer Message</div>
          <div style={{fontSize:12,color:G.text,whiteSpace:"pre-wrap",background:G.bg,padding:10,borderRadius:6}}>{shipment.customer_message}</div>
        </div>}

        {shipment.notes&&<div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Notes</div>
          <div style={{fontSize:12,color:G.text,whiteSpace:"pre-wrap",background:G.bg,padding:10,borderRadius:6}}>{shipment.notes}</div>
        </div>}

        {shipment.agent_notes&&<div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Agent Notes</div>
          <div style={{fontSize:12,color:G.text,whiteSpace:"pre-wrap",background:G.bg,padding:10,borderRadius:6}}>{shipment.agent_notes}</div>
        </div>}

        <div style={{marginTop:16,padding:10,background:"#FFF8EE",borderRadius:6,fontSize:11,color:G.muted,textAlign:"center"}}>
          View only — to edit this shipment, search for {shipment.shipment_id} in the customer list
        </div>
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// SHIPMENT ROW (left pane list item)
// ══════════════════════════════════════════════════════════

function ShipmentRow({shipment,customer,selected,onClick,onCheck,checked}) {
  const high=parseEstHigh(shipment.estimate);
  const srd=stageRelevantDate(shipment);
  const absStr=srd ? fmtDateTime(srd.ts) : null;
  const ageStr=srd ? timeAgo(srd.ts) : null;
  const ageLabel=srd ? srd.label : "";
  const stuckCol=stuckColor(shipment, G);
  return <div style={{position:"relative"}}>
    <input type="checkbox" checked={checked||false} onChange={e=>{e.stopPropagation();onCheck&&onCheck(e.target.checked);}} style={{position:"absolute",top:14,left:6,zIndex:1,cursor:"pointer"}} onClick={e=>e.stopPropagation()}/>
    <div onClick={onClick} style={{paddingLeft:26,paddingRight:16,paddingTop:12,paddingBottom:12,cursor:"pointer",borderBottom:`1px solid ${G.border}`,background:selected?"#FFF8EE":"#fff",borderLeft:selected?`3px solid ${G.gold}`:"3px solid transparent",transition:"background 0.1s"}} onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#FDFAF6";}} onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="#fff";}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <Avatar name={customer?.name||shipment.customer_id} size={32}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{fontWeight:600,fontSize:13,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{customer?.name||customer?.email||shipment.customer_id}</div>
            {high>0&&<div style={{color:G.gold,fontWeight:700,fontSize:12,flexShrink:0}}>{fmt$(high)}</div>}
          </div>
          <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayItem(shipment)}</div>
          <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center",flexWrap:"wrap"}}>
            {shipment.stage==="ready_to_fulfill"
              ? <span style={{
                  background: shipment.shipping_type==="usps" ? G.green+"18" : shipment.shipping_type==="label" ? G.blue+"18" : G.purple+"18",
                  color:      shipment.shipping_type==="usps" ? G.green      : shipment.shipping_type==="label" ? G.blue      : G.purple,
                  border:     `1px solid ${shipment.shipping_type==="usps" ? G.green+"33" : shipment.shipping_type==="label" ? G.blue+"33" : G.purple+"33"}`,
                  borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,whiteSpace:"nowrap"
                }}>
                  {shipment.shipping_type==="usps" ? "USPS Label" : shipment.shipping_type==="label" ? "FedEx Label" : shipment.shipping_type==="kit" ? "Kit" : "Ready to Fulfill"}
                </span>
              : <Badge stage={shipment.stage} sm/>}
            {absStr&&<span title={ageStr?`${ageStr} ago`:""} style={{fontSize:10,color:stuckCol||G.muted,fontWeight:stuckCol?700:400}}>{ageLabel} {absStr}</span>}
            {shipment.shipping_type&&<span style={{fontSize:10,color:G.muted,background:G.bg,borderRadius:3,padding:"1px 5px"}}>{shipment.shipping_type}</span>}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// DETAIL PANE
// ══════════════════════════════════════════════════════════

// CONTACT LOG LIST with inline edit
function ContactLogList({logs, onUpdate, onDelete, currentShipmentId, allShipments}) {
  const [editingIdx, setEditingIdx] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const reversed = [...logs].reverse();

  // Short label for a shipment id (e.g. "SHP-664" → "664") for compact tags.
  const shipShort = (sid) => {
    if (!sid) return null;
    const m = String(sid).match(/(\d+)\s*$/);
    return m ? m[1] : String(sid);
  };

  async function saveEdit(log, idx) {
    if (!editNotes.trim()) return;
    setSaving(true);
    try {
      // Update in sheet via log_id if available
      if (log.log_id) {
        await apiPost({action:'updateContactLog', log_id:log.log_id, updates:{notes:editNotes.trim()}});
      }
      onUpdate({...log, notes:editNotes.trim()}, idx);
      setEditingIdx(null);
    } catch(e) {
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  }

  async function deleteLog(log, idx) {
    if (!window.confirm('Delete this log entry?')) return;
    try {
      if (log.log_id) {
        await apiPost({action:'deleteContactLog', log_id:log.log_id});
      }
      onDelete(idx);
    } catch(e) {
      alert('Delete failed: ' + e.message);
    }
  }

  return <div style={{marginTop:16,background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`}}>
    <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Contact Log</div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {reversed.map((log,i)=>{
        const logShip = log.shipment_id || "";
        const isOther = logShip && currentShipmentId && logShip !== currentShipmentId;
        const isThis = logShip && currentShipmentId && logShip === currentShipmentId;
        return <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:12,opacity:isOther?0.55:1}}>
        <span style={{background:G.bg,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700,color:G.muted,flexShrink:0,textTransform:"capitalize"}}>{log.type||"note"}</span>
        <div style={{flex:1}}>
          {editingIdx===i
            ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <input
                  value={editNotes}
                  onChange={e=>setEditNotes(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter')saveEdit(log,i);if(e.key==='Escape')setEditingIdx(null);}}
                  style={{flex:1,fontSize:12,padding:"3px 6px",border:`1px solid ${G.gold}`,borderRadius:4,outline:"none"}}
                  autoFocus
                />
                <button onClick={()=>saveEdit(log,i)} disabled={saving} style={{fontSize:11,padding:"2px 8px",background:G.gold,color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>{saving?"…":"Save"}</button>
                <button onClick={()=>setEditingIdx(null)} style={{fontSize:11,padding:"2px 6px",background:"none",border:`1px solid ${G.border}`,borderRadius:4,cursor:"pointer",color:G.muted}}>Cancel</button>
              </div>
            : <span style={{color:G.text}}>
                {log.notes}
                {logShip&&<span title={isOther?("From a different shipment: "+logShip):logShip} style={{marginLeft:6,background:isOther?"#FBEFEF":"#FFF8EE",color:isOther?"#A05A5A":G.gold,border:`1px solid ${isOther?"#A05A5A44":G.gold+"44"}`,borderRadius:4,padding:"0px 6px",fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>{isOther?"⤺ SHP-"+shipShort(logShip):"SHP-"+shipShort(logShip)}</span>}
              </span>
          }
        </div>
        <div style={{color:G.muted,flexShrink:0,fontSize:10}}>{log.timestamp?new Date(log.timestamp).toLocaleDateString():""}</div>
        {editingIdx!==i&&<div style={{display:"flex",gap:4,flexShrink:0}}>
          <button onClick={()=>{setEditingIdx(i);setEditNotes(log.notes||'');}} title="Edit" style={{fontSize:10,padding:"1px 5px",background:"none",border:`1px solid ${G.border}`,borderRadius:3,cursor:"pointer",color:G.muted}}>✏️</button>
          <button onClick={()=>deleteLog(log,i)} title="Delete" style={{fontSize:10,padding:"1px 5px",background:"none",border:`1px solid ${G.border}`,borderRadius:3,cursor:"pointer",color:G.muted}}>🗑️</button>
        </div>}
      </div>;
      })}
    </div>
  </div>;
}

// MAY 27: Workflow nudge modals — fired by DetailPane on stage transitions.
// Modeled after LogModal for consistency.

function ReceivedPhotoPromptModal({shipment, onPhotoAdded, onSkip}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  // Reuse the same compress + upload pattern as InventoryPhotosPanel.
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
            else { width = Math.round(width * (maxDim / height)); height = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(""); setUploading(true);
    try {
      const base64 = await compressImage(file, 1600, 0.85);
      const result = await apiPost({
        action: "addInventoryPhoto",
        shipment_id: shipment.shipment_id,
        image: base64,
      });
      if (result && result.success) {
        onPhotoAdded(result);
      } else {
        setError("Upload failed: " + (result?.error || "no response"));
      }
    } catch (err) {
      setError("Upload failed: " + (err.message || String(err)));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onSkip()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(460px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontSize:22,marginBottom:6}}>📸</div>
      <div style={{fontWeight:700,fontSize:17,marginBottom:6,color:G.text}}>Add an inventory photo?</div>
      <div style={{fontSize:13,color:G.muted,lineHeight:1.5,marginBottom:18}}>
        Take a photo of {shipment.item ? <strong>{shipment.item}</strong> : "the item"} as received. Required for FL 538 compliance and LeadsOnline.
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} disabled={uploading} style={{display:"none"}} id="received-photo-input" />
      <label htmlFor="received-photo-input" style={{display:"block",background:G.gold,color:"#fff",borderRadius:8,padding:"12px 16px",textAlign:"center",fontWeight:700,fontSize:14,cursor:uploading?"wait":"pointer",letterSpacing:"0.04em"}}>
        {uploading ? "Uploading…" : "📷 Take or upload photo"}
      </label>
      {error && <div style={{color:G.red,fontSize:12,marginTop:10}}>{error}</div>}
      <div style={{textAlign:"center",marginTop:14}}>
        <button onClick={onSkip} disabled={uploading} style={{background:"none",border:"none",color:G.muted,fontSize:13,cursor:uploading?"wait":"pointer",textDecoration:"underline"}}>Skip for now</button>
      </div>
    </div>
  </div>;
}

function InspectedNotesPromptModal({shipment, onSaved, onSkip}) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!notes.trim()) { onSkip(); return; }
    setError(""); setSaving(true);
    try {
      // addContactLog returns the new logId string on success, or a wrapped
      // error object on failure. Treat any truthy non-error response as success.
      const result = await apiPost({
        action: "addContactLog",
        data: { customer_id: shipment.customer_id, type: "note", notes: "Inspection: " + notes.trim(), shipment_id: shipment.shipment_id }
      });
      const isError = result && typeof result === "object" && result.error;
      if (!isError && result) {
        onSaved({ type:"note", notes:"Inspection: "+notes.trim(), timestamp:new Date().toISOString(), shipment_id: shipment.shipment_id });
      } else {
        setError("Save failed: " + (result?.error || "no response"));
      }
    } catch (err) {
      setError("Save failed: " + (err.message || String(err)));
    }
    setSaving(false);
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onSkip()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(500px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontSize:22,marginBottom:6}}>🔍</div>
      <div style={{fontWeight:700,fontSize:17,marginBottom:6,color:G.text}}>Log inspection notes</div>
      <div style={{fontSize:13,color:G.muted,lineHeight:1.5,marginBottom:14}}>
        What did you find? Weight, purity test results, condition, anything unexpected.
      </div>
      <textarea
        value={notes}
        onChange={e=>setNotes(e.target.value)}
        placeholder="e.g. 14K confirmed via acid + XRF. 8.2g. Light wear, one missing stone. Clean otherwise."
        rows={5}
        autoFocus
        style={{width:"100%",padding:10,fontSize:14,fontFamily:"inherit",border:`1px solid ${G.border}`,borderRadius:8,resize:"vertical",boxSizing:"border-box"}}
      />
      {error && <div style={{color:G.red,fontSize:12,marginTop:8}}>{error}</div>}
      <div style={{display:"flex",gap:10,marginTop:16,alignItems:"center"}}>
        <Btn v="green" onClick={save} disabled={saving || !notes.trim()}>{saving ? "Saving…" : "Save note"}</Btn>
        <button onClick={onSkip} disabled={saving} style={{background:"none",border:"none",color:G.muted,fontSize:13,cursor:saving?"wait":"pointer",textDecoration:"underline",marginLeft:"auto"}}>Skip for now</button>
      </div>
    </div>
  </div>;
}

function OfferPromptModal({shipment, customer, onSaved, onCancel}) {
  const [price, setPrice] = useState("");
  const [desc, setDesc] = useState("");
  const canSave = price !== "" && !isNaN(parseFloat(price));

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onCancel()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(500px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontSize:22,marginBottom:6}}>💸</div>
      <div style={{fontWeight:700,fontSize:17,marginBottom:6,color:G.text}}>Generate offer</div>
      <div style={{fontSize:13,color:G.muted,lineHeight:1.5,marginBottom:14}}>
        Set the offer for <strong>{shipment.item||"this item"}</strong>. This is the amount the customer sees on the self-serve acceptance page.
        {shipment.estimate && <span> AI estimate was <strong>{shipment.estimate}</strong> for reference.</span>}
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:700,color:G.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Offer price</div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:18,fontWeight:700,color:G.gold}}>$</span>
          <input
            value={price}
            onChange={e=>setPrice(e.target.value)}
            type="number"
            placeholder="0.00"
            autoFocus
            style={{flex:1,padding:10,fontSize:16,fontWeight:700,border:`1px solid ${G.border}`,borderRadius:8,boxSizing:"border-box"}}
          />
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:G.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Description <span style={{textTransform:"none",fontWeight:400}}>(shown to customer with the offer)</span></div>
        <textarea
          value={desc}
          onChange={e=>setDesc(e.target.value)}
          placeholder="e.g. 14K yellow gold, 8.2g confirmed. Offer reflects current gold spot price."
          rows={3}
          style={{width:"100%",padding:10,fontSize:14,fontFamily:"inherit",border:`1px solid ${G.border}`,borderRadius:8,resize:"vertical",boxSizing:"border-box"}}
        />
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <Btn v="gold" onClick={()=>onSaved(parseFloat(price), desc.trim())} disabled={!canSave}>Generate offer</Btn>
        <button onClick={onCancel} style={{background:"none",border:"none",color:G.muted,fontSize:13,cursor:"pointer",textDecoration:"underline",marginLeft:"auto"}}>Cancel</button>
      </div>
    </div>
  </div>;
}

function BinNumberPromptModal({shipment, onSaved, onSkip}) {
  const [binNumber, setBinNumber] = useState(shipment.bin_number || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const value = String(binNumber).trim();
    if (!value) { onSkip(); return; }
    setError(""); setSaving(true);
    try {
      const result = await apiPost({
        action: "updateShipment",
        shipment_id: shipment.shipment_id,
        updates: { bin_number: value }
      });
      const isError = result && typeof result === "object" && result.error;
      if (!isError) {
        onSaved(value);
      } else {
        setError("Save failed: " + (result?.error || "no response"));
      }
    } catch (err) {
      setError("Save failed: " + (err.message || String(err)));
    }
    setSaving(false);
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onSkip()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(420px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontSize:22,marginBottom:6}}>📦</div>
      <div style={{fontWeight:700,fontSize:17,marginBottom:6,color:G.text}}>What bin?</div>
      <div style={{fontSize:13,color:G.muted,lineHeight:1.5,marginBottom:14}}>
        Assign this shipment to a physical storage bin for inspection.
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={binNumber}
        onChange={e=>setBinNumber(e.target.value)}
        placeholder="e.g. 66"
        autoFocus
        onKeyDown={e=>{ if(e.key==="Enter") save(); }}
        style={{width:"100%",padding:"12px",fontSize:18,fontFamily:"inherit",border:`1px solid ${G.border}`,borderRadius:8,boxSizing:"border-box",textAlign:"center"}}
      />
      {error && <div style={{color:G.red,fontSize:12,marginTop:8}}>{error}</div>}
      <div style={{display:"flex",gap:10,marginTop:16,alignItems:"center"}}>
        <Btn v="green" onClick={save} disabled={saving || !String(binNumber).trim()}>{saving ? "Saving…" : "Save bin"}</Btn>
        <button onClick={onSkip} disabled={saving} style={{background:"none",border:"none",color:G.muted,fontSize:13,cursor:saving?"wait":"pointer",textDecoration:"underline",marginLeft:"auto"}}>Skip for now</button>
      </div>
    </div>
  </div>;
}

function DetailPane({shipment,customer,contactLogs,allShipments,allCustomers,onUpdate,onNewShipment,onClose}) {
  const [modal,setModal]=useState(null);
  const [localLogs,setLocalLogs]=useState(contactLogs||[]);
  const [photos,setPhotos]=useState([]);
  const [photosLoading,setPhotosLoading]=useState(false);
  // MAY 27 PATCH: workflow nudge prompts triggered by stage transitions.
  // These set on stage→received (photo) and stage→inspected (notes), and
  // can be dismissed with one click. Compliance-critical (FL 538.32 inventory
  // photos must be captured post-receipt).
  const [showReceivedPhotoPrompt, setShowReceivedPhotoPrompt] = useState(false);
  const [showBinNumberPrompt, setShowBinNumberPrompt] = useState(false);
  const [showInspectedNotesPrompt, setShowInspectedNotesPrompt] = useState(false);
  const [showOfferPrompt, setShowOfferPrompt] = useState(false);

  // PERF PATCH (May 19): attribution is lazy-loaded.
  // Initial load uses getShipmentsLite (no attribution). When this detail pane opens,
  // if the shipment came from the lite endpoint (attribution === null), fetch it now.
  // The fetched attribution gets attached to the shipment object via onUpdate so the
  // list-level state cache it (no refetch on re-open).
  useEffect(()=>{
    if (!shipment) return;
    if (shipment.attribution !== null) return;  // already loaded (object or undefined)
    apiFetch({action:"getShipmentAttribution",shipment_id:shipment.shipment_id})
      .then(attr=>{
        // attr is the attribution object or null. Either way, mark as loaded by setting
        // a non-null value (use the object, or set to a marker if null) so we don't refetch.
        const updated = {...shipment, attribution: attr || {_empty: true}};
        onUpdate(updated, customer);
      })
      .catch(()=>{
        // On error, mark as loaded-with-nothing so we don't loop retrying
        const updated = {...shipment, attribution: {_empty: true}};
        onUpdate(updated, customer);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[shipment?.shipment_id]);

  // Sync localLogs when contactLogs prop changes (different customer selected)
  useEffect(()=>{ setLocalLogs(contactLogs||[]); },[contactLogs]);

  // Fetch photos. Extracted as a callback so InventoryPhotosPanel can trigger a refresh after upload.
  const refetchPhotos = useCallback(()=>{
    if(!shipment) return;
    setPhotosLoading(true);
    apiFetch({action:"getPhotos",shipment_id:shipment.shipment_id})
      .then(res=>{
        let photoList = Array.isArray(res) ? res : [];
        // Also check notes field for photo URLs (newer shipments before Photos tab backfill)
        const notesPhotoMatch = String(shipment.notes||'').match(/photo:\s*(https:\/\/drive\.google\.com\/[^\s|]+)/);
        if (notesPhotoMatch && !photoList.find(p=>p.drive_url===notesPhotoMatch[1])) {
          photoList = [...photoList, {drive_url: notesPhotoMatch[1], source: 'notes'}];
        }
        setPhotos(photoList);
        setPhotosLoading(false);
      })
      .catch(()=>setPhotosLoading(false));
  },[shipment?.shipment_id, shipment?.notes]);

  useEffect(()=>{
    setPhotos([]);
    refetchPhotos();
  },[shipment?.shipment_id, refetchPhotos]);

  if(!shipment){
    return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a shipment to view details</div>
    </div>;
  }

  function getActions(){
    switch(shipment.stage){
      case "ready_to_fulfill": return [{label:"→ Outbound Complete",v:"green",stage:"outbound_complete"},{label:"Log Contact",v:"blue",action:"log"}];
      case "outbound_complete": return [{label:"→ Received",v:"green",stage:"received"},{label:"Log Contact",v:"blue",action:"log"}];
      case "received": return [{label:"→ Inspected",v:"green",stage:"inspected"}];
      case "inspected": return [{label:"📤 Generate Offer",v:"orange",stage:"pending_response"}];
      case "pending_response": return [{label:"Log Contact / Follow Up",v:"blue",action:"log"},{label:"✓ Accepted → Pending Payment",v:"green",stage:"pending_payment"},{label:"✗ Declined → Returned",v:"outline",stage:"returned"}];
      case "pending_payment": return [{label:"💵 Mark Paid → Pending LeadsOnline",v:"green",stage:"pending_leadsonline"}];
      case "pending_leadsonline": return [{label:"📋 Push handled in panel below",v:"blue",action:"log"}];
      default: return [];
    }
  }

  async function copyInfoFromPreviousShipment(){
    // Repeat-customer convenience: pull ID + payment info from this customer's
    // most recent OTHER shipment that has it, onto this shipment, so a warm
    // repeat seller (e.g. handled over SMS) doesn't re-enter known details.
    // Stamps a FRESH sworn_statement_at for THIS transaction (per-sale legal
    // attestation — valid because the customer attests on this sale's acceptance).
    const mine=(allShipments||[]).filter(s=>s.customer_id===shipment.customer_id && s.shipment_id!==shipment.shipment_id);
    if(!mine.length){ alert("No other shipments found for this customer to copy from."); return; }
    // Prefer the most recent one that actually has ID data.
    const withId=mine.filter(s=>String(s.id_number||"").trim()||String(s.date_birth||"").trim());
    const pool=withId.length?withId:mine;
    pool.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    const src=pool[0];
    const fields=["id_type","id_number","id_state","date_birth","payment_method","payment_info"];
    const copied={};
    fields.forEach(f=>{ if(String(src[f]||"").trim()) copied[f]=src[f]; });
    if(!Object.keys(copied).length){ alert("Previous shipment ("+src.shipment_id+") has no ID/payment info to copy."); return; }
    const summary=Object.keys(copied).map(f=>f+": "+copied[f]).join("\n");
    if(!confirm("Copy from "+src.shipment_id+" onto "+shipment.shipment_id+"?\n\n"+summary+"\n\nA fresh sworn-statement timestamp will be stamped for THIS sale. You can still edit any field after.")) return;
    const updates={...copied, sworn_statement_at:new Date().toISOString()};
    try{
      await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates});
      onUpdate({...shipment,...updates});
      alert("✅ Copied ID + payment from "+src.shipment_id+" and stamped a fresh sworn statement. Edit any field if "+(customer?.name||"the customer")+" wants something different this time.");
    }catch(e){ alert("Copy failed: "+e.message); }
  }

  async function generateReturnLabel(){
    if(!customer?.address){ alert("This customer has no address on file — can't create a return label."); return; }
    // Returns vary in size/weight (whatever the customer originally sent), so
    // collect the box dimensions + weight per label. USPS bills on weight + size.
    const dimStr = window.prompt(
      "Box dimensions in inches (L x W x H)?\n\nExample: 13x11x6",
      "13x11x6"
    );
    if(dimStr===null) return;
    const m = dimStr.replace(/\s/g,"").match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
    if(!m){ alert("Couldn't read dimensions. Use format L x W x H, e.g. 13x11x6"); return; }
    const length=parseFloat(m[1]), width=parseFloat(m[2]), height=parseFloat(m[3]);

    const wStr = window.prompt(
      "Estimated package weight in POUNDS?\n\n⚠ Round UP — underestimating triggers USPS surcharges. If it feels like ~2.3 lbs, enter 3.",
      "2"
    );
    if(wStr===null) return;
    const weight_lbs=parseFloat(String(wStr).replace(/[^0-9.]/g,""));
    if(isNaN(weight_lbs)||weight_lbs<=0){ alert("Couldn't read weight. Enter a number of pounds, e.g. 3"); return; }

    if(!confirm("Generate USPS Ground Advantage return label for "+(customer?.name||"the customer")+"?\n\n"+
      "To: "+customer.address+"\n"+
      "Box: "+length+"×"+width+"×"+height+" in · ~"+weight_lbs+" lb\n\n"+
      "Bills postage to us (outbound). Label emailed to you to print; tracking emailed to the customer.")) return;
    try {
      const res = await apiPost({action:"generateReturnLabel", shipment_id:shipment.shipment_id,
        length, width, height, weight_lbs, weight_oz:0});
      if(res && res.success){
        if(res.tracking_number) onUpdate({...shipment, return_tracking:res.tracking_number});
        alert("✅ "+(res.message||"Return label created")+"\n\nLabel PDF emailed to you to print.");
      } else {
        alert("⚠ "+((res&&res.message)||(res&&res.error)||"Return label failed"));
      }
    } catch(e){ alert("Return label failed: "+(e&&e.message||e)); }
  }

  async function resendOfferEmail(){
    // Re-send (or send) the self-serve offer email for a shipment that's already
    // at Pending Response. Pre-fills the amount from the stored offer_price.
    if(!customer?.email){ alert("This customer has no email on file."); return; }
    const stored = shipment?.offer_price ? String(shipment.offer_price).replace(/[^0-9.]/g,"") : "";
    const promptAmount = window.prompt(
      "Offer amount to send "+(customer?.name||"customer")+"?\n\nExamples: 300 or $300.00",
      stored
    );
    if(promptAmount===null) return;
    let offerAmount="";
    if(promptAmount.trim()){
      const n=parseFloat(String(promptAmount).replace(/[^0-9.]/g,""));
      if(isNaN(n)||n<=0){ alert("Couldn't parse that as a dollar amount. Try '300' or '300.00'."); return; }
      offerAmount="$"+n.toFixed(2);
    }
    const promptDesc=window.prompt(
      "Short description shown under the offer (optional).",
      shipment?.offer_description || (shipment?.item?("for "+shipment.item):"")
    );
    if(promptDesc===null) return;
    const offerDescription=promptDesc.trim();
    if(!confirm("Send offer email to:\n\n"+customer?.name+" <"+customer?.email+">\n\n"+(offerAmount?("Offer: "+offerAmount+"\n"):"(no amount)\n")+(offerDescription?("Description: "+offerDescription):"")+"\n\nThey'll get the acceptance link.")) return;
    try{
      const res=await apiPost({
        action:"generateSelfServeToken",
        shipment_id:shipment.shipment_id,
        customer_id:shipment.customer_id,
        offer_amount:offerAmount,
        offer_description:offerDescription,
        send_email:true
      });
      if(res&&res.success){
        // keep offer_price/description on the shipment in sync with what was sent
        if(offerAmount){
          apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{offer_price:offerAmount,offer_description:offerDescription}}).then(()=>onUpdate({...shipment,offer_price:offerAmount,offer_description:offerDescription})).catch(()=>{});
        }
        alert(res.email_sent?("✅ Offer email sent to "+customer.email+" (BCC to you)."):("⚠ Saved but email not sent. Link: "+(res.url||"(none)")));
      } else {
        alert("⚠ Send failed: "+((res&&res.error)||"unknown"));
      }
    }catch(e){ alert("Send failed: "+e.message); }
  }

  async function quickStage(stage){
    try {
      // Special case: USPS label shipment moving to outbound_complete
      // Generate Shippo label automatically before changing stage
      if(stage==="outbound_complete" && shipment.stage==="ready_to_fulfill" && (shipment.shipping_type==="usps" || shipment.shipping_type==="label")) {
        if(!customer?.address || !customer?.email) {
          alert("Cannot generate label: customer is missing address or email.");
          return;
        }
        const carrier = shipment.shipping_type==="label" ? "FedEx" : "USPS";
        const confirmed = window.confirm("Generate and email " + carrier + " label to " + (customer?.name||"customer") + " at " + customer?.email + "?");
        if(!confirmed) return;
        try {
          const labelResult = await apiPost({
            action: "generateUSPSLabel",
            shipment_id: shipment.shipment_id,
            customer_id: shipment.customer_id,
            shipping_type: shipment.shipping_type,
            address: customer.address,
            name: customer.name||"",
            email: customer.email,
            phone: customer.phone||"",
            item: shipment.item||""
          });
          if(!labelResult.success) {
            alert("Label generation failed: " + (labelResult.error||"unknown error"));
            return;
          }
          onUpdate({...shipment, stage:"outbound_complete", return_tracking: labelResult.tracking});
          return;
        } catch(e) {
          alert("Label generation error: " + e.message);
          return;
        }
      }
      // GATE: Inspected → Pending Response requires an offer price.
      // Instead of blocking, open a prompt to capture offer price + description
      // right here (set the price AS you make the offer). The modal completes
      // the transition once saved.
      if (stage === "pending_response" && shipment.stage === "inspected") {
        if (!shipment.offer_price && shipment.offer_price !== 0) {
          setShowOfferPrompt(true);
          return;
        }
      }
      // STAMP: Pending Payment → Pending LeadsOnline records when payment was sent.
      if (stage === "pending_leadsonline" && shipment.stage === "pending_payment") {
        const stamp = new Date().toISOString();
        await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{stage, paid_at: stamp}});
        onUpdate({...shipment, stage, paid_at: stamp});
        return;
      }
      await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{stage}}); onUpdate({...shipment,stage});
      // MAY 27 PATCH: post-transition nudges. Fire AFTER the update succeeds
      // so the prompt only shows for real transitions, not error states.
      if (stage === "received") setShowReceivedPhotoPrompt(true);
      if (stage === "inspected") setShowInspectedNotesPrompt(true);
    }
    catch(e){alert("Failed: "+e.message);}
  }

  function Field({label,value,mono,copy}){
    if(!value) return null;
    return <div>
      <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{label}</div>
      <div
        style={{fontSize:13,color:G.text,fontFamily:mono?"monospace":"inherit",wordBreak:"break-all",cursor:copy?"pointer":"inherit",userSelect:copy?"all":"inherit"}}
        title={copy?"Click to copy":undefined}
        onClick={copy?(()=>{navigator.clipboard?.writeText(String(value));}):undefined}
      >{value}</div>
    </div>;
  }

  // ── Parse legacy `notes` field into categorized chunks ──────────
  // Patterns observed:
  //   New format (multi-item): each item on its own line as:
  //     "Item Name ($X – $Y) — rationale text..."
  //   Legacy (single-item): "Based on X... | photo: https://..."
  //   Legacy (multi-item):  "Additional items: [2] Item - $X | [3] Item - $Y"
  //   Prefixed:             "Customer note: xyz"
  //   Bare:                 "made offer $15 via email"
  function parseLegacyNotes(raw){
    if(!raw) return {items:[], aiRationale:'', photos:[], agent:[], customerMsg:''};
    const out = {items:[], aiRationale:'', photos:[], agent:[], customerMsg:''};

    // Pull out photo URLs first (match either " | photo: URL" or bare "photo: URL")
    const photoRegex = /(?:\|\s*)?photo:\s*(https?:\/\/[^\s|]+)/gi;
    let cleaned = raw;
    let m;
    while((m = photoRegex.exec(raw)) !== null){ out.photos.push(m[1]); }
    cleaned = cleaned.replace(photoRegex, '').trim();

    // Pattern A: multi-line with "Item Name ($X – $Y) — rationale"
    // Each line is a self-contained item. Split on newlines first.
    const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
    let matchedNewStyle = 0;
    // MAY 21 PATCH: helper to clean leading "+ " from item names. Appended items
    // in notes are stored as "+ Name ($X)..." and the regex's greedy .+? captures
    // the "+ " prefix. Strip it so names compare cleanly against the top-level item.
    const cleanItemName = n => String(n || '').replace(/^\s*\+\s*/, '').trim();
    for(const line of lines){
      // "Name ($low – $high) — rationale"
      const mm = line.match(/^(.+?)\s*\(\s*(\$[\d,]+(?:\s*[–\-]\s*\$[\d,]+)?)\s*\)\s*[—\-–]\s*(.+)$/);
      if(mm){
        out.items.push({name: cleanItemName(mm[1]), price: mm[2].trim(), rationale: mm[3].trim()});
        matchedNewStyle++;
        continue;
      }
      // Fallback: "Name ($X)" with no rationale
      const mm2 = line.match(/^(.+?)\s*\(\s*(\$[\d,]+(?:\s*[–\-]\s*\$[\d,]+)?)\s*\)\s*$/);
      if(mm2){
        out.items.push({name: cleanItemName(mm2[1]), price: mm2[2].trim(), rationale: ''});
        matchedNewStyle++;
        continue;
      }
    }

    // If we didn't match any new-style, try legacy patterns by splitting on " | "
    if(matchedNewStyle === 0){
      const segments = cleaned.split(/\s\|\s/).map(s=>s.trim()).filter(Boolean);
      for(const seg of segments){
        // "+ Item Name ($X)"
        if(seg.startsWith('+')){
          const plusMatch = seg.replace(/^\+\s*/,'').match(/^(.+?)\s*\(\$?([\d,\s–\-$]+)\)\s*(\[.*?\])?$/);
          if(plusMatch){
            out.items.push({name:plusMatch[1].trim(), price:'$'+plusMatch[2].trim(), rationale:'', meta:plusMatch[3]||''});
          } else {
            out.items.push({name:seg.replace(/^\+\s*/,''), price:'', rationale:''});
          }
          continue;
        }
        // "Additional items: [N] Name - $X" or just "[N] Name - $X"
        const addItemMatch = seg.match(/^(?:Additional items:\s*)?\[(\d+)\]\s*(.+?)\s*-\s*(\$[\d,\s–\-$]+)\s*$/);
        if(addItemMatch){
          out.items.push({name:addItemMatch[2].trim(), price:addItemMatch[3].trim(), rationale:'', meta:'#'+addItemMatch[1]});
          continue;
        }
        // "Customer note: xyz"
        if(/^customer note:/i.test(seg)){
          out.customerMsg = (out.customerMsg?out.customerMsg+' ':'') + seg.replace(/^customer note:\s*/i,'');
          continue;
        }
        // AI rationale heuristic: starts with "Based on" or has telltale phrases
        if(/^based on\b|final offer|secondary market|in-person (verification|authentication)/i.test(seg)){
          out.aiRationale = (out.aiRationale?out.aiRationale+' ':'') + seg;
          continue;
        }
        // Unknown → treat as agent note
        out.agent.push(seg);
      }
    }
    return out;
  }

  function NotesBox({title, color, bg, children, collapsible=false, defaultOpen=true}){
    const [open, setOpen] = useState(defaultOpen);
    return <div style={{background:bg||"#fff",border:`1px solid ${color}33`,borderRadius:8,padding:"10px 12px",marginTop:8}}>
      <div onClick={collapsible ? () => setOpen(v=>!v) : undefined}
           style={{fontSize:10,fontWeight:700,color:color,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:open?6:0,
                   cursor:collapsible?"pointer":"default",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>{title}</span>
        {collapsible && <span style={{fontSize:10,color:color,opacity:0.6}}>{open?"▾":"▸"}</span>}
      </div>
      {open && <div style={{fontSize:13,color:G.text,lineHeight:1.5}}>{children}</div>}
    </div>;
  }

  function NotesPanel({shipment}){
    const legacy = parseLegacyNotes(shipment.notes);

    // Structured sources with legacy fallback
    const agentNotes = shipment.agent_notes || (legacy.agent.length ? legacy.agent.join(' · ') : '');
    const customerMsg = shipment.customer_message || shipment.customer_edits_text || legacy.customerMsg;
    let customerEdits = shipment.customer_edits;
    if(!customerEdits && shipment.user_edits){ customerEdits = shipment.user_edits; }
    // MAY 20 PATCH: When manifest comes from legacy notes parsing, the top-level
    // `item` field (first item from the original lead) is missing — only appended
    // items in `notes` get parsed. Prepend the top-level item so all items show.
    //
    // Tina Merrick (SHP-680) example:
    //   item column: "14K Yellow Gold Openwork Band Ring" ($180-$360)   ← was missing from manifest
    //   notes:       "+ 14K Yellow Gold Ring with Decorative Design ($480-$770)"  ← only this showed
    let items = shipment.item_manifest || legacy.items;
    if (!shipment.item_manifest && shipment.item && items && items.length > 0) {
      // Only prepend if the top-level item isn't already in the parsed list (dedup by name)
      const itemName = String(shipment.item).trim();
      const itemTokens = itemName.split(/\s*\+\s*/).map(t => t.trim().toLowerCase()).filter(Boolean);
      const parsedNames = new Set(items.map(it => String(it.name || '').toLowerCase().trim()));
      // Build the top-level item entry from the shipment row
      const topItems = itemTokens
        .filter(t => !parsedNames.has(t))
        .map(t => ({
          name: t.replace(/\b\w/g, c => c.toUpperCase()),  // re-capitalize first letters
          price: shipment.estimate || '',
          rationale: shipment.ai_rationale || ''
        }));
      if (topItems.length) items = [...topItems, ...items];
    } else if (!shipment.item_manifest && shipment.item && (!items || items.length === 0)) {
      // No appended items at all — just show the single top-level item
      items = [{
        name: shipment.item,
        price: shipment.estimate || '',
        rationale: shipment.ai_rationale || ''
      }];
    }
    // Use legacy aiRationale only if there's a single item (or no items) — otherwise per-item rationales live in the manifest
    const standaloneAiRationale = (!items || items.length <= 1) ? (shipment.ai_rationale || legacy.aiRationale) : '';
    const aiEstimate = shipment.ai_estimate_raw;

    const hasAttribution = !!(shipment.attribution && !shipment.attribution._empty && (
      shipment.attribution.utm_source || shipment.attribution.utm_campaign ||
      shipment.attribution.variant || shipment.attribution.fbclid ||
      shipment.attribution.gclid || shipment.attribution.lead_source));
    const hasAnything = agentNotes || customerMsg || customerEdits || (items && items.length) || standaloneAiRationale || aiEstimate || legacy.photos.length || hasAttribution;
    if(!hasAnything) return null;

    return <div style={{marginTop:4}}>
      <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>Notes & Details</div>

      {/* 0. Attribution — where this lead came from. Essentials visible, full collapsed. */}
      {shipment.attribution && (() => {
        const a = shipment.attribution;
        const hasAny = a.utm_source || a.utm_campaign || a.variant || a.fbclid || a.gclid || a.lead_source;
        if (!hasAny) return null;

        // Channel: synthesize a friendly label
        const channel = a.fbclid ? "Facebook" :
                        a.gclid ? "Google" :
                        a.utm_source ? a.utm_source :
                        "Direct";

        return <NotesBox title="🎯 Attribution" color={G.green} bg="#EFF8F0" collapsible defaultOpen={true}>
          {/* Essentials */}
          <div style={{display:"flex",flexDirection:"column",gap:3,fontSize:12}}>
            <div><span style={{color:G.muted,marginRight:6}}>CHANNEL:</span><b>{channel}</b></div>
            {a.utm_campaign && <div><span style={{color:G.muted,marginRight:6}}>CAMPAIGN:</span><span style={{fontFamily:"monospace"}}>{a.utm_campaign}</span></div>}
            {a.variant && <div><span style={{color:G.muted,marginRight:6}}>VARIANT:</span><b>{a.variant}</b></div>}
          </div>

          {/* Full details — collapsed by default */}
          <details style={{marginTop:8}}>
            <summary style={{fontSize:11,color:G.muted,cursor:"pointer",userSelect:"none"}}>
              Full attribution details
            </summary>
            <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"3px 10px",fontSize:11,marginTop:6,paddingLeft:8,borderLeft:`2px solid ${G.green}33`}}>
              {a.utm_source   && <><span style={{color:G.muted}}>utm_source:</span><span style={{fontFamily:"monospace"}}>{a.utm_source}</span></>}
              {a.utm_medium   && <><span style={{color:G.muted}}>utm_medium:</span><span style={{fontFamily:"monospace"}}>{a.utm_medium}</span></>}
              {a.utm_campaign && <><span style={{color:G.muted}}>utm_campaign:</span><span style={{fontFamily:"monospace"}}>{a.utm_campaign}</span></>}
              {a.utm_content  && <><span style={{color:G.muted}}>utm_content:</span><span style={{fontFamily:"monospace"}}>{a.utm_content}</span></>}
              {a.fbclid       && <><span style={{color:G.muted}}>fbclid:</span><span style={{fontFamily:"monospace",wordBreak:"break-all"}}>{a.fbclid.length>20?a.fbclid.slice(0,20)+"…":a.fbclid}</span></>}
              {a.gclid        && <><span style={{color:G.muted}}>gclid:</span><span style={{fontFamily:"monospace",wordBreak:"break-all"}}>{a.gclid.length>20?a.gclid.slice(0,20)+"…":a.gclid}</span></>}
              {a.variant      && <><span style={{color:G.muted}}>variant:</span><span style={{fontFamily:"monospace"}}>{a.variant}</span></>}
              {a.lead_source  && <><span style={{color:G.muted}}>lead_source:</span><span style={{fontFamily:"monospace"}}>{a.lead_source}</span></>}
              {a.first_visit  && <><span style={{color:G.muted}}>first_visit:</span><span style={{fontFamily:"monospace"}}>{new Date(a.first_visit).toLocaleString()}</span></>}
              {a.session_id   && <><span style={{color:G.muted}}>session_id:</span><span style={{fontFamily:"monospace",wordBreak:"break-all"}}>{a.session_id.length>20?a.session_id.slice(0,20)+"…":a.session_id}</span></>}
            </div>
          </details>
        </NotesBox>;
      })()}

      {/* 1. Agent Notes — most important, human-written */}
      {agentNotes && <NotesBox title="👤 Agent Notes" color={G.purple} bg="#F8F5FF">
        <div style={{whiteSpace:"pre-wrap"}}>{agentNotes}</div>
      </NotesBox>}

      {/* 2. Customer Message — what they said */}
      {customerMsg && <NotesBox title="💬 Customer Message" color="#A07020" bg="#FFF8EC">
        <div style={{whiteSpace:"pre-wrap"}}>{customerMsg}</div>
      </NotesBox>}

      {/* 3. Customer Edits — what they corrected */}
      {customerEdits && <NotesBox title="✏️ Customer Edits" color={G.blue} bg="#EEF4FF">
        {(() => {
          const edits = String(customerEdits).split(/[;|]/).map(s=>s.trim()).filter(Boolean);
          return <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {edits.map((e,i)=>{
              const mm = e.match(/^(.+?):\s*(.+?)\s*->\s*(.+)$/);
              if(mm) return <div key={i} style={{fontSize:12}}>
                <span style={{fontWeight:600,color:G.muted}}>{mm[1]}:</span>
                <span style={{textDecoration:"line-through",color:G.muted,marginLeft:6}}>{mm[2]}</span>
                <span style={{color:G.blue,fontWeight:600,marginLeft:6}}>→ {mm[3]}</span>
              </div>;
              if(/^free-text:/i.test(e)) return <div key={i} style={{fontSize:12,fontStyle:"italic"}}>"{e.replace(/^free-text:\s*/i,'')}"</div>;
              return <div key={i} style={{fontSize:12}}>{e}</div>;
            })}
          </div>;
        })()}
      </NotesBox>}

      {/* 4. Item Manifest with per-item rationales (numbered) */}
      {items && items.length > 0 && <NotesBox title={`📦 Item Manifest (${items.length})`} color={G.teal} bg="#EDF7F6">
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* JUN 3: mismatch flag. Customers often send more items than were
              captured at intake; extras exist only as photos with no manifest
              line — and the un-manifested item is frequently the valuable one
              (e.g. a gold chain alongside a worthless lab diamond). Since all
              customer comms read from the manifest, an unlisted item is never
              referenced. Flag when non-ID photo count exceeds manifest count so
              you inspect before fulfilling. Over-prompting (multiple angles of
              one item) is harmless; missing an item is not. */}
          {(() => {
            const itemPhotoCount = (photos || []).filter(p => {
              const src = String(p.source || "").toLowerCase();
              return src !== "id" && src !== "customerid" && src !== "id_photo";
            }).length;
            if (itemPhotoCount > items.length) {
              return (
                <div style={{
                  background:"#FFF8EC", border:`1px solid ${G.orange}55`, borderRadius:6,
                  padding:"8px 10px", fontSize:11.5, color:G.text, lineHeight:1.45
                }}>
                  <strong style={{color:G.orange}}>⚠ {itemPhotoCount} photos · {items.length} manifest item{items.length===1?"":"s"}.</strong>{" "}
                  Customer may have sent items not on the manifest. Check the photos — any unlisted item won't be referenced in their offer/payment messages.
                </div>
              );
            }
            return null;
          })()}
          {items.map((it,i)=>(
            <div key={i} style={{paddingBottom:i<items.length-1?10:0,borderBottom:i<items.length-1?`1px solid ${G.teal}22`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{display:"inline-block",background:G.teal,color:"#fff",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,marginRight:6,verticalAlign:"middle"}}>#{i+1}</span>
                  <span style={{fontSize:13,color:G.text,fontWeight:600}}>{it.name}</span>
                </div>
                {it.price && <span style={{fontSize:13,fontWeight:700,color:G.gold,whiteSpace:"nowrap"}}>{it.price}</span>}
              </div>
              {it.rationale && <div style={{fontSize:11,color:G.muted,marginTop:4,marginLeft:24,fontStyle:"italic",lineHeight:1.5}}>{it.rationale}</div>}
            </div>
          ))}
        </div>
      </NotesBox>}

      {/* 5. Standalone AI Rationale (only if single-item shipment) — collapsed by default */}
      {standaloneAiRationale && <NotesBox title="🤖 AI Rationale" color={G.muted} bg={G.bg} collapsible defaultOpen={false}>
        <div style={{fontStyle:"italic",fontSize:12}}>{standaloneAiRationale}</div>
      </NotesBox>}

      {/* 6. AI Original Estimate — collapsed by default */}
      {aiEstimate && aiEstimate !== shipment.estimate && <NotesBox title="🤖 AI Original Estimate" color={G.muted} bg={G.bg} collapsible defaultOpen={false}>
        <div style={{fontSize:12,fontFamily:"monospace",whiteSpace:"pre-wrap"}}>{aiEstimate}</div>
      </NotesBox>}

      {/* 7. Legacy Photo URLs — collapsed since main Photos panel below already shows them */}
      {legacy.photos.length > 0 && <NotesBox title={`📷 Legacy Photo Link${legacy.photos.length>1?'s':''}`} color={G.muted} bg={G.bg} collapsible defaultOpen={false}>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {legacy.photos.map((url,i)=>(
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:G.blue,wordBreak:"break-all",textDecoration:"none"}}>{url}</a>
          ))}
        </div>
      </NotesBox>}
    </div>;
  }

  const actions=getActions();

  return <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {/* MAY 27: post-stage-transition workflow nudges */}
    {showReceivedPhotoPrompt && (
      <ReceivedPhotoPromptModal
        shipment={shipment}
        onPhotoAdded={()=>{ setShowReceivedPhotoPrompt(false); refetchPhotos(); setShowBinNumberPrompt(true); }}
        onSkip={()=>{ setShowReceivedPhotoPrompt(false); setShowBinNumberPrompt(true); }}
      />
    )}
    {showBinNumberPrompt && (
      <BinNumberPromptModal
        shipment={shipment}
        onSaved={(binNumber)=>{
          setShowBinNumberPrompt(false);
          onUpdate({...shipment, bin_number: binNumber});
        }}
        onSkip={()=>setShowBinNumberPrompt(false)}
      />
    )}
    {showInspectedNotesPrompt && (
      <InspectedNotesPromptModal
        shipment={shipment}
        onSaved={(newLog)=>{
          setShowInspectedNotesPrompt(false);
          if (newLog) setLocalLogs(prev=>[newLog,...prev]);
        }}
        onSkip={()=>setShowInspectedNotesPrompt(false)}
      />
    )}
    {showOfferPrompt && (
      <OfferPromptModal
        shipment={shipment}
        customer={customer}
        onSaved={async (offerPrice, offerDesc)=>{
          setShowOfferPrompt(false);
          try {
            // 1) Persist the offer on the shipment + advance the stage.
            const updates={ stage:"pending_response", offer_price: offerPrice, offer_description: offerDesc };
            await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates});
            // 2) ACTUALLY SEND THE OFFER: create a self-serve token + email the
            //    customer the acceptance link. Without this, the stage moves to
            //    "pending response" but the customer never hears about the offer.
            const res=await apiPost({
              action:"generateSelfServeToken",
              shipment_id:shipment.shipment_id,
              customer_id:shipment.customer_id,
              offer_amount:offerPrice,
              offer_description:offerDesc
            });
            onUpdate({...shipment, ...updates});
            if (res && res.success) {
              alert(res.email_sent
                ? "✅ Offer sent — acceptance email delivered to "+(customer?.email||"customer")+"."
                : "⚠ Offer saved, but no email was sent (customer has no email on file). Acceptance link: "+(res.url||"(none)"));
            } else {
              alert("⚠ Offer saved + stage advanced, but sending the acceptance email FAILED: "+((res&&res.error)||"unknown")+"\n\nThe customer was NOT notified.");
            }
          } catch(e) {
            alert("Failed to send offer: "+e.message+"\n\nThe customer may not have been notified — check the shipment.");
          }
        }}
        onCancel={()=>setShowOfferPrompt(false)}
      />
    )}
    {/* MAY 31: Self-serve form submission banner. Visible after customer
        completes the verification form, until shipment is marked purchased. */}
    {shipment?.self_serve_submitted_at && !["pending_payment","pending_leadsonline","complete","returned","purchased"].includes(shipment?.stage) && (
      <div style={{padding:"12px 20px",background:"#E8F5E9",borderBottom:`2px solid #2E7D32`,display:"flex",alignItems:"center",gap:10,fontSize:13}}>
        <span style={{fontSize:18}}>✅</span>
        <span style={{color:G.text,flex:1}}>
          <strong>Self-serve form submitted</strong>
          {shipment.self_serve_submitted_at ? ` · ${new Date(shipment.self_serve_submitted_at).toLocaleString()}` : ""}
          {" · "}Payment + ID + statement on file. Ready to push to LeadsOnline and send payment.
        </span>
      </div>
    )}
    {/* MAY 27: Push-to-LeadsOnline nudge banner. Visible only when shipment is
        purchased and not yet submitted. Quick path to the existing button below. */}
    {shipment?.stage === "pending_leadsonline" && !shipment?.leadsonline_submitted_at && (
      <div style={{padding:"10px 20px",background:"#FFF4E0",borderBottom:`1px solid ${G.gold}33`,display:"flex",alignItems:"center",gap:10,fontSize:13}}>
        <span style={{fontSize:18}}>📤</span>
        <span style={{color:G.text,flex:1}}><strong>Reminder:</strong> push this transaction to LeadsOnline for FL 538 compliance.</span>
        <span style={{color:G.muted,fontSize:11}}>(button in right panel)</span>
      </div>
    )}
    {/* Header */}
    <div style={{padding:"16px 20px",borderBottom:`1px solid ${G.border}`,background:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <Avatar name={customer?.name} size={44}/>
          <div>
            <div style={{fontWeight:700,fontSize:17,color:G.text}}>{customer?.name||"(no name)"}</div>
            <div style={{fontSize:12,color:G.muted,marginTop:1}}>{customer?.email}</div>
            {customer?.customer_id&&<span
              onClick={()=>{navigator.clipboard&&navigator.clipboard.writeText(customer.customer_id);}}
              title="Click to copy customer ID"
              style={{display:"inline-block",marginTop:5,fontFamily:"monospace",fontSize:11,fontWeight:700,color:G.gold,background:"#FFF8EE",border:`1px solid ${G.gold}55`,borderRadius:5,padding:"2px 8px",cursor:"pointer",letterSpacing:"0.02em"}}
            >{customer.customer_id} ⧉</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
          {customer?.phone&&<><a href={`tel:${customer.phone}`} style={{textDecoration:"none"}}><Btn v="green" small>📞 Call</Btn></a><a href={smsHref(customer.phone)} style={{textDecoration:"none"}}><Btn v="blue" small>💬 Text</Btn></a></>}
          {customer?.email&&<a href={emailHref(customer.email)} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><Btn v="ghost" small>✉ Email</Btn></a>}
          <Btn v={shipment?.is_urgent==="true"||shipment?.is_urgent===true?"red":"outline"} small onClick={async()=>{const nv=shipment?.is_urgent==="true"||shipment?.is_urgent===true?"false":"true";await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{is_urgent:nv}});onUpdate({...shipment,is_urgent:nv});}}>{shipment?.is_urgent==="true"||shipment?.is_urgent===true?"🚨 Urgent":"⚐ Mark Urgent"}</Btn>
          {shipment?.stage==="ready_to_fulfill"&&(()=>{const deferred=!!String(shipment?.deferred_at||"").trim();return <Btn v={deferred?"gold":"ghost"} small onClick={async()=>{const nv=deferred?"":new Date().toISOString();await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{deferred_at:nv}});onUpdate({...shipment,deferred_at:nv});}}>{deferred?"↩ Un-defer":"💤 Defer"}</Btn>;})()}
          <Btn v="ghost" small onClick={onClose}>✕</Btn>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
        <Badge stage={shipment.stage}/>
        <Btn v="ghost" small onClick={()=>setModal("stage")}>Change Stage ↓</Btn>
        {actions.map((a,i)=><Btn key={i} v={a.v} small onClick={()=>a.stage?quickStage(a.stage):setModal(a.action)}>{a.label}</Btn>)}
        {shipment.stage==="pending_response"&&<Btn v="orange" small onClick={resendOfferEmail}>📧 Resend offer email</Btn>}
        <Btn v="ghost" small onClick={generateReturnLabel}>📦 Return label</Btn>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <Btn v="ghost" small onClick={()=>setModal("log")}>+ Log</Btn>
          <Btn v="purple" small onClick={()=>setModal("addShipment")}>+ Shipment</Btn>
          <Btn v="gold" small onClick={()=>setModal("edit")}>Edit</Btn>
        </div>
      </div>
    </div>

    {/* Body */}
    <div style={{flex:1,overflow:"auto",padding:20}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Shipment · <span style={{cursor:"pointer",userSelect:"all"}} title="Click to copy" onClick={()=>{navigator.clipboard?.writeText(shipment.shipment_id);}}>{shipment.shipment_id}</span></div>
          <Field label="Item" value={shipment.item}/>
          <Field label="Estimate" value={shipment.estimate}/>
          {shipment.purchase_price&&<div style={{background:"#F0FFF4",borderRadius:6,padding:"8px 12px",border:`1px solid ${G.green}30`}}>
            <div style={{fontSize:10,fontWeight:700,color:G.green,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Purchase</div>
            <div style={{fontSize:18,fontWeight:700,color:G.green}}>{fmt$(shipment.purchase_price)}</div>
            {shipment.appraised_value&&<div style={{fontSize:11,color:G.muted}}>Appraised: {fmt$(shipment.appraised_value)}</div>}
            {shipment.payment_method&&<div style={{fontSize:11,color:G.muted}}>via {shipment.payment_method} {shipment.payment_info}</div>}
          </div>}
          <Field label="Shipping Type" value={shipment.shipping_type}/>
          {shipment.bin_number&&<div style={{background:"#FFF8EE",borderRadius:6,padding:"8px 12px",border:`1px solid ${G.gold}44`}}><div style={{fontSize:10,fontWeight:700,color:G.gold,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Bin Number</div><div style={{fontSize:22,fontWeight:700,color:G.gold}}>{shipment.bin_number}</div></div>}
          <NotesPanel shipment={shipment}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Tracking</div>
            {shipment.outbound_tracking?<Field label="Outbound" value={shipment.outbound_tracking} mono/>:<div style={{fontSize:12,color:G.muted}}>No outbound tracking</div>}
            {shipment.return_tracking?<Field label="Return" value={shipment.return_tracking} mono/>:<div style={{fontSize:12,color:G.muted}}>No return tracking</div>}
            {shipment.outbound_tracking && (shipment.easypost_shipment_id || shipment.shippo_transaction_id) && (
              <Btn v="ghost" small onClick={async()=>{
                if(!confirm("Resend the label email to " + (customer?.name||"customer") + " at " + customer?.email + ", plus a text letting them know to check their inbox?\n\nThis fetches the existing label — no new postage charge.")) return;
                try {
                  const res = await apiPost({action:"resendLabelEmail",shipment_id:shipment.shipment_id});
                  alert(res.success ? "✅ Resent: " + res.message : "❌ Failed: " + (res.error||"unknown error"));
                } catch(e) {
                  alert("❌ Error: " + e.message);
                }
              }}>📧 Resend label email + text</Btn>
            )}
          </div>
          {/* Inventory Photos — shown for received and later stages */}
          {["received","inspected","pending_response","pending_payment","pending_leadsonline","complete","returned"].includes(shipment.stage) && (
            <InventoryPhotosPanel
              shipment={shipment}
              photos={photos}
              onPhotoAdded={refetchPhotos}
            />
          )}
          {/* Payment & ID — only shown for offer_made and later stages */}
          {["pending_response","pending_payment","pending_leadsonline","complete","returned"].includes(shipment.stage) && (()=>{
            const hasAnyId = shipment.id_type || shipment.id_number || shipment.date_birth || shipment.id_photo_url;
            const hasAnyPay = shipment.payment_method || shipment.payment_info;
            const mask = v => v ? "****" + String(v).slice(-4) : "";
            const idTypeLabel = {
              driver_license:"Driver's License", state_id:"State ID", passport:"Passport",
              military_id:"Military ID", other:"Other"
            }[shipment.id_type] || shipment.id_type || "";
            const payLabel = {
              ach:"ACH", paypal:"PayPal", venmo:"Venmo", zelle:"Zelle",
              check:"Check", cashapp:"CashApp", other:"Other"
            }[shipment.payment_method] || shipment.payment_method || "";

            // ── LeadsOnline submit readiness check ──
            // After the Jun 3 redesign, the LO-report step is the pending_leadsonline
            // stage (paid, awaiting report) — and complete (already reported).
            const loSubmitted = !!shipment.leadsonline_submitted_at;
            const loMissing = [];
            if (shipment.stage !== "pending_leadsonline" && shipment.stage !== "complete") loMissing.push("stage must be Pending LeadsOnline");
            if (!shipment.purchase_price) loMissing.push("purchase price");
            if (!shipment.id_type)        loMissing.push("ID type");
            if (!shipment.id_number)      loMissing.push("ID number");
            if (!shipment.date_birth)     loMissing.push("DOB");
            if (!shipment.sworn_statement_at) loMissing.push("sworn statement");
            const loReady = loMissing.length === 0;

            return <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>💳 Payment & ID</div>
                <Btn v="gold" small onClick={()=>setModal("paymentId")}>{hasAnyId||hasAnyPay?"Edit":"+ Capture"}</Btn>
              </div>
              {!hasAnyId && !hasAnyPay && <div style={{fontSize:12,color:G.muted,fontStyle:"italic"}}>Not yet captured. Click "+ Capture" after offer accepted.</div>}
              {!hasAnyId && !hasAnyPay && (allShipments||[]).some(s=>s.customer_id===shipment.customer_id&&s.shipment_id!==shipment.shipment_id&&(String(s.id_number||"").trim()||String(s.date_birth||"").trim())) && (
                <div style={{marginTop:8}}>
                  <Btn v="ghost" small onClick={copyInfoFromPreviousShipment}>♻️ Copy ID + payment from previous shipment</Btn>
                  <div style={{fontSize:11,color:G.muted,marginTop:4}}>Repeat customer — pull their known ID & payment info, stamp a fresh sworn statement.</div>
                </div>
              )}
              {hasAnyId && <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {idTypeLabel && <Field label="ID Type" value={idTypeLabel + (shipment.id_state?` (${shipment.id_state})`:"")}/>}
                {shipment.id_number && <Field label="ID Number" value={mask(shipment.id_number)} mono/>}
                {shipment.date_birth && <Field label="DOB" value={fmtDob(shipment.date_birth)}/>}
                {shipment.id_photo_url && <a href={shipment.id_photo_url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:G.blue,textDecoration:"none"}}>📷 ID photo on file</a>}
              </div>}
              {hasAnyPay && <div style={{borderTop:hasAnyId?`1px solid ${G.border}`:"none",paddingTop:hasAnyId?10:0,marginTop:hasAnyId?4:0,display:"flex",flexDirection:"column",gap:4}}>
                {payLabel && <Field label="Payment Method" value={payLabel}/>}
                {shipment.payment_info && <Field label="Payment Info" value={shipment.payment_info}/>}
              </div>}

              {/* ── LeadsOnline submission block ── */}
              <div style={{borderTop:`1px solid ${G.border}`,paddingTop:10,marginTop:4,display:"flex",flexDirection:"column",gap:8}}>
                {loSubmitted ? (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                    <div style={{fontSize:12,color:G.green,fontWeight:600}}>
                      ✓ Submitted to LeadsOnline · {fmtDateTime(shipment.leadsonline_submitted_at) || shipment.leadsonline_submitted_at}
                    </div>
                  </div>
                ) : (
                  <LeadsOnlineSubmitBtn
                    shipment={shipment}
                    ready={loReady}
                    missing={loMissing}
                    onSuccess={(result)=>{
                      onSave && onSave({leadsonline_submitted_at:result.submitted_at});
                    }}
                  />
                )}
              </div>
            </div>;
          })()}
          {/* Timeline — shipment + contact history */}
          {(()=>{
            const events = [];
            if (shipment.created_at) events.push({label:"Lead intake", ts:shipment.created_at, icon:"📥"});
            if (shipment.sent_at)    events.push({label:"Outbound fulfilled", ts:shipment.sent_at, icon:"📤"});
            if (shipment.received_at)events.push({label:"Received", ts:shipment.received_at, icon:"📦"});
            if (shipment.id_captured_at) events.push({label:"ID captured", ts:shipment.id_captured_at, icon:"🪪"});
            // Find most recent contact log
            const lastLog = (localLogs||[]).length > 0
              ? [...(localLogs||[])].sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0))[0]
              : null;
            if (lastLog && lastLog.timestamp) {
              events.push({label:"Last contact" + (lastLog.type?` · ${lastLog.type}`:""), ts:lastLog.timestamp, icon:"💬"});
            }
            if (customer?.created_at) events.push({label:"Customer since", ts:customer.created_at, icon:"👤", muted:true});
            // Sort chronologically (oldest first) for a natural timeline read
            events.sort((a,b)=>new Date(a.ts)-new Date(b.ts));
            if (!events.length) return null;
            return <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:6}}>
              <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Timeline</div>
              {events.map((e,i)=>{
                const age = timeAgo(e.ts);
                const abs = fmtDateTime(e.ts);
                return <div key={i} style={{display:"flex",alignItems:"baseline",gap:8,fontSize:12,color:e.muted?G.muted:G.text}}>
                  <span style={{fontSize:11,opacity:0.8}}>{e.icon}</span>
                  <span style={{fontWeight:500,flexShrink:0}}>{e.label}</span>
                  <span style={{color:G.muted,fontSize:11,marginLeft:"auto",textAlign:"right",whiteSpace:"nowrap"}} title={abs}>{abs} · {age} ago</span>
                </div>;
              })}
            </div>;
          })()}
          <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Customer</div>
            <Field label="ID" value={customer?.customer_id} mono copy/>
            <Field label="Email" value={customer?.email||<span style={{color:G.muted,fontStyle:"italic"}}>Not available</span>}/>
            <Field label="Phone" value={customer?.phone?fmtPhone(customer.phone):<span style={{color:G.muted,fontStyle:"italic"}}>Not available</span>}/>
            <Field label="Address" value={customer?.address}/>
            <Field label="Source" value={customer?.source}/>
            {customer?.notes&&<Field label="Notes" value={customer.notes}/>}
          </div>
        </div>
      </div>
      {localLogs.length>0&&<ContactLogList logs={localLogs} currentShipmentId={shipment?.shipment_id} allShipments={allShipments} onUpdate={(updatedLog,idx)=>{
        const updated=[...localLogs];
        updated[updated.length-1-idx]=updatedLog;
        setLocalLogs(updated);
      }} onDelete={(idx)=>{
        const updated=[...localLogs];
        updated.splice(updated.length-1-idx,1);
        setLocalLogs(updated);
      }}/>}
    <CustomerHistory shipment={shipment} allShipments={allShipments} customers={allCustomers}/>
    {/* Photos */}
    <div style={{marginTop:16,background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`}}>
      <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>
        Photos {photos.length>0&&`(${photos.length})`}
      </div>
      {photosLoading&&<div style={{fontSize:12,color:G.muted}}>Loading...</div>}
      {!photosLoading&&photos.length===0&&<div style={{fontSize:12,color:G.muted}}>No photos on file</div>}
      {photos.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:10}}>
        {photos.map((p,i)=>{
          const url = String(p.drive_url||"");
          // Convert Drive view URL to thumbnail URL
          const fileIdMatch = url.match(/\/d\/([^\/]+)\//);
          const fileId = fileIdMatch ? fileIdMatch[1] : null;
          const thumbUrl = fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w200` : null;
          return <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{display:"block",border:`1px solid ${G.border}`,borderRadius:8,overflow:"hidden",width:100,height:100,flexShrink:0,background:G.bg}}>
            {thumbUrl
              ? <img src={thumbUrl} alt={`Photo ${i+1}`} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:G.muted}}>View</div>
            }
          </a>;
        })}
      </div>}
    </div>
    </div>

    {/* Modals */}
    {modal==="edit"&&<EditModal shipment={shipment} customer={customer} onSave={({shipment:s,customer:c})=>{onUpdate(s,c);setModal(null);}} onClose={()=>setModal(null)}/>}
    {modal==="log"&&<LogModal shipment={shipment} customer={customer} onSave={log=>{setLocalLogs(p=>[...p,log]);setModal(null);}} onClose={()=>setModal(null)}/>}
    {modal==="stage"&&<StageModal shipment={shipment} onSave={stage=>{onUpdate({...shipment,stage});setModal(null);}} onClose={()=>setModal(null)}/>}
    {modal==="addShipment"&&customer&&<AddShipmentModal customer={customer} onSave={s=>{onNewShipment(s);setModal(null);}} onClose={()=>setModal(null)}/>}
    {modal==="paymentId"&&<PaymentIdModal shipment={shipment} customer={customer} onSave={updates=>{onUpdate({...shipment,...updates}, {...customer, id_type:updates.id_type, id_number:updates.id_number, id_state:updates.id_state, date_birth:updates.date_birth, id_photo_url:updates.id_photo_url, sworn_statement_at:updates.sworn_statement_at||customer?.sworn_statement_at});setModal(null);}} onClose={()=>setModal(null)}/>}
  </div>;
}


// ══════════════════════════════════════════════════════════
// RECEIVED TAB
// ══════════════════════════════════════════════════════════

function ReceivedTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [binInput,setBinInput]=useState("");
  const [savingBin,setSavingBin]=useState(false);
  const [binLookup,setBinLookup]=useState("");

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);

  // Reverse bin lookup: which shipment is physically in a given bin?
  // (One shipment per bin.) Searches ALL shipments, not just received,
  // so you can locate whatever is occupying a bin during intake.
  const binMatch=useMemo(()=>{
    const q=String(binLookup).trim();
    if(!q) return null;
    const hits=shipments.filter(s=>String(s.bin_number||"").trim()===q);
    return {q,hits};
  },[binLookup,shipments]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>RECEIVED_STAGES.includes(s.stage));
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(c.phone||"").replace(/\D/g,"").includes(q)||String(c.address||"").toLowerCase().includes(q)||String(s.shipment_id||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q)||String(s.outbound_tracking||"").toLowerCase().includes(q);});}
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  },[shipments,search,custById]);

  const selectedShipment=useMemo(()=>shipments.find(s=>s.shipment_id===selected),[shipments,selected]);
  const selectedCustomer=useMemo(()=>selectedShipment?custById[selectedShipment.customer_id]:null,[selectedShipment,custById]);
  const selectedLogs=useMemo(()=>selectedShipment?(logsByCustomer[selectedShipment.customer_id]||[]):[],[selectedShipment,logsByCustomer]);

  useEffect(()=>{
    if(selectedShipment) setBinInput(String(selectedShipment.bin_number||""));
  },[selected]);

  async function saveBin(){
    if(!selectedShipment) return;
    setSavingBin(true);
    try {
      await apiPost({action:"updateShipment",shipment_id:selectedShipment.shipment_id,updates:{bin_number:binInput}});
      onUpdate({...selectedShipment,bin_number:binInput});
    } catch(e){alert("Failed: "+e.message);}
    setSavingBin(false);
  }

  return <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
    <div style={{width:isMobile?"100%":340,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selected?"none":"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search received..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
        <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,fontWeight:700,color:G.gold,whiteSpace:"nowrap"}}>Bin lookup</span>
          <input value={binLookup} onChange={e=>setBinLookup(e.target.value)} placeholder="What's in bin #?" style={{width:120,boxSizing:"border-box",background:"#FFF8EE",border:`1px solid ${G.gold}66`,borderRadius:7,padding:"5px 10px",fontSize:12,fontWeight:700,color:G.gold,outline:"none"}}/>
          {binLookup&&<button onClick={()=>setBinLookup("")} style={{background:"none",border:"none",color:G.muted,fontSize:12,cursor:"pointer",padding:0}}>clear</button>}
        </div>
        {binMatch&&(binMatch.hits.length===0
          ? <div style={{marginTop:6,fontSize:12,color:G.muted}}>Bin {binMatch.q} is <strong>empty</strong> — nothing assigned to it.</div>
          : binMatch.hits.map(s=>{
              const c=custById[s.customer_id]||{};
              return <div key={s.shipment_id} onClick={()=>setSelected(s.shipment_id)} style={{marginTop:6,padding:"7px 10px",background:"#FFF8EE",border:`1px solid ${G.gold}66`,borderRadius:7,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Bin {binMatch.q}: {c.name||s.customer_id}</div>
                  <div style={{fontSize:11,color:G.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.shipment_id} · {displayItem(s)}</div>
                </div>
                <span style={{fontSize:11,fontWeight:700,color:G.gold,whiteSpace:"nowrap"}}>Open →</span>
              </div>;
            })
        )}
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.length===0?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No received shipments</div>:
          filtered.map(s=>{
            const c=custById[s.customer_id]||{};
            const high=parseEstHigh(s.estimate);
            return <div key={s.shipment_id} onClick={()=>setSelected(s.shipment_id)} style={{paddingLeft:16,paddingRight:16,paddingTop:12,paddingBottom:12,cursor:"pointer",borderBottom:`1px solid ${G.border}`,background:selected===s.shipment_id?"#FFF8EE":"#fff",borderLeft:selected===s.shipment_id?`3px solid ${G.gold}`:"3px solid transparent"}} onMouseEnter={e=>{if(selected!==s.shipment_id)e.currentTarget.style.background="#FDFAF6";}} onMouseLeave={e=>{if(selected!==s.shipment_id)e.currentTarget.style.background="#fff";}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <Avatar name={c.name||s.customer_id} size={32}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                    <div style={{fontWeight:600,fontSize:13,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name||c.email||s.customer_id}</div>
                    {high>0&&<div style={{color:G.gold,fontWeight:700,fontSize:12,flexShrink:0}}>{fmt$(high)}</div>}
                  </div>
                  <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayItem(s)}</div>
                  <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center"}}>
                    <Badge stage={s.stage} sm/>
                    {s.bin_number&&<span style={{background:"#FFF8EE",color:G.gold,border:`1px solid ${G.gold}44`,borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:700}}>Bin {s.bin_number}</span>}
                  </div>
                </div>
              </div>
            </div>;
          })
        }
      </div>
      <div style={{padding:"6px 12px",borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted}}>{filtered.length} received</div>
    </div>

    {/* Right pane */}
    {selectedShipment?<div style={{flex:1,display:isMobile&&!selected?"none":"flex",flexDirection:"column",overflow:"hidden",position:isMobile?"fixed":"relative",inset:isMobile?"0":undefined,zIndex:isMobile?100:undefined,background:isMobile?"#fff":undefined}}>
      {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← Back</button>
      </div>}
      {/* Bin number bar */}
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${G.border}`,background:"#FFF8EE",display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:13,fontWeight:700,color:G.gold}}>Bin Number</div>
        <input value={binInput} onChange={e=>setBinInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveBin()} placeholder="Enter bin #" style={{width:100,background:"#fff",border:`2px solid ${G.gold}`,borderRadius:7,padding:"6px 12px",fontSize:18,fontWeight:700,color:G.gold,outline:"none",textAlign:"center"}}/>
        <Btn v="gold" small onClick={saveBin} disabled={savingBin||binInput===String(selectedShipment.bin_number||"")}>{savingBin?"Saving...":"Save Bin"}</Btn>
        {selectedShipment.bin_number&&<div style={{fontSize:12,color:G.muted}}>Currently: Bin {selectedShipment.bin_number}</div>}
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);if(s.shipment_id===selected)setBinInput(String(s.bin_number||""));}} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>
      </div>
    </div>:<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a received shipment</div>
    </div>}
  </div>;
}


// ══════════════════════════════════════════════════════════
// PURCHASED TAB
// ══════════════════════════════════════════════════════════

function CompleteTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [binInput,setBinInput]=useState("");
  const [savingBin,setSavingBin]=useState(false);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>COMPLETE_STAGES.includes(s.stage));
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(c.phone||"").replace(/\D/g,"").includes(q)||String(c.address||"").toLowerCase().includes(q)||String(s.shipment_id||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q)||String(s.outbound_tracking||"").toLowerCase().includes(q);});}
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  },[shipments,search,custById]);

  const selectedShipment=useMemo(()=>shipments.find(s=>s.shipment_id===selected),[shipments,selected]);
  const selectedCustomer=useMemo(()=>selectedShipment?custById[selectedShipment.customer_id]:null,[selectedShipment,custById]);
  const selectedLogs=useMemo(()=>selectedShipment?(logsByCustomer[selectedShipment.customer_id]||[]):[],[selectedShipment,logsByCustomer]);

  useEffect(()=>{
    if(selectedShipment) setBinInput(String(selectedShipment.bin_number||""));
  },[selected]);

  async function saveBin(){
    if(!selectedShipment) return;
    setSavingBin(true);
    try {
      await apiPost({action:"updateShipment",shipment_id:selectedShipment.shipment_id,updates:{bin_number:binInput}});
      onUpdate({...selectedShipment,bin_number:binInput});
    } catch(e){alert("Failed: "+e.message);}
    setSavingBin(false);
  }

  const totalPurchased=filtered.reduce((sum,s)=>sum+(parseFloat(s.purchase_price)||0),0);

  return <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
    <div style={{width:isMobile?"100%":340,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selected?"none":"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search purchased..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
      </div>
      {totalPurchased>0&&<div style={{padding:"8px 14px",borderBottom:`1px solid ${G.border}`,background:"#F0FFF4",fontSize:12,color:G.green,fontWeight:700}}>Total purchased: {fmt$(totalPurchased)}</div>}
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.length===0?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No completed shipments</div>:
          filtered.map(s=>{
            const c=custById[s.customer_id]||{};
            return <div key={s.shipment_id} onClick={()=>setSelected(s.shipment_id)} style={{paddingLeft:16,paddingRight:16,paddingTop:12,paddingBottom:12,cursor:"pointer",borderBottom:`1px solid ${G.border}`,background:selected===s.shipment_id?"#FFF8EE":"#fff",borderLeft:selected===s.shipment_id?`3px solid ${G.gold}`:"3px solid transparent"}} onMouseEnter={e=>{if(selected!==s.shipment_id)e.currentTarget.style.background="#FDFAF6";}} onMouseLeave={e=>{if(selected!==s.shipment_id)e.currentTarget.style.background="#fff";}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <Avatar name={c.name||s.customer_id} size={32}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                    <div style={{fontWeight:600,fontSize:13,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name||c.email||s.customer_id}</div>
                    {s.purchase_price&&<div style={{color:G.green,fontWeight:700,fontSize:12,flexShrink:0}}>{fmt$(s.purchase_price)}</div>}
                  </div>
                  <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayItem(s)}</div>
                  <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center"}}>
                    <span style={{background:s.stage==="returned"?"#F5F5F5":"#F0FFF4",color:s.stage==="returned"?G.muted:G.green,border:`1px solid ${s.stage==="returned"?G.muted:G.green}30`,borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>{s.stage==="returned"?"Returned":"Purchased ✓"}</span>
                    {s.bin_number&&<span style={{background:"#FFF8EE",color:G.gold,border:`1px solid ${G.gold}44`,borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:700}}>Bin {s.bin_number}</span>}
                    {s.payment_method&&<span style={{fontSize:10,color:G.muted}}>{s.payment_method}</span>}
                  </div>
                </div>
              </div>
            </div>;
          })
        }
      </div>
      <div style={{padding:"6px 12px",borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted}}>{filtered.length} purchased</div>
    </div>

    {selectedShipment?<div style={{flex:1,display:isMobile&&!selected?"none":"flex",flexDirection:"column",overflow:"hidden",position:isMobile?"fixed":"relative",inset:isMobile?"0":undefined,zIndex:isMobile?100:undefined,background:isMobile?"#fff":undefined}}>
      {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← Back</button>
      </div>}
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${G.border}`,background:"#FFF8EE",display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:13,fontWeight:700,color:G.gold}}>Bin Number</div>
        <input value={binInput} onChange={e=>setBinInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveBin()} placeholder="Enter bin #" style={{width:100,background:"#fff",border:`2px solid ${G.gold}`,borderRadius:7,padding:"6px 12px",fontSize:18,fontWeight:700,color:G.gold,outline:"none",textAlign:"center"}}/>
        <Btn v="gold" small onClick={saveBin} disabled={savingBin||binInput===String(selectedShipment.bin_number||"")}>{savingBin?"Saving...":"Save Bin"}</Btn>
        {selectedShipment.bin_number&&<div style={{fontSize:12,color:G.muted}}>Currently: Bin {selectedShipment.bin_number}</div>}
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);if(s.shipment_id===selected)setBinInput(String(s.bin_number||""));}} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>
      </div>
    </div>:<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a shipment</div>
    </div>}
  </div>;
}


// ══════════════════════════════════════════════════════════
// UPLOAD SHIP REPORTS MODAL
// ══════════════════════════════════════════════════════════

function UploadModal({onProcess, onClose, results, uploading}) {
  const [pirateshipFile, setPirateshipFile] = useState(null);
  const [fedexFile, setFedexFile] = useState(null);
  const psRef = useRef();
  const fxRef = useRef();

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#fff",borderRadius:12,width:"min(560px,95vw)",maxHeight:"85vh",overflow:"auto",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{fontWeight:700,fontSize:16,marginBottom:4,color:G.text}}>Upload Ship Reports</div>
        <div style={{fontSize:12,color:G.muted,marginBottom:20}}>Upload Pirateship and/or FedEx exports to reconcile tracking numbers</div>

        {!results ? <>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {/* Pirateship */}
            <div style={{border:`1px solid ${G.border}`,borderRadius:8,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,color:G.purple,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Pirateship Export (CSV)</div>
              <div style={{fontSize:11,color:G.muted,marginBottom:10}}>Outbound USPS tracking — matches by customer email</div>
              <input ref={psRef} type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={e=>setPirateshipFile(e.target.files[0])}/>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <Btn v="ghost" small onClick={()=>psRef.current.click()}>Choose File</Btn>
                {pirateshipFile
                  ? <span style={{fontSize:12,color:G.green,fontWeight:600}}>✓ {pirateshipFile.name}</span>
                  : <span style={{fontSize:12,color:G.muted}}>No file selected</span>}
              </div>
            </div>

            {/* FedEx */}
            <div style={{border:`1px solid ${G.border}`,borderRadius:8,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,color:G.teal,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>FedEx Ship Report (CSV)</div>
              <div style={{fontSize:11,color:G.muted,marginBottom:10}}>Return tracking — matches by sender name. Moves shipment to Outbound Complete.</div>
              <input ref={fxRef} type="file" accept=".csv,.xlsx" style={{display:"none"}} onChange={e=>setFedexFile(e.target.files[0])}/>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <Btn v="ghost" small onClick={()=>fxRef.current.click()}>Choose File</Btn>
                {fedexFile
                  ? <span style={{fontSize:12,color:G.green,fontWeight:600}}>✓ {fedexFile.name}</span>
                  : <span style={{fontSize:12,color:G.muted}}>No file selected</span>}
              </div>
            </div>
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
            <Btn v="ghost" onClick={onClose}>Cancel</Btn>
            <Btn v="gold" onClick={()=>onProcess(pirateshipFile,fedexFile)}
              disabled={uploading||(!pirateshipFile&&!fedexFile)}>
              {uploading?"Processing...":"Process Reports"}
            </Btn>
          </div>
        </> : <>
          {/* Results */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:"#F0FFF4",borderRadius:8,padding:14,border:`1px solid ${G.green}30`}}>
              <div style={{fontSize:12,fontWeight:700,color:G.green,marginBottom:8}}>✓ Matched & Updated ({results.matched.length})</div>
              {results.matched.map((m,i)=><div key={i} style={{fontSize:11,color:G.text,marginBottom:4}}>
                <span style={{fontWeight:600}}>{m.name}</span> → {m.shipment_id} · {m.tracking}
              </div>)}
            </div>
            {results.unmatched.length>0&&<div style={{background:"#FFF8E1",borderRadius:8,padding:14,border:"1px solid #FFD54F"}}>
              <div style={{fontSize:12,fontWeight:700,color:"#E65100",marginBottom:8}}>⚠ Unmatched ({results.unmatched.length})</div>
              {results.unmatched.map((m,i)=><div key={i} style={{fontSize:11,color:G.text,marginBottom:4}}>
                <span style={{fontWeight:600}}>{m.name}</span> — {m.reason}
              </div>)}
            </div>}
            {results.errors.length>0&&<div style={{background:"#FFF0F0",borderRadius:8,padding:14,border:`1px solid ${G.red}30`}}>
              <div style={{fontSize:12,fontWeight:700,color:G.red,marginBottom:8}}>✗ Errors</div>
              {results.errors.map((e,i)=><div key={i} style={{fontSize:11,color:G.red}}>{e}</div>)}
            </div>}
          {results.debug&&<div style={{background:"#F5F5F5",borderRadius:8,padding:14,border:"1px solid #ddd",marginTop:8}}>
              <div style={{fontSize:11,fontWeight:700,color:"#666",marginBottom:6}}>Debug Info</div>
              <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>
                Customers loaded: {results.debug.customersLoaded}<br/>
                Shipments loaded: {results.debug.shipmentsLoaded}<br/>
                RTF shipments: {results.debug.rtfCount}<br/>
                Name map sample: {results.debug.nameMapSample.join(', ')}
              </div>
            </div>}
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:20}}>
            <Btn v="gold" onClick={onClose}>Done</Btn>
          </div>
        </>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// FULFILL TAB
// ══════════════════════════════════════════════════════════

function FulfillTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [bulkModal,setBulkModal]=useState(false);
  const [bulkStage,setBulkStage]=useState("outbound_complete");
  const [bulkSaving,setBulkSaving]=useState(false);
  const [uploadModal,setUploadModal]=useState(false);
  const [uploadResults,setUploadResults]=useState(null);
  const [uploading,setUploading]=useState(false);
  const [showDeferred,setShowDeferred]=useState(false);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  // A shipment is "deferred" when deferred_at is set. Deferred items are
  // deliberately held — they drop out of the active queue so fresh leads
  // aren't buried under clutter, and live in the Deferred view until un-deferred.
  const isDeferred=(s)=>!!String(s.deferred_at||"").trim();

  const deferredCount=useMemo(()=>shipments.filter(s=>FULFILL_STAGES.includes(s.stage)&&isDeferred(s)).length,[shipments]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>FULFILL_STAGES.includes(s.stage));
    list=list.filter(s=>showDeferred?isDeferred(s):!isDeferred(s)); // active vs deferred view
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(c.phone||"").replace(/\D/g,"").includes(q)||String(c.address||"").toLowerCase().includes(q)||String(s.shipment_id||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q)||String(s.outbound_tracking||"").toLowerCase().includes(q);});}
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  },[shipments,search,custById,showDeferred]);

  const kits=filtered.filter(s=>String(s.shipping_type||"").trim()==="kit");
  const labels=filtered.filter(s=>String(s.shipping_type||"").trim()==="label");
  const uspsLabels=filtered.filter(s=>String(s.shipping_type||"").trim()==="usps");

  const selectedShipment=useMemo(()=>shipments.find(s=>s.shipment_id===selected),[shipments,selected]);
  const selectedCustomer=useMemo(()=>selectedShipment?custById[selectedShipment.customer_id]:null,[selectedShipment,custById]);
  const selectedLogs=useMemo(()=>selectedShipment?(logsByCustomer[selectedShipment.customer_id]||[]):[],[selectedShipment,logsByCustomer]);


  async function processShipReports(pirateshipFile, fedexFile) {
    setUploading(true);
    const results = { matched: [], unmatched: [], errors: [] };

    // Build lookup maps
    const emailToCustId = {};
    const nameToCustId = {};
    customers.forEach(c => {
      if (c.email) emailToCustId[c.email.toLowerCase().trim()] = c.customer_id;
      if (c.name) nameToCustId[c.name.toLowerCase().trim().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'')] = c.customer_id;
    });

    // Get ready_to_fulfill shipments, index by customer_id
    const rtfByCustomer = {};
    const outboundCompleteByCustomer = {};
    shipments.forEach(s => {
      if (s.stage === 'ready_to_fulfill') rtfByCustomer[s.customer_id] = s;
      if (s.stage === 'outbound_complete') outboundCompleteByCustomer[s.customer_id] = s;
    });

    // Parse CSV text
    function parseCSV(text) {
      // Handle XLSX-parsed JSON
      if (text.trim().startsWith('[')) {
        try { return JSON.parse(text); } catch(e) {}
      }
      // Handle CSV text
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
      return lines.slice(1).filter(l=>l.trim()).map(line => {
        const vals = []; let cur = ''; let inQ = false;
        for (let ch of line) {
          if (ch === '"') inQ = !inQ;
          else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
          else cur += ch;
        }
        vals.push(cur.trim());
        const obj = {};
        headers.forEach((h,i) => obj[h] = (vals[i]||'').replace(/^"|"$/g,''));
        return obj;
      });
    }

    // Parse XLSX using SheetJS-style manual read — actually just read as text if CSV
    async function loadXLSX() {
      if (window.XLSX) return window.XLSX;
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = () => res(window.XLSX);
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    async function readFile(file) {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const XLSX = await loadXLSX();
        return new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = e => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = XLSX.read(data, {type:'array'});
              const sheet = workbook.Sheets[workbook.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
              res(JSON.stringify(rows));
            } catch(err) { rej(err); }
          };
          reader.onerror = rej;
          reader.readAsArrayBuffer(file);
        });
      } else {
        return new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = e => res(e.target.result);
          reader.onerror = rej;
          reader.readAsText(file);
        });
      }
    }

    const updates = []; // {shipment_id, outbound_tracking, return_tracking, stage}

    // Process Pirateship (CSV) - match by email -> outbound tracking
    if (pirateshipFile) {
      try {
        const text = await readFile(pirateshipFile);
        const rows = parseCSV(text);
        rows.forEach(r => {
          const email = (r['Email'] || r['email'] || '').toLowerCase().trim();
          const tracking = (r['Tracking Number'] || r['tracking_number'] || r['TrackingNumber'] || '').trim();
          if (!email || !tracking) return;
          const custId = emailToCustId[email];
          if (!custId) { results.unmatched.push({source:'Pirateship', name:email, reason:'No customer found'}); return; }
          const ship = rtfByCustomer[custId];
          if (!ship) { results.unmatched.push({source:'Pirateship', name:email, reason:'No ready_to_fulfill shipment'}); return; }
          updates.push({shipment_id: ship.shipment_id, outbound_tracking: tracking, customer_id: custId, name: email});
          results.matched.push({source:'Pirateship', name:email, shipment_id:ship.shipment_id, tracking});
        });
      } catch(e) { results.errors.push('Pirateship parse error: ' + e.message); }
    }

    // Process FedEx (CSV) - match by senderContactName -> return tracking
    if (fedexFile) {
      try {
        const text = await readFile(fedexFile);
        const rows = parseCSV(text);
        rows.forEach(r => {
          const name = (r['senderContactName'] || '').toLowerCase().trim().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'');
          const tracking = (r['masterTrackingNumber'] || r['returnTrackingId'] || '').trim();
          if (!name || !tracking) return;
          // Try full name match first, then first+last word match
          let custId = nameToCustId[name];
          if (!custId) {
            // Try matching just first and last word (handles middle names/initials)
            const nameParts = name.split(' ').filter(Boolean);
            if (nameParts.length >= 2) {
              const shortName = nameParts[0] + ' ' + nameParts[nameParts.length-1];
              custId = Object.keys(nameToCustId).find(k => {
                const kParts = k.split(' ').filter(Boolean);
                return kParts[0] === nameParts[0] && kParts[kParts.length-1] === nameParts[nameParts.length-1];
              }) ? nameToCustId[Object.keys(nameToCustId).find(k => {
                const kParts = k.split(' ').filter(Boolean);
                return kParts[0] === nameParts[0] && kParts[kParts.length-1] === nameParts[nameParts.length-1];
              })] : null;
            }
          }
          if (!custId) { results.unmatched.push({source:'FedEx', name, reason:'No customer found'}); return; }
          // Find shipment - prefer rtf, fall back to outbound_complete
          const ship = rtfByCustomer[custId] || outboundCompleteByCustomer[custId];
          if (!ship) { results.unmatched.push({source:'FedEx', name, reason:'No active shipment'}); return; }
          // Add return tracking and mark outbound_complete
          const existing = updates.find(u => u.shipment_id === ship.shipment_id);
          if (existing) { existing.return_tracking = tracking; existing.stage = 'outbound_complete'; }
          else updates.push({shipment_id: ship.shipment_id, return_tracking: tracking, customer_id: custId, name, stage: 'outbound_complete'});
          results.matched.push({source:'FedEx', name, shipment_id:ship.shipment_id, tracking});
        });
      } catch(e) { results.errors.push('FedEx parse error: ' + e.message); }
    }

    // Apply all updates to Sheets + local state
    for (const u of updates) {
      const updateObj = {};
      if (u.outbound_tracking) updateObj.outbound_tracking = u.outbound_tracking;
      if (u.return_tracking) updateObj.return_tracking = u.return_tracking;
      // Move to outbound_complete if return tracking set
      if (u.return_tracking || u.stage === 'outbound_complete') updateObj.stage = 'outbound_complete';
      try {
        await apiPost({action:'updateShipment', shipment_id:u.shipment_id, updates:updateObj});
        const ship = shipments.find(s => s.shipment_id === u.shipment_id);
        if (ship) onUpdate({...ship, ...updateObj});
      } catch(e) { results.errors.push('Save error for ' + u.shipment_id + ': ' + e.message); }
    }

    // Add debug info
    results.debug = {
      customersLoaded: customers.length,
      shipmentsLoaded: shipments.length,
      rtfCount: Object.keys(rtfByCustomer).length,
      nameMapSample: Object.keys(nameToCustId).slice(0,5),
    };
    setUploadResults(results);
    setUploading(false);
  }

  function generateBatch(){
    const today=new Date().toISOString().slice(0,10);
    const SNAPPY_PHONE="8666130704";
    const SNAPPY_NAME="Snappy Gold";
    const SNAPPY_ADDR="1686 S FEDERAL HWY #318";
    const SNAPPY_ZIP="33483";
    const SNAPPY_CITY="DELRAY BEACH";
    const SNAPPY_STATE="FL";
    const SNAPPY_EMAIL="davidisaacweiss@yahoo.com";

    function parseAddr(addr){
      const parts=String(addr||"").split(",").map(x=>x.trim());
      // Try to extract state and zip from last parts
      let line1=parts[0]||"", city=parts[1]||"", state="", zip="";
      const stateZip=(parts[2]||"").trim().split(/\s+/);
      state=stateZip[0]||""; zip=stateZip[1]||parts[3]||"";
      return {line1, city, state, zip};
    }

    function fedexCSV(list){
      const headers=["serviceType","shipmentType","senderContactName","senderContactNumber","senderLine1","senderPostcode","senderCity","senderState","senderCountry","senderResidential","recipientContactName","recipientContactNumber","recipientLine1","recipientPostcode","recipientCity","recipientState","recipientCountry","recipientEmail","numberOfPackages","packageWeight","weightUnits","packageType","currencyType"];
      const rows=[headers];
      list.forEach(s=>{
        const c=custById[s.customer_id]||{};
        const a=parseAddr(c.address);
        const rawPhone=String(c.phone||"").replace(/\D/g,"").replace(/^1/,""); const phone=rawPhone.length>=10?rawPhone:SNAPPY_PHONE;
        rows.push([
          "FEDEX_GROUND","STANDALONE_RETURN",
          c.name||"Unknown", phone,
          a.line1, a.zip, a.city, a.state, "US", "Y",
          SNAPPY_NAME, SNAPPY_PHONE,
          SNAPPY_ADDR, SNAPPY_ZIP, SNAPPY_CITY, SNAPPY_STATE, "US",
          SNAPPY_EMAIL, "1","1","LBS","YOUR_PACKAGING","USD"
        ]);
      });
      return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    }

    function pirateshipCSV(list){
      const headers=["Name","Company","Address1","Address2","City","State","Zip","Country","Email","Phone","Weight","Length","Width","Height","Reference1","Reference2"];
      const rows=[headers];
      list.forEach(s=>{
        const c=custById[s.customer_id]||{};
        const a=parseAddr(c.address);
        const phone=String(c.phone||"").replace(/\D/g,"");
        rows.push([c.name||"","",a.line1,"",a.city,a.state,a.zip,"US",c.email||"",phone,"1","9","6","2",s.shipment_id,s.customer_id]);
      });
      return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    }

    function shippoCSV(list){
      // Shippo Orders CSV format (v2 template)
      // Return label: recipient = customer (ships FROM), order ships TO Snappy Gold
      const headers=["Order Number","Order Date","Recipient Name","Company","Email","Phone","Street Line 1","Street Number","Street Line 2","City","State/Province","Zip/Postal Code","Country","Item Title","SKU","Quantity","Item Weight","Item Weight Unit","Item Price","Item Currency","Order Weight","Order Weight Unit","Order Amount","Order Currency"];
      const rows=[headers];
      const today=new Date().toISOString().slice(0,10);
      list.forEach((s,i)=>{
        const c=custById[s.customer_id]||{};
        const a=parseAddr(c.address);
        const phone=String(c.phone||"").replace(/\D/g,"");
        rows.push([
          s.shipment_id,          // Order Number = shipment ID for easy tracking
          today,                  // Order Date
          c.name||"",             // Recipient Name (customer - ships FROM here)
          "",                     // Company
          c.email||"",            // Email
          phone,                  // Phone
          a.line1,                // Street Line 1
          "",                     // Street Number
          "",                     // Street Line 2
          a.city,                 // City
          a.state,                // State/Province
          a.zip,                  // Zip/Postal Code
          "US",                   // Country
          s.item||"Gold Jewelry", // Item Title
          s.shipment_id,          // SKU
          "1",                    // Quantity
          "1",                    // Item Weight
          "lb",                   // Item Weight Unit
          "0",                    // Item Price
          "USD",                  // Item Currency
          "1",                    // Order Weight
          "lb",                   // Order Weight Unit
          "0",                    // Order Amount
          "USD"                   // Order Currency
        ]);
      });
      return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    }

    function downloadCSV(filename,csv){
      const blob=new Blob([csv],{type:"text/csv"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    }

    // Use selected IDs if any are checked, otherwise use all filtered
    const batchSource = selectedIds.size > 0
      ? filtered.filter(s => selectedIds.has(s.shipment_id))
      : filtered;
    const fedexCustomers=batchSource.filter(s=>s.shipping_type==="label");
    const uspsCustomers=batchSource.filter(s=>s.shipping_type==="usps");
    const allLabelCustomers=[...fedexCustomers,...uspsCustomers];

    // 1. FedEx return labels CSV
    if(fedexCustomers.length>0){
      downloadCSV(`${today}_fedex_labels.csv`, fedexCSV(fedexCustomers));
    }

    // 2. Shippo USPS return labels CSV
    if(uspsCustomers.length>0){
      setTimeout(()=>downloadCSV(`${today}_shippo_usps_labels.csv`, shippoCSV(uspsCustomers)), 500);
    }

    // 3. Email copy doc (all label customers)
    if(allLabelCustomers.length>0){
      setTimeout(()=>{
        let doc=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Verdana,sans-serif;font-size:10pt;color:#222;max-width:700px;margin:40px auto;line-height:1.6;}h1{font-size:12pt;border-bottom:1px solid #ccc;padding-bottom:8px;}.entry{border-bottom:1px solid #eee;padding:20px 0;}.label{font-size:9pt;color:#888;font-weight:bold;text-transform:uppercase;margin-bottom:2px;}.value{margin-bottom:10px;}.subject{font-weight:bold;color:#C8953C;}.body-text{white-space:pre-wrap;background:#f9f9f9;padding:12px;border-radius:4px;border:1px solid #eee;}</style></head><body><h1>Label Email Guide — ${new Date().toLocaleDateString()}</h1>`;
        allLabelCustomers.forEach((s,i)=>{
          const c=custById[s.customer_id]||{};
          const firstName=(c.name||"").trim().split(" ")[0]||"there";
          const item=s.item||"your item";
          const isFedex=s.shipping_type==="label";
          const carrierName=isFedex?"FedEx":"USPS";
          const dropText=isFedex?"drop it at any FedEx location":"hand it to your postman or drop it at any post office";
          doc+=`[${i+1}] ${s.shipment_id} | ${s.customer_id} | ${carrierName}\n`;
          doc+=`TO: ${c.email||""}\n`;
          doc+=`NAME: ${c.name||""}  |  PHONE: ${fmtPhone(c.phone)}\n`;
          doc+=`ITEM: ${item}\n\n`;
          doc+=`SUBJECT: Your prepaid ${carrierName} label is ready, ${firstName}\n\n`;
          doc+=`Hi ${firstName},\n\n`;
          doc+=`Your prepaid ${carrierName} return label is attached to this email.\n\n`;
          doc+=`Just print the label, pack your ${item} in any sturdy box or padded envelope, attach it, and ${dropText} — completely free.\n\n`;
          doc+=`Feel free to include any other pieces you'd like me to look at while I have it. I'll evaluate everything within two business days and reach out with a firm offer. Don't like the number? I send it all back at no cost.\n\n`;
          doc+=`Any questions, just reply here or call/text me at 866-613-0704.\n\n`;
          doc+=`David\nSnappy Gold\n\n`;
          doc+="-".repeat(60)+"\n\n";
        });
        doc+='</body></html>';
        const blob=new Blob([doc],{type:"text/html"});
        const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${today}_label_email_copy.html`; a.click();
      }, 1000);
    }

    if(allLabelCustomers.length===0){
      alert("No label shipments in the fulfill queue.");
    }
  }

  async function doBulkStage(){
    setBulkSaving(true);
    for(const id of selectedIds){
      try{await apiPost({action:"updateShipment",shipment_id:id,updates:{stage:bulkStage}});}catch(e){console.error(e);}
    }
    // Update local state via onUpdate
    selectedIds.forEach(id=>{
      const s=shipments.find(x=>x.shipment_id===id);
      if(s) onUpdate({...s,stage:bulkStage});
    });
    setSelectedIds(new Set()); setBulkModal(false); setBulkSaving(false);
  }

  return <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
    {/* Left */}
    <div style={{width:isMobile?"100%":340,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selected?"none":"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{flex:1,background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
          <Btn v="ghost" small onClick={()=>setUploadModal(true)}>⬆ Ship Reports</Btn>
          <Btn v="gold" small onClick={generateBatch} disabled={filtered.length===0}>⬇ Batch</Btn>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",fontSize:11,color:G.muted}}>
          <span style={{background:"#F5F0FF",color:G.purple,borderRadius:4,padding:"2px 8px",fontWeight:600}}>{kits.length} kits</span>
          <span style={{background:"#EEF4FF",color:G.blue,borderRadius:4,padding:"2px 8px",fontWeight:600}}>{labels.length} FedEx</span>
          <span style={{background:"#F0FFF4",color:G.green,borderRadius:4,padding:"2px 8px",fontWeight:600}}>{uspsLabels.length} USPS</span>
          {selectedIds.size>0&&<button onClick={()=>setBulkModal(true)} style={{marginLeft:"auto",fontSize:10,padding:"2px 10px",borderRadius:4,background:G.gold,color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Bulk ({selectedIds.size})</button>}
        </div>
        <div style={{display:"flex",gap:4}}>
          <button onClick={()=>setShowDeferred(false)} style={{flex:1,fontSize:11,fontWeight:700,padding:"5px 0",borderRadius:6,cursor:"pointer",border:`1px solid ${!showDeferred?G.gold:G.border}`,background:!showDeferred?G.gold:"#fff",color:!showDeferred?"#fff":G.muted}}>Active</button>
          <button onClick={()=>setShowDeferred(true)} style={{flex:1,fontSize:11,fontWeight:700,padding:"5px 0",borderRadius:6,cursor:"pointer",border:`1px solid ${showDeferred?G.gold:G.border}`,background:showDeferred?G.gold:"#fff",color:showDeferred?"#fff":G.muted}}>Deferred{deferredCount>0?` (${deferredCount})`:""}</button>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.length===0?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No shipments ready to fulfill</div>:
          filtered.map(s=><ShipmentRow key={s.shipment_id} shipment={s} customer={custById[s.customer_id]} selected={selected===s.shipment_id} onClick={()=>setSelected(s.shipment_id)} onCheck={checked=>{setSelectedIds(prev=>{const n=new Set(prev);checked?n.add(s.shipment_id):n.delete(s.shipment_id);return n;});}} checked={selectedIds.has(s.shipment_id)}/>)
        }
      </div>
      <div style={{padding:"6px 12px",borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted}}>{filtered.length} shipments ready</div>
    </div>
    {/* Right */}
    {selectedShipment
      ?<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:isMobile?"fixed":"relative",inset:isMobile?"0":undefined,zIndex:isMobile?100:undefined,background:isMobile?"#fff":undefined}}>
        {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← Back</button>
        </div>}
        <div style={{flex:1,overflow:"auto"}}>
          <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);}} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>
        </div>
      </div>
      :<div style={{flex:1,display:isMobile?"none":"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
        <div style={{fontSize:40,opacity:0.3}}>◈</div>
        <div style={{fontSize:14}}>Select a shipment</div>
      </div>
    }

    {/* Upload Ship Reports Modal */}
    {uploadModal&&<UploadModal
      onProcess={processShipReports}
      onClose={()=>{setUploadModal(false);setUploadResults(null);}}
      results={uploadResults}
      uploading={uploading}
    />}
    {/* Bulk modal */}
    {bulkModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(400px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:4,color:G.text}}>Bulk Stage Update</div>
        <div style={{fontSize:12,color:G.muted,marginBottom:16}}>{selectedIds.size} shipments selected</div>
        <Sel label="Set all to" value={bulkStage} onChange={e=>setBulkStage(e.target.value)} options={STAGES.filter(s=>s!=="estimate_only").map(v=>({value:v,label:SL[v]||v}))}/>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
          <Btn v="ghost" onClick={()=>setBulkModal(false)}>Cancel</Btn>
          <Btn v="gold" onClick={doBulkStage} disabled={bulkSaving}>{bulkSaving?"Updating...":`Update ${selectedIds.size} Shipments`}</Btn>
        </div>
      </div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// PROCESS TAB
// ══════════════════════════════════════════════════════════

function OutboundTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [stageFilter,setStageFilter]=useState(null);
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [bulkModal,setBulkModal]=useState(false);
  const [bulkStage,setBulkStage]=useState("received");
  const [bulkSaving,setBulkSaving]=useState(false);
  const [uploadModal,setUploadModal]=useState(false);
  const [uploadResults,setUploadResults]=useState(null);
  const [uploading,setUploading]=useState(false);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>OUTBOUND_STAGES.includes(s.stage));
    if(stageFilter) list=list.filter(s=>s.stage===stageFilter);
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(c.phone||"").replace(/\D/g,"").includes(q)||String(c.address||"").toLowerCase().includes(q)||String(s.shipment_id||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q)||String(s.outbound_tracking||"").toLowerCase().includes(q);});}
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  },[shipments,search,stageFilter,custById]);

  const counts=useMemo(()=>{const m={};shipments.filter(s=>OUTBOUND_STAGES.includes(s.stage)).forEach(s=>m[s.stage]=(m[s.stage]||0)+1);return m;},[shipments]);

  const selectedShipment=useMemo(()=>shipments.find(s=>s.shipment_id===selected),[shipments,selected]);
  const selectedCustomer=useMemo(()=>selectedShipment?custById[selectedShipment.customer_id]:null,[selectedShipment,custById]);
  const selectedLogs=useMemo(()=>selectedShipment?(logsByCustomer[selectedShipment.customer_id]||[]):[],[selectedShipment,logsByCustomer]);

  async function doBulkStage(){
    setBulkSaving(true);
    for(const id of selectedIds){
      try{await apiPost({action:"updateShipment",shipment_id:id,updates:{stage:bulkStage}});}catch(e){console.error(e);}
    }
    selectedIds.forEach(id=>{const s=shipments.find(x=>x.shipment_id===id);if(s)onUpdate({...s,stage:bulkStage});});
    setSelectedIds(new Set()); setBulkModal(false); setBulkSaving(false);
  }

  return <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
    <div style={{width:isMobile?"100%":340,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selected?"none":"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:8}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>setStageFilter(null)} style={{background:!stageFilter?G.gold:"transparent",color:!stageFilter?"#fff":G.muted,border:`1px solid ${!stageFilter?G.gold:G.border}`,borderRadius:20,padding:"2px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>All {Object.values(counts).reduce((a,b)=>a+b,0)}</button>
          {OUTBOUND_STAGES.filter(s=>counts[s]).map(s=><button key={s} onClick={()=>setStageFilter(stageFilter===s?null:s)} style={{background:stageFilter===s?SC[s]+"22":"transparent",color:stageFilter===s?SC[s]:G.muted,border:`1px solid ${stageFilter===s?SC[s]+"66":G.border}`,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{SL[s]} {counts[s]}</button>)}
          {selectedIds.size>0&&<button onClick={()=>setBulkModal(true)} style={{marginLeft:"auto",fontSize:10,padding:"2px 10px",borderRadius:4,background:G.gold,color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Bulk ({selectedIds.size})</button>}
        </div>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.length===0?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No shipments in process</div>:
          filtered.map(s=><ShipmentRow key={s.shipment_id} shipment={s} customer={custById[s.customer_id]} selected={selected===s.shipment_id} onClick={()=>setSelected(s.shipment_id)} onCheck={checked=>{setSelectedIds(prev=>{const n=new Set(prev);checked?n.add(s.shipment_id):n.delete(s.shipment_id);return n;});}} checked={selectedIds.has(s.shipment_id)}/>)
        }
      </div>
      <div style={{padding:"6px 12px",borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted}}>{filtered.length} shipments</div>
    </div>
    <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);}} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>
    {bulkModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(400px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:4,color:G.text}}>Bulk Stage Update</div>
        <div style={{fontSize:12,color:G.muted,marginBottom:16}}>{selectedIds.size} shipments selected</div>
        <Sel label="Set all to" value={bulkStage} onChange={e=>setBulkStage(e.target.value)} options={STAGES.filter(s=>s!=="estimate_only").map(v=>({value:v,label:SL[v]||v}))}/>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
          <Btn v="ghost" onClick={()=>setBulkModal(false)}>Cancel</Btn>
          <Btn v="gold" onClick={doBulkStage} disabled={bulkSaving}>{bulkSaving?"Updating...":`Update ${selectedIds.size}`}</Btn>
        </div>
      </div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// FOLLOW UP TAB
// ══════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════
// CONVERT LEAD TO SHIPMENT MODAL
// ══════════════════════════════════════════════════════════

function ConvertLeadModal({lead, onSave, onClose}) {
  const [stage, setStage] = useState("outbound_complete");
  const [shippingType, setShippingType] = useState("kit");
  const [item, setItem] = useState(lead.item||"");
  const [estimate, setEstimate] = useState(lead.estimate||"");
  const [outboundTracking, setOutboundTracking] = useState("");
  const [returnTracking, setReturnTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await onSave({
      stage, shipping_type:shippingType, item, estimate,
      outbound_tracking:outboundTracking, return_tracking:returnTracking,
      notes, received_at:"", purchase_price:"", appraised_value:"",
      payment_method:"", payment_info:"", sent_at:""
    });
    setSaving(false);
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(520px,95vw)",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <div style={{fontWeight:700,fontSize:16,marginBottom:4,color:G.text}}>Create Shipment</div>
      <div style={{fontSize:12,color:G.muted,marginBottom:20}}>{lead.name||lead.email}</div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Sel label="Stage" value={stage} onChange={e=>setStage(e.target.value)}
            options={STAGES.filter(s=>s!=="estimate_only").map(v=>({value:v,label:SL[v]||v}))}/>
          <Sel label="Shipping Type" value={shippingType} onChange={e=>setShippingType(e.target.value)}
            options={[{value:"kit",label:"Kit"},{value:"label",label:"FedEx Label"},{value:"usps",label:"USPS Label"}]}/>
        </div>
        <Inp label="Item" value={item} onChange={e=>setItem(e.target.value)}/>
        <Inp label="Estimate" value={estimate} onChange={e=>setEstimate(e.target.value)}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Inp label="Outbound Tracking" value={outboundTracking} onChange={e=>setOutboundTracking(e.target.value)} mono/>
          <Inp label="Return Tracking" value={returnTracking} onChange={e=>setReturnTracking(e.target.value)} mono/>
        </div>
        <Inp label="Notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Optional"/>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
        <Btn v="ghost" onClick={onClose}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={saving}>{saving?"Creating...":"Create Shipment"}</Btn>
      </div>
    </div>
  </div>;
}

function LeadsTab({activeCustomerEmails,onCountChange}) {
  const isMobile=useIsMobile();
  const [leads,setLeads]=useState([]);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");

  useEffect(()=>{loadLeads();},[]);

  async function loadLeads(){
    setLoading(true);
    try {
      const res=await apiFetch({action:"crm_leads",key:CRM_KEY});
      if(res.leads) setLeads(res.leads);
    } catch(e){console.error(e);}
    setLoading(false);
  }

  const [junkEmails,setJunkEmails]=useState(()=>new Set(getJunkList()));
  const [convertModal,setConvertModal]=useState(false);

  const filtered=useMemo(()=>{
    let list=leads.filter(l=>!activeCustomerEmails.has(String(l.email).toLowerCase())&&!junkEmails.has(String(l.email).toLowerCase()));
    if(search){const q=search.toLowerCase();list=list.filter(l=>String(l.name||"").toLowerCase().includes(q)||String(l.email||"").toLowerCase().includes(q)||String(l.item||"").toLowerCase().includes(q)||String(l.phone||"").toLowerCase().includes(q)||String(l.address||"").toLowerCase().includes(q));}
    return [...list].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  },[leads,search,activeCustomerEmails,junkEmails]);

  useEffect(()=>{if(onCountChange)onCountChange(filtered.length);},[filtered.length]);

  const sel=selected?filtered.find(l=>l.email===selected):null;

  return <div style={{flex:1,display:"flex",overflow:"hidden"}}>
    {/* Left */}
    <div style={{width:340,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`,display:"flex",gap:8,alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search leads..." style={{flex:1,background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
        <Btn v="ghost" small onClick={loadLeads} disabled={loading}>{loading?"…":"⟳"}</Btn>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {loading?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>Loading...</div>:
        filtered.length===0?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No incomplete leads</div>:
        filtered.map(l=>{
          const ds=daysSince(l.timestamp);
          const high=parseEstHigh(l.estimate);
          return <div key={l.email} onClick={()=>setSelected(l.email===selected?null:l.email)} style={{padding:"12px 16px",cursor:"pointer",borderBottom:`1px solid ${G.border}`,background:selected===l.email?"#FFF8EE":"#fff",borderLeft:selected===l.email?`3px solid ${G.gold}`:"3px solid transparent"}} onMouseEnter={e=>{if(selected!==l.email)e.currentTarget.style.background="#FDFAF6";}} onMouseLeave={e=>{if(selected!==l.email)e.currentTarget.style.background="#fff";}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <Avatar name={l.name||l.email} size={32}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <div style={{fontWeight:600,fontSize:13,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.name||l.email}</div>
                  {high>0&&<div style={{color:G.gold,fontWeight:700,fontSize:12,flexShrink:0}}>{fmt$(high)}</div>}
                </div>
                <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.item||"(no item)"}</div>
                <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center"}}>
                  <span style={{background:"#FFF3E0",color:G.orange,border:`1px solid ${G.orange}30`,borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>Incomplete</span>
                  {ds!==null&&<span style={{fontSize:10,color:G.muted}}>{ds}d ago</span>}
                  {l.anySent&&<span style={{fontSize:10,color:G.green}}>✓ emailed</span>}
                </div>
              </div>
            </div>
          </div>;
        })}
      </div>
      <div style={{padding:"6px 12px",borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted}}>{filtered.length} incomplete leads</div>
    </div>
    {/* Right */}
    {sel?<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:isMobile?"fixed":"relative",inset:isMobile?"0":undefined,zIndex:isMobile?100:undefined,background:isMobile?"#fff":undefined}}>
      {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← Back</button>
      </div>}
      <div style={{flex:1,overflow:"auto",padding:20}}>
      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20}}>
        <Avatar name={sel.name||sel.email} size={48}/>
        <div>
          <div style={{fontWeight:700,fontSize:18,color:G.text}}>{sel.name||"(no name)"}</div>
          <div style={{fontSize:13,color:G.muted}}>{sel.email}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {sel.phone&&<><a href={`tel:${sel.phone}`} style={{textDecoration:"none"}}><Btn v="green">📞 Call</Btn></a><a href={smsHref(sel.phone)} style={{textDecoration:"none"}}><Btn v="blue">💬 Text</Btn></a></>}
        {sel.email&&<a href={emailHref(sel.email)} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><Btn v="ghost">✉ Email</Btn></a>}
        <Btn v="purple" onClick={()=>setConvertModal(true)}>+ Shipment</Btn>
        <Btn v="danger" onClick={()=>{
          const email=String(sel.email||"").toLowerCase();
          if(!email) return;
          addToJunkList(email);
          setSelected(null);
          setJunkEmails(prev=>new Set([...prev,email]));
        }}>✕ Remove</Btn>
      </div>
      {convertModal&&sel&&<ConvertLeadModal lead={sel} onSave={async(shipData)=>{
        try {
          // Upsert customer first
          const custRes=await apiPost({action:"upsertCustomer",data:{email:sel.email,name:sel.name,phone:sel.phone,address:sel.address||"",source:sel.source||""}});
          const custId=custRes.customer_id||custRes;
          // Create shipment
          await apiPost({action:"createShipment",data:{customer_id:custId,...shipData}});
          setConvertModal(false);
          setSelected(null);
          // Add to active emails so they filter out
          setJunkEmails(prev=>new Set([...prev,sel.email.toLowerCase()]));
        } catch(e){alert("Failed: "+e.message);}
      }} onClose={()=>setConvertModal(false)}/>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Lead Details</div>
          {sel.item&&<div><div style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>Item</div><div style={{fontSize:13,color:G.text}}>{sel.item}</div></div>}
          {sel.estimate&&<div><div style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>Estimate</div><div style={{fontSize:15,fontWeight:700,color:G.gold}}>{sel.estimate}</div></div>}
          {sel.source&&<div><div style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>Source</div><div style={{fontSize:13,color:G.text}}>{sel.source}</div></div>}
          <div><div style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>Submitted</div><div style={{fontSize:13,color:G.text}}>{sel.timestamp?new Date(sel.timestamp).toLocaleDateString():""}</div></div>
          {sel.anySent&&<div style={{background:"#F0FFF4",borderRadius:6,padding:"6px 10px",fontSize:12,color:G.green,fontWeight:600}}>✓ Follow-up email sent</div>}
        </div>
        <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Contact</div>
          {sel.phone&&<div><div style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>Phone</div><div style={{fontSize:13,color:G.text}}>{fmtPhone(sel.phone)}</div></div>}
          {sel.address&&<div><div style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>Address</div><div style={{fontSize:13,color:G.text}}>{sel.address}</div></div>}
          {!sel.address&&<div style={{fontSize:12,color:G.muted,fontStyle:"italic"}}>No address on file</div>}
          {!sel.phone&&<div style={{fontSize:12,color:G.muted,fontStyle:"italic"}}>No phone on file</div>}
        </div>
      </div>
      {sel.photo&&String(sel.photo).indexOf('drive.google.com')!==-1&&(()=>{
        const url=String(sel.photo);
        const fileIdMatch=url.match(/\/d\/([^\/]+)\//);
        const fileId=fileIdMatch?fileIdMatch[1]:null;
        const thumbUrl=fileId?`https://drive.google.com/thumbnail?id=${fileId}&sz=w300`:null;
        return <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,marginTop:16}}>
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Photo</div>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{display:"block",border:`1px solid ${G.border}`,borderRadius:8,overflow:"hidden",width:160,height:160,background:G.bg}}>
            {thumbUrl
              ?<img src={thumbUrl} alt="photo" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";}}/>
              :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:G.muted}}>View Photo</div>}
          </a>
        </div>;
      })()}
    </div></div>:<div style={{flex:1,display:isMobile?"none":"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a lead to view details</div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// CUSTOMERS TAB
// ══════════════════════════════════════════════════════════

function CustomersTab({customers,shipments,contactLogs,onUpdate,onNewShipment}) {
  const isMobile=useIsMobile();
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState(null);
  const [selectedShipId,setSelectedShipId]=useState(null);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);
  const shipsByCustomer=useMemo(()=>{const m={};shipments.forEach(s=>{if(!m[s.customer_id])m[s.customer_id]=[];m[s.customer_id].push(s);});return m;},[shipments]);

  const filtered=useMemo(()=>{
    if(!search) return customers;
    const q=search.toLowerCase();
    return customers.filter(c=>String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(c.phone||"").toLowerCase().includes(q)||String(c.customer_id||"").toLowerCase().includes(q));
  },[customers,search]);

  const selCustomer=selected?custById[selected]:null;
  const selShipments=selected?(shipsByCustomer[selected]||[]).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)):[];
  const selShipment=selectedShipId?selShipments.find(s=>s.shipment_id===selectedShipId):null;
  const selLogs=selected?(logsByCustomer[selected]||[]):[];

  return <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
    {/* Left: customer list */}
    <div style={{width:isMobile?"100%":280,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selected?"none":"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.map(c=>{
          const ships=shipsByCustomer[c.customer_id]||[];
          const activeShip=ships.find(s=>["ready_to_fulfill","outbound_complete","received","inspected","pending_response","pending_payment","pending_leadsonline"].includes(s.stage));
          return <div key={c.customer_id} onClick={()=>{setSelected(c.customer_id);setSelectedShipId(null);}} style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${G.border}`,background:selected===c.customer_id?"#FFF8EE":"#fff",borderLeft:selected===c.customer_id?`3px solid ${G.gold}`:"3px solid transparent"}} onMouseEnter={e=>{if(selected!==c.customer_id)e.currentTarget.style.background="#FDFAF6";}} onMouseLeave={e=>{if(selected!==c.customer_id)e.currentTarget.style.background="#fff";}}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <Avatar name={c.name||c.email} size={30}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name||"(no name)"}</div>
                <div style={{fontSize:11,color:G.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email}</div>
                <div style={{display:"flex",gap:6,marginTop:3,alignItems:"center"}}>
                  <span style={{fontSize:10,color:G.muted}}>{ships.length} shipment{ships.length!==1?"s":""}</span>
                  {activeShip&&<Badge stage={activeShip.stage} sm/>}
                </div>
              </div>
            </div>
          </div>;
        })}
      </div>
      <div style={{padding:"6px 12px",borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted}}>{filtered.length} customers</div>
    </div>

    {/* Middle: shipment list for selected customer */}
    {selCustomer&&<div style={{width:isMobile?"100%":260,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selectedShipId?"none":"flex",flexDirection:"column",background:G.bg,flexShrink:0}}>
      {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={()=>{setSelected(null);setSelectedShipId(null);}} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← Customers</button>
      </div>}
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${G.border}`,background:"#fff"}}>
        <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
          <Avatar name={selCustomer.name} size={36}/>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:G.text}}>{selCustomer.name||"(no name)"}</div>
            <div style={{fontSize:11,color:G.muted}}>{selCustomer.email}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {selCustomer.phone&&<><a href={`tel:${selCustomer.phone}`} style={{textDecoration:"none"}}><Btn v="green" small>📞</Btn></a><a href={smsHref(selCustomer.phone)} style={{textDecoration:"none"}}><Btn v="blue" small>💬</Btn></a></>}
          {selCustomer.email&&<a href={emailHref(selCustomer.email)} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><Btn v="ghost" small>✉</Btn></a>}
          <Btn v="purple" small onClick={async()=>{if(!selCustomer||!onNewShipment)return;try{const res=await apiPost({action:"createShipment",data:{customer_id:selCustomer.customer_id,stage:"ready_to_fulfill"}});const shipId=(res&&res.data)||res;if(!shipId||typeof shipId!=="string"){alert("Create shipment returned no ID");return;}const realShip={shipment_id:shipId,customer_id:selCustomer.customer_id,stage:"ready_to_fulfill",created_at:new Date().toISOString()};onNewShipment(realShip);setSelectedShipId(shipId);}catch(e){alert("Failed to create shipment: "+(e.message||e));}}}>+ Ship</Btn>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:8,display:"flex",flexDirection:"column",gap:6}}>
        {selShipments.length===0?<div style={{padding:16,textAlign:"center",color:G.muted,fontSize:12}}>No shipments</div>:
        selShipments.map(s=><div key={s.shipment_id} onClick={()=>setSelectedShipId(s.shipment_id)} style={{background:"#fff",borderRadius:8,padding:"10px 12px",cursor:"pointer",border:`1px solid ${selectedShipId===s.shipment_id?G.gold:G.border}`,boxShadow:selectedShipId===s.shipment_id?"0 0 0 2px "+G.gold+"33":"none"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div style={{fontSize:12,fontWeight:600,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{displayItem(s)}</div>
            {parseEstHigh(s.estimate)>0&&<div style={{fontSize:11,color:G.gold,fontWeight:700,flexShrink:0}}>{fmt$(parseEstHigh(s.estimate))}</div>}
          </div>
          <div style={{display:"flex",gap:6,marginTop:6,alignItems:"center"}}>
            <Badge stage={s.stage} sm/>
            <span style={{fontSize:10,color:G.muted}}>{s.shipment_id}</span>
          </div>
        </div>)}
      </div>
    </div>}

    {/* Right: shipment detail */}
    {selCustomer&&selShipment?<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:isMobile?"fixed":"relative",inset:isMobile?"0":undefined,zIndex:isMobile?100:undefined,background:isMobile?"#fff":undefined}}>
      {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={()=>setSelectedShipId(null)} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← {selCustomer.name||"Back"}</button>
      </div>}
      <DetailPane shipment={selShipment} customer={selCustomer} contactLogs={selLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);}} onNewShipment={s=>{onNewShipment(s);setSelectedShipId(s.shipment_id);}} onClose={()=>setSelectedShipId(null)}/>
    </div>
    :selCustomer?<div style={{flex:1,display:isMobile?"none":"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a shipment to view details</div>
      <Btn v="gold" onClick={async()=>{if(!selCustomer||!onNewShipment)return;try{const res=await apiPost({action:"createShipment",data:{customer_id:selCustomer.customer_id,stage:"ready_to_fulfill"}});const shipId=(res&&res.data)||res;if(!shipId||typeof shipId!=="string"){alert("Create shipment returned no ID");return;}const realShip={shipment_id:shipId,customer_id:selCustomer.customer_id,stage:"ready_to_fulfill",created_at:new Date().toISOString()};onNewShipment(realShip);setSelectedShipId(shipId);}catch(e){alert("Failed to create shipment: "+(e.message||e));}}}>+ New Shipment</Btn>
    </div>
    :<div style={{flex:1,display:isMobile?"none":"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a customer</div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════


function UrgentTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const isMobile=useIsMobile();
  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);
  const filtered=shipments.filter(s=>s.is_urgent==="true"||s.is_urgent===true);
  const selectedShipment=useMemo(()=>shipments.find(s=>s.shipment_id===selected),[shipments,selected]);
  const selectedCustomer=useMemo(()=>selectedShipment?custById[selectedShipment.customer_id]:null,[selectedShipment,custById]);
  const selectedLogs=useMemo(()=>selectedShipment?(logsByCustomer[selectedShipment.customer_id]||[]):[],[selectedShipment,logsByCustomer]);
  return <div style={{display:"flex",flex:1,overflow:"hidden",position:"relative"}}>
    <div style={{width:isMobile?"100%":320,borderRight:isMobile?"none":`1px solid ${G.border}`,display:isMobile&&selected?"none":"flex",flexDirection:"column",background:"#fff",overflow:"hidden"}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${G.border}`,fontSize:12,color:G.muted}}>{filtered.length} urgent {filtered.length===1?"shipment":"shipments"}</div>
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.length===0
          ?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No urgent shipments</div>
          :filtered.map(s=>{
            const c=custById[s.customer_id]||{};
            const isSelected=selected===s.shipment_id;
            return <div key={s.shipment_id} onClick={()=>setSelected(s.shipment_id)}
              style={{padding:"12px 16px",borderBottom:`1px solid ${G.border}`,cursor:"pointer",background:isSelected?"#FFF8EE":"#fff",borderLeft:isSelected?`3px solid ${G.red}`:"3px solid transparent"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:G.red,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{(c.name||"?").split(" ").map(w=>w[0]).slice(0,2).join("")}</div>
                  <div><div style={{fontWeight:600,fontSize:13,color:G.text}}>{c.name||"Unknown"}</div><div style={{fontSize:11,color:G.muted,marginTop:1}}>{displayItem(s)}</div></div>
                </div>
                {s.estimate&&<div style={{fontSize:12,fontWeight:700,color:G.gold}}>{s.estimate}</div>}
              </div>
              <div style={{display:"flex",gap:6,marginTop:4}}>
                <span style={{background:SC[s.stage]+"22",color:SC[s.stage],borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>{SL[s.stage]||s.stage}</span>
                <span style={{background:"#FFE8E8",color:G.red,borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>🚨 Urgent</span>
              </div>
            </div>;
          })
        }
      </div>
    </div>
    {selectedShipment
      ?<div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden",position:isMobile?"fixed":"relative",inset:isMobile?"0":undefined,zIndex:isMobile?100:undefined,background:isMobile?"#fff":undefined}}>
        {isMobile&&<div style={{padding:"10px 16px",borderBottom:`1px solid ${G.border}`,background:G.dark,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:G.gold,fontSize:14,fontWeight:700,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>← Back</button>
        </div>}
        <div style={{flex:1,overflow:"auto",padding:16}}>
          <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={onUpdate} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>
        </div>
      </div>
      :<div style={{display:isMobile?"none":"flex",alignItems:"center",justifyContent:"center",height:"100%",color:G.muted,fontSize:13,flex:1}}>Select a shipment to view details</div>
    }
  </div>;
}

// ══════════════════════════════════════════════════════════
// ANALYTICS TAB
// ══════════════════════════════════════════════════════════

const ANALYTICS_STORAGE_KEY = "sg_analytics_settings";

function loadAnalyticsSettings() {
  try { return JSON.parse(localStorage.getItem(ANALYTICS_STORAGE_KEY)||"{}"); } catch { return {}; }
}
function saveAnalyticsSettings(s) {
  try { localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  SalesTab — JUN 2
//  List of sales (resale to dealers/buyers like Barry's Pawn). Supports
//  add/edit/delete. Each sale references one or more shipments (bundle).
// ═══════════════════════════════════════════════════════════════════
function SalesTab({shipments, customers}) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingSale, setEditingSale] = useState(null);

  async function loadSales() {
    setLoading(true);
    try {
      const r = await apiFetch({action:"getSales"});
      setSales(r?.sales || []);
    } catch(e) { console.error(e); }
    setLoading(false);
  }
  useEffect(() => { loadSales(); }, []);

  const shipById = useMemo(() => {
    const m = {}; shipments.forEach(s => m[s.shipment_id] = s); return m;
  }, [shipments]);
  const custById = useMemo(() => {
    const m = {}; customers.forEach(c => m[c.customer_id] = c); return m;
  }, [customers]);

  function summarizeSale(sale) {
    const ids = String(sale.shipment_ids || "").split(",").map(s => s.trim()).filter(Boolean);
    const ships = ids.map(id => shipById[id]).filter(Boolean);
    const totalCost = ships.reduce((sum, s) => sum + (parseFloat(s.purchase_price) || 0), 0);
    const profit = (parseFloat(sale.amount) || 0) - totalCost;
    const margin = totalCost > 0 ? (profit / totalCost) * 100 : null;
    const customerNames = [...new Set(ships.map(s => custById[s.customer_id]?.name).filter(Boolean))].join(", ");
    const items = ships.map(s => s.item || s.shipment_id).filter(Boolean);
    return { ids, ships, totalCost, profit, margin, customerNames, items };
  }

  const totalRevenue = sales.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const totalProfit = sales.reduce((sum, s) => sum + summarizeSale(s).profit, 0);

  return <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",padding:24,background:G.bg}}>
    {showAdd && <SaleModal shipments={shipments} customers={customers} onSave={()=>{setShowAdd(false);loadSales();}} onCancel={()=>setShowAdd(false)} initialShipmentIds={[]}/>}
    {editingSale && <SaleModal shipments={shipments} customers={customers} sale={editingSale} onSave={()=>{setEditingSale(null);loadSales();}} onCancel={()=>setEditingSale(null)} initialShipmentIds={String(editingSale.shipment_ids||"").split(",").map(x=>x.trim()).filter(Boolean)}/>}

    <div style={{display:"flex",alignItems:"center",marginBottom:20,gap:14}}>
      <h2 style={{margin:0,fontSize:22,color:G.text}}>Sales</h2>
      <div style={{flex:1}}/>
      <div style={{fontSize:13,color:G.muted}}>
        Total revenue: <strong style={{color:G.text}}>${totalRevenue.toFixed(2)}</strong>
        {" · "}Total profit: <strong style={{color:totalProfit>=0?G.green:G.red}}>${totalProfit.toFixed(2)}</strong>
      </div>
      <Btn v="gold" onClick={()=>setShowAdd(true)}>+ Add Sale</Btn>
    </div>

    {loading ? <div style={{color:G.muted}}>Loading…</div> :
     sales.length === 0 ? <div style={{padding:48,textAlign:"center",color:G.muted,background:"#fff",borderRadius:10,border:`1px solid ${G.border}`}}>
       <div style={{fontSize:32,marginBottom:12}}>💰</div>
       <div style={{fontSize:14}}>No sales recorded yet.</div>
       <div style={{fontSize:12,marginTop:6}}>Click "+ Add Sale" to record your first sale.</div>
     </div> :
     <div style={{flex:1,overflow:"auto"}}>
       <table style={{width:"100%",borderCollapse:"collapse",background:"#fff",borderRadius:10,overflow:"hidden",border:`1px solid ${G.border}`}}>
         <thead>
           <tr style={{background:"#1A1816",color:G.gold,fontSize:11,letterSpacing:"0.08em",textTransform:"uppercase"}}>
             <th style={{textAlign:"left",padding:"10px 12px"}}>Date</th>
             <th style={{textAlign:"left",padding:"10px 12px"}}>Buyer</th>
             <th style={{textAlign:"left",padding:"10px 12px"}}>Items</th>
             <th style={{textAlign:"left",padding:"10px 12px"}}>Payment</th>
             <th style={{textAlign:"right",padding:"10px 12px"}}>Cost</th>
             <th style={{textAlign:"right",padding:"10px 12px"}}>Sold For</th>
             <th style={{textAlign:"right",padding:"10px 12px"}}>Profit</th>
             <th style={{textAlign:"right",padding:"10px 12px"}}>Margin</th>
             <th style={{padding:"10px 12px"}}/>
           </tr>
         </thead>
         <tbody>
           {sales.slice().sort((a,b)=>new Date(b.sale_date||b.created_at)-new Date(a.sale_date||a.created_at)).map(sale => {
             const s = summarizeSale(sale);
             return <tr key={sale.sale_id} style={{borderBottom:`1px solid ${G.border}`,fontSize:13}}>
               <td style={{padding:"10px 12px",color:G.muted}}>{sale.sale_date || (sale.created_at && new Date(sale.created_at).toLocaleDateString())}</td>
               <td style={{padding:"10px 12px",fontWeight:600}}>{sale.buyer_name}</td>
               <td style={{padding:"10px 12px",fontSize:12,color:G.muted,maxWidth:300}}>
                 <div>{s.items.length} item{s.items.length!==1?"s":""}{s.customerNames?` · from ${s.customerNames}`:""}</div>
                 <div style={{fontSize:11,marginTop:2}}>{s.ids.join(", ")}</div>
               </td>
               <td style={{padding:"10px 12px",fontSize:12,color:G.muted,textTransform:"capitalize"}}>{sale.payment_method ? sale.payment_method.replace(/_/g," ") : "—"}</td>
               <td style={{padding:"10px 12px",textAlign:"right",color:G.muted}}>${s.totalCost.toFixed(2)}</td>
               <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600}}>${(parseFloat(sale.amount)||0).toFixed(2)}</td>
               <td style={{padding:"10px 12px",textAlign:"right",color:s.profit>=0?G.green:G.red,fontWeight:600}}>${s.profit.toFixed(2)}</td>
               <td style={{padding:"10px 12px",textAlign:"right",fontSize:12,color:G.muted}}>{s.margin!==null?s.margin.toFixed(0)+"%":"—"}</td>
               <td style={{padding:"10px 12px",textAlign:"right"}}>
                 <Btn v="ghost" small onClick={()=>setEditingSale(sale)}>Edit</Btn>
                 <Btn v="ghost" small onClick={async()=>{
                   if(!confirm("Delete this sale?")) return;
                   const r = await apiPost({action:"deleteSale",sale_id:sale.sale_id});
                   if(r?.success) loadSales(); else alert("Delete failed: "+(r?.error||"unknown"));
                 }}>Delete</Btn>
               </td>
             </tr>;
           })}
         </tbody>
       </table>
     </div>
    }
  </div>;
}

// SaleModal — add or edit a sale
function SaleModal({shipments, customers, sale, onSave, onCancel, initialShipmentIds}) {
  const isEdit = !!sale;
  const [buyerName, setBuyerName] = useState(sale?.buyer_name || "");
  const [amount, setAmount] = useState(sale?.amount || "");
  const [paymentMethod, setPaymentMethod] = useState(sale?.payment_method || "");
  const [saleDate, setSaleDate] = useState(sale?.sale_date || new Date().toISOString().slice(0,10));
  const [notes, setNotes] = useState(sale?.notes || "");
  const [selectedShipIds, setSelectedShipIds] = useState(initialShipmentIds || []);
  const [shipFilter, setShipFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const custById = useMemo(() => {
    const m = {}; customers.forEach(c => m[c.customer_id] = c); return m;
  }, [customers]);

  // Eligible shipments: we own the item once paid (pending_leadsonline) or done (complete)
  const eligible = useMemo(() => {
    const eligibleStages = ["complete","pending_leadsonline"];
    return shipments
      .filter(s => eligibleStages.includes(s.stage) || selectedShipIds.includes(s.shipment_id))
      .map(s => ({
        ...s,
        customerName: custById[s.customer_id]?.name || "",
        searchKey: `${s.shipment_id} ${s.item||""} ${custById[s.customer_id]?.name||""}`.toLowerCase(),
      }))
      .filter(s => !shipFilter || s.searchKey.includes(shipFilter.toLowerCase()))
      .sort((a,b) => new Date(b.purchased_at||b.created_at) - new Date(a.purchased_at||a.created_at));
  }, [shipments, custById, shipFilter, selectedShipIds]);

  function toggleShipment(shipId) {
    setSelectedShipIds(prev => prev.includes(shipId) ? prev.filter(x=>x!==shipId) : [...prev, shipId]);
  }

  async function save() {
    if (!buyerName.trim()) { alert("Buyer name required"); return; }
    if (!amount || isNaN(parseFloat(amount))) { alert("Amount must be a number"); return; }
    if (selectedShipIds.length === 0) { alert("Select at least one shipment"); return; }
    setSaving(true);
    try {
      const action = isEdit ? "updateSale" : "addSale";
      const payload = isEdit
        ? {action,sale_id:sale.sale_id,updates:{buyer_name:buyerName.trim(),amount:parseFloat(amount).toFixed(2),payment_method:paymentMethod,sale_date:saleDate,notes:notes.trim(),shipment_ids:selectedShipIds.join(",")}}
        : {action,data:{buyer_name:buyerName.trim(),amount:parseFloat(amount).toFixed(2),payment_method:paymentMethod,sale_date:saleDate,notes:notes.trim(),shipment_ids:selectedShipIds.join(",")}};
      const r = await apiPost(payload);
      if (r?.success) onSave(); else alert("Save failed: "+(r?.error||"unknown"));
    } catch(e) { alert("Save failed: "+(e.message||e)); }
    setSaving(false);
  }

  const totalCost = selectedShipIds.reduce((sum, id) => {
    const s = shipments.find(x => x.shipment_id === id);
    return sum + (parseFloat(s?.purchase_price) || 0);
  }, 0);
  const profit = (parseFloat(amount) || 0) - totalCost;

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&onCancel()}>
    <div style={{background:"#fff",borderRadius:12,width:"min(700px,95vw)",maxHeight:"90vh",overflow:"auto",padding:24,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
      <h2 style={{margin:"0 0 6px",fontSize:18,color:G.text}}>{isEdit ? "Edit Sale" : "Record New Sale"}</h2>
      <div style={{fontSize:13,color:G.muted,marginBottom:18}}>Track what you sold, to whom, for how much.</div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:G.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Buyer name</label>
          <input value={buyerName} onChange={e=>setBuyerName(e.target.value)} placeholder="e.g. Barry's Pawn" style={{width:"100%",padding:"10px 12px",fontSize:14,border:`1px solid ${G.border}`,borderRadius:6,boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:G.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Sale amount ($)</label>
          <input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="535.00" style={{width:"100%",padding:"10px 12px",fontSize:14,border:`1px solid ${G.border}`,borderRadius:6,boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:G.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Payment method</label>
          <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)} style={{width:"100%",padding:"10px 12px",fontSize:14,border:`1px solid ${G.border}`,borderRadius:6,boxSizing:"border-box",background:"#fff"}}>
            <option value="">— select —</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="zelle">Zelle</option>
            <option value="venmo">Venmo</option>
            <option value="ach">ACH / Wire</option>
            <option value="credit_card">Credit card</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label style={{display:"block",fontSize:11,fontWeight:600,color:G.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Sale date</label>
          <input type="date" value={saleDate} onChange={e=>setSaleDate(e.target.value)} style={{width:"100%",padding:"10px 12px",fontSize:14,border:`1px solid ${G.border}`,borderRadius:6,boxSizing:"border-box"}}/>
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:11,fontWeight:600,color:G.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>Notes</label>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything worth remembering — payment terms, condition adjustments, etc." rows={2} style={{width:"100%",padding:10,fontSize:14,fontFamily:"inherit",border:`1px solid ${G.border}`,borderRadius:6,resize:"vertical",boxSizing:"border-box"}}/>
      </div>

      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:11,fontWeight:600,color:G.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>
          Shipments sold ({selectedShipIds.length} selected{selectedShipIds.length>0 && `, cost basis $${totalCost.toFixed(2)}, profit $${profit.toFixed(2)}`})
        </label>
        <input value={shipFilter} onChange={e=>setShipFilter(e.target.value)} placeholder="Filter by name, item, or shipment ID…" style={{width:"100%",padding:"8px 12px",fontSize:13,border:`1px solid ${G.border}`,borderRadius:6,boxSizing:"border-box",marginBottom:8}}/>
        <div style={{border:`1px solid ${G.border}`,borderRadius:6,maxHeight:260,overflow:"auto"}}>
          {eligible.length === 0 ? <div style={{padding:14,color:G.muted,fontSize:13}}>No purchased shipments match.</div> :
            eligible.map(s => {
              const sel = selectedShipIds.includes(s.shipment_id);
              return <div key={s.shipment_id} onClick={()=>toggleShipment(s.shipment_id)} style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`,cursor:"pointer",background:sel?"#FFF8E1":"#fff",display:"flex",alignItems:"center",gap:10}}>
                <input type="checkbox" checked={sel} readOnly style={{cursor:"pointer"}}/>
                <div style={{flex:1,fontSize:13}}>
                  <div style={{fontWeight:600}}>{s.shipment_id} · {s.customerName}</div>
                  <div style={{fontSize:12,color:G.muted}}>{s.item || "(no item)"}</div>
                </div>
                <div style={{fontSize:12,color:G.muted,textAlign:"right"}}>
                  <div>Cost: ${parseFloat(s.purchase_price||0).toFixed(2)}</div>
                </div>
              </div>;
            })}
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
        <Btn v="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>
        <Btn v="gold" onClick={save} disabled={saving}>{saving ? "Saving…" : (isEdit ? "Save changes" : "Record sale")}</Btn>
      </div>
    </div>
  </div>;
}

function AnalyticsTab({shipments, customers}) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate()-30);
  const fmt$ = n => n!=null&&n!==""&&!isNaN(Number(n)) ? "$"+Number(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}) : "—";
  const fmtN = n => n!=null&&n!==""&&!isNaN(Number(n)) ? Number(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}) : "—";

  // Date range state
  const [range, setRange] = useState("all"); // "all" | "30d" | "custom"
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate()-30);
    return d.toISOString().slice(0,10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0,10));

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const saved = loadAnalyticsSettings();
  const [inboundCost, setInboundCost] = useState(saved.inboundCost ?? 14);
  const [outboundCost, setOutboundCost] = useState(saved.outboundCost ?? 7);
  const [adSpendEntries, setAdSpendEntries] = useState(saved.adSpendEntries || []); // [{month:"2026-03", amount:1800}]
  const [adSpendInput, setAdSpendInput] = useState({month: new Date().toISOString().slice(0,7), amount:""});

  function saveSettings(updates={}) {
    const s = { inboundCost, outboundCost, adSpendEntries, ...updates };
    saveAnalyticsSettings(s);
  }

  // Filter shipments by date range
  const filtered = useMemo(() => {
    if (range === "all") return shipments;
    const from = range === "30d" ? thirtyDaysAgo : new Date(customFrom+"T00:00:00");
    const to   = range === "custom" ? new Date(customTo+"T23:59:59") : today;
    return shipments.filter(s => {
      const d = new Date(s.created_at);
      return d >= from && d <= to;
    });
  }, [shipments, range, customFrom, customTo]);

  // Compute metrics
  const metrics = useMemo(() => {
    const purchased  = filtered.filter(s => ["complete","pending_leadsonline","pending_payment"].includes(s.stage));
    const returned   = filtered.filter(s => s.stage === "returned");
    const received   = filtered.filter(s => ["received","inspected","pending_response"].includes(s.stage));
    const outbound   = filtered.filter(s => s.stage === "outbound_complete");
    const kits       = filtered.filter(s => s.stage === "outbound_complete" && s.shipping_type === "kit");

    const revenue    = purchased.reduce((sum,s) => sum + (parseFloat(s.appraised_value)||0), 0);
    const projectedOutbound = outbound.reduce((sum,s) => {
      const parts = String(s.estimate||"").replace(/[$,]/g,"").split(/[–\-]/).map(p=>parseFloat(p.trim())).filter(n=>!isNaN(n));
      return sum + (parts.length ? Math.max(...parts) : 0);
    }, 0);
    const projectedReceived = received.reduce((sum,s) => {
      const parts = String(s.estimate||"").replace(/[$,]/g,"").split(/[–\-]/).map(p=>parseFloat(p.trim())).filter(n=>!isNaN(n));
      return sum + (parts.length ? Math.max(...parts) : 0);
    }, 0);
    const purchaseCosts = purchased.reduce((sum,s) => sum + (parseFloat(s.purchase_price)||0), 0);
    const inboundTotal  = (purchased.length + returned.length + received.length) * Number(inboundCost);
    const outboundTotal = kits.length * Number(outboundCost);

    // Ad spend for range
    let adSpend = 0;
    if (range === "all") {
      adSpend = adSpendEntries.reduce((sum,e) => sum + (parseFloat(e.amount)||0), 0);
    } else {
      const from = range === "30d" ? thirtyDaysAgo : new Date(customFrom+"T00:00:00");
      const to   = range === "custom" ? new Date(customTo+"T23:59:59") : today;
      adSpend = adSpendEntries.filter(e => {
        const d = new Date(e.month+"-01");
        return d >= new Date(from.getFullYear(), from.getMonth(), 1) &&
               d <= new Date(to.getFullYear(), to.getMonth(), 1);
      }).reduce((sum,e) => sum + (parseFloat(e.amount)||0), 0);
    }

    const totalCosts = purchaseCosts + inboundTotal + outboundTotal + adSpend;
    const grossProfit = revenue - purchaseCosts - inboundTotal - outboundTotal;
    const netProfit   = grossProfit - adSpend;

    // Stage counts
    const stageCounts = {};
    filtered.forEach(s => { stageCounts[s.stage] = (stageCounts[s.stage]||0)+1; });

    const completeCount = purchased.length + returned.length;
    const marginPerPurchase = purchased.length > 0 ? (revenue - purchaseCosts) / purchased.length : 0;
    const marginPerComplete = completeCount > 0 ? (revenue - purchaseCosts) / completeCount : 0;

    return { revenue, purchaseCosts, inboundTotal, outboundTotal, adSpend, totalCosts, grossProfit, netProfit, stageCounts,
      purchasedCount: purchased.length, returnedCount: returned.length, receivedCount: received.length,
      outboundCount: outbound.length, kitsCount: kits.length, completeCount,
      marginPerPurchase, marginPerComplete };
  }, [filtered, inboundCost, outboundCost, adSpendEntries]);

  // KPI card component
  function KPI({label, value, sub, color, big}) {
    return <div style={{background:"#fff",borderRadius:10,padding:"16px 20px",border:`1px solid ${G.border}`,flex:1,minWidth:140}}>
      <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{label}</div>
      <div style={{fontSize:big?28:22,fontWeight:700,color:color||G.text,fontFamily:"monospace"}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:G.muted,marginTop:4}}>{sub}</div>}
    </div>;
  }

  // Pipeline bar chart
  const PIPELINE_STAGES = [
    {key:"ready_to_fulfill", label:"Fulfill"},
    {key:"outbound_complete", label:"Outbound"},
    {key:"received", label:"Received"},
    {key:"inspected", label:"Inspected"},
    {key:"complete", label:"Complete"},
    {key:"purchased", label:"Purchased"},
    {key:"returned", label:"Returned"},
    {key:"dead", label:"Dead"},
  ];
  const maxCount = Math.max(...PIPELINE_STAGES.map(s => metrics.stageCounts[s.key]||0), 1);

  return <div style={{flex:1,overflow:"auto",padding:20,display:"flex",flexDirection:"column",gap:20}}>

    {/* Date range selector */}
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <div style={{fontSize:13,fontWeight:700,color:G.text}}>Period:</div>
      {[["all","All Time"],["30d","Last 30 Days"],["custom","Custom"]].map(([v,l])=>
        <button key={v} onClick={()=>setRange(v)} style={{padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
          background:range===v?G.gold:"transparent",color:range===v?"#fff":G.muted,
          border:`1px solid ${range===v?G.gold:G.border}`}}>{l}</button>
      )}
      {range==="custom"&&<>
        <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${G.border}`,fontSize:12}}/>
        <span style={{fontSize:12,color:G.muted}}>to</span>
        <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${G.border}`,fontSize:12}}/>
      </>}
      <div style={{flex:1}}/>
      <button onClick={()=>setShowSettings(s=>!s)} style={{padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
        background:showSettings?G.dark:"transparent",color:showSettings?"#fff":G.muted,border:`1px solid ${showSettings?G.dark:G.border}`}}>
        ⚙ Settings
      </button>
    </div>

    {/* Settings panel */}
    {showSettings&&<div style={{background:"#fff",borderRadius:10,padding:20,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:16}}>
      <div style={{fontSize:12,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Cost Settings</div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:11,color:G.muted,marginBottom:4}}>Inbound shipping cost per package ($)</div>
          <input type="number" value={inboundCost} onChange={e=>setInboundCost(e.target.value)}
            onBlur={()=>saveSettings({inboundCost})}
            style={{width:100,padding:"6px 10px",borderRadius:6,border:`1px solid ${G.border}`,fontSize:14,fontWeight:700}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:G.muted,marginBottom:4}}>Outbound kit shipping cost ($)</div>
          <input type="number" value={outboundCost} onChange={e=>setOutboundCost(e.target.value)}
            onBlur={()=>saveSettings({outboundCost})}
            style={{width:100,padding:"6px 10px",borderRadius:6,border:`1px solid ${G.border}`,fontSize:14,fontWeight:700}}/>
        </div>
      </div>
      <div>
        <div style={{fontSize:12,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Ad Spend by Month</div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
          <input type="month" value={adSpendInput.month} onChange={e=>setAdSpendInput(p=>({...p,month:e.target.value}))}
            style={{padding:"5px 8px",borderRadius:6,border:`1px solid ${G.border}`,fontSize:12}}/>
          <span style={{fontSize:12,color:G.muted}}>$</span>
          <input type="number" value={adSpendInput.amount} onChange={e=>setAdSpendInput(p=>({...p,amount:e.target.value}))}
            placeholder="e.g. 1800" style={{width:100,padding:"5px 8px",borderRadius:6,border:`1px solid ${G.border}`,fontSize:12}}/>
          <button onClick={()=>{
            if(!adSpendInput.amount) return;
            const updated = [...adSpendEntries.filter(e=>e.month!==adSpendInput.month), {month:adSpendInput.month, amount:parseFloat(adSpendInput.amount)}]
              .sort((a,b)=>a.month.localeCompare(b.month));
            setAdSpendEntries(updated); saveSettings({adSpendEntries:updated});
            setAdSpendInput(p=>({...p,amount:""}));
          }} style={{padding:"5px 14px",borderRadius:6,background:G.gold,color:"#fff",border:"none",fontSize:12,fontWeight:600,cursor:"pointer"}}>Save</button>
        </div>
        {adSpendEntries.length>0&&<table style={{fontSize:12,borderCollapse:"collapse",width:"100%",maxWidth:300}}>
          <thead><tr><th style={{textAlign:"left",color:G.muted,fontWeight:600,padding:"4px 8px"}}>Month</th><th style={{textAlign:"right",color:G.muted,fontWeight:600,padding:"4px 8px"}}>Amount</th><th/></tr></thead>
          <tbody>{adSpendEntries.map(e=><tr key={e.month}>
            <td style={{padding:"3px 8px",color:G.text}}>{e.month}</td>
            <td style={{padding:"3px 8px",color:G.text,textAlign:"right",fontWeight:600}}>{fmt$(e.amount)}</td>
            <td style={{padding:"3px 8px"}}><button onClick={()=>{
              const updated=adSpendEntries.filter(x=>x.month!==e.month);
              setAdSpendEntries(updated); saveSettings({adSpendEntries:updated});
            }} style={{background:"none",border:"none",color:G.muted,cursor:"pointer",fontSize:11}}>✕</button></td>
          </tr>)}</tbody>
        </table>}
      </div>
    </div>}

    {/* Row 1: Revenue strip */}
    <div>
      <div style={{fontSize:11,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Revenue</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <KPI label="Estimated Revenue" value={fmt$(metrics.revenue)} sub={`${metrics.purchasedCount} purchased`} color={G.green}/>
        <KPI label="Purchase Costs" value={fmt$(metrics.purchaseCosts)} sub={`Paid to ${metrics.purchasedCount} customers`} color={G.red}/>
        <KPI label="Gross Margin" value={fmt$(metrics.revenue - metrics.purchaseCosts)} sub="Revenue − Purchase Costs" color={metrics.revenue-metrics.purchaseCosts>=0?G.green:G.red}/>
        <KPI label="Margin / Purchase" value={fmt$(metrics.marginPerPurchase)} sub={`÷ ${metrics.purchasedCount} purchased`} color={G.teal}/>
        <KPI label="Margin / Complete" value={fmt$(metrics.marginPerComplete)} sub={`÷ ${metrics.completeCount} complete`} color={G.blue}/>
      </div>
    </div>

    {/* Row 2: Operating costs */}
    <div>
      <div style={{fontSize:11,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Operating Costs</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <KPI label="Ad Spend" value={fmt$(metrics.adSpend)} sub="Manual entry" color={G.purple}/>
        <KPI label="Outbound (Kits)" value={fmt$(metrics.outboundTotal)} sub={`${metrics.kitsCount} kits × $${outboundCost}`} color={G.orange}/>
        <KPI label="Inbound Shipping" value={fmt$(metrics.inboundTotal)} sub={`${metrics.purchasedCount+metrics.returnedCount+metrics.receivedCount} packages × $${inboundCost}`} color={G.orange}/>
      </div>
    </div>

    {/* Row 3: Profit */}
    <div>
      <div style={{fontSize:11,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Profit</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <KPI label="Gross Profit" value={fmt$(metrics.grossProfit)} sub="Revenue − Purchase − Shipping" color={metrics.grossProfit>=0?G.green:G.red} big/>
        <KPI label="Net Profit" value={fmt$(metrics.netProfit)} sub="Gross Profit − Ad Spend" color={metrics.netProfit>=0?G.green:G.red} big/>
        <KPI label="Total Costs" value={fmt$(metrics.totalCosts)} sub="All costs combined" color={G.red}/>
      </div>
    </div>

    {/* Pipeline */}
    <div>
      <div style={{fontSize:11,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Pipeline</div>
      <div style={{background:"#fff",borderRadius:10,padding:20,border:`1px solid ${G.border}`}}>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {PIPELINE_STAGES.map(({key,label})=>{
            const count = metrics.stageCounts[key]||0;
            const pct = Math.round((count/maxCount)*100);
            const color = SC[key]||G.muted;
            return <div key={key} style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:90,fontSize:11,color:G.muted,textAlign:"right",flexShrink:0}}>{label}</div>
              <div style={{flex:1,background:G.bg,borderRadius:4,height:20,overflow:"hidden"}}>
                <div style={{width:pct+"%",height:"100%",background:color,borderRadius:4,transition:"width 0.3s",minWidth:count>0?4:0}}/>
              </div>
              <div style={{width:28,fontSize:12,fontWeight:700,color:color,flexShrink:0}}>{count}</div>
            </div>;
          })}
        </div>
      </div>
    </div>

    {/* Kit vs Label cohort comparison */}
    <CohortComparison shipments={shipments} fmt$={fmt$} fmtN={fmtN}/>

  </div>;
}

// ══════════════════════════════════════════════════════════
// COHORT COMPARISON WIDGET — kit vs label vs usps
// ══════════════════════════════════════════════════════════

function CohortComparison({shipments, fmt$, fmtN}) {
  // Default sent date range: 90 days ago → today
  const [sentFrom, setSentFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate()-90);
    return d.toISOString().slice(0,10);
  });
  const [sentTo, setSentTo] = useState(() => new Date().toISOString().slice(0,10));
  // Default return date range: same window, but receive_at can be empty (filter will OR-include nulls)
  const [retFrom, setRetFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate()-90);
    return d.toISOString().slice(0,10);
  });
  const [retTo, setRetTo] = useState(() => new Date().toISOString().slice(0,10));
  const [retOnly, setRetOnly] = useState(false); // if false, return-date filter is optional (only filters returned items)

  const cohorts = useMemo(() => {
    const sentFromDate = new Date(sentFrom + "T00:00:00");
    const sentToDate = new Date(sentTo + "T23:59:59");
    const retFromDate = new Date(retFrom + "T00:00:00");
    const retToDate = new Date(retTo + "T23:59:59");

    // A shipment was "sent" when it transitioned to outbound_complete.
    // We don't store that timestamp specifically, so use created_at as proxy
    // for fulfilment date (most shipments are fulfilled within hours of being created).
    function shipmentSentDate(s) {
      return s.sent_at ? new Date(s.sent_at) : (s.created_at ? new Date(s.created_at) : null);
    }
    function shipmentReceivedDate(s) {
      return s.received_at ? new Date(s.received_at) : null;
    }

    // Filter shipments by sent date window
    const inSentWindow = shipments.filter(s => {
      // Only include shipments that actually got sent (any stage past ready_to_fulfill)
      const wasSent = ["outbound_complete","received","inspected","pending_response","pending_payment","pending_leadsonline","complete","returned"].includes(s.stage);
      if (!wasSent) return false;
      const d = shipmentSentDate(s);
      return d && d >= sentFromDate && d <= sentToDate;
    });

    // Group by shipping_type
    const groups = {kit: [], label: [], usps: []};
    inSentWindow.forEach(s => {
      const type = String(s.shipping_type || "").toLowerCase().trim();
      if (type === "kit") groups.kit.push(s);
      else if (type === "label") groups.label.push(s);
      else if (type === "usps") groups.usps.push(s);
    });

    // For each group, compute: sent, received-back (within return window if filter active), purchased, totals
    function compute(group) {
      const sent = group.length;
      // Items that came back: received_at within return window
      // If retOnly is on, MUST have a received_at AND it must be in the window
      // If retOnly is off, count any item that has reached received-or-beyond stage AND if it has received_at, that date must be in window
      const cameBack = group.filter(s => {
        const isReceivedOrBeyond = ["received","inspected","pending_response","pending_payment","pending_leadsonline","complete","returned"].includes(s.stage);
        if (!isReceivedOrBeyond) return false;
        const r = shipmentReceivedDate(s);
        if (retOnly) {
          return r && r >= retFromDate && r <= retToDate;
        } else {
          // If we have a received_at timestamp, honor the filter; if missing, still count the shipment
          if (!r) return true;
          return r >= retFromDate && r <= retToDate;
        }
      });
      const purchased = cameBack.filter(s => ["complete","pending_leadsonline","pending_payment"].includes(s.stage));
      const returned  = cameBack.filter(s => s.stage === "returned");
      const totalPurchaseValue = purchased.reduce((sum,s) => sum + (parseFloat(s.purchase_price)||0), 0);
      const totalAppraisedValue = purchased.reduce((sum,s) => sum + (parseFloat(s.appraised_value)||0), 0);
      const avgPurchase = purchased.length > 0 ? totalPurchaseValue / purchased.length : 0;
      return {
        sent, received: cameBack.length, purchased: purchased.length, returned: returned.length,
        receiveRate: sent > 0 ? (cameBack.length / sent) : 0,
        purchaseRate: cameBack.length > 0 ? (purchased.length / cameBack.length) : 0,
        avgPurchase, totalPurchaseValue, totalAppraisedValue,
      };
    }

    return {
      kit: compute(groups.kit),
      label: compute(groups.label),
      usps: compute(groups.usps),
    };
  }, [shipments, sentFrom, sentTo, retFrom, retTo, retOnly]);

  // Detect interesting findings to surface as a banner
  const insight = useMemo(() => {
    const k = cohorts.kit, l = cohorts.label;
    if (k.sent < 5 || l.sent < 5) return null; // not enough data
    const rateGap = Math.abs(k.receiveRate - l.receiveRate);
    if (rateGap < 0.05) {
      return {type:"warn", text:`⚠️ Receive-back rates are within ${(rateGap*100).toFixed(1)}% of each other (kit ${(k.receiveRate*100).toFixed(1)}% vs label ${(l.receiveRate*100).toFixed(1)}%) — kit is not driving more conversions.`};
    } else if (k.receiveRate > l.receiveRate + 0.05) {
      return {type:"good", text:`✓ Kits convert ${((k.receiveRate-l.receiveRate)*100).toFixed(1)}% better than labels (${(k.receiveRate*100).toFixed(1)}% vs ${(l.receiveRate*100).toFixed(1)}%) — kit cost is earning its keep.`};
    } else {
      return {type:"surprise", text:`⚠️ Labels convert ${((l.receiveRate-k.receiveRate)*100).toFixed(1)}% better than kits (${(l.receiveRate*100).toFixed(1)}% vs ${(k.receiveRate*100).toFixed(1)}%) — kit is hurting more than helping.`};
    }
  }, [cohorts]);

  const Cell = ({val, sub, color}) => <td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:color||G.text, textAlign:"right"}}>
    <div style={{fontWeight:600}}>{val}</div>
    {sub && <div style={{fontSize:11, color:G.muted, marginTop:2}}>{sub}</div>}
  </td>;

  const HeaderCell = ({children}) => <th style={{padding:"10px 12px", textAlign:"right", fontSize:11, color:G.muted, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase"}}>{children}</th>;

  return <div>
    <div style={{fontSize:11,fontWeight:700,color:G.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Kit vs Label Cohort Comparison</div>
    <div style={{background:"#fff",borderRadius:10,padding:20,border:`1px solid ${G.border}`}}>

      {/* Date filters */}
      <div style={{display:"flex",flexWrap:"wrap",gap:16,marginBottom:16,alignItems:"flex-end"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.05em",textTransform:"uppercase",marginBottom:4}}>Sent date</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <input type="date" value={sentFrom} onChange={e=>setSentFrom(e.target.value)} style={{padding:"5px 7px",border:`1px solid ${G.border}`,borderRadius:5,fontSize:12,background:G.bg}}/>
            <span style={{color:G.muted,fontSize:11}}>to</span>
            <input type="date" value={sentTo} onChange={e=>setSentTo(e.target.value)} style={{padding:"5px 7px",border:`1px solid ${G.border}`,borderRadius:5,fontSize:12,background:G.bg}}/>
          </div>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.05em",textTransform:"uppercase",marginBottom:4}}>Return date</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <input type="date" value={retFrom} onChange={e=>setRetFrom(e.target.value)} style={{padding:"5px 7px",border:`1px solid ${G.border}`,borderRadius:5,fontSize:12,background:G.bg}}/>
            <span style={{color:G.muted,fontSize:11}}>to</span>
            <input type="date" value={retTo} onChange={e=>setRetTo(e.target.value)} style={{padding:"5px 7px",border:`1px solid ${G.border}`,borderRadius:5,fontSize:12,background:G.bg}}/>
          </div>
        </div>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:G.text,cursor:"pointer"}}>
          <input type="checkbox" checked={retOnly} onChange={e=>setRetOnly(e.target.checked)} style={{margin:0}}/>
          Strict return-date filter
        </label>
      </div>

      {/* Insight banner */}
      {insight && <div style={{
        marginBottom:14, padding:"10px 14px", borderRadius:8, fontSize:13, fontWeight:500,
        background: insight.type==="warn" ? "#FFF8E6" : insight.type==="good" ? "#F0FFF4" : "#FFF0F0",
        color:    insight.type==="warn" ? "#8B6F00" : insight.type==="good" ? G.green     : G.red,
        border:`1px solid ${insight.type==="warn" ? "#FFE082" : insight.type==="good" ? G.green+"30" : G.red+"30"}`
      }}>{insight.text}</div>}

      {/* Comparison table */}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:G.bg}}>
              <th style={{padding:"10px 12px", textAlign:"left", fontSize:11, color:G.muted, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase"}}>Metric</th>
              <HeaderCell>Kit</HeaderCell>
              <HeaderCell>Label</HeaderCell>
              <HeaderCell>USPS</HeaderCell>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{padding:"10px 12px", fontSize:13, color:G.text, fontWeight:500}}>Sent</td>
              <Cell val={fmtN(cohorts.kit.sent)}/>
              <Cell val={fmtN(cohorts.label.sent)}/>
              <Cell val={fmtN(cohorts.usps.sent)}/>
            </tr>
            <tr><td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:G.text, fontWeight:500}}>Received back</td>
              <Cell val={fmtN(cohorts.kit.received)} sub={cohorts.kit.sent>0?(cohorts.kit.receiveRate*100).toFixed(1)+"%":"—"}/>
              <Cell val={fmtN(cohorts.label.received)} sub={cohorts.label.sent>0?(cohorts.label.receiveRate*100).toFixed(1)+"%":"—"}/>
              <Cell val={fmtN(cohorts.usps.received)} sub={cohorts.usps.sent>0?(cohorts.usps.receiveRate*100).toFixed(1)+"%":"—"}/>
            </tr>
            <tr><td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:G.text, fontWeight:500}}>Purchased</td>
              <Cell val={fmtN(cohorts.kit.purchased)} sub={cohorts.kit.received>0?(cohorts.kit.purchaseRate*100).toFixed(0)+"% of received":"—"} color={G.green}/>
              <Cell val={fmtN(cohorts.label.purchased)} sub={cohorts.label.received>0?(cohorts.label.purchaseRate*100).toFixed(0)+"% of received":"—"} color={G.green}/>
              <Cell val={fmtN(cohorts.usps.purchased)} sub={cohorts.usps.received>0?(cohorts.usps.purchaseRate*100).toFixed(0)+"% of received":"—"} color={G.green}/>
            </tr>
            <tr><td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:G.text, fontWeight:500}}>Returned</td>
              <Cell val={fmtN(cohorts.kit.returned)}/>
              <Cell val={fmtN(cohorts.label.returned)}/>
              <Cell val={fmtN(cohorts.usps.returned)}/>
            </tr>
            <tr><td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:G.text, fontWeight:500}}>Avg purchase</td>
              <Cell val={fmt$(cohorts.kit.avgPurchase)}/>
              <Cell val={fmt$(cohorts.label.avgPurchase)}/>
              <Cell val={fmt$(cohorts.usps.avgPurchase)}/>
            </tr>
            <tr><td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:G.text, fontWeight:500}}>Total $ paid</td>
              <Cell val={fmt$(cohorts.kit.totalPurchaseValue)}/>
              <Cell val={fmt$(cohorts.label.totalPurchaseValue)}/>
              <Cell val={fmt$(cohorts.usps.totalPurchaseValue)}/>
            </tr>
            <tr><td style={{padding:"10px 12px", borderTop:`1px solid ${G.border}`, fontSize:13, color:G.text, fontWeight:500}}>Total $ appraised</td>
              <Cell val={fmt$(cohorts.kit.totalAppraisedValue)} color={G.gold}/>
              <Cell val={fmt$(cohorts.label.totalAppraisedValue)} color={G.gold}/>
              <Cell val={fmt$(cohorts.usps.totalAppraisedValue)} color={G.gold}/>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{marginTop:14,fontSize:11,color:G.muted,lineHeight:1.5}}>
        <strong>How to read this:</strong> "Sent" = shipments fulfilled in the sent-date window. "Received back" = of those, how many came back (received/inspected/offer_made/purchased/returned stages). "Strict return-date filter" requires the received_at timestamp to fall in the return window — useful for measuring return velocity within a defined window. Without it, items missing received_at still count.
      </div>
    </div>
  </div>;
}

export default function SnappyGoldCRM() {
  const isMobile=useIsMobile();
  const [unlocked,setUnlocked]=useState(false);
  const [customers,setCustomers]=useState([]);
  const [shipments,setShipments]=useState([]);
  const [contactLogs,setContactLogs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [lastLoaded,setLastLoaded]=useState(null);
  const [error,setError]=useState(null);
  const [tab,setTab]=useState("fulfill");
  const [showManualEntry,setShowManualEntry]=useState(false);
  const [tsFlash,setTsFlash]=useState(false);

  // Auto-refresh every 5 minutes when tab is visible
  useEffect(()=>{
    const interval = setInterval(()=>{
      if(!document.hidden) {
        loadData(true).then(()=>{ setTsFlash(true); setTimeout(()=>setTsFlash(false), 1200); });
      }
    }, 5 * 60 * 1000);
    return ()=>clearInterval(interval);
  },[]);

  async function loadData(force=false){
    // Always show cache immediately as placeholder while fetching fresh data
    const cache=getCache();
    if(cache){setCustomers(cache.customers||[]);setShipments(cache.shipments||[]);setContactLogs(cache.contactLogs||[]);setLastLoaded(cache._ts);}
    setLoading(true); setError(null);
    try {
      // PERF PATCH (May 19): use getShipmentsLite to skip attribution join on initial load.
      // Cuts load from ~5-6s → ~1s. Attribution loads lazily when a shipment detail opens.
      const [cr,sr,lr]=await Promise.all([apiFetch({action:"getCustomers"}),apiFetch({action:"getShipmentsLite"}),apiFetch({action:"getContactLog"})]);
      const c=Array.isArray(cr)?cr:[]; const s=Array.isArray(sr)?sr:[]; const l=Array.isArray(lr)?lr:[];
      setCustomers(c); setShipments(s); setContactLogs(l); setLastLoaded(Date.now());
      if(c.length||s.length) setCache({customers:c,shipments:s,contactLogs:l});
    } catch(e){setError("Failed to load: "+e.message);}
    setLoading(false);
  }

  useEffect(()=>{if(unlocked) loadData();},[unlocked]);

  // Active customer emails (those with non-estimate_only shipments)
  const activeCustomerEmails=useMemo(()=>{
    const emails=new Set();
    const active=shipments.filter(s=>["ready_to_fulfill","outbound_complete","received","inspected","pending_response","pending_payment","pending_leadsonline"].includes(s.stage));
    const custById={};customers.forEach(c=>{custById[c.customer_id]=c;});
    active.forEach(s=>{const c=custById[s.customer_id];if(c&&c.email)emails.add(String(c.email).toLowerCase());});
    return emails;
  },[shipments,customers]);

  function handleUpdate(updatedShipment,updatedCustomer){
    setShipments(prev=>prev.map(s=>s.shipment_id===updatedShipment.shipment_id?updatedShipment:s));
    if(updatedCustomer) setCustomers(prev=>prev.map(c=>c.customer_id===updatedCustomer.customer_id?{...c,...updatedCustomer}:c));
    const cache=getCache();
    if(cache) setCache({...cache,shipments:cache.shipments.map(s=>s.shipment_id===updatedShipment.shipment_id?updatedShipment:s),customers:updatedCustomer?cache.customers.map(c=>c.customer_id===updatedCustomer.customer_id?{...c,...updatedCustomer}:c):cache.customers});
  }

  function handleNewShipment(newShipment){
    setShipments(prev=>[newShipment,...prev]);
    const cache=getCache();
    if(cache) setCache({...cache,shipments:[newShipment,...cache.shipments]});
  }

  const TABS=[{id:"fulfill",label:"Fulfill",color:G.purple},{id:"outbound",label:"Outbound",color:G.purple},{id:"received",label:"Received",color:G.teal},{id:"complete",label:"Complete",color:G.green},{id:"urgent",label:"Urgent",color:G.red},{id:"leads",label:"Incomplete Leads",color:G.orange},{id:"sales",label:"Sales",color:G.green},{id:"customers",label:"Customers",color:G.blue},{id:"analytics",label:"Analytics",color:G.gold}];
  const [followUpCount,setFollowUpCount]=useState(0);

  const fulfillCount=shipments.filter(s=>s.stage==="ready_to_fulfill").length;
  const outboundCount=shipments.filter(s=>OUTBOUND_STAGES.includes(s.stage)).length;
  const receivedCount=shipments.filter(s=>RECEIVED_STAGES.includes(s.stage)).length;
  const completeCount=shipments.filter(s=>COMPLETE_STAGES.includes(s.stage)).length;
  const urgentCount=shipments.filter(s=>s.is_urgent==="true"||s.is_urgent===true).length;

  if(!unlocked) return <PinGate onUnlock={()=>setUnlocked(true)}/>;

  return <div style={{height:"100vh",display:"flex",flexDirection:"column",background:G.bg,fontFamily:"'Georgia','Times New Roman',serif",color:G.text}}>
    {/* Top bar */}
    <div style={{background:G.dark,borderBottom:`2px solid ${G.gold}44`,padding:"0 12px",display:"flex",alignItems:"center",gap:8,height:48,flexShrink:0}}>
      <div style={{color:G.gold,fontWeight:700,fontSize:16,letterSpacing:"0.08em",flexShrink:0}}>SNAPPY<span style={{color:G.cream}}>.GOLD</span></div>
      <div style={{color:G.muted,fontSize:11,flexShrink:0,display:isMobile?"none":"block"}}>CRM v5</div>
      <div style={{flex:1}}/>
      {error&&<div style={{color:G.red,fontSize:11}}>{error}</div>}
      {lastLoaded&&<div style={{color:tsFlash?G.gold:G.muted,fontSize:11,fontWeight:tsFlash?700:400,transition:"color 0.3s, font-weight 0.3s"}}>Loaded {new Date(lastLoaded).toLocaleTimeString()}</div>}
      <button onClick={()=>loadData(true)} disabled={loading} style={{background:"transparent",color:G.muted,border:`1px solid #444`,borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:loading?"not-allowed":"pointer"}}>{loading?"Loading…":"⟳ Refresh"}</button>
      <button onClick={()=>setShowManualEntry(true)} style={{background:G.gold,color:"#1A1816",border:"none",borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ New Entry</button>
    </div>
    {showManualEntry&&<ManualEntryModal onSaved={()=>{setShowManualEntry(false);loadData(true);}} onClose={()=>setShowManualEntry(false)}/>}

    {/* Tab bar */}
    <div style={{background:"#fff",borderBottom:`1px solid ${G.border}`,padding:"0 16px",display:"flex",gap:0,flexShrink:0,overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none"}}>
      {TABS.map(t=>{
        const count=t.id==="fulfill"?fulfillCount:t.id==="outbound"?outboundCount:t.id==="received"?receivedCount:t.id==="complete"?completeCount:t.id==="urgent"?urgentCount:t.id==="leads"?followUpCount:t.id==="customers"?customers.length:null;
        const active=tab===t.id;
        return <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"12px 20px",background:"none",border:"none",borderBottom:active?`3px solid ${t.color}`:"3px solid transparent",color:active?t.color:G.muted,fontWeight:active?700:400,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6,transition:"all 0.15s",fontFamily:"inherit"}}>
          {t.label}
          {count!==null&&count>0&&<span style={{background:active?t.color+"22":"#F0EAE0",color:active?t.color:G.muted,borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{count}</span>}
        </button>;
      })}
    </div>

    {/* Tab content */}
    <div style={{flex:1,display:"flex",overflow:"hidden"}}>
      {tab==="fulfill"  &&<FulfillTab   shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="outbound" &&<OutboundTab  shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="received" &&<ReceivedTab  shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="complete" &&<CompleteTab  shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="urgent"   &&<UrgentTab    shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="leads"    &&<LeadsTab     activeCustomerEmails={activeCustomerEmails} onCountChange={setFollowUpCount}/>}
      {tab==="customers"&&<CustomersTab customers={customers} shipments={shipments} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="sales"    &&<SalesTab     shipments={shipments} customers={customers}/>}
      {tab==="analytics"&&<AnalyticsTab shipments={shipments} customers={customers}/>}
    </div>
  </div>;
}
