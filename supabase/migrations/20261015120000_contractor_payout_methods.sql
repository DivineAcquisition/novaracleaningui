-- Manual payout methods (Cash App, Zelle, Chime, and later ones) beside Stripe.
--
-- Stripe Connect and automatic payouts stay. A contractor can have one active
-- method. Manual methods are paid in a pay run and recorded on manual_payouts.
-- 1099 inclusion is a per-method flag the accountant sets. It is snapshotted
-- onto each payout. Changing the setting does not rewrite old rows.
-- Payout identifiers live on contractor_payout_profiles, not on cleaners, so
-- directory sync and logs do not pick them up.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS payout_method_code text,
  ADD COLUMN IF NOT EXISTS payout_method_status text;

ALTER TABLE public.manual_payouts
  ADD COLUMN IF NOT EXISTS payout_method_code text,
  ADD COLUMN IF NOT EXISTS counts_toward_own_1099 boolean,
  ADD COLUMN IF NOT EXISTS pay_run_line_id uuid,
  ADD COLUMN IF NOT EXISTS recorded_by uuid,
  ADD COLUMN IF NOT EXISTS confirmation_ref text,
  ADD COLUMN IF NOT EXISTS amount_sent_cents integer,
  ADD COLUMN IF NOT EXISTS recipient_name_displayed text,
  ADD COLUMN IF NOT EXISTS difference_reason text;

ALTER TABLE public.job_extra_pay
  ADD COLUMN IF NOT EXISTS payout_method_code text,
  ADD COLUMN IF NOT EXISTS counts_toward_own_1099 boolean;

CREATE TABLE IF NOT EXISTS public.contractor_payout_profiles (
  cleaner_id uuid PRIMARY KEY REFERENCES public.cleaners(id) ON DELETE CASCADE,
  method_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'on_hold')),
  -- Sensitive. Shown only on the contractor profile, the admin pay run, and the contractor record.
  identifier text,
  account_name text,
  acknowledgment_version_id text,
  acknowledgment_text text,
  acknowledged_at timestamptz,
  verified_at timestamptz,
  details_changed_at timestamptz,
  change_pending boolean NOT NULL DEFAULT false,
  pending_method_code text,
  pending_identifier text,
  pending_account_name text,
  pending_acknowledgment_version_id text,
  pending_acknowledgment_text text,
  pending_acknowledged_at timestamptz,
  verification_salt text,
  verification_code_hash text,
  verification_expires_at timestamptz,
  verification_channel text,
  confirm_details boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contractor_payout_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  old_method_code text,
  new_method_code text,
  old_identifier text,
  new_identifier text,
  old_account_name text,
  new_account_name text,
  changed_by uuid,
  changed_by_role text,
  verification_channel text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contractor_payout_changes_cleaner_idx
  ON public.contractor_payout_changes (cleaner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  scheduled_for date,
  off_cycle boolean NOT NULL DEFAULT false,
  created_by uuid,
  closed_by uuid,
  closed_at timestamptz,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_runs_status_idx ON public.pay_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pay_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_run_id uuid NOT NULL REFERENCES public.pay_runs(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id),
  method_code text NOT NULL,
  identifier text,
  account_name text,
  gross_cents integer NOT NULL DEFAULT 0,
  deduction_cents integer NOT NULL DEFAULT 0,
  amount_due_cents integer NOT NULL,
  amount_sent_cents integer,
  difference_reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'failed', 'reopened')),
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipient_name_displayed text,
  name_mismatch_note text,
  hold_released_at timestamptz,
  hold_released_by uuid,
  confirmation_ref text,
  screenshot_path text,
  paid_at timestamptz,
  paid_by uuid,
  failure_reason text,
  reopen_reason text,
  ledger_ref text,
  w9_legal_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_run_lines_run_idx ON public.pay_run_lines (pay_run_id, method_code);
CREATE UNIQUE INDEX IF NOT EXISTS pay_run_lines_ledger_ref_uniq
  ON public.pay_run_lines (ledger_ref)
  WHERE ledger_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pay_run_line_earnings (
  pay_run_line_id uuid NOT NULL REFERENCES public.pay_run_lines(id) ON DELETE CASCADE,
  earning_id text NOT NULL,
  amount_cents integer NOT NULL,
  job_id text,
  job_date date,
  kind text NOT NULL,
  reason text,
  section text,
  PRIMARY KEY (pay_run_line_id, earning_id)
);

-- One open or paid claim per earning. Failed lines delete their claims.
CREATE TABLE IF NOT EXISTS public.pay_run_earning_claims (
  earning_id text PRIMARY KEY,
  pay_run_line_id uuid NOT NULL REFERENCES public.pay_run_lines(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('open', 'paid'))
);

