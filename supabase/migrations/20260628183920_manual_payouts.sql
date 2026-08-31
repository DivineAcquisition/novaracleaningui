-- ─── Simplified custom payouts ─────────────────────────────────────────────
-- Backs the simplified Payroll "Custom Payout" module: an admin picks a job
-- (real booking), types a custom payout amount, and we record it here with the
-- profit math + % paid out. One active (non-cancelled) payout per booking.

CREATE TABLE IF NOT EXISTS public.manual_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  cleaner_id      UUID,
  cleaner_name    TEXT,
  cleaner_email   TEXT,
  cleaner_phone   TEXT,
  service_date    DATE,
  revenue_cents   INTEGER NOT NULL DEFAULT 0,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  profit_cents    INTEGER NOT NULL DEFAULT 0,
  pct_paid        NUMERIC(6,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  note            TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ,
  email_sent_at   TIMESTAMPTZ,
  sms_sent_at     TIMESTAMPTZ,
  airtable_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS manual_payouts_created_at_idx ON public.manual_payouts (created_at DESC);
CREATE INDEX IF NOT EXISTS manual_payouts_cleaner_idx ON public.manual_payouts (cleaner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manual_payouts_status_idx ON public.manual_payouts (status);
-- At most one active (non-cancelled) payout per booking so re-submitting a job
-- updates the existing row rather than duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS manual_payouts_active_booking_uniq
  ON public.manual_payouts (booking_id)
  WHERE booking_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE public.manual_payouts ENABLE ROW LEVEL SECURITY;

-- Service role (edge / server routes) bypasses RLS; add an admin/va read policy
-- so the admin SPA could read directly if needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='manual_payouts' AND policyname='manual_payouts_admin_read'
  ) THEN
    CREATE POLICY "manual_payouts_admin_read"
      ON public.manual_payouts FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','va')
      ));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
