# Hungry Tum Franchisee Invoicing System

A web application for managing franchise fee invoicing across Deliveroo, Uber Eats, and Just Eat platforms.

## Features

- **Franchisee Management** - Add, edit, and manage franchise locations with percentage-based or monthly fixed payment models
- **Weekly Report Upload** - Upload CSV or PDF reports from Deliveroo, Uber Eats, and Just Eat with automatic gross revenue extraction
- **Fee Calculation** - Automatically calculates the franchise fee (default 6%) from combined platform revenues
- **PDF Invoice Generation** - Professional branded PDF invoices with platform-by-platform revenue breakdown
- **Stripe BACS** - Invoices are collected via BACS Direct Debit; no card payment option
- **Invoice Tracking** - Track invoice status (Draft / Sent / Paid) with filtering
- **Dashboard** - Overview of franchisees, revenue, outstanding fees, and recent invoices

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Storage), Stripe (payments)
- **PDF Generation**: @react-pdf/renderer
- **File Parsing**: PapaParse (CSV) + pdf-parse (PDF)

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in your Supabase credentials (see `.env.example` for all optional vars):
   ```
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
   For **Vercel**, add the same variables in the project’s **Settings → Environment Variables** (see **Deploy to Vercel** below).
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) and create an account

## Invoice payment details (optional)

To show your bank details and payment due on the PDF invoice, add these to **`.env.local`** (same folder as `package.json`). Restart the dev server after changing.

| Variable | Example | Description |
|----------|---------|-------------|
| `INVOICE_PAYMENT_DAYS` | `7` | Number of days for payment (e.g. “Please remit payment within 7 days of receipt”). Default: 7. |
| `INVOICE_BANK_NAME` | `High Street Bank` | Bank name on the invoice. |
| `INVOICE_SORT_CODE` | `12-34-56` | Sort code. |
| `INVOICE_ACCOUNT_NUMBER` | `12345678` | Account number. |

Example `.env.local` snippet:

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Invoice payment details (optional)
INVOICE_PAYMENT_DAYS=7
INVOICE_BANK_NAME=High Street Bank
INVOICE_SORT_CODE=12-34-56
INVOICE_ACCOUNT_NUMBER=12345678
```

If these are not set, the PDF shows placeholders like `[Your Bank Name]` and “7 days”.

## Slerp upload (Wing Shack Direct / TZ)

Slerp (direct orders) uses a **Tue–Mon** sales period; payout is the **following Monday**. Invoices go out on **Thursdays** and align with that payout.

**Example:** Invoice sent **Thursday 19 Feb** is for **aggregator week 9–15 Feb** (Mon–Sun). The Slerp block on that invoice shows the pay period that is paid on **Monday 16 Feb**: sales **Tue 3 Feb – Mon 9 Feb**. So the app:

1. **Upload:** You upload the Slerp statement (xlsx). The parser reads **Fulfillment date**, **Location name**, **Product total after discounts (GMV)** and **Status**. For each fulfilled order it works out the **payout Monday** (the Monday that follows the fulfillment date), then the **sales period** for that payout = the *previous* Tue–Mon week. It groups GMV by (location, payout week) and saves one row per pay week with `week_start_date` (Tuesday) and `week_end_date` (Monday of the sales period).
2. **Invoice:** For an invoice with period 9–15 Feb, the app looks up Slerp where `week_end_date` = **9 Feb** (the Monday that ends the sales period paid on 16 Feb). The PDF shows “Sales period: 3 Feb – 9 Feb” and “Paid directly into your account on 16 Feb”.

So the spreadsheet is parsed by fulfillment date; each order is assigned to the correct payout week (and thus sales period); the invoice then pulls the Slerp row whose sales period is the one that pays on the Monday after the invoice’s aggregator week.

## Logo

