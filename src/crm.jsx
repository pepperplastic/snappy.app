import { useState, useEffect, useMemo, useRef } from "react";

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
  "received", "inspected", "offer_made",
  "accepted", "rejected", "purchase_complete", "return_complete", "dead"
];

const SL = {
  estimate_only:     "Estimate Only",
  ready_to_fulfill:  "Ready to Fulfill",
  outbound_complete: "Outbound Complete",
  received:          "Received",
  inspected:         "Inspected",
  offer_made:        "Offer Made",
  accepted:          "Accepted",
  rejected:          "Rejected",
  purchase_complete: "Purchased ✓",
  return_complete:   "Returned",
  dead:              "Dead",
};

const SC = {
  estimate_only:     "#9E9E9E",
  ready_to_fulfill:  "#6A1B9A",
  outbound_complete: "#2E7D32",
  received:          "#00695C",
  inspected:         "#00838F",
  offer_made:        "#F57F17",
  accepted:          "#2E7D32",
  rejected:          "#B71C1C",
  purchase_complete: "#1B5E20",
  return_complete:   "#546E7A",
  dead:              "#9E9E9E",
};

const FULFILL_STAGES  = ["ready_to_fulfill"];
const PROCESS_STAGES  = ["outbound_complete","inspected","offer_made","accepted"];
const RECEIVED_STAGES = ["received"];
const PURCHASED_STAGES = ["purchase_complete"];

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
            <Sel label="Shipping Type" value={s.shipping_type} onChange={e=>updS("shipping_type",e.target.value)} options={[{value:"",label:"—"},{value:"kit",label:"Kit"},{value:"label",label:"Label"}]}/>
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
    try { await apiPost({action:"addContactLog",data:{customer_id:shipment.customer_id,type,notes}}); onSave({type,notes,timestamp:new Date().toISOString()}); }
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
        <Sel label="Shipping Type" value={shippingType} onChange={e=>setShippingType(e.target.value)} options={[{value:"kit",label:"Kit (mail kit to customer)"},{value:"label",label:"Label (email FedEx label)"}]}/>
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


// ══════════════════════════════════════════════════════════
// CUSTOMER HISTORY (inline in detail pane)
// ══════════════════════════════════════════════════════════

