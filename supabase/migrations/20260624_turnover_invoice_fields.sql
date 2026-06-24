-- Stripe invoice tracking for turnovers (applied live 2026-06-24).
-- The open weekly scheduler invoices each turnover (collection_method
-- send_invoice); paying the invoice stores the card and books/assigns the
-- turnover via the stripe-webhook invoice.payment_succeeded → partner-turnover
-- turnover.finalizeByInvoice path.
alter table public.turnover_requests
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_invoice_url text,
  add column if not exists invoiced_at timestamptz;
