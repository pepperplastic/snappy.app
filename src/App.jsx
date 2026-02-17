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
  const [isReEstimating, setIsReEstimating] = useState(false)
  const [showWebcam, setShowWebcam] = useState(false)
  const [shippingData, setShippingData] = useState({ address: '', city: '', state: '', zip: '', method: 'kit' })
  const [showContact, setShowContact] = useState(false)
  const [directQuote, setDirectQuote] = useState(false)
  const [limitGated, setLimitGated] = useState(false)
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
            <svg width="32" height="32" viewBox="0 0 80 80" fill="none">
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="80" y2="80">
                  <stop stopColor="#D4A344" />
                  <stop offset="1" stopColor="#8B6914" />
                </linearGradient>
              </defs>
              {/* Camera body */}
              <rect x="8" y="22" width="64" height="46" rx="10" stroke="url(#logoGrad)" strokeWidth="3" fill="none" />
              {/* Camera bump */}
              <path d="M28 22 L32 12 H48 L52 22" stroke="url(#logoGrad)" strokeWidth="3" fill="none" strokeLinejoin="round" />
              {/* Lens circle */}
              <circle cx="40" cy="45" r="15" stroke="url(#logoGrad)" strokeWidth="2.5" fill="none" />
              {/* $ inside lens */}
              <text x="40" y="52" textAnchor="middle" fill="url(#logoGrad)" fontFamily="Playfair Display, serif" fontWeight="700" fontSize="22">$</text>
              {/* Flash dot */}
              <circle cx="60" cy="30" r="2.5" fill="url(#logoGrad)" />
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
              <a href="tel:+1" style={styles.contactItem}>
                <span style={styles.contactIcon}>☎</span>
                <span>Call us</span>
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
        <p style={styles.footerText}>© 2026 Snappy · snappy.gold</p>
        <p style={styles.footerDisclaimer}>
          Estimates are preliminary and not binding. Final offers require in-person evaluation.
        </p>
      </footer>

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
          { num: '2', title: 'Review', desc: 'We identify materials, brand & condition' },
          { num: '3', title: 'Get Paid', desc: 'Accept your offer and ship with a prepaid label' },
          { num: '4', title: 'Do It Again!', desc: 'After being paid, come back when you have more to sell' },
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
function OfferScreen({ analysis, imageData, onGetOffer, onRetry, onReEstimate, isReEstimating, variant, leadData, setLeadData }) {
  const [visible, setVisible] = useState(false)
  const [showCorrections, setShowCorrections] = useState(false)
  const [showDetailsInput, setShowDetailsInput] = useState(false)
  const [isUpdated, setIsUpdated] = useState(false)
  const detailsRef = useRef(null)
  const offerRangeRef = useRef(null)
  const offerTopRef = useRef(null)
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
    gap: 3,
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
  tickerWrap: {
    overflow: 'hidden',
    width: '100%',
    marginBottom: 28,
    maskImage: 'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)',
    WebkitMaskImage: 'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)',
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
    gap: 16,
    marginTop: 28,
    flexWrap: 'nowrap',
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
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes scan { 0%, 100% { top: 0; } 50% { top: calc(100% - 3px); } }
  @keyframes weightPulse { 0%, 100% { background: transparent; } 50% { background: rgba(200, 149, 60, 0.08); } }
  @keyframes tickerScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
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
    }
    .step-arrow { display: none; }
  }`
document.head.appendChild(styleSheet)
