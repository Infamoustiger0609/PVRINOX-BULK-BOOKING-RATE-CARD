# PVR INOX — Group & Private Screening Booking Tool

Quick-reference for future sessions. Keep this concise — update it when a
significant feature is added or changed, don't let it become full docs.

## Stack

- React 19 + Vite, single-file frontend: **everything lives in
  `src/App.jsx`** (~4900 lines — styles are a template-literal `<style>`
  block inside the component, no CSS modules/Tailwind). Line numbers below
  drift as the file grows; prefer searching for the named function/const.
- Deployed on Vercel — static frontend + serverless functions under `api/`.
  `src/index.css` has only global `html`/`body` resets.
- No test suite — `npm run build` (and `npm run lint`, oxlint) is the
  standard "did I break it" check.
- Two backends, doing different jobs: a Google Apps Script web app
  (`apps-script/Code.gs`) is the original lead sheet/lookup, still live;
  Supabase + Vercel functions (`api/`) are a newer, separate staff
  dashboard backend (see below) that leads are *also* written to.

## Modes

`mode` state (`App.jsx` top of `App()`) drives which JSX tree renders; all
customer/staff screens are gated on it, no router:

- `null` — landing screen, three cards (Bulk Booking / Private Screening /
  Events) plus a small "Employee Login" link.
- `'bulkBooking'` / `'privateScreening'` — the two customer quote flows
  (see below). Entirely separate state, handlers, and submission
  pipelines (`ps`-prefixed for Private Screening, e.g. `psCinemaDetails`
  vs `cinemaDetails`). Changes to one flow should not touch the other
  unless explicitly asked.
- `'events'` — a shortcut grid (`EVENT_QUICK_PICKS`, 8 tiles: Birthday,
  Anniversary, Pre Wedding, Product Launch, Pre Screening, Photoshoot,
  Premier, Corporate Event). Picking one sets `pendingEventType` and jumps
  straight to `'privateScreening'`; `pendingEventType` then pre-fills the
  `eventType` field for every cinema added in that session
  (`togglePSCinemaSelection`) — still fully editable per cinema, never
  cleared automatically.
- `'employeeLogin'` / `'dashboard'` — staff-only, backed by Supabase (see
  Employee Dashboard section below).

## Bulk Booking

Pick cinema(s) + format + time slot, buy a block of tickets (min 50,
`MIN_TICKET_COUNT`). Ticket count = food count. No movie field — that was
deliberately removed; instead there's a note pointing to pvrcinemas.com
for showtimes. Format pills (`toggleCinemaSelection`, `computedCinemas`)
additionally show each audi's capacity as an info-only line per pill
(`.pb-audi-capacity`, sourced from `bulkFormatsByCinema`) — no 90% floor,
no per-audi selection/booking tied to it, unlike Private Screening.

## Private Screening

Pick cinema(s) + time slot, enter *desired attendees*, then choose one
**or more** audis to rent out (`selectedAudiNumbers`, an array —
multi-select, toggled by clicking a card; nothing is ever disabled/
unclickable, see 90%-capacity rule below). Has an event type + detail
field (`EVENT_TYPES`, ~line 111) — not a movie name. Food is priced on
desired attendees, **not** on required tickets — these two numbers
legitimately differ (see below). A "Combined capacity: X / Y needed" line
under the audi grid (`combinedCapacity`, `computedPSCinemas`) shows
whether the currently-selected audis together seat the group; turns amber
if short, but never blocks selection or submission.

## Events landing shortcut

`EVENT_QUICK_PICKS` (~line 135) is the `{label, eventType, desc}` list
that populates the `mode === 'events'` grid; `eventType` values must exist
in `EVENT_TYPES`.

## Pricing data — fetched at runtime, not hardcoded

The `CINEMA_DATA`-equivalent was refactored out of the bundle. Do not
reintroduce inline data literals.

