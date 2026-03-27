-- Email drafts: payment failure notifications pending admin review before sending
CREATE TABLE IF NOT EXISTS public.email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  franchisee_id uuid REFERENCES public.franchisees(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  trigger text NOT NULL DEFAULT 'payment_failed',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'discarded')),
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz
);
