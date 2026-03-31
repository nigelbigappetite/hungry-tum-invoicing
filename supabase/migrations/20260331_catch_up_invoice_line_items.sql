alter table invoices
  add column if not exists source_invoice_ids uuid[] null;

alter table invoices
  add column if not exists line_items jsonb null;

comment on column public.invoices.source_invoice_ids is 'Source invoice ids included in a catch-up invoice.';
comment on column public.invoices.line_items is 'Stored catch-up invoice line items shown on the PDF and email preview.';
