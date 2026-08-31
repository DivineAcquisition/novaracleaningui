-- ─── Scope adjustments: justified, documented price increases ────────────
--
-- When a job turns out materially different from what was booked (heavier
-- condition, post-event mess, appliance degreasing, bigger footprint), the
-- service agreement already allows the price to change. Until now that
-- happened ad hoc over text with no consistent justification and nothing on
-- file. This makes it a structured action:
--
--   * every increase maps to a defined reason (no arbitrary numbers)
--   * every increase points at the job's own condition photos as evidence
--   * an increase without photo evidence is FLAGGED and needs an explicit
--     written override — enforced here, not just in the UI
--   * the customer message that went out is archived on the record
--   * the cleaner is paid off the adjusted work value, never off whatever
--     the customer ended up being billed
--
-- Reasons live in their own table so ops can edit the wording, retire a
-- reason, or add one without a deploy.

-- ─── Reason catalogue (admin-editable) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scope_adjustment_reasons (
  code                  TEXT PRIMARY KEY,
  label                 TEXT NOT NULL,
  -- Objective, customer-defensible phrasing dropped into the justification
  -- message. Written as a noun phrase so several can be listed together.
  customer_phrase       TEXT NOT NULL,
  -- Candid framing for internal records only.
  internal_hint         TEXT,
  -- Occupancy is real and worth documenting, but leading a customer message
  -- with "you were home" reads as accusatory. Reasons flagged false are
  -- recorded on the adjustment and never surface in customer copy.
  customer_facing       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Which existing service tier this reason typically reclassifies toward.
  -- Must be a real pricing-engine tier so the suggested amount always comes
  -- out of the pricing model rather than being invented.
  suggests_service_type TEXT CHECK (suggests_service_type IN ('standard','deep','combo','moveInOut')),
  -- Customer-facing name for the reclassified service when the pricing tier
  -- alone undersells it (post-event work prices as Deep but reads better as
  -- "Post-Event Deep Clean").
  service_label_override TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 100,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.scope_adjustment_reasons
  (code, label, customer_phrase, internal_hint, customer_facing, suggests_service_type, service_label_override, sort_order)
VALUES
  ('heavy_condition', 'Heavy / Excessive Condition',
   'the home was in significantly heavier condition than a standard clean covers',
   'Soil or buildup well beyond a standard clean — reclassifies toward Deep.',
   TRUE, 'deep', NULL, 10),
  ('post_event', 'Post-Event / Party Cleaning',
   'post-event cleanup following a gathering, including catering mess and a large dish volume',
   'Cleanup after an event/party.',
   TRUE, 'deep', 'Post-Event Deep Clean', 20),
  ('appliance_deep', 'Appliance Deep Cleaning',
   'appliance degreasing and detailed appliance work beyond a standard clean',
   'Inside/out degreasing — oven, fryer, fridge interior.',
   TRUE, 'deep', NULL, 30),
  ('multi_level', 'Multi-Level / Layout',
   'a multi-level layout with stairs that adds significant labor beyond a single-level clean',
   'Stairs and multiple levels add real time.',
   TRUE, NULL, NULL, 40),
  ('larger_than_booked', 'Square Footage / Scope Larger Than Booked',
   'a property materially larger in size and scope than what was quoted',
   'Footprint or scope exceeded the booked band.',
   TRUE, NULL, NULL, 50),
  ('occupied_premises', 'Occupied / In-Use Premises',
   'occupants actively using the spaces being cleaned, which extended the job',
   'Internal context only — never lead the customer message with this.',
   FALSE, NULL, NULL, 60),
  ('added_scope', 'Added Scope / Add-Ons During Service',
   'additional work requested after the booking was placed',
   'Customer-requested additions mid-service.',
   TRUE, NULL, NULL, 70)
ON CONFLICT (code) DO NOTHING;

-- ─── The adjustment record ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scope_adjustments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- QC documentation row for the job, when one exists yet (it is created at
  -- completion). The adjustment IS the QC record for the price change.
  documentation_id          UUID REFERENCES public.job_documentation(id) ON DELETE SET NULL,

  -- Justification. At least one defined reason, always.
  reason_codes              TEXT[] NOT NULL,
  internal_note             TEXT,

  -- Original vs adjusted.
  original_service_type     TEXT,
  adjusted_service_type     TEXT,
  original_price_cents      INTEGER NOT NULL,
  adjusted_price_cents      INTEGER NOT NULL,
  delta_cents               INTEGER GENERATED ALWAYS AS (adjusted_price_cents - original_price_cents) STORED,

  -- What the pricing engine suggested, and the inputs it used, so the number
  -- can always be traced back to the pricing model.
  suggested_price_cents     INTEGER,
  pricing_basis             JSONB NOT NULL DEFAULT '{}'::jsonb,
  amount_overridden         BOOLEAN NOT NULL DEFAULT FALSE,
  override_note             TEXT,

  -- Photo evidence pulled from the job's own before/after sets.
  evidence_photos           JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_photo_count      INTEGER NOT NULL DEFAULT 0,
  evidence_missing          BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_override_note    TEXT,

  -- The customer justification message, exactly as sent.
  customer_message          TEXT,
  message_channels          TEXT[] NOT NULL DEFAULT '{}',
  message_sent_at           TIMESTAMPTZ,

  -- Cleaner pay is protected: it follows the adjusted work value and is
  -- never reduced by what the customer was ultimately billed.
  cleaner_payout_before_cents INTEGER,
  cleaner_payout_after_cents  INTEGER,
  payout_supplement_cents     INTEGER NOT NULL DEFAULT 0,
  payout_already_released     BOOLEAN NOT NULL DEFAULT FALSE,

  applied_by                UUID,
  applied_by_name           TEXT,
  applied_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status                    TEXT NOT NULL DEFAULT 'applied'
                              CHECK (status IN ('applied','disputed','resolved','reversed')),
  -- Disputes reuse the existing QC issue workflow rather than a parallel one.
  qc_issue_id               UUID REFERENCES public.qc_issues(id) ON DELETE SET NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An adjustment must always carry a justification.
  CONSTRAINT scope_adjustments_reason_required
    CHECK (array_length(reason_codes, 1) >= 1),
  -- No photo evidence is allowed only as an explicit, written override.
  CONSTRAINT scope_adjustments_evidence_or_override
    CHECK (evidence_photo_count > 0 OR COALESCE(btrim(evidence_override_note), '') <> ''),
  -- An off-suggestion amount must say why.
  CONSTRAINT scope_adjustments_override_note_required
    CHECK (NOT amount_overridden OR COALESCE(btrim(override_note), '') <> '')
);

