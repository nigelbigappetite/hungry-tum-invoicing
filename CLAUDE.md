# CLAUDE.md — hungry-tum-invoicing

> Agent context file for Claude Code. Keep this current — it is the primary context source for all AI-assisted work on this repo.

## Mission

Franchise fee invoicing system for Hungry Tum. Ingests weekly delivery platform reports (Deliveroo, Uber Eats, Just Eat, Slerp), calculates franchise fees as a percentage of gross revenue, generates PDF invoices, and collects payment via Stripe BACS Direct Debit.

## Status

**Current state:** Active — production
**Deployed:** Vercel
**Branch strategy:** `main` = prod

## Core User Flows

1. **Admin** — uploads weekly CSV/PDF reports per franchisee per platform → system parses revenue → generates draft invoice
2. **Admin** — sends invoice to franchisee via email (Resend) + triggers Stripe BACS collection
3. **Franchisee** — receives invoice email → sets up BACS mandate via Stripe → gets auto-charged on future invoices
4. **Admin** — monitors payment status across all franchisees, views revenue dashboard

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Auth | Supabase Auth |
| Database | Supabase (PostgreSQL) |
| Payments | Stripe (BACS Direct Debit + card) |
| Email | Resend |
| PDF | @react-pdf/renderer |
| File parsing | PapaParse (CSV), pdf-parse (PDF), XLSX |
| Deployment | Vercel |

## Architecture

### Route Map

```
app/
├── (dashboard)/              — protected franchisee + invoice management pages
│   ├── page.tsx              — dashboard overview
│   ├── franchisees/          — franchisee list + management
│   ├── invoices/             — invoice list + detail
│   └── reports/              — weekly report uploads
├── login/                    — auth
├── reset-password/           — password reset
├── bacs-setup-complete/      — BACS mandate confirmation landing page
└── api/
    ├── parse-file/           — CSV/PDF/XLSX report ingestion
    ├── webhooks/stripe/      — BACS setup + payment webhooks
    ├── create-monthly-invoice/  — invoice generation trigger
    ├── charge-invoice-bacs/  — initiate BACS collection
    ├── send-invoice-email/   — Resend invoice email
    └── generate-invoice/     — PDF generation
```

### Invoice Flow

1. Admin uploads weekly report (CSV/PDF) → `/api/parse-file` extracts revenue per platform
2. Revenue stored in `weekly_reports` against franchisee + week
3. Admin triggers invoice generation → fee % applied → `invoices` record created (status: Draft)
4. Admin sends invoice → Resend email + optional Stripe BACS charge
5. Stripe webhook updates `invoices.status` → Paid on success

### BACS Flow

1. Franchisee receives setup email with Stripe BACS mandate link
2. Franchisee completes mandate → `stripe_customer_id` + `bacs_payment_method_id` stored on franchisee
3. Future invoices auto-charged via `/api/charge-invoice-bacs`
4. `bacs-setup-complete` page confirms setup to franchisee

### Key Files

- `lib/supabase/` — DB client setup
- `middleware.ts` — auth protection
- `app/api/parse-file/` — multi-format report parser (CSV, PDF, XLSX)
- `app/api/generate-invoice/` — PDF invoice renderer

## Database

9 migrations in `supabase/migrations/`.

**Key tables:**
- `franchisees` — name, email, fee_percentage, stripe_customer_id, bacs_payment_method_id
- `weekly_reports` — franchisee_id, platform (uber_eats|deliveroo|just_eat|slerp), gross_revenue, week_start
- `invoices` — franchisee_id, status (Draft|Sent|Paid), fee_amount, period_start, period_end
- `brands` — brand catalogue (added in recent migration)

**Platforms supported:** `uber_eats`, `deliveroo`, `just_eat`, `slerp`

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Email (Resend)
RESEND_API_KEY=

# Invoice details (appear on PDF)
INVOICE_BANK_NAME=
INVOICE_SORT_CODE=
INVOICE_ACCOUNT_NUMBER=
INVOICE_COMPANY_NAME=
```

## Project Connections

| Direction | Project | How |
|-----------|---------|-----|
| Receives from | `hungry-tum-ordering` | Order/sales data informs which franchisees need invoicing |
| Receives from | `hungry-tum-partners` | Delivery platform sales data (same source: Uber/Deliveroo/Just Eat) |
| Standalone | — | Stripe + Resend integrations are self-contained |

## Agent Instructions

### You MAY:
- Read and modify any file in this repo
- Run `npm run dev`, `npm run build`, `npm run lint`
- Add new platform types to the parser
- Extend invoice PDF templates
- Write new API routes following existing patterns

### You MUST NOT:
- Push to `main` or deploy without explicit user approval
- Delete or modify existing migrations
- Hard-code secrets or API keys
- Trigger real Stripe BACS charges during development

### Patterns to follow:
- File parsing is multi-format — check `parse-file` before adding new file type support
- PDF generation is server-side only (`@react-pdf/renderer`)
- Revenue values: check whether stored as float or minor units before arithmetic (verify in migrations)
- Always handle Stripe webhook idempotency — webhook may fire multiple times

## Constraints & Non-Negotiables

- BACS mandates are real financial instruments — never trigger in dev/test without Stripe test mode
- Stripe webhook must be verified with `STRIPE_WEBHOOK_SECRET` before processing

## Known Issues / Backlog

- [ ] CSV column names for Uber report exports are unverified — need real Uber export to confirm headers (same issue noted in hungry-tum-partners)
- [ ] Slerp platform support added in recent migration — verify parser handles it fully

## Commands

```bash
npm run dev      # Dev server
npm run build    # Production build
npm run lint     # ESLint
```

---
*Last updated: 2026-03-14*
