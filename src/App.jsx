import { useState, useRef } from "react";

const BRAND = {
  cream: "#FFFBF5",
  warm: "#FFF6E9",
  gold: "#C8963E",
  goldLight: "#E8C373",
  goldDark: "#A07428",
  charcoal: "#1C1C1C",
  text: "#2D2A26",
  textMuted: "#8A857D",
  textLight: "#B5AFA6",
  green: "#2D8F5E",
  greenLight: "#E8F5EE",
  red: "#C44B3F",
  border: "#EDE8E0",
};

const font = {
  display: "'Playfair Display', Georgia, serif",
  body: "'DM Sans', system-ui, sans-serif",
};

export default function App() {
  const [image, setImage] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailStep, setEmailStep] = useState("idle"); // idle | form | done
  const [correction, setCorrection] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result);
      setImageData(reader.result.split(",")[1]);
      setAnalysis(null);
      setEmailStep("idle");
    };
    reader.readAsDataURL(file);
  };

  const analyzeImage = async () => {
    if (!imageData) return;
    setLoading(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
              { type: "text", text: `You are a buyer at Snappy, a modern company that buys jewelry, watches, gold, silver, diamonds, and precious metals. Analyze this image and provide:

1. IDENTIFICATION: What type of item is this? (ring, necklace, bracelet, watch, coins, bars, earrings, etc.)
2. MATERIAL ASSESSMENT: Based on visual cues, what material does this appear to be? (yellow gold, white gold, rose gold, silver, platinum, stainless steel, etc.)
3. KARAT ESTIMATE: If gold, estimate karat (10k, 14k, 18k, 24k). Default to 14k if uncertain.
4. ESTIMATED WEIGHT RANGE: Based on apparent size and type, estimate weight in grams
5. GEMSTONES: Any visible stones? Describe them.
6. BRAND/MAKER: If it's a watch or branded piece, identify the brand if possible.
7. CONDITION: Visible condition assessment
8. OFFER RANGE: Based on current precious metal prices and market value, provide a LOW and HIGH offer in USD.

IMPORTANT: Assume the item is REAL unless there is clear visual evidence otherwise (obvious tarnishing, green discoloration, cheap construction). Most people sending photos have real items. Give them the benefit of the doubt.

For the summary, write as the buyer. Say things like "This looks like a beautiful [item]. Based on what we can see, we'd offer around $X–$Y for this piece." Be warm and direct.

Respond in this exact JSON format:
{
  "itemType": "string",
  "material": "string",
  "karatEstimate": "string or null",
  "brand": "string or null",
  "weightRangeGrams": { "low": number, "high": number },
  "gemstones": "string or null",
  "condition": "string",
  "estimateRange": { "low": number, "high": number },
  "confidence": "high/medium/low",
  "warnings": ["array of caveats"],
  "summary": "warm buyer-voice summary"
}` },
            ],
          }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        setAnalysis(JSON.parse(jsonMatch[0]));
      } else {
        setAnalysis({ error: "Could not analyze image", summary: text });
      }
    } catch (err) {
      setAnalysis({ error: "Analysis failed. Please try again.", summary: err.message });
    }
    setLoading(false);
  };

  const handleCorrection = async () => {
    if (!correction || !imageData) return;
    setCorrecting(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
              { type: "text", text: `You are a buyer at Snappy. You previously analyzed this item, but the owner has corrected you:

"${correction}"

Re-analyze with this information. Trust the owner. Update your offer accordingly. Be warm and direct.

Respond in this exact JSON format:
{
  "itemType": "string",
  "material": "string",
  "karatEstimate": "string or null",
  "brand": "string or null",
  "weightRangeGrams": { "low": number, "high": number },
  "gemstones": "string or null",
  "condition": "string",
  "estimateRange": { "low": number, "high": number },
  "confidence": "high/medium/low",
  "warnings": ["array of caveats"],
  "summary": "updated warm buyer-voice summary incorporating the correction"
}` },
            ],
          }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        setAnalysis(JSON.parse(jsonMatch[0]));
        setCorrection("");
      }
    } catch (err) {
      console.error(err);
    }
    setCorrecting(false);
  };

  const reset = () => {
    setImage(null);
    setImageData(null);
    setAnalysis(null);
    setEmailStep("idle");
    setCorrection("");
  };

  // ───── Styles ─────
  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 14px",
    borderRadius: "100px",
    fontSize: "13px",
    fontFamily: font.body,
    fontWeight: "500",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: BRAND.cream,
      fontFamily: font.body,
      color: BRAND.text,
    }}>
      {/* ─── HEADER ─── */}
      <header style={{
        padding: "18px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: `1px solid ${BRAND.border}`,
        background: "rgba(255,251,245,0.95)",
        backdropFilter: "blur(10px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldLight})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <span style={{
            fontSize: "22px",
            fontFamily: font.display,
            fontWeight: "600",
            color: BRAND.charcoal,
          }}>
            Snappy
          </span>
        </div>
        <a href="https://snappy.gold" style={{
          fontSize: "13px",
          color: BRAND.textMuted,
          textDecoration: "none",
          fontWeight: "500",
        }}>
          snappy.gold
        </a>
      </header>

      {/* ─── MAIN ─── */}
      <main style={{
        maxWidth: "640px",
        margin: "0 auto",
        padding: "40px 20px 80px",
      }}>
        {!analysis ? (
          <>
            {/* ─── HERO ─── */}
            <div style={{ textAlign: "center", marginBottom: "36px" }}>
              <h1 style={{
                fontFamily: font.display,
                fontSize: "clamp(32px, 6vw, 44px)",
                fontWeight: "500",
                color: BRAND.charcoal,
                lineHeight: "1.15",
                marginBottom: "14px",
              }}>
                Snap it. <span style={{ color: BRAND.gold }}>Sell it.</span>
              </h1>
              <p style={{
                fontSize: "17px",
                color: BRAND.textMuted,
                lineHeight: "1.5",
                maxWidth: "380px",
                margin: "0 auto",
              }}>
                Take a photo of your jewelry, watches, or precious metals. Get an instant offer in seconds.
              </p>
            </div>

            {/* ─── CATEGORIES ─── */}
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "32px",
            }}>
              {["Gold", "Silver", "Diamonds", "Watches", "Platinum"].map((cat) => (
                <span key={cat} style={{
                  ...pill,
                  background: BRAND.warm,
                  color: BRAND.goldDark,
                  border: `1px solid ${BRAND.border}`,
                }}>
                  {cat}
                </span>
              ))}
            </div>

            {/* ─── CAMERA / UPLOAD ─── */}
            {!image ? (
              <div style={{ marginBottom: "24px" }}>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  style={{
                    width: "100%",
                    padding: "18px",
                    fontSize: "16px",
                    fontFamily: font.body,
                    fontWeight: "600",
                    background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldDark})`,
                    color: "white",
                    border: "none",
                    borderRadius: "14px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    marginBottom: "10px",
                    boxShadow: "0 4px 16px rgba(200, 150, 62, 0.25)",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  Open Camera
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: "100%",
                    padding: "14px",
                    fontSize: "14px",
                    fontFamily: font.body,
                    fontWeight: "500",
                    background: "white",
                    color: BRAND.text,
                    border: `1.5px solid ${BRAND.border}`,
                    borderRadius: "14px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND.textMuted} strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                  </svg>
                  Upload Photo
                </button>
              </div>
            ) : (
              <div style={{
                background: "white",
                border: `1px solid ${BRAND.border}`,
                borderRadius: "16px",
                padding: "16px",
                textAlign: "center",
                marginBottom: "16px",
              }}>
                <img
                  src={image}
                  alt="Your item"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "280px",
                    borderRadius: "10px",
                    marginBottom: "10px",
                  }}
                />
                <button
                  onClick={() => { setImage(null); setImageData(null); }}
                  style={{
                    background: "none",
                    border: "none",
                    color: BRAND.textMuted,
                    fontSize: "13px",
                    fontFamily: font.body,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Choose a different photo
                </button>
              </div>
            )}

            {/* ─── ANALYZE BUTTON ─── */}
            {image && (
              <button
                onClick={analyzeImage}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "18px",
                  fontSize: "16px",
                  fontFamily: font.body,
                  fontWeight: "600",
                  background: loading
                    ? BRAND.textLight
                    : `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldDark})`,
                  color: "white",
                  border: "none",
                  borderRadius: "14px",
                  cursor: loading ? "wait" : "pointer",
                  boxShadow: loading ? "none" : "0 4px 16px rgba(200, 150, 62, 0.25)",
                  marginBottom: "24px",
                }}
              >
                {loading ? "Analyzing your item..." : "Get Instant Offer"}
              </button>
            )}

            {/* ─── TRUST BAR ─── */}
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: "20px",
              flexWrap: "wrap",
              marginTop: "16px",
            }}>
              {[
                { icon: "✓", text: "Free & instant" },
                { icon: "✓", text: "No obligation" },
                { icon: "✓", text: "Insured shipping" },
              ].map(({ icon, text }) => (
                <span key={text} style={{
                  fontSize: "13px",
                  color: BRAND.textMuted,
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}>
                  <span style={{ color: BRAND.green, fontWeight: "700" }}>{icon}</span>
                  {text}
                </span>
              ))}
            </div>

            {/* ─── HOW IT WORKS ─── */}
            <div style={{
              marginTop: "48px",
              background: "white",
              border: `1px solid ${BRAND.border}`,
              borderRadius: "16px",
              padding: "28px 24px",
            }}>
              <h2 style={{
                fontFamily: font.display,
                fontSize: "22px",
                fontWeight: "500",
                textAlign: "center",
                marginBottom: "24px",
                color: BRAND.charcoal,
              }}>
                How it works
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {[
                  { num: "1", title: "Snap", desc: "Take a photo of your jewelry, watch, or precious metals" },
                  { num: "2", title: "Get an offer", desc: "Our AI analyzes your item and gives you an instant offer" },
                  { num: "3", title: "Ship & get paid", desc: "Send it in free. Get a final offer within 48 hours." },
                ].map(({ num, title, desc }) => (
                  <div key={num} style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: BRAND.warm,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: font.display,
                      fontWeight: "600",
                      fontSize: "16px",
                      color: BRAND.gold,
                      flexShrink: 0,
                    }}>
                      {num}
                    </div>
                    <div>
                      <div style={{ fontWeight: "600", fontSize: "15px", marginBottom: "2px" }}>{title}</div>
                      <div style={{ fontSize: "14px", color: BRAND.textMuted, lineHeight: "1.4" }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* ─── RESULTS ─── */
          <div>
            <button
              onClick={reset}
              style={{
                background: "none",
                border: "none",
                color: BRAND.gold,
                fontSize: "14px",
                fontFamily: font.body,
                fontWeight: "500",
                cursor: "pointer",
                marginBottom: "20px",
                padding: 0,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ← Scan another item
            </button>

            {analysis.error ? (
              <div style={{
                background: "#FFF5F5",
                border: `1px solid #F5D0CC`,
                borderRadius: "14px",
                padding: "24px",
                textAlign: "center",
              }}>
                <p style={{ color: BRAND.red, fontWeight: "500" }}>{analysis.error}</p>
                <p style={{ color: BRAND.textMuted, fontSize: "13px", marginTop: "8px" }}>{analysis.summary}</p>
              </div>
            ) : (
              <>
                {/* ─── OFFER CARD ─── */}
                <div style={{
                  background: "white",
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: "18px",
                  overflow: "hidden",
                  marginBottom: "16px",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
                }}>
                  {/* Top section with image & price */}
                  <div style={{
                    background: `linear-gradient(135deg, ${BRAND.warm} 0%, white 100%)`,
                    padding: "24px",
                    display: "flex",
                    gap: "20px",
                  }}>
                    <img
                      src={image}
                      alt="Your item"
                      style={{
                        width: "90px",
                        height: "90px",
                        objectFit: "cover",
                        borderRadius: "12px",
                        border: `1px solid ${BRAND.border}`,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: BRAND.textMuted,
                        fontWeight: "600",
                        marginBottom: "4px",
                      }}>
                        Instant Offer
                      </div>
                      <div style={{
                        fontFamily: font.display,
                        fontSize: "34px",
                        fontWeight: "600",
                        color: BRAND.charcoal,
                        lineHeight: "1",
                      }}>
                        ${analysis.estimateRange?.low?.toLocaleString()}–${analysis.estimateRange?.high?.toLocaleString()}
                      </div>
                      <div style={{
                        marginTop: "8px",
                      }}>
                        <span style={{
                          ...pill,
                          background: analysis.confidence === "high" ? BRAND.greenLight : 
                                     analysis.confidence === "medium" ? BRAND.warm : "#FFF5F5",
                          color: analysis.confidence === "high" ? BRAND.green :
                                 analysis.confidence === "medium" ? BRAND.goldDark : BRAND.red,
                          fontSize: "12px",
                        }}>
                          <span style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            background: "currentColor",
                          }} />
                          {analysis.confidence} confidence
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div style={{ padding: "20px 24px", borderTop: `1px solid ${BRAND.border}` }}>
                    <p style={{
                      fontSize: "15px",
                      lineHeight: "1.55",
                      color: BRAND.text,
                    }}>
                      {analysis.summary}
                    </p>
                  </div>

                  {/* Correction input */}
                  <div style={{
                    padding: "16px 24px 20px",
                    borderTop: `1px solid ${BRAND.border}`,
                    background: "#FAFAF7",
                  }}>
                    <p style={{
                      fontSize: "13px",
                      color: BRAND.textMuted,
                      marginBottom: "10px",
                      fontWeight: "500",
                    }}>
                      Something not right? Tell us more about your item:
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={correction}
                        onChange={(e) => setCorrection(e.target.value)}
                        placeholder='e.g. "It\'s 18k gold" or "It\'s a Rolex"'
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && correction) handleCorrection();
                        }}
                        style={{
                          flex: 1,
                          padding: "12px 14px",
                          fontSize: "14px",
                          fontFamily: font.body,
                          background: "white",
                          border: `1.5px solid ${BRAND.border}`,
                          borderRadius: "10px",
                          color: BRAND.text,
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={handleCorrection}
                        disabled={!correction || correcting}
                        style={{
                          padding: "12px 18px",
                          fontSize: "13px",
                          fontFamily: font.body,
                          fontWeight: "600",
                          background: correction && !correcting ? BRAND.gold : BRAND.border,
                          color: correction && !correcting ? "white" : BRAND.textLight,
                          border: "none",
                          borderRadius: "10px",
                          cursor: correction && !correcting ? "pointer" : "not-allowed",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {correcting ? "..." : "Update"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ─── DETAILS GRID ─── */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "10px",
                  marginBottom: "16px",
                }}>
                  {[
                    { label: "Item", value: analysis.itemType },
                    { label: "Material", value: analysis.material },
                    { label: "Karat", value: analysis.karatEstimate || "—" },
                    { label: "Est. Weight", value: analysis.weightRangeGrams ? `${analysis.weightRangeGrams.low}–${analysis.weightRangeGrams.high}g` : "—" },
                    { label: "Gemstones", value: analysis.gemstones || "None visible" },
                    { label: "Condition", value: analysis.condition },
                    ...(analysis.brand ? [{ label: "Brand", value: analysis.brand }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} style={{
                      background: "white",
                      border: `1px solid ${BRAND.border}`,
                      borderRadius: "12px",
                      padding: "14px",
                    }}>
                      <div style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: BRAND.textLight,
                        fontWeight: "600",
                        marginBottom: "3px",
                      }}>
                        {label}
                      </div>
                      <div style={{
                        fontSize: "14px",
                        fontWeight: "500",
                        color: BRAND.text,
                      }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ─── WARNINGS ─── */}
                {analysis.warnings?.length > 0 && (
                  <div style={{
                    background: BRAND.warm,
                    border: `1px solid #E8DCC8`,
                    borderRadius: "12px",
                    padding: "16px",
                    marginBottom: "16px",
                  }}>
                    <div style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: BRAND.goldDark,
                      marginBottom: "8px",
                    }}>
                      Things to note
                    </div>
                    <ul style={{
                      margin: 0,
                      paddingLeft: "16px",
                      fontSize: "13px",
                      color: BRAND.text,
                      lineHeight: "1.5",
                    }}>
                      {analysis.warnings.map((w, i) => (
                        <li key={i} style={{ marginBottom: "2px" }}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ─── CTA: SEND FOR FINAL OFFER ─── */}
                {emailStep === "idle" && (
                  <div style={{
                    background: `linear-gradient(135deg, ${BRAND.warm} 0%, white 100%)`,
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: "16px",
                    padding: "24px",
                    textAlign: "center",
                  }}>
                    <button
                      onClick={() => setEmailStep("form")}
                      style={{
                        width: "100%",
                        padding: "18px",
                        fontSize: "16px",
                        fontFamily: font.body,
                        fontWeight: "600",
                        background: `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldDark})`,
                        color: "white",
                        border: "none",
                        borderRadius: "12px",
                        cursor: "pointer",
                        boxShadow: "0 4px 16px rgba(200, 150, 62, 0.25)",
                        marginBottom: "14px",
                      }}
                    >
                      Send for Final Offer
                    </button>
                    <div style={{ display: "flex", justifyContent: "center", gap: "16px", flexWrap: "wrap" }}>
                      {["Free insured shipping", "No obligation", "48hr turnaround"].map((t) => (
                        <span key={t} style={{ fontSize: "12px", color: BRAND.textMuted }}>
                          <span style={{ color: BRAND.green }}>✓</span> {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {emailStep === "form" && (
                  <div style={{
                    background: "white",
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: "16px",
                    padding: "28px 24px",
                  }}>
                    <h3 style={{
                      fontFamily: font.display,
                      fontSize: "20px",
                      fontWeight: "500",
                      textAlign: "center",
                      marginBottom: "6px",
                      color: BRAND.charcoal,
                    }}>
                      Where should we send your kit?
                    </h3>
                    <p style={{
                      fontSize: "14px",
                      color: BRAND.textMuted,
                      textAlign: "center",
                      marginBottom: "20px",
                    }}>
                      Free prepaid & insured shipping label included.
                    </p>
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      maxWidth: "340px",
                      margin: "0 auto",
                    }}>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Your email"
                        style={{
                          padding: "14px 16px",
                          fontSize: "15px",
                          fontFamily: font.body,
                          background: "#FAFAF7",
                          border: `1.5px solid ${BRAND.border}`,
                          borderRadius: "10px",
                          color: BRAND.text,
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={() => { if (email) setEmailStep("done"); }}
                        disabled={!email}
                        style={{
                          padding: "16px",
                          fontSize: "15px",
                          fontFamily: font.body,
                          fontWeight: "600",
                          background: email
                            ? `linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldDark})`
                            : BRAND.border,
                          color: email ? "white" : BRAND.textLight,
                          border: "none",
                          borderRadius: "10px",
                          cursor: email ? "pointer" : "not-allowed",
                        }}
                      >
                        Send My Free Kit
                      </button>
                    </div>
                  </div>
                )}

                {emailStep === "done" && (
                  <div style={{
                    background: BRAND.greenLight,
                    border: `1px solid #C4E3D2`,
                    borderRadius: "16px",
                    padding: "28px",
                    textAlign: "center",
                  }}>
                    <div style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "50%",
                      background: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 14px",
                      boxShadow: "0 2px 8px rgba(45,143,94,0.15)",
                    }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={BRAND.green} strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <h3 style={{
                      fontFamily: font.display,
                      fontSize: "20px",
                      fontWeight: "500",
                      color: BRAND.green,
                      marginBottom: "8px",
                    }}>
                      You're all set!
                    </h3>
                    <p style={{
                      fontSize: "14px",
                      color: BRAND.text,
                      lineHeight: "1.5",
                      maxWidth: "300px",
                      margin: "0 auto",
                    }}>
                      Check your email for your free shipping kit. Once we receive your item, you'll get a firm offer within 48 hours.
                    </p>
                  </div>
                )}

                {/* ─── DISCLAIMER ─── */}
                <p style={{
                  fontSize: "11px",
                  color: BRAND.textLight,
                  textAlign: "center",
                  marginTop: "24px",
                  lineHeight: "1.5",
                }}>
                  This offer is based on visual analysis only. Final offer depends on physical inspection,
                  weight verification, purity testing, and current market conditions.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      {/* ─── FOOTER ─── */}
      <footer style={{
        borderTop: `1px solid ${BRAND.border}`,
        padding: "24px",
        textAlign: "center",
        fontSize: "13px",
        color: BRAND.textLight,
      }}>
        © {new Date().getFullYear()} Snappy · <a href="https://snappy.gold" style={{ color: BRAND.textMuted, textDecoration: "none" }}>snappy.gold</a>
      </footer>
    </div>
  );
}
