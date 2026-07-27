# PVR INOX — Group Booking Quote Tool

A single-page React app for generating group/bulk booking quotes across PVR INOX
cinemas, with ticket + food combo pricing and an "I'm interested" lead form that
emails the details via EmailJS.

## Run locally

```bash
npm install
npm run dev
```

This starts the Vite dev server (by default at `http://localhost:5173`). Open
that URL in your browser — the terminal output will show the exact port.

Other useful scripts:

```bash
npm run build    # production build to dist/
npm run preview  # preview the production build locally
```

## EmailJS setup

The "I'm interested" form sends leads via [EmailJS](https://www.emailjs.com),
directly from the browser — no backend required. Until it's configured, quotes
still work but submitting the lead form will fail.

1. Create a free account at https://www.emailjs.com.
2. Add an **Email Service** (e.g. connect it to Gmail/Outlook) and copy its
   **Service ID**.
3. Create an **Email Template** whose body uses these variables (documented in
   the comment block at the top of `src/App.jsx`):
   - `{{reference_id}}`
   - `{{cinema_name}}`
   - `{{audi_format}}`
   - `{{ticket_count}}`
   - `{{show_date}}`
   - `{{movie_name}}`
   - `{{food_combo}}`
   - `{{ticket_total}}`
   - `{{food_total}}`
   - `{{grand_total}}`
   - `{{customer_name}}`
   - `{{customer_phone}}`
   - `{{customer_email}}`

   Copy the **Template ID**.
4. Go to Account → General and copy your **Public Key**.
5. Paste all three values into the `EMAILJS_CONFIG` object near the top of
   `src/App.jsx`:

   ```js
   const EMAILJS_CONFIG = {
     serviceId: 'REPLACE_WITH_SERVICE_ID',
     templateId: 'REPLACE_WITH_TEMPLATE_ID',
     publicKey: 'REPLACE_WITH_PUBLIC_KEY',
   };
   ```

## Google Apps Script setup (lead storage + reference lookup)

Both the "I'm interested" submit flow and the "Check a reference number"
lookup talk to a Google Apps Script web app (`APPS_SCRIPT_URL` in
`src/App.jsx`). The script's source lives in this repo at
[`apps-script/Code.gs`](apps-script/Code.gs) — it's not auto-deployed, so
whenever it changes:

1. Open the Apps Script project behind your `APPS_SCRIPT_URL`
   (script.google.com).
2. Replace its contents with `apps-script/Code.gs`.
3. **Deploy -> Manage deployments -> Edit -> New version** so the change
   goes live at the same URL.

It backs both booking flows with a single "Leads" sheet (auto-created on
first submission), one row per cinema in a quote. A "Booking Type" column
tells Bulk Booking and Private Screening rows apart; the audi-specific
columns (Audi Number, Audi Capacity, Required Tickets, Desired Attendees)
are simply blank for Bulk Booking rows.

## Private screening dataset

Private Screening's cinema/audi data is fetched at runtime from
`public/data/private_screening_data.json` (not bundled into the JS, and
not committed as literal code) — replace that file to update pricing or
add cinemas.

## Deploy

**Option A — Vercel CLI**

```bash
npm install -g vercel
vercel
```

Follow the prompts (Framework Preset: Vite). Run `vercel --prod` to deploy to
production once you're happy with a preview.

**Option B — GitHub + Vercel dashboard**

1. Push this folder to a new GitHub repo (see below).
2. Go to https://vercel.com/new, import the repo, and accept the detected Vite
   settings (build command `npm run build`, output directory `dist`).
3. Deploy.
