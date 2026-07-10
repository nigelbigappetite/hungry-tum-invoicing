# CLAUDE.md — hungry-tum-invoicing

> Agent context file for Claude Code. Keep this current — it is the primary context source for all AI-assisted work on this repo.

## Mission

Franchise fee invoicing system for Hungry Tum. Ingests weekly delivery platform reports (Deliveroo, Uber Eats, Just Eat, Slerp), calculates franchise fees as a percentage of gross revenue, generates PDF invoices, and sends them via email. **Stripe/BACS has been fully removed** — payment collection is now manual.

## Status

**Current state:** Active — production
**Deployed:** Vercel
**Branch strategy:** `main` = prod

## Core User Flows

1. **Admin** → goes to Weekly Hub (`/weekly`) → selects week → uploads CSV/PDF reports per franchisee per platform
2. **Admin** → generates invoice from uploaded reports → reviews draft PDF
3. **Admin** → sends invoice via email (Resend, verified domain) to franchisee
4. **Admin** → manually records payment when received → monitors status on dashboard

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Auth | Supabase Auth |
| Database | Supabase (PostgreSQL) |
| Email | Resend (verified domain required) |
| PDF | @react-pdf/renderer |
| File parsing | PapaParse (CSV), pdf-parse (PDF), XLSX |
| Deployment | Vercel |

**Stripe has been fully removed.** No BACS, no card, no webhooks. Remove any remaining Stripe env vars from Vercel if present.

## Architecture

Source code lives under `src/` — paths are `src/app/`, `src/components/`, `src/lib/`.

### Route Map

```
src/app/
├── (dashboard)/                — auth-protected admin pages
│   ├── page.tsx                — dashboard: This Week's Fees + Total Fee Income stats
│   ├── franchisees/            — franchisee list
│   │   └── [id]/page.tsx       — franchisee detail (bank details, invoices, reports)
│   ├── weekly/page.tsx         — Weekly Hub: upload reports, generate + manage invoices per week
│   └── analytics/page.tsx      — analytics overview
├── login/                      — Supabase auth login
├── reset-password/             — password reset
└── api/
    ├── parse-file/             — CSV/PDF/XLSX report ingestion (multi-format)
    ├── generate-invoice/       — PDF generation (@react-pdf/renderer, server-side only)
    ├── generate-weekly-invoice/— invoice generation from weekly report data
    ├── create-monthly-invoice/ — invoice generation trigger (legacy, still present)
    ├── send-invoice-email/     — Resend invoice email (uses verified domain)
    ├── update-invoice/         — invoice status + field updates
    └── record-invoice-paid/    — mark invoice as paid
```

**Removed routes** (do not recreate): `charge-invoice-bacs`, `clear-bacs`, `confirm-bacs-setup`, `setup-bacs`, `sync-bacs-status`, `webhooks/stripe`, `approve-email-draft`, `discard-email-draft`, `create-catch-up-invoice`, `create-payment-session`

**Removed pages** (do not recreate): `bacs-setup-complete`, `invoices/`, `upload/`

### Invoice Flow

1. Admin uploads weekly report (CSV/PDF/XLSX) via Weekly Hub → `/api/parse-file` extracts revenue + financial breakdown
2. Revenue stored in `weekly_reports` against franchisee + week (includes platform commission, ad spend, delivery fee, adjustments, net payout, order count)
3. Admin triggers invoice generation → fee % applied → `invoices` record created (status: Draft)
4. Admin reviews PDF, sends via Resend email
5. Admin manually marks invoice paid via `/api/record-invoice-paid`

### Key Files

- `src/lib/supabase/` — DB client setup
- `src/middleware.ts` — auth route protection
- `src/app/api/parse-file/` — multi-format parser (CSV, PDF, XLSX)
- `src/app/api/generate-invoice/` — PDF invoice renderer (server-side only)
- `src/app/(dashboard)/weekly/page.tsx` — Weekly Hub (primary admin workflow)
- `src/components/InvoicePDF.tsx` — PDF template (includes TZ gross revenue + fee breakdown)
- `src/lib/parsers/csv-parser.ts` — CSV parser with financial breakdown fields + multi-week Uber split
- `src/lib/parsers/pdf-parser.ts` — PDF parser with financial breakdown fields
- `src/components/FranchiseeForm.tsx` — franchisee create/edit (includes bank details fields)
- `src/lib/utils.ts` — shared utilities including `isTzPeriPeriInvoice()`, `getPlatformFeeRate()`, date helpers

### Deliveroo PDF Parser — key rules

- **Multi-site accounts**: Deliveroo payment statements for accounts covering multiple brands (e.g. Wing Shack + Fireaway on one Annkyra account) show a combined "Total payable to ANNKYRA LIMITED" figure. The parser extracts `platform_payout` from the **"Total payable to site"** line in the Site Breakdown section (HT/Wing Shack brand only) — not the combined total. See `src/lib/parsers/pdf-parser.ts`.

### Just Eat HTML Parser — key rules

- The parsed result field is `platform_payout` (not `net_payout`). The weekly hub reads `data.platform_payout` — any rename must stay in sync.
- Commission regex targets the actual commission amount at the end of lines like `"Commission on GOV of £337.60 ... £47.26"` — do not change it to capture the GOV figure. See `src/lib/parsers/html-parser.ts`.

### Uber Eats CSV Parser — key rules

