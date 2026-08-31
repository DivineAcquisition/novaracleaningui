-- Make cleaner links deep-link to the specific job/booking (or a token).
--
-- The route's cleaner_link is now a BASE url; the trigger appends the event's
-- identifier so the cleaner lands on the exact item:
--   • event carries a token in data (response_token/token) → tokenized
--     offer deep link  /cleaner/job-offer/<token>
--   • else event has job_id   → <base>?job=<job_id>
--   • else event has booking_id → <base>?booking=<booking_id>
-- These ids/tokens preserve which job/booking the notification is about so
-- the contractor app can open it directly.

CREATE OR REPLACE FUNCTION public.notify_discord_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  route public.discord_routes%ROWTYPE;
  webhook text; rk text; rid text;
  role_ids text[] := '{}';
  mention text := '';
  allowed jsonb := jsonb_build_object('parse', '[]'::jsonb);
  title text; emoji text; color int;
  fields jsonb := '[]'::jsonb;
  embed jsonb;
  body jsonb;
  base_link text;
  final_link text := null;
  link_token text := null;
  sep text;
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

  -- Build the deep link: token > job_id > booking_id, appended to the base.
  base_link := route.cleaner_link;
  IF NEW.data IS NOT NULL THEN
    link_token := COALESCE(NEW.data->>'response_token', NEW.data->>'token');
  END IF;
  IF base_link IS NOT NULL AND length(btrim(base_link)) > 0 THEN
    sep := CASE WHEN position('?' in base_link) > 0 THEN '&' ELSE '?' END;
    IF link_token IS NOT NULL AND length(btrim(link_token)) > 0 THEN
      final_link := 'https://contractor.novaracleaning.com/cleaner/job-offer/' || link_token;
    ELSIF NEW.job_id IS NOT NULL THEN
      final_link := base_link || sep || 'job=' || NEW.job_id::text;
    ELSIF NEW.booking_id IS NOT NULL THEN
      final_link := base_link || sep || 'booking=' || NEW.booking_id::text;
    ELSE
      final_link := base_link;
    END IF;
  END IF;

  IF final_link IS NOT NULL THEN
    fields := fields || jsonb_build_array(jsonb_build_object(
      'name', '🔗 Cleaner link',
      'value', CASE
        WHEN NEW.event_type IN ('job.available','dispatch.no_cleaners_staff_alert')
          THEN '[Open & claim this job](' || final_link || ')'
        ELSE '[Open this in the contractor app](' || final_link || ')'
      END,
      'inline', false
    ));
  END IF;

  embed := jsonb_build_object(
    'title', emoji || ' ' || title,
    'description', left(coalesce(NEW.summary, NEW.event_type), 1800),
    'color', color,
    'fields', fields,
    'footer', jsonb_build_object('text','Novara · ' || NEW.event_type),
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
