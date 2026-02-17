-- Multiple brands per franchisee + brand on reports/invoices + % per platform

-- 1. Franchisees: replace single brand with brands array
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS brands text[] DEFAULT '{}';

UPDATE public.franchisees
  SET brands = CASE
    WHEN brand IS NOT NULL AND brand != '' THEN ARRAY[brand]
    ELSE '{}'
  END
  WHERE brands = '{}' OR brands IS NULL;

ALTER TABLE public.franchisees
  DROP COLUMN IF EXISTS brand;

ALTER TABLE public.franchisees
  ALTER COLUMN brands SET DEFAULT '{}';

-- 2. Franchisees: add percentage per platform option and columns
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS deliveroo_percentage numeric,
  ADD COLUMN IF NOT EXISTS ubereats_percentage numeric,
  ADD COLUMN IF NOT EXISTS justeat_percentage numeric;

-- Allow new payment_model value (drop and recreate check)
ALTER TABLE public.franchisees DROP CONSTRAINT IF EXISTS franchisees_payment_model_check;
ALTER TABLE public.franchisees
  ADD CONSTRAINT franchisees_payment_model_check
  CHECK (payment_model IN ('percentage', 'monthly_fixed', 'percentage_per_platform'));

-- 3. Weekly reports: add brand (which brand this report is for)
ALTER TABLE public.weekly_reports
  ADD COLUMN IF NOT EXISTS brand text;

-- 4. Invoices: add brand (one invoice per franchisee per week per brand)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS brand text;
