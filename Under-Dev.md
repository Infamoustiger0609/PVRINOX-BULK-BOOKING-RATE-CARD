# Under Development — Roadmap to Official/Production Use

Working punch-list for turning this into a production-ready internal tool
for the bulk booking team. Grounded in an audit of the codebase as of this
writing — check items off as they're done, add new ones as they come up.

## 🔴 Currently broken — fix first

- [ ] **Customer notification emails aren't sending.** `EMAILJS_CONFIG` in
      `src/App.jsx` is still placeholder values (`REPLACE_WITH_SERVICE_ID` /
      `REPLACE_WITH_TEMPLATE_ID` / `REPLACE_WITH_PUBLIC_KEY`) — never
      configured. Every "I'm interested" submission silently fails to email
      anyone (the failure is swallowed, so nobody notices). Right now the
      Apps Script Sheet write and the Supabase write are the *only* things
      actually recording leads.
- [ ] **PI emails use Resend's sandbox sender**
      (`api/leads/[id]/pi/send.js`: `from: 'PVR INOX <onboarding@resend.dev>'`,
      with a `// swap once a verified sending domain exists` comment already
      in the code). Sandbox senders generally won't deliver to arbitrary
      customer inboxes — "Send PI" likely doesn't reliably reach real
      customers today. Needs a verified sending domain in Resend.
- [ ] **Both employee accounts share the same password** (`pvr@123`), seeded
      straight into `supabase/schema.sql`. Rotate before this is "official."

## 🟠 Security / access control

- [ ] **No roles.** Any logged-in employee can edit any lead's status or send
      any PI — no admin-vs-rep distinction, no ownership. Fine for 2 people,
      not fine for a team.
- [ ] **No rate limiting or spam protection** on either public write path —
      `POST /api/leads` and the Apps Script `doPost` both accept anything
      with the right shape: no CAPTCHA, no throttling. A bot (or a bored
      competitor) could flood the leads table / Sheet.
- [ ] **No login lockout** — password checks are unlimited-attempt,
      brute-forceable in principle.
- [ ] **No password reset flow** — a forgotten password today means someone
      manually re-hashing a row in Supabase.
- [ ] **RLS enabled but zero policies** on `employees`/`leads`/
      `performa_invoices` — access control is 100% "did every API route
      remember to call `requireSession`." Works, but no DB-level backstop if
      a route is ever added without that check.

## 🟡 Missing for actual day-to-day sales use

- [ ] **No search** in the dashboard — only date range + sort by
      recent/value. No way to look up a lead by customer name, phone, or
      reference number.
- [ ] **No export** (CSV/Excel) for reporting or handing data to management.
- [ ] **No lead assignment/ownership** — can't tell which rep is working
      which lead, no "my leads" view.
- [ ] **No notes/call log** on a lead — nothing to record "called, follow up
      Thursday."
- [ ] **No pipeline metrics** — count/value by status, conversion rate, etc.
- [ ] **No internal "new lead" alert** to the team — the only outbound
      signal today is the (currently non-functional) EmailJS template, and
      it's unclear whether its configured recipient is even the sales team
      vs. the customer.
- [ ] **Pricing/cinema/audi data is a static JSON file**
      (`public/data/private_screening_data.json`) — updating a price or
      adding a cinema means editing the file and redeploying. Biggest
      recurring operational bottleneck; worth an admin-editable table in
      Supabase instead.

## 🟢 Engineering maturity (worth doing, less urgent)

- [ ] No error tracking (Sentry or similar) — failures vanish into
      `console.error` only; you'd only find out leads are being dropped when
      a customer complains.
- [ ] No CI (no GitHub Actions) — `npm run build`/`lint` are manual, nothing
      blocks a broken PR.
- [ ] No automated tests at all.
- [ ] No `.env.example` and no staging/prod separation — one Supabase
      project, changes go straight to it.
- [ ] No audit trail on status changes / PI edits (who did what, when).

## Suggested sequencing

1. Fix the two "actually broken" email items (EmailJS config, Resend
   verified domain) — quick config fixes, but currently blocking.
2. Rotate the shared employee password.
3. Add rate-limiting/spam protection on the public endpoints and a basic
   roles/permissions model — these are the ones that bite in production,
   not in development.
4. Dashboard usability (search, export, assignment, notes) — matters for
   daily workflow, doesn't hurt anyone if it waits.
5. Engineering maturity items (error tracking, CI, tests) — ongoing,
   parallel-izable with the above.
