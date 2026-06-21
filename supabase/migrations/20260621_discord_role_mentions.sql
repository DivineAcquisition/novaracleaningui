-- Discord role mentions for internal notifications.
--
-- Pings one or more Discord roles (e.g. @Operations) on each notification by
-- adding the role mention to the message `content` plus an `allowed_mentions`
-- allowlist (so only the configured roles are pinged — never @everyone/users).
--
-- Configure the role id(s) — comma or space separated — with SQL:
--   update public.app_secrets set value = '1234567890,2345678901' where key = 'DISCORD_MENTION_ROLE_IDS';
-- (In Discord: Server Settings → Roles, or enable Developer Mode and
--  right-click the role → Copy Role ID.)
--
-- When DISCORD_MENTION_ROLE_IDS is empty, messages send with NO pings.

INSERT INTO public.app_secrets (key, value, description)
VALUES ('DISCORD_MENTION_ROLE_IDS', '', 'Comma/space-separated Discord role IDs to @mention on internal notifications (e.g. the Operations role). Empty = no pings.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notify_discord_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  webhook text;
  role_ids_raw text;
  role_ids text[];
  mention text := '';
  allowed jsonb := jsonb_build_object('parse', '[]'::jsonb); -- default: suppress all pings
  allow text[] := ARRAY[
    'booking.created','booking.status_change','booking.manually_assigned',
    'booking.cancelled','booking.completed','lead.created',
    'job.assignment.accepted','job.assignment.declined',
    'dispatch.no_cleaners_staff_alert','membership.created',
    'payout.completed','payout.failed','cleaner.status_changed'
  ];
  title text;
  emoji text;
  color int;
  fields jsonb := '[]'::jsonb;
  body jsonb;
BEGIN
  IF NEW.event_type IS NULL OR NOT (NEW.event_type = ANY(allow)) THEN
    RETURN NEW;
  END IF;

  SELECT value INTO webhook FROM public.app_secrets WHERE key = 'DISCORD_WEBHOOK_URL';
  IF webhook IS NULL OR length(btrim(webhook)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Resolve role mentions (if configured).
  SELECT value INTO role_ids_raw FROM public.app_secrets WHERE key = 'DISCORD_MENTION_ROLE_IDS';
  IF role_ids_raw IS NOT NULL AND length(btrim(role_ids_raw)) > 0 THEN
    role_ids := ARRAY(
      SELECT btrim(x) FROM unnest(regexp_split_to_array(role_ids_raw, '[\s,]+')) AS x
      WHERE btrim(x) ~ '^[0-9]+$'
    );
    IF array_length(role_ids, 1) >= 1 THEN
      SELECT string_agg('<@&' || rid || '>', ' ') INTO mention FROM unnest(role_ids) AS rid;
      allowed := jsonb_build_object('roles', to_jsonb(role_ids));
    END IF;
  END IF;

  CASE NEW.event_type
    WHEN 'booking.created'                  THEN emoji := '🎉'; title := 'New booking';            color := 3066993;
    WHEN 'booking.status_change'            THEN emoji := '🔄'; title := 'Booking status changed'; color := 3447003;
    WHEN 'booking.completed'                THEN emoji := '✅'; title := 'Booking completed';       color := 3066993;
    WHEN 'booking.cancelled'                THEN emoji := '🛑'; title := 'Booking cancelled';       color := 15158332;
    WHEN 'booking.manually_assigned'        THEN emoji := '🧹'; title := 'Booking assigned';        color := 3447003;
    WHEN 'lead.created'                     THEN emoji := '🌱'; title := 'New lead';                color := 1752220;
    WHEN 'job.assignment.accepted'          THEN emoji := '👍'; title := 'Cleaner accepted job';    color := 3066993;
    WHEN 'job.assignment.declined'          THEN emoji := '👎'; title := 'Cleaner declined job';    color := 15105570;
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

  -- Role mention must live in top-level `content` to actually ping.
  IF mention <> '' THEN
    body := body || jsonb_build_object('content', mention);
  END IF;

  PERFORM net.http_post(
    url := webhook,
    body := body,
    headers := jsonb_build_object('Content-Type','application/json')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