- **Both flows read from the same file**, `public/data/
  private_screening_data.json` → fetched into `privateScreeningData`
  state (`fetchPrivateScreeningData`), once either flow is entered
  (`mode === 'bulkBooking'` or `'privateScreening'`), with a shared
  loading state + `dataError` + inline "Retry" button. There used to be a
  separate `bulk_booking_data.json`/`bulkBookingData` — removed; Bulk
  Booking derives its own format/pricing view via `bulkFormatsByCinema`
  (~line 1112, groups each cinema's `audis` by `format`, taking morning/
  afternoon/evening rates from the first audi in each group — all audis
  sharing a format at a cinema share the same rate).
- `CINEMA_NAMES`/`ALL_CITIES` (bulk) and `PS_CINEMA_NAMES`/`PS_ALL_CITIES`
  (private) are separate `useMemo`s that both call `buildCinemaAndCityLists`
  on the same `privateScreeningData` with the same `getCityForPSCinema` —
  **if you add another memo that reads them, list them in its dependency
  array**, or it'll cache the pre-fetch empty result and never update
  (this exact bug happened once during the runtime-fetch refactor).
- City name typos/variants (e.g. "Gurugram" vs "Gurgaon", "Ahemdabad" vs
  "Ahmedabad") are normalized via `CITY_NAME_ALIASES` (~line 38), not by
  editing the JSON file.
- `public/data/cinema_name_map.json` (flat `{ bulkCinemaName: psCinemaName
  }`) was added briefly to bridge Bulk Booking's and Private Screening's
  different cinema-naming conventions, then removed from code once Bulk
  Booking was switched to read `privateScreeningData` directly (no more
  naming to bridge). The JSON file itself is still on disk, unreferenced —
  fine to delete if you're cleaning up, just not done automatically.

## The 90%-capacity rule (Private Screening only)

Per candidate audi: `requiredTickets = max(desiredAttendees,
ceil(capacity * 0.9))` (`rawAudiOptions` inside `computedPSCinemas`, ~line
1318). A group can be small, but you still pay for at least 90% of
whatever audi you rent — shown per-card as `flooredByMinimum` note when it
applies. **Every audi is always selectable**, even one too small for
`desiredAttendees` alone — the multi-select combined-capacity indicator
(above) is how staff/customers see whether a combination actually fits;
there used to be a "Cheapest" badge and a disabled state for too-small
audis, both removed. This required-vs-desired split is why **ticket
pricing and food pricing multiply by different numbers** in this flow —
ticket subtotal sums `requiredTickets * rate` across all selected audis
(`selectedAudis`/`ticketSubtotal`), food multiplies by `desiredAttendees`
— a recurring source of subtle bugs, double-check both when touching
pricing math here.

## Date-based pricing rules

`DATE_PRICE_RULES` (~line 75) + `WEEKEND_SURGE_MULTIPLIER` (~line 83,
currently `1.0` / inert) run through the shared `getDatePriceAdjustment()`
(~line 89) used by both flows. `type: 'blocked'` dates disable submission
with an inline warning; `type: 'surge'` dates apply a multiplier and show
a note near the price.

## Terms & Conditions gate

Both flows require a checkbox (`agreedToTerms` / `psAgreedToTerms`) next
to a "View Terms & Conditions" link (opens `/PVR_INOX_Terms_and_Conditions.html`
in a new tab) before the "I'm interested" button is enabled. Reset to
`false` whenever the form resets after submission.

## Submission pipeline (per flow, mirrored, now triple-write)

`sendLeadEmail`/`submitLeadToSheet`/`submitLeadToBackend` (bulk) and
`sendPSLeadEmail`/`submitPSLeadToSheet`/`submitPSLeadToBackend` (private),
all fired together via `Promise.all` inside `handleInterested`/
`handlePSInterested`:
1. EmailJS (`EMAILJS_CONFIG`, ~line 21, needs real credentials — currently
   placeholders) sends the notification email.
