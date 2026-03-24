import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════
// SNAPPY GOLD CRM v4
// Google Sheets backend · Split-pane layout
// PIN: 5437
// ═══════════════════════════════════════════════════════════

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby82CuMrlr0us5SUSCusqzGoxZYHPQg9nQuzalIplObIjtbXNUpRBNPrJWuV1qimmJbgA/exec";
const CRM_KEY    = "snappy_crm_2026";
const PIN        = "5437";
const CACHE_KEY  = "sg_crm_v4_cache";

// ── Brand ────────────────────────────────────────────────
const G = {
  gold:    "#C8953C",
  goldLt:  "#E8B86D",
  dark:    "#1A1816",
  darker:  "#120F0D",
  cream:   "#FAF6F0",
  bg:      "#F5EFE6",
  card:    "#FFFFFF",
  border:  "#E2D9CC",
  text:    "#2C2420",
  muted:   "#8B7D70",
  green:   "#2E7D32",
  red:     "#B71C1C",
  blue:    "#1565C0",
  purple:  "#6A1B9A",
  orange:  "#E65100",
  teal:    "#00695C",
};

// ── Stage config ─────────────────────────────────────────
const STAGES = [
  "estimate_only", "ready_to_fulfill", "outbound_pending",
  "outbound_fulfilled", "received", "inspected", "offer_made",
  "accepted", "rejected", "purchase_complete", "return_complete", "dead"
];

const SL = {
  estimate_only:      "Estimate Only",
  ready_to_fulfill:   "Ready to Fulfill",
  outbound_pending:   "Outbound Pending",
  outbound_fulfilled: "Outbound Fulfilled",
  received:           "Received",
  inspected:          "Inspected",
  offer_made:         "Offer Made",
  accepted:           "Accepted",
  rejected:           "Rejected",
  purchase_complete:  "Purchased ✓",
  return_complete:    "Returned",
  dead:               "Dead",
};

const SC = {
  estimate_only:      "#1565C0",
  ready_to_fulfill:   "#6A1B9A",
  outbound_pending:   "#E65100",
  outbound_fulfilled: "#2E7D32",
  received:           "#00695C",
  inspected:          "#00838F",
  offer_made:         "#F57F17",
  accepted:           "#2E7D32",
  rejected:           "#B71C1C",
  purchase_complete:  "#1B5E20",
  return_complete:    "#546E7A",
  dead:               "#9E9E9E",
};

// Stages that represent active pipeline (not terminal)
const ACTIVE_STAGES = [
  "ready_to_fulfill", "outbound_pending", "outbound_fulfilled",
  "received", "inspected", "offer_made", "accepted"
];

// ── Helpers ──────────────────────────────────────────────
function fmt$(n) { return n ? "$" + Number(n).toLocaleString() : "—"; }
function fmtPhone(p) {
  if (!p) return "";
  const d = String(p).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return p;
}
function daysSince(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function parseEstHigh(est) {
  if (!est) return 0;
  const nums = String(est).replace(/[$,]/g,"").split(/[–\-]/)
    .map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  return nums.length ? Math.max(...nums) : 0;
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0,2);
}
function avatarColor(str) {
  const colors = ["#C8953C","#1565C0","#2E7D32","#6A1B9A","#00695C","#E65100","#B71C1C"];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

// ── API layer ─────────────────────────────────────────────
async function apiFetch(params) {
  const url = SCRIPT_URL + "?" + new URLSearchParams(params).toString();
  const res = await fetch(url);
  return res.json();
}

async function apiPost(body) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Cache ─────────────────────────────────────────────────
function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}
function setCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _ts: Date.now() })); } catch {}
}

// ════════════════════════════════════════════════════════
// ATOMS
// ════════════════════════════════════════════════════════

function Badge({ stage, sm }) {
  const c = SC[stage] || "#9E9E9E";
  return (
    <span style={{
      background: c + "18", color: c, border: `1px solid ${c}33`,
      borderRadius: 4, padding: sm ? "1px 6px" : "3px 9px",
      fontSize: sm ? 10 : 11, fontWeight: 700, whiteSpace: "nowrap",
      letterSpacing: "0.02em"
    }}>{SL[stage] || stage}</span>
  );
}

function Avatar({ name, size = 36 }) {
  const bg = avatarColor(name || "?");
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, color: "#fff", display: "flex",
      alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, flexShrink: 0,
      fontFamily: "'Georgia', serif"
    }}>{initials(name)}</div>
  );
}

