-- Allow manual entry when platform CSV export is blank (e.g. Uber download)
ALTER TABLE public.weekly_reports
  DROP CONSTRAINT IF EXISTS weekly_reports_file_type_check;
ALTER TABLE public.weekly_reports
  ADD CONSTRAINT weekly_reports_file_type_check
  CHECK (file_type IN ('csv', 'pdf', 'xlsx', 'manual'));
