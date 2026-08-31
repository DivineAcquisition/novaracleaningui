-- Manual Payroll Module
--
-- A self-contained payroll subsystem for 1099 cleaning contractors that lives
-- entirely behind the admin "Payroll" tab. It is INTENTIONALLY separate from
-- the operational public.jobs / public.payouts tables (which model dispatch +
-- per-booking Stripe transfers) so the manual/automated payroll workflow can't
-- collide with the live booking → completion → payout flow.
--
-- Entities:
--   payroll_jobs           one completed job (manual or automated entry)
--   payroll_job_cleaners   per-cleaner share of a job (the m2m + pay split)
--   payroll_runs           one weekly run per cleaner (Mon–Sun)
--   payroll_job_audit      override / unlock audit trail
--
-- The tier % is LOCKED onto each job at save time (payroll_jobs.tier_pct_locked
-- + payroll_job_cleaners.pay_cents) so promoting a cleaner never recomputes
-- historical pay.

-- ─── cleaners: payment method (how this contractor is paid) ───────────────
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'stripe_connect';
-- allowed: stripe_connect | manual_ach | zelle | cash | hold

-- ─── payroll_jobs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_completed timestamptz NOT NULL DEFAULT now(),
  customer_name text,
  service_type text NOT NULL DEFAULT 'Standard',
  customer_paid_cents integer NOT NULL DEFAULT 0,
  cleaner_count integer NOT NULL DEFAULT 1,
  tier_pct_locked numeric NOT NULL DEFAULT 35,
  cleaner_pay_pool_cents integer NOT NULL DEFAULT 0,
  pay_per_cleaner_cents integer NOT NULL DEFAULT 0,
  pay_period date NOT NULL,                       -- Monday of the completion week
  payment_status text NOT NULL DEFAULT 'pending', -- pending|approved|paid|disputed|hold
  entry_source text NOT NULL DEFAULT 'manual',    -- manual|automated|import
  notes text,
  locked boolean NOT NULL DEFAULT false,          -- true once attached to a sent/paid run
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_jobs_period ON public.payroll_jobs(pay_period);
CREATE INDEX IF NOT EXISTS idx_payroll_jobs_status ON public.payroll_jobs(payment_status);

-- ─── payroll_runs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  pay_period_start date NOT NULL,                 -- Monday
  pay_period_end date NOT NULL,                   -- Sunday
  total_jobs integer NOT NULL DEFAULT 0,
  gross_cents integer NOT NULL DEFAULT 0,
  bonus_cents integer NOT NULL DEFAULT 0,
  deduction_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  payment_method text,
  stripe_connect_id text,
  status text NOT NULL DEFAULT 'draft',           -- draft|approved|sent|cleared|failed|hold
  stripe_transfer_id text,
  sent_at timestamptz,
  cleared_at timestamptz,
  failure_reason text,
  notes text,
  approved_by uuid,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One run per cleaner per pay period so re-building is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_cleaner_period
  ON public.payroll_runs(cleaner_id, pay_period_start);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON public.payroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_transfer ON public.payroll_runs(stripe_transfer_id);

-- ─── payroll_job_cleaners (per-cleaner share / the m2m) ───────────────────
CREATE TABLE IF NOT EXISTS public.payroll_job_cleaners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.payroll_jobs(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  pay_cents integer NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending', -- pending|approved|paid|disputed|hold
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, cleaner_id)
);
CREATE INDEX IF NOT EXISTS idx_pjc_cleaner ON public.payroll_job_cleaners(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_pjc_run ON public.payroll_job_cleaners(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pjc_status ON public.payroll_job_cleaners(payment_status);

-- ─── payroll_job_audit (override trail) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_job_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.payroll_jobs(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_job ON public.payroll_job_audit(job_id);

-- ─── RLS — admin/VA read; all writes go through the service-role function ──
ALTER TABLE public.payroll_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_job_cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_job_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read payroll_jobs" ON public.payroll_jobs;
CREATE POLICY "admins read payroll_jobs" ON public.payroll_jobs
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins read payroll_runs" ON public.payroll_runs;
CREATE POLICY "admins read payroll_runs" ON public.payroll_runs
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins read payroll_job_cleaners" ON public.payroll_job_cleaners;
CREATE POLICY "admins read payroll_job_cleaners" ON public.payroll_job_cleaners
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins read payroll_job_audit" ON public.payroll_job_audit;
CREATE POLICY "admins read payroll_job_audit" ON public.payroll_job_audit
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));
