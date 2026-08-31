-- Multi-channel Discord routing + role mentions.
--
-- Routes each business event to a dedicated Discord channel (webhook) and
-- pings the responsible role(s). All webhooks + role IDs live in app_secrets
-- (kept out of git); the route table just references those keys, so routing
-- and pings are reconfigurable with plain SQL.
--
-- Channels: Dispatch, Completed Jobs, Available Jobs (unclaimed), Flag
-- (customer issues), Cleaners Ops, Revenue & Sales.
-- Roles: Operations, Retention, Sales, Foundation, Proven, Elite.

-- ─── Secret slots (values set out-of-band via SQL, not committed) ─────────
INSERT INTO public.app_secrets (key, value, description) VALUES
  ('DISCORD_WEBHOOK_DISPATCH','','Discord webhook: Dispatch (who is assigned + cleaner payout/details)'),
  ('DISCORD_WEBHOOK_COMPLETED','','Discord webhook: Completed Jobs'),
  ('DISCORD_WEBHOOK_AVAILABLE','','Discord webhook: Available/Unclaimed Jobs'),
  ('DISCORD_WEBHOOK_FLAG','','Discord webhook: Customer issue flags'),
  ('DISCORD_WEBHOOK_CLEANERS','','Discord webhook: Cleaner ops (good/bad)'),
  ('DISCORD_WEBHOOK_REVENUE','','Discord webhook: Revenue & Sales'),
  ('DISCORD_ROLE_OPERATIONS','','Discord role id: Operations'),
  ('DISCORD_ROLE_RETENTION','','Discord role id: Retention'),
  ('DISCORD_ROLE_SALES','','Discord role id: Sales'),
  ('DISCORD_ROLE_FOUNDATION','','Discord role id: Foundation cleaners'),
  ('DISCORD_ROLE_PROVEN','','Discord role id: Proven cleaners'),
  ('DISCORD_ROLE_ELITE','','Discord role id: Elite cleaners')
ON CONFLICT (key) DO NOTHING;

