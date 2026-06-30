-- Add financial_breakdown JSONB to weekly_reports.
-- Stores the full platform statement breakdown (earnings, commission, ad spend, offer redemption, adjustments)
-- parsed from uploaded PDF/CSV files. Null for manual entries.
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS financial_breakdown JSONB;