function CustomerHistory({shipment,allShipments,allCustomers}) {
  if(!shipment||!allShipments) return null;
  const others=allShipments.filter(s=>s.customer_id===shipment.customer_id&&s.shipment_id!==shipment.shipment_id);
  if(others.length===0) return null;
  const sorted=[...others].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return <div style={{marginTop:16,background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`}}>
    <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Customer History ({others.length} other shipment{others.length!==1?"s":""})</div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {sorted.map(s=>{
        const high=parseEstHigh(s.estimate);
        return <div key={s.shipment_id} style={{display:"flex",gap:10,alignItems:"center",fontSize:12,padding:"6px 8px",borderRadius:6,background:G.bg}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:600,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.item||"(no item)"}</div>
            <div style={{fontSize:10,color:G.muted,marginTop:2}}>{s.shipment_id} · {s.created_at?new Date(s.created_at).toLocaleDateString():""}</div>
          </div>
          {high>0&&<div style={{color:G.gold,fontWeight:700,flexShrink:0}}>{fmt$(high)}</div>}
          <Badge stage={s.stage} sm/>
          {s.purchase_price&&<div style={{color:G.green,fontWeight:700,fontSize:11,flexShrink:0}}>paid {fmt$(s.purchase_price)}</div>}
        </div>;
      })}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════════
// SHIPMENT ROW (left pane list item)
// ══════════════════════════════════════════════════════════

function ShipmentRow({shipment,customer,selected,onClick,onCheck,checked}) {
  const high=parseEstHigh(shipment.estimate);
  const ds=daysSince(shipment.created_at);
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
          <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shipment.item||"(no item)"}</div>
          <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center",flexWrap:"wrap"}}>
            {shipment.stage==="ready_to_fulfill"&&shipment.shipping_type==="label"
              ? <span style={{background:G.blue+"18",color:G.blue,border:`1px solid ${G.blue}33`,borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>Ready to Fulfill</span>
              : <Badge stage={shipment.stage} sm/>}
            {ds!==null&&<span style={{fontSize:10,color:G.muted}}>{ds}d ago</span>}
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

function DetailPane({shipment,customer,contactLogs,allShipments,allCustomers,onUpdate,onNewShipment,onClose}) {
  const [modal,setModal]=useState(null);
  const [localLogs,setLocalLogs]=useState(contactLogs||[]);
  const [photos,setPhotos]=useState([]);
  const [photosLoading,setPhotosLoading]=useState(false);

  useEffect(()=>{
    if(!shipment) return;
    setPhotos([]);
    setPhotosLoading(true);
    apiFetch({action:"getPhotos",shipment_id:shipment.shipment_id})
      .then(res=>{ setPhotos(Array.isArray(res)?res:[]); setPhotosLoading(false); })
      .catch(()=>setPhotosLoading(false));
  },[shipment?.shipment_id]);

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
      case "inspected": return [{label:"→ Offer Made",v:"orange",stage:"offer_made"}];
      case "offer_made": return [{label:"→ Accepted",v:"green",stage:"accepted"},{label:"→ Rejected",v:"danger",stage:"rejected"}];
      case "accepted": return [{label:"→ Purchased ✓",v:"green",stage:"purchase_complete"}];
      default: return [];
    }
  }

  async function quickStage(stage){
    try { await apiPost({action:"updateShipment",shipment_id:shipment.shipment_id,updates:{stage}}); onUpdate({...shipment,stage}); }
    catch(e){alert("Failed: "+e.message);}
  }

  function Field({label,value,mono}){
    if(!value) return null;
    return <div>
      <div style={{fontSize:10,fontWeight:700,color:G.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{label}</div>
      <div style={{fontSize:13,color:G.text,fontFamily:mono?"monospace":"inherit",wordBreak:"break-all"}}>{value}</div>
    </div>;
  }

  const actions=getActions();

  return <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {/* Header */}
    <div style={{padding:"16px 20px",borderBottom:`1px solid ${G.border}`,background:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <Avatar name={customer?.name} size={44}/>
          <div>
            <div style={{fontWeight:700,fontSize:17,color:G.text}}>{customer?.name||"(no name)"}</div>
            <div style={{fontSize:12,color:G.muted,marginTop:1}}>{customer?.email}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
          {customer?.phone&&<><a href={`tel:${customer.phone}`} style={{textDecoration:"none"}}><Btn v="green" small>📞 Call</Btn></a><a href={`sms:${customer.phone}`} style={{textDecoration:"none"}}><Btn v="blue" small>💬 Text</Btn></a></>}
          {customer?.email&&<a href={`mailto:${customer.email}`} style={{textDecoration:"none"}}><Btn v="ghost" small>✉ Email</Btn></a>}
          <Btn v="ghost" small onClick={onClose}>✕</Btn>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
        <Badge stage={shipment.stage}/>
        <Btn v="ghost" small onClick={()=>setModal("stage")}>Change Stage ↓</Btn>
        {actions.map((a,i)=><Btn key={i} v={a.v} small onClick={()=>a.stage?quickStage(a.stage):setModal(a.action)}>{a.label}</Btn>)}
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
          <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Shipment · {shipment.shipment_id}</div>
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
          {shipment.notes&&<Field label="Notes" value={shipment.notes}/>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Tracking</div>
            {shipment.outbound_tracking?<Field label="Outbound" value={shipment.outbound_tracking} mono/>:<div style={{fontSize:12,color:G.muted}}>No outbound tracking</div>}
            {shipment.return_tracking?<Field label="Return" value={shipment.return_tracking} mono/>:<div style={{fontSize:12,color:G.muted}}>No return tracking</div>}
          </div>
          <div style={{background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase"}}>Customer</div>
            <Field label="Phone" value={fmtPhone(customer?.phone)}/>
            <Field label="Address" value={customer?.address}/>
            <Field label="Source" value={customer?.source}/>
            {customer?.notes&&<Field label="Notes" value={customer.notes}/>}
          </div>
        </div>
      </div>
      {localLogs.length>0&&<div style={{marginTop:16,background:"#fff",borderRadius:10,padding:16,border:`1px solid ${G.border}`}}>
        <div style={{fontSize:11,fontWeight:700,color:G.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Contact Log</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[...localLogs].reverse().map((log,i)=><div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:12}}>
            <span style={{background:G.bg,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700,color:G.muted,flexShrink:0,textTransform:"capitalize"}}>{log.type||"note"}</span>
            <div style={{flex:1,color:G.text}}>{log.notes}</div>
            <div style={{color:G.muted,flexShrink:0,fontSize:10}}>{log.timestamp?new Date(log.timestamp).toLocaleDateString():""}</div>
          </div>)}
        </div>
      </div>}
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
  </div>;
}


// ══════════════════════════════════════════════════════════
// RECEIVED TAB
// ══════════════════════════════════════════════════════════

function ReceivedTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");
  const [binInput,setBinInput]=useState("");
  const [savingBin,setSavingBin]=useState(false);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>s.stage==="received");
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q);});}
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

  return <div style={{flex:1,display:"flex",overflow:"hidden"}}>
    <div style={{width:340,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search received..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
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
                  <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.item||"(no item)"}</div>
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
    {selectedShipment?<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Bin number bar */}
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${G.border}`,background:"#FFF8EE",display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:13,fontWeight:700,color:G.gold}}>Bin Number</div>
        <input value={binInput} onChange={e=>setBinInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveBin()} placeholder="Enter bin #" style={{width:100,background:"#fff",border:`2px solid ${G.gold}`,borderRadius:7,padding:"6px 12px",fontSize:18,fontWeight:700,color:G.gold,outline:"none",textAlign:"center"}}/>
        <Btn v="gold" small onClick={saveBin} disabled={savingBin||binInput===String(selectedShipment.bin_number||"")}>{savingBin?"Saving...":"Save Bin"}</Btn>
        {selectedShipment.bin_number&&<div style={{fontSize:12,color:G.muted}}>Currently: Bin {selectedShipment.bin_number}</div>}
      </div>
      <div style={{flex:1,overflow:"hidden"}}>
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

function PurchasedTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");
  const [binInput,setBinInput]=useState("");
  const [savingBin,setSavingBin]=useState(false);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>s.stage==="purchase_complete");
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q);});}
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

  return <div style={{flex:1,display:"flex",overflow:"hidden"}}>
    <div style={{width:340,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search purchased..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
      </div>
      {totalPurchased>0&&<div style={{padding:"8px 14px",borderBottom:`1px solid ${G.border}`,background:"#F0FFF4",fontSize:12,color:G.green,fontWeight:700}}>Total purchased: {fmt$(totalPurchased)}</div>}
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.length===0?<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:13}}>No purchased shipments</div>:
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
                  <div style={{fontSize:11,color:G.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.item||"(no item)"}</div>
                  <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center"}}>
                    <span style={{background:"#F0FFF4",color:G.green,border:`1px solid ${G.green}30`,borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>Purchased ✓</span>
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

    {selectedShipment?<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${G.border}`,background:"#FFF8EE",display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:13,fontWeight:700,color:G.gold}}>Bin Number</div>
        <input value={binInput} onChange={e=>setBinInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveBin()} placeholder="Enter bin #" style={{width:100,background:"#fff",border:`2px solid ${G.gold}`,borderRadius:7,padding:"6px 12px",fontSize:18,fontWeight:700,color:G.gold,outline:"none",textAlign:"center"}}/>
        <Btn v="gold" small onClick={saveBin} disabled={savingBin||binInput===String(selectedShipment.bin_number||"")}>{savingBin?"Saving...":"Save Bin"}</Btn>
        {selectedShipment.bin_number&&<div style={{fontSize:12,color:G.muted}}>Currently: Bin {selectedShipment.bin_number}</div>}
      </div>
      <div style={{flex:1,overflow:"hidden"}}>
        <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);if(s.shipment_id===selected)setBinInput(String(s.bin_number||""));}} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>
      </div>
    </div>:<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a purchased shipment</div>
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
  const [search,setSearch]=useState("");
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [bulkModal,setBulkModal]=useState(false);
  const [bulkStage,setBulkStage]=useState("outbound_complete");
  const [bulkSaving,setBulkSaving]=useState(false);
  const [uploadModal,setUploadModal]=useState(false);
  const [uploadResults,setUploadResults]=useState(null);
  const [uploading,setUploading]=useState(false);

  const custById=useMemo(()=>{const m={};customers.forEach(c=>m[c.customer_id]=c);return m;},[customers]);
  const logsByCustomer=useMemo(()=>{const m={};contactLogs.forEach(l=>{if(!m[l.customer_id])m[l.customer_id]=[];m[l.customer_id].push(l);});return m;},[contactLogs]);

  const filtered=useMemo(()=>{
    let list=shipments.filter(s=>FULFILL_STAGES.includes(s.stage));
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(s.shipment_id||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q)||String(s.outbound_tracking||"").toLowerCase().includes(q);});}
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  },[shipments,search,custById]);

  const kits=filtered.filter(s=>s.shipping_type==="kit");
  const labels=filtered.filter(s=>s.shipping_type==="label");

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
      if (c.name) nameToCustId[c.name.toLowerCase().trim().replace(/\s+/g,' ')] = c.customer_id;
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
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
      return lines.slice(1).map(line => {
        const vals = []; let cur = ''; let inQ = false;
        for (let ch of line) {
          if (ch === '"') inQ = !inQ;
          else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
          else cur += ch;
        }
        vals.push(cur.trim());
        const obj = {};
        headers.forEach((h,i) => obj[h] = vals[i] || '');
        return obj;
      });
    }

    // Parse XLSX using SheetJS-style manual read — actually just read as text if CSV
    async function readFile(file) {
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        if (file.name.endsWith('.xlsx')) {
          // Read as binary for xlsx - we'll use a simple approach
          reader.readAsText(file); // fallback - most exports can be read as csv if saved as csv
        } else {
          reader.readAsText(file);
        }
      });
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
          const name = (r['senderContactName'] || '').toLowerCase().trim().replace(/\s+/g,' ');
          const tracking = (r['masterTrackingNumber'] || r['returnTrackingId'] || '').trim();
          if (!name || !tracking) return;
          const custId = nameToCustId[name];
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
        const phone=String(c.phone||"").replace(/\D/g,"")||SNAPPY_PHONE;
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

    function downloadCSV(filename,csv){
      const blob=new Blob([csv],{type:"text/csv"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    }

    const fedexCustomers=filtered.filter(s=>s.shipping_type==="label");
    const uspsCustomers=filtered.filter(s=>s.shipping_type==="usps");
    const allLabelCustomers=[...fedexCustomers,...uspsCustomers];

    // 1. FedEx return labels CSV
    if(fedexCustomers.length>0){
      downloadCSV(`${today}_fedex_labels.csv`, fedexCSV(fedexCustomers));
    }

    // 2. Pirateship USPS return labels CSV
    if(uspsCustomers.length>0){
      setTimeout(()=>downloadCSV(`${today}_pirateship_usps_labels.csv`, pirateshipCSV(uspsCustomers)), 500);
    }

    // 3. Email copy doc (all label customers)
    if(allLabelCustomers.length>0){
      setTimeout(()=>{
        let doc=`LABEL EMAIL GUIDE\n${new Date().toLocaleDateString()}\n${"=".repeat(60)}\n\n`;
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
          doc+=`Just print the label, pack ${item} in any sturdy box or padded envelope, attach it, and ${dropText} — completely free.\n\n`;
          doc+=`Feel free to include any other pieces you'd like me to look at while I have it — no extra charge. I'll evaluate everything within two business days and reach out with a firm offer. Don't like the number? I send it all back at no cost.\n\n`;
          doc+=`Any questions, just reply here or call/text me at 866-613-0704.\n\n`;
          doc+=`David\nSnappy Gold\n\n`;
          doc+="─".repeat(60)+"\n\n";
        });
        const blob=new Blob([doc],{type:"text/plain"});
        const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${today}_label_email_copy.txt`; a.click();
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

  return <div style={{flex:1,display:"flex",overflow:"hidden"}}>
    {/* Left */}
    <div style={{width:340,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{flex:1,background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
          <Btn v="ghost" small onClick={()=>setUploadModal(true)}>⬆ Ship Reports</Btn>
          <Btn v="gold" small onClick={generateBatch} disabled={filtered.length===0}>⬇ Batch</Btn>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",fontSize:11,color:G.muted}}>
          <span style={{background:"#F5F0FF",color:G.purple,borderRadius:4,padding:"2px 8px",fontWeight:600}}>{kits.length} kits</span>
          <span style={{background:"#EEF4FF",color:G.blue,borderRadius:4,padding:"2px 8px",fontWeight:600}}>{labels.length} labels</span>
          {selectedIds.size>0&&<button onClick={()=>setBulkModal(true)} style={{marginLeft:"auto",fontSize:10,padding:"2px 10px",borderRadius:4,background:G.gold,color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Bulk ({selectedIds.size})</button>}
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
    <DetailPane shipment={selectedShipment} customer={selectedCustomer} contactLogs={selectedLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);}} onNewShipment={onNewShipment} onClose={()=>setSelected(null)}/>

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

function ProcessTab({shipments,customers,contactLogs,onUpdate,onNewShipment}) {
  const [selected,setSelected]=useState(null);
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
    let list=shipments.filter(s=>PROCESS_STAGES.includes(s.stage));
    if(stageFilter) list=list.filter(s=>s.stage===stageFilter);
    if(search){const q=search.toLowerCase();list=list.filter(s=>{const c=custById[s.customer_id]||{};return String(s.item||"").toLowerCase().includes(q)||String(c.name||"").toLowerCase().includes(q)||String(c.email||"").toLowerCase().includes(q)||String(s.return_tracking||"").toLowerCase().includes(q)||String(s.outbound_tracking||"").toLowerCase().includes(q);});}
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  },[shipments,search,stageFilter,custById]);

  const counts=useMemo(()=>{const m={};shipments.filter(s=>PROCESS_STAGES.includes(s.stage)).forEach(s=>m[s.stage]=(m[s.stage]||0)+1);return m;},[shipments]);

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

  return <div style={{flex:1,display:"flex",overflow:"hidden"}}>
    <div style={{width:340,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`,display:"flex",flexDirection:"column",gap:8}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>setStageFilter(null)} style={{background:!stageFilter?G.gold:"transparent",color:!stageFilter?"#fff":G.muted,border:`1px solid ${!stageFilter?G.gold:G.border}`,borderRadius:20,padding:"2px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>All {Object.values(counts).reduce((a,b)=>a+b,0)}</button>
          {PROCESS_STAGES.filter(s=>counts[s]).map(s=><button key={s} onClick={()=>setStageFilter(stageFilter===s?null:s)} style={{background:stageFilter===s?SC[s]+"22":"transparent",color:stageFilter===s?SC[s]:G.muted,border:`1px solid ${stageFilter===s?SC[s]+"66":G.border}`,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{SL[s]} {counts[s]}</button>)}
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
            options={[{value:"kit",label:"Kit"},{value:"label",label:"Label"}]}/>
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

function FollowUpTab({activeCustomerEmails,onCountChange}) {
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
    if(search){const q=search.toLowerCase();list=list.filter(l=>String(l.name||"").toLowerCase().includes(q)||String(l.email||"").toLowerCase().includes(q)||String(l.item||"").toLowerCase().includes(q));}
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
    {sel?<div style={{flex:1,overflow:"auto",padding:20}}>
      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20}}>
        <Avatar name={sel.name||sel.email} size={48}/>
        <div>
          <div style={{fontWeight:700,fontSize:18,color:G.text}}>{sel.name||"(no name)"}</div>
          <div style={{fontSize:13,color:G.muted}}>{sel.email}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {sel.phone&&<><a href={`tel:${sel.phone}`} style={{textDecoration:"none"}}><Btn v="green">📞 Call</Btn></a><a href={`sms:${sel.phone}`} style={{textDecoration:"none"}}><Btn v="blue">💬 Text</Btn></a></>}
        {sel.email&&<a href={`mailto:${sel.email}`} style={{textDecoration:"none"}}><Btn v="ghost">✉ Email</Btn></a>}
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
    </div>:<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a lead to view details</div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// CUSTOMERS TAB
// ══════════════════════════════════════════════════════════

function CustomersTab({customers,shipments,contactLogs,onUpdate,onNewShipment}) {
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

  return <div style={{flex:1,display:"flex",overflow:"hidden"}}>
    {/* Left: customer list */}
    <div style={{width:280,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:"#fff",flexShrink:0}}>
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${G.border}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers..." style={{width:"100%",boxSizing:"border-box",background:G.bg,border:`1px solid ${G.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,outline:"none",color:G.text}}/>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {filtered.map(c=>{
          const ships=shipsByCustomer[c.customer_id]||[];
          const activeShip=ships.find(s=>["ready_to_fulfill","outbound_complete","received","inspected","offer_made","accepted"].includes(s.stage));
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
    {selCustomer&&<div style={{width:260,borderRight:`1px solid ${G.border}`,display:"flex",flexDirection:"column",background:G.bg,flexShrink:0}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${G.border}`,background:"#fff"}}>
        <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
          <Avatar name={selCustomer.name} size={36}/>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:G.text}}>{selCustomer.name||"(no name)"}</div>
            <div style={{fontSize:11,color:G.muted}}>{selCustomer.email}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {selCustomer.phone&&<><a href={`tel:${selCustomer.phone}`} style={{textDecoration:"none"}}><Btn v="green" small>📞</Btn></a><a href={`sms:${selCustomer.phone}`} style={{textDecoration:"none"}}><Btn v="blue" small>💬</Btn></a></>}
          {selCustomer.email&&<a href={`mailto:${selCustomer.email}`} style={{textDecoration:"none"}}><Btn v="ghost" small>✉</Btn></a>}
          <Btn v="purple" small onClick={()=>{onNewShipment&&setSelectedShipId("__new__");}}>+ Ship</Btn>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:8,display:"flex",flexDirection:"column",gap:6}}>
        {selShipments.length===0?<div style={{padding:16,textAlign:"center",color:G.muted,fontSize:12}}>No shipments</div>:
        selShipments.map(s=><div key={s.shipment_id} onClick={()=>setSelectedShipId(s.shipment_id)} style={{background:"#fff",borderRadius:8,padding:"10px 12px",cursor:"pointer",border:`1px solid ${selectedShipId===s.shipment_id?G.gold:G.border}`,boxShadow:selectedShipId===s.shipment_id?"0 0 0 2px "+G.gold+"33":"none"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div style={{fontSize:12,fontWeight:600,color:G.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{s.item||"(no item)"}</div>
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
    {selCustomer&&selShipment?<DetailPane shipment={selShipment} customer={selCustomer} contactLogs={selLogs} allShipments={shipments} allCustomers={customers} onUpdate={(s,c)=>{onUpdate(s,c);}} onNewShipment={s=>{onNewShipment(s);setSelectedShipId(s.shipment_id);}} onClose={()=>setSelectedShipId(null)}/>
    :selCustomer?<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a shipment to view details</div>
      <Btn v="gold" onClick={()=>{if(selCustomer){const fakeNew={shipment_id:"__new__",customer_id:selCustomer.customer_id};onNewShipment&&onNewShipment(fakeNew);}}}>+ New Shipment</Btn>
    </div>
    :<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.muted}}>
      <div style={{fontSize:40,opacity:0.3}}>◈</div>
      <div style={{fontSize:14}}>Select a customer</div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════

export default function SnappyGoldCRM() {
  const [unlocked,setUnlocked]=useState(false);
  const [customers,setCustomers]=useState([]);
  const [shipments,setShipments]=useState([]);
  const [contactLogs,setContactLogs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [lastLoaded,setLastLoaded]=useState(null);
  const [error,setError]=useState(null);
  const [tab,setTab]=useState("fulfill");

  async function loadData(force=false){
    if(!force){const cache=getCache();if(cache){setCustomers(cache.customers||[]);setShipments(cache.shipments||[]);setContactLogs(cache.contactLogs||[]);setLastLoaded(cache._ts);return;}}
    setLoading(true); setError(null);
    try {
      const [cr,sr,lr]=await Promise.all([apiFetch({action:"getCustomers"}),apiFetch({action:"getShipments"}),apiFetch({action:"getContactLog"})]);
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
    const active=shipments.filter(s=>["ready_to_fulfill","outbound_complete","received","inspected","offer_made","accepted"].includes(s.stage));
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

  const TABS=[{id:"fulfill",label:"Fulfill",color:G.purple},{id:"process",label:"Process",color:G.teal},{id:"received",label:"Received",color:G.teal},{id:"followup",label:"Follow Up",color:G.orange},{id:"purchased",label:"Purchased",color:G.green},{id:"customers",label:"Customers",color:G.blue}];
  const [followUpCount,setFollowUpCount]=useState(0);

  const fulfillCount=shipments.filter(s=>s.stage==="ready_to_fulfill").length;
  const processCount=shipments.filter(s=>PROCESS_STAGES.includes(s.stage)).length;
  const receivedCount=shipments.filter(s=>s.stage==="received").length;
  const purchasedCount=shipments.filter(s=>s.stage==="purchase_complete").length;

  if(!unlocked) return <PinGate onUnlock={()=>setUnlocked(true)}/>;

  return <div style={{height:"100vh",display:"flex",flexDirection:"column",background:G.bg,fontFamily:"'Georgia','Times New Roman',serif",color:G.text}}>
    {/* Top bar */}
    <div style={{background:G.dark,borderBottom:`2px solid ${G.gold}44`,padding:"0 20px",display:"flex",alignItems:"center",gap:16,height:52,flexShrink:0}}>
      <div style={{color:G.gold,fontWeight:700,fontSize:16,letterSpacing:"0.08em",flexShrink:0}}>SNAPPY<span style={{color:G.cream}}>.GOLD</span></div>
      <div style={{color:G.muted,fontSize:11,flexShrink:0}}>CRM v5</div>
      <div style={{flex:1}}/>
      {error&&<div style={{color:G.red,fontSize:11}}>{error}</div>}
      {lastLoaded&&<div style={{color:G.muted,fontSize:11}}>Loaded {new Date(lastLoaded).toLocaleTimeString()}</div>}
      <button onClick={()=>loadData(true)} disabled={loading} style={{background:"transparent",color:G.muted,border:`1px solid #444`,borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:loading?"not-allowed":"pointer"}}>{loading?"Loading…":"⟳ Refresh"}</button>
    </div>

    {/* Tab bar */}
    <div style={{background:"#fff",borderBottom:`1px solid ${G.border}`,padding:"0 16px",display:"flex",gap:0,flexShrink:0}}>
      {TABS.map(t=>{
        const count=t.id==="fulfill"?fulfillCount:t.id==="process"?processCount:t.id==="received"?receivedCount:t.id==="followup"?followUpCount:t.id==="purchased"?purchasedCount:t.id==="customers"?customers.length:null;
        const active=tab===t.id;
        return <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"12px 20px",background:"none",border:"none",borderBottom:active?`3px solid ${t.color}`:"3px solid transparent",color:active?t.color:G.muted,fontWeight:active?700:400,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6,transition:"all 0.15s",fontFamily:"inherit"}}>
          {t.label}
          {count!==null&&count>0&&<span style={{background:active?t.color+"22":"#F0EAE0",color:active?t.color:G.muted,borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{count}</span>}
        </button>;
      })}
    </div>

    {/* Tab content */}
    <div style={{flex:1,display:"flex",overflow:"hidden"}}>
      {tab==="fulfill"&&<FulfillTab shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="process"&&<ProcessTab shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="received"&&<ReceivedTab shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="followup"&&<FollowUpTab activeCustomerEmails={activeCustomerEmails} onCountChange={setFollowUpCount}/>}
      {tab==="purchased"&&<PurchasedTab shipments={shipments} customers={customers} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
      {tab==="customers"&&<CustomersTab customers={customers} shipments={shipments} contactLogs={contactLogs} onUpdate={handleUpdate} onNewShipment={handleNewShipment}/>}
    </div>
  </div>;
}
