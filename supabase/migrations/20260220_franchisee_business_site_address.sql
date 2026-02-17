-- Add business and site address to franchisees for invoicing
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS site_address text;

COMMENT ON COLUMN public.franchisees.business_address IS 'Registered / business address (multiline ok), shown on invoice Bill To';
COMMENT ON COLUMN public.franchisees.site_address IS 'Physical site / trading address (multiline ok), shown on invoice Bill To';
