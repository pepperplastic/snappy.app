# Snappy Gold — working rules
- Frontend: src/crm.jsx (single-file React, esbuild). Backend: apps-script/ (Google Apps Script web app, synced with clasp; .js files here are .gs files in the project).
- New backend actions must be added to CRM_WRITE_ACTIONS in apps-script/Code.js AND WRITE_ACTIONS in api/crm-proxy.js.
- Always compile before finishing: npx esbuild src/crm.jsx --bundle --external:react --loader:.jsx=jsx --outfile=/tmp/crm.check.js
- Do not add features beyond what was asked. Review what exists first; propose before building.
- Never edit customer-facing message templates or senders without being asked explicitly.
- Never hard-code API keys; use Script Properties (Apps Script) or Vercel env vars.
- Deploy: `clasp push` from repo root, then David creates a new version in the Apps Script UI. Vercel deploys on git push.
