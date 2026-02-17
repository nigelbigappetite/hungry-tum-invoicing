-- Hungry Tum Invoicing: run this in Supabase SQL Editor (Project → SQL Editor → New query → Paste → Run)

-- Sequence for invoice numbers
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Tables
CREATE TABLE IF NOT EXISTS public.franchisees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text NOT NULL,
  email text NOT NULL,
  business_address text,
  site_address text,
  brands text[] DEFAULT '{}',
  payment_model text NOT NULL CHECK (payment_model IN ('percentage', 'monthly_fixed', 'percentage_per_platform')),
  percentage_rate numeric DEFAULT 6,
  monthly_fee numeric,
  deliveroo_percentage numeric,
  ubereats_percentage numeric,
  justeat_percentage numeric,
  slerp_percentage numeric,
  payment_direction text NOT NULL DEFAULT 'collect_fees' CHECK (payment_direction IN ('collect_fees', 'pay_them')),
  stripe_customer_id text,
  bacs_payment_method_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  brand text,
  platform text NOT NULL CHECK (platform IN ('deliveroo', 'ubereats', 'justeat', 'slerp')),
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  gross_revenue numeric NOT NULL,
  file_path text,
  file_type text NOT NULL CHECK (file_type IN ('csv', 'pdf', 'xlsx')),
  uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL DEFAULT ('HT-' || EXTRACT(year FROM now())::text || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0')),
  franchisee_id uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  brand text,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  total_gross_revenue numeric NOT NULL,
  fee_percentage numeric NOT NULL,
  fee_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'processing', 'paid')),
  pdf_path text,
  created_at timestamptz DEFAULT now()
);

-- RLS: authenticated users can do everything on app tables
ALTER TABLE public.franchisees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access franchisees" ON public.franchisees;
CREATE POLICY "Authenticated full access franchisees" ON public.franchisees FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated full access weekly_reports" ON public.weekly_reports;
CREATE POLICY "Authenticated full access weekly_reports" ON public.weekly_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated full access invoices" ON public.invoices;
CREATE POLICY "Authenticated full access invoices" ON public.invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket "invoicing" (create if not exists) and policies
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoicing', 'invoicing', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated upload invoicing" ON storage.objects;
CREATE POLICY "Authenticated upload invoicing" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'invoicing');

DROP POLICY IF EXISTS "Authenticated read invoicing" ON storage.objects;
CREATE POLICY "Authenticated read invoicing" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'invoicing');

DROP POLICY IF EXISTS "Authenticated update invoicing" ON storage.objects;
CREATE POLICY "Authenticated update invoicing" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'invoicing');
