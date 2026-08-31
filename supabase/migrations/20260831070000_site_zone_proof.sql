-- Zone-based proof of completion.
--
-- Named zones live on business_sites.photo_zones (already jsonb). This
-- migration:
--   1. Aligns the zone threshold with the walkthrough threshold by default
--      (still independently adjustable).
--   2. Stores the map captured at walkthrough on the walkthrough row.
--   3. Stores Crew Lead zone completion on the job checklist.
--   4. Lets a QC case / reclean name the zone it concerns.
--   5. Records incomplete-zone follow-ups so a partial close is never silent.

-- ─── 1. Threshold: same default as walkthrough, independently adjustable ───
UPDATE public.app_settings
SET value = jsonb_set(
      jsonb_set(
        COALESCE(value, '{}'::jsonb),
        '{photo_zone_threshold_sqft}',
        to_jsonb(
          COALESCE(
            NULLIF((value ->> 'zone_threshold_sqft')::int, 0),
            NULLIF((value ->> 'walkthrough_threshold_sqft')::int, 0),
            5000
          )
        ),
        true
      ),
      '{zone_threshold_sqft}',
      to_jsonb(
        COALESCE(
          NULLIF((value ->> 'zone_threshold_sqft')::int, 0),
          NULLIF((value ->> 'photo_zone_threshold_sqft')::int, 0),
          NULLIF((value ->> 'walkthrough_threshold_sqft')::int, 0),
          5000
        )
      ),
      true
    ),
    updated_at = now()
WHERE key = 'commercial_pricing_settings';

-- ─── 2. Walkthrough captures the map; checklist stores the close ───────────
ALTER TABLE public.commercial_walkthroughs
  ADD COLUMN IF NOT EXISTS photo_zones jsonb;

COMMENT ON COLUMN public.commercial_walkthroughs.photo_zones IS
  'Zone map captured on this visit. Copied onto business_sites.photo_zones on conduct; a re-walkthrough may replace it.';

ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS zone_completion jsonb;

COMMENT ON COLUMN public.job_checklists.zone_completion IS
  'Crew Lead close: [{zoneId, name, status: complete|partial|not_done, note, by, at}]. Required for every named zone before the job can close.';

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS zone_id text,
  ADD COLUMN IF NOT EXISTS zone_name text;

COMMENT ON COLUMN public.qc_issues.zone_name IS
  'When the job is on a zone-eligible site, the named zone this case concerns (Loading Dock, not the whole facility).';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reclean_zones jsonb;

COMMENT ON COLUMN public.bookings.reclean_zones IS
  'On a targeted reclean of a zone-eligible site, the zone names the follow-up is scoped to. Stamped onto photo_zones so the checklist is those zones only.';

-- ─── 3. Follow-ups for partial / not-done zones ────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_zone_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  zone_id text,
  zone_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('partial', 'not_done')),
  note text,
  customer_message text,
  customer_notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_zone_followups_booking_idx
  ON public.job_zone_followups (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_zone_followups_site_open_idx
  ON public.job_zone_followups (business_site_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.job_zone_followups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_zone_followups'
      AND policyname = 'job_zone_followups_admin_read'
  ) THEN
    CREATE POLICY job_zone_followups_admin_read
      ON public.job_zone_followups FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_zone_followups'
      AND policyname = 'job_zone_followups_service_role'
  ) THEN
    CREATE POLICY job_zone_followups_service_role
      ON public.job_zone_followups FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON public.job_zone_followups TO authenticated;
GRANT ALL ON public.job_zone_followups TO service_role;

-- ─── 4. Normalize legacy string arrays on sites into {id,name,description} ─
UPDATE public.business_sites
SET photo_zones = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', btrim(elem #>> '{}'),
      'description', ''
    )
  )
  FROM jsonb_array_elements(photo_zones) AS elem
  WHERE jsonb_typeof(elem) = 'string' AND btrim(elem #>> '{}') <> ''
)
WHERE photo_zones IS NOT NULL
  AND jsonb_typeof(photo_zones) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(photo_zones) e
    WHERE jsonb_typeof(e) = 'string'
  );

COMMENT ON COLUMN public.business_sites.photo_zones IS
  'Standing zone map for this site: [{id, name, description}]. Defined at walkthrough, editable by admin, reused on every visit. Empty/null = site is below the zone threshold and uses a single before/after pair.';

-- ─── 5. Discord: incomplete zones are an operations event ──────────────────
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('job.zone.incomplete', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.zone.confirmed',  'DISCORD_WEBHOOK_COMPLETED', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

NOTIFY pgrst, 'reload schema';
