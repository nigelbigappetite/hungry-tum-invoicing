-- Add payment intent tracking to invoices
-- Allows linking a Stripe PaymentIntent to an invoice, and surfacing failure reasons.

-- Extend status to include 'failed' (BACS payment declined by bank)
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'sent', 'processing', 'paid', 'failed'));

-- Store the Stripe PaymentIntent ID so we can cross-reference with Stripe dashboard
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_intent_id text;

-- Store the failure reason from Stripe (e.g. 'insufficient_funds', 'refer_to_payer')
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_failure_reason text;
