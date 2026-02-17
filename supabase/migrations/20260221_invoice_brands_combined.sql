-- One Hungry Tum invoice per franchisee per week; brands column lists all brands on the invoice (for display/logos).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS brands text[] DEFAULT '{}';

COMMENT ON COLUMN public.invoices.brands IS 'All brands on this combined weekly invoice; used for logo display. When set, brand may be null.';
