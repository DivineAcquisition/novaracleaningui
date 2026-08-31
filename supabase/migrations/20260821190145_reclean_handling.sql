-- ─── Re-clean handling (Spotless Guarantee) ──────────────────────────────
--
-- Turns the existing qc_issues.issue_type='reclean' label into an end-to-end
-- workflow attached to the ORIGINAL job's QC case:
--   verify original photos/checklist → classify → paid follow-up booking
--   (customer charged $0, cleaner paid on assessed scope value).
--
-- Standing rules encoded as constraints, not comments:
--   • A re-clean booking cannot charge the customer.
--   • A re-clean cannot complete without a positive assessed pay value.
--   • Declining a re-clean offer is reliability-neutral.

-- ─── 1. Settings (admin-configurable guarantee window) ──────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'reclean_settings',
  jsonb_build_object(
    'guarantee_window_hours', 48,
    'serial_requester_threshold', 2,
    'repeat_quality_miss_threshold', 2
  ),
  'Spotless Guarantee re-clean window (hours after service) and pattern-flag thresholds. Requests outside the window still open a QC case and may be honored at admin discretion.'
)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Bookings: linker + pay basis (never the $0 customer charge) ─────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_reclean boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reclean_of_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reclean_qc_issue_id uuid;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reclean_scope text;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reclean_assessed_value_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_reclean_scope_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_reclean_scope_check
      CHECK (reclean_scope IS NULL OR reclean_scope IN ('targeted', 'full'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS bookings_is_reclean_idx
  ON public.bookings (is_reclean) WHERE is_reclean = true;
CREATE INDEX IF NOT EXISTS bookings_reclean_of_idx
  ON public.bookings (reclean_of_booking_id) WHERE reclean_of_booking_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.reclean_assessed_value_cents IS
  'Pricing-engine value of the re-clean scope. Cleaner pay is computed from THIS figure, never from the $0 customer charge. The company absorbs the cost.';

-- Customer cannot be charged; completion requires a pay basis.
CREATE OR REPLACE FUNCTION public.enforce_reclean_pay_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_reclean IS TRUE THEN
    IF COALESCE(NEW.final_charge_cents, 0) <> 0
       OR COALESCE(NEW.deposit_cents, 0) <> 0 THEN
      RAISE EXCEPTION 'Re-clean bookings cannot charge the customer (Spotless Guarantee). final_charge_cents/deposit_cents must be 0.';
    END IF;
    IF NEW.status = 'completed' AND COALESCE(NEW.reclean_assessed_value_cents, 0) <= 0 THEN
      RAISE EXCEPTION 'Cannot complete a re-clean without reclean_assessed_value_cents > 0 — unpaid re-cleans are prohibited.';
    END IF;
    IF NEW.reclean_of_booking_id IS NULL THEN
      RAISE EXCEPTION 'Re-clean bookings must link to the original job (reclean_of_booking_id).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reclean_pay_rules ON public.bookings;
CREATE TRIGGER trg_enforce_reclean_pay_rules
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reclean_pay_rules();

-- Original job pay is never reduced because a re-clean happened.
CREATE OR REPLACE FUNCTION public.protect_original_pay_from_reclean()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(OLD.is_reclean, false) IS FALSE
     AND OLD.cleaner_payout_cents IS NOT NULL
     AND NEW.cleaner_payout_cents IS NOT NULL
     AND NEW.cleaner_payout_cents < OLD.cleaner_payout_cents
     AND EXISTS (
       SELECT 1 FROM public.bookings r
       WHERE r.reclean_of_booking_id = NEW.id AND r.is_reclean = true
     ) THEN
    RAISE EXCEPTION 'A re-clean cannot reduce the original job payout (was % cents, attempted %).',
      OLD.cleaner_payout_cents, NEW.cleaner_payout_cents;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_original_pay_from_reclean ON public.bookings;
CREATE TRIGGER trg_protect_original_pay_from_reclean
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.protect_original_pay_from_reclean();

-- ─── 3. QC case: re-clean request lives ON the original issue ───────────
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_classification text;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_scope text;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_scope_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_areas_named text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_inside_window boolean;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_guarantee_window_hours integer;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_honored_outside_window boolean NOT NULL DEFAULT false;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_customer_prefers_other boolean NOT NULL DEFAULT false;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_original_offer_status text;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_assessed_value_cents integer;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_pay_cents integer;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_absorbed_cost_cents integer;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_verified_at timestamptz;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_verified_by uuid;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_verified_by_name text;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_requested_at timestamptz;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_message_draft text;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_customer_notified_at timestamptz;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_completion_notified_at timestamptz;

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_reclean_status_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_reclean_status_check
  CHECK (reclean_status IN (
    'none','requested','pending_review','classified','approved','declined',
    'offered','dispatched','in_progress','completed','cancelled'
  ));

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_reclean_classification_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_reclean_classification_check
  CHECK (reclean_classification IS NULL OR reclean_classification IN (
    'pending','quality_miss','scope_confusion','not_supported'
  ));

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_reclean_scope_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_reclean_scope_check
  CHECK (reclean_scope IS NULL OR reclean_scope IN ('targeted','full'));

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_reclean_offer_status_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_reclean_offer_status_check
  CHECK (reclean_original_offer_status IS NULL OR reclean_original_offer_status IN (
    'pending','offered','accepted','declined','skipped_customer_pref','expired'
  ));

CREATE INDEX IF NOT EXISTS qc_issues_reclean_status_idx
  ON public.qc_issues (reclean_status, reclean_classification)
  WHERE reclean_status IS DISTINCT FROM 'none';
CREATE INDEX IF NOT EXISTS qc_issues_reclean_booking_idx
  ON public.qc_issues (reclean_booking_id) WHERE reclean_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS qc_issues_reclean_cleaner_idx
  ON public.qc_issues (cleaner_id, reclean_classification)
  WHERE reclean_status IS DISTINCT FROM 'none';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_reclean_qc_issue_fk;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_reclean_qc_issue_fk
  FOREIGN KEY (reclean_qc_issue_id) REFERENCES public.qc_issues(id) ON DELETE SET NULL;

-- ─── 4. Audit actions for the reclean lifecycle ─────────────────────────
ALTER TABLE public.qc_issue_events DROP CONSTRAINT IF EXISTS qc_issue_events_action_check;
ALTER TABLE public.qc_issue_events
  ADD CONSTRAINT qc_issue_events_action_check
  CHECK (action IN (
    'created','status_change','note','updated','resolved','escalated',
    'reclean_requested','reclean_classified','reclean_approved','reclean_declined',
    'reclean_offered','reclean_dispatched','reclean_completed','reclean_message'
  ));

-- ─── 5. Re-clean offers do not count as reliability events ──────────────
ALTER TABLE public.job_assignments
  ADD COLUMN IF NOT EXISTS reliability_neutral boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.job_assignments.reliability_neutral IS
  'When true (re-clean offers), accept/decline is ignored by Novara Score reliability. Declining a re-clean is not a penalty.';

CREATE INDEX IF NOT EXISTS job_assignments_reliability_neutral_idx
  ON public.job_assignments (reliability_neutral) WHERE reliability_neutral = true;

-- Extra QC fields the workflow needs (source, who was offered/performed, goodwill).
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_source text;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_offered_to_cleaner_id uuid;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_performed_by_cleaner_id uuid;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_goodwill boolean NOT NULL DEFAULT false;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_offered_at timestamptz;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_completed_at timestamptz;
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_resolution_photos jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.qc_issue_events DROP CONSTRAINT IF EXISTS qc_issue_events_action_check;
ALTER TABLE public.qc_issue_events
  ADD CONSTRAINT qc_issue_events_action_check
  CHECK (action IN (
    'created','status_change','note','updated','resolved','escalated',
    'reclean_requested','reclean_classified','reclean_approved','reclean_declined',
    'reclean_offered','reclean_dispatched','reclean_completed','reclean_message',
    'reclean_offer_declined'
  ));

-- Customer charge is $0 in every charge column, not just final/deposit.
CREATE OR REPLACE FUNCTION public.enforce_reclean_pay_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_reclean IS TRUE THEN
    IF COALESCE(NEW.final_charge_cents, 0) <> 0
       OR COALESCE(NEW.deposit_cents, 0) <> 0
       OR COALESCE(NEW.total_estimate_cents, 0) <> 0 THEN
      RAISE EXCEPTION 'Re-clean bookings cannot charge the customer (Spotless Guarantee). Charge columns must be 0.';
    END IF;
    IF NEW.status = 'completed' AND COALESCE(NEW.reclean_assessed_value_cents, 0) <= 0 THEN
      RAISE EXCEPTION 'Cannot complete a re-clean without reclean_assessed_value_cents > 0 — unpaid re-cleans are prohibited.';
    END IF;
    IF NEW.reclean_of_booking_id IS NULL THEN
      RAISE EXCEPTION 'Re-clean bookings must link to the original job (reclean_of_booking_id).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