CREATE INDEX IF NOT EXISTS scope_adjustments_booking_idx
  ON public.scope_adjustments (booking_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS scope_adjustments_applied_at_idx
  ON public.scope_adjustments (applied_at DESC);
CREATE INDEX IF NOT EXISTS scope_adjustments_status_idx
  ON public.scope_adjustments (status, applied_at DESC);
CREATE INDEX IF NOT EXISTS scope_adjustments_reasons_idx
  ON public.scope_adjustments USING GIN (reason_codes);
CREATE INDEX IF NOT EXISTS scope_adjustments_unsupported_idx
  ON public.scope_adjustments (evidence_missing, applied_at DESC)
  WHERE evidence_missing;

DROP TRIGGER IF EXISTS set_timestamp_scope_adjustments ON public.scope_adjustments;
CREATE TRIGGER set_timestamp_scope_adjustments
  BEFORE UPDATE ON public.scope_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_timestamp_scope_adjustment_reasons ON public.scope_adjustment_reasons;
CREATE TRIGGER set_timestamp_scope_adjustment_reasons
  BEFORE UPDATE ON public.scope_adjustment_reasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── RLS: admin/VA read; all writes go through the service-role route ────
ALTER TABLE public.scope_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scope_adjustment_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scope_adjustments_admin_read ON public.scope_adjustments;
CREATE POLICY scope_adjustments_admin_read ON public.scope_adjustments
  FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS scope_adjustment_reasons_admin_read ON public.scope_adjustment_reasons;
CREATE POLICY scope_adjustment_reasons_admin_read ON public.scope_adjustment_reasons
  FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS scope_adjustment_reasons_admin_write ON public.scope_adjustment_reasons;
CREATE POLICY scope_adjustment_reasons_admin_write ON public.scope_adjustment_reasons
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

COMMENT ON TABLE public.scope_adjustments IS
  'Documented, justified price increases on a booking. Every row carries defined reason(s), the pricing-engine basis for the amount, the job photos used as evidence, the customer message sent, and the protected cleaner payout.';
COMMENT ON TABLE public.scope_adjustment_reasons IS
  'Admin-editable justification categories for scope adjustments, with the customer-facing phrasing used to draft the notification.';
COMMENT ON COLUMN public.scope_adjustments.evidence_missing IS
  'True when the adjustment was applied without photo evidence — allowed only with a written override, and reported as unsupported.';
COMMENT ON COLUMN public.scope_adjustments.payout_supplement_cents IS
  'Extra pay owed to the crew when the payout had already been released at the old job value. Cleaner pay follows the work performed, never the billing outcome.';
