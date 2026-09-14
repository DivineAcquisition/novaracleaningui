-- Facebook lead alerts (Discord + richer event payload).
--
-- New Facebook / Meta / Instagram leads already insert into public.leads.
-- The insert trigger wrote a generic lead.created event whose Discord
-- embed said "Source: pg_trigger" and never named the assigned VA.
-- This migration:
--   1. Detects Facebook-family sources
--   2. Emits lead.facebook.created (Revenue channel, @Sales + @Operations)
--   3. Puts the real source, phone, ZIP, score, and assigned VA on the event
--
-- Email to VAs/admins is sent from lead-intake (Resend), not this trigger.

CREATE OR REPLACE FUNCTION public.is_facebook_lead_source(src text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(src, '')) ~ '(fb_lead|facebook|^fb$|fb[-_ ]?ads|meta|instagram|ig_lead)'
$$;

INSERT INTO public.app_secrets (key, value, description) VALUES
  ('FACEBOOK_WEBHOOK_VERIFY_TOKEN', '', 'Meta Lead Ads webhook verify token (hub.verify_token) for lead-intake GET handshake.'),
  ('FACEBOOK_PAGE_ACCESS_TOKEN', '', 'Meta Page access token used by lead-intake to fetch Lead Ads form answers from Graph.'),
  ('FACEBOOK_APP_SECRET', '', 'Meta app secret. When set, lead-intake verifies X-Hub-Signature-256 on native Lead Ads POSTs.'),
  ('FACEBOOK_GRAPH_API_VERSION', 'v21.0', 'Graph API version for Lead Ads fetches.'),
  ('LEAD_ALERT_EMAILS', '', 'Optional extra emails (comma-separated) for new Facebook lead alerts, on top of every admin + VA.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('lead.facebook.created', 'DISCORD_WEBHOOK_REVENUE', ARRAY['DISCORD_ROLE_SALES', 'DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key,
      role_keys = EXCLUDED.role_keys,
      enabled = true;

CREATE OR REPLACE FUNCTION public.fan_out_lead_event() RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  va_name text;
  evt text := 'lead.created';
  who text;
  summary text;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF public.is_facebook_lead_source(NEW.source) THEN
        evt := 'lead.facebook.created';
      END IF;
      IF NEW.assigned_va_user_id IS NOT NULL THEN
        SELECT display_name INTO va_name
        FROM public.va_assignments
        WHERE va_user_id = NEW.assigned_va_user_id;
      END IF;
      who := btrim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''));
      summary := CASE WHEN evt = 'lead.facebook.created' THEN 'New Facebook lead — ' ELSE 'New lead — ' END
        || coalesce(nullif(who, ''), 'unknown')
        || CASE WHEN NEW.zip_code IS NOT NULL AND length(btrim(NEW.zip_code)) > 0 THEN ' · ' || NEW.zip_code ELSE '' END
        || CASE WHEN NEW.phone IS NOT NULL AND length(btrim(NEW.phone)) > 0 THEN ' · ' || NEW.phone ELSE '' END
        || CASE WHEN va_name IS NOT NULL THEN ' · assigned to ' || va_name ELSE '' END;
      INSERT INTO public.events (event_type, lead_id, source, summary, data)
      VALUES (
        evt,
        NEW.id,
        coalesce(nullif(btrim(NEW.source), ''), 'lead'),
        summary,
        jsonb_build_object(
          'source', NEW.source,
          'zip', NEW.zip_code,
          'phone', NEW.phone,
          'email', NEW.email,
          'lead_score', NEW.lead_score,
          'assigned_va', va_name,
          'service_type', NEW.service_type
        )
      );
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.events (event_type, lead_id, source, summary, data)
      VALUES (
        'lead.status_change',
        NEW.id,
        coalesce(nullif(btrim(NEW.source), ''), 'lead'),
        'Lead ' || coalesce(NEW.first_name, '') || ' — ' || coalesce(OLD.status, '?') || ' → ' || coalesce(NEW.status, '?'),
        jsonb_build_object('from', OLD.status, 'to', NEW.status, 'source', NEW.source)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

-- Definitive notify_discord_on_event as of 2026-07-06, plus Facebook lead
-- title/fields and an Internal Booking deep link for lead events.
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
  facebook boolean := false;
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

  facebook := public.is_facebook_lead_source(NEW.source)
    OR public.is_facebook_lead_source(NEW.data->>'source');

  CASE NEW.event_type
    WHEN 'booking.created'                  THEN emoji := '🎉'; title := 'New booking';               color := 3066993;
    WHEN 'booking.status_change'            THEN emoji := '🔄'; title := 'Booking status changed';    color := 3447003;
    WHEN 'booking.completed'                THEN emoji := '✅'; title := 'Booking completed';          color := 3066993;
    WHEN 'booking.cancelled'                THEN emoji := '🛑'; title := 'Booking cancelled';          color := 15158332;
    WHEN 'booking.manually_assigned'        THEN emoji := '🧹'; title := 'Booking assigned';           color := 3447003;
    WHEN 'lead.created'                     THEN
      IF facebook THEN
        emoji := '📣'; title := 'New Facebook lead'; color := 1752220;
      ELSE
        emoji := '🌱'; title := 'New lead'; color := 1752220;
      END IF;
    WHEN 'lead.facebook.created'            THEN emoji := '📣'; title := 'New Facebook lead';         color := 1752220;
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
  IF NEW.source IS NOT NULL AND length(btrim(NEW.source)) > 0 AND NEW.source <> 'pg_trigger' THEN
    fields := fields || jsonb_build_array(jsonb_build_object('name','Source','value',NEW.source,'inline',true));
  END IF;

  IF NEW.event_type IN ('lead.created', 'lead.facebook.created') THEN
    IF NEW.data ? 'phone' AND length(btrim(coalesce(NEW.data->>'phone', ''))) > 0 THEN
      fields := fields || jsonb_build_array(jsonb_build_object('name','Phone','value',NEW.data->>'phone','inline',true));
    END IF;
    IF NEW.data ? 'email' AND length(btrim(coalesce(NEW.data->>'email', ''))) > 0 THEN
      fields := fields || jsonb_build_array(jsonb_build_object('name','Email','value',NEW.data->>'email','inline',true));
    END IF;
    IF NEW.data ? 'zip' AND length(btrim(coalesce(NEW.data->>'zip', ''))) > 0 THEN
      fields := fields || jsonb_build_array(jsonb_build_object('name','ZIP','value',NEW.data->>'zip','inline',true));
    END IF;
    IF NEW.data ? 'lead_score' AND length(btrim(coalesce(NEW.data->>'lead_score', ''))) > 0 THEN
      fields := fields || jsonb_build_array(jsonb_build_object('name','Score','value',NEW.data->>'lead_score','inline',true));
    END IF;
    IF NEW.data ? 'assigned_va' AND length(btrim(coalesce(NEW.data->>'assigned_va', ''))) > 0 THEN
      fields := fields || jsonb_build_array(jsonb_build_object('name','Assigned VA','value',NEW.data->>'assigned_va','inline',true));
    END IF;
  END IF;

  -- Internal deep link: always the admin console (never the contractor app).
  IF NEW.event_type LIKE 'dispatch.%' OR NEW.event_type LIKE 'job.%' THEN
    final_link := 'https://admin.novaracleaning.com/admin/dispatch';
    IF NEW.job_id IS NOT NULL THEN
      final_link := final_link || '?job=' || NEW.job_id::text;
    END IF;
  ELSIF NEW.booking_id IS NOT NULL THEN
    final_link := 'https://admin.novaracleaning.com/admin/bookings?booking=' || NEW.booking_id::text;
  ELSIF NEW.lead_id IS NOT NULL THEN
    final_link := 'https://admin.novaracleaning.com/admin/csr';
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
