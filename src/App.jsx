import { useState, useRef } from "react";

export default function App() {
  const [image, setImage] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailStep, setEmailStep] = useState("idle");
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
              { type: "text", text: "You are a buyer at Snappy, a company that buys jewelry, watches, gold, silver, diamonds, and precious metals. Analyze this image and provide: 1) Item type 2) Material 3) Karat estimate if gold 4) Weight estimate in grams 5) Any gemstones 6) Brand if visible 7) Condition 8) Offer range in USD. Assume items are real unless obviously fake. Write a warm summary like: Based on what we can see, we would offer around $X-Y for this piece. Respond in JSON: {itemType, material, karatEstimate, brand, weightRangeGrams: {low, high}, gemstones, condition, estimateRange: {low, high}, confidence, warnings: [], summary}" },
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
              { type: "text", text: "You are a buyer at Snappy. The owner says: " + correction + ". Re-analyze with this info and update your offer. Respond in JSON: {itemType, material, karatEstimate, brand, weightRangeGrams: {low, high}, gemstones, condition, estimateRange: {low, high}, confidence, warnings: [], summary}" },
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

  const styles = {
    container: {
      minHeight: "100vh",
      background: "#FFFBF5",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: "#2D2A26",
    },
    header: {
      padding: "18px 24px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid #EDE8E0",
      background: "rgba(255,251,245,0.95)",
      position: "sticky",
      top: 0,
      zIndex: 10,
    },
    logo: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    logoIcon: {
      width: "32px",
      height: "32px",
      borderRadius: "8px",
      background: "linear-gradient(135deg, #C8963E, #E8C373)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: {
      fontSize: "22px",
      fontFamily: "'Playfair Display', Georgia, serif",
      fontWeight: "600",
      color: "#1C1C1C",
    },
    main: {
      maxWidth: "640px",
      margin: "0 auto",
      padding: "40px 20px 80px",
    },
    title: {
      fontFamily: "'Playfair Display', Georgia, serif",
      fontSize: "clamp(32px, 6vw, 44px)",
      fontWeight: "500",
      color: "#1C1C1C",
      lineHeight: "1.15",
      marginBottom: "14px",
      textAlign: "center",
    },
    subtitle: {
      fontSize: "17px",
      color: "#8A857D",
      lineHeight: "1.5",
      maxWidth: "380px",
      margin: "0 auto 32px",
      textAlign: "center",
    },
    primaryBtn: {
      width: "100%",
      padding: "18px",
      fontSize: "16px",
      fontWeight: "600",
      background: "linear-gradient(135deg, #C8963E, #A07428)",
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
    },
    secondaryBtn: {
      width: "100%",
      padding: "14px",
      fontSize: "14px",
      fontWeight: "500",
      background: "white",
      color: "#2D2A26",
      border: "1.5px solid #EDE8E0",
      borderRadius: "14px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
    },
    card: {
      background: "white",
      border: "1px solid #EDE8E0",
      borderRadius: "16px",
      overflow: "hidden",
      marginBottom: "16px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
    },
    imagePreview: {
      maxWidth: "100%",
      maxHeight: "280px",
      borderRadius: "10px",
      marginBottom: "10px",
    },
    offerAmount: {
      fontFamily: "'Playfair Display', Georgia, serif",
      fontSize: "34px",
      fontWeight: "600",
      color: "#1C1C1C",
      lineHeight: "1",
    },
    input: {
      flex: 1,
      padding: "12px 14px",
      fontSize: "14px",
      background: "white",
      border: "1.5px solid #EDE8E0",
      borderRadius: "10px",
      color: "#2D2A26",
      outline: "none",
    },
    smallBtn: {
      padding: "12px 18px",
      fontSize: "13px",
      fontWeight: "600",
      background: "#C8963E",
      color: "white",
      border: "none",
      borderRadius: "10px",
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    disabledBtn: {
      padding: "12px 18px",
      fontSize: "13px",
      fontWeight: "600",
      background: "#EDE8E0",
      color: "#B5AFA6",
      border: "none",
      borderRadius: "10px",
      cursor: "not-allowed",
      whiteSpace: "nowrap",
    },
    footer: {
      borderTop: "1px solid #EDE8E0",
      padding: "24px",
      textAlign: "center",
      fontSize: "13px",
      color: "#B5AFA6",
    },
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <span style={styles.logoText}>Snappy</span>
        </div>
        <span style={{ fontSize: "13px", color: "#8A857D" }}>snappy.gold</span>
      </header>

      <main style={styles.main}>
        {!analysis ? (
          <>
            <h1 style={styles.title}>
              Snap it. <span style={{ color: "#C8963E" }}>Sell it.</span>
            </h1>
            <p style={styles.subtitle}>
              Take a photo of your jewelry, watches, or precious metals. Get an instant offer in seconds.
            </p>

            <div style={{ display: "flex", justifyContent: "center", gap: "8px", flexWrap: "wrap", marginBottom: "32px" }}>
              {["Gold", "Silver", "Diamonds", "Watches", "Platinum"].map((cat) => (
                <span key={cat} style={{
                  padding: "6px 14px",
                  borderRadius: "100px",
                  fontSize: "13px",
                  fontWeight: "500",
                  background: "#FFF6E9",
                  color: "#A07428",
                  border: "1px solid #EDE8E0",
                }}>{cat}</span>
              ))}
            </div>

            {!image ? (
              <div style={{ marginBottom: "24px" }}>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} style={{ display: "none" }} />
                <button onClick={() => cameraInputRef.current?.click()} style={styles.primaryBtn}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  Open Camera
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
                <button onClick={() => fileInputRef.current?.click()} style={styles.secondaryBtn}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A857D" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                  </svg>
                  Upload Photo
                </button>
              </div>
            ) : (
              <div style={{ ...styles.card, padding: "16px", textAlign: "center", marginBottom: "16px" }}>
                <img src={image} alt="Your item" style={styles.imagePreview} />
                <button onClick={() => { setImage(null); setImageData(null); }} style={{ background: "none", border: "none", color: "#8A857D", fontSize: "13px", cursor: "pointer", textDecoration: "underline" }}>
                  Choose a different photo
                </button>
              </div>
            )}

            {image && (
              <button onClick={analyzeImage} disabled={loading} style={{ ...styles.primaryBtn, background: loading ? "#B5AFA6" : styles.primaryBtn.background, boxShadow: loading ? "none" : styles.primaryBtn.boxShadow, cursor: loading ? "wait" : "pointer", marginBottom: "24px" }}>
                {loading ? "Analyzing your item..." : "Get Instant Offer"}
              </button>
            )}

            <div style={{ display: "flex", justifyContent: "center", gap: "20px", flexWrap: "wrap", marginTop: "16px" }}>
              {["Free & instant", "No obligation", "Insured shipping"].map((text) => (
                <span key={text} style={{ fontSize: "13px", color: "#8A857D" }}>
                  <span style={{ color: "#2D8F5E", fontWeight: "700" }}>✓</span> {text}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div>
            <button onClick={reset} style={{ background: "none", border: "none", color: "#C8963E", fontSize: "14px", fontWeight: "500", cursor: "pointer", marginBottom: "20px", padding: 0 }}>
              ← Scan another item
            </button>

            {analysis.error ? (
              <div style={{ ...styles.card, padding: "24px", textAlign: "center", background: "#FFF5F5", border: "1px solid #F5D0CC" }}>
                <p style={{ color: "#C44B3F", fontWeight: "500" }}>{analysis.error}</p>
                <p style={{ color: "#8A857D", fontSize: "13px", marginTop: "8px" }}>{analysis.summary}</p>
              </div>
            ) : (
              <>
                <div style={styles.card}>
                  <div style={{ background: "linear-gradient(135deg, #FFF6E9 0%, white 100%)", padding: "24px", display: "flex", gap: "20px" }}>
                    <img src={image} alt="Your item" style={{ width: "90px", height: "90px", objectFit: "cover", borderRadius: "12px", border: "1px solid #EDE8E0" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#8A857D", fontWeight: "600", marginBottom: "4px" }}>Instant Offer</div>
                      <div style={styles.offerAmount}>
                        ${analysis.estimateRange?.low?.toLocaleString()}-${analysis.estimateRange?.high?.toLocaleString()}
                      </div>
                      <div style={{ marginTop: "8px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 14px", borderRadius: "100px", fontSize: "12px", fontWeight: "500", background: analysis.confidence === "high" ? "#E8F5EE" : "#FFF6E9", color: analysis.confidence === "high" ? "#2D8F5E" : "#A07428" }}>
                          {analysis.confidence} confidence
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: "20px 24px", borderTop: "1px solid #EDE8E0" }}>
                    <p style={{ fontSize: "15px", lineHeight: "1.55" }}>{analysis.summary}</p>
                  </div>
                  <div style={{ padding: "16px 24px 20px", borderTop: "1px solid #EDE8E0", background: "#FAFAF7" }}>
                    <p style={{ fontSize: "13px", color: "#8A857D", marginBottom: "10px", fontWeight: "500" }}>Something not right? Tell us more:</p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input type="text" value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="e.g. 18k gold, Rolex, 20 grams" style={styles.input} />
                      <button onClick={handleCorrection} disabled={!correction || correcting} style={correction && !correcting ? styles.smallBtn : styles.disabledBtn}>
                        {correcting ? "..." : "Update"}
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", marginBottom: "16px" }}>
                  {[
                    { label: "Item", value: analysis.itemType },
                    { label: "Material", value: analysis.material },
                    { label: "Karat", value: analysis.karatEstimate || "-" },
                    { label: "Est. Weight", value: analysis.weightRangeGrams ? analysis.weightRangeGrams.low + "-" + analysis.weightRangeGrams.high + "g" : "-" },
                    { label: "Gemstones", value: analysis.gemstones || "None visible" },
                    { label: "Condition", value: analysis.condition },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ ...styles.card, padding: "14px", marginBottom: 0 }}>
                      <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#B5AFA6", fontWeight: "600", marginBottom: "3px" }}>{label}</div>
                      <div style={{ fontSize: "14px", fontWeight: "500" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {emailStep === "idle" && (
                  <div style={{ ...styles.card, padding: "24px", textAlign: "center", background: "linear-gradient(135deg, #FFF6E9 0%, white 100%)" }}>
                    <button onClick={() => setEmailStep("form")} style={{ ...styles.primaryBtn, marginBottom: "14px" }}>
                      Send for Final Offer
                    </button>
                    <div style={{ display: "flex", justifyContent: "center", gap: "16px", flexWrap: "wrap" }}>
                      {["Free insured shipping", "No obligation", "48hr turnaround"].map((t) => (
                        <span key={t} style={{ fontSize: "12px", color: "#8A857D" }}>
                          <span style={{ color: "#2D8F5E" }}>✓</span> {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {emailStep === "form" && (
                  <div style={{ ...styles.card, padding: "28px 24px" }}>
                    <h3 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "20px", fontWeight: "500", textAlign: "center", marginBottom: "6px", color: "#1C1C1C" }}>
                      Where should we send your kit?
                    </h3>
                    <p style={{ fontSize: "14px", color: "#8A857D", textAlign: "center", marginBottom: "20px" }}>
                      Free prepaid & insured shipping label included.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "340px", margin: "0 auto" }}>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" style={{ ...styles.input, padding: "14px 16px", fontSize: "15px", background: "#FAFAF7" }} />
                      <button onClick={() => { if (email) setEmailStep("done"); }} disabled={!email} style={email ? styles.primaryBtn : { ...styles.primaryBtn, background: "#EDE8E0", color: "#B5AFA6", boxShadow: "none", cursor: "not-allowed" }}>
                        Send My Free Kit
                      </button>
                    </div>
                  </div>
                )}

                {emailStep === "done" && (
                  <div style={{ ...styles.card, padding: "28px", textAlign: "center", background: "#E8F5EE", border: "1px solid #C4E3D2" }}>
                    <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "white", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: "0 2px 8px rgba(45,143,94,0.15)" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2D8F5E" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <h3 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "20px", fontWeight: "500", color: "#2D8F5E", marginBottom: "8px" }}>
                      You are all set!
                    </h3>
                    <p style={{ fontSize: "14px", color: "#2D2A26", lineHeight: "1.5", maxWidth: "300px", margin: "0 auto" }}>
                      Check your email for your free shipping kit. Once we receive your item, you will get a firm offer within 48 hours.
                    </p>
                  </div>
                )}

                <p style={{ fontSize: "11px", color: "#B5AFA6", textAlign: "center", marginTop: "24px", lineHeight: "1.5" }}>
                  This offer is based on visual analysis only. Final offer depends on physical inspection, weight verification, purity testing, and current market conditions.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      <footer style={styles.footer}>
        © {new Date().getFullYear()} Snappy · <a href="https://snappy.gold" style={{ color: "#8A857D", textDecoration: "none" }}>snappy.gold</a>
      </footer>
    </div>
  );
}

