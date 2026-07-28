# PVR INOX — Group & Private Screening Booking Tool

Quick-reference for future sessions. Keep this concise — update it when a
significant feature is added or changed, don't let it become full docs.

## Stack

- React 19 + Vite, single-file app: **everything lives in `src/App.jsx`**
  (~3000 lines — styles are a template-literal `<style>` block inside the
  component, no CSS modules/Tailwind).
- Deployed on Vercel. `src/index.css` has only global `html`/`body` resets.
- No test suite — `npm run build` is the standard "did I break it" check.
- Lead storage/lookup backend is a Google Apps Script web app, source
  tracked at `apps-script/Code.gs` (see below).

## The two flows

Landing screen (`mode === null`) picks one; `mode` is `'bulkBooking'` or
`'privateScreening'` and gates two parallel JSX trees (`App.jsx:1860` and
`:2383`) that share CSS classes but have **entirely separate state,
handlers, and submission pipelines** (`ps`-prefixed for Private Screening,
e.g. `psCinemaDetails` vs `cinemaDetails`). Changes to one flow should not
touch the other unless explicitly asked.

- **Bulk Booking**: pick cinema(s) + format + time slot, buy a block of
  tickets (min 50, `MIN_TICKET_COUNT`). Ticket count = food count. No movie
  field — that was deliberately removed; instead there's a note pointing to
  pvrcinemas.com for showtimes.
- **Private Screening**: pick cinema(s) + time slot, enter *desired
  attendees*, then choose an **audi** to rent out entirely. Has an event
  type + detail field (`EVENT_TYPES` near line 120) — not a movie name.
  Food is priced on desired attendees, **not** on required tickets — these
  two numbers legitimately differ (see below).

## Pricing data — fetched at runtime, not hardcoded

Both `CINEMA_DATA`-equivalents were refactored out of the bundle. Do not
reintroduce inline data literals.

- `public/data/bulk_booking_data.json` → fetched into `bulkBookingData`
  state (`fetchBulkBookingData`, `App.jsx:300`), only once `mode ===
  'bulkBooking'`.
- `public/data/private_screening_data.json` → fetched into
  `privateScreeningData` state (`fetchPrivateScreeningData`, `:328`).
- Both have a loading state + `*DataError` state + inline "Retry" button.
  `CINEMA_NAMES`/`ALL_CITIES` (bulk) and `PS_CINEMA_NAMES`/`PS_ALL_CITIES`
  (private) are `useMemo`s derived from that fetched data — **if you add
  another memo that reads them, list them in its dependency array**, or
  it'll cache the pre-fetch empty result and never update (this exact bug
  happened once during the runtime-fetch refactor).
- City name typos/variants (e.g. "Gurugram" vs "Gurgaon", "Ahemdabad" vs
  "Ahmedabad") are normalized via `CITY_NAME_ALIASES` (`:39`), not by
  editing the JSON files.

## The 90%-capacity rule (Private Screening only)

When picking an audi: `requiredTickets = max(desiredAttendees,
ceil(capacity * 0.9))` (`computedPSCinemas`, `:498`, `ninetyPercentFloor`
at `:521`). A group can be small, but you still pay for at least 90% of
whatever audi you rent. Audis too small for `desiredAttendees` are
disabled (not hidden) in the picker. This required-vs-desired split is why
**ticket pricing and food pricing multiply by different numbers** in this
flow — a recurring source of subtle bugs, double-check both when touching
pricing math here.

## Date-based pricing rules

`DATE_PRICE_RULES` (`:84`) + `WEEKEND_SURGE_MULTIPLIER` (`:92`, currently
`1.0` / inert) run through the shared `getDatePriceAdjustment()` (`:98`)
used by both flows. `type: 'blocked'` dates disable submission with an
inline warning; `type: 'surge'` dates apply a multiplier and show a note
near the price.

## Submission pipeline (per flow, mirrored)

`sendLeadEmail`/`submitLeadToSheet` (bulk, `:769`/`:814`) and
`sendPSLeadEmail`/`submitPSLeadToSheet` (private, `:845`/`:895`):
EmailJS (`EMAILJS_CONFIG`, `:21`, needs real credentials — currently
placeholders) sends the notification email; a `fetch` POST to
`APPS_SCRIPT_URL` (`:28`) logs the lead to a Google Sheet. Reference-number
lookup is a `GET ?ref=...` to the same URL. **`apps-script/Code.gs` is the
source of truth for the backend** — it is not auto-deployed; after editing
it you must paste it into the Apps Script editor and redeploy manually
(README has the exact steps). The Sheet's header row also won't rename
itself if you change a column name in code — update it by hand or start a
fresh sheet.

PDF quote export (`buildQuotePdf`, `:187`) is shared by both flows — each
builds its own `cinemaSections` array from already-computed pricing state
and hands it to one generic renderer. jsPDF's built-in fonts can't render
"₹" (renders as a garbled glyph) — use `formatINRForPdf()` ("Rs. X") inside
PDF-only code paths, never the on-screen `formatINR()`.

## Employee Dashboard backend (`/api`, Vercel serverless functions)

Staff-only third flow (`mode === 'employeeLogin'` / `'dashboard'`), backed
by Supabase (Postgres) + a JWT session cookie — schema at
`supabase/schema.sql` (run it once against the Supabase project by hand;
there's no migration runner). Shared server-only helpers live in
`api/_lib/` (`supabaseAdmin.js`, `auth.js`, `emailjs.js`) — these use the
Supabase **service key**, so never import them from `src/App.jsx` or
anything else that ships to the browser.

- `api/auth/login.js` / `me.js` / `logout.js` — email+bcrypt login, sets an
  httpOnly `session` JWT cookie (`JWT_SECRET`, 7d expiry); `me` restores the
  session on page reload (App.jsx calls it once on mount).
- `api/leads/index.js` — `GET` (protected, staff dashboard) lists/filters/
  sorts leads; `POST` (public) is called by both customer flows'
  `submitLeadToBackend`/`submitPSLeadToBackend` (mirroring
  `submitLeadToSheet`/`submitPSLeadToSheet` — same payload shape, separate
  destination) so real submissions show up in the dashboard, not just the
  Sheet.
- `api/leads/[id]/pi.js` — upserts the one-row-per-lead draft PI
  (`performa_invoices`, unique on `lead_id`).
- `api/leads/[id]/pi/send.js` — emails the PI via EmailJS's server-side
  REST API (`EMAILJS_PRIVATE_KEY`, separate from the client-side
  `EMAILJS_CONFIG` public key in App.jsx) and flips the PI to `status:
  'sent'`.
- Env vars (set in Vercel, not committed): `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `EMAILJS_PRIVATE_KEY`. API routes
  won't run under plain `npm run dev` (Vite only) — need `vercel dev` or an
  actual deploy to exercise them.
- `api/_lib/emailjs.js`'s `serviceId`/`publicKey` are placeholders like
  `EMAILJS_CONFIG` in App.jsx — fill in real values (and a real
  `piTemplateId` from a new EmailJS template) before PI sending works.

## My working conventions

- Prefer **precise, scoped changes** over broad refactors — match existing
  patterns exactly rather than introducing a new approach, even if the new
  one seems cleaner.
- Large data files (cinema/pricing lists, etc.) get **uploaded directly**
  by the user rather than typed out — don't hand-transcribe big datasets.
- **Skip extra verification/testing steps on simple, low-risk fixes** —
  don't spin up Playwright screenshots for a one-line text/label change.
  Do still verify (build + targeted check) for anything touching pricing
  math, state shape, or shared logic used by both flows.
