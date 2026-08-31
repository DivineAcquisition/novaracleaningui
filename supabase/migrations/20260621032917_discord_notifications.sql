-- Internal Discord team notifications.
--
-- Posts a curated set of business events from public.events to a Discord
-- incoming webhook via pg_net — no per-function redeploys needed, since the
-- whole app already records these events. The webhook URL is read from
-- app_secrets (DISCORD_WEBHOOK_URL); set it with SQL (kept out of git):
--   update public.app_secrets set value = '<discord webhook url>' where key = 'DISCORD_WEBHOOK_URL';
--
-- Only high-signal event types fire (no SMS/GHL-sync noise). The trigger is
-- fire-and-forget: pg_net queues the POST asynchronously and any error is
-- swallowed so a notification failure can never block the event insert.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

INSERT INTO public.app_secrets (key, value, description)
VALUES ('DISCORD_WEBHOOK_URL', '', 'Discord incoming-webhook URL for internal team notifications. Consumed by trg_notify_discord_on_event + _shared/discord.ts.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notify_discord_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  webhook text;
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
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', emoji || ' ' || title,
      'description', left(coalesce(NEW.summary, NEW.event_type), 1800),
      'color', color,
      'fields', fields,
      'footer', jsonb_build_object('text','Novara · ' || NEW.event_type),
      'timestamp', to_char((coalesce(NEW.occurred_at, now()) AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  );

  PERFORM net.http_post(
    url := webhook,
    body := body,
    headers := jsonb_build_object('Content-Type','application/json')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification problem block the underlying event insert.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_discord_on_event ON public.events;
CREATE TRIGGER trg_notify_discord_on_event
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.notify_discord_on_event();
