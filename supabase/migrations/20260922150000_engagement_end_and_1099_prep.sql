-- Terminate Contractor vs Log Resignation.
-- engagement_end_action is the queryable record (terminated | resigned),
-- independent of the outbound notice. Year-end 1099 prep locks YTD and
-- flags the batch. It does not generate or send a 1099-NEC.
-- Accountability removal is unchanged and does not write these columns.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS engagement_end_action text
    CHECK (engagement_end_action IS NULL OR engagement_end_action IN ('terminated', 'resigned')),
  ADD COLUMN IF NOT EXISTS engagement_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS termination_basis text
    CHECK (termination_basis IS NULL OR termination_basis IN ('no_cause', 'for_cause', 'job_abandonment')),
  ADD COLUMN IF NOT EXISTS termination_ground text,
  ADD COLUMN IF NOT EXISTS termination_section text,
  ADD COLUMN IF NOT EXISTS ytd_earnings_cents_locked integer,
  ADD COLUMN IF NOT EXISTS ytd_earnings_year integer,
  ADD COLUMN IF NOT EXISTS ytd_earnings_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS ytd_earnings_source text,
  ADD COLUMN IF NOT EXISTS nec_1099_include boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nec_1099_batch_year integer,
  ADD COLUMN IF NOT EXISTS w9_status text
    CHECK (w9_status IS NULL OR w9_status IN ('complete', 'incomplete', 'missing')),
  ADD COLUMN IF NOT EXISTS w9_followup_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS w9_followup_flagged_at timestamptz;

CREATE INDEX IF NOT EXISTS cleaners_engagement_end_idx
  ON public.cleaners (engagement_end_action, engagement_ended_at)
  WHERE engagement_end_action IS NOT NULL;

CREATE INDEX IF NOT EXISTS cleaners_termination_basis_idx
  ON public.cleaners (termination_basis)
  WHERE termination_basis IS NOT NULL;

CREATE INDEX IF NOT EXISTS cleaners_nec_1099_batch_idx
  ON public.cleaners (nec_1099_batch_year)
  WHERE nec_1099_include;

ALTER TABLE public.cleaner_terminations
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'terminated',
  ADD COLUMN IF NOT EXISTS basis text,
  ADD COLUMN IF NOT EXISTS ground text,
  ADD COLUMN IF NOT EXISTS agreement_section text,
  ADD COLUMN IF NOT EXISTS sms_body text,
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_body text,
  ADD COLUMN IF NOT EXISTS ytd_earnings_cents integer,
  ADD COLUMN IF NOT EXISTS nec_1099_batch_year integer,
  ADD COLUMN IF NOT EXISTS w9_status text,
  ADD COLUMN IF NOT EXISTS w9_followup_required boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cleaner_terminations_action_check'
  ) THEN
    ALTER TABLE public.cleaner_terminations
      ADD CONSTRAINT cleaner_terminations_action_check
      CHECK (action IN ('terminated', 'resigned'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cleaner_terminations_action_idx
  ON public.cleaner_terminations (action, created_at DESC);

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'contractor_departure_notices',
  jsonb_build_object(
    'termination', jsonb_build_object(
      'subject', 'Your contractor engagement is terminated',
      'body', $term$Dear {{firstName}},

This confirms that your independent contractor engagement with NovaraCleaning is terminated effective {{effectiveDate}}.

Portal access and new job offers are closed. Any upcoming jobs assigned to you have been released. Final pay for completed work follows the normal payout schedule.

Please return any company property in your possession, per your Independent Contractor Agreement, Section 5.4.

Questions: {{operationsEmail}}

{{signoff}}$term$,
      'sms', 'Novara: Your contractor engagement is terminated effective {{effectiveDate}}. Portal access and new jobs are closed. Return company property per your Independent Contractor Agreement, Section 5.4. Questions: {{operationsEmail}}'
    ),
    'resignation', jsonb_build_object(
      'subject', 'We received your resignation',
      'body', $resign$Dear {{firstName}},

We received your resignation from your independent contractor engagement with NovaraCleaning, effective {{effectiveDate}}.

Portal access and new job offers are closed. Final pay for completed work follows the normal payout schedule.

Please return any company property in your possession, per your Independent Contractor Agreement, Section 5.4.

Questions: {{operationsEmail}}

{{signoff}}$resign$,
      'sms', 'Novara: We received your resignation effective {{effectiveDate}}. Portal access and new jobs are closed. Final pay follows the normal schedule. Return company property per your Independent Contractor Agreement, Section 5.4. Questions: {{operationsEmail}}'
    )
  ),
  'Admin-editable Terminate Contractor and Log Resignation notices. Placeholders: {{firstName}} {{effectiveDate}} {{signoff}} {{operationsEmail}}. Termination copy must include the word terminated. Resignation copy must not. Internal notes are never merged in. A failed override is not sent.'
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
