-- Enrich Discord notifications with cleaner-relevant job details.
--
-- Looks up the linked booking/job and adds embed fields: service, when
-- (date + arrival window), est. time, home (BR/BA/sqft), est. pay, location,
-- customer first name, and access notes. The full street address is only
-- revealed for assigned jobs — unclaimed/broadcast jobs show city/ZIP only
-- (privacy until a cleaner claims it).

CREATE OR REPLACE FUNCTION public.build_discord_job_fields(
  p_booking_id uuid,
  p_job_id uuid,
  reveal_address boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  j public.jobs%ROWTYPE;
  have_b boolean := false;
  have_j boolean := false;
  f jsonb := '[]'::jsonb;
  date_label text; window_label text; loc text; home text; svc text;
  dur numeric; pay int;
BEGIN
  IF p_booking_id IS NOT NULL THEN
    SELECT * INTO b FROM public.bookings WHERE id = p_booking_id; have_b := FOUND;
  ELSIF p_job_id IS NOT NULL THEN
    SELECT * INTO b FROM public.bookings WHERE job_id = p_job_id ORDER BY created_at DESC LIMIT 1; have_b := FOUND;
  END IF;
  IF p_job_id IS NOT NULL THEN
    SELECT * INTO j FROM public.jobs WHERE id = p_job_id; have_j := FOUND;
  ELSIF have_b AND b.job_id IS NOT NULL THEN
    SELECT * INTO j FROM public.jobs WHERE id = b.job_id; have_j := FOUND;
  END IF;

  IF NOT have_b AND NOT have_j THEN RETURN f; END IF;

  -- Service
  svc := COALESCE(CASE WHEN have_b THEN b.service_type END, CASE WHEN have_j THEN j.service_type END);
  IF svc IS NOT NULL THEN
    f := f || jsonb_build_array(jsonb_build_object('name','Service','value', initcap(replace(svc,'_',' ')), 'inline', true));
  END IF;

  -- When (date + arrival window)
  date_label := CASE
    WHEN have_b AND b.service_date IS NOT NULL THEN to_char(b.service_date,'Dy, Mon DD')
    WHEN have_j AND j.start_datetime IS NOT NULL THEN to_char(j.start_datetime AT TIME ZONE 'America/New_York','Dy, Mon DD')
    ELSE NULL END;
  IF have_b THEN
    window_label := CASE COALESCE(b.time_slot, b.arrival_window)
      WHEN '8-12' THEN '8:00 AM – 12:00 PM'
      WHEN '12-16' THEN '12:00 PM – 4:00 PM'
      WHEN '16-20' THEN '4:00 PM – 8:00 PM'
      ELSE COALESCE(b.time_slot, b.arrival_window) END;
  END IF;
  IF date_label IS NOT NULL THEN
    f := f || jsonb_build_array(jsonb_build_object('name','When','value', date_label || COALESCE(' · ' || window_label, ''), 'inline', true));
  END IF;

  -- Est. time
  dur := COALESCE(CASE WHEN have_b THEN b.estimated_duration_hours END, CASE WHEN have_j THEN j.duration_est_hours END);
  IF dur IS NOT NULL THEN
    f := f || jsonb_build_array(jsonb_build_object('name','Est. time','value', dur::text || ' hrs', 'inline', true));
  END IF;

  -- Home (BR / BA / sqft)
  home := '';
  IF COALESCE(CASE WHEN have_b THEN b.bedrooms END, CASE WHEN have_j THEN j.bedrooms END) IS NOT NULL THEN
    home := COALESCE(CASE WHEN have_b THEN b.bedrooms END, j.bedrooms)::text || ' BR';
  END IF;
  IF COALESCE(CASE WHEN have_b THEN b.bathrooms END, CASE WHEN have_j THEN j.bathrooms END) IS NOT NULL THEN
    home := home || CASE WHEN home <> '' THEN ' · ' ELSE '' END || COALESCE(CASE WHEN have_b THEN b.bathrooms END, j.bathrooms)::text || ' BA';
  END IF;
  IF COALESCE(CASE WHEN have_b THEN b.sqft END, CASE WHEN have_j THEN j.sq_ft END) IS NOT NULL THEN
    home := home || CASE WHEN home <> '' THEN ' · ' ELSE '' END || COALESCE(CASE WHEN have_b THEN b.sqft END, j.sq_ft)::text || ' sqft';
  END IF;
  IF home <> '' THEN
    f := f || jsonb_build_array(jsonb_build_object('name','Home','value', home, 'inline', true));
  END IF;

  -- Est. pay (cleaner)
  IF have_b AND COALESCE(b.cleaner_payout_cents,0) > 0 THEN
    pay := b.cleaner_payout_cents;
    f := f || jsonb_build_array(jsonb_build_object('name','Est. pay','value', '$' || to_char(pay/100.0,'FM999990.00'), 'inline', true));
  END IF;

  -- Location (full address only when revealed)
  IF reveal_address THEN
    loc := NULLIF(btrim(concat_ws(', ',
      COALESCE(CASE WHEN have_b THEN b.address END, CASE WHEN have_j THEN j.address END),
      COALESCE(CASE WHEN have_b THEN b.city END, CASE WHEN have_j THEN j.city END),
      COALESCE(CASE WHEN have_b THEN b.state END, CASE WHEN have_j THEN j.state END))), '');
    IF COALESCE(CASE WHEN have_b THEN b.zip_code END, CASE WHEN have_j THEN j.zip END) IS NOT NULL AND loc IS NOT NULL THEN
      loc := loc || ' ' || COALESCE(CASE WHEN have_b THEN b.zip_code END, j.zip);
    END IF;
  ELSE
    loc := NULLIF(btrim(concat_ws(', ',
      COALESCE(CASE WHEN have_b THEN b.city END, CASE WHEN have_j THEN j.city END),
      COALESCE(CASE WHEN have_b THEN b.state END, CASE WHEN have_j THEN j.state END))), '');
    IF COALESCE(CASE WHEN have_b THEN b.zip_code END, CASE WHEN have_j THEN j.zip END) IS NOT NULL THEN
      loc := COALESCE(loc || ' ', '') || COALESCE(CASE WHEN have_b THEN b.zip_code END, j.zip);
    END IF;
  END IF;
  IF loc IS NOT NULL AND loc <> '' THEN
    f := f || jsonb_build_array(jsonb_build_object('name', CASE WHEN reveal_address THEN 'Address' ELSE 'Area' END, 'value', loc, 'inline', false));
  END IF;

  -- Customer first name (privacy: first name only)
  IF have_b AND b.first_name IS NOT NULL AND length(btrim(b.first_name)) > 0 THEN
    f := f || jsonb_build_array(jsonb_build_object('name','Customer','value', b.first_name, 'inline', true));
  END IF;

  -- Access notes (useful for the cleaner)
  IF have_b AND b.access_notes IS NOT NULL AND length(btrim(b.access_notes)) > 0 THEN
    f := f || jsonb_build_array(jsonb_build_object('name','Access notes','value', left(b.access_notes, 300), 'inline', false));
  END IF;

  RETURN f;
EXCEPTION WHEN OTHERS THEN
  RETURN '[]'::jsonb;
END;
$$;

-- Trigger now folds the job-detail fields into every notification that has a
-- linked booking/job.
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
  reveal boolean;
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

  -- Job detail fields (full address only when not an open/unclaimed broadcast).
  reveal := NEW.event_type NOT IN ('job.available','dispatch.no_cleaners_staff_alert');
  fields := fields || public.build_discord_job_fields(NEW.booking_id, NEW.job_id, reveal);

  IF NEW.source IS NOT NULL AND length(btrim(NEW.source)) > 0 THEN
    fields := fields || jsonb_build_array(jsonb_build_object('name','Source','value',NEW.source,'inline',true));
  END IF;

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
