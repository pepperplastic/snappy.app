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
  SHIPPING: 'shipping',
  SUBMITTED: 'submitted',
}

// ── GA4 Analytics ──
const GA_MEASUREMENT_ID = 'G-Z6KH5RDZFZ'
const GADS_CONVERSION_ID = 'AW-16675435094'
const GADS_LEAD_LABEL = 'DediCI6QqfobENbku48-'
const META_PIXEL_ID = '1040162166644550'

function initGA4() {
  if (typeof window === 'undefined' || document.getElementById('ga4-script')) return
  const script = document.createElement('script')
  script.id = 'ga4-script'
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(script)
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  window.gtag('config', GA_MEASUREMENT_ID)
  window.gtag('config', GADS_CONVERSION_ID)
}

function initMetaPixel() {
  if (typeof window === 'undefined' || window.fbq) return
  window.fbq = function () { window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments) }
  window.fbq.push = window.fbq
  window.fbq.loaded = true
  window.fbq.version = '2.0'
  window.fbq.queue = []
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(script)
  window.fbq('init', META_PIXEL_ID)
  window.fbq('track', 'PageView')
}

function trackMetaEvent(eventName, params = {}) {
  if (window.fbq) window.fbq('track', eventName, params)
}

function trackGadsConversion(label, value) {
  if (window.gtag) {
    window.gtag('event', 'conversion', {
      send_to: `${GADS_CONVERSION_ID}/${label}`,
      value: value || 1.0,
      currency: 'USD',
    })
  }
}

function trackEvent(eventName, params = {}) {
  const variant = getVariant()
  const allParams = { ...params, flow_variant: variant }
  if (window.gtag) {
    window.gtag('event', eventName, allParams)
  }
  // Also log to console in dev for debugging
  if (window.location.hostname === 'localhost') {
    console.log(`[GA4] ${eventName}`, allParams)
  }
}

// ── A/B/C Flow Variant Assignment ──
// A = current (show estimate freely)
// B = gated (require email to see estimate)
// C = nudge (show estimate but aggressively prompt for email)
const VARIANTS = ['A', 'B', 'C']

function getVariant() {
  // Allow URL override: ?variant=A, ?variant=B, ?variant=C
  const urlParams = new URLSearchParams(window.location.search)
  const override = urlParams.get('variant')?.toUpperCase()
  if (override && VARIANTS.includes(override)) {
    setCookie('snappy_variant', override, 90)
    return override
  }

  // Check cookie for existing assignment
  const existing = getCookie('snappy_variant')
  if (existing && VARIANTS.includes(existing)) return existing

  // Randomly assign
  const variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
  setCookie('snappy_variant', variant, 90)
  return variant
}

function setCookie(name, value, days) {
  const d = new Date()
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? match[2] : null
}

// ── Daily analysis limit (prevent API abuse) ──
const MAX_FREE_ANALYSES = 2

function getAnalysisCount() {
  const today = new Date().toISOString().slice(0, 10)
  const raw = getCookie('snappy_usage')
  if (!raw) return 0
  try {
    const parsed = JSON.parse(decodeURIComponent(raw))
    if (parsed.date === today) return parsed.count
    return 0 // different day, reset
  } catch { return 0 }
}

function incrementAnalysisCount() {
  const today = new Date().toISOString().slice(0, 10)
  const current = getAnalysisCount()
  const data = encodeURIComponent(JSON.stringify({ date: today, count: current + 1 }))
  setCookie('snappy_usage', data, 1)
  return current + 1
}

function hasReachedLimit() {
  return getAnalysisCount() >= MAX_FREE_ANALYSES
}

function clearAnalysisLimit() {
  // Call this after they submit lead info to unlock more analyses
  const today = new Date().toISOString().slice(0, 10)
  const data = encodeURIComponent(JSON.stringify({ date: today, count: 0, unlocked: true }))
  setCookie('snappy_usage', data, 1)
}

function isUnlocked() {
  const raw = getCookie('snappy_usage')
  if (!raw) return false
  try {
    return JSON.parse(decodeURIComponent(raw)).unlocked === true
  } catch { return false }
}

// ── UTM / Ad tracking ──
function captureUtmParams() {
  const params = new URLSearchParams(window.location.search)
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']
  const utm = {}
  let hasAny = false
  utmKeys.forEach(key => {
    const val = params.get(key)
    if (val) { utm[key] = val; hasAny = true }
  })
  // Auto-detect source from click IDs if utm_source not set
  if (!utm.utm_source && utm.gclid) {
    utm.utm_source = 'google'
    utm.utm_medium = utm.utm_medium || 'cpc'
  }
  if (!utm.utm_source && utm.fbclid) {
    utm.utm_source = 'facebook'
    utm.utm_medium = utm.utm_medium || 'paid'
  }
  if (hasAny) {
    setCookie('snappy_utm', encodeURIComponent(JSON.stringify(utm)), 30)
  }
  return utm
}

function getStoredUtm() {
  const raw = getCookie('snappy_utm')
  if (!raw) return {}
  try { return JSON.parse(decodeURIComponent(raw)) } catch { return {} }
}

