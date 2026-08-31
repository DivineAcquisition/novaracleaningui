CREATE OR REPLACE FUNCTION public.partnership_comms_recipient_key(p_email text, p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(lower(btrim(p_email)), ''),
    NULLIF('tel:' || regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 'tel:')
  );
$$;

CREATE OR REPLACE FUNCTION public.partnership_comms_check(
  p_email text,
  p_phone text,
  p_channel text,
  p_priority text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings jsonb;
  v_tz text;
  v_start time;
  v_end time;
  v_local timestamp;
  v_local_time time;
  v_in_quiet boolean := false;
  v_cap int;
  v_hours int;
  v_key text;
  v_count int;
  v_queue_until timestamptz;
  v_digits text;
BEGIN
  SELECT value INTO v_settings FROM public.app_settings WHERE key = 'partnership_comms_settings';
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_tz := coalesce(v_settings->>'timezone', 'America/New_York');
  v_start := coalesce(v_settings->>'quiet_hours_start', '21:00')::time;
  v_end := coalesce(v_settings->>'quiet_hours_end', '08:00')::time;
  v_cap := coalesce((v_settings->>'frequency_cap_count')::int, 3);
  v_hours := coalesce((v_settings->>'frequency_cap_hours')::int, 4);
  v_key := public.partnership_comms_recipient_key(p_email, p_phone);
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');

  IF p_channel = 'email' AND coalesce(p_email, '') <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.partnership_opt_outs
      WHERE channel = 'email' AND revoked_at IS NULL AND lower(email) = lower(p_email)
    ) THEN
      RETURN jsonb_build_object('action','suppress','reason','opted_out','recipient_key',v_key);
    END IF;
  END IF;
  IF p_channel = 'sms' AND v_digits <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.partnership_opt_outs
      WHERE channel = 'sms' AND revoked_at IS NULL AND phone_digits = v_digits
    ) THEN
      RETURN jsonb_build_object('action','suppress','reason','opted_out','recipient_key',v_key);
    END IF;
  END IF;

  IF p_priority = 'urgent' THEN
    RETURN jsonb_build_object('action','send','reason','urgent','recipient_key',v_key);
  END IF;

  v_local := (p_now AT TIME ZONE v_tz);
  v_local_time := v_local::time;
  IF v_start <= v_end THEN
    v_in_quiet := v_local_time >= v_start AND v_local_time < v_end;
  ELSE
    v_in_quiet := v_local_time >= v_start OR v_local_time < v_end;
  END IF;

  IF v_in_quiet THEN
    IF v_start > v_end AND v_local_time >= v_start THEN
      v_queue_until := ((v_local::date + 1) + v_end) AT TIME ZONE v_tz;
    ELSE
      v_queue_until := (v_local::date + v_end) AT TIME ZONE v_tz;
    END IF;
    RETURN jsonb_build_object(
      'action','queue','reason','quiet_hours',
      'send_after', v_queue_until, 'recipient_key', v_key
    );
  END IF;

  SELECT count(*) INTO v_count
  FROM public.partnership_messages
  WHERE recipient_key = v_key
    AND created_at > p_now - make_interval(hours => v_hours)
    AND status IN ('sent','queued','sending','retry');

  IF v_count >= v_cap THEN
    v_queue_until := p_now + make_interval(hours => v_hours);
    RETURN jsonb_build_object(
      'action','queue','reason','frequency_cap',
      'send_after', v_queue_until, 'recipient_key', v_key
    );
  END IF;

  RETURN jsonb_build_object('action','send','reason','ok','recipient_key',v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.partnership_comms_check(text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partnership_comms_check(text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.partnership_comms_recipient_key(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partnership_comms_check(text, text, text, text, timestamptz) TO postgres;
GRANT EXECUTE ON FUNCTION public.partnership_comms_recipient_key(text, text) TO postgres;

ALTER TABLE public.partnership_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partnership_message_templates' AND policyname='partnership_templates_service') THEN
    CREATE POLICY partnership_templates_service ON public.partnership_message_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partnership_opt_outs' AND policyname='partnership_opt_outs_service') THEN
    CREATE POLICY partnership_opt_outs_service ON public.partnership_opt_outs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partnership_messages' AND policyname='partnership_messages_service') THEN
    CREATE POLICY partnership_messages_service ON public.partnership_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.partnership_message_templates TO service_role;
GRANT ALL ON public.partnership_opt_outs TO service_role;
GRANT ALL ON public.partnership_messages TO service_role;
REVOKE ALL ON public.partnership_message_templates FROM anon, authenticated;
REVOKE ALL ON public.partnership_opt_outs FROM anon, authenticated;
REVOKE ALL ON public.partnership_messages FROM anon, authenticated;