CREATE TABLE IF NOT EXISTS public.payout_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  section text NOT NULL DEFAULT '7.9',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'void')),
  pay_run_line_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payout_adjustments_cleaner_idx
  ON public.payout_adjustments (cleaner_id, status);

CREATE TABLE IF NOT EXISTS public.payout_outreach (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid,
  UNIQUE (cleaner_id, kind)
);

CREATE TABLE IF NOT EXISTS public.payout_reminders (
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cleaner_id, kind)
);

ALTER TABLE public.contractor_payout_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_payout_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_run_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_run_line_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_run_earning_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read payout profiles" ON public.contractor_payout_profiles;
CREATE POLICY "admin read payout profiles"
  ON public.contractor_payout_profiles FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "contractor reads own payout profile" ON public.contractor_payout_profiles;
CREATE POLICY "contractor reads own payout profile"
  ON public.contractor_payout_profiles FOR SELECT TO authenticated
  USING (cleaner_id IN (SELECT id FROM public.cleaners c WHERE c.user_id = auth.uid()));

DROP POLICY IF EXISTS "admin read payout changes" ON public.contractor_payout_changes;
CREATE POLICY "admin read payout changes"
  ON public.contractor_payout_changes FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "contractor reads own payout changes" ON public.contractor_payout_changes;
CREATE POLICY "contractor reads own payout changes"
  ON public.contractor_payout_changes FOR SELECT TO authenticated
  USING (cleaner_id IN (SELECT id FROM public.cleaners c WHERE c.user_id = auth.uid()));

DROP POLICY IF EXISTS "admin read pay runs" ON public.pay_runs;
CREATE POLICY "admin read pay runs"
  ON public.pay_runs FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admin read pay run lines" ON public.pay_run_lines;
CREATE POLICY "admin read pay run lines"
  ON public.pay_run_lines FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admin read pay run earnings" ON public.pay_run_line_earnings;
CREATE POLICY "admin read pay run earnings"
  ON public.pay_run_line_earnings FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admin read earning claims" ON public.pay_run_earning_claims;
CREATE POLICY "admin read earning claims"
  ON public.pay_run_earning_claims FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admin read payout adjustments" ON public.payout_adjustments;
CREATE POLICY "admin read payout adjustments"
  ON public.payout_adjustments FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admin read payout outreach" ON public.payout_outreach;
CREATE POLICY "admin read payout outreach"
  ON public.payout_outreach FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admin read payout reminders" ON public.payout_reminders;
CREATE POLICY "admin read payout reminders"
  ON public.payout_reminders FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

-- A verified manual method finishes the payout step. Stripe progress still does.
CREATE OR REPLACE FUNCTION public.mint_cleaner_setup_token(
  p_cleaner_id uuid,
  p_ttl_days integer DEFAULT 14
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
  v_agreement_ok boolean;
  v_phone_ok boolean;
  v_supplies_ok boolean;
  v_dress_ok boolean;
  v_job_day_ok boolean;
  v_training_ok boolean;
  v_payout_ok boolean;
  v_w9_ok boolean;
BEGIN
  SELECT
    COALESCE(ob_agreement_signed, false),
    COALESCE(phone_verified, false),
    (supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(ob_supplies_checklist_viewed, false)),
    (COALESCE(ob_dress_code_ack, false)
      OR COALESCE(ob_job_day_guides_ack, false)),
    COALESCE(ob_job_day_guides_ack, false),
    COALESCE(ob_training_complete, false),
    (COALESCE(payouts_enabled, false)
      OR COALESCE(ob_payouts_setup, false)
      OR (stripe_account_id IS NOT NULL AND btrim(stripe_account_id) <> '')
      OR payout_method_status = 'verified'),
    (w9_status = 'complete')
  INTO v_agreement_ok, v_phone_ok, v_supplies_ok, v_dress_ok, v_job_day_ok, v_training_ok, v_payout_ok, v_w9_ok
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_agreement_ok AND v_phone_ok AND v_supplies_ok AND v_dress_ok AND v_job_day_ok AND v_training_ok AND v_payout_ok AND v_w9_ok
  THEN RETURN NULL; END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.cleaners
    SET setup_token = v_token,
        setup_token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 14)) || ' days')::interval,
        setup_token_sent_at = now(),
        setup_token_sent_count = COALESCE(setup_token_sent_count, 0) + 1,
        updated_at = now()
    WHERE id = p_cleaner_id;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE VIEW public.cleaner_setup_status_v1 AS
