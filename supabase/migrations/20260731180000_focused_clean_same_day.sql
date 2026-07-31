-- ─── Focused / Single-Area Clean + Same-Day Service ───────────────────────
-- Adds booking columns for focused area scope, same-day upcharge /
-- acknowledgment / sourcing deadline, and seeds admin-tunable rates in
-- app_settings. No change to existing service_type CHECK constraints —
-- service_type is free text.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS focused_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_same_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS same_day_upcharge_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS same_day_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS same_day_sourcing_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS same_day_auto_refund_status TEXT,
  ADD COLUMN IF NOT EXISTS same_day_auto_refund_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS same_day_auto_refund_error TEXT;

-- Reuse bookings.condition_level (light|normal|heavy|severe) for focused
-- price multipliers as well as duration projections.

COMMENT ON COLUMN public.bookings.focused_areas IS
  'Focused/single-area clean selections: [{areaId, quantity}]. Empty for whole-home services.';
COMMENT ON COLUMN public.bookings.is_same_day IS
  'True when the customer booked for the same calendar day and paid the same-day upcharge.';
COMMENT ON COLUMN public.bookings.same_day_acknowledged_at IS
  'Timestamp the customer checked the no-guarantee disclosure before payment.';
COMMENT ON COLUMN public.bookings.same_day_sourcing_deadline_at IS
  'If still unassigned at this time, auto-cancel + full refund of whatever was charged.';

CREATE INDEX IF NOT EXISTS bookings_same_day_sourcing_idx
  ON public.bookings (same_day_sourcing_deadline_at)
  WHERE is_same_day = TRUE
    AND same_day_auto_refund_status IS NULL
    AND status IN ('confirmed', 'pending_assignment', 'assigned');

-- Tunable rates (ops can edit via app_settings without a deploy).
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'focused_same_day_settings',
  '{
    "areas": [
      {"id":"bathroom","label":"Bathroom","price":65,"quantity":false},
      {"id":"kitchen","label":"Kitchen","price":65,"quantity":false},
      {"id":"living","label":"Living / common area","price":65,"quantity":false},
      {"id":"other","label":"Other single area","price":65,"quantity":false},
      {"id":"bedroom","label":"Bedroom","price":50,"quantity":true}
    ],
    "minimum_dollars": 65,
    "multi_area_bundle_discount_percent": 0,
    "condition_multipliers": {"light":0.9,"normal":1.0,"heavy":1.25,"severe":1.5},
    "same_day_upcharge_dollars": 50,
    "same_day_cutoff": "14:00",
    "timezone": "America/New_York",
    "sourcing_deadline_minutes": 120,
    "same_day_upcharge_in_pay_basis": true,
    "disclosure_title": "Same-Day Service — Please Read",
    "disclosure_body": "Same-day cleans depend on cleaner availability and are **not guaranteed**. We''ll do everything we can to staff your clean today. If we''re unable to assign a cleaner, your booking will be canceled and you''ll receive a **full refund — including the same-day fee — automatically**. Nothing is required from you."
  }'::jsonb,
  'Focused/single-area flat rates, $65 minimum, condition multipliers, and same-day upcharge / cutoff / sourcing deadline / disclosure copy.'
)
ON CONFLICT (key) DO NOTHING;

-- Duration assumptions so schedule buffers have something to multiply for
-- focused cleans across every sqft band (actual hours still scale by area
-- count at booking time via estimated_duration_hours).
INSERT INTO public.service_duration_assumptions (service_type, home_size_id, base_hours)
SELECT 'focused', band.id, 1.5
FROM (VALUES
  ('0_999'), ('1000_1500'), ('1501_2000'), ('2001_2500'), ('2501_3000'),
  ('3001_3500'), ('3501_4000'), ('4001_4500'), ('4501_5000'), ('5000_plus')
) AS band(id)
ON CONFLICT (service_type, home_size_id) DO NOTHING;

-- Sweep every 5 minutes: auto-cancel + refund unfulfilled same-day bookings.
DO $$
DECLARE
  v_supabase_url text := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  v_service_role text;
  v_job_id bigint;
BEGIN
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'same-day-sourcing-deadline';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('same-day-sourcing-deadline'); END IF;

  PERFORM cron.schedule(
    'same-day-sourcing-deadline',
    '*/5 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/same-day-sourcing-deadline',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      v_service_role
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping same-day-sourcing-deadline cron scheduling: %', SQLERRM;
END $$;
