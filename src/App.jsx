import React, { useState, useRef, useCallback, useEffect } from 'react'

/* ─────────────────────────────────────────────
   SNAPPY.GOLD — Full Application
   Flow: Hero → Capture → Analysis → Offer → Lead Form
   ───────────────────────────────────────────── */

const STEPS = {
  HERO: 'hero',
  CAPTURE: 'capture',
  ANALYZING: 'analyzing',
  OFFER: 'offer',
  LEAD_FORM: 'lead_form',
  SUBMITTED: 'submitted',
}

// ── Utility: compress image before sending ──
function compressImage(file, maxDim = 1600) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        // Use createImageBitmap if available — it auto-corrects EXIF orientation
        if (typeof createImageBitmap !== 'undefined') {
          createImageBitmap(file).then((bitmap) => {
            const canvas = document.createElement('canvas')
            const scale = Math.min(maxDim / Math.max(bitmap.width, bitmap.height), 1)
            canvas.width = bitmap.width * scale
            canvas.height = bitmap.height * scale
            const ctx = canvas.getContext('2d')
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          }).catch(() => {
            // Fallback
            const canvas = document.createElement('canvas')
            const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
            canvas.width = img.width * scale
            canvas.height = img.height * scale
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          })
        } else {
          const canvas = document.createElement('canvas')
          const scale = Math.min(maxDim / Math.max(img.width, img.height), 1)
          canvas.width = img.width * scale
          canvas.height = img.height * scale
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

// ── API: Send image to Claude for analysis ──
async function analyzeImage(base64Data, corrections) {
  const mediaType = 'image/jpeg'
  const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '')

  let promptText = `You are an expert appraiser for Snappy, a modern precious metals and luxury goods buyer. Analyze this image and provide a preliminary assessment.

IMPORTANT GUIDELINES FOR ASSESSMENT:
- If an item appears to be gold, ASSUME it is real gold. Estimate the karat (10K, 14K, or 18K) based on the color/hue — lighter yellow suggests 10K, classic yellow suggests 14K, rich deep yellow suggests 18K.
- If diamonds or gemstones are visible, ASSUME they are genuine unless there are obvious visual signs they are not (e.g. clearly plastic, costume jewelry construction).
- If a watch appears to be a known brand (Rolex, Omega, Cartier, etc.), ASSUME it is authentic unless there are obvious signs of being counterfeit (misaligned text, poor finishing, wrong proportions).
- If silver-colored metal is present, assess whether it is likely sterling silver, white gold, or platinum based on visual cues.
- Be optimistic but not unreasonable. Give the seller the benefit of the doubt. Final verification happens in person.
- Never use the word "AI" in any of your responses.

Respond ONLY in this exact JSON format, no markdown fences.

FOR WATCHES, use these detail fields:
{
  "item_type": "watch",
  "title": "e.g. 'Rolex Submariner Date 116610LN'",
  "description": "2-3 sentence confident description. Assume box and papers are available and include that in the description, e.g. 'Complete set with original box and papers.'",
  "confidence": "high | medium | low",
  "details": [
    {"label": "Brand/Maker", "value": "e.g. Rolex"},
    {"label": "Model/Reference", "value": "e.g. Submariner Date 116610LN"},
    {"label": "Condition", "value": "e.g. Excellent - light desk diving marks"},
    {"label": "Est. Year of Production", "value": "e.g. 2018-2020"},
    {"label": "Box & Papers", "value": "Assumed available"}
  ],
  "offer_low": 8000,
  "offer_high": 12000,
  "offer_notes": "Based on current market value for this reference with complete set (box & papers). Final offer depends on in-person verification of authenticity and condition."
}

FOR JEWELRY, GOLD, SILVER, COINS, AND OTHER PRECIOUS METALS, use these detail fields:
{
  "item_type": "ring | necklace | bracelet | earrings | coin | bar | other",
  "title": "Brief descriptive title, e.g. '14K Yellow Gold Cuban Link Chain'",
  "description": "2-3 sentence description of what you see including materials, quality indicators, brand if visible. Be confident in your assessment. Do not hedge with words like 'appears to be' or 'possibly' — state what it is.",
  "confidence": "high | medium | low",
  "details": [
    {"label": "Material", "value": "e.g. 14K Yellow Gold"},
    {"label": "Estimated Weight", "value": "e.g. 15-20 grams"},
    {"label": "Condition", "value": "e.g. Good - minor surface wear"},
    {"label": "Brand/Maker", "value": "e.g. Unknown / Tiffany & Co. / etc"}
  ],
  "offer_low": 150,
  "offer_high": 400,
  "offer_notes": "Brief note on what drives the range. Reference current spot prices and item specifics. Final offer depends on in-person verification."
}

If the image is not of jewelry, a watch, or precious metals, set item_type to "other", offer_low and offer_high to 0, and explain in description what you see instead.

Price based on current market rates. Gold spot is roughly $2,300-2,400/oz. Silver ~$30/oz. For watches, price based on current secondary market values for the specific reference.`

  if (corrections) {
    promptText += `\n\nIMPORTANT: The user has corrected the following details about this item. Use these corrections to provide a more accurate assessment and updated offer range:\n${corrections}`
  }

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: rawBase64,
            },
          },
          {
            type: 'text',
            text: promptText,
          },
        ],
      },
    ],
  }

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error('Analysis request failed')
  const data = await res.json()

  const text = data.content
    ?.map((block) => block.text || '')
    .join('')
    .trim()

  if (!text) throw new Error('No analysis returned')

  // Parse JSON from response (strip any accidental fences)
  const cleaned = text.replace(/```json|```/g, '').trim()
  return JSON.parse(cleaned)
}

