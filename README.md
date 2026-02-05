# Snappy — snappy.gold

Instant AI-powered estimates for jewelry, watches & precious metals. Snap a photo, get an offer range, ship for a firm offer.

## How it works

1. User uploads or snaps a photo of their item
2. Image is sent to Claude (via Vercel serverless function) for analysis
3. AI returns item identification, details, and an estimated offer range
4. User fills out a lead form to receive a prepaid shipping label
5. Item is shipped, verified in person, and a firm offer is made

## Project structure

```
├── api/
│   └── analyze.js          # Vercel serverless function (proxies to Anthropic API)
├── src/
│   ├── main.jsx             # React entry point
│   └── App.jsx              # Full application (hero, capture, analysis, offer, lead form)
├── index.html               # HTML shell
├── package.json
├── vite.config.js
├── vercel.json              # Routing + function config
└── .gitignore
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in [Vercel](https://vercel.com/new)
3. Add environment variable: `ANTHROPIC_API_KEY` = your key
4. Deploy — Vercel auto-detects Vite and the `/api` serverless function

## Custom domain

In Vercel → Settings → Domains:
- `snappy.gold` (primary)
- `snappygold.com` (redirect → snappy.gold)

## Run locally

```bash
npm install
npm run dev
```

Note: The `/api/analyze` endpoint only works on Vercel (serverless function). For local dev, you'd need to either:
- Use `vercel dev` (install Vercel CLI: `npm i -g vercel`)
- Or mock the API response

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (required for image analysis) |

## Future enhancements

- [ ] Lead form submissions → Airtable / email / CRM integration
- [ ] Multiple image upload per item
- [ ] User accounts and offer history
- [ ] Real-time gold/silver spot price integration
- [ ] Admin dashboard for managing incoming leads
