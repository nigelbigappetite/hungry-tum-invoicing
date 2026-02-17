-- Add brand to franchisees (Hungry Tum brands: Wing Shack, SMSH BN, Eggs n Stuff)
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS brand text;

COMMENT ON COLUMN public.franchisees.brand IS 'Hungry Tum brand: Wing Shack, SMSH BN, Eggs n Stuff';