function Btn({ children, onClick, v = "ghost", disabled, small, style: st = {} }) {
  const base = {
    border: "none", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: small ? 11 : 12, padding: small ? "4px 10px" : "6px 14px",
    opacity: disabled ? 0.45 : 1, transition: "all 0.12s", display: "inline-flex",
    alignItems: "center", gap: 5, whiteSpace: "nowrap"
  };
  const vars = {
    gold:    { background: G.gold, color: "#fff" },
    danger:  { background: "#FFF0F0", color: G.red, border: `1px solid ${G.red}30` },
    ghost:   { background: "#F0EAE0", color: G.text, border: `1px solid ${G.border}` },
    green:   { background: "#F0FFF4", color: G.green, border: `1px solid ${G.green}30` },
    blue:    { background: "#EEF4FF", color: G.blue, border: `1px solid ${G.blue}30` },
    purple:  { background: "#F5F0FF", color: G.purple, border: `1px solid ${G.purple}30` },
    dark:    { background: G.dark, color: G.cream },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...(vars[v] || vars.ghost), ...st }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(0.92)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = ""; }}
    >{children}</button>
  );
}

function Inp({ label, value, onChange, type = "text", placeholder = "", rows, mono }) {
  const common = {
    width: "100%", boxSizing: "border-box", background: "#FDFAF6",
    color: G.text, border: `1px solid ${G.border}`, borderRadius: 6,
    padding: "7px 10px", fontSize: 13, outline: "none",
    fontFamily: mono ? "monospace" : "inherit",
    transition: "border-color 0.15s"
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ color: G.muted, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</label>}
      {rows
        ? <textarea value={value || ""} onChange={onChange} rows={rows} placeholder={placeholder}
            style={{ ...common, resize: "vertical" }}
            onFocus={e => e.currentTarget.style.borderColor = G.gold}
            onBlur={e => e.currentTarget.style.borderColor = G.border} />
        : <input type={type} value={value || ""} onChange={onChange} placeholder={placeholder}
            style={common}
            onFocus={e => e.currentTarget.style.borderColor = G.gold}
            onBlur={e => e.currentTarget.style.borderColor = G.border} />
      }
    </div>
  );
}