// ── IP Address Capture ──
let cachedIP = ''
async function fetchIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json')
    const data = await res.json()
    cachedIP = data.ip || ''
  } catch { cachedIP = '' }
}
function getIP() { return cachedIP }

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
async function analyzeImage(imagesArray, corrections) {
  const mediaType = 'image/jpeg'

  // Build content array: all images first, then the prompt
  const content = imagesArray.map((base64Data, i) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: base64Data.replace(/^data:image\/\w+;base64,/, ''),
    },
  }))

  let promptText = `You are an expert appraiser for Snappy, a modern luxury goods and precious metals buyer. Analyze ${imagesArray.length > 1 ? 'these images' : 'this image'} and provide a preliminary assessment.

${imagesArray.length > 1 ? `You have been provided ${imagesArray.length} photos of the same item from different angles. Use ALL photos together to make the most accurate assessment possible. Look for:
- Hallmarks, stamps, or karat markings in close-up shots
- Brand logos, serial numbers, or maker's marks
- Overall condition from multiple angles
- Weight clues from thickness, size relative to known objects
- Clasp type, chain construction, setting quality
` : ''}CRITICAL: FIRST determine what category this item falls into:
1. WATCH — any wristwatch (Rolex, Omega, Cartier, AP, Patek Philippe, etc.)
2. JEWELRY/METAL — rings, necklaces, chains, bracelets, earrings, gold/silver bars, coins
3. LUXURY GOODS — designer handbags, purses, wallets, belts, shoes, sunglasses (Louis Vuitton, Chanel, Hermès, Gucci, Dior, Prada, Goyard, Bottega Veneta, Balenciaga, Fendi, YSL, Celine, Cartier accessories, etc.)

This affects EVERYTHING about your response — the detail fields, pricing method, and description style are completely different.

IMPORTANT GUIDELINES FOR ASSESSMENT:
- If an item appears to be gold, ASSUME it is real gold. Estimate the karat (10K, 14K, or 18K) based on the color/hue — lighter yellow suggests 10K, classic yellow suggests 14K, rich deep yellow suggests 18K.
- If diamonds or gemstones are visible, ASSUME they are genuine unless there are obvious visual signs they are not (e.g. clearly plastic, costume jewelry construction).
- If a watch appears to be a known brand, ASSUME it is authentic unless there are obvious signs of being counterfeit.
- If a luxury good appears to be a known brand, ASSUME it is authentic. Look for brand stamps, logos, hardware, stitching quality, and material texture.
- If silver-colored metal is present, assess whether it is likely sterling silver, white gold, or platinum based on visual cues.
- Be optimistic but not unreasonable. Give the seller the benefit of the doubt. Final verification happens in person.
- Never use the word "AI" in any of your responses.

Respond ONLY in valid JSON, no markdown fences.

═══════════════════════════════════════
FORMAT A — WATCHES (use when item_type is "watch")
═══════════════════════════════════════
You MUST use exactly these detail labels in this order. Do NOT use Material, Estimated Weight, or any jewelry fields for watches.

{
  "item_type": "watch",
  "title": "Full name with reference, e.g. 'Rolex Day-Date 40 228235 Green Dial'",
  "description": "2-3 sentence confident description. State the case material (e.g. 18K Yellow Gold, Stainless Steel, etc).",
  "confidence": "high | medium | low",
  "details": [
    {"label": "Brand", "value": "e.g. Rolex"},
    {"label": "Model / Reference", "value": "e.g. Day-Date 40 228235"},
    {"label": "Condition", "value": "e.g. Excellent - light wear consistent with regular use"},
    {"label": "Est. Production Year", "value": "e.g. 2023-2024"},
    {"label": "Completeness", "value": "Full set: box, papers, links"}
  ],
  "offer_low": 50000,
  "offer_high": 62000,
  "offer_notes": "Based on current secondary market value for this reference as a full set (box, papers, links). Final offer subject to in-person authentication."
}

WATCH VISUAL IDENTIFICATION RULES — USE THESE TO IDENTIFY EXACT REFERENCES:

ROLEX GMT-MASTER II (distinguish by bezel colors):
- Black + Blue ceramic bezel ("Batman/Batgirl"): ref 126710BLNR
- Red + Blue ceramic bezel ("Pepsi"): ref 126710BLRO
- Black + Brown ceramic bezel ("Root Beer"): ref 126711CHNR (two-tone Everose)
- All black bezel (older generation): ref 116710LN
- Green + Black ceramic bezel ("Sprite"): ref 126720VTNR (left-handed crown at 9 o'clock)

ROLEX SUBMARINER (distinguish by bezel color, date window, metal):
- Black bezel, steel, date window: ref 126610LN
- Black bezel, steel, NO date: ref 124060
- Green bezel + green dial, steel ("Starbucks/Kermit"): ref 126610LV
- Green bezel + green dial, older ("Hulk"): ref 116610LV (discontinued, commands premium)
- Blue bezel + blue dial, two-tone steel/gold: ref 126613LB
- Black bezel, all yellow gold: ref 126618LN
- Blue bezel, all yellow gold: ref 126618LB

ROLEX DAYTONA (distinguish by dial color and metal):
- Steel, white dial with black subdials ("Panda"): ref 116500LN
- Steel, black dial: ref 116500LN
- Yellow gold, green dial: ref 116508
- Yellow gold, champagne dial: ref 116508
- Everose gold, chocolate/brown dial: ref 116505
- Platinum, ice blue dial: ref 116506

ROLEX DAY-DATE 40 (distinguish by case metal and dial color):
- Yellow gold, green dial: ref 228238
- Yellow gold, champagne/other dial: ref 228238
- White gold, blue or silver dial: ref 228239
- Everose gold, sundust/brown dial: ref 228235
- Platinum, ice blue dial: ref 228206

ROLEX DATEJUST (distinguish by size, bezel, dial, bracelet):
- 41mm, fluted bezel + jubilee bracelet: most common modern config (ref 126334)
- 41mm, smooth bezel + oyster bracelet: sportier look (ref 126300)
- 36mm: older generation or ladies' size
- "Wimbledon" dial: slate grey dial with GREEN Roman numeral hour markers — very popular, premium variant
- Blue dial: commands premium over silver/white
- Diamond dial/bezel: significant premium over standard
- Palm motif / floral motif dials: newer limited variants, premium
- IMPORTANT: If watch is on an aftermarket rubber strap (like Rubber B, Oysterflex-style), note this — it means the ORIGINAL BRACELET may be missing, which significantly reduces value. Always mention in the description and Completeness field.

OMEGA (distinguish by subdial layout and case):
- Speedmaster "Moonwatch": hesalite crystal, tachymeter bezel, 3 subdials
- Speedmaster sapphire sandwich: display caseback visible
- Seamaster 300M: wave dial texture, helium escape valve
- Seamaster Planet Ocean: thicker case, larger than 300M
- Aqua Terra: dressier, teak/horizontal lines on dial

AUDEMARS PIGUET ROYAL OAK (distinguish by size and complications):
- 41mm steel time-only: ref 15500ST or 15510ST
- 37mm steel: ref 15450ST
- Chronograph steel: ref 26331ST (two subdials)
- "Jumbo" Extra-Thin 39mm: ref 15202ST (ultra-thin case, premium model)
- Rose gold variants: look for warm pink tone on case and bracelet

PATEK PHILIPPE (distinguish by shape and dial):
- Nautilus: horizontal embossed lines on dial, porthole-shaped case, ref 5711
- Nautilus Chronograph: ref 5980 (subdials present)
- Aquanaut: rounded octagonal case, textured rubber strap, ref 5167/5168
- Calatrava: round dress watch, simple dial

CARTIER (distinguish by case shape):
- Santos: square case with exposed screws on bezel
- Tank: rectangular case — Must (smaller/thinner) vs Française (more bracelet-integrated)
- Ballon Bleu: round with distinctive crown guard bubble
- Panthère: square with chain-link bracelet

LUXURY GOODS VISUAL IDENTIFICATION RULES:

LOUIS VUITTON (distinguish by pattern):
- Brown "LV" monogram on tan canvas = Monogram (most common)
- Brown checkerboard = Damier Ebene
- Blue/white checkerboard = Damier Azur
- Black embossed leather = Epi Leather (higher value)
- Multicolor monogram = Limited editions (higher value)
- Neverfull: check size by proportions — MM is medium, GM is large
- Speedy: 25 is small, 30 is medium, 35 is large — visible as stamped number on tab

CHANEL (distinguish by style and hardware):
- Classic Flap: quilted with CC turn-lock clasp — identify size by proportions (Mini ~7", Small ~9", Medium ~10", Jumbo ~12")
- Gold hardware vs silver hardware: gold slightly higher resale
- Caviar leather (textured/pebbly) vs lambskin (smooth): caviar holds value better
- Boy Bag: rectangular shape, chunky industrial-style clasp
- 19 Bag: oversized quilting, mixed chain and leather strap
- Classic WOC (wallet on chain): small crossbody

HERMÈS (distinguish by shape and hardware):
- Birkin: structured, TWO top handles, NO shoulder strap, front flap with turn-lock
  - Size by width: 25cm (small), 30cm (medium), 35cm (large)
  - Exotic leather (crocodile/ostrich): dramatically higher value than standard
- Kelly: SINGLE top handle, detachable shoulder strap, front flap with turn-lock
  - Sellier (rigid/structured): higher value than Retourne (soft/slouchy)
- Constance: H-shaped clasp on front, crossbody
- Evelyne: perforated H logo on front, casual crossbody
- Garden Party: casual open tote, no closure
- Color matters: neutral colors (gold, etoupe, noir, etain) command premium over bright colors

WATCH PRICING RULES — THIS IS CRITICAL:
- Price watches based on SECONDARY MARKET / PRE-OWNED DEALER VALUES, not metal melt value
- Use your knowledge of current pre-owned market values for the exact reference you identified above
- Price at the HIGHER END of the market range to be competitive — we want sellers to feel good about the estimate
- AFTERMARKET MODIFICATIONS: If a watch is on a non-original strap/band (rubber strap, NATO, aftermarket bracelet), ALWAYS note this. The original bracelet is a significant portion of the watch's value — if missing, reduce estimate 15-25%. Mention this clearly in description and Completeness field.
- All prices assume FULL SET (box, papers, links) which commands the highest premium
- ALWAYS default Completeness to "Full set: box, papers, links"
- If a user corrects completeness to indicate missing items, adjust pricing DOWN accordingly:
  - Watch only (no box, no papers): reduce 15-25% from full set price
  - Watch + box only (no papers): reduce 10-15%
  - Watch + papers only (no box): reduce 5-10%
  - Missing extra links: reduce 2-5%
- ALWAYS lean toward the higher end of the range

WATCH YEAR ESTIMATION — BE CAREFUL:
- Base year estimates on the specific reference number and dial variant
- Many newer dial colors/variants were introduced recently (2020-2025). When in doubt about a specific colorway or variant, estimate MORE RECENT rather than older
- Rolex green dial Day-Date 40 (olive/green): introduced 2023+
- Do NOT default to old date ranges. If a dial variant looks current-generation, estimate 2022-2025

═══════════════════════════════════════
FORMAT B — JEWELRY / PRECIOUS METALS (use for everything that is NOT a watch)
═══════════════════════════════════════
{
  "item_type": "ring | necklace | bracelet | earrings | coin | bar | other",
  "title": "Brief descriptive title, e.g. '14K Yellow Gold Cuban Link Chain'",
  "description": "2-3 sentence description of what you see including materials, quality indicators, brand if visible. Be confident — do not hedge with 'appears to be' or 'possibly'.",
  "confidence": "high | medium | low",
  "details": [
    {"label": "Material", "value": "e.g. 14K Yellow Gold"},
    {"label": "Estimated Weight", "value": "e.g. 25-35 grams"},
    {"label": "Condition", "value": "e.g. Good - minor surface wear"},
    {"label": "Brand/Maker", "value": "e.g. Unknown / Tiffany & Co. / etc"}
  ],
  "offer_low": 500,
  "offer_high": 1200,
  "offer_notes": "Brief note on what drives the range. Reference current spot prices and item specifics. Final offer depends on in-person verification."
}

JEWELRY PRICING — USE THESE EXACT PRE-COMPUTED VALUES (do NOT calculate your own):
- GOLD spot: GOLD_SPOT_PRICE per troy ounce today.
- SILVER spot: SILVER_SPOT_PRICE per troy ounce today.

PRE-COMPUTED per-gram melt values (already calculated for you — just multiply by weight):
- 10K gold: GOLD_10K_PER_GRAM per gram
- 14K gold: GOLD_14K_PER_GRAM per gram
- 18K gold: GOLD_18K_PER_GRAM per gram
- 24K gold: GOLD_24K_PER_GRAM per gram
- Sterling silver (.925): SILVER_STERLING_PER_GRAM per gram
- .999 fine silver: SILVER_FINE_PER_GRAM per gram

PRICING FORMULA — FOLLOW THIS EXACTLY, STEP BY STEP:
Step 1: Identify material (e.g. 14K gold)
Step 2: Look up per-gram value from list above (e.g. GOLD_14K_PER_GRAM)
Step 3: Estimate weight range (e.g. 35-50g)
Step 4: Compute LOW melt = low weight × per-gram (e.g. 35 × GOLD_14K_PER_GRAM)
Step 5: Compute HIGH melt = high weight × per-gram (e.g. 50 × GOLD_14K_PER_GRAM)
Step 6: Your offer_low MUST be >= Step 4 result. Your offer_high MUST be >= Step 5 result.
Step 7: Add any brand/design/collectible premium ON TOP of melt value.

WORKED EXAMPLE (at $5,000/oz gold, 14K per-gram = ~$93.73):
- Item: 14K gold chain, estimated 35-50g
- Low melt: 35 × $93.73 = $3,280
- High melt: 50 × $93.73 = $4,687
- Offer: $3,300 - $4,700 (melt floor, no premium needed for generic chain)
- WITH premium (branded/collectible): $3,500 - $5,000+

SANITY CHECK — MANDATORY BEFORE RESPONDING:
- If your offer for a 14K gold item is less than GOLD_14K_PER_GRAM × your low weight estimate, YOUR MATH IS WRONG. Redo it.
- A 35g 14K gold item at current spot is ALWAYS worth over $3,000. If your offer is under $2,000 for anything over 30g of 14K gold, you have made an error.
- For silver bullion bars/coins: offer should be 85-95% of spot × weight in troy ounces
- NEVER offer below melt value. That is the absolute floor.

WEIGHT ESTIMATION — MANDATORY DECISION TREE (you MUST follow this exactly):

Gold is DENSE (19.3 g/cm³). Items almost always weigh MORE than they look. You CANNOT eyeball gold weight accurately from a photo. Instead, CLASSIFY the item and USE THE CORRESPONDING WEIGHT RANGE below. Do NOT estimate below these floors under any circumstances.

STEP 1: Classify the item into ONE of these categories:
STEP 2: Use the weight range for that category. Always use the MIDDLE TO HIGH end.

CHAINS / NECKLACES:
- Thin women's chain (delicate, 16-18"): 8-15g
- Standard women's necklace (pendant chain, layering): 12-20g
- Men's chain, standard (20-24", any link style): 35-50g
- Men's chain, heavy/thick (Cuban, Mariner, rope): 50-80g+
- ADD 5-15g if pendant is attached

RINGS:
- Thin band / wedding band: 3-6g
- Standard ring with setting: 5-10g
- Cocktail / statement ring: 10-20g
- Men's signet or class ring: 10-25g

BRACELETS:
- Thin women's bracelet / bangle: 8-20g
- Standard bracelet (tennis, link): 15-35g
- Men's / heavy bracelet: 30-60g+

EARRINGS:
- Studs: 1-3g per pair
- Drops / dangles: 3-10g per pair
- Large hoops: 5-15g per pair

PENDANTS (standalone, no chain):
- Small charm: 2-5g
- Medium pendant: 5-15g
- Large / heavy pendant: 15-30g

BARS / COINS:
- Estimate from visible markings (1 oz, 10 oz, etc.)
- If no markings visible, estimate by apparent size

CRITICAL RULES:
- A chain that a man is wearing or holding that reaches mid-chest is AT LEAST 35g in 14K gold. NEVER estimate below 30g for any men's chain.
- If you estimated under 15g for anything other than earrings, a thin women's chain, or a thin ring — you are almost certainly wrong. Re-check your classification.
- ALWAYS show weight as a range (e.g. "35-50 grams") not a single number.
- When in doubt, round UP. The seller knows the actual weight — a lowball guess loses credibility instantly.

═══════════════════════════════════════

═══════════════════════════════════════
FORMAT C — LUXURY GOODS (use for designer handbags, purses, wallets, belts, shoes, sunglasses, accessories)
═══════════════════════════════════════
{
  "item_type": "handbag | wallet | belt | shoes | sunglasses | accessory",
  "title": "Full name, e.g. 'Louis Vuitton Neverfull MM Monogram Canvas'",
  "description": "2-3 sentence confident description. Note the brand, model if identifiable, material, color, hardware finish, and overall condition.",
  "confidence": "high | medium | low",
  "details": [
    {"label": "Brand", "value": "e.g. Louis Vuitton"},
    {"label": "Model", "value": "e.g. Neverfull MM"},
    {"label": "Material", "value": "e.g. Monogram Canvas with Vachetta leather trim"},
    {"label": "Condition", "value": "e.g. Very Good - light patina on leather, clean interior"},
    {"label": "Completeness", "value": "Full set: dust bag, box, receipt"}
  ],
  "offer_low": 800,
  "offer_high": 1200,
  "offer_notes": "Based on current resale market for this model and condition. Final offer subject to in-person authentication."
}

LUXURY GOODS PRICING:
- Use your knowledge of current pre-owned resale market values for the exact brand, model, size, material, and condition you identified
- Price at the HIGHER end of the market range to be competitive
- ALWAYS default Completeness to "Full set: dust bag, box, receipt" — assume full set for pricing
- If user corrects to missing accessories, reduce 10-20%

═══════════════════════════════════════

If the image is not of jewelry, a watch, precious metals, or luxury goods, set item_type to "other", offer_low and offer_high to 0, and explain in description what you see instead.`

  if (corrections) {
    promptText += `\n\nIMPORTANT: The user has corrected the following details about this item. Use these corrections to provide a more accurate assessment and updated offer range:\n${corrections}`
  }

  content.push({
    type: 'text',
    text: promptText,
  })

  const body = {
    model: 'claude-opus-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  }

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'unknown')
    throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`)
  }
  const data = await res.json()

  const text = data.content
    ?.map((block) => block.text || '')
    .join('')
    .trim()

  if (!text) throw new Error(`No text in response: ${JSON.stringify(data).slice(0, 200)}`)

  // Parse JSON from response (strip any accidental fences)
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (parseErr) {
    throw new Error(`JSON parse failed: ${cleaned.slice(0, 200)}`)
  }
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
  const [leadData, setLeadData] = useState({ firstName: '', lastName: '', email: '', phone: '', notes: '' })
  const [userEdits, setUserEdits] = useState([])
  const [isReEstimating, setIsReEstimating] = useState(false)
  const [showWebcam, setShowWebcam] = useState(false)
  const [shippingData, setShippingData] = useState({ address: '', city: '', state: '', zip: '', method: 'kit' })
  const [showContact, setShowContact] = useState(false)
  const [directQuote, setDirectQuote] = useState(false)
  const [limitGated, setLimitGated] = useState(false)
  const [legalModal, setLegalModal] = useState(null)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  // A/B/C variant + GA4
  const [variant] = useState(() => getVariant())
  const [limitReached, setLimitReached] = useState(() => hasReachedLimit() && !isUnlocked())
  const [utmData] = useState(() => captureUtmParams())
  useEffect(() => {
    initGA4()
    initMetaPixel()
    captureUtmParams()
    fetchIP()
    trackEvent('page_view', { page: 'home' })
  }, [])

  // Track step changes
  useEffect(() => {
    const eventMap = {
      [STEPS.HERO]: 'view_hero',
      [STEPS.CAPTURE]: 'view_capture',
      [STEPS.ANALYZING]: 'analyzing_started',
      [STEPS.OFFER]: 'estimate_received',
      [STEPS.LEAD_FORM]: 'lead_form_started',
      [STEPS.SHIPPING]: 'shipping_started',
      [STEPS.SUBMITTED]: 'lead_submitted',
    }
    if (eventMap[step]) {
      const params = {}
      if (step === STEPS.OFFER && analysis) {
        params.item_type = analysis.item_type || ''
        params.item_title = analysis.title || ''
        params.offer_low = analysis.offer_low || 0
        params.offer_high = analysis.offer_high || 0
      }
      trackEvent(eventMap[step], params)
    }
  }, [step])

  // Check limit before allowing camera/upload
  const checkLimit = () => {
    if (isUnlocked()) return true
    if (hasReachedLimit()) {
      setLimitReached(true)
      trackEvent('limit_reached', { count: getAnalysisCount() })
      return false
    }
    return true
  }

  const handleCamera = () => {
    if (!checkLimit()) return
    if (isMobile) {
      cameraInputRef.current?.click()
    } else {
      setShowWebcam(true)
    }
  }

  const notifyPhoto = async (result, photos) => {
    const smallPhoto = await compressForEmail(photos?.[0])
    const utm = getStoredUtm()
    fetch('/api/submit-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: '(anonymous)',
        lastName: '',
        email: '',
        phone: '',
        notes: '',
        item: result?.title || '',
        offerRange: result?.offer_low && result?.offer_high
          ? `$${result.offer_low.toLocaleString()} – $${result.offer_high.toLocaleString()}`
          : '',
        description: result?.description || '',
        details: result?.details || [],
        offerNotes: result?.offer_notes || '',
        confidence: result?.confidence || '',
        itemType: result?.item_type || '',
        shippingMethod: '',
        address: '',
        source: 'photo_browse',
        variant: variant,
        ...utm,
        ip: getIP(),
        image: smallPhoto,
      }),
    }).catch(err => console.error('Photo notify error:', err))
  }

  const handleWebcamCapture = (base64) => {
    setShowWebcam(false)
    if (!checkLimit()) return
    setImageData([base64])
    setStep(STEPS.ANALYZING)
    trackEvent('photo_uploaded', { method: 'camera' })
    trackMetaEvent('ViewContent', { content_name: 'Photo Upload', content_category: 'camera' })
    analyzeImage([base64])
      .then(result => { setAnalysis(result); setStep(STEPS.OFFER); incrementAnalysisCount(); notifyPhoto(result, [base64]); })
      .catch(err => {
        console.error('Analysis error:', err)
        setError(`We could not analyze that image. Please try a clearer photo. (${err.message})`)
        setStep(STEPS.CAPTURE)
      })
  }

  // Handle file selection (gallery or camera)
  const handleFiles = useCallback(async (files) => {
    const fileList = Array.from(files).filter(f => f && f.type.startsWith('image/'))
    if (fileList.length === 0) return
    if (!checkLimit()) return
    setError(null)

    // Compress all images
    const compressed = await Promise.all(fileList.map(f => compressImage(f)))
    setImageData(compressed)
    setStep(STEPS.ANALYZING)
    trackEvent('photo_uploaded', { method: 'gallery', photo_count: compressed.length })
    trackMetaEvent('ViewContent', { content_name: 'Photo Upload', content_category: 'gallery' })

    try {
      const result = await analyzeImage(compressed)
      setAnalysis(result)
      setStep(STEPS.OFFER)
      incrementAnalysisCount()
      notifyPhoto(result, compressed)
    } catch (err) {
      console.error('Analysis error:', err)
      setError(`We could not analyze that image. Please try a clearer photo. (${err.message})`)
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
    setLeadData({ firstName: '', lastName: '', email: '', phone: '', notes: '' })
    setShippingData({ address: '', city: '', state: '', zip: '', method: 'kit' })
    setDirectQuote(false)
    setLimitGated(false)
  }

  const handleLeadSubmit = (e) => {
    e.preventDefault()
    submitLead()
    trackGadsConversion(GADS_LEAD_LABEL)
    trackMetaEvent('Lead', { content_name: 'Lead Form Submitted' })
    clearAnalysisLimit()
    setLimitReached(false)
    setStep(STEPS.SHIPPING)
  }

  const compressForEmail = (dataUrl, maxWidth = 800) => {
    return new Promise((resolve) => {
      if (!dataUrl) return resolve('')
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxWidth / img.width, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.6))
      }
      img.src = dataUrl
    })
  }

  const submitLead = async (extraData = {}) => {
    const fullAddress = [shippingData.address, shippingData.city, shippingData.state, shippingData.zip].filter(Boolean).join(', ')
    const compressedImage = await compressForEmail(Array.isArray(imageData) ? imageData[0] : imageData)
    const utm = getStoredUtm()
    const payload = {
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email,
      phone: leadData.phone,
      notes: leadData.notes,
      item: analysis?.title || '',
      offerRange: analysis?.offer_low && analysis?.offer_high
        ? `$${analysis.offer_low.toLocaleString()} – $${analysis.offer_high.toLocaleString()}`
        : '',
      description: analysis?.description || '',
      details: analysis?.details || [],
      offerNotes: analysis?.offer_notes || '',
      confidence: analysis?.confidence || '',
      itemType: analysis?.item_type || '',
      shippingMethod: shippingData.method,
      address: fullAddress,
      source: directQuote ? 'direct_quote' : limitGated ? 'limit_gate' : 'photo_flow',
      variant: variant,
      ...utm,
      ip: getIP(),
      image: compressedImage,
      userEdits: userEdits.length > 0 ? userEdits : undefined,
    }
    fetch('/api/submit-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.error('Lead submit error:', err))
  }

  const handleShippingSubmit = (e) => {
    e.preventDefault()
    submitLead()
    trackMetaEvent('InitiateCheckout', { content_name: 'Shipping Form Submitted' })
    if (directQuote) {
      setStep(STEPS.CAPTURE)
    } else {
      setStep(STEPS.SUBMITTED)
    }
  }

  return (
    <div style={styles.app}>
      {/* ── NAV ── */}
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          <button onClick={reset} style={styles.logoBtn}>
            <svg width="34" height="32" viewBox="11 9 98 76" fill="none">
              {/* Antenna */}
              <line x1="60" y1="16" x2="60" y2="24" stroke="#C8953C" strokeWidth="3" strokeLinecap="round"/>
              <circle cx="60" cy="14" r="4" fill="#C8953C"/>
              {/* Head */}
              <rect x="24" y="24" width="72" height="58" rx="16" fill="#1A1816" stroke="#C8953C" strokeWidth="2.5"/>
              {/* Left eye */}
              <circle cx="48" cy="51" r="16" fill="#2A2724" stroke="#C8953C" strokeWidth="2.5"/>
              <circle cx="48" cy="51" r="11" fill="#1A1816" stroke="#8A8580" strokeWidth="0.7"/>
              <circle cx="48" cy="51" r="7" fill="#C8953C"/>
              <circle cx="48" cy="51" r="3.5" fill="#1A1816"/>
              <circle cx="43" cy="46" r="2.5" fill="rgba(255,255,255,0.45)"/>
              {/* Right eye */}
              <circle cx="74" cy="51" r="11" fill="#2A2724" stroke="#C8953C" strokeWidth="1.5"/>
              <circle cx="74" cy="51" r="6" fill="#1A1816"/>
              <circle cx="74" cy="51" r="3" fill="#3A3530"/>
              <circle cx="70" cy="47" r="1.8" fill="rgba(255,255,255,0.35)"/>
              {/* Green indicator */}
              <circle cx="84" cy="34" r="3" fill="#4ADE80"/>
              {/* Mouth grille */}
              <rect x="38" y="68" width="44" height="9" rx="4" fill="#0D0C0B"/>
              <line x1="45" y1="69.5" x2="45" y2="75.5" stroke="#C8953C" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="52" y1="69.5" x2="52" y2="75.5" stroke="#C8953C" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="59" y1="69.5" x2="59" y2="75.5" stroke="#C8953C" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="66" y1="69.5" x2="66" y2="75.5" stroke="#C8953C" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="73" y1="69.5" x2="73" y2="75.5" stroke="#C8953C" strokeWidth="1.5" strokeLinecap="round"/>
              {/* Ears */}
              <rect x="13" y="42" width="11" height="18" rx="5.5" fill="#1A1816" stroke="#C8953C" strokeWidth="1.5"/>
              <rect x="96" y="42" width="11" height="18" rx="5.5" fill="#1A1816" stroke="#C8953C" strokeWidth="1.5"/>
            </svg>
            <span style={styles.logoWordmark}>
              <span style={styles.logoText}>snappy</span>
              <span style={styles.logoDot}>.</span>
              <span style={styles.logoGold}>gold</span>
            </span>
          </button>
          <div style={styles.navLinks}>
            {step === STEPS.HERO && (
              <button onClick={() => { setDirectQuote(true); setStep(STEPS.LEAD_FORM); }} style={styles.navLink}>Quote</button>
            )}
            <button onClick={() => setShowContact(true)} style={styles.navLink}>Contact</button>
          </div>
        </div>
      </nav>

      {/* ── Contact Modal ── */}
      {showContact && (
        <div style={styles.modalOverlay} onClick={() => setShowContact(false)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowContact(false)} style={styles.modalClose}>✕</button>
            <h3 style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, marginBottom: 8, color: '#1A1A1A' }}>Get in Touch</h3>
            <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>We'd love to hear from you.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <a href="mailto:hello@snappy.gold" style={styles.contactItem}>
                <span style={styles.contactIcon}>✉</span>
                <span>hello@snappy.gold</span>
              </a>
              <a href="tel:+18886130704" style={styles.contactItem}>
                <span style={styles.contactIcon}>☎</span>
                <span>(888) 613-0704</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Limit Reached Modal ── */}
      {limitReached && (
        <div style={styles.modalOverlay} onClick={() => setLimitReached(false)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button onClick={() => setLimitReached(false)} style={styles.modalClose}>✕</button>
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', margin: '0 auto 16px',
                background: 'rgba(200,149,60,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28,
              }}>📸</div>
              <h3 style={{ fontFamily: '"Playfair Display", serif', fontSize: 22, marginBottom: 8, color: '#1A1A1A' }}>
                You're on a roll!
              </h3>
              <p style={{ color: '#8A8580', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
                You've used your {MAX_FREE_ANALYSES} free estimates for today. Tell us a bit about yourself to continue getting instant appraisals — no commitment required.
              </p>
              <button
                onClick={() => {
                  setLimitReached(false)
                  setLimitGated(true)
                  setStep(STEPS.LEAD_FORM)
                  trackEvent('limit_cta_clicked')
                }}
                style={{
                  width: '100%', padding: '14px 24px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg, #C8953C, #A67B2E)', color: '#fff',
                  fontWeight: 700, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 4px 16px rgba(200,149,60,0.3)',
                }}
              >
                Continue — it's free
              </button>
              <p style={{ color: '#B5A992', fontSize: 12, marginTop: 10 }}>
                We'll never spam you. Just need your info to provide the best service.
              </p>
            </div>
          </div>
        </div>
      )}

      <main style={styles.main}>
        {step === STEPS.HERO && (
          <Hero
            onStart={() => setStep(STEPS.CAPTURE)}
            onCamera={handleCamera}
            onUpload={() => { if (checkLimit()) fileInputRef.current?.click() }}
          />
        )}
        {step === STEPS.HERO && <RecentQuotesTicker />}
        {step === STEPS.CAPTURE && (
          <CaptureScreen
            fileInputRef={fileInputRef}
            onCamera={handleCamera}
            onFile={handleFiles}
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
            variant={variant}
            leadData={leadData}
            setLeadData={setLeadData}
            userEdits={userEdits}
            setUserEdits={setUserEdits}
          />
        )}
        {step === STEPS.LEAD_FORM && (
          <LeadForm
            leadData={leadData}
            setLeadData={setLeadData}
            onSubmit={handleLeadSubmit}
            analysis={analysis}
            directQuote={directQuote}
          />
        )}
        {step === STEPS.SHIPPING && (
          <ShippingScreen
            shippingData={shippingData}
            setShippingData={setShippingData}
            onSubmit={handleShippingSubmit}
            leadData={leadData}
          />
        )}
        {step === STEPS.SUBMITTED && <SubmittedScreen onReset={reset} shippingMethod={shippingData.method} directQuote={directQuote} />}
      </main>

      {/* ── FOOTER ── */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>© 2026 DW5 LLC d/b/a Snappy Gold · snappy.gold</p>
        <div style={styles.footerLinks}>
          <span onClick={() => setLegalModal('terms')} style={styles.footerLink}>Terms & Conditions</span>
          <span style={styles.footerLinkDivider}>·</span>
          <span onClick={() => setLegalModal('privacy')} style={styles.footerLink}>Privacy Policy</span>
          <span style={styles.footerLinkDivider}>·</span>
          <span onClick={() => setLegalModal('tos')} style={styles.footerLink}>Terms of Service</span>
        </div>
        <p style={styles.footerDisclaimer}>
          Estimates are preliminary and not binding. Final offers require in-person evaluation.
        </p>
      </footer>

      {/* ── LEGAL MODAL ── */}
      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}

      {/* Webcam modal (desktop) */}
      {showWebcam && (
        <WebcamModal
          onCapture={handleWebcamCapture}
          onClose={() => setShowWebcam(false)}
        />
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />

      {/* Floating phone button */}
      <a href="tel:+18886130704" style={{
        position: 'fixed', bottom: 90, right: 16, zIndex: 150,
        width: 52, height: 52, borderRadius: '50%',
        background: 'linear-gradient(135deg, #C8953C, #A67B2E)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(200,149,60,0.4)',
        textDecoration: 'none', color: '#fff', fontSize: 24,
        transition: 'transform 0.2s',
      }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
        </svg>
      </a>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  WEBCAM MODAL (desktop camera capture)
// ═══════════════════════════════════════════════
function WebcamModal({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [camError, setCamError] = useState(null)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => setReady(true)
        }
      })
      .catch(() => setCamError('Camera access denied. Please allow camera permissions and try again.'))

    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  const capture = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const base64 = canvas.toDataURL('image/jpeg', 0.85)
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    onCapture(base64)
  }

  return (
    <div style={styles.webcamOverlay} onClick={onClose}>
      <div style={styles.webcamModal} onClick={e => e.stopPropagation()}>
        <div style={styles.webcamHeader}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>Take a Photo</span>
          <button onClick={onClose} style={styles.webcamCloseBtn}>✕</button>
        </div>
        {camError ? (
          <div style={styles.webcamError}>{camError}</div>
        ) : (
          <>
            <div style={styles.webcamVideoWrap}>
              <video ref={videoRef} autoPlay playsInline muted style={styles.webcamVideo} />
              {!ready && <div style={styles.webcamLoading}>Starting camera...</div>}
            </div>
            <div style={styles.webcamControls}>
              <button onClick={capture} disabled={!ready} style={{ ...styles.webcamShutter, opacity: ready ? 1 : 0.4 }}>
                <div style={styles.webcamShutterInner} />
              </button>
              <p style={{ fontSize: 12, color: '#9B8E7B', marginTop: 8 }}>Position your item and tap to capture</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  RECENT QUOTES TICKER
// ═══════════════════════════════════════════════
const QUOTE_POOL = [
  { item: '14K Gold Cuban Link', low: 3400, high: 4200 },
  { item: 'Rolex Datejust 41mm', low: 8600, high: 9800 },
  { item: 'Diamond Engagement Ring', low: 3600, high: 4500 },
  { item: '18K White Gold Bracelet', low: 1900, high: 2400 },
  { item: 'Cartier Love Ring', low: 2100, high: 2600 },
  { item: '10K Gold Rope Chain', low: 1200, high: 1600 },
  { item: 'Omega Speedmaster', low: 5000, high: 6000 },
  { item: 'Platinum Wedding Band', low: 1100, high: 1400 },
  { item: 'David Yurman Bracelet', low: 350, high: 450 },
  { item: 'Tiffany & Co. Necklace', low: 1800, high: 2200 },
  { item: '24K Gold Bar (1oz)', low: 4500, high: 4800 },
  { item: 'Rolex Submariner', low: 10500, high: 12500 },
  { item: 'Sapphire & Diamond Ring', low: 2600, high: 3200 },
  { item: '14K Gold Figaro Chain', low: 1600, high: 2000 },
  { item: 'Vintage Omega Seamaster', low: 3400, high: 4000 },
  { item: 'Louis Vuitton Keepall', low: 750, high: 1000 },
  { item: 'Emerald Pendant Necklace', low: 1800, high: 2200 },
  { item: '18K Gold Hoop Earrings', low: 850, high: 1100 },
  { item: 'Cartier Tank Watch', low: 3900, high: 4800 },
  { item: 'Pearl Strand Necklace', low: 600, high: 800 },
  { item: 'TAG Heuer Monaco', low: 4200, high: 5000 },
  { item: '10K Gold Signet Ring', low: 500, high: 700 },
  { item: 'Breitling Navitimer', low: 4500, high: 5500 },
  { item: '14K Diamond Tennis Bracelet', low: 2900, high: 3600 },
  { item: 'Gucci Marmont Bag', low: 600, high: 800 },
  { item: 'Chanel Classic Flap', low: 5200, high: 6500 },
  { item: 'Platinum Diamond Studs', low: 2200, high: 2800 },
  { item: 'Hermes Birkin 30', low: 10000, high: 12000 },
  { item: 'Vintage Gold Pocket Watch', low: 1700, high: 2200 },
  { item: 'Silver Eagle Collection (20)', low: 1350, high: 1600 },
]

function RecentQuotesTicker() {
  const generateFallback = (count) => {
    const shuffled = [...QUOTE_POOL].sort(() => Math.random() - 0.5).slice(0, count)
    return shuffled.map((q, i) => {
      const variance = 0.85 + Math.random() * 0.3
      const low = Math.round((q.low * variance) / 50) * 50
      const high = Math.round((q.high * variance) / 50) * 50
      const range = `$${low.toLocaleString()} – $${high.toLocaleString()}`
      const minutes = Math.floor(Math.random() * 5) + (i * 7) + 1
      let time
      if (minutes < 60) time = `${minutes}m ago`
      else if (minutes < 120) time = '1h ago'
      else time = `${Math.floor(minutes / 60)}h ago`
      return { item: q.item, range, time, real: false }
    })
  }

  const [quotes, setQuotes] = useState(() => generateFallback(10))
  const trackRef = useRef(null)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)

  useEffect(() => {
    fetch('/api/recent-quotes')
      .then(r => r.json())
      .then(data => {
        const seen = new Set()
        const realQuotes = (data.quotes || [])
          .filter(q => q.item && q.range)
          .filter(q => {
            const key = q.item.toString().trim().toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .slice(0, 5)
          .map(q => {
            const now = new Date()
            const ts = new Date(q.time)
            const diffMin = Math.max(1, Math.round((now - ts) / 60000))
            let time
            if (diffMin < 60) time = `${diffMin}m ago`
            else if (diffMin < 1440) time = `${Math.floor(diffMin / 60)}h ago`
            else time = `${Math.floor(diffMin / 1440)}d ago`
            const name = q.item.length > 25 ? q.item.substring(0, 23) + '…' : q.item
            return { item: name, range: q.range, time, real: true }
          })

        const fillCount = Math.max(5, 10 - realQuotes.length)
        const fakes = generateFallback(fillCount)
        const combined = [...realQuotes, ...fakes].sort(() => Math.random() - 0.5)
        setQuotes(combined)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const speed = 0.5

    const animate = () => {
      offsetRef.current += speed
      const halfWidth = track.scrollWidth / 2
      if (offsetRef.current >= halfWidth) {
        offsetRef.current -= halfWidth
      }
      track.style.transform = `translateX(-${offsetRef.current}px)`
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [quotes])

  const doubled = [...quotes, ...quotes]

  return (
    <div style={{
      margin: '28px auto 0', maxWidth: 500, width: '100%',
      background: '#1A1816',
      borderRadius: 14, padding: '0', overflow: 'hidden',
      border: '1px solid rgba(200,149,60,0.2)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '10px 16px',
        borderBottom: '1px solid rgba(200,149,60,0.15)',
        background: 'rgba(200,149,60,0.06)',
      }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: '#22c55e', boxShadow: '0 0 6px #22c55e',
          animation: 'livePulse 2s ease-in-out infinite',
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase',
          letterSpacing: 1.5,
        }}>Live</span>
        <span style={{ fontSize: 11, color: '#8A8580', marginLeft: 4 }}>Recent appraisals</span>
      </div>
      <div style={{ overflow: 'hidden', padding: '12px 0' }}>
        <div ref={trackRef} style={{
          display: 'flex', gap: 12,
          width: 'max-content',
          paddingLeft: 12,
          willChange: 'transform',
        }}>
          {doubled.map((q, i) => (
            <div key={i} style={{
              flexShrink: 0,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 10,
              padding: '10px 14px', minWidth: 150, maxWidth: 170,
              border: '1px solid rgba(200,149,60,0.12)',
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{ marginBottom: 4 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#F0E6D0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{q.item}</p>
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#C8953C', fontFamily: '"Playfair Display", serif' }}>{q.range}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <span style={{
                  display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                  background: '#22c55e', opacity: 0.7,
                }} />
                <p style={{ margin: 0, fontSize: 10, color: '#6B6560' }}>{q.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const PurseIcon = () => <svg width="15" height="16" viewBox="-0.5 -1 16 17" fill="none"><path d="M3 6V4a4.5 4.5 0 0 1 9 0v2" stroke="#9B7B5E" strokeWidth="1.2" fill="none" strokeLinecap="round"/><rect x="1" y="6" width="13" height="8" rx="2" fill="#C4A57B" stroke="#9B7B5E" strokeWidth="0.8"/><rect x="5" y="9" width="5" height="1.5" rx="0.75" fill="#9B7B5E" opacity="0.6"/></svg>
  const WatchIcon = () => <svg width="14" height="16" viewBox="0 0 14 16" fill="none"><rect x="3" y="0" width="8" height="3" rx="1" fill="#C8953C" opacity="0.6"/><rect x="3" y="13" width="8" height="3" rx="1" fill="#C8953C" opacity="0.6"/><circle cx="7" cy="8" r="6" fill="#F5ECD7" stroke="#C8953C" strokeWidth="1.2"/><circle cx="7" cy="8" r="4.5" stroke="#C8953C" strokeWidth="0.5" fill="none"/><line x1="7" y1="8" x2="7" y2="5" stroke="#C8953C" strokeWidth="0.8" strokeLinecap="round"/><line x1="7" y1="8" x2="9.5" y2="8" stroke="#C8953C" strokeWidth="0.8" strokeLinecap="round"/></svg>
  const RingIcon = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><ellipse cx="7" cy="8" rx="5.5" ry="4.5" stroke="#C8953C" strokeWidth="1.5" fill="none"/><circle cx="7" cy="3.5" r="2.5" fill="#B8E0F0" stroke="#7CB9D0" strokeWidth="0.5"/></svg>
  const BeltIcon = () => <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><rect x="0" y="2" width="16" height="6" rx="1" fill="#9B7B5E"/><rect x="5" y="1" width="6" height="8" rx="1" fill="#C4A57B" stroke="#7B6040" strokeWidth="0.6"/><circle cx="8" cy="5" r="1.2" fill="#7B6040"/></svg>
  const SunglassesIcon = () => <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 4C1 4 2 1 4.5 1H6C6 1 7 1 7.5 3H8.5C9 1 10 1 10 1H11.5C14 1 15 4 15 4" stroke="#4A4A4A" strokeWidth="1" fill="none" strokeLinecap="round"/><ellipse cx="4" cy="5.5" rx="3" ry="3.5" fill="#4A4A4A" opacity="0.8"/><ellipse cx="12" cy="5.5" rx="3" ry="3.5" fill="#4A4A4A" opacity="0.8"/><path d="M7 4.5Q8 3.5 9 4.5" stroke="#4A4A4A" strokeWidth="0.8" fill="none"/></svg>

  const categories = [
    { name: 'Gold', icon: <GoldBarIcon /> },
    { name: 'Watches', icon: <WatchIcon /> },
    { name: 'Diamonds', icon: <DiamondIcon /> },
    { name: 'Designer Belts', icon: <BeltIcon /> },
    { name: 'Silver', icon: <SilverBarIcon /> },
    { name: 'Jewelry', icon: <NecklaceIcon /> },
    { name: 'Rings', icon: <RingIcon /> },
    { name: 'Handbags', icon: <PurseIcon /> },
    { name: 'Coins', icon: <CoinIcon /> },
    { name: 'Designer Glasses', icon: <SunglassesIcon /> },
  ]

  // Double the list for seamless loop
  const tickerItems = [...categories, ...categories]

  return (
    <section style={{ ...styles.heroSection, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)', transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <div style={styles.heroBg} aria-hidden="true" />
      <div style={styles.tickerWrap}>
        <div style={styles.tickerTrack}>
          {tickerItems.map((cat, i) => (
            <React.Fragment key={i}>
              <span style={styles.tickerItem}>
                <span style={styles.categoryIcon}>{cat.icon}</span>
                <span>{cat.name}</span>
              </span>
              <span style={styles.tickerDot}>·</span>
            </React.Fragment>
          ))}
        </div>
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
          <span>Upload Photo(s)</span>
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
      <div className="steps-grid">
        {[
          { num: '1', title: 'Snap', desc: 'Take or upload a clear photo of your item' },
          { num: '2', title: 'Receive', desc: 'Get an appraisal with full details' },
          { num: '3', title: 'Get Paid', desc: 'Accept your offer and ship with a prepaid label' },
          { num: '4', title: 'Do It Again!', desc: 'Come back anytime with more to sell' },
        ].map((s, i) => (
          <React.Fragment key={s.num}>
            <div style={styles.stepCard}>
              <div style={styles.stepNum}>{s.num}</div>
              <h3 style={styles.stepTitle}>{s.title}</h3>
              <p style={styles.stepDesc}>{s.desc}</p>
            </div>
            {i < 3 && <div className="step-arrow">→</div>}
          </React.Fragment>
        ))}
      </div>

    </section>
  )
}

// ═══════════════════════════════════════════════
//  CAPTURE SCREEN
// ═══════════════════════════════════════════════
function CaptureScreen({ fileInputRef, onCamera, onFile, error }) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (files?.length) onFile(files)
  }

  return (
    <section style={styles.centeredSection}>
      <h2 style={styles.sectionTitle}>What are you selling?</h2>
      <p style={styles.sectionSub}>Take a clear photo or upload from your gallery. Multiple angles help!</p>

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
          <p style={styles.dropText}>Drag & drop image(s) here</p>
          <p style={styles.dropSubtext}>or use the buttons below</p>
        </div>
      </div>

      <div style={styles.captureButtons}>
        <button
          onClick={onCamera}
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
          <span>Upload Photo(s)</span>
        </button>
      </div>

      <div style={styles.tipBox}>
        <strong>Tips for the best estimate:</strong>
        <span> Use good lighting · Show any stamps or hallmarks · Include multiple angles</span>
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

  const images = Array.isArray(imageData) ? imageData : [imageData]

  return (
    <section style={styles.centeredSection}>
      <div style={styles.analyzingCard}>
        {images.length === 1 ? (
          <div style={styles.analyzingImageWrap}>
            <img src={images[0]} alt="Your item" style={styles.analyzingImage} />
            <div style={styles.scanLine} />
          </div>
        ) : (
          <div style={styles.analyzingMultiWrap}>
            {images.map((img, i) => (
              <div key={i} style={styles.analyzingThumbWrap}>
                <img src={img} alt={`Photo ${i + 1}`} style={styles.analyzingThumb} />
                <div style={{ ...styles.scanLine, animationDelay: `${i * 0.4}s` }} />
              </div>
            ))}
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

function EditableDetail({ label, value, onChange, itemType }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const [showTooltip, setShowTooltip] = useState(false)
  const inputRef = useRef(null)
  const isWeight = label.toLowerCase().includes('weight')
  const isJewelryMaterial = label.toLowerCase() === 'material' && ['ring','necklace','bracelet','earrings','coin','bar','other'].includes(itemType)
  const isHighlight = isWeight || isJewelryMaterial

  const tooltipText = isWeight
    ? 'Know the exact weight? Tap to enter it — this dramatically improves your estimate.'
    : isJewelryMaterial
    ? 'Know the exact karat or material? Correcting this gives you a much more accurate offer.'
    : ''

  const placeholderText = isWeight ? 'e.g. 42 grams' : isJewelryMaterial ? 'e.g. 18K Yellow Gold' : ''

  useEffect(() => { setEditValue(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  const save = () => {
    setEditing(false)
    if (editValue.trim() !== value) onChange(editValue.trim())
  }

  const tooltip = showTooltip && tooltipText ? (
    <div style={styles.weightTooltip}>
      <div style={styles.weightTooltipArrow} />
      {tooltipText}
    </div>
  ) : null

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
          placeholder={placeholderText}
        />
      </div>
    )
  }

  return (
    <div style={{ ...styles.detailRow, ...(isHighlight ? styles.weightRow : {}) }}>
      <span style={styles.detailLabel}>
        {label}
        {isHighlight && (
          <span
            style={styles.weightInfoIcon}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
          >
            ⓘ
            {tooltip}
          </span>
        )}
      </span>
      <span style={styles.detailValueWrap}>
        <span style={{ ...styles.detailValue, cursor: 'pointer', ...(isHighlight ? styles.weightValue : {}) }} onClick={() => setEditing(true)}>{value}</span>
        <button onClick={() => setEditing(true)} style={styles.pencilBtn} title="Edit">
          <span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>✏️</span>
        </button>
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════
//  OFFER SCREEN
// ═══════════════════════════════════════════════
function OfferScreen({ analysis, imageData, onGetOffer, onRetry, onReEstimate, isReEstimating, variant, leadData, setLeadData, userEdits, setUserEdits }) {
  const [visible, setVisible] = useState(false)
  const [showCorrections, setShowCorrections] = useState(false)
  const [showDetailsInput, setShowDetailsInput] = useState(false)
  const [isUpdated, setIsUpdated] = useState(false)
  const detailsRef = useRef(null)
  const offerRangeRef = useRef(null)
  const offerTopRef = useRef(null)
  // Store original AI values from first analysis (persists across re-estimates)
  const originalAiValues = useRef(null)
  if (!originalAiValues.current && analysis.details) {
    originalAiValues.current = analysis.details.reduce((acc, d) => ({ ...acc, [d.label]: d.value }), {})
  }
  const [corrections, setCorrections] = useState(() =>
    (analysis.details || []).reduce((acc, d) => ({ ...acc, [d.label]: d.value }), {})
  )
  const [extraNotes, setExtraNotes] = useState('')

  // Variant B: email gate state
  const [gateEmail, setGateEmail] = useState('')
  const [gateUnlocked, setGateUnlocked] = useState(false)

  // Variant C: nudge state
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const [nudgeEmail, setNudgeEmail] = useState('')
  const [nudgeSubmitted, setNudgeSubmitted] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])
  const hasLoadedOnce = useRef(false)
  useEffect(() => {
    setCorrections((analysis.details || []).reduce((acc, d) => ({ ...acc, [d.label]: d.value }), {}))
    setShowDetailsInput(false)
    setExtraNotes('')
    // Scroll to top of offer card after a re-estimate (not initial load)
    if (hasLoadedOnce.current && offerTopRef.current) {
      setIsUpdated(true)
      setTimeout(() => {
        offerTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
    hasLoadedOnce.current = true
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
          <div ref={offerTopRef} style={isUpdated ? styles.offerBadgeUpdated : styles.offerBadge}>
            {isUpdated ? (
              <>
                <CheckIcon size={14} />
                <span>Updated Estimate</span>
              </>
            ) : (
              <>
                <SparkleIcon size={14} />
                <span>Preliminary Estimate</span>
              </>
            )}
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
              {imageData && (() => {
                const images = Array.isArray(imageData) ? imageData : [imageData]
                return (
                  <div style={styles.offerImageWrap}>
                    <img src={images[0]} alt="Your item" style={styles.offerImage} />
                    {images.length > 1 && (
                      <div style={styles.offerThumbRow}>
                        {images.map((img, i) => (
                          <img key={i} src={img} alt={`Photo ${i + 1}`} style={styles.offerThumb} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
              <div style={styles.offerInfo}>
                <h2 style={styles.offerTitle}>{analysis.title}</h2>
                <p style={styles.offerDesc}>{analysis.description}</p>
              </div>
            </div>

            <div ref={detailsRef} style={styles.offerDetails}>
              {analysis.details?.map((d, i) => (
                <EditableDetail
                  key={i}
                  label={d.label}
                  value={corrections[d.label] || d.value}
                  itemType={analysis.item_type}
                  onChange={(newVal) => {
                    const updated = { ...corrections, [d.label]: newVal }
                    setCorrections(updated)
                    // Track this as a user edit
                    const origVal = originalAiValues.current?.[d.label] || d.value
                    if (newVal !== origVal) {
                      setUserEdits(prev => {
                        const filtered = prev.filter(e => e.label !== d.label)
                        return [...filtered, { label: d.label, original: origVal, edited: newVal }]
                      })
                    } else {
                      setUserEdits(prev => prev.filter(e => e.label !== d.label))
                    }
                    // Auto re-estimate if the value actually changed
                    const orig = analysis.details?.find(det => det.label === d.label)
                    if (orig && newVal !== orig.value) {
                      const correctionLines = Object.entries(updated)
                        .map(([label, value]) => `${label}: ${value}`)
                        .join('\n')
                      const full = extraNotes ? `${correctionLines}\nAdditional info: ${extraNotes}` : correctionLines
                      onReEstimate(full)
                    }
                  }}
                />
              ))}
            </div>

            <div ref={offerRangeRef} style={styles.offerRange}>
              {/* VARIANT B: Gated — blur estimate until email entered */}
              {variant === 'B' && !gateUnlocked ? (
                <div style={{ position: 'relative' }}>
                  <div style={{ filter: 'blur(12px)', userSelect: 'none', pointerEvents: 'none' }}>
                    <p style={styles.offerRangeLabel}>Estimated Offer Range</p>
                    <div style={styles.offerPrices}>
                      <span style={styles.offerPrice}>${analysis.offer_low?.toLocaleString()}</span>
                      <span style={styles.offerDash}>—</span>
                      <span style={styles.offerPrice}>${analysis.offer_high?.toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(255,251,245,0.85)', borderRadius: 12,
                  }}>
                    <p style={{ fontFamily: '"Playfair Display", serif', fontSize: 18, fontWeight: 600, color: '#1A1A1A', marginBottom: 4 }}>
                      Your estimate is ready
                    </p>
                    <p style={{ fontSize: 13, color: '#8A8580', marginBottom: 14 }}>
                      Enter your email to reveal your offer
                    </p>
                    <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
                      <input
                        type="email"
                        value={gateEmail}
                        onChange={(e) => setGateEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && gateEmail.includes('@')) {
                            setGateUnlocked(true)
                            setLeadData(prev => ({ ...prev, email: gateEmail }))
                            trackEvent('gate_email_submitted', { method: 'variant_b' })
                            trackMetaEvent('CompleteRegistration', { content_name: 'Email Capture' })
                            fetch('/api/submit-lead', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                firstName: '', lastName: '', email: gateEmail, phone: '', notes: '',
                                item: analysis?.title || '', offerRange: `$${analysis?.offer_low?.toLocaleString()} – $${analysis?.offer_high?.toLocaleString()}`,
                                description: analysis?.description || '', details: analysis?.details || [],
                                offerNotes: analysis?.offer_notes || '', confidence: analysis?.confidence || '',
                                itemType: analysis?.item_type || '', source: 'variant_b_gate', variant, ...getStoredUtm(), ip: getIP(),
                              }),
                            }).catch(() => {})
                          }
                        }}
                        placeholder="your@email.com"
                        style={{
                          flex: 1, padding: '10px 14px', borderRadius: 8,
                          border: '1px solid #D4C5A9', fontSize: 14, fontFamily: 'inherit',
                          background: '#fff', outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => {
                          if (gateEmail.includes('@')) {
                            setGateUnlocked(true)
                            setLeadData(prev => ({ ...prev, email: gateEmail }))
                            trackEvent('gate_email_submitted', { method: 'variant_b' })
                            trackMetaEvent('CompleteRegistration', { content_name: 'Email Capture' })
                            // Send notification with email
                            fetch('/api/submit-lead', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                firstName: '', lastName: '', email: gateEmail, phone: '', notes: '',
                                item: analysis?.title || '', offerRange: `$${analysis?.offer_low?.toLocaleString()} – $${analysis?.offer_high?.toLocaleString()}`,
                                description: analysis?.description || '', details: analysis?.details || [],
                                offerNotes: analysis?.offer_notes || '', confidence: analysis?.confidence || '',
                                itemType: analysis?.item_type || '', source: 'variant_b_gate', variant, ...getStoredUtm(), ip: getIP(),
                              }),
                            }).catch(() => {})
                          }
                        }}
                        style={{
                          padding: '10px 18px', borderRadius: 8, border: 'none',
                          background: 'linear-gradient(135deg, #C8953C, #A67B2E)', color: '#fff',
                          fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Reveal
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <p style={styles.offerRangeLabel}>Estimated Offer Range</p>
                  <div style={styles.offerPrices}>
                    <span style={styles.offerPrice}>${analysis.offer_low?.toLocaleString()}</span>
                    <span style={styles.offerDash}>—</span>
                    <span style={styles.offerPrice}>${analysis.offer_high?.toLocaleString()}</span>
                  </div>
                  {analysis.offer_notes && (
                    <p style={styles.offerNotes}>{analysis.offer_notes}</p>
                  )}
                </>
              )}
            </div>

            {/* Correction section */}
            </div>{/* close opacity wrapper */}
            <div style={styles.correctionSection}>
              <p style={styles.correctionTitle}>Something not right?</p>
              <div style={styles.correctionActions}>
                <button
                  onClick={() => {
                    if (detailsRef.current) {
                      detailsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  }}
                  style={styles.correctionLink}
                >
                  ✏️ Edit the fields above
                </button>
                <button
                  onClick={() => setShowDetailsInput(true)}
                  style={styles.correctionLink}
                >
                  ＋ Add or correct details
                </button>
              </div>
              {showDetailsInput && (
                <div style={{ marginTop: 12 }}>
                  <input
                    type="text"
                    value={extraNotes}
                    onChange={(e) => setExtraNotes(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && extraNotes.trim()) handleReEstimate() }}
                    placeholder="e.g. It is 18K not 14K, weight is 25g, brand is Cartier..."
                    style={styles.correctionInput}
                    autoFocus
                  />
                </div>
              )}
              {showDetailsInput && extraNotes.trim() && (
                <button
                  onClick={handleReEstimate}
                  disabled={isReEstimating}
                  style={{ ...styles.captureBtn, opacity: isReEstimating ? 0.6 : 1, width: '100%', justifyContent: 'center', marginTop: 12 }}
                >
                  {isReEstimating ? 'Updating estimate...' : 'Update Estimate'}
                </button>
              )}
            </div>
          </div>

          <button onClick={() => { trackEvent('cta_get_firm_offer'); onGetOffer() }} style={styles.firmOfferBtn}>
            <span>Get My Firm Offer</span>
            <ArrowIcon size={18} />
          </button>
          <p style={styles.offerCaveat}>
            Free prepaid shipping · Expert in-person evaluation · Payment within 24 hours
          </p>

          {/* VARIANT C: Nudge banner — persistent email prompt */}
          {variant === 'C' && !nudgeDismissed && !nudgeSubmitted && (
            <div style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
              background: 'linear-gradient(135deg, #1A1816, #2A2520)',
              padding: '16px 20px', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
              animation: 'slideUp 0.4s ease',
            }}>
              <button
                onClick={() => { setNudgeDismissed(true); trackEvent('nudge_dismissed') }}
                style={{
                  position: 'absolute', top: 8, right: 12, background: 'none',
                  border: 'none', color: '#8A8580', fontSize: 18, cursor: 'pointer', padding: 4,
                }}
              >✕</button>
              <p style={{ color: '#F0E6D0', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                Want to lock in this offer?
              </p>
              <p style={{ color: '#9B8E7B', fontSize: 12, marginBottom: 10 }}>
                Enter your email and we'll save your estimate and send you a firm offer.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  value={nudgeEmail}
                  onChange={(e) => setNudgeEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nudgeEmail.includes('@')) {
                      setNudgeSubmitted(true)
                      setLeadData(prev => ({ ...prev, email: nudgeEmail }))
                      trackEvent('nudge_email_submitted', { method: 'variant_c' })
                      trackMetaEvent('CompleteRegistration', { content_name: 'Email Capture' })
                      fetch('/api/submit-lead', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          firstName: '', lastName: '', email: nudgeEmail, phone: '', notes: '',
                          item: analysis?.title || '', offerRange: `$${analysis?.offer_low?.toLocaleString()} – $${analysis?.offer_high?.toLocaleString()}`,
                          description: analysis?.description || '', details: analysis?.details || [],
                          offerNotes: analysis?.offer_notes || '', confidence: analysis?.confidence || '',
                          itemType: analysis?.item_type || '', source: 'variant_c_nudge', variant, ...getStoredUtm(), ip: getIP(),
                        }),
                      }).catch(() => {})
                      onGetOffer()
                    }
                  }}
                  placeholder="your@email.com"
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    border: '1px solid #444', fontSize: 14, fontFamily: 'inherit',
                    background: '#2A2520', color: '#F0E6D0', outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    if (nudgeEmail.includes('@')) {
                      setNudgeSubmitted(true)
                      setLeadData(prev => ({ ...prev, email: nudgeEmail }))
                      trackEvent('nudge_email_submitted', { method: 'variant_c' })
                      trackMetaEvent('CompleteRegistration', { content_name: 'Email Capture' })
                      // Send notification with email
                      fetch('/api/submit-lead', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          firstName: '', lastName: '', email: nudgeEmail, phone: '', notes: '',
                          item: analysis?.title || '', offerRange: `$${analysis?.offer_low?.toLocaleString()} – $${analysis?.offer_high?.toLocaleString()}`,
                          description: analysis?.description || '', details: analysis?.details || [],
                          offerNotes: analysis?.offer_notes || '', confidence: analysis?.confidence || '',
                          itemType: analysis?.item_type || '', source: 'variant_c_nudge', variant, ...getStoredUtm(), ip: getIP(),
                        }),
                      }).catch(() => {})
                      onGetOffer()
                    }
                  }}
                  style={{
                    padding: '10px 20px', borderRadius: 8, border: 'none',
                    background: 'linear-gradient(135deg, #C8953C, #A67B2E)', color: '#fff',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Save Offer
                </button>
              </div>
            </div>
          )}
          {variant === 'C' && nudgeSubmitted && (
            <div style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
              background: '#1A3A1A', padding: '14px 20px', textAlign: 'center',
              animation: 'slideUp 0.3s ease',
            }}>
              <p style={{ color: '#A0D8A0', fontSize: 14, fontWeight: 600 }}>
                ✓ Saved! We'll be in touch with a firm offer.
              </p>
            </div>
          )}
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
function LeadForm({ leadData, setLeadData, onSubmit, analysis, directQuote }) {
  const update = (field) => (e) =>
    setLeadData((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <section style={styles.centeredSection}>
      <h2 style={styles.sectionTitle}>{directQuote ? 'Get a Quote' : 'Almost there!'}</h2>
      <p style={styles.sectionSub}>
        {directQuote
          ? 'Tell us about what you\'d like to sell and we\'ll get back to you with an offer.'
          : <>Enter your details and we'll send a prepaid shipping label. Once we receive and verify your{' '}
            <strong>{analysis?.title?.toLowerCase() || 'item'}</strong>, we'll make a firm offer — typically within 24 hours.</>
        }
      </p>

      <form onSubmit={onSubmit} style={styles.form}>
        {directQuote && (
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Describe your item(s) *</label>
            <textarea
              value={leadData.notes}
              onChange={update('notes')}
              required
              placeholder="e.g. 14K gold chain, approx 30g; Rolex Submariner 2019; collection of silver coins..."
              rows={4}
              style={{ ...styles.formInput, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        )}
        <div style={styles.formRow}>
          <div style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.formLabel}>First Name *</label>
            <input
              type="text"
              required
              value={leadData.firstName}
              onChange={update('firstName')}
              placeholder="Jane"
              style={styles.formInput}
            />
          </div>
          <div style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.formLabel}>Last Name *</label>
            <input
              type="text"
              required
              value={leadData.lastName}
              onChange={update('lastName')}
              placeholder="Smith"
              style={styles.formInput}
            />
          </div>
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
        {!directQuote && (
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
        )}
        <button type="submit" style={styles.heroCta}>
          <span>{directQuote ? 'Submit' : 'Continue'}</span>
          <ArrowIcon size={18} />
        </button>
        <p style={styles.formDisclaimer}>
          No cost, no commitment. {directQuote ? 'We\'ll respond within a few hours.' : 'If you don\'t like our offer, we ship your item back free.'}
        </p>
      </form>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  SHIPPING OPTIONS
// ═══════════════════════════════════════════════
function ShippingScreen({ shippingData, setShippingData, onSubmit, leadData }) {
  const update = (field) => (e) =>
    setShippingData((prev) => ({ ...prev, [field]: e.target.value }))

  const isKit = shippingData.method === 'kit'

  return (
    <section style={styles.centeredSection}>
      <h2 style={styles.sectionTitle}>How would you like to ship?</h2>
      <p style={styles.sectionSub}>
        Choose how you'd like to send us your item, {leadData.firstName || 'there'}. Either way, shipping is <strong>completely free</strong> and fully insured.
      </p>

      <form onSubmit={onSubmit} style={styles.form}>
        {/* Shipping method toggle */}
        <div style={styles.shippingOptions}>
          <button
            type="button"
            onClick={() => setShippingData(prev => ({ ...prev, method: 'kit' }))}
            style={isKit ? styles.shippingOptionActive : styles.shippingOption}
          >
            <span style={styles.shippingOptionIcon}>📦</span>
            <span style={styles.shippingOptionTitle}>Send Me a Kit</span>
            <span style={styles.shippingOptionDesc}>Free box, padding & pre-paid label mailed to you</span>
          </button>
          <button
            type="button"
            onClick={() => setShippingData(prev => ({ ...prev, method: 'label' }))}
            style={!isKit ? styles.shippingOptionActive : styles.shippingOption}
          >
            <span style={styles.shippingOptionIcon}>🏷️</span>
            <span style={styles.shippingOptionTitle}>Just the Label</span>
            <span style={styles.shippingOptionDesc}>Pre-paid label emailed in minutes — use your own box</span>
          </button>
        </div>

        {isKit && (
          <p style={{ fontSize: 13, color: '#9B8E7B', marginBottom: 16, textAlign: 'center' }}>
            We'll mail you a free box and pre-paid shipping label — everything you need. Arrives in 2-3 business days.
          </p>
        )}

        {!isKit && (
          <p style={{ fontSize: 13, color: '#9B8E7B', marginBottom: 16, textAlign: 'center' }}>
            We'll email you a pre-paid shipping label to print — you use your own packaging. Label reaches your inbox in minutes.
          </p>
        )}

        <div style={styles.formGroup}>
          <label style={styles.formLabel}>Street Address *</label>
          <input
            type="text"
            required
            value={shippingData.address}
            onChange={update('address')}
            placeholder="123 Main Street, Apt 4B"
            style={styles.formInput}
          />
        </div>
        <div style={styles.formRow}>
          <div style={{ ...styles.formGroup, flex: 2 }}>
            <label style={styles.formLabel}>City *</label>
            <input
              type="text"
              required
              value={shippingData.city}
              onChange={update('city')}
              placeholder="Miami"
              style={styles.formInput}
            />
          </div>
          <div style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.formLabel}>State *</label>
            <input
              type="text"
              required
              value={shippingData.state}
              onChange={update('state')}
              placeholder="FL"
              maxLength={2}
              style={{ ...styles.formInput, textTransform: 'uppercase' }}
            />
          </div>
          <div style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.formLabel}>ZIP *</label>
            <input
              type="text"
              required
              value={shippingData.zip}
              onChange={update('zip')}
              placeholder="33101"
              maxLength={10}
              style={styles.formInput}
            />
          </div>
        </div>

        <button type="submit" style={styles.heroCta}>
          <span>{isKit ? 'Send My Free Kit' : 'Email My Label'}</span>
          <ArrowIcon size={18} />
        </button>
        <p style={styles.formDisclaimer}>
          Free & insured shipping both ways. Don't like our offer? We return your item at no cost.
        </p>
      </form>
    </section>
  )
}

// ═══════════════════════════════════════════════
//  SUBMITTED CONFIRMATION
// ═══════════════════════════════════════════════
function SubmittedScreen({ onReset, shippingMethod, directQuote }) {
  const isKit = shippingMethod === 'kit'

  if (directQuote) {
    return (
      <section style={styles.centeredSection}>
        <div style={styles.successIcon}>
          <CheckIcon size={40} />
        </div>
        <h2 style={styles.sectionTitle}>Quote request received!</h2>
        <p style={styles.sectionSub}>
          We'll review your submission and get back to you with an offer. Want a faster estimate? Snap a photo of your item and get an instant AI-powered appraisal right now.
        </p>
        <button onClick={onReset} style={styles.heroCta}>
          <CameraIcon size={20} />
          <span>Snap a Photo for Instant Estimate</span>
        </button>
        <button onClick={onReset} style={{ ...styles.captureBtnSecondary, marginTop: 12 }}>
          Back to Home
        </button>
      </section>
    )
  }

  return (
    <section style={styles.centeredSection}>
      <div style={styles.successIcon}>
        <CheckIcon size={40} />
      </div>
      <h2 style={styles.sectionTitle}>You're all set!</h2>
      <p style={styles.sectionSub}>
        {isKit
          ? 'Your free shipping kit is on its way! You\'ll receive a box with padding and a prepaid return label within 2-3 business days.'
          : 'Check your email for a prepaid shipping label. Print it, attach it to your package, and drop it off at any shipping location.'
        }
      </p>
      <div style={styles.successSteps}>
        {(isKit ? [
          'Shipping kit arrives in 2-3 days',
          'Pack your item & drop it off',
          'Expert evaluation within 24 hours',
          'Accept offer → get paid instantly',
        ] : [
          'Prepaid label emailed to you',
          'Print, pack & drop off your item',
          'Expert evaluation within 24 hours',
          'Accept offer → get paid instantly',
        ]).map((s, i) => (
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

// ═══════════════════════════════════════════════
//  LEGAL MODAL
// ═══════════════════════════════════════════════
const LEGAL_CONTENT = {
  terms: {
    title: 'General Terms & Conditions',
    date: 'Last Updated: February 24, 2026',
    paragraphs: [
    `At DW5 LLC d/b/a Snappy Gold (“Company”) our mission is to make cashing in on gold, silver and jewelry and watches (the “Goods”) as seamless as possible from the comfort of your home. We provide the following General Terms and Conditions to ensure your understanding of the purchase of your Goods.`,
    `By submitting your Goods to Company customers agree to our General Terms and Conditions, as well as our Privacy Policy and Terms of Service and Website Access and Usage.`,
    `Customers must be a minimum of 18 years of age to sell items through https://snappy.gold and legal owner (or legally authorized on behalf of such owner) of all the items submitted to us.`,
    `General steps to selling goods:`,
    `Contact Us. If you are interested in obtaining an offer to purchase your Goods (as a “Seller”), contact us by email at hello@snappy.gold or visit us online at https://snappy.gold and register. At that time we will provide you with the free materials needed to mail us your goods.`,
    `Packaging. You are responsible for packaging your items. Should we receive damaged or open packages, we reserve the right to return the package to you without any liability therefore. No insurance claims will be processed for packages that arrive damaged. We do, however, insure the Goods properly packaged by you and received by us.`,
    `Sworn Statement. Before conducting a transaction, Company needs:`,
    `Seller’s name, address, telephone number, and e-mail address (if available).`,
    `Seller’s driver’s license number and issuing state or other government-issued identification number.`,
    `A sworn statement made by the Seller that the Seller is of lawful age and that the license number, and other identifying information is true and correct.`,
    `The sworn statement must contain the following language: “I declare under penalty of perjury that the foregoing is true and correct.”`,
    `The sworn statement may be provided electronically through our website or in writing with the Goods being shipped.`,
    `IMPORTANT: If you mail us Goods without providing the required information, we will request any outstanding information from you within ten (10) days. If we do not receive the information requested within 30 days thereafter or you don’t request their return, the Seller’s Goods are deemed abandoned and are relinquished to the Division of Unclaimed Property of the Florida Department of Financial Services if the market value of the property is greater than $50. Within 24-hours of the expiration of the 30-day hold period for the Goods, we will notify the appropriate law enforcement agency of the abandonment of the property.`,
    `Appraisal & Evaluation of Goods. Once received, your Goods shall be checked and/or tested by our trained valuation experts to ascertain their value which is primarily based on the current day values. This process may involve scratching or scraping items in order to remove the top layer of material so that the testing apparatus can accurately determine the true grade or karat of the item in question and/or placing certain acids on the precious metal or other items which can leave permanent staining and/or deep scratches. By submitting your items you are in acceptance of these terms. We will not be liable for any damage caused in this way or any resulting decrease in the value of the items. This is the only way to accurately assess the Goods’ true value.`,
    `Offers. After our determination of the amount of our Offer for your Goods, we will, in our sole discretion, notify you at any or all of the contact information you provided (i.e. e-mail, telephone, and text), each of which will give you the opportunity to accept or reject our offer.`,
    `The value that we place on Goods fluctuates with the applicable market and other factors. If our website contains general gold valuation charts, they should not be relied on for the value that we will pay and may not be continuously updated. In certain instances, we may value your item based on their resale value and in other instances we may base it on the value of melting it down or selling in pieces, taking into account the transaction costs associated with each. Generally speaking, the value of your Goods is determined by many different factors and we can only tell you how much your item[s] are worth by examining them once we receive them. We reserve the right to decline to buy any item from anyone at any time.`,
    `We will hold the Goods at our facility up to thirty (30) days from the date the Goods are received (the “holding period”). During the holding period you may accept or deny the offer. If you accept the offer, payment will be promptly made to you via check, or a different payment method of your choosing. If you deny the offer, we will, at no cost to you, return your Items to you. If we do not hear from you by the time the holding period expires, the offer will be deemed as accepted, payment will be made to you in the amount of the offer and the purchase shall be deemed final, binding and irrevocable.`,
    `Should you desire, you may call us to determine receipt of your Goods and to receive a telephonic quote for the purchase of your Goods. If you approve the quote, your items will be processed and a check mailed to you. If you do not approve our quote we shall promptly return the Goods to you.`,
    `Warranties and Representations.`,
    `You represent and warrant that you are over the age of eighteen years of age. We reserve the right to request documentation to verify your age. We request that you verify your age by entering your age and information on our website. The information includes the following: your name, address, telephone number, and e-mail address (if available). Furthermore, you must provide your license number or a copy of issuing state or other government-issued identification number with photo. You declare under penalty of perjury that the foregoing information provided is true and correct.`,
    `You hereby represent and warrant that all Goods you send to us are owned by you and that no other person or entity’s permission is required to process the Goods purchased by us. You agree to indemnify and hold Snappy Gold, its officers, employees and subsidiaries, harmless from and against any claims brought by a third party claiming ownership of any items purchased from you by us.`
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    date: 'Last Updated: February 24, 2026',
    paragraphs: [
    `Welcome to the DW5 LLC d/b/a Snappy Gold website (https://snappy.gold or the "Website"). This written policy (the "Privacy Policy") is designed to tell you about our practices regarding collection, use, and disclosure of information that you may provide via this Website and certain related services. Please be sure to read this entire Privacy Policy before using, or submitting information, to this Website.`,
    `Your Consent`,
    `This Privacy Policy sets forth the Website's current policies and practices with respect to nonpublic personal information of the users of the Website. By using this Website, you agree with the terms of this Privacy Policy. Whenever you submit information via this Website, you consent to the collection, use, and disclosure of that information in accordance with this Privacy Policy.`,
    `At Snappy Gold, we put the needs of our customers first. Ensuring that you get an honest, upfront, hassle-free service is our highest priority. Snappy Gold offers a complimentary quote for our gold purchasing services. The information gathered for this quote is used to give you the most accurate quote possible. Personal information such as your name, address, phone number(s), email address, and driver’s license (or other government ID) is stored in our in-house database and is used for any customer care issues that may arise. Per Florida law, we also make available the description of and photos of the jewelry/gold provided, as well as the contact information of any seller on a portal accessible by law enforcement.`,
    `PLEASE READ THE FOLLOWING PRIVACY POLICY (OTHERWISE NOTED AS THIS “AGREEMENT”) CAREFULLY BEFORE USING THE WEBSITES BY USING THIS WEBSITE, YOU SIGNIFY YOUR ASSENT TO THIS AGREEMENT. IF YOU DO NOT ASSENT TO THIS AGREEMENT, PLEASE DO NOT USE THIS WEBSITE.`,
    `At Snappy Gold, we share your concerns about privacy. We have created this privacy statement in order to demonstrate our firm commitment. The following discloses our information gathering and dissemination practices for all Snappy Gold web pages.`,
    `COLLECTION OF PERSONAL INFORMATION`,
    `We may collect information that identifies you, such as names, postal addresses, email addresses, telephone and driver’s license or other identification (“personal information”), when voluntarily submitted by our visitors. We receive and store any information that you choose to enter through the Website, including any submissions that you make or content you provide on or through the Website or through outside social media promotions that we may sponsor.`,
    `Use of Information`,
    `We may use the information we collect in the following ways:`,
    `Send you requested service information`,
    `Provide you with a requested service`,
    `Respond to customer service requests`,
    `Respond to your questions and concerns`,
    `Send you marketing communications or advertisements`,
    `Improve our website or services`,
    `Personalize your web or service experience`,
    `To protect against fraud, and insure confidentiality and security`,
    `Sharing of Information`,
    `We will share your personal information with third parties only in the ways that are described in this privacy statement. We do not sell, rent, trade, or otherwise share your personal information with third parties without first providing you notice and choice.`,
    `We may provide your personal information to agents or service providers acting on our behalf for limited purposes. For example, we may share personal information with our agents or service providers to send you email on our behalf or to ship gold/jewelry, mailing/appraisal kits, or transmit payment. These third parties are authorized to use your personal information only to perform the service they are providing for us.`,
    `We may also share your information for the purposes of protecting against fraud, and insure confidentiality and security. Specifically, under Florida law, law enforcement is allowed access to our records as part of their investigation into the sale of stolen gold/jewelry.`,
    `Additionally, we reserve the right to disclose your personal information as required by law (e.g., to comply with a subpoena, warrant, court order, or similar legal process served on our website) and when we believe that disclosure is necessary to protect our rights, protect your safety or the safety of others, investigate fraud, and/or respond to a government request. In certain situations, we may be required to disclose personal data in response to lawful requests by public authorities, including meeting national security or law enforcement requirements.`,
    `In the event Snappy Gold goes through a business transition, such as a merger, acquisition by another company, or sale of all or a portion of its assets, your personally identifiable information will likely be among the assets transferred. You will be notified via email and/or a prominent notice on our website of any such change in ownership or control of your personal information, as well as any choices you may have regarding your personal information.`,
    `IP ADDRESS`,
    `We log all connections to our web servers. Those log files include your IP address. An IP address is NOT personally identifiable information, but general information about your location, connection to the Internet, and your Internet Service Provider. We use your IP address to help diagnose problems with our server and to administer the Sites. Additionally, we will use your IP address to track your navigation of the Sites and we may use your navigation history in current and future marketing efforts to you and to others.`,
    `SECURITY`,
    `We care about protecting the security of your personal information, and we have implemented security procedures to protect the personal information that you provide to us. However, no method of transmitting or storing electronic data is ever completely secure, and we cannot guarantee that such information will never be accessed, used, or released in a manner that is inconsistent with this policy. Some of the measures we take are:`,
    `•	Limiting access to personal information to those employees who are critical to communicating with you and/or processing contributions.`,
    `•	Implementing appropriate physical, electronic and procedural safeguards to guard against unauthorized access or use.`,
    `•	Requiring appropriate consents and protections from our business partners before we share any personally identifiable information.`,
    `While we strive to protect your personal information, you acknowledge that: (a) there are security and privacy limitations of the internet which are beyond our control; (b) the security, integrity, and privacy of any and all information and data exchanged between you and us through this Website cannot be guaranteed; and (c) any such information and data may be viewed or tampered with in transit by a third party. Moreover, where you may be required to use passwords, or other special access features on this Website, it is your responsibility to safeguard them.`,
    `Passive Information Collection`,
    `As you navigate through a website, certain information can be passively collected (that is, gathered without you actively providing the information) using various technologies and means, such as Internet Protocol addresses, cookies, Internet tags, and navigational data collection.`,
    `This Website may use Internet Protocol (IP) addresses. An IP Address is a number assigned to your computer by your Internet service provider so you can access the Internet and is generally considered to be non-personally identifiable information, because in most cases an IP address is dynamic (changing each time you connect to the Internet), rather than static (unique to a particular user's computer). We use your IP address to diagnose problems with our server, report aggregate information, determine the fastest route for your computer to use in connecting to our Website, and administer and improve services to our consumers.`,
    `A "cookie" is a bit of information that a website sends to your web browser that helps the site remember information about you and your preferences.`,
    `"Session cookies" are temporary bits of information that are erased once you exit your web browser window or otherwise turn your computer off. Session cookies are used to improve navigation on websites and to collect aggregate statistical information. This Website uses session cookies.`,
    `"Persistent cookies" are more permanent bits of information that are placed on the hard drive of your computer and stay there unless you delete the cookie. Persistent cookies store information on your computer for a number of purposes, such as retrieving certain information you have previously provided (e.g., username), helping to determine what areas of the website visitors find most valuable, and customizing the website based on your preferences. This Website uses persistent cookies.`,
    `"Internet tags" (also known as single-pixel GIFs, clear GIFs, invisible GIFs, and 1-by-1 GIFs) are smaller than cookies and tell the website server information such as the IP address and browser type related to the visitor's computer. This Website uses Internet tags. "Navigational data" ("log files," "server logs," and "clickstream" data) and "Internet Tags" are used for system management, to improve the content of the site, market research purposes, and to communicate information to visitors. This Website uses navigational data.`,
    `Links`,
    `This Website may contain links to websites of third parties not affiliated with Snappy Gold. This Privacy Policy will not apply to these third-party websites and the Website is not responsible for the privacy practices or the content on any of these other websites, even where these third-party sites indicate a special relationship or "partnership" with the Website. We do not disclose personally identifiable information to those responsible for the linked sites. The linked sites, however, may collect personal information from you when you link to their site. This collecting of information is not subject to the control of the Website. To ensure protection of your privacy, always review the privacy policies of the sites you visit by linking from this Website.`,
    `Testimonials`,
    `We may display personal testimonials on our website in addition to other endorsements. With your consent, we may post your testimonial along with your name and city/state of residence. If you wish to update or delete your testimonial, you can contact us at hello@snappy.gold.`,
    `California Do Not Track Disclosures`,
    `How do we respond to Web browser “do not track” signals or other mechanisms that provide consumers the ability to exercise choice regarding the collection of personally identifiable information about an individual consumer’s online activities over time and across third-party websites or online services?`,
    `We currently do not respond to DNT signals in browsers because we do not track individual users across the web.`,
    `May other parties collect personally identifiable information about an individual consumer’s online activities over time and across different websites when they visit https://snappy.gold?`,
    `Yes.`,
    `Notice to California Residents`,
    `With certain exceptions, residents of the State of California may request (a) disclosure of personal information collected, (b) disclosure of personal information sold or disclosed for a business purpose, (c) deletion of personal information, (d) to opt out of the sale of personal information, and (e) access and data portability. Moreover, we will not discriminate based on your exercise of such rights. If you are a California resident and want to make any such requests, please contact us through our website (https://snappy.gold), or at Snappy Gold, Privacy Policy, 1686 S Federal Hwy #318, Delray Beach, FL 33483 or hello@snappy.gold.`,
    `Notice to Vermont Residents`,
    `In response to Vermont regulations, we automatically treat accounts with Vermont billing addresses as if you requested that we do not share your information with nonaffiliated third parties and that we limit the information we share with our affiliates. If we disclose information about you to nonaffiliated third parties with whom we have joint marketing agreements, we will only disclose your name, address, other contact information, and information about our transaction and experiences with you.`,
    `Notice to Nevada Residents`,
    `We are providing you this notice pursuant to state law. You may be placed on our internal Do Not Call List by requesting that we cease calling you by contacting us directly and making such request in writing hello@snappy.gold.. Nevada law requires that we also provide you with the following contact information: Bureau of Consumer Protection, Office of the Nevada Attorney General, 555 E. Washington St., Suite 3900, Las Vegas, NV 89101; Phone number: 702-486-3132; e-mail: BCPHELLO@ag.state.nv.us.`,
    `Protecting Children’s Privacy Online`,
    `The Website is not directed to individuals under the age of eighteen (18), and we request that these individuals do not provide Personal Information through the Website. We do not knowingly collect information from children under 18 without parental consent. Visit the Federal Trade Commission website for more information about the Children's Online Privacy Protection Act (COPPA). If you believe that we have received information from a child or other person who is not of a majority age in their relevant jurisdiction, please contact us at our email or physical mailing address listed in the “Contact Us” section below and we will take all reasonable efforts to remove the information.`,
    `CHANGES TO THIS PRIVACY POLICY`,
    `This privacy policy describes the types of information we currently collect, and the ways we use and protect that information. From time to time, we may collect different types of information and use that information in different ways – for example, when we add features or services to Snappy Gold. In these cases, we may edit this policy to explain the new practices. Because protecting your privacy is very important to us, we do not expect major changes in policy. However, if we do make significant changes in our practices, we will include announcements on the https://snappy.gold home page so that you will know to review the revised policy.`,
    `CONTACT US`,
    `​Email us. ​E-mail us at hello@snappy.gold..`,
    `Call us. ​Our customer service team is available  at toll-free number at 888-613-0704 between the hours of 8 am – 5 pm EST Monday through Friday.`,
    `Write us. ​Update your communication preferences by mailing us a letter at: Snappy Gold, 1686 S Federal Hwy #318, Delray Beach, FL 33483.`,
    `If you have any questions regarding this Privacy Policy, or https://snappy.gold, don’t hesitate to contact us!`,
    `Please print and retain a copy of this privacy policy for your records.`
    ],
  },
  tos: {
    title: 'Terms of Service & Website Access',
    date: 'Last Updated: February 24, 2026',
    paragraphs: [
    `Please note that all calls with the company may be recorded or monitored for quality assurance and training purposes.
​
AGREEMENT BETWEEN USER AND DW5 LLC d/b/a Snappy Gold - PLEASE READ THE TERMS OF SERVICE SET FORTH BELOW (THE “TERMS”) GOVERN YOUR USE OF THIS WEBSITE ON THE WORLD WIDE WEB (THE “SITE”) AND ARE LEGALLY BINDING ON YOU. IF YOU DO NOT AGREE WITH ANY OF THESE TERMS, DO NOT ACCESS OR OTHERWISE USE THIS SITE OR ANY INFORMATION CONTAINED ON THE SITE. YOUR USE OF THE SITE SHALL BE DEEMED TO BE YOUR AGREEMENT TO ABIDE BY EACH OF THE TERMS SET FORTH BELOW.`,
    `These Terms affect your legal rights, including an agreement to resolve disputes that may arise between us by arbitration on an individual basis instead of by class actions or jury trials Snappy Gold (Company) may provide you, (the “User” or “you”), with access to its content, resources, tools for communication, public forums, commerce platforms, and other services through its network of websites (the “Service”). Company provides the Service to the User, subject to the following Terms, which you accept by accessing Company websites. Company is not responsible for providing you access facilities or equipment (in any form) to its Service. You, the User, also comprehend and agree that the Service may include advertisements and sponsorships and that these are necessary for Company to provide the Service. You also comprehend and agree that Company makes no warranty or representation about the suitability, reliability, availability, timeliness, accuracy of the information, products, services and related graphics contained within the Service for any purpose. The Service is provided “as is” without warranty of any kind. Company hereby disclaim all warranties and conditions with regard to the Service.`,
    `ELIGIBILITY
Use of the Service is limited to parties that lawfully can enter into and form contracts under applicable law. For example, minors are not allowed to use the Service. If you are 17 years of age or younger, you must immediately navigate away from this Site.
​
ACKNOWLEDGMENT AND ACCEPTANCE OF TERMS OF SERVICE
By using the Services or otherwise accessing the Company websites, you agree to be bound by all terms and conditions hereof and all policies and guidelines incorporated by reference The Service is provided to you, the User, under the terms and conditions and any amendments thereto and any operating rules or policies that may be published from time to time by Company as part of the Terms of Service/Legal Disclaimer and related disclosures which are cumulatively included herein by reference.`,
    `MODIFICATION OF THESE TERMS OF USE
Company reserves the right to change any of the terms, conditions, and notices under which the Services are offered. You are responsible for regularly reviewing these Terms, including changes/modifications if any incorporated by us from time to time. Your continued use of the Service constitutes your agreement to all such terms, conditions, and notices.`,
    `MODIFICATION TO THE SERVICE
Company reserves the right to modify or discontinue, temporarily or permanently, the Service (or any part of the Service) with or without notice to the User at any time and from time to time. The User agrees that Company shall not be liable to the User or any third party for any modification or discontinuance of the Service. It will not discontinue services while in receipt of your gold/jewelry and will complete any pending transactions with you.`,
    `USER CONDUCT
The Service may include online account access, content viewing, and means designed to enable you to communicate with Company (collectively, “Tools for Communication”). You agree to use the Tools for Communication only to post, send and receive messages and material that are proper and, when applicable, related to the particular tool for communication. You also hereby agree that you shall not make use of the Service for any commercial purpose, including reselling and/or co-branding/private labeling. As a condition of your use of the Service you, the User, agree to provide: (a) true, accurate, current and complete information about yourself as required to register; (b) maintain and promptly update the registration information to keep it accurate, current and complete. If you provide any information that is untrue, inaccurate, not current or incomplete, Company has the right to terminate the User account and refuse any and all current or future use of the Service; and (c) Company has the right to use / disclose the aggregate registration information to third party service providers in connection with marketing of services, subject to the Privacy Policy. You have also consented to Company having the right to use your registration information to provide targeting of advertising and other service offers. This could also be used to customize the content you see, to fulfill your requests for certain services and to contact/inform you through e-mail or otherwise about special offers or updates on our cash-4-gold business.`,
    `USAGE OBLIGATIONS
As a condition of your use of the Service you will not use the Service for any illegal purposes, including selling stolen gold/jewelry through our Service. You will be solely responsible for the contents of transmissions made by you through the Service. You agree not to use the Service to: (a) Obstruct or hinder the use and enjoyment of the Service by other Users; (b) Violate any applicable local, state, national, and international laws and regulations; (c) Impersonate any person or entity, or falsely state or otherwise misrepresent your affiliation with a person or entity; (d) Interfere with or disrupt the Service or servers or networks connected to the Service, or defy any requirements, regulations or guidelines of networks connected to the Service; (e) Upload, post, e-mail, transmit or otherwise make available any content that is unlawful, damaging, intimidating, hostile, offensive, harassing, defamatory, improper, obscene, vulgar, invasive of another’s privacy, caste related, ethnically or otherwise objectionable; (f) Upload, post, e-mail, transmit or otherwise make available any content protected by any patent, trademark, copyright or other intellectual proprietary laws unless you own or control the rights thereto or have received all necessary consents to do the same; (g) Upload files that contain viruses, worms, corrupted files or any other similar software or programs designed to disrupt, damage or limit the operation of any computer or telecommunications equipment or property of another; (h) Reproduce, duplicate, copy, sell, resell or exploit for any commercial purposes, any portion, use or access of the Service; and (i) Conduct any activity that would aid or assist terrorism or related activity. Company reserves the right to terminate your access to any or all of the Services, at any time, without notice, for any reason whatsoever.`,
    `USER ACCOUNT, PASSWORD & SECURITY
As part of the Service’s registration process you will provide us with current, complete and accurate information as requested by the registration form. You will then choose a user name and password. You take total responsibility for maintaining the confidentiality of your password and account. You are also entirely responsible for any and all activities that occur under your account. You agree to notify Company immediately of any unlawful/unauthorized use of your account or any other security violation. You agree to ensure that you exit from your account at the end of each session. You understand that Company will not be liable for any loss or damage in any form incurred as a result of unauthorized usage of your account, with or without your knowledge. However, you could be held liable for losses or damages incurred by Company or a third party as a result of your failure to comply with this clause. You also agree not to use anyone else’s account, at any time, without the prior permission of the account holder.`,
    `LINKS ON/IN THE SERVICES
The Service or third parties may provide links to other worldwide web sites or resources. Because Company has no control over such sites and resources, you acknowledge and agree that Company is not responsible for the availability of such external sites or resources, and does not endorse and is not responsible or liable for any content, information, advertising, products, or other materials on or available from such sites or resources. You further acknowledge and agree that Company shall not be responsible or liable, directly or indirectly, for any damage or loss caused or alleged to be caused by or in connection with use of or reliance on any such content, goods or services available on or through any such site or resource.`,
    `SNAPPY GOLD’S PROPRIETARY RIGHTS
You acknowledge and agree that the Service and any necessary software used in connection with the service (“Software”) contain proprietary and confidential information that is protected by applicable intellectual property and other laws. You further acknowledge and agree that content contained in information presented to you through the Service is protected by copyrights, trademarks, service marks, patents or other proprietary rights and laws. Except as expressly authorized by Company, you agree not to modify, rent, lease, loan, sell, distribute or create derivative works based on the Service or the Software, in whole or in part.`,
    `PRIVACY POLICY
Registration information and certain other information about you is subject to our Privacy Policy. For more information, see our Privacy Policy.`,
    `LIMITATION OF LIABILITY
You expressly understand and agree that to the extent permitted under law, Company shall not be liable for any direct, indirect, incidental, special, consequential or exemplary damages, including but not limited to, damages for loss of profits, goodwill, use, data or other intangible losses (even if Company has been advised of the possibility of such damages), resulting from: (i) the use or the inability to use the Service; (ii) the cost of procurement of substitute services resulting from any services obtained or messages received or transactions entered into through or from the Service; (iii) unauthorized access to or alteration of your transmissions or data; (iv) statements or conduct of any third party on the Service; or (v) any other matter relating to the Service. If you are shipping gold/jewelry to Company as part of the Service, it is your responsibility to insure the shipment.`,
    `INDEMNITY
You agree to indemnify and hold Company, and its subsidiaries, affiliates, officers, agents, co-branders or other partners, and employees, harmless from any claim or demand including reasonable attorneys’ fees, which any third party may make due to or arising out of content you submit, post to or transmit through the Service, your use of the Service (including shipping stolen gold/jewelry), your connection to the service, your violations of these Terms (whether alleged or otherwise), or your violation of any rights of another, whether direct or indirect (including without limitation claims for misrepresentation).`,
    `CONTENT PROVIDED TO THE SERVICE
Company does not claim ownership of the “content” (in the form of data, text, software, music, sound, photographs, graphics, video, messages or other materials) you provide to Company (including feedback and suggestions). However, by providing such content or any other material, you grant Company and its affiliate sites unrestricted and irrevocable permission to use your submission in connection with the operation of their Internet businesses, including, without limitation, the rights to copy, distribute, transmit, publicly display, publicly perform, reproduce, edit, translate and reformat your submission, and to publish your name in connection with your submission.`,
    `COPYRIGHT INFRINGEMENT POLICY
In accordance with the requirements set forth in the Digital Millennium Copyright Act, Title 17 United States Code Section 512(c)(2) (“DMCA”), Company will investigate notices of copyright infringement and take appropriate remedial action. If you believe that any Content on https://snappy.gold has been used or copied in a manner that infringes your work, please provide a written notification of claimed copyright infringement to the Designated Agent for the Site containing the following elements as set forth in the DMCA:`,
    `a physical or electronic signature of the owner of the copyright interest that is alleged to have been infringed or the person authorized to act on behalf of the owner;`,
    `identification of the copyrighted work(s) claimed to have been infringed, including copyright date;`,
    `identification of the Content you claim to be infringing and which you request be removed from the Site or access to which is to be disabled along with a description of where the infringing Content is located;`,
    `information reasonably sufficient to allow us to contact you, such as a physical address, telephone number and an email address;`,
    `a statement by you that you have a good faith belief that the use of the Content identified in your written notification in the manner complained of is not authorized by you or the copyright owner, its agent or the law; and`,
    `a statement by you that the information in your written notification is accurate and that, under penalty of perjury, you are the copyright owner or authorized to act on behalf of the copyright owner.`,
    `Company’s designated agent for the written notification of claims of copyright infringement can be contacted at the following address:`,
    `Designated Agent – Copyright Infringement Claims
David Weiss`,
    `1686 S Federal Hwy #318,`,
    `Delray Beach, FL 33483`,
    `APPLICABLE LAW
By visiting Company, you agree that the laws of the state of Florida, without regard to principles of conflict of laws, will govern this Agreement and any dispute of any sort that might arise between you and Company.`,
    `DISPUTES AND ARBITRATION/CLASS ACTION WAIVER
Any dispute relating in any way to your visiting this website or your use of any of the Services shall be submitted to confidential, binding arbitration in Delray Beach, FL, except that, to the extent you have in any manner violated or threatened to violate Company’s intellectual property rights, Company may seek injunctive or other appropriate relief in any state or federal court in Florida, and you consent to exclusive jurisdiction and venue in such courts. Arbitration hereunder shall be conducted under the rules then prevailing of the American Arbitration Association. The arbitrator’s award shall be binding, but subject to review in accordance with applicable statutes, rules and regulations governing arbitration awards and may be entered as a judgment in any court of competent jurisdiction. To the fullest extent permitted by applicable law, no arbitration hereunder shall be joined to an arbitration involving any other party subject to these terms and conditions, whether through class arbitration proceedings or otherwise.`,
    `​
PLEASE PRINT AND RETAIN A COPY OF THESE TERMS OF SERVICE FOR YOUR RECORDS.`
    ],
  },
}

