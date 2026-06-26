-- ─── Payroll: per-line send-amount override + clawbacks ─────────────────────
--
-- Two money controls for the "Approve & Pay" flow:
--   1. The admin can override the exact amount sent to a cleaner at execution
--      time (sent_amount_cents records what actually went out, which may differ
--      from the computed net_cents).
--   2. If too much was sent, the admin can claw it back by reversing part/all of
--      the original Stripe transfer (pulling funds from the contractor's
--      connected account back to the platform). Each clawback is recorded.

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS sent_amount_cents  integer,            -- what was actually transferred
  ADD COLUMN IF NOT EXISTS clawed_back_cents  integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.payroll_clawbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL,
  stripe_reversal_id text,
  stripe_transfer_id text,
  reason text,
  status text NOT NULL DEFAULT 'completed',   -- completed | failed
  failure_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_clawbacks_run_idx ON public.payroll_clawbacks (run_id);

ALTER TABLE public.payroll_clawbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read payroll_clawbacks" ON public.payroll_clawbacks;
CREATE POLICY "admins read payroll_clawbacks" ON public.payroll_clawbacks
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

NOTIFY pgrst, 'reload schema';
