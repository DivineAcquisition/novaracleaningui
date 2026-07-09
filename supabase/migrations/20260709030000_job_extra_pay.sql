-- ─── Per-job extra pay: supplies, mileage, surge, overtime ──────────────────
--
-- One row per (booking, cleaner) extra payment. Unlike the weekly payroll
-- reimbursement columns (payroll_job_cleaners), these are paid out
-- IMMEDIATELY via an exact-amount Stripe transfer (the Custom Payout rail),
-- so a cleaner gets their supplies/mileage/surge/OT money right away and the
-- record stays attached to the specific job.

CREATE TABLE IF NOT EXISTS public.job_extra_pay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  job_id uuid,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,

  supply_cents integer NOT NULL DEFAULT 0,
  mileage_miles numeric NOT NULL DEFAULT 0,
  mileage_rate_cents integer NOT NULL DEFAULT 70,      -- ¢/mile (2026 IRS std)
  mileage_cents integer NOT NULL DEFAULT 0,            -- miles × rate (server-computed)
  surge_cents integer NOT NULL DEFAULT 0,
  overtime_hours numeric NOT NULL DEFAULT 0,
  overtime_rate_cents integer NOT NULL DEFAULT 0,      -- ¢/hour
  overtime_cents integer NOT NULL DEFAULT 0,           -- hours × rate (server-computed)
  total_cents integer NOT NULL DEFAULT 0,

  note text,
  status text NOT NULL DEFAULT 'pending',              -- pending|paid|failed
  stripe_transfer_id text,
  failure_reason text,
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_extra_pay_cleaner ON public.job_extra_pay(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_job_extra_pay_booking ON public.job_extra_pay(booking_id);
CREATE INDEX IF NOT EXISTS idx_job_extra_pay_status  ON public.job_extra_pay(status);

ALTER TABLE public.job_extra_pay ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read job_extra_pay" ON public.job_extra_pay;
CREATE POLICY "admins read job_extra_pay" ON public.job_extra_pay
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));