function LegalModal({ type, onClose }) {
  const content = LEGAL_CONTENT[type]
  if (!content) return null

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const isHeader = (text) => {
    const t = text.trim()
    if (t.length > 100) return false
    if (t === t.toUpperCase() && t.length > 3 && !t.startsWith('\u2022') && !t.startsWith('PLEASE')) return true
    const headers = ['Your Consent', 'Use of Information', 'Sharing of Information', 'Links',
      'Testimonials', 'Passive Information Collection', 'Warranties and Representations.',
      'General steps to selling goods:', 'Sworn Statement.', 'Notice to California',
      'Notice to Vermont', 'Notice to Nevada', 'Protecting Children', 'California Do Not Track']
    if (headers.some(h => t.startsWith(h))) return true
    return false
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1A1816', border: '1px solid rgba(200,149,60,0.2)',
        borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 28px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: '#FAF6F0', margin: 0,
              fontFamily: "'EB Garamond', serif" }}>{content.title}</h2>
            <p style={{ fontSize: 12, color: '#C8953C', marginTop: 4,
              fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.04em' }}>{content.date}</p>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8,
            width: 36, height: 36, cursor: 'pointer', color: '#888', fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
          >&times;</button>
        </div>
        {/* Body */}
        <div style={{
          padding: '24px 28px 32px', overflowY: 'auto', flex: 1,
          WebkitOverflowScrolling: 'touch',
        }}>
          {content.paragraphs.map((p, i) => {
            if (isHeader(p)) {
              return <h3 key={i} style={{
                fontSize: 13, fontWeight: 600, color: '#C8953C', textTransform: 'uppercase',
                letterSpacing: '0.06em', margin: '28px 0 10px',
                fontFamily: "'DM Sans', sans-serif",
              }}>{p}</h3>
            }
            if (p.startsWith('\u2022') || p.startsWith('\t')) {
              return <p key={i} style={{
                fontSize: 15, color: 'rgba(250,246,240,0.8)', lineHeight: 1.7,
                marginBottom: 10, paddingLeft: 16,
                fontFamily: "'EB Garamond', serif",
              }}>{p}</p>
            }
            return <p key={i} style={{
              fontSize: 15, color: 'rgba(250,246,240,0.8)', lineHeight: 1.7,
              marginBottom: 14, fontFamily: "'EB Garamond', serif",
            }}>{p}</p>
          })}
        </div>
      </div>
    </div>
  )
}

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
    gap: 5,
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
    fontFamily: '"EB Garamond", serif',
    fontWeight: 500,
    fontSize: 18,
  },
  logoText: {
    fontFamily: '"EB Garamond", serif',
    fontWeight: 500,
    fontSize: 22,
    color: '#2A2015',
    letterSpacing: '0.01em',
    textShadow: '0 0 10px rgba(212,163,68,0.4), 0 0 20px rgba(212,163,68,0.2), 0 0 3px rgba(212,163,68,0.15)',
  },
  logoDot: {
    fontFamily: '"EB Garamond", serif',
    fontWeight: 500,
    fontSize: 22,
    color: gold,
    margin: '0 0 0 -2px',
    textShadow: '0 0 10px rgba(212,163,68,0.5), 0 0 20px rgba(212,163,68,0.25)',
  },
  logoGold: {
    fontFamily: '"EB Garamond", serif',
    fontWeight: 500,
    fontSize: 22,
    color: gold,
    letterSpacing: '0.01em',
    textShadow: '0 0 10px rgba(212,163,68,0.5), 0 0 20px rgba(212,163,68,0.25), 0 0 3px rgba(212,163,68,0.2)',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  navLink: {
    background: 'none',
    border: 'none',
    padding: '7px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    color: muted,
    fontFamily: 'inherit',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.4)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    padding: 20,
  },
  modalContent: {
    background: '#FFFDF8',
    borderRadius: 16,
    padding: 32,
    maxWidth: 380,
    width: '100%',
    position: 'relative',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 16,
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    color: muted,
    padding: 4,
  },
  contactItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 10,
    border: `1px solid ${border}`,
    textDecoration: 'none',
    color: dark,
    fontSize: 15,
    transition: 'all 0.2s',
  },
  contactIcon: {
    fontSize: 20,
    width: 24,
    textAlign: 'center',
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
    paddingTop: 44,
    paddingBottom: 60,
    position: 'relative',
    overflow: 'hidden',
  },
  heroBg: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    height: 350,
    backgroundImage: 'url(https://images.unsplash.com/photo-1515562141589-67f0d569b6fc?w=800&q=80)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: 0.22,
    filter: 'saturate(0.5) sepia(0.4)',
    borderRadius: 20,
    pointerEvents: 'none',
    zIndex: 0,
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
  tickerWrap: {
    overflow: 'hidden',
    width: '100%',
    marginBottom: 28,
    maskImage: 'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)',
    WebkitMaskImage: 'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)',
    position: 'relative',
    zIndex: 1,
  },
  tickerTrack: {
    display: 'flex',
    gap: 24,
    width: 'max-content',
    animation: 'tickerScroll 25s linear infinite',
  },
  tickerItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 15,
    fontWeight: 500,
    color: '#7B7060',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  categoryIcon: {
    fontSize: 14,
    display: 'inline-flex',
    alignItems: 'center',
  },
  tickerDot: {
    color: '#C8953C',
    fontSize: 20,
    lineHeight: 1,
    userSelect: 'none',
    flexShrink: 0,
  },
  heroButtons: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    position: 'relative',
    zIndex: 1,
  },
  heroTitle: {
    fontFamily: '"Playfair Display", serif',
    fontSize: 'clamp(36px, 7vw, 64px)',
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: dark,
    marginBottom: 20,
    position: 'relative',
    zIndex: 1,
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
    position: 'relative',
    zIndex: 1,
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
    gap: 16,
    marginTop: 28,
    flexWrap: 'nowrap',
    position: 'relative',
    zIndex: 1,
  },
  trustItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: muted,
    whiteSpace: 'nowrap',
  },
  stepCard: {
    padding: 20,
    borderRadius: 16,
    border: `1px solid ${border}`,
    background: '#FFFDF8',
    textAlign: 'left',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
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
    fontSize: 18,
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
    animation: 'ctaRing 2.2s ease-out infinite',
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
  analyzingMultiWrap: {
    display: 'flex',
    gap: 4,
    overflow: 'hidden',
    borderRadius: '16px 16px 0 0',
  },
  analyzingThumbWrap: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    maxHeight: 250,
    overflow: 'hidden',
  },
  analyzingThumb: {
    width: '100%',
    height: '100%',
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
  offerBadgeUpdated: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 16px',
    borderRadius: 100,
    background: 'rgba(34, 197, 94, 0.1)',
    color: '#16A34A',
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 24,
    animation: 'badgeFlash 1.5s ease',
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
  offerImageWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },
  offerImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    objectFit: 'contain',
    background: '#F5F0E8',
  },
  offerThumbRow: {
    display: 'flex',
    gap: 4,
  },
  offerThumb: {
    width: 38,
    height: 38,
    borderRadius: 6,
    objectFit: 'cover',
    background: '#F5F0E8',
    border: '1px solid #E8DCC8',
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
    alignItems: 'baseline',
    fontSize: 14,
    padding: '8px 0',
    gap: 16,
  },
  detailLabel: { color: muted, flexShrink: 0, minWidth: 110 },
  detailValue: { fontWeight: 500, textAlign: 'right' },
  detailValueWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    textAlign: 'right',
  },
  pencilBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    opacity: 0.5,
    transition: 'opacity 0.2s',
  },
  weightRow: {
    animation: 'weightPulse 2s ease-in-out 1s 2',
    borderRadius: 8,
    position: 'relative',
  },
  weightValue: {
    color: goldLight,
    fontWeight: 600,
  },
  weightInfoIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: 6,
    fontSize: 13,
    color: goldLight,
    cursor: 'pointer',
    position: 'relative',
  },
  weightTooltip: {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1A1A1A',
    color: '#fff',
    fontSize: 12,
    lineHeight: 1.4,
    padding: '10px 14px',
    borderRadius: 10,
    width: 220,
    zIndex: 10,
    textAlign: 'center',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    fontWeight: 400,
  },
  weightTooltipArrow: {
    position: 'absolute',
    bottom: -5,
    left: '50%',
    transform: 'translateX(-50%) rotate(45deg)',
    width: 10,
    height: 10,
    background: '#1A1A1A',
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
    marginBottom: 10,
    color: dark,
    textAlign: 'center',
  },
  correctionActions: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
  },
  correctionLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: 'inherit',
    fontWeight: 500,
    color: goldLight,
    padding: '4px 0',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    textDecorationColor: '#D4C5A9',
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

  // ── Shipping ──
  formRow: {
    display: 'flex',
    gap: 12,
  },
  shippingOptions: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
  },
  shippingOption: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '20px 16px',
    borderRadius: 14,
    border: `2px solid ${border}`,
    background: '#FFFDF8',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
    gap: 6,
  },
  shippingOptionActive: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '20px 16px',
    borderRadius: 14,
    border: `2px solid ${goldLight}`,
    background: goldBg,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
    gap: 6,
    boxShadow: `0 0 0 3px rgba(200,149,60,0.1)`,
  },
  shippingOptionIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  shippingOptionTitle: {
    fontFamily: '"Playfair Display", serif',
    fontWeight: 600,
    fontSize: 16,
    color: '#1A1A1A',
  },
  shippingOptionDesc: {
    fontSize: 12,
    color: muted,
    lineHeight: 1.4,
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
  footerLinks: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  footerLink: {
    fontSize: 12,
    color: '#C8953C',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  footerLinkDivider: {
    fontSize: 12,
    color: '#555',
  },
  webcamOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  webcamModal: {
    background: '#FFFDF8',
    borderRadius: 20,
    overflow: 'hidden',
    maxWidth: 520,
    width: '100%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  webcamHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: `1px solid ${border}`,
  },
  webcamCloseBtn: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    color: '#9B8E7B',
    padding: '4px 8px',
  },
  webcamVideoWrap: {
    position: 'relative',
    background: '#000',
    aspectRatio: '4/3',
    overflow: 'hidden',
  },
  webcamVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  webcamLoading: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 14,
  },
  webcamError: {
    padding: 40,
    textAlign: 'center',
    color: '#9B8E7B',
    fontSize: 14,
    lineHeight: 1.5,
  },
  webcamControls: {
    padding: '20px 20px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  webcamShutter: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    border: '3px solid #C8953C',
    background: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.1s',
  },
  webcamShutterInner: {
    width: 50,
    height: 50,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #1A1A1A, #333)',
  },
}

