create table if not exists report_financials (
  id uuid primary key default gen_random_uuid(),
  weekly_report_id uuid not null references weekly_reports(id) on delete cascade,
  platform_commission numeric,
  delivery_fee numeric,
  restaurant_offers numeric,
  platform_offers numeric,
  adjustments numeric,
  net_payout numeric,
  order_count integer,
  created_at timestamptz default now()
);

create unique index if not exists report_financials_weekly_report_idx
  on report_financials(weekly_report_id);