Place your Hungry Tum logo in the **`public`** folder as **`Hungry Tum Logo.png`** (same folder as test invoice PDFs). It is used in the sidebar, login page, BACS setup complete page, and on generated PDF invoices. If the file is missing, the PDF falls back to the "HT" text; web pages will show a broken image until the file is present.

## Stripe payments (optional)

Franchisees can pay invoices directly via Stripe. Payments go to **your** Stripe account.

### 1. Env vars

Add to **`.env.local`**:

```env
STRIPE_SECRET_KEY=sk_test_...   # or sk_live_... for production
STRIPE_WEBHOOK_SECRET=whsec_... # from Stripe Dashboard → Developers → Webhooks (see step 2)
```

For success/cancel redirects in production, set:

```env
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

### 2. Webhook (so invoices are marked “Paid”)

1. In [Stripe Dashboard](https://dashboard.stripe.com) go to **Developers → Webhooks** and **Add endpoint**.
2. **Endpoint URL**: `https://yourdomain.com/api/webhooks/stripe` (for local testing use [Stripe CLI](https://stripe.com/docs/stripe-cli): `stripe listen --forward-to localhost:3000/api/webhooks/stripe`).
3. Subscribe to **checkout.session.completed** and **payment_intent.succeeded** (needed for BACS recurring payments).
4. Copy the **Signing secret** (`whsec_...`) into `.env.local` as `STRIPE_WEBHOOK_SECRET`.

When a payment completes, the webhook updates the invoice status to **Paid**.

**Local webhook testing:** Stripe can’t reach `localhost` directly. Forward events to your app with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The CLI will print a **webhook signing secret** (e.g. `whsec_...`). Put that in `.env.local` as `STRIPE_WEBHOOK_SECRET`, restart the dev server, then trigger a BACS collection or BACS setup; the forwarded events will hit your app. (In test mode, BACS collection also marks the invoice paid immediately without webhooks, so the CLI is optional for that.)

### 3. Service role for webhook

The webhook updates Supabase as the server. Add your Supabase **service_role** key to `.env.local` (same as for the optional test user):

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Flow

- On the **Invoices** page, unpaid invoices whose franchisee has BACS set up show a **Collect BACS** button to take payment via Direct Debit. (Card payment is not used.)
- After payment, Stripe sends `checkout.session.completed` to your webhook; the app sets the invoice to **Paid** and the user is redirected back to `/invoices`.

## BACS Direct Debit (recurring payments, UK)

You can collect invoice payments via **BACS Direct Debit** so franchisees pay from their UK bank account on a recurring basis (e.g. each invoice).

### 1. Stripe and database

