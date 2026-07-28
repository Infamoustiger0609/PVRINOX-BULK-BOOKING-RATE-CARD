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
`api/_lib/` (`supabaseAdmin.js`, `auth.js`) — these use the Supabase
**service key**, so never import them from `src/App.jsx` or anything else
that ships to the browser.

- `api/auth/login.js` / `me.js` / `logout.js` — email+bcrypt login, sets an
  httpOnly `session` JWT cookie (`JWT_SECRET`, 7d expiry); `me` restores the
  session on page reload (App.jsx calls it once on mount, and again every
  time `mode` becomes `'dashboard'` to catch a cookie that expired mid-tab).
- `api/leads/index.js` — `GET` (protected, staff dashboard) lists/filters/
  sorts leads; `POST` (public) is called by both customer flows'
  `submitLeadToBackend`/`submitPSLeadToBackend` (mirroring
  `submitLeadToSheet`/`submitPSLeadToSheet` — same payload shape, separate
  destination) so real submissions show up in the dashboard, not just the
  Sheet.
- `api/leads/[id]/status.js` — `PATCH`, protected. Lead status pipeline:
  `LEAD_STATUSES` in App.jsx (`['New','Contacted','Negotiating','Won','Lost']`)
  must stay in sync with the `leads_status_check` CHECK constraint
  (`supabase/schema.sql`) and `VALID_STATUSES` in this file. The dashboard's
  status dropdown (row + detail view) updates optimistically via
  `handleLeadStatusChange` and rolls back `dashboardLeads` if the PATCH fails.
  New leads default to `'New'` at the DB level (`leads.status default 'New'`).

### Proforma Invoice (real feature, not a placeholder)

`performa_invoices.items` (jsonb) stores the **entire** PI document — not
just line items despite the column name (no schema change was needed to
add the richer fields; `grand_total` is duplicated out of `piData.total`
purely so the dashboard can sort by it). The full shape (company/GST/PAN/
CIN, ref/date/PINV No, party, `lineItems`, net value, GST, total, amount-
in-words, payment terms, notes, bank details) is built by
`buildPiDataFromLead()` (`App.jsx`, prefills line items from the lead's
`cinemas` using `FOOD_COMBOS` to recover a per-unit food price — the lead
record itself only stores the combined subtotal) and `PI_DEFAULTS`
(company info / GST no. / notes / bank details — all edited in one place
if these ever change).

netValue → gstAmount (18%) → total → amountInWords cascade live off the
line items, but each has its own "manual override" — typing into that
field freezes it until its Reset button is clicked (`piNetValueOverride`
etc. in `App.jsx`, `null` = follow the calculation, non-null = frozen).
Downstream fields still cascade off an overridden upstream one (e.g.
overriding netValue still recomputes GST/total from it) unless they're
*also* individually overridden.

`buildPIPdf()` (`App.jsx`) renders the actual A4 PDF client-side with
jsPDF, embedding the stamp at `public/assests/Stamp_for_PI.png.png` (note
the folder's existing typo — left as-is rather than renamed) via
`doc.addImage`. It's async (the stamp is fetched and converted to a data
URL) and returns the `jsPDF` doc without saving it — callers choose
`doc.save(...)` (staff "Download PDF") or `doc.output('datauristring')`
(handed to the send endpoint as an email attachment).

- `api/leads/[id]/pi/index.js` — upserts the one-row-per-lead draft PI
  (`performa_invoices`, unique on `lead_id`) with the full `piData` object
  from the client; called when "Create PI" is clicked. **Must stay
  `pi/index.js`, not a sibling `pi.js` next to the `pi/` folder** — that
  exact layout (`api/leads/[id]/pi.js` + `api/leads/[id]/pi/send.js`)
  previously broke Vercel's route generation for both endpoints (405
  "Method not allowed" in production on POST, despite correct handler
  code) — same basename as both a file and a folder is ambiguous to the
  build system. `index.js` still resolves to `/api/leads/:id/pi`, so the
  frontend fetch URLs didn't need to change when this was fixed.
- `api/leads/[id]/pi/send.js` — **uses Resend, not EmailJS** (`resend` npm
  package, `RESEND_API_KEY`) — scoped to PI sending only, the customer
  lead-notification emails (`sendLeadEmail`/`sendPSLeadEmail`) are
  untouched and still go through EmailJS. Takes the client-generated PDF
  as a base64 data URI, emails it as an attachment via
  `resend.emails.send`, then upserts `performa_invoices` to `status:
  'sent'`. `from` is still `onboarding@resend.dev` (Resend's sandbox
  sender) — swap for a verified domain before this goes to real customers.
- Env vars (set in Vercel, not committed): `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `RESEND_API_KEY`. API routes won't
  run under plain `npm run dev` (Vite only) — need `vercel dev` or an
  actual deploy to exercise them.

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
