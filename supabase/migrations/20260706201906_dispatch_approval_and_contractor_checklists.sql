-- ─── Dispatch approval + contractor checklists + add-on approvals ──────────
--
-- Operator directive (2026-07-06):
--   1. Auto-dispatch no longer pings nearby cleaners directly. Every new job
--      lands in the admin Dispatch console as "Pending Approval" and the
--      dispatch Discord channel is notified that a cleaner needs to be
--      assigned. Offers only go out after an admin approves.
--   2. Contractors get a dedicated per-job checklist link (per clean type)
--      whose live progress relays to the Dispatch console. From that page
--      they can report add-ons they performed — those need admin approval in
--      the Dispatch console before the customer is charged (and before the
--      cleaner's pay visibly increases). Admin can disable contractor
--      add-ons entirely via a settings toggle.
--   3. Discord notifications are internal/admin-facing ONLY — cleaner role
--      pings are removed from every route.

-- ─── 1. app_settings — small admin-tunable feature switches ────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='app_settings_admin_all') THEN
    CREATE POLICY app_settings_admin_all ON public.app_settings FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='app_settings_service_role') THEN
    CREATE POLICY app_settings_service_role ON public.app_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

INSERT INTO public.app_settings (key, value, description) VALUES
  ('contractor_addons_enabled', 'true'::jsonb,
   'Allow contractors to request add-ons from their job checklist (requests still need admin approval before any charge).'),
  ('dispatch_auto_offers_enabled', 'false'::jsonb,
   'When false (default), every new job waits for admin approval in the Dispatch console before SMS offers go to cleaners.')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. job_checklists — one live checklist per dispatched job ─────────────
CREATE TABLE IF NOT EXISTS public.job_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  service_type text NOT NULL DEFAULT 'standard',
  token text NOT NULL UNIQUE,
  -- item_key -> { done, at, by } progress map (item keys are stable
  -- "<section-index>:<item-index>" ids from the contractor checklist spec)
  items jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_items integer NOT NULL DEFAULT 0,
  completed_items integer NOT NULL DEFAULT 0,
  progress_pct integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz,
  last_activity_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_checklists_job_idx ON public.job_checklists (job_id);
CREATE INDEX IF NOT EXISTS job_checklists_booking_idx ON public.job_checklists (booking_id);
ALTER TABLE public.job_checklists ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_checklists' AND policyname='job_checklists_admin_read') THEN
    CREATE POLICY job_checklists_admin_read ON public.job_checklists FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_checklists' AND policyname='job_checklists_service_role') THEN
    CREATE POLICY job_checklists_service_role ON public.job_checklists FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- ─── 3. job_addon_requests — contractor-reported add-ons awaiting review ───
CREATE TABLE IF NOT EXISTS public.job_addon_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  checklist_id uuid REFERENCES public.job_checklists(id) ON DELETE SET NULL,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  cleaner_name text,
  addon_id text NOT NULL,
  addon_label text,
  amount_cents integer NOT NULL DEFAULT 0,
  -- What the requesting cleaner's payout grows by if approved (visible pay bump)
  cleaner_share_cents integer NOT NULL DEFAULT 0,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  -- Outcome of the customer charge once approved: paid | invoiced | no_charge | failed
  charge_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_addon_requests_job_idx ON public.job_addon_requests (job_id, status);
CREATE INDEX IF NOT EXISTS job_addon_requests_status_idx ON public.job_addon_requests (status, created_at DESC);
ALTER TABLE public.job_addon_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_addon_requests' AND policyname='job_addon_requests_admin_all') THEN
    CREATE POLICY job_addon_requests_admin_all ON public.job_addon_requests FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_addon_requests' AND policyname='job_addon_requests_service_role') THEN
    CREATE POLICY job_addon_requests_service_role ON public.job_addon_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- ─── 4. Discord — internal admin-facing only + new dispatch events ─────────
