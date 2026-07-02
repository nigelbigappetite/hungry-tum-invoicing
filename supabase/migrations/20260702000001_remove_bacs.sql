alter table public.franchisees
  drop column if exists bacs_payment_method_id;

alter table public.invoices
  drop column if exists collect_from_date;

comment on column public.franchisees.payment_direction is 'collect_fees = franchisee pays Hungry Tum manually; pay_them = Hungry Tum pays the franchisee their due funds.';
