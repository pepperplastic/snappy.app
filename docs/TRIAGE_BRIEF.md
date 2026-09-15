# Snappy Gold — Registration Triage (v1)

**Job:** If David hasn't acted on a new registration within 20 minutes, fulfill it if it's obviously good enough. Otherwise leave it in the Fulfill queue with a flag saying why. Nothing is ever deferred or moved backward.

## Modes
Script Property `TRIAGE_MODE`: `off` (default) · `shadow` (decide + log, do nothing) · `on`.
Run shadow for a week and compare to David's calls before turning it on.

## Fulfill when ALL are true
- Shipping type is `usps` or `fedex` (scan-based labels — $0 unless shipped). **Kits always wait for David.**
- AI read says karat gold or platinum, and the photos support it (hallmark, color, or known brand). Under ~80% confidence → hold.
- Estimate low end ≥ $100 and high end < $2,500.
- At least one real item photo. Email, phone, and full US address look real. Not a test account, not on Do Not Contact.
- Not a watch, coin, or loose diamond; 3 items or fewer; no prior return or declined offer on this customer.

Fulfill = the normal path (`generateAndSendLabel`): label email + SMS to the customer, stage → outbound_complete. Contact Log row `auto:triage` with a one-line reason.

## Otherwise: hold + flag
Shipment stays in Fulfill. `triage_flag` gets a code + short reason, shown as a chip in the queue:
`KIT` · `NO_PHOTOS` · `PHOTO_UNCLEAR` · `NOT_GOLD` · `LOW_ESTIMATE` · `HIGH_VALUE` · `CATEGORY` · `BAD_CONTACT` · `HISTORY` · `LOT_TOO_BIG` · `DNC` · `TEST` · `CAP` · `ERROR`
Nothing is sent to the customer.

## Limits and telling David
- Max 10 fulfillments/hour, 40/day; past that, everything is held.
- Hourly SMS to David when there was activity: "Triage: fulfilled 4 · holding 2 (watch, no photos)".
- Any fulfillment error → immediate SMS with the SHP number.
- The existing 5-minute registration alert keeps running; triage is a backstop, not a replacement.

## Review
Weekly from the `auto:triage*` Contact Log rows: fulfilled vs held vs David's overrides. After 30 days, ship rate of agent-fulfilled vs David-fulfilled. Tighten or loosen the rules from that.
