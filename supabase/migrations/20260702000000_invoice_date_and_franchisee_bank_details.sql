alter table public.invoices
  add column if not exists invoice_date date;

update public.invoices
set invoice_date = case
  when status = 'draft' then current_date
  else created_at::date
end
where invoice_date is null;

alter table public.invoices
  alter column invoice_date set default current_date,
  alter column invoice_date set not null;

comment on column public.invoices.invoice_date is 'Issue date shown on the invoice PDF. Editable while invoice is draft.';

alter table public.franchisees
  add column if not exists bank_account_name text,
  add column if not exists bank_name text,
  add column if not exists sort_code text,
  add column if not exists account_number text;

comment on column public.franchisees.bank_account_name is 'Franchisee payout account holder name.';
comment on column public.franchisees.bank_name is 'Franchisee payout bank name.';
comment on column public.franchisees.sort_code is 'Franchisee payout sort code.';
comment on column public.franchisees.account_number is 'Franchisee payout account number.';