- Stripe must be set up (see **Stripe payments** above). In [Stripe Dashboard → Payment methods](https://dashboard.stripe.com/settings/payment_methods), enable **Bacs Direct Debit** (UK identity verification may be required).
- Add columns to `franchisees` if you created the table before BACS was added. In Supabase **SQL Editor**, run:
  ```sql
  ALTER TABLE public.franchisees
    ADD COLUMN IF NOT EXISTS stripe_customer_id text,
    ADD COLUMN IF NOT EXISTS bacs_payment_method_id text;
  ```
  Or run the migration file `supabase/migrations/20260213_add_bacs_columns.sql`.

- **Multiple brands and % per platform:** If you see “Could not find the 'brands' column”, run the migrations in order in Supabase **SQL Editor**: `supabase/migrations/20260214_add_franchisee_brand.sql` then `supabase/migrations/20260215_brands_and_per_platform.sql`. Or with Supabase CLI: `supabase db push`.

### 2. Email the franchisee (Resend)

So that **Set up BACS** sends the franchisee an email (instead of opening Stripe for the admin), add to `.env.local`:

```env
RESEND_API_KEY=re_xxxxx
BACS_EMAIL_FROM=Hungry Tum <bacs@yourdomain.com>
```

- Get an API key at [Resend](https://resend.com/api-keys). Verify your domain in Resend so you can send from `bacs@yourdomain.com`; for testing you can omit `BACS_EMAIL_FROM` (defaults to `onboarding@resend.dev`).
- When the admin clicks **Set up BACS**, the app creates a Stripe setup link and emails it to the franchisee’s address. The franchisee clicks the link, completes BACS on Stripe, then sees a “BACS setup complete” page.

**Sending invoice PDFs by email:** On the **Invoices** page, each invoice whose franchisee has an email shows a **Send** (envelope) button. Clicking it generates the PDF, attaches it to an email, and sends it to the franchisee’s email address (the invoice status is set to **Sent**). Optional: set `INVOICE_EMAIL_FROM` in `.env.local` to override the “From” address for invoice emails (defaults to `BACS_EMAIL_FROM` or Resend’s default). To test delivery without changing the franchisee’s email, expand an invoice row and click **Send test copy to nigelwingshackco@gmail.com** (or change the test address in the code).

### 3. Flow

1. **Set up BACS (once per franchisee)**  
   On the **Franchisees** page, click **Set up BACS** for a franchisee. The app emails them a link to Stripe Checkout to provide their UK bank details and accept the Direct Debit mandate. Stripe sends a **checkout.session.completed** (mode `setup`) webhook; the app saves the payment method to that franchisee.

2. **Collect payment for an invoice**  
   On the **Invoices** page, for any unpaid invoice whose franchisee has BACS set up, a **Collect BACS** (building) button appears. Clicking it creates a PaymentIntent and debits the franchisee’s bank account. Money typically confirms in a few business days. The webhook **payment_intent.succeeded** marks the invoice as **Paid** when the bank confirms.

### 4. When to collect BACS

BACS collection day is **Friday**. For each invoice week, the app shows the **next Friday after the week end** in the **Collect from** column on the Invoices page (for unpaid invoices where the franchisee has BACS set up). Same day for all franchisees regardless of platform mix.

**Typical flow:** Generate the invoice (PDF) and send it to the franchisee on **Tuesday**. On **Friday**, use **Collect BACS** on the Invoices page for that week’s invoices; Stripe takes the invoice amount from each franchisee’s bank. No extra configuration is needed in Stripe—the amount is the invoice fee when you click Collect BACS.

### 5. Invoice PDF when paying by BACS

If a franchisee has BACS set up, the generated PDF invoice **does not show Shack Corp bank details**. Instead it states that **payment will be collected by BACS Direct Debit on [Friday date]** (the same Friday shown in “Collect from”). Franchisees without BACS still see the usual payment terms and bank details so they can pay by transfer.

### 6. Testing BACS (Stripe test mode)

Use **test** API keys (`sk_test_...`) and Stripe’s test bank details when setting up BACS in Checkout:

| Field          | Value      | Notes |
|----------------|------------|--------|
| **Sort code**  | `10-88-00` or `108800` | 6 digits; use the format the form accepts (with or without dashes). |
| **Account number** | `00012345` | Exactly **8 digits**, no spaces. Use this for a successful test. |

- **Successful setup:** Sort code **108800**, Account number **00012345** (mandate succeeds, payments later succeed).
- If Stripe shows “invalid account number”, try:
  - **00012345** (8 digits, with leading zeros).
  - No spaces or dashes in the account number.
  - Ensure **Bacs Direct Debit** is enabled in [Stripe Dashboard → Settings → Payment methods](https://dashboard.stripe.com/settings/payment_methods) and that you’re in **test mode** (toggle in the Dashboard).
- Full list of test sort codes/account numbers: [Stripe: Save Bacs Direct Debit bank details – Test the integration](https://docs.stripe.com/payments/bacs-debit/save-bank-details#testing).

### 6. Webhook events

Ensure your Stripe webhook is subscribed to:

- **checkout.session.completed** (BACS mandate setup)
- **payment_intent.succeeded** (BACS payment confirmation)

## Deploy to Vercel

1. **Push your code** to GitHub (or GitLab/Bitbucket). The repo should include `package.json`, `next.config.ts`, and the `src/` app.

2. **Create a Vercel project**
   - Go to [vercel.com](https://vercel.com) and sign in (GitHub recommended).
   - Click **Add New… → Project** and **import** your `hungry-tum-invoicing` repo.
   - Leave **Framework Preset** as Next.js and **Root Directory** as `.`. Click **Deploy** (it may fail until env vars are set; that’s fine).

3. **Add environment variables**
   - In the Vercel project, open **Settings → Environment Variables**.
   - Add each variable from **`.env.example`** (use **Production**, and optionally **Preview** for branch deploys). At minimum for a working deploy:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `STRIPE_SECRET_KEY`
     - `STRIPE_WEBHOOK_SECRET`
     - `NEXT_PUBLIC_APP_URL` = `https://<your-vercel-project>.vercel.app` (or your custom domain)
     - `RESEND_API_KEY`, `BACS_EMAIL_FROM` (if you use BACS emails)
   - Add any invoice/PDF vars you use: `INVOICE_PAYMENT_DAYS`, `INVOICE_BANK_NAME`, `INVOICE_SORT_CODE`, `INVOICE_ACCOUNT_NUMBER`, `INVOICE_EMAIL_FROM`.

4. **Redeploy**
   - **Deployments** → … on the latest deployment → **Redeploy** so the new env vars are applied.

5. **Configure Supabase for production**
   - Supabase Dashboard → **Authentication → URL Configuration**:
     - **Site URL**: set to `https://<your-vercel-project>.vercel.app` (or your custom domain).
     - **Redirect URLs**: add `https://<your-vercel-project>.vercel.app/**`, `https://<your-vercel-project>.vercel.app/reset-password`, and your custom domain URLs if you use one.

6. **Configure Stripe webhook (production)**
   - Stripe Dashboard (live mode) → **Developers → Webhooks** → **Add endpoint**.
   - **Endpoint URL**: `https://<your-vercel-project>.vercel.app/api/webhooks/stripe` (or your custom domain).
   - Events: **checkout.session.completed**, **payment_intent.succeeded**.
   - Copy the **Signing secret** and set it as `STRIPE_WEBHOOK_SECRET` in Vercel (then redeploy if it was already set).

7. **Custom domain (optional)**
   - Vercel project → **Settings → Domains** → add your domain and follow DNS instructions. Then set `NEXT_PUBLIC_APP_URL` and Supabase/Stripe URLs to that domain.

After deploy, use the **Before you deploy** checklist below to verify production.

## Before you deploy

Use this as a quick checklist once local/testing works (e.g. you’ve received the invoice email).

### Test locally

- [ ] **Login** – Sign in and redirect to dashboard; sign out and redirect to login.
- [ ] **Franchisees** – Add/edit a franchisee with a real email (e.g. your own for testing).
- [ ] **Upload** – Upload at least one CSV/PDF report per platform you use; confirm gross revenue is correct.
- [ ] **Invoices** – Confirm an invoice is created for the week; **Download PDF** and check layout, logo, and payment text (BACS vs bank details).
- [ ] **Send invoice email** – Send to franchisee email and to the test address; confirm PDF arrives and looks correct.
- [ ] **BACS (test mode)** – Set up BACS for a test franchisee (Stripe test details); use **Collect BACS** on an invoice and confirm it moves to Paid (or check Stripe Dashboard / webhook logs).

### Production environment

- [ ] **Supabase** – Use a production project (or a dedicated “prod” project). Run the same schema + BACS migration. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for the prod project.
- [ ] **Stripe** – Switch to **live** keys (`sk_live_...`) in your production env. Restart the dev server (or redeploy) so the new key is used. Enable **Bacs Direct Debit** under [Payment methods](https://dashboard.stripe.com/settings/payment_methods) in live mode. **Note:** Test-mode BACS payment methods cannot be used with live keys. Franchisees must complete **Set up BACS** again in live mode (new link from your live Stripe account) so they get live customer and payment-method IDs.
- [ ] **Stripe webhook (live)** – In Stripe Dashboard (live mode), add a webhook endpoint pointing to `https://yourdomain.com/api/webhooks/stripe` with the same two events. Set `STRIPE_WEBHOOK_SECRET` in production to the **live** webhook signing secret.
- [ ] **Resend** – Verify your domain in Resend so you can send from e.g. `bacs@hungrytum.co` and optionally `invoices@hungrytum.co`. Set `BACS_EMAIL_FROM` and optionally `INVOICE_EMAIL_FROM` in production.
- [ ] **App URL** – Set `NEXT_PUBLIC_APP_URL=https://yourdomain.com` (or your Vercel URL) so BACS setup links and redirects use the correct origin.
- [ ] **Password reset** – In Supabase Dashboard → Authentication → URL Configuration, add `https://yourdomain.com/reset-password` to **Redirect URLs** so “Forgot password?” emails can send users to your app to set a new password.

### Testing live Stripe and webhook

Once you’ve deployed with **live** keys and added the live webhook endpoint:

1. **Processing status** – On an invoice, click **Collect via BACS**. The invoice should move to **Processing** (not Paid). The Collect BACS button disappears for that invoice so you can’t double-charge. This confirms the charge was created and the app is not marking paid until the webhook fires.
2. **Webhook endpoint** – In Stripe Dashboard → Developers → Webhooks (live) → your endpoint → **Send test webhook** → choose `payment_intent.succeeded`. The request should return 200. (The test payload won’t contain your real `invoice_id`, so no invoice will be marked paid; you’re only checking the endpoint responds.)
3. **Real payment → Paid** – When a real BACS payment confirms (typically 3–5 business days), Stripe sends `payment_intent.succeeded` with your `invoice_id` in metadata. The webhook then marks that invoice **Paid**. To verify end-to-end: run one small live BACS collection (e.g. minimum £0.50) and wait for it to confirm, or check Stripe Dashboard → Payments for the payment status and your app’s invoice list after it succeeds.

### Security and ops

- [ ] **Secrets** – Never commit `.env.local` or production env vars. Use your host’s env/config (e.g. Vercel Environment Variables) for production.
- [ ] **Test user** – If you used `CREATE_TEST_USER_SECRET` and the test user, remove or change the secret and delete the test user in production Supabase Auth if you don’t need it.
- [ ] **Invoice payment days** – Confirm `INVOICE_PAYMENT_DAYS` and bank details (`INVOICE_BANK_NAME`, etc.) are correct for production; `0` means “see invoice” (no “within X days” text).

After deploy, do one end-to-end run: create/use a real franchisee, upload a report, generate and **send** an invoice email, then (when ready) run a live BACS setup and a live BACS collection and confirm the invoice is marked Paid.

## Database Schema

The system uses three main tables:

- **franchisees** - Franchise locations with payment model configuration
- **weekly_reports** - Uploaded platform revenue data per week
- **invoices** - Generated invoices with fee calculations and status tracking

## Usage

1. **Add Franchisees** – Go to **Franchisees**, add your franchise locations with their fee model (% of gross or monthly fixed).
2. **Open a franchisee** – Click a franchisee name or **View reports & invoices** to open that franchisee’s page.
3. **Upload reports (per franchisee)** – On the franchisee page, **Upload reports** tab: pick the week, upload platform CSV/PDF reports, review amounts, save. An invoice is created for that week.
4. **Invoices (per franchisee)** – **Invoices** tab shows only that franchisee’s invoices. Download PDF, send by email, or collect via BACS.
5. **Collect or track** - Use “Collect BACS” for franchisees with BACS set up, or change status to Sent/Paid manually.

The old **Upload Reports** and **Invoices** top-level routes redirect to **Franchisees**; uploads and invoices are now scoped per franchisee.
