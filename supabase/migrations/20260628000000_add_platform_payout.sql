-- Add platform_payout to weekly_reports.
-- Stores the actual payout transferred by the platform (after their commission deductions),
-- separate from gross_revenue which is the fee-calculation basis (earnings minus HT-covered offers).
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS platform_payout NUMERIC(10,2);
