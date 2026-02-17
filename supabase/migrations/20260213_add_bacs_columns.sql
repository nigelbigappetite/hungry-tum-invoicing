-- Add BACS Direct Debit fields to franchisees (run in Supabase SQL Editor if franchisees already exists)
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS bacs_payment_method_id text;
