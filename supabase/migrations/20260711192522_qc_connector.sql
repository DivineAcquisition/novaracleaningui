-- ─── QC Connector: Commercial · Office · STR into the existing QC hub ────────
--
-- One hub, three sources. This wires every line of business into the EXISTING
-- QC & Documentation Hub — no parallel systems:
--   1. client_type tag on job_documentation + qc_issues (a tag, not a fork).
--   2. ensure_job_documentation() stamps the tag from bookings.booking_type.
--   3. The legacy STR turnover silo (turnover_requests) now documents into
--      the hub on completion — booking_id becomes nullable, keyed by
--      turnover_request_id instead.
--   4. Backfills for existing records.

-- ─── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.job_documentation
  ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'booking'
    CHECK (source_kind IN ('booking','turnover')),
  ADD COLUMN IF NOT EXISTS turnover_request_id uuid,
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'residential'
    CHECK (client_type IN ('residential','commercial','office','str'));
CREATE UNIQUE INDEX IF NOT EXISTS job_documentation_turnover_uniq
  ON public.job_documentation (turnover_request_id) WHERE turnover_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_documentation_client_type_idx
  ON public.job_documentation (client_type, completed_at DESC);

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'residential'
    CHECK (client_type IN ('residential','commercial','office','str'));

-- ─── 2. Booking → client_type mapping helper ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.booking_client_type(p_booking_type text, p_partner_details jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_booking_type = 'commercial' THEN 'commercial'
    WHEN p_booking_type = 'office' THEN 'office'
    WHEN p_booking_type = 'str_turnover' THEN 'str'
    WHEN p_booking_type = 'partnership' AND coalesce(p_partner_details->>'booking_type','') = 'str_turnover' THEN 'str'
    WHEN p_booking_type = 'partnership' THEN 'commercial'
    ELSE 'residential'
  END;
$fn$;

-- ─── 3. Recreate the booking documentation trigger with the tag ──────────────
CREATE OR REPLACE FUNCTION public.ensure_job_documentation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_documented boolean;
  v_client_type text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;

  v_before := to_jsonb(coalesce(NEW.before_photos, '{}'::text[]));
  v_after  := to_jsonb(coalesce(NEW.after_photos,  '{}'::text[]));
  v_documented := jsonb_array_length(v_before) > 0 AND jsonb_array_length(v_after) > 0;
  v_client_type := public.booking_client_type(NEW.booking_type, NEW.partner_details);

  INSERT INTO public.job_documentation (
    booking_id, job_id, booking_ref, client_name, client_email,
    service_type, service_date, address, before_photos, after_photos,
    photo_count, notes, completed_at, documented, client_type
  ) VALUES (
    NEW.id,
    NEW.job_id,
    CASE WHEN NEW.booking_number IS NOT NULL THEN 'NOV-' || lpad(NEW.booking_number::text, 5, '0') ELSE NULL END,
    nullif(btrim(coalesce(NEW.first_name,'') || ' ' || coalesce(NEW.last_name,'')), ''),
    NEW.email,
    NEW.service_type,
    NEW.service_date,
    nullif(btrim(concat_ws(', ', NEW.address, NEW.city, NEW.state) || ' ' || coalesce(NEW.zip_code,'')), ''),
    v_before,
    v_after,
    jsonb_array_length(v_before) + jsonb_array_length(v_after),
    nullif(btrim(concat_ws(E'\n', NEW.team_notes, NEW.issues_notes)), ''),
    coalesce(NEW.completed_at, now()),
    v_documented,
    v_client_type
  )
  ON CONFLICT (booking_id) DO UPDATE SET
    job_id        = coalesce(EXCLUDED.job_id, job_documentation.job_id),
    client_type   = EXCLUDED.client_type,
    before_photos = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.before_photos ELSE job_documentation.before_photos END,
    after_photos  = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.after_photos  ELSE job_documentation.after_photos  END,
    photo_count   = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.photo_count   ELSE job_documentation.photo_count   END,
    documented    = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.documented    ELSE job_documentation.documented    END,
    notes         = coalesce(EXCLUDED.notes, job_documentation.notes),
    completed_at  = coalesce(job_documentation.completed_at, EXCLUDED.completed_at),
    mirror_status = CASE
      WHEN job_documentation.photos_purged_at IS NOT NULL THEN job_documentation.mirror_status
      WHEN job_documentation.mirror_status = 'mirrored'
        AND EXCLUDED.photo_count > job_documentation.photo_count THEN 'pending'
      ELSE job_documentation.mirror_status
    END,
    updated_at    = now();

  RETURN NEW;
END;
$$;

-- (Unique constraint must tolerate NULL booking_id for turnover-sourced rows —
-- the original UNIQUE column constraint already does; ON CONFLICT keeps working.)

-- ─── 4. Legacy STR turnover silo → hub documentation on completion ───────────
CREATE OR REPLACE FUNCTION public.ensure_turnover_documentation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_prop record;
  v_host record;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;

  v_before := coalesce(NEW.before_photos, '[]'::jsonb);
  v_after  := coalesce(NEW.after_photos,  '[]'::jsonb);
  SELECT nickname, address INTO v_prop FROM public.properties WHERE id = NEW.property_id;
  SELECT name, email INTO v_host FROM public.hosts WHERE id = NEW.host_id;

  INSERT INTO public.job_documentation (
    booking_id, turnover_request_id, source_kind, client_type,
    booking_ref, client_name, client_email, service_type, service_date,
    address, before_photos, after_photos, photo_count, notes,
    completed_at, documented
  ) VALUES (
    NULL,
    NEW.id,
    'turnover',
    'str',
    'TURN-' || left(NEW.id::text, 8),
    coalesce(v_prop.nickname, 'STR unit') || coalesce(' — ' || v_host.name, ''),
    v_host.email,
    'turnover',
    NEW.requested_date,
    v_prop.address,
    v_before,
    v_after,
    jsonb_array_length(v_before) + jsonb_array_length(v_after),
    NEW.notes,
    now(),
    jsonb_array_length(v_before) > 0 AND jsonb_array_length(v_after) > 0
  )
  ON CONFLICT (turnover_request_id) WHERE turnover_request_id IS NOT NULL DO UPDATE SET
    before_photos = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.before_photos ELSE job_documentation.before_photos END,
    after_photos  = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.after_photos  ELSE job_documentation.after_photos  END,
    photo_count   = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.photo_count   ELSE job_documentation.photo_count   END,
    documented    = CASE WHEN job_documentation.photos_purged_at IS NULL THEN EXCLUDED.documented    ELSE job_documentation.documented    END,
    notes         = coalesce(EXCLUDED.notes, job_documentation.notes),
    mirror_status = CASE
      WHEN job_documentation.photos_purged_at IS NOT NULL THEN job_documentation.mirror_status
      WHEN job_documentation.mirror_status = 'mirrored'
        AND EXCLUDED.photo_count > job_documentation.photo_count THEN 'pending'
      ELSE job_documentation.mirror_status
    END,
    updated_at    = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- documentation capture must never block turnover completion
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_turnover_documentation ON public.turnover_requests;
CREATE TRIGGER trg_ensure_turnover_documentation
  AFTER INSERT OR UPDATE OF status, before_photos, after_photos ON public.turnover_requests
  FOR EACH ROW EXECUTE FUNCTION public.ensure_turnover_documentation();

-- ─── 5. Backfills ─────────────────────────────────────────────────────────────
-- Existing documentation rows: derive client_type from their bookings.
UPDATE public.job_documentation d
SET client_type = public.booking_client_type(b.booking_type, b.partner_details)
FROM public.bookings b
WHERE b.id = d.booking_id
  AND d.client_type = 'residential'
  AND public.booking_client_type(b.booking_type, b.partner_details) <> 'residential';

-- Existing issues: same derivation.
UPDATE public.qc_issues i
SET client_type = public.booking_client_type(b.booking_type, b.partner_details)
FROM public.bookings b
WHERE b.id = i.booking_id
  AND i.client_type = 'residential'
  AND public.booking_client_type(b.booking_type, b.partner_details) <> 'residential';

-- Completed turnovers from the last 90 days document into the hub now.
INSERT INTO public.job_documentation (
  booking_id, turnover_request_id, source_kind, client_type, booking_ref,
  client_name, client_email, service_type, service_date, address,
  before_photos, after_photos, photo_count, notes, completed_at, documented
)
SELECT
  NULL, tr.id, 'turnover', 'str', 'TURN-' || left(tr.id::text, 8),
  coalesce(p.nickname, 'STR unit') || coalesce(' — ' || h.name, ''),
  h.email, 'turnover', tr.requested_date, p.address,
  coalesce(tr.before_photos, '[]'::jsonb),
  coalesce(tr.after_photos, '[]'::jsonb),
  jsonb_array_length(coalesce(tr.before_photos, '[]'::jsonb)) + jsonb_array_length(coalesce(tr.after_photos, '[]'::jsonb)),
  tr.notes,
  coalesce(tr.requested_date::timestamptz, now()),
  jsonb_array_length(coalesce(tr.before_photos, '[]'::jsonb)) > 0 AND jsonb_array_length(coalesce(tr.after_photos, '[]'::jsonb)) > 0
FROM public.turnover_requests tr
LEFT JOIN public.properties p ON p.id = tr.property_id
LEFT JOIN public.hosts h ON h.id = tr.host_id
WHERE tr.status = 'completed'
  AND tr.requested_date > current_date - 90
ON CONFLICT (turnover_request_id) WHERE turnover_request_id IS NOT NULL DO NOTHING;
