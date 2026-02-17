-- Clear all franchisees (and their reports/invoices via CASCADE) so you can add real sites.
-- Run in Supabase Dashboard → SQL Editor.

-- Delete all franchisees; weekly_reports and invoices are removed automatically (ON DELETE CASCADE)
DELETE FROM public.franchisees;

-- Optional: reset invoice number sequence so new invoices start at HT-2026-0001 again
ALTER SEQUENCE invoice_number_seq RESTART WITH 1;