2. A `fetch` POST to `APPS_SCRIPT_URL` (~line 28) logs the lead to a
   Google Sheet — the original backend. Reference-number lookup ("Check a
   reference number") is a `GET ?ref=...` to the same URL.
   **`apps-script/Code.gs` is the source of truth for this backend** — it
   is not auto-deployed; after editing it you must paste it into the Apps
   Script editor and redeploy manually (README has the exact steps). The
   Sheet's header row also won't rename itself if you change a column
   name in code — update it by hand or start a fresh sheet.
3. A `fetch` POST to `/api/leads` (Vercel function, see below) writes the
   same lead into the Supabase `leads` table, so it shows up in the staff
   dashboard too. Same payload shape as the Sheet write, separate
   destination — mirrors, doesn't replace, step 2.

All three are best-effort: failures are swallowed (`console.error` only)
so the customer never sees backend plumbing trouble.

## PDF quote export

`buildQuotePdf` (~line 240) is shared by both flows — each builds its own
`cinemaSections` array from already-computed pricing state and hands it
to one generic renderer. jsPDF's built-in fonts can't render "₹" (renders
as a garbled glyph) — use `formatINRForPdf()` ("Rs. X") inside PDF-only
code paths, never the on-screen `formatINR()`. Still uses the old
hand-drawn "PVR • INOX" text logo, not the real logo image (see below) —
that swap was explicitly scoped to the on-screen header only.

## Real PVR INOX logo

`PVR_INOX_LOGO_URL` (~line 33, `/assests/pvr-inox-logo.png` — note the
folder's existing typo "assests", left as-is) replaced the old hand-drawn
"PVR ★ INOX" text/shapes in the on-screen header only (`.pb-brand-logo`).
Deliberately **not** used in `buildQuotePdf` or `buildPIPdf` — that was
tried once and reverted; the quote PDF still draws the text/star version
client-side. `Stamp_for_PI.png.png` (same folder) is a separate asset,
only used in the Proforma Invoice PDF (below).

## Employee Dashboard backend (`/api`, Vercel serverless functions)

Staff-only third area (`mode === 'employeeLogin'` / `'dashboard'`), backed
by Supabase (Postgres) + a JWT session cookie — schema at
`supabase/schema.sql` (run it once against the Supabase project by hand;
there's no migration runner). Shared server-only helpers live in
`api/_lib/` (`supabaseAdmin.js`, `auth.js`) — these use the Supabase
**service key**, so never import them from `src/App.jsx` or anything else
that ships to the browser.

- `api/auth/login.js` / `me.js` / `logout.js` — email+bcrypt login against
  the `employees` table, sets an httpOnly `session` JWT cookie
  (`JWT_SECRET`, 7d expiry); `me` restores the session on page reload
  (App.jsx calls it once on mount, and again every time `mode` becomes
  `'dashboard'` to catch a cookie that expired mid-tab). Seed accounts are
  in `supabase/schema.sql`'s `insert into employees` — don't duplicate
  passwords into this file; look there (and rotate them before real use).
- `api/leads/index.js` — `GET` (protected, staff dashboard) lists/filters/
  sorts leads (`?from=&to=&sort=recent|value`); `POST` (public) is called
  by both customer flows' `submitLeadToBackend`/`submitPSLeadToBackend`
  (see Submission pipeline above).
- `api/leads/[id]/status.js` — `PATCH`, protected. Lead status pipeline:
  `LEAD_STATUSES` in App.jsx (~line 188,
  `['New','Contacted','Negotiating','Won','Lost']`) must stay in sync
  with the `leads_status_check` CHECK constraint (`supabase/schema.sql`)
  and `VALID_STATUSES` in this file. The dashboard's status dropdown (row
  + detail view, color-coded via `leadStatusClass`/`.pb-status-*`)
  updates optimistically via `handleLeadStatusChange` and rolls back
  `dashboardLeads` if the PATCH fails. New leads default to `'New'` at the
  DB level (`leads.status default 'New'`).
- `api/leads/[id]/pi/index.js` and `.../pi/send.js` — Proforma Invoice,
  see below.
- Env vars (set in Vercel, not committed): `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `RESEND_API_KEY`. API routes won't
  run under plain `npm run dev` (Vite only) — need `vercel dev` or an
  actual deploy to exercise them.

### Proforma Invoice (real feature, not a placeholder)

`performa_invoices.items` (jsonb) stores the **entire** PI document — not
just line items despite the column name (no schema change was needed to
add the richer fields; `grand_total` is duplicated out of `piData.total`
purely so the dashboard can sort by it). The full shape (company/GST/PAN/
CIN, ref/date/PINV No, party, `lineItems`, net value, GST, total, amount-
in-words, payment terms, notes, bank details) is built by
`buildPiDataFromLead()` (~line 448, prefills line items from the lead's
`cinemas` using `FOOD_COMBOS` to recover a per-unit food price — the lead
record itself only stores the combined subtotal) and `PI_DEFAULTS` (~line
329 — company info / GST no. / notes / bank details — all edited in one
place if these ever change).

`piNetValue`/`piGstAmount`/`piTotal`/`piAmountInWords` (each computed
from a `piCalculated*` value derived off the line items) cascade live off
each other, but each has its own "manual override" — typing into that
field freezes it until its Reset button is clicked
(`piNetValueOverride`/`piGstAmountOverride`/`piTotalOverride`/
`piAmountInWordsOverride`, ~line 746, `null` = follow the calculation,
non-null = frozen). Downstream fields still cascade off an overridden
upstream one (e.g. overriding netValue still recomputes GST/total from it)
unless they're *also* individually overridden. `numberToIndianWords()`
(~line 390) converts total → lakhs/crores words.

`buildPIPdf()` (~line 484) renders the actual A4 PDF client-side with
jsPDF, embedding the stamp at `public/assests/Stamp_for_PI.png.png` via
`doc.addImage`. It's async (the stamp is fetched and converted to a data
URL) and returns the `jsPDF` doc without saving it — callers choose
`doc.save(...)` (staff "Download PDF") or `doc.output('datauristring')`
(handed to the send endpoint as an email attachment).

- `api/leads/[id]/pi/index.js` — upserts the one-row-per-lead draft PI
  (`performa_invoices`, unique on `lead_id`) with the full `piData` object
  from the client; called when "Create PI" is clicked (`startPiEditor`).
  **Must stay `pi/index.js`, not a sibling `pi.js` next to the `pi/`
  folder** — that exact layout (`api/leads/[id]/pi.js` +
  `api/leads/[id]/pi/send.js`) previously broke Vercel's route generation
  for both endpoints (405 "Method not allowed" in production on POST,
  despite correct handler code) — same basename as both a file and a
  folder is ambiguous to the build system. `index.js` still resolves to
  `/api/leads/:id/pi`, so the frontend fetch URLs didn't need to change
  when this was fixed.
- `api/leads/[id]/pi/send.js` (`handleSendPi`, ~line 1019) — **uses
  Resend, not EmailJS** (`resend` npm package, `RESEND_API_KEY`) — scoped
  to PI sending only, the customer lead-notification emails
  (`sendLeadEmail`/`sendPSLeadEmail`) are untouched and still go through
  EmailJS. Takes the client-generated PDF as a base64 data URI, emails it
  as an attachment via `resend.emails.send`, then upserts
  `performa_invoices` to `status: 'sent'`. `from` is still
  `onboarding@resend.dev` (Resend's sandbox sender) — swap for a verified
  domain before this goes to real customers.

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
- Don't put real secrets/credentials into this file even if they exist
  elsewhere in the repo (e.g. `supabase/schema.sql`'s seed passwords) —
  point at where they're defined instead of duplicating them.