function Sel({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ color: G.muted, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</label>}
      <select value={value || ""} onChange={onChange} style={{
        background: "#FDFAF6", color: G.text, border: `1px solid ${G.border}`,
        borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none"
      }}>{options.map(o =>
        <option key={o.value || o} value={o.value || o}>{o.label || o}</option>
      )}</select>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// PIN GATE
// ════════════════════════════════════════════════════════

function PinGate({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  function submit() {
    if (pin === PIN) { onUnlock(); }
    else { setErr(true); setTimeout(() => setErr(false), 800); setPin(""); }
  }
  return (
    <div style={{ minHeight: "100vh", background: G.dark, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
      <div style={{ color: G.gold, fontSize: 28, fontFamily: "'Georgia', serif", letterSpacing: "0.1em" }}>SNAPPY GOLD</div>
      <div style={{ color: G.muted, fontSize: 13 }}>CRM v4</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <input
          type="password" value={pin} onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Enter PIN"
          autoFocus
          style={{
            background: err ? "#3a1a1a" : "#2a2420", color: G.cream,
            border: `1px solid ${err ? G.red : G.gold}55`,
            borderRadius: 8, padding: "12px 20px", fontSize: 18, outline: "none",
            textAlign: "center", letterSpacing: "0.3em", width: 160,
            transition: "all 0.15s"
          }}
        />
        <Btn v="gold" onClick={submit} style={{ width: 160, justifyContent: "center" }}>Unlock</Btn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// STAGE PILL COUNTS (top bar)
// ════════════════════════════════════════════════════════

function PipelineCounts({ shipments, activeFilter, onFilter }) {
  const counts = useMemo(() => {
    const m = {};
    shipments.forEach(s => { m[s.stage] = (m[s.stage] || 0) + 1; });
    return m;
  }, [shipments]);

  const shown = STAGES.filter(s => counts[s]);

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <button onClick={() => onFilter(null)} style={{
        background: !activeFilter ? G.gold : "transparent",
        color: !activeFilter ? "#fff" : G.muted,
        border: `1px solid ${!activeFilter ? G.gold : G.border}`,
        borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 700,
        cursor: "pointer"
      }}>All {shipments.length}</button>
      {shown.map(s => (
        <button key={s} onClick={() => onFilter(activeFilter === s ? null : s)} style={{
          background: activeFilter === s ? SC[s] + "22" : "transparent",
          color: activeFilter === s ? SC[s] : G.muted,
          border: `1px solid ${activeFilter === s ? SC[s] + "66" : G.border}`,
          borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap"
        }}>{SL[s]} {counts[s]}</button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// SHIPMENT LIST ITEM
// ════════════════════════════════════════════════════════

function ShipmentRow({ shipment, customer, selected, onClick }) {
  const high = parseEstHigh(shipment.estimate);
  const ds = daysSince(shipment.created_at);

  return (
    <div onClick={onClick} style={{
      padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${G.border}`,
      background: selected ? "#FFF8EE" : "#fff",
      borderLeft: selected ? `3px solid ${G.gold}` : "3px solid transparent",
      transition: "background 0.1s"
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "#FDFAF6"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "#fff"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Avatar name={customer?.name || shipment.customer_id} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: G.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {customer?.name || shipment.customer_email || shipment.customer_id}
            </div>
            {high > 0 && <div style={{ color: G.gold, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{fmt$(high)}</div>}
          </div>
          <div style={{ fontSize: 11, color: G.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shipment.item || "(no item)"}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
            <Badge stage={shipment.stage} sm />
            {ds !== null && <span style={{ fontSize: 10, color: G.muted }}>{ds}d ago</span>}
            {shipment.shipping_type && <span style={{ fontSize: 10, color: G.muted, background: G.bg, borderRadius: 3, padding: "1px 5px" }}>{shipment.shipping_type}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// EDIT MODAL
// ════════════════════════════════════════════════════════

function EditModal({ shipment, customer, onSave, onClose }) {
  const [s, setS] = useState({ ...shipment });
  const [c, setC] = useState({ ...customer });
  const [saving, setSaving] = useState(false);

  function updS(f, v) { setS(p => ({ ...p, [f]: v })); }
  function updC(f, v) { setC(p => ({ ...p, [f]: v })); }

  async function save() {
    setSaving(true);
    try {
      // Update customer
      await apiPost({ action: "upsertCustomer", data: {
        email: c.email, name: c.name, phone: c.phone,
        address: c.address, source: c.source, notes: c.notes
      }});
      // Update shipment
      await apiPost({ action: "updateShipment", shipment_id: s.shipment_id, updates: {
        stage: s.stage, shipping_type: s.shipping_type, item: s.item,
        estimate: s.estimate, outbound_tracking: s.outbound_tracking,
        return_tracking: s.return_tracking, purchase_price: s.purchase_price,
        appraised_value: s.appraised_value, payment_method: s.payment_method,
        payment_info: s.payment_info, notes: s.notes
      }});
      onSave({ shipment: s, customer: c });
    } catch(e) { alert("Save failed: " + e.message); }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(680px, 95vw)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${G.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: G.text }}>Edit Record</div>
          <Btn v="ghost" onClick={onClose} small>✕ Close</Btn>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Customer */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: G.gold, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Customer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="Name" value={c.name} onChange={e => updC("name", e.target.value)} />
              <Inp label="Email" value={c.email} onChange={e => updC("email", e.target.value)} />
              <Inp label="Phone" value={c.phone} onChange={e => updC("phone", e.target.value)} />
              <Inp label="Source" value={c.source} onChange={e => updC("source", e.target.value)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Inp label="Address" value={c.address} onChange={e => updC("address", e.target.value)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Inp label="Notes" value={c.notes} onChange={e => updC("notes", e.target.value)} rows={2} />
            </div>
          </div>

          {/* Shipment */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: G.gold, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Shipment · {s.shipment_id}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Sel label="Stage" value={s.stage} onChange={e => updS("stage", e.target.value)}
                options={STAGES.map(v => ({ value: v, label: SL[v] || v }))} />
              <Sel label="Shipping Type" value={s.shipping_type} onChange={e => updS("shipping_type", e.target.value)}
                options={[{value:"",label:"—"},{value:"kit",label:"Kit"},{value:"label",label:"Label"}]} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Inp label="Item Description" value={s.item} onChange={e => updS("item", e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <Inp label="Estimate" value={s.estimate} onChange={e => updS("estimate", e.target.value)} />
              <Inp label="Outbound Tracking" value={s.outbound_tracking} onChange={e => updS("outbound_tracking", e.target.value)} mono />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <Inp label="Return Tracking" value={s.return_tracking} onChange={e => updS("return_tracking", e.target.value)} mono />
              <Inp label="Purchase Price" value={s.purchase_price} type="number" onChange={e => updS("purchase_price", e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <Inp label="Appraised Value" value={s.appraised_value} type="number" onChange={e => updS("appraised_value", e.target.value)} />
              <Inp label="Payment Method" value={s.payment_method} onChange={e => updS("payment_method", e.target.value)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Inp label="Payment Info" value={s.payment_info} onChange={e => updS("payment_info", e.target.value)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Inp label="Notes" value={s.notes} onChange={e => updS("notes", e.target.value)} rows={3} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn v="ghost" onClick={onClose}>Cancel</Btn>
            <Btn v="gold" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// LOG MODAL
// ════════════════════════════════════════════════════════

function LogModal({ shipment, customer, onSave, onClose }) {
  const [type, setType] = useState("call");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!notes.trim()) return;
    setSaving(true);
    try {
      await apiPost({ action: "addContactLog", data: {
        customer_id: shipment.customer_id,
        type, notes
      }});
      onSave({ type, notes, timestamp: new Date().toISOString() });
    } catch(e) { alert("Failed: " + e.message); }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(460px, 95vw)", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: G.text }}>
          Log Contact · {customer?.name || "Customer"}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {["call","text","email","note"].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: type === t ? G.gold : G.bg,
              color: type === t ? "#fff" : G.muted,
              border: `1px solid ${type === t ? G.gold : G.border}`,
              cursor: "pointer", textTransform: "capitalize"
            }}>{t}</button>
          ))}
        </div>
        <Inp label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="What happened?" />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <Btn v="ghost" onClick={onClose}>Cancel</Btn>
          <Btn v="gold" onClick={save} disabled={saving || !notes.trim()}>{saving ? "Saving…" : "Save Log"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// QUICK STAGE MODAL
// ════════════════════════════════════════════════════════

function StageModal({ shipment, onSave, onClose }) {
  const [stage, setStage] = useState(shipment.stage);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiPost({ action: "updateShipment", shipment_id: shipment.shipment_id, updates: { stage } });
      onSave(stage);
    } catch(e) { alert("Failed: " + e.message); }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(380px, 95vw)", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: G.text }}>Change Stage</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {STAGES.map(s => (
            <button key={s} onClick={() => setStage(s)} style={{
              padding: "8px 14px", borderRadius: 7, textAlign: "left",
              background: stage === s ? SC[s] + "18" : "#fff",
              color: stage === s ? SC[s] : G.text,
              border: `1px solid ${stage === s ? SC[s] + "55" : G.border}`,
              cursor: "pointer", fontSize: 13, fontWeight: stage === s ? 700 : 400
            }}>{SL[s]}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <Btn v="ghost" onClick={onClose}>Cancel</Btn>
          <Btn v="gold" onClick={save} disabled={saving || stage === shipment.stage}>{saving ? "Saving…" : "Update Stage"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// DETAIL PANE
// ════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════
// ADD SHIPMENT MODAL
// ════════════════════════════════════════════════════════

function AddShipmentModal({ customer, onSave, onClose }) {
  const [item, setItem] = useState("");
  const [estimate, setEstimate] = useState("");
  const [shippingType, setShippingType] = useState("kit");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await apiPost({
        action: "createShipment",
        data: {
          customer_id: customer.customer_id,
          stage: "ready_to_fulfill",
          shipping_type: shippingType,
          item, estimate, notes,
          outbound_tracking: "", return_tracking: "",
          received_at: "", purchase_price: "", appraised_value: "",
          payment_method: "", payment_info: "", sent_at: "",
        }
      });
      onSave({
        shipment_id: res,
        customer_id: customer.customer_id,
        stage: "ready_to_fulfill",
        shipping_type: shippingType,
        item, estimate, notes,
        created_at: new Date().toISOString(),
      });
    } catch(e) { alert("Failed: " + e.message); }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(480px, 95vw)", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, color: G.text }}>New Shipment</div>
        <div style={{ fontSize: 12, color: G.muted, marginBottom: 20 }}>{customer?.name || customer?.email}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Sel label="Shipping Type" value={shippingType} onChange={e => setShippingType(e.target.value)}
            options={[{value:"kit",label:"Kit (mail kit to customer)"},{value:"label",label:"Label (email FedEx label)"}]} />
          <Inp label="Item Description" value={item} onChange={e => setItem(e.target.value)} placeholder="e.g. 14K Yellow Gold Chain" />
          <Inp label="Estimate" value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="e.g. $1,200 – $1,800" />
          <Inp label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional" />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <Btn v="ghost" onClick={onClose}>Cancel</Btn>
          <Btn v="gold" onClick={save} disabled={saving}>{saving ? "Creating..." : "Create Shipment"}</Btn>
        </div>
      </div>
    </div>
  );
}

function DetailPane({ shipment, customer, contactLogs, onUpdate, onNewShipment, onClose }) {
  const [modal, setModal] = useState(null); // "edit" | "log" | "stage" | "addShipment"
  const [localLogs, setLocalLogs] = useState(contactLogs || []);

  if (!shipment) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: G.muted }}>
        <div style={{ fontSize: 40, opacity: 0.3 }}>◈</div>
        <div style={{ fontSize: 14 }}>Select a shipment to view details</div>
      </div>
    );
  }

  const high = parseEstHigh(shipment.estimate);

  // Context-aware next actions
  function getActions() {
    switch (shipment.stage) {
      case "estimate_only":
        return [
          { label: "→ Ready to Fulfill", v: "purple", stage: "ready_to_fulfill" },
          { label: "Log Contact", v: "blue", action: "log" },
        ];
      case "ready_to_fulfill":
        return [
          { label: "→ Outbound Pending", v: "orange", stage: "outbound_pending" },
          { label: "Log Contact", v: "blue", action: "log" },
        ];
      case "outbound_pending":
        return [
          { label: "→ Outbound Fulfilled", v: "green", stage: "outbound_fulfilled" },
          { label: "Log Contact", v: "blue", action: "log" },
        ];
      case "outbound_fulfilled":
        return [
          { label: "→ Received", v: "green", stage: "received" },
          { label: "Log Contact", v: "blue", action: "log" },
        ];
      case "received":
        return [
          { label: "→ Inspected", v: "green", stage: "inspected" },
          { label: "Log Contact", v: "blue", action: "log" },
        ];
      case "inspected":
        return [
          { label: "→ Offer Made", v: "gold", stage: "offer_made" },
        ];
      case "offer_made":
        return [
          { label: "→ Accepted", v: "green", stage: "accepted" },
          { label: "→ Rejected", v: "danger", stage: "rejected" },
        ];
      case "accepted":
        return [
          { label: "→ Purchase Complete", v: "green", stage: "purchase_complete" },
        ];
      default:
        return [];
    }
  }

  async function quickStage(stage) {
    try {
      await apiPost({ action: "updateShipment", shipment_id: shipment.shipment_id, updates: { stage } });
      onUpdate({ ...shipment, stage });
    } catch(e) { alert("Failed: " + e.message); }
  }

  function Field({ label, value, mono }) {
    if (!value) return null;
    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: G.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: G.text, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{value}</div>
      </div>
    );
  }

  const actions = getActions();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${G.border}`, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar name={customer?.name} size={44} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: G.text }}>{customer?.name || "(no name)"}</div>
              <div style={{ fontSize: 12, color: G.muted, marginTop: 1 }}>{customer?.email}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {customer?.phone && (
              <>
                <a href={`tel:${customer.phone}`} style={{ textDecoration: "none" }}>
                  <Btn v="green" small>📞 Call</Btn>
                </a>
                <a href={`sms:${customer.phone}`} style={{ textDecoration: "none" }}>
                  <Btn v="blue" small>💬 Text</Btn>
                </a>
              </>
            )}
            {customer?.email && (
              <a href={`mailto:${customer.email}`} style={{ textDecoration: "none" }}>
                <Btn v="ghost" small>✉ Email</Btn>
              </a>
            )}
            <Btn v="ghost" small onClick={onClose}>✕</Btn>
          </div>
        </div>

        {/* Stage + actions row */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Badge stage={shipment.stage} />
          <Btn v="ghost" small onClick={() => setModal("stage")}>Change Stage ↓</Btn>
          {actions.map((a, i) => (
            <Btn key={i} v={a.v} small
              onClick={() => a.stage ? quickStage(a.stage) : setModal(a.action)}>
              {a.label}
            </Btn>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Btn v="ghost" small onClick={() => setModal("log")}>+ Log</Btn>
            <Btn v="purple" small onClick={() => setModal("addShipment")}>+ Shipment</Btn>
            <Btn v="gold" small onClick={() => setModal("edit")}>Edit</Btn>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* Shipment info */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: `1px solid ${G.border}`, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: G.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>Shipment · {shipment.shipment_id}</div>
            <Field label="Item" value={shipment.item} />
            <Field label="Estimate" value={shipment.estimate} />
            {shipment.purchase_price && (
              <div style={{ background: "#F0FFF4", borderRadius: 6, padding: "8px 12px", border: `1px solid ${G.green}30` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: G.green, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Purchase</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: G.green }}>{fmt$(shipment.purchase_price)}</div>
                {shipment.appraised_value && <div style={{ fontSize: 11, color: G.muted }}>Appraised: {fmt$(shipment.appraised_value)}</div>}
                {shipment.payment_method && <div style={{ fontSize: 11, color: G.muted }}>via {shipment.payment_method} {shipment.payment_info}</div>}
              </div>
            )}
            <Field label="Shipping Type" value={shipment.shipping_type} />
            {shipment.notes && <Field label="Notes" value={shipment.notes} />}
          </div>

          {/* Tracking + customer */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: `1px solid ${G.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: G.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>Tracking</div>
              {shipment.outbound_tracking
                ? <Field label="Outbound" value={shipment.outbound_tracking} mono />
                : <div style={{ fontSize: 12, color: G.muted }}>No outbound tracking</div>
              }
              {shipment.return_tracking
                ? <Field label="Return" value={shipment.return_tracking} mono />
                : <div style={{ fontSize: 12, color: G.muted }}>No return tracking</div>
              }
            </div>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: `1px solid ${G.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: G.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>Customer</div>
              <Field label="Phone" value={fmtPhone(customer?.phone)} />
              <Field label="Address" value={customer?.address} />
              <Field label="Source" value={customer?.source} />
              {customer?.notes && <Field label="Notes" value={customer.notes} />}
            </div>
          </div>

        </div>

        {/* Contact log */}
        {localLogs.length > 0 && (
          <div style={{ marginTop: 16, background: "#fff", borderRadius: 10, padding: 16, border: `1px solid ${G.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: G.gold, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Contact Log</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...localLogs].reverse().map((log, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12 }}>
                  <span style={{ background: G.bg, borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 700, color: G.muted, flexShrink: 0, textTransform: "capitalize" }}>{log.type || "note"}</span>
                  <div style={{ flex: 1, color: G.text }}>{log.notes}</div>
                  <div style={{ color: G.muted, flexShrink: 0, fontSize: 10 }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleDateString() : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal === "edit" && (
        <EditModal shipment={shipment} customer={customer}
          onSave={({ shipment: s, customer: c }) => { onUpdate(s, c); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
      {modal === "log" && (
        <LogModal shipment={shipment} customer={customer}
          onSave={log => { setLocalLogs(p => [...p, log]); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
      {modal === "stage" && (
        <StageModal shipment={shipment}
          onSave={stage => { onUpdate({ ...shipment, stage }); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
      {modal === "addShipment" && customer && (
        <AddShipmentModal customer={customer}
          onSave={newShipment => { onNewShipment(newShipment); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════

export default function SnappyGoldCRM() {
  const [unlocked, setUnlocked] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [contactLogs, setContactLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastLoaded, setLastLoaded] = useState(null);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null); // shipment_id
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState(null);
  const [sortBy, setSortBy] = useState("created_at"); // created_at | estimate | name
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkStage, setBulkStage] = useState("outbound_fulfilled");
  const [bulkSaving, setBulkSaving] = useState(false);

  // ── Load data ──────────────────────────────────────────
  async function loadData(force = false) {
    // Try cache first
    if (!force) {
      const cache = getCache();
      if (cache) {
        setCustomers(cache.customers || []);
        setShipments(cache.shipments || []);
        setContactLogs(cache.contactLogs || []);
        setLastLoaded(cache._ts);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const [custRes, shipRes, logRes] = await Promise.all([
        apiFetch({ action: "getCustomers" }),
        apiFetch({ action: "getShipments" }),
        apiFetch({ action: "getContactLog" }),
      ]);
      const c = Array.isArray(custRes) ? custRes : [];
      const s = Array.isArray(shipRes) ? shipRes : [];
      const l = Array.isArray(logRes) ? logRes : [];
      setCustomers(c);
      setShipments(s);
      setContactLogs(l);
      setLastLoaded(Date.now());
      if (c.length || s.length) {
        setCache({ customers: c, shipments: s, contactLogs: l });
      }
    } catch(e) {
      setError("Failed to load: " + e.message);
    }
    setLoading(false);
  }

  useEffect(() => { if (unlocked) loadData(); }, [unlocked]);

  // ── Derived data ───────────────────────────────────────
  const custByEmail = useMemo(() => {
    const m = {};
    customers.forEach(c => { m[String(c.email).toLowerCase()] = c; });
    return m;
  }, [customers]);

  const custById = useMemo(() => {
    const m = {};
    customers.forEach(c => { m[c.customer_id] = c; });
    return m;
  }, [customers]);

  const logsByCustomer = useMemo(() => {
    const m = {};
    contactLogs.forEach(l => {
      if (!m[l.customer_id]) m[l.customer_id] = [];
      m[l.customer_id].push(l);
    });
    return m;
  }, [contactLogs]);

  const filtered = useMemo(() => {
    let list = shipments.filter(s => s.customer_id); // only rows with customer_id
    if (stageFilter) list = list.filter(s => s.stage === stageFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => {
        const c = custById[s.customer_id] || {};
        return (
          String(s.item || "").toLowerCase().includes(q) ||
          String(c.name || "").toLowerCase().includes(q) ||
          String(c.email || "").toLowerCase().includes(q) ||
          String(s.shipment_id || "").toLowerCase().includes(q) ||
          String(s.return_tracking || "").toLowerCase().includes(q) ||
          String(s.outbound_tracking || "").toLowerCase().includes(q)
        );
      });
    }
    // Sort
    list = [...list].sort((a, b) => {
      if (sortBy === "estimate") return parseEstHigh(b.estimate) - parseEstHigh(a.estimate);
      if (sortBy === "name") {
        const an = (custById[a.customer_id]?.name || "").toLowerCase();
        const bn = (custById[b.customer_id]?.name || "").toLowerCase();
        return an.localeCompare(bn);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
    return list;
  }, [shipments, stageFilter, search, sortBy, custById]);

  const selectedShipment = useMemo(() => shipments.find(s => s.shipment_id === selected), [shipments, selected]);
  const selectedCustomer = useMemo(() => selectedShipment ? custById[selectedShipment.customer_id] : null, [selectedShipment, custById]);
  const selectedLogs = useMemo(() => selectedShipment ? (logsByCustomer[selectedShipment.customer_id] || []) : [], [selectedShipment, logsByCustomer]);

  function handleUpdate(updatedShipment, updatedCustomer) {
    setShipments(prev => prev.map(s => s.shipment_id === updatedShipment.shipment_id ? updatedShipment : s));
    if (updatedCustomer) {
      setCustomers(prev => prev.map(c => c.customer_id === updatedCustomer.customer_id ? { ...c, ...updatedCustomer } : c));
    }
    // Update cache
    const cache = getCache();
    if (cache) {
      setCache({
        ...cache,
        shipments: cache.shipments.map(s => s.shipment_id === updatedShipment.shipment_id ? updatedShipment : s),
        customers: updatedCustomer ? cache.customers.map(c => c.customer_id === updatedCustomer.customer_id ? { ...c, ...updatedCustomer } : c) : cache.customers
      });
    }
  }

  // Bulk update
  async function doBulkStage() {
    setBulkSaving(true);
    let updated = 0;
    for (const id of selectedIds) {
      try {
        await apiPost({ action: "updateShipment", shipment_id: id, updates: { stage: bulkStage } });
        updated++;
      } catch(e) { console.error(e); }
    }
    setShipments(prev => prev.map(s => selectedIds.has(s.shipment_id) ? { ...s, stage: bulkStage } : s));
    setSelectedIds(new Set());
    setBulkModal(false);
    setBulkSaving(false);
    alert(`Updated ${updated} shipments to ${SL[bulkStage]}`);
  }

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: G.bg, fontFamily: "'Georgia', 'Times New Roman', serif", color: G.text }}>

      {/* Top bar */}
      <div style={{ background: G.dark, borderBottom: `2px solid ${G.gold}44`, padding: "0 20px", display: "flex", alignItems: "center", gap: 16, height: 52, flexShrink: 0 }}>
        <div style={{ color: G.gold, fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", flexShrink: 0 }}>SNAPPY<span style={{ color: G.cream }}>.GOLD</span></div>
        <div style={{ color: G.muted, fontSize: 11, flexShrink: 0 }}>CRM v4</div>
        <div style={{ flex: 1 }} />
        {lastLoaded && <div style={{ color: G.muted, fontSize: 11 }}>Loaded {new Date(lastLoaded).toLocaleTimeString()}</div>}
        <Btn v="ghost" small onClick={() => loadData(true)} disabled={loading} style={{ background: "transparent", color: G.muted, border: `1px solid #444` }}>
          {loading ? "Loading…" : "⟳ Refresh"}
        </Btn>
      </div>

      {/* Pipeline counts bar */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${G.border}`, padding: "8px 16px", flexShrink: 0 }}>
        <PipelineCounts shipments={shipments.filter(s => s.customer_id)} activeFilter={stageFilter} onFilter={setStageFilter} />
      </div>

      {/* Main split */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left pane */}
        <div style={{ width: 340, borderRight: `1px solid ${G.border}`, display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>

          {/* Search + sort */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${G.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, item, tracking…"
              style={{ width: "100%", boxSizing: "border-box", background: G.bg, border: `1px solid ${G.border}`, borderRadius: 7, padding: "7px 12px", fontSize: 12, outline: "none", color: G.text }}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: G.muted, fontWeight: 600 }}>SORT</span>
              {[["created_at","Recent"],["estimate","Estimate"],["name","Name"]].map(([v, l]) => (
                <button key={v} onClick={() => setSortBy(v)} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: sortBy === v ? G.gold : "transparent",
                  color: sortBy === v ? "#fff" : G.muted,
                  border: `1px solid ${sortBy === v ? G.gold : G.border}`,
                  cursor: "pointer", fontWeight: 600
                }}>{l}</button>
              ))}
              {selectedIds.size > 0 && (
                <button onClick={() => setBulkModal(true)} style={{
                  marginLeft: "auto", fontSize: 10, padding: "2px 10px", borderRadius: 4,
                  background: G.gold, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700
                }}>Bulk ({selectedIds.size})</button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflow: "auto" }}>
            {loading && !shipments.length ? (
              <div style={{ padding: 24, textAlign: "center", color: G.muted, fontSize: 13 }}>Loading…</div>
            ) : error ? (
              <div style={{ padding: 24, color: G.red, fontSize: 12 }}>{error}</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: G.muted, fontSize: 13 }}>No shipments found</div>
            ) : (
              filtered.map(s => (
                <div key={s.shipment_id} style={{ position: "relative" }}>
                  <input type="checkbox" checked={selectedIds.has(s.shipment_id)}
                    onChange={e => {
                      setSelectedIds(prev => {
                        const n = new Set(prev);
                        e.target.checked ? n.add(s.shipment_id) : n.delete(s.shipment_id);
                        return n;
                      });
                    }}
                    style={{ position: "absolute", top: 14, left: 6, zIndex: 1, cursor: "pointer" }}
                    onClick={e => e.stopPropagation()}
                  />
                  <div style={{ paddingLeft: 24 }}>
                    <ShipmentRow
                      shipment={s}
                      customer={custById[s.customer_id]}
                      selected={selected === s.shipment_id}
                      onClick={() => setSelected(s.shipment_id)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer count */}
          <div style={{ padding: "6px 12px", borderTop: `1px solid ${G.border}`, fontSize: 11, color: G.muted }}>
            {filtered.length} of {shipments.filter(s=>s.customer_id).length} shipments
            {stageFilter && <span> · filtered by {SL[stageFilter]}</span>}
          </div>
        </div>

        {/* Right pane */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <DetailPane
            shipment={selectedShipment}
            customer={selectedCustomer}
            contactLogs={selectedLogs}
            onUpdate={handleUpdate}
            onNewShipment={newShipment => {
              setShipments(prev => [newShipment, ...prev]);
              setSelected(newShipment.shipment_id);
              const cache = getCache();
              if (cache) setCache({ ...cache, shipments: [newShipment, ...cache.shipments] });
            }}
            onClose={() => setSelected(null)}
          />
        </div>
      </div>

      {/* Bulk stage modal */}
      {bulkModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, width: "min(400px, 95vw)", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: G.text }}>Bulk Stage Update</div>
            <div style={{ fontSize: 12, color: G.muted, marginBottom: 16 }}>{selectedIds.size} shipments selected</div>
            <Sel label="Set all to" value={bulkStage} onChange={e => setBulkStage(e.target.value)}
              options={STAGES.map(v => ({ value: v, label: SL[v] || v }))} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <Btn v="ghost" onClick={() => setBulkModal(false)}>Cancel</Btn>
              <Btn v="gold" onClick={doBulkStage} disabled={bulkSaving}>{bulkSaving ? "Updating…" : `Update ${selectedIds.size} Shipments`}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