SELECT
  c.id AS cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.email,
  c.phone,
  c.status,
  COALESCE(c.phone_verified, false) AS phone_verified,
  (COALESCE(c.payouts_enabled, false)
    OR COALESCE(c.ob_payouts_setup, false)
    OR (c.stripe_account_id IS NOT NULL AND btrim(c.stripe_account_id) <> '')) AS stripe_ready,
  (COALESCE(c.ob_agreement_signed, false)
    AND COALESCE(c.phone_verified, false)
    AND (c.supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(c.ob_supplies_checklist_viewed, false))
    AND (COALESCE(c.ob_dress_code_ack, false)
      OR COALESCE(c.ob_job_day_guides_ack, false))
    AND COALESCE(c.ob_job_day_guides_ack, false)
    AND COALESCE(c.ob_training_complete, false)
    AND (
      COALESCE(c.payouts_enabled, false)
      OR COALESCE(c.ob_payouts_setup, false)
      OR (c.stripe_account_id IS NOT NULL AND btrim(c.stripe_account_id) <> '')
      OR c.payout_method_status = 'verified'
    )
    AND c.w9_status = 'complete') AS setup_complete,
  c.setup_token IS NOT NULL
    AND (c.setup_token_expires_at IS NULL OR c.setup_token_expires_at > now()) AS link_outstanding,
  c.setup_token_sent_at,
  COALESCE(c.setup_token_sent_count, 0) AS link_sent_count,
  c.supply_checklist_submitted_at,
  c.supply_token_sent_at,
  COALESCE(c.supply_token_sent_count, 0) AS supply_link_sent_count,
  (c.supply_checklist_submitted_at IS NOT NULL
    OR COALESCE(c.ob_supplies_checklist_viewed, false)) AS supplies_submitted,
  COALESCE(c.ob_job_day_guides_ack, false) AS guides_acknowledged,
  c.ob_job_day_guides_ack_at AS guides_acknowledged_at,
  COALESCE(c.ob_agreement_signed, false) AS agreement_signed,
  COALESCE(c.ob_dress_code_ack, false) AS dress_code_agreed,
  COALESCE(c.ob_training_complete, false) AS training_complete,
  public.cleaner_ready_for_first_job(c.id) AS ready_for_first_job,
  (c.w9_status = 'complete') AS w9_on_file,
  (
    COALESCE(c.payouts_enabled, false)
    OR COALESCE(c.ob_payouts_setup, false)
    OR (c.stripe_account_id IS NOT NULL AND btrim(c.stripe_account_id) <> '')
    OR c.payout_method_status = 'verified'
  ) AS payout_ready
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_setup_status_v1 IS
  'Onboarding standing. The payout step is Stripe or a verified manual method. First-job eligibility still includes the W-9 and the videos.';

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'contractor_payout_methods',
  jsonb_build_object(
    'payRunWeekday', 5,
    'changeHoldHours', 48,
    'agingDays', 10,
    'reminderIntervalDays', 7,
    'activeAcknowledgmentId', 'ack-2026-10-15',
    'acknowledgmentVersions', jsonb_build_array(
      jsonb_build_object(
        'id', 'ack-2026-10-15',
        'text', 'I confirm these payout details are accurate, and that Novara is not responsible for payments sent to the details I provided.',
        'createdAt', '2026-10-15T00:00:00.000Z'
      )
    ),
    'methods', jsonb_build_array(
      jsonb_build_object('code','stripe','displayName','Stripe','enabled',true,'kind','stripe','recommended',true,'sortOrder',0,'identifierFormat','stripe','identifierLabel','Stripe account','contractorProvides','Finish Stripe Connect. Novara does not collect a bank number here.','instructions','Use the Stripe setup button. Stripe pays you automatically after a job is approved.','summary','Paid automatically after a job is approved.','countsTowardOwn1099',null),
      jsonb_build_object('code','cash_app','displayName','Cash App','enabled',true,'kind','manual','recommended',false,'sortOrder',1,'identifierFormat','cashtag','identifierLabel','$Cashtag','contractorProvides','The $Cashtag on the Cash App account.','instructions','Enter the $Cashtag exactly as Cash App shows it, and the name on that account.','summary','Paid weekly on Friday.','countsTowardOwn1099',null),
      jsonb_build_object('code','zelle','displayName','Zelle','enabled',true,'kind','manual','recommended',false,'sortOrder',2,'identifierFormat','email_or_phone','identifierLabel','Zelle email or mobile number','contractorProvides','The email or mobile number enrolled with Zelle.','instructions','Enter the email or mobile number that is enrolled with Zelle, and the name on that enrollment.','summary','Paid weekly on Friday.','countsTowardOwn1099',null),
      jsonb_build_object('code','chime','displayName','Chime','enabled',true,'kind','manual','recommended',false,'sortOrder',3,'identifierFormat','chime_sign','identifierLabel','$ChimeSign','contractorProvides','The $ChimeSign other Chime members use to pay you.','instructions','Enter your $ChimeSign. In the Chime app it is under Profile, then Personal Info. It starts with $.','summary','Paid weekly on Friday.','countsTowardOwn1099',null)
    )
  ),
  'Payout methods, pay run day, change hold, aging, reminders, and the acknowledgment. 1099 flags stay null until the accountant sets them.'
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