-- ─── Route table: event_type → channel webhook key + role keys ────────────
CREATE TABLE IF NOT EXISTS public.discord_routes (
  event_type text PRIMARY KEY,
  webhook_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE public.discord_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read discord_routes" ON public.discord_routes;
CREATE POLICY "admins read discord_routes" ON public.discord_routes
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('booking.created','DISCORD_WEBHOOK_REVENUE', ARRAY['DISCORD_ROLE_SALES']),
  ('membership.created','DISCORD_WEBHOOK_REVENUE', ARRAY['DISCORD_ROLE_SALES']),
  ('lead.created','DISCORD_WEBHOOK_REVENUE', ARRAY['DISCORD_ROLE_SALES']),
  ('payout.completed','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('payout.failed','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('booking.manually_assigned','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.assignment.accepted','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.status_change','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('booking.status_change','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('booking.completed','DISCORD_WEBHOOK_COMPLETED', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('job.available','DISCORD_WEBHOOK_AVAILABLE', ARRAY['DISCORD_ROLE_OPERATIONS','DISCORD_ROLE_FOUNDATION','DISCORD_ROLE_PROVEN','DISCORD_ROLE_ELITE']),
  ('dispatch.no_cleaners_staff_alert','DISCORD_WEBHOOK_AVAILABLE', ARRAY['DISCORD_ROLE_OPERATIONS','DISCORD_ROLE_FOUNDATION','DISCORD_ROLE_PROVEN','DISCORD_ROLE_ELITE']),
  ('booking.cancelled','DISCORD_WEBHOOK_FLAG', ARRAY['DISCORD_ROLE_RETENTION']),
  ('job.assignment.declined','DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.status_changed','DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── Routing trigger on public.events ─────────────────────────────────────
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
  body jsonb;
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
    WHEN 'booking.created'                  THEN emoji := '🎉'; title := 'New booking';            color := 3066993;
    WHEN 'booking.status_change'            THEN emoji := '🔄'; title := 'Booking status changed'; color := 3447003;
    WHEN 'booking.completed'                THEN emoji := '✅'; title := 'Booking completed';       color := 3066993;
    WHEN 'booking.cancelled'                THEN emoji := '🛑'; title := 'Booking cancelled';       color := 15158332;
    WHEN 'booking.manually_assigned'        THEN emoji := '🧹'; title := 'Booking assigned';        color := 3447003;
    WHEN 'lead.created'                     THEN emoji := '🌱'; title := 'New lead';                color := 1752220;
    WHEN 'job.available'                    THEN emoji := '📣'; title := 'Job available to claim';  color := 15844367;
    WHEN 'job.assignment.accepted'          THEN emoji := '👍'; title := 'Cleaner accepted job';    color := 3066993;
    WHEN 'job.assignment.declined'          THEN emoji := '👎'; title := 'Cleaner declined job';    color := 15105570;
    WHEN 'job.status_change'                THEN emoji := '🔧'; title := 'Job status changed';      color := 3447003;
    WHEN 'dispatch.no_cleaners_staff_alert' THEN emoji := '🚨'; title := 'No cleaners available';   color := 15158332;
    WHEN 'membership.created'               THEN emoji := '💎'; title := 'New membership';          color := 10181046;
    WHEN 'payout.completed'                 THEN emoji := '💸'; title := 'Payout sent';             color := 3066993;
    WHEN 'payout.failed'                    THEN emoji := '❌'; title := 'Payout failed';           color := 15158332;
    WHEN 'cleaner.status_changed'           THEN emoji := '👷'; title := 'Cleaner status changed';  color := 9807270;
    ELSE                                         emoji := '🔔'; title := NEW.event_type;            color := 5793266;
  END CASE;

  IF NEW.zone IS NOT NULL AND length(btrim(NEW.zone)) > 0 THEN
    fields := fields || jsonb_build_array(jsonb_build_object('name','Zone','value',NEW.zone,'inline',true));
  END IF;
  IF NEW.source IS NOT NULL AND length(btrim(NEW.source)) > 0 THEN
    fields := fields || jsonb_build_array(jsonb_build_object('name','Source','value',NEW.source,'inline',true));
  END IF;

  body := jsonb_build_object(
    'username','Novara Ops',
    'allowed_mentions', allowed,
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', emoji || ' ' || title,
      'description', left(coalesce(NEW.summary, NEW.event_type), 1800),
      'color', color,
      'fields', fields,
      'footer', jsonb_build_object('text','Novara · ' || NEW.event_type),
      'timestamp', to_char((coalesce(NEW.occurred_at, now()) AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  );
  IF mention <> '' THEN body := body || jsonb_build_object('content', mention); END IF;

  PERFORM net.http_post(url := webhook, body := body, headers := jsonb_build_object('Content-Type','application/json'));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ─── Emit booking.completed / booking.cancelled on bookings status changes ─
-- These let the Completed Jobs + Flag channels work via the DB alone, without
-- depending on the edge functions that may not be deployed.
CREATE OR REPLACE FUNCTION public.emit_booking_lifecycle_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref text;
  amt numeric;
  who text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  ref := COALESCE('NOV-' || lpad(NEW.booking_number::text, 5, '0'), 'Booking');
  who := btrim(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,''));
  amt := COALESCE(NEW.final_charge_cents, NEW.total_estimate_cents, 0) / 100.0;

  IF NEW.status = 'completed' THEN
    INSERT INTO public.events (event_type, booking_id, source, summary)
    VALUES ('booking.completed', NEW.id, 'system',
      ref || ' — ' || who || ' · ' || COALESCE(NEW.service_type,'clean') || ' completed ($' || to_char(amt,'FM999990.00') || ')');
  ELSIF NEW.status = 'cancelled' THEN
    INSERT INTO public.events (event_type, booking_id, source, summary)
    VALUES ('booking.cancelled', NEW.id, 'system',
      ref || ' — ' || who || ' · ' || COALESCE(NEW.service_type,'clean') || ' on ' || COALESCE(NEW.service_date::text,'TBD') || ' cancelled'
      || CASE WHEN NEW.cancel_reason IS NOT NULL THEN ' (' || NEW.cancel_reason || ')' ELSE '' END);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_booking_lifecycle ON public.bookings;
CREATE TRIGGER trg_emit_booking_lifecycle
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.emit_booking_lifecycle_event();

-- ─── Emit job.available when a job becomes claimable (Offered/Broadcast) ───
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
    '📣 ' || COALESCE(NEW.service_type,'Clean') || ' in ' || COALESCE(NULLIF(loc,''),'your area')
    || CASE WHEN NEW.start_datetime IS NOT NULL THEN ' · ' || to_char(NEW.start_datetime AT TIME ZONE 'America/New_York','Mon DD, HH12:MI AM') ELSE '' END
    || ' — first to claim wins. Open the contractor app to grab it.');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_job_available ON public.jobs;
CREATE TRIGGER trg_emit_job_available
AFTER UPDATE OF status ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.emit_job_available_event();