-- Strip cleaner role pings from every route: Discord is an internal ops
-- channel now. Cleaners are reached via SMS/email only.
UPDATE public.discord_routes
  SET role_keys = ARRAY['DISCORD_ROLE_OPERATIONS']
  WHERE event_type IN ('job.available', 'dispatch.no_cleaners_staff_alert');

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('dispatch.approval_needed', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.addon.requested',      'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.addon.reviewed',       'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.checklist.completed',  'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- Definitive merged version of the routing trigger (the 20260621_discord_*
-- files each replaced this function and their lexical order didn't match
-- their feature order — this version supersedes all of them):
--   • routes via discord_routes + role_keys mentions
--   • rich job-detail fields via build_discord_job_fields (full address —
--     these channels are internal/staff only now)
--   • deep links point at the ADMIN console, never the contractor app
--   • titles for the new dispatch-approval / add-on / checklist events
CREATE OR REPLACE FUNCTION public.notify_discord_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  route public.discord_routes%ROWTYPE;
  webhook text;
  rk text;
  rid text;
  role_ids text[] := '{}';
  mention text := '';
  allowed jsonb := jsonb_build_object('parse', '[]'::jsonb);
  title text; emoji text; color int;
  fields jsonb := '[]'::jsonb;
  embed jsonb;
  body jsonb;
  final_link text := null;
BEGIN
  SELECT * INTO route FROM public.discord_routes WHERE event_type = NEW.event_type AND enabled;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT value INTO webhook FROM public.app_secrets WHERE key = route.webhook_key;
  IF webhook IS NULL OR length(btrim(webhook)) = 0 THEN
    SELECT value INTO webhook FROM public.app_secrets WHERE key = 'DISCORD_WEBHOOK_URL';
  END IF;
  IF webhook IS NULL OR length(btrim(webhook)) = 0 THEN RETURN NEW; END IF;

  FOREACH rk IN ARRAY route.role_keys LOOP
    SELECT value INTO rid FROM public.app_secrets WHERE key = rk;
    IF rid IS NOT NULL AND btrim(rid) ~ '^[0-9]+$' THEN role_ids := role_ids || btrim(rid); END IF;
  END LOOP;
  IF array_length(role_ids, 1) >= 1 THEN
    SELECT string_agg('<@&' || x || '>', ' ') INTO mention FROM unnest(role_ids) AS x;
    allowed := jsonb_build_object('roles', to_jsonb(role_ids));
  END IF;

  CASE NEW.event_type
    WHEN 'booking.created'                  THEN emoji := '🎉'; title := 'New booking';               color := 3066993;
    WHEN 'booking.status_change'            THEN emoji := '🔄'; title := 'Booking status changed';    color := 3447003;
    WHEN 'booking.completed'                THEN emoji := '✅'; title := 'Booking completed';          color := 3066993;
    WHEN 'booking.cancelled'                THEN emoji := '🛑'; title := 'Booking cancelled';          color := 15158332;
    WHEN 'booking.manually_assigned'        THEN emoji := '🧹'; title := 'Booking assigned';           color := 3447003;
    WHEN 'lead.created'                     THEN emoji := '🌱'; title := 'New lead';                   color := 1752220;
    WHEN 'job.available'                    THEN emoji := '📣'; title := 'Job needs staffing';         color := 15844367;
    WHEN 'job.assignment.accepted'          THEN emoji := '👍'; title := 'Cleaner accepted job';       color := 3066993;
    WHEN 'job.assignment.declined'          THEN emoji := '👎'; title := 'Cleaner declined job';       color := 15105570;
    WHEN 'job.status_change'                THEN emoji := '🔧'; title := 'Job status changed';         color := 3447003;
    WHEN 'dispatch.no_cleaners_staff_alert' THEN emoji := '🚨'; title := 'No cleaners available';      color := 15158332;
    WHEN 'dispatch.approval_needed'         THEN emoji := '🧭'; title := 'Cleaner needs to be assigned'; color := 16753920;
    WHEN 'job.addon.requested'              THEN emoji := '🧾'; title := 'Add-on approval needed';     color := 16753920;
    WHEN 'job.addon.reviewed'               THEN emoji := '🧾'; title := 'Add-on reviewed';            color := 3447003;
    WHEN 'job.checklist.completed'          THEN emoji := '🧽'; title := 'Job checklist completed';    color := 3066993;
    WHEN 'membership.created'               THEN emoji := '💎'; title := 'New membership';             color := 10181046;
    WHEN 'payout.completed'                 THEN emoji := '💸'; title := 'Payout sent';                color := 3066993;
    WHEN 'payout.failed'                    THEN emoji := '❌'; title := 'Payout failed';              color := 15158332;
    WHEN 'cleaner.status_changed'           THEN emoji := '👷'; title := 'Cleaner status changed';     color := 9807270;
    ELSE                                         emoji := '🔔'; title := NEW.event_type;               color := 5793266;
  END CASE;

  -- Rich job/booking detail fields. These notifications are staff-only, so
  -- the full address is always revealed.
  BEGIN
    fields := fields || public.build_discord_job_fields(NEW.booking_id, NEW.job_id, true);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- helper missing/failed: send the notification without detail fields
  END;

  IF NEW.zone IS NOT NULL AND length(btrim(NEW.zone)) > 0 THEN
    fields := fields || jsonb_build_array(jsonb_build_object('name','Zone','value',NEW.zone,'inline',true));
  END IF;
  IF NEW.source IS NOT NULL AND length(btrim(NEW.source)) > 0 THEN
    fields := fields || jsonb_build_array(jsonb_build_object('name','Source','value',NEW.source,'inline',true));
  END IF;

  -- Internal deep link: always the admin console (never the contractor app).
  IF NEW.event_type LIKE 'dispatch.%' OR NEW.event_type LIKE 'job.%' THEN
    final_link := 'https://admin.novaracleaning.com/admin/dispatch';
    IF NEW.job_id IS NOT NULL THEN
      final_link := final_link || '?job=' || NEW.job_id::text;
    END IF;
  ELSIF NEW.booking_id IS NOT NULL THEN
    final_link := 'https://admin.novaracleaning.com/admin/bookings?booking=' || NEW.booking_id::text;
  END IF;

  IF final_link IS NOT NULL THEN
    fields := fields || jsonb_build_array(jsonb_build_object(
      'name', '🔗 Admin',
      'value', '[Open in the admin console](' || final_link || ')',
      'inline', false
    ));
  END IF;

  embed := jsonb_build_object(
    'title', emoji || ' ' || title,
    'description', left(coalesce(NEW.summary, NEW.event_type), 1800),
    'color', color,
    'fields', fields,
    'footer', jsonb_build_object('text','Novara · internal · ' || NEW.event_type),
    'timestamp', to_char((coalesce(NEW.occurred_at, now()) AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  IF final_link IS NOT NULL THEN
    embed := embed || jsonb_build_object('url', final_link);
  END IF;

  body := jsonb_build_object(
    'username','Novara Ops',
    'allowed_mentions', allowed,
    'embeds', jsonb_build_array(embed)
  );
  IF mention <> '' THEN body := body || jsonb_build_object('content', mention); END IF;

  PERFORM net.http_post(url := webhook, body := body, headers := jsonb_build_object('Content-Type','application/json'));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- job.available copy was written for cleaners ("open the contractor app to
-- grab it") — reword to internal ops phrasing since Discord is staff-only.
CREATE OR REPLACE FUNCTION public.emit_job_available_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimable text[] := ARRAY['Offered','Broadcast','Dispatching'];
  loc text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (NEW.status = ANY(claimable)) OR (OLD.status = ANY(claimable)) THEN RETURN NEW; END IF;
  loc := btrim(COALESCE(NEW.city,'') || CASE WHEN NEW.state IS NOT NULL THEN ', ' || NEW.state ELSE '' END);
  INSERT INTO public.events (event_type, job_id, source, summary)
  VALUES ('job.available', NEW.id, 'system',
    COALESCE(NEW.service_type,'Clean') || ' in ' || COALESCE(NULLIF(loc,''),'service area')
    || CASE WHEN NEW.start_datetime IS NOT NULL THEN ' · ' || to_char(NEW.start_datetime AT TIME ZONE 'America/New_York','Mon DD, HH12:MI AM') ELSE '' END
    || ' — offers are out to cleaners. Track responses in the Dispatch console: https://admin.novaracleaning.com/admin/dispatch');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
