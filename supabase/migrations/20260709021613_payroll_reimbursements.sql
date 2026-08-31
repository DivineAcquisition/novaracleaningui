-- ─── Payroll: per-job supply reimbursement + mileage pay ────────────────────
--
-- Each cleaner's share of a payroll job can now carry:
--   • supply_reimbursement_cents   — supplies bought for THIS job
--   • mileage_miles / mileage_rate_cents / mileage_reimbursement_cents
--     (reimbursement = miles × rate, computed server-side at save time)
--   • reimbursement_note           — what the money was for
--
-- Weekly payroll_runs roll the line reimbursements up into
-- reimbursement_cents, and net = gross + bonus + reimbursement − deduction,
-- so reimbursements ride the exact same approve → execute → Stripe-transfer
-- rail as base pay. Default mileage rate: 70¢/mile (2026 IRS standard).

ALTER TABLE public.payroll_job_cleaners
  ADD COLUMN IF NOT EXISTS supply_reimbursement_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mileage_miles numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mileage_rate_cents integer NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS mileage_reimbursement_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reimbursement_note text;

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS reimbursement_cents integer NOT NULL DEFAULT 0;