// ── Global keyframes (injected once) ──
const styleSheet = document.createElement('style')
styleSheet.textContent = `
  @keyframes ctaRing { 0% { box-shadow: 0 0 0 0 rgba(200,149,60,0.5); } 70% { box-shadow: 0 0 0 14px rgba(200,149,60,0); } 100% { box-shadow: 0 0 0 0 rgba(200,149,60,0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes scan { 0%, 100% { top: 0; } 50% { top: calc(100% - 3px); } }
  @keyframes weightPulse { 0%, 100% { background: transparent; } 50% { background: rgba(200, 149, 60, 0.08); } }
  @keyframes tickerScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  @keyframes recentTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  @keyframes livePulse { 0%, 100% { opacity: 1; box-shadow: 0 0 6px #22c55e; } 50% { opacity: 0.4; box-shadow: 0 0 2px #22c55e; } }
  @keyframes pulseGreen {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.3); }
    50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
  }
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes badgeFlash {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
    20% { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(34, 197, 94, 0.2); }
    40% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
  }
  input:focus, textarea:focus { border-color: ${goldLight} !important; box-shadow: 0 0 0 3px rgba(200,149,60,0.1); }
  button:hover { opacity: 0.92; transform: translateY(-1px); }
  button:active { transform: translateY(0); }

  .steps-grid {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
    align-items: center;
    gap: 0 12px;
    margin-top: 64px;
  }
  .step-arrow {
    font-size: 22px;
    color: #C8953C;
    opacity: 0.5;
    font-weight: 300;
  }
  @media (max-width: 768px) {
    .steps-grid {
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      align-items: stretch;
    }
    .step-arrow { display: none; }
  }`
document.head.appendChild(styleSheet)