- **gross_revenue = `Sales (incl. VAT)` − offers − offer redemption fees** (order rows only, completed status)
- **Tips are excluded** from gross_revenue — they belong to the franchisee (own-delivery sites keep tips)
- **Delivery fee is excluded** from gross_revenue — belongs to the franchisee for own-delivery sites
- **Multi-week detection**: if the CSV has > 1 distinct payout date, the parser returns `weekly_splits[]` instead of a single total. Each split covers one order week: `week_start = payout_date − 7 days`, `week_end = payout_date − 1 day`.
- Payout is summed across ALL rows (including non-order adjustment rows like ad spend) using `Total payout` column, with `Other payments (incl. VAT)` as fallback for rows where payout column is blank.

### pay_them Payout Logic

Franchisees with `payment_direction = 'pay_them'` have two distinct models:

**TZ Peri Peri (exception)** — detected via `isTzPeriPeriInvoice()` in `src/lib/utils.ts`:
- HT holds Deliveroo funds directly and pays TZ: `Deliveroo gross − total HT fees (all platforms)`
- Invoice renders as fee-only (no platform commission breakdown shown)

**All other pay_them franchisees (standard model)**:
- HT pays them for all 3rd party platforms directly
- `amountWePay = total platform payout across D+U+JE − HT fee` (falls back to gross if payout data unavailable)
- Invoice shows full per-platform breakdown with "Your payout this week" in the body and explicit transfer amount in the footer

`isTzPeriPeriInvoice()` is exported from `src/lib/utils.ts` and used by both `generate-invoice/route.ts` and `InvoicePDF.tsx`. Do not duplicate it locally.

### Dashboard Metrics

- **This Week's Fees** — sum of current-week invoice totals (replaced "Outstanding Fees")
- **Total Fee Income** — sum of all paid invoice fees (replaced "Total Invoices")

## Database

11+ migrations in `supabase/migrations/`.

**Key tables:**
- `franchisees` — name, email, fee_percentage, bank details (sort_code, account_number, bank_name added in migration `20260702000000`)
- `weekly_reports` — franchisee_id, platform, gross_revenue, week_start, plus financial breakdown columns: platform_commission, ad_spend, delivery_fee, adjustments, net_payout, order_count, platform_payout
- `invoices` — franchisee_id, status (Draft|Sent|Paid), fee_amount, period_start, period_end, invoice_date
- `brands` — brand catalogue

**Recent migrations (in order):**
- `20260401_report_financials_ad_spend` — ad spend + financial fields on weekly_reports
- `20260628000000_add_platform_payout` — platform_payout column
- `20260628000001_add_financial_breakdown` — full financial breakdown columns
- `20260702000000_invoice_date_and_franchisee_bank_details` — invoice_date field + franchisee bank details
- `20260702000001_remove_bacs` — removes BACS/Stripe columns from franchisees

**Platforms supported:** `uber_eats`, `deliveroo`, `just_eat`, `slerp`

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Email (Resend) — must use a verified sending domain
RESEND_API_KEY=

# Invoice defaults (appear on PDF if franchisee has no bank details set)
INVOICE_COMPANY_NAME=
```

**Stripe vars are no longer needed** — remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from Vercel if still set.

## UI / Styling Notes

- Light mode: white sidebar, orange primary buttons, bold-black primary text
- Dark mode: unchanged
- Stat card icons use simplified neutral style
- Brand colour: Hungry Tum orange (`#FF6B35` / Tailwind `brand-primary`)

## Project Connections

| Direction | Project | How |
|-----------|---------|-----|
| Receives from | `hungry-tum-ordering` | Order/sales data informs which franchisees need invoicing |
| Receives from | `hungry-tum-partners` | Delivery platform sales data (same source: Uber/Deliveroo/Just Eat) |
| Standalone | — | Resend email is self-contained |

## Agent Instructions

### You MAY:
- Read and modify any file in this repo
- Run `npm run dev`, `npm run build`, `npm run lint`
- Add new platform types to the parser
- Extend invoice PDF templates (`src/components/InvoicePDF.tsx`)
- Write new API routes following existing patterns

### You MUST NOT:
- Push to `main` or deploy without explicit user approval
- Delete or modify existing migrations
- Hard-code secrets or API keys
- Recreate any of the removed BACS/Stripe routes or pages
- Add Stripe back without explicit instruction

### Patterns to follow:
- File parsing is multi-format — check `src/app/api/parse-file/` before adding new file type support
- PDF generation is server-side only (`@react-pdf/renderer` — never import in client components)
- Revenue values are stored as floats (not minor units) — verify in migrations before arithmetic
- Weekly Hub (`/weekly`) is the primary admin workflow — new invoice-related features should fit here
- Multi-week Uber CSVs (monthly downloads) are handled automatically: the parser splits by payout date and the UI shows a "Save all" button that backfills each week as a separate `weekly_report` row. The file is stored once under `reports/{franchiseeId}/multi/`. Invoices are NOT auto-generated on multi-week save — admin navigates to each week to generate.

## Commands

```bash
npm run dev      # Dev server
npm run build    # Production build
npm run lint     # ESLint
```

### Invoice PDF Footer Layout

The `pay_them` footer is intentionally compact to keep invoices to a single page:
- `marginTop: 10`, `paddingTop: 8` (previously 40/20)
- Transfer amount line: `"We will transfer £X to [franchisee name].  ·  Ref: INV-XXX"` — all on one line
- Bank details collapsed onto a single line joined with `  ·  ` separators (account name · bank · sort code · account number)
- Falls back to `"Remaining funds will be transferred to [name]."` if `amountWePay` is not available

Do not expand the footer back to multi-line — the single-page constraint is intentional.

---
*Last updated: 2026-07-10 (session 4)*
