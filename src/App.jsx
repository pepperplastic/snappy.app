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
function compressImage(file, maxWidth = 1200) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxWidth / img.width, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const base64 = canvas.toDataURL('image/jpeg', 0.85)
        resolve(base64)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

// ── API: Send image to Claude for analysis ──
async function analyzeImage(base64Data) {
  const mediaType = 'image/jpeg'
  const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '')

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
            text: `You are an expert appraiser for Snappy, a modern precious metals and luxury goods buyer. Analyze this image and provide a preliminary assessment.

Respond ONLY in this exact JSON format, no markdown fences:
{
  "item_type": "ring | necklace | bracelet | watch | earrings | coin | bar | other",
  "title": "Brief descriptive title, e.g. '14K Yellow Gold Cuban Link Chain'",
  "description": "2-3 sentence description of what you see including estimated materials, quality indicators, brand if visible",
  "confidence": "high | medium | low",
  "details": [
    {"label": "Material", "value": "e.g. 14K Yellow Gold"},
    {"label": "Estimated Weight", "value": "e.g. 15-20 grams"},
    {"label": "Condition", "value": "e.g. Good - minor surface wear"},
    {"label": "Brand/Maker", "value": "e.g. Unknown / Rolex / etc"}
  ],
  "offer_low": 150,
  "offer_high": 400,
  "offer_notes": "Brief note on what drives the range, e.g. 'Based on current gold spot price and estimated karat/weight. Final offer depends on in-person verification.'"
}

If the image is not of jewelry, a watch, or precious metals, set item_type to "other", offer_low and offer_high to 0, and explain in description what you see instead.

Be realistic with pricing based on current market rates. Gold spot is roughly $2,300-2,400/oz. Silver ~$30/oz. Factor in karat, estimated weight, brand premiums, and condition.`,
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
          AI estimates are preliminary and not binding. Final offers require in-person evaluation.
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

  const categories = ['Gold', 'Watches', 'Silver', 'Jewelry', 'Diamonds', 'Platinum', 'Coins']

  return (
    <section style={{ ...styles.heroSection, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)', transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <div style={styles.categoryBar}>
        {categories.map((cat) => (
          <span key={cat} style={styles.categoryTag}>{cat}</span>
        ))}
      </div>
      <h1 style={styles.heroTitle}>
        Snap a photo.<br />
        <span style={styles.heroTitleGold}>Get an offer.</span>
      </h1>
      <p style={styles.heroSubtitle}>
        Photograph your valuables and receive an instant AI-generated estimate. No commitment, no hassle.
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
          { num: '2', title: 'Review', desc: 'Our AI identifies materials, brand & condition' },
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
            Our AI is examining materials, craftsmanship, brand markers, and current market prices.
          </p>
        </div>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  OFFER SCREEN
// ═══════════════════════════════════════════════
function OfferScreen({ analysis, imageData, onGetOffer, onRetry }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  const isValidItem = analysis.offer_low > 0 || analysis.offer_high > 0

  return (
    <section style={{ ...styles.centeredSection, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(15px)', transition: 'all 0.6s ease' }}>
      {isValidItem ? (
        <>
          <div style={styles.offerBadge}>
            <SparkleIcon size={14} />
            <span>AI Preliminary Estimate</span>
          </div>

          <div style={styles.offerCard}>
            <div style={styles.offerTop}>
              {imageData && <img src={imageData} alt="Your item" style={styles.offerImage} />}
              <div style={styles.offerInfo}>
                <h2 style={styles.offerTitle}>{analysis.title}</h2>
                <p style={styles.offerDesc}>{analysis.description}</p>
              </div>
            </div>

            <div style={styles.offerDetails}>
              {analysis.details?.map((d, i) => (
                <div key={i} style={styles.detailRow}>
                  <span style={styles.detailLabel}>{d.label}</span>
                  <span style={styles.detailValue}>{d.value}</span>
                </div>
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
          </div>

          <button onClick={onGetOffer} style={styles.heroCta}>
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
    gap: 10,
    marginBottom: 28,
  },
  categoryTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 16px',
    borderRadius: 100,
    background: goldBg,
    color: gold,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.02em',
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
    maxHeight: 300,
  },
  analyzingImage: {
    width: '100%',
    height: 300,
    objectFit: 'cover',
    display: 'block',
    opacity: 0.85,
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: `linear-gradient(90deg, transparent, ${goldLight}, transparent)`,
    animation: 'scan 2s ease-in-out infinite',
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
    objectFit: 'cover',
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
  input:focus, textarea:focus { border-color: ${goldLight} !important; box-shadow: 0 0 0 3px rgba(200,149,60,0.1); }
  button:hover { opacity: 0.92; transform: translateY(-1px); }
  button:active { transform: translateY(0); }
`
document.head.appendChild(styleSheet)