// ── Icons (inline SVG) ──
const CameraIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const UploadIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const SparkleIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
  </svg>
)

const CheckIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const ArrowIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

// ═══════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════
export default function App() {
  const [step, setStep] = useState(STEPS.HERO)
  const [imageData, setImageData] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState(null)
  const [leadData, setLeadData] = useState({ name: '', email: '', phone: '', notes: '' })
  const [isReEstimating, setIsReEstimating] = useState(false)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  // Handle file selection (gallery or camera)
  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError(null)
    const base64 = await compressImage(file)
    setImageData(base64)
    setStep(STEPS.ANALYZING)

    try {
      const result = await analyzeImage(base64)
      setAnalysis(result)
      setStep(STEPS.OFFER)
    } catch (err) {
      console.error('Analysis error:', err)
      setError('We could not analyze that image. Please try a clearer photo.')
      setStep(STEPS.CAPTURE)
    }
  }, [])

  // Re-analyze with user corrections
  const handleReEstimate = useCallback(async (corrections) => {
    if (!imageData) return
    setIsReEstimating(true)
    try {
      const result = await analyzeImage(imageData, corrections)
      setAnalysis(result)
    } catch (err) {
      console.error('Re-estimate error:', err)
    }
    setIsReEstimating(false)
  }, [imageData])

  const reset = () => {
    setStep(STEPS.HERO)
    setImageData(null)
    setAnalysis(null)
    setError(null)
    setLeadData({ name: '', email: '', phone: '', notes: '' })
  }

  const handleLeadSubmit = (e) => {
    e.preventDefault()
    // In production, POST this to your CRM / email service / Airtable / etc.
    console.log('Lead submitted:', { ...leadData, analysis, imageData: '[base64]' })
    setStep(STEPS.SUBMITTED)
  }

  return (
    <div style={styles.app}>
      {/* ── NAV ── */}
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          <button onClick={reset} style={styles.logoBtn}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              {/* Camera body */}
              <rect x="1" y="8" width="30" height="20" rx="3" fill="url(#logoGrad)" />
              {/* Camera top bump */}
              <path d="M10 8L12 4H20L22 8" fill="url(#logoGrad)" />
              {/* Lens outer */}
              <circle cx="16" cy="18" r="8" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.5" />
              {/* Lens inner */}
              <circle cx="16" cy="18" r="5.5" fill="none" stroke="#fff" strokeWidth="1" opacity="0.3" />
              {/* $ sign */}
              <text x="16" y="22" textAnchor="middle" fill="#fff" fontFamily="Playfair Display, serif" fontWeight="700" fontSize="13">$</text>
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#B8860B" />
                  <stop offset="1" stopColor="#C8953C" />
                </linearGradient>
              </defs>
            </svg>
            <span style={styles.logoWordmark}>
              <span style={styles.logoText}>snappy</span>
              <span style={styles.logoDot}>.gold</span>
            </span>
          </button>
          {step !== STEPS.HERO && (
            <button onClick={reset} style={styles.navReset}>Start Over</button>
          )}
        </div>
      </nav>

      <main style={styles.main}>
        {step === STEPS.HERO && (
          <Hero
            onStart={() => setStep(STEPS.CAPTURE)}
            onCamera={() => cameraInputRef.current?.click()}
            onUpload={() => fileInputRef.current?.click()}
          />
        )}
        {step === STEPS.CAPTURE && (
          <CaptureScreen
            fileInputRef={fileInputRef}
            cameraInputRef={cameraInputRef}
            onFile={handleFile}
            error={error}
          />
        )}
        {step === STEPS.ANALYZING && <AnalyzingScreen imageData={imageData} />}
        {step === STEPS.OFFER && analysis && (
          <OfferScreen
            analysis={analysis}
            imageData={imageData}
            onGetOffer={() => setStep(STEPS.LEAD_FORM)}
            onRetry={() => setStep(STEPS.CAPTURE)}
            onReEstimate={handleReEstimate}
            isReEstimating={isReEstimating}
          />
        )}
        {step === STEPS.LEAD_FORM && (
          <LeadForm
            leadData={leadData}
            setLeadData={setLeadData}
            onSubmit={handleLeadSubmit}
            analysis={analysis}
          />
        )}
        {step === STEPS.SUBMITTED && <SubmittedScreen onReset={reset} />}
      </main>

      {/* ── FOOTER ── */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>© 2025 Snappy · snappy.gold</p>
        <p style={styles.footerDisclaimer}>
          Estimates are preliminary and not binding. Final offers require in-person evaluation.
        </p>
      </footer>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════
//  HERO SECTION
// ═══════════════════════════════════════════════
function Hero({ onStart, onCamera, onUpload }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  const GoldBarIcon = () => <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M2 11L0 5h16l-2 6H2z" fill="#D4A017"/><path d="M0 5l3-5h10l3 5H0z" fill="#F0C75E"/><path d="M3 0h10l3 5H0L3 0z" fill="#F0C75E" opacity="0.9"/><path d="M2 11L0 5h16l-2 6H2z" fill="#C8953C" opacity="0.8"/></svg>
  const SilverBarIcon = () => <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M2 11L0 5h16l-2 6H2z" fill="#A8A8A8"/><path d="M0 5l3-5h10l3 5H0z" fill="#D0D0D0"/><path d="M2 11L0 5h16l-2 6H2z" fill="#999" opacity="0.8"/></svg>
  const PlatBarIcon = () => <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M2 11L0 5h16l-2 6H2z" fill="#B8C5D0"/><path d="M0 5l3-5h10l3 5H0z" fill="#DDE5EB"/><path d="M2 11L0 5h16l-2 6H2z" fill="#9EAEBB" opacity="0.8"/></svg>
  const NecklaceIcon = () => <svg width="14" height="16" viewBox="0 0 14 16" fill="none"><path d="M1 1C1 1 0 8 7 12C14 8 13 1 13 1" stroke="#C8953C" strokeWidth="1.5" fill="none" strokeLinecap="round"/><circle cx="7" cy="13" r="2" fill="#C8953C"/></svg>
  const DiamondIcon = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L13 5L7 13L1 5L7 1Z" fill="#B8E0F0" stroke="#7CB9D0" strokeWidth="0.5"/><path d="M1 5H13L7 13L1 5Z" fill="#A0D4EA" opacity="0.6"/></svg>
  const CoinIcon = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="#F0C75E" stroke="#C8953C" strokeWidth="1"/><text x="7" y="10" textAnchor="middle" fill="#A07608" fontSize="8" fontWeight="bold">$</text></svg>

  const categories = [
    { name: 'Gold', icon: <GoldBarIcon /> },
    { name: 'Watches', icon: '⌚' },
    { name: 'Silver', icon: <SilverBarIcon /> },
    { name: 'Jewelry', icon: <NecklaceIcon /> },
    { name: 'Diamonds', icon: <DiamondIcon /> },
    { name: 'Platinum', icon: <PlatBarIcon /> },
    { name: 'Coins', icon: <CoinIcon /> },
  ]

  return (
    <section style={{ ...styles.heroSection, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)', transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <div style={styles.categoryBar}>
        {categories.map((cat, i) => (
          <React.Fragment key={cat.name}>
            <span style={styles.categoryItem}>
              <span style={styles.categoryIcon}>{cat.icon}</span>
              <span>{cat.name}</span>
            </span>
            {i < categories.length - 1 && <span style={styles.categorySep}>·</span>}
          </React.Fragment>
        ))}
      </div>
      <h1 style={styles.heroTitle}>
        Snap a photo.<br />
        <span style={styles.heroTitleGold}>Get an offer.</span>
      </h1>
      <p style={styles.heroSubtitle}>
        Photograph your valuables and receive an instant estimate. No commitment, no hassle.
      </p>
      <div style={styles.heroButtons}>
        <button onClick={onCamera} style={styles.captureBtn}>
          <CameraIcon size={20} />
          <span>Take a Photo</span>
        </button>
        <button onClick={onUpload} style={styles.captureBtnSecondary}>
          <UploadIcon size={20} />
          <span>Upload a Photo</span>
        </button>
      </div>
      <div style={styles.trustRow}>
        {['Free & instant', 'No obligation', 'Fair market pricing'].map((t) => (
          <div key={t} style={styles.trustItem}>
            <CheckIcon size={15} />
            <span>{t}</span>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div style={styles.stepsGrid}>
        {[
          { num: '1', title: 'Snap', desc: 'Take or upload a clear photo of your item' },
          { num: '2', title: 'Review', desc: 'We identify materials, brand & condition' },
          { num: '3', title: 'Get Paid', desc: 'Accept your offer and ship with a prepaid label' },
        ].map((s) => (
          <div key={s.num} style={styles.stepCard}>
            <div style={styles.stepNum}>{s.num}</div>
            <h3 style={styles.stepTitle}>{s.title}</h3>
            <p style={styles.stepDesc}>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  CAPTURE SCREEN
// ═══════════════════════════════════════════════
function CaptureScreen({ fileInputRef, cameraInputRef, onFile, error }) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onFile(file)
  }

  return (
    <section style={styles.centeredSection}>
      <h2 style={styles.sectionTitle}>What are you selling?</h2>
      <p style={styles.sectionSub}>Take a clear photo or upload one from your gallery.</p>

      {error && <div style={styles.errorMsg}>{error}</div>}

      <div
        style={{
          ...styles.dropZone,
          borderColor: dragOver ? '#C8953C' : '#D4C5A9',
          background: dragOver ? 'rgba(200, 149, 60, 0.05)' : '#FFFDF8',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div style={styles.dropZoneInner}>
          <div style={styles.dropIcon}>
            <CameraIcon size={40} />
          </div>
          <p style={styles.dropText}>Drag & drop an image here</p>
          <p style={styles.dropSubtext}>or use the buttons below</p>
        </div>
      </div>

      <div style={styles.captureButtons}>
        <button
          onClick={() => cameraInputRef.current?.click()}
          style={styles.captureBtn}
        >
          <CameraIcon size={20} />
          <span>Take Photo</span>
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={styles.captureBtnSecondary}
        >
          <UploadIcon size={20} />
          <span>Upload Image</span>
        </button>
      </div>

      <div style={styles.tipBox}>
        <strong>Tips for the best estimate:</strong>
        <span> Use good lighting · Show any stamps or hallmarks · Include a coin for scale</span>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  ANALYZING SCREEN
// ═══════════════════════════════════════════════
function AnalyzingScreen({ imageData }) {
  const [dots, setDots] = useState('')
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <section style={styles.centeredSection}>
      <div style={styles.analyzingCard}>
        {imageData && (
          <div style={styles.analyzingImageWrap}>
            <img src={imageData} alt="Your item" style={styles.analyzingImage} />
            <div style={styles.scanLine} />
          </div>
        )}
        <div style={styles.analyzingText}>
          <div style={styles.spinner} />
          <h2 style={styles.analyzingTitle}>Analyzing your item{dots}</h2>
          <p style={styles.analyzingSub}>
            Examining materials, craftsmanship, brand markers, and current market prices.
          </p>
        </div>
      </div>
    </section>
  )
}

// ── Inline editable detail field ──
const PencilIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
)

function EditableDetail({ label, value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setEditValue(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  const save = () => {
    setEditing(false)
    if (editValue.trim() !== value) onChange(editValue.trim())
  }

  if (editing) {
    return (
      <div style={styles.detailRow}>
        <span style={styles.detailLabel}>{label}</span>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          style={styles.detailEditInput}
        />
      </div>
    )
  }

  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={styles.detailValueWrap}>
        <span style={styles.detailValue}>{value}</span>
        <button onClick={() => setEditing(true)} style={styles.pencilBtn} title="Edit">
          <PencilIcon size={13} />
        </button>
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  OFFER SCREEN
// ═══════════════════════════════════════════════
function OfferScreen({ analysis, imageData, onGetOffer, onRetry, onReEstimate, isReEstimating }) {
  const [visible, setVisible] = useState(false)
  const [showCorrections, setShowCorrections] = useState(false)
  const [corrections, setCorrections] = useState(() =>
    (analysis.details || []).reduce((acc, d) => ({ ...acc, [d.label]: d.value }), {})
  )
  const [extraNotes, setExtraNotes] = useState('')
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])
  useEffect(() => {
    setCorrections((analysis.details || []).reduce((acc, d) => ({ ...acc, [d.label]: d.value }), {}))
    setShowCorrections(false)
    setExtraNotes('')
  }, [analysis])

  const isValidItem = analysis.offer_low > 0 || analysis.offer_high > 0

  const handleReEstimate = () => {
    const correctionLines = Object.entries(corrections)
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n')
    const full = extraNotes ? `${correctionLines}\nAdditional info: ${extraNotes}` : correctionLines
    onReEstimate(full)
  }

  return (
    <section style={{ ...styles.centeredSection, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(15px)', transition: 'all 0.6s ease' }}>
      {isValidItem ? (
        <>
          <div style={styles.offerBadge}>
            <SparkleIcon size={14} />
            <span>Preliminary Estimate</span>
          </div>

          <div style={{ ...styles.offerCard, position: 'relative', overflow: 'hidden' }}>
            {isReEstimating && (
              <div style={styles.reEstimateOverlay}>
                <div style={styles.reEstimateScanLine} />
                <div style={styles.reEstimateText}>
                  <div style={styles.spinnerGreen} />
                  <span>Updating estimate...</span>
                </div>
              </div>
            )}
            <div style={{ opacity: isReEstimating ? 0.3 : 1, transition: 'opacity 0.3s', filter: isReEstimating ? 'blur(1px)' : 'none' }}>
            <div style={styles.offerTop}>
              {imageData && <img src={imageData} alt="Your item" style={styles.offerImage} />}
              <div style={styles.offerInfo}>
                <h2 style={styles.offerTitle}>{analysis.title}</h2>
                <p style={styles.offerDesc}>{analysis.description}</p>
              </div>
            </div>

            <div style={styles.offerDetails}>
              {analysis.details?.map((d, i) => (
                <EditableDetail
                  key={i}
                  label={d.label}
                  value={corrections[d.label] || d.value}
                  onChange={(newVal) => setCorrections(prev => ({ ...prev, [d.label]: newVal }))}
                />
              ))}
            </div>

            <div style={styles.offerRange}>
              <p style={styles.offerRangeLabel}>Estimated Offer Range</p>
              <div style={styles.offerPrices}>
                <span style={styles.offerPrice}>${analysis.offer_low?.toLocaleString()}</span>
                <span style={styles.offerDash}>—</span>
                <span style={styles.offerPrice}>${analysis.offer_high?.toLocaleString()}</span>
              </div>
              {analysis.offer_notes && (
                <p style={styles.offerNotes}>{analysis.offer_notes}</p>
              )}
            </div>

            {/* Correction section */}
            </div>{/* close opacity wrapper */}
            <div style={styles.correctionSection}>
              {!showCorrections ? (
                <button onClick={() => setShowCorrections(true)} style={styles.correctionToggle}>
                  Something not right? Edit the fields above or add details below →
                </button>
              ) : (
                <div style={styles.correctionForm}>
                  <p style={styles.correctionSub}>Edit any detail above using the pencil icon, or add extra info below.</p>
                  <div style={styles.correctionRow}>
                    <label style={styles.correctionLabel}>Additional details</label>
                    <input
                      type="text"
                      value={extraNotes}
                      onChange={(e) => setExtraNotes(e.target.value)}
                      placeholder="e.g. It is 18K not 14K, weight is 25g, brand is Cartier..."
                      style={styles.correctionInput}
                    />
                  </div>
                  <button
                    onClick={handleReEstimate}
                    disabled={isReEstimating}
                    style={{ ...styles.captureBtn, opacity: isReEstimating ? 0.6 : 1, width: '100%', justifyContent: 'center', marginTop: 8 }}
                  >
                    {isReEstimating ? 'Updating estimate...' : 'Update Estimate'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <button onClick={onGetOffer} style={styles.firmOfferBtn}>
            <span>Get My Firm Offer</span>
            <ArrowIcon size={18} />
          </button>
          <p style={styles.offerCaveat}>
            Free prepaid shipping · Expert in-person evaluation · Payment within 24 hours
          </p>
        </>
      ) : (
        <div style={styles.offerCard}>
          <h2 style={{ ...styles.offerTitle, textAlign: 'center' }}>Hmm, that doesn't look quite right</h2>
          <p style={{ ...styles.offerDesc, textAlign: 'center' }}>{analysis.description}</p>
          <p style={{ ...styles.offerDesc, textAlign: 'center', marginTop: 8 }}>
            Try again with a clear photo of jewelry, a watch, or precious metals.
          </p>
        </div>
      )}
      <button onClick={onRetry} style={styles.linkBtn}>
        ← Try a different photo
      </button>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  LEAD FORM
// ═══════════════════════════════════════════════
function LeadForm({ leadData, setLeadData, onSubmit, analysis }) {
  const update = (field) => (e) =>
    setLeadData((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <section style={styles.centeredSection}>
      <h2 style={styles.sectionTitle}>Almost there!</h2>
      <p style={styles.sectionSub}>
        Enter your details and we'll send a prepaid shipping label. Once we receive and verify your{' '}
        <strong>{analysis?.title?.toLowerCase() || 'item'}</strong>, we'll make a firm offer — typically within 24 hours.
      </p>

      <form onSubmit={onSubmit} style={styles.form}>
        <div style={styles.formGroup}>
          <label style={styles.formLabel}>Full Name *</label>
          <input
            type="text"
            required
            value={leadData.name}
            onChange={update('name')}
            placeholder="Jane Smith"
            style={styles.formInput}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.formLabel}>Email *</label>
          <input
            type="email"
            required
            value={leadData.email}
            onChange={update('email')}
            placeholder="jane@email.com"
            style={styles.formInput}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.formLabel}>Phone (optional)</label>
          <input
            type="tel"
            value={leadData.phone}
            onChange={update('phone')}
            placeholder="(555) 555-1234"
            style={styles.formInput}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.formLabel}>Anything else about this item?</label>
          <textarea
            value={leadData.notes}
            onChange={update('notes')}
            placeholder="e.g. inherited from grandmother, purchased at Tiffany's in 2018, has original box..."
            rows={3}
            style={{ ...styles.formInput, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <button type="submit" style={styles.heroCta}>
          <span>Send Me a Shipping Label</span>
          <ArrowIcon size={18} />
        </button>
        <p style={styles.formDisclaimer}>
          No cost, no commitment. If you don't like our offer, we ship your item back free.
        </p>
      </form>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  SUBMITTED CONFIRMATION
// ═══════════════════════════════════════════════
function SubmittedScreen({ onReset }) {
  return (
    <section style={styles.centeredSection}>
      <div style={styles.successIcon}>
        <CheckIcon size={40} />
      </div>
      <h2 style={styles.sectionTitle}>You're all set!</h2>
      <p style={styles.sectionSub}>
        Check your email for a prepaid shipping label and instructions. Once we receive your item, expect a firm offer within 24 hours.
      </p>
      <div style={styles.successSteps}>
        {[
          'Prepaid label emailed to you',
          'Ship your item (free & insured)',
          'Expert evaluation within 24 hours',
          'Accept offer → get paid instantly',
        ].map((s, i) => (
          <div key={i} style={styles.successStep}>
            <div style={styles.successStepNum}>{i + 1}</div>
            <span>{s}</span>
          </div>
        ))}
      </div>
      <button onClick={onReset} style={styles.captureBtnSecondary}>
        Evaluate Another Item
      </button>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════
const gold = '#B8860B'
const goldLight = '#C8953C'
const goldBg = '#F9F1E0'
const cream = '#FFFBF5'
const dark = '#1A1714'
const muted = '#7A7062'
const border = '#E8DFD0'

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"DM Sans", -apple-system, sans-serif',
    color: dark,
    background: cream,
  },

  // ── Nav ──
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: 'rgba(255, 251, 245, 0.9)',
    backdropFilter: 'blur(12px)',
    borderBottom: `1px solid ${border}`,
  },
  navInner: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '14px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  logoWordmark: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 0,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: `linear-gradient(135deg, ${gold}, ${goldLight})`,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '"Playfair Display", serif',
    fontWeight: 700,
    fontSize: 18,
  },
  logoText: {
    fontWeight: 600,
    fontSize: 20,
    color: dark,
    letterSpacing: '-0.02em',
  },
  logoDot: {
    fontWeight: 600,
    fontSize: 20,
    color: gold,
    letterSpacing: '-0.02em',
  },
  navReset: {
    background: 'none',
    border: `1px solid ${border}`,
    padding: '7px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    color: muted,
    fontFamily: 'inherit',
    transition: 'all 0.2s',
  },

  // ── Main ──
  main: {
    flex: 1,
    maxWidth: 960,
    margin: '0 auto',
    width: '100%',
    padding: '0 24px',
  },

  // ── Hero ──
  heroSection: {
    textAlign: 'center',
    paddingTop: 72,
    paddingBottom: 80,
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 16px',
    borderRadius: 100,
    background: goldBg,
    color: gold,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 28,
    letterSpacing: '0.02em',
  },
  categoryBar: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '4px 6px',
    marginBottom: 28,
  },
  categoryItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 14,
    color: muted,
    letterSpacing: '0.01em',
  },
  categoryIcon: {
    fontSize: 12,
  },
  categorySep: {
    color: '#D4C5A9',
    fontSize: 18,
    lineHeight: 1,
    userSelect: 'none',
  },
  heroButtons: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  heroTitle: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 'clamp(36px, 7vw, 64px)',
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: dark,
    marginBottom: 20,
  },
  heroTitleGold: {
    color: gold,
  },
  heroSubtitle: {
    fontSize: 18,
    color: muted,
    maxWidth: 520,
    margin: '0 auto 36px',
    lineHeight: 1.6,
  },
  heroCta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 32px',
    borderRadius: 12,
    background: `linear-gradient(135deg, ${gold}, ${goldLight})`,
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.25s ease',
    boxShadow: '0 4px 16px rgba(184, 134, 11, 0.3)',
  },
  trustRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 24,
    marginTop: 28,
    flexWrap: 'wrap',
  },
  trustItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    color: muted,
  },
  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 24,
    marginTop: 64,
  },
  stepCard: {
    padding: 28,
    borderRadius: 16,
    border: `1px solid ${border}`,
    background: '#FFFDF8',
    textAlign: 'left',
  },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: goldBg,
    color: gold,
    fontWeight: 700,
    fontSize: 15,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  stepTitle: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 6,
  },
  stepDesc: {
    fontSize: 14,
    color: muted,
    lineHeight: 1.5,
  },

  // ── Centered section ──
  centeredSection: {
    textAlign: 'center',
    paddingTop: 48,
    paddingBottom: 64,
    maxWidth: 600,
    margin: '0 auto',
  },
  sectionTitle: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 28,
    fontWeight: 600,
    marginBottom: 12,
  },
  sectionSub: {
    fontSize: 16,
    color: muted,
    lineHeight: 1.6,
    marginBottom: 32,
  },

  // ── Capture ──
  dropZone: {
    border: '2px dashed',
    borderRadius: 16,
    padding: 48,
    marginBottom: 24,
    transition: 'all 0.2s',
    cursor: 'pointer',
  },
  dropZoneInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  dropIcon: { color: goldLight, opacity: 0.7 },
  dropText: { fontSize: 16, fontWeight: 500, color: dark },
  dropSubtext: { fontSize: 14, color: muted },
  captureButtons: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  captureBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 28px',
    borderRadius: 12,
    background: `linear-gradient(135deg, ${gold}, ${goldLight})`,
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  captureBtnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 28px',
    borderRadius: 12,
    background: '#FFFDF8',
    color: dark,
    fontSize: 15,
    fontWeight: 600,
    border: `1px solid ${border}`,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tipBox: {
    padding: '14px 20px',
    borderRadius: 12,
    background: goldBg,
    fontSize: 13,
    color: muted,
    lineHeight: 1.5,
  },
  errorMsg: {
    padding: '12px 20px',
    borderRadius: 12,
    background: '#FFF0F0',
    color: '#B33A3A',
    fontSize: 14,
    marginBottom: 20,
    border: '1px solid #FFDADA',
  },

  // ── Analyzing ──
  analyzingCard: {
    borderRadius: 20,
    overflow: 'hidden',
    border: `1px solid ${border}`,
    background: '#FFFDF8',
  },
  analyzingImageWrap: {
    position: 'relative',
    overflow: 'hidden',
    background: '#F5F0E8',
  },
  analyzingImage: {
    width: '100%',
    maxHeight: 400,
    objectFit: 'contain',
    display: 'block',
    opacity: 0.85,
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: 'linear-gradient(90deg, transparent, #22C55E, transparent)',
    animation: 'scan 2s ease-in-out infinite',
    boxShadow: '0 0 12px rgba(34, 197, 94, 0.5)',
  },
  analyzingText: {
    padding: '32px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  spinner: {
    width: 32,
    height: 32,
    border: `3px solid ${border}`,
    borderTop: `3px solid ${gold}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  analyzingTitle: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 22,
    fontWeight: 600,
  },
  analyzingSub: {
    fontSize: 14,
    color: muted,
    maxWidth: 360,
    lineHeight: 1.5,
  },

  // ── Offer ──
  offerBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 16px',
    borderRadius: 100,
    background: goldBg,
    color: gold,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 24,
  },
  offerCard: {
    borderRadius: 20,
    border: `1px solid ${border}`,
    background: '#FFFDF8',
    overflow: 'hidden',
    marginBottom: 28,
    textAlign: 'left',
  },
  offerTop: {
    display: 'flex',
    gap: 20,
    padding: 24,
    flexWrap: 'wrap',
  },
  offerImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    objectFit: 'contain',
    background: '#F5F0E8',
    flexShrink: 0,
  },
  offerInfo: { flex: 1, minWidth: 200 },
  offerTitle: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 22,
    fontWeight: 600,
    marginBottom: 8,
  },
  offerDesc: {
    fontSize: 14,
    color: muted,
    lineHeight: 1.6,
  },
  offerDetails: {
    borderTop: `1px solid ${border}`,
    padding: '16px 24px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '8px 24px',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    padding: '6px 0',
  },
  detailLabel: { color: muted },
  detailValue: { fontWeight: 500 },
  detailValueWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  pencilBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#C8B89A',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
    opacity: 0.6,
    transition: 'opacity 0.2s',
  },
  detailEditInput: {
    padding: '4px 8px',
    borderRadius: 6,
    border: `1px solid ${goldLight}`,
    fontSize: 14,
    fontFamily: 'inherit',
    fontWeight: 500,
    background: '#FFFDF8',
    color: dark,
    outline: 'none',
    width: '60%',
    textAlign: 'right',
  },
  offerRange: {
    borderTop: `1px solid ${border}`,
    padding: 24,
    textAlign: 'center',
    background: 'linear-gradient(180deg, #FFFDF8, #FDF6E8)',
  },
  offerRangeLabel: {
    fontSize: 13,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: muted,
    marginBottom: 8,
  },
  offerPrices: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  offerPrice: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 36,
    fontWeight: 700,
    color: gold,
  },
  offerDash: {
    fontSize: 24,
    color: '#D4C5A9',
  },
  offerNotes: {
    fontSize: 13,
    color: muted,
    marginTop: 12,
    lineHeight: 1.5,
    maxWidth: 400,
    margin: '12px auto 0',
  },
  correctionSection: {
    borderTop: `1px solid ${border}`,
    padding: '16px 24px',
  },
  correctionToggle: {
    background: 'none',
    border: 'none',
    color: muted,
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: 'inherit',
    fontWeight: 500,
    padding: '10px 0',
    width: '100%',
    textAlign: 'center',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    textDecorationColor: '#D4C5A9',
  },
  correctionForm: {
    textAlign: 'left',
  },
  correctionTitle: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 4,
    color: dark,
  },
  correctionSub: {
    fontSize: 13,
    color: muted,
    marginBottom: 14,
  },
  correctionRow: {
    marginBottom: 10,
  },
  correctionLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: muted,
    marginBottom: 3,
  },
  correctionInput: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${border}`,
    fontSize: 14,
    fontFamily: 'inherit',
    background: '#FFFDF8',
    color: dark,
    outline: 'none',
  },
  reEstimateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 253, 248, 0.6)',
    backdropFilter: 'blur(2px)',
  },
  reEstimateScanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: 'linear-gradient(90deg, transparent, #22C55E, transparent)',
    animation: 'scan 1.5s ease-in-out infinite',
    boxShadow: '0 0 16px rgba(34, 197, 94, 0.5)',
  },
  reEstimateText: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 15,
    fontWeight: 600,
    color: '#16A34A',
  },
  spinnerGreen: {
    width: 20,
    height: 20,
    border: '2.5px solid #E0E0E0',
    borderTop: '2.5px solid #22C55E',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  firmOfferBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 32px',
    borderRadius: 12,
    background: 'linear-gradient(135deg, #16A34A, #22C55E)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.25s ease',
    boxShadow: '0 4px 16px rgba(34, 197, 94, 0.3)',
    animation: 'pulseGreen 2s ease-in-out infinite',
  },
  offerCaveat: {
    fontSize: 13,
    color: muted,
    marginTop: 12,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: muted,
    cursor: 'pointer',
    fontSize: 14,
    marginTop: 16,
    fontFamily: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  },

  // ── Form ──
  form: {
    textAlign: 'left',
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 6,
    color: dark,
  },
  formInput: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: `1px solid ${border}`,
    fontSize: 15,
    fontFamily: 'inherit',
    background: '#FFFDF8',
    color: dark,
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  formDisclaimer: {
    fontSize: 13,
    color: muted,
    marginTop: 14,
    textAlign: 'center',
  },

  // ── Success ──
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: '#E8F5E8',
    color: '#2E7D2E',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  successSteps: {
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    marginBottom: 32,
  },
  successStep: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    fontSize: 15,
  },
  successStepNum: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: goldBg,
    color: gold,
    fontWeight: 700,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // ── Footer ──
  footer: {
    textAlign: 'center',
    padding: '32px 24px',
    borderTop: `1px solid ${border}`,
  },
  footerText: {
    fontSize: 13,
    color: muted,
    marginBottom: 4,
  },
  footerDisclaimer: {
    fontSize: 12,
    color: '#B5A992',
  },
}

// ── Global keyframes (injected once) ──
const styleSheet = document.createElement('style')
styleSheet.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes scan { 0%, 100% { top: 0; } 50% { top: calc(100% - 3px); } }
  @keyframes pulseGreen {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.3); }
    50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
  }
  input:focus, textarea:focus { border-color: ${goldLight} !important; box-shadow: 0 0 0 3px rgba(200,149,60,0.1); }
  button:hover { opacity: 0.92; transform: translateY(-1px); }
  button:active { transform: translateY(0); }
`
document.head.appendChild(styleSheet)
