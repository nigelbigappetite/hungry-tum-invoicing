-- TZ-style: we pay franchisee (Deliveroo to us, we pay them minus our fees)

ALTER TABLE public.franchisees
  ADD COLUMN IF NOT EXISTS payment_direction text NOT NULL DEFAULT 'collect_fees'
  CHECK (payment_direction IN ('collect_fees', 'pay_them'));

COMMENT ON COLUMN public.franchisees.payment_direction IS 'collect_fees = we collect fee via BACS; pay_them = we hold Deliveroo, pay them Deliveroo minus our D/U/J fees';
