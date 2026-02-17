-- Slerp (Wing Shack Direct): platform, franchisee slerp %, xlsx file type

-- 1. Franchisees: Slerp fee % per location (Loughton 28%, Maidstone 15%, Chatham 35%, Bethnal Green 30%)
ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS slerp_percentage numeric;

-- 2. Weekly reports: allow platform 'slerp'
ALTER TABLE public.weekly_reports
  DROP CONSTRAINT IF EXISTS weekly_reports_platform_check;
ALTER TABLE public.weekly_reports
  ADD CONSTRAINT weekly_reports_platform_check
  CHECK (platform IN ('deliveroo', 'ubereats', 'justeat', 'slerp'));

-- 3. Weekly reports: allow file_type 'xlsx' for Slerp statement uploads
ALTER TABLE public.weekly_reports
  DROP CONSTRAINT IF EXISTS weekly_reports_file_type_check;
ALTER TABLE public.weekly_reports
  ADD CONSTRAINT weekly_reports_file_type_check
  CHECK (file_type IN ('csv', 'pdf', 'xlsx'));
