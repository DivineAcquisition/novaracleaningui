-- Email types, one business identity, shared marketing suppression,
-- versioned footers, and the delivery log kept for disputes.

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'email_business_identity',
  jsonb_build_object(
    'legalName', 'NovaraCleaning',
    'brandName', 'Novara Cleaning',
    'mailingAddress', jsonb_build_object('line1','','line2','','city','','region','','postalCode','','country','US'),
    'supportEmail', 'support@novaracleaning.com',
    'phone', '+1 (844) 735-2070',
    'website', 'https://novaracleaning.com',
    'privacyUrl', 'https://novaracleaning.com/privacy',
    'termsUrl', 'https://novaracleaning.com/terms',
    'publicOrigin', 'https://app.novaracleaning.com',
    'licenseLine', '',
    'retentionMonths', 24,
    'unsubscribeHonorBusinessDays', 10,
    'monitoredInboxes', jsonb_build_array(
      'support@novaracleaning.com',
      'billing@novaracleaning.com',
      'operations@novaracleaning.com',
      'ops@novaracleaning.com'
    ),
    'marketingCategories', jsonb_build_array(
      jsonb_build_object('id','offers','label','Offers and seasonal specials'),
      jsonb_build_object('id','news','label','Tips and news'),
      jsonb_build_object('id','reactivation','label','Reactivation'),
      jsonb_build_object('id','referrals','label','Referral offers')
    ),
    'service', jsonb_build_object('displayName','Novara Cleaning','address','hello@novaracleaning.com','replyTo','support@novaracleaning.com','streamKey','service'),
    'marketing', jsonb_build_object('displayName','Novara Cleaning','address','','replyTo','support@novaracleaning.com','streamKey','marketing'),
    'contractor', jsonb_build_object('displayName','NVC Operations','address','operations@novaracleaning.com','replyTo','operations@novaracleaning.com'),
    'internal', jsonb_build_object('displayName','NovaraCleaning','address','ops@novaracleaning.com','replyTo','ops@novaracleaning.com')
  ),
  'Business details every email footer is built from. Marketing cannot send without a mailing address.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'email_approved_claims',
  '[]'::jsonb,
  'Claims an email may make. Each active claim needs a short note on its basis. Empty until an admin approves one.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_marketing_contacts (
  email text PRIMARY KEY,
  status text NOT NULL DEFAULT 'not_asked' CHECK (status IN ('subscribed', 'unsubscribed', 'not_asked')),
  source text NOT NULL DEFAULT 'unknown',
  source_note text NOT NULL DEFAULT '',
  consent_basis text NOT NULL DEFAULT '',
  categories jsonb,
  consented_at timestamptz,
  unsubscribed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('contact', 'admin', 'system')),
  previous_status text,
  next_status text,
  source text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_consent_events_email_idx ON public.email_consent_events (email, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_suppression (
  email text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')),
  source text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_suppression_active_idx ON public.email_suppression (email) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.email_preference_tokens (
  token text PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_preference_tokens_email_idx ON public.email_preference_tokens (email);

CREATE TABLE IF NOT EXISTS public.email_footer_versions (
  version_key text PRIMARY KEY,
  email_type text NOT NULL,
  html text NOT NULL,
  dark_html text NOT NULL DEFAULT '',
  text_body text NOT NULL DEFAULT '',
  identity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text NOT NULL,
  email_type text NOT NULL,
  template_key text,
  sender text NOT NULL DEFAULT '',
  reply_to text NOT NULL DEFAULT '',
  recipient text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  html text NOT NULL DEFAULT '',
  text_body text NOT NULL DEFAULT '',
  footer_version text NOT NULL DEFAULT '',
  footer_html text NOT NULL DEFAULT '',
  stream text NOT NULL DEFAULT 'service',
  provider text,
  provider_id text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  test_send boolean NOT NULL DEFAULT false,
  booking_id text,
  status text NOT NULL DEFAULT 'sent',
  block_reasons jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS email_delivery_log_contact_idx ON public.email_delivery_log (contact_email, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_log_booking_idx ON public.email_delivery_log (booking_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS public.email_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  mailbox text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  email_type text,
  delivery_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_conversation_contact_idx ON public.email_conversation_messages (contact_email, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_template_registry (
  key text PRIMARY KEY,
  email_type text NOT NULL,
  subject text NOT NULL DEFAULT '',
  html text NOT NULL DEFAULT '',
  live boolean NOT NULL DEFAULT false,
  owner_decision_needed boolean NOT NULL DEFAULT false,
  category text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE IF NOT EXISTS public.email_tax_e_consent (
  email text PRIMARY KEY,
  contractor_id text,
  consented_at timestamptz,
  withdrawn_at timestamptz,
  source text NOT NULL DEFAULT 'contractor',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_marketing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_preference_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_footer_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_template_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_tax_e_consent ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'email_marketing_contacts',
    'email_consent_events',
    'email_suppression',
    'email_preference_tokens',
    'email_footer_versions',
    'email_delivery_log',
    'email_conversation_messages',
    'email_template_registry',
    'email_tax_e_consent'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = tbl || '_service'
    ) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl || '_service', tbl);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
  END LOOP;
END $$;

-- Email opt-out stops marketing. Service, agreement, and contractor mail still send.
-- SMS STOP is unchanged. Drop the 5-argument function so callers use this one.
DROP FUNCTION IF EXISTS public.partnership_comms_check(text, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.partnership_comms_check(
  p_email text,
  p_phone text,
  p_channel text,
  p_priority text,
  p_now timestamptz DEFAULT now(),
  p_marketing boolean DEFAULT false
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

  IF p_channel = 'email' AND p_marketing AND coalesce(p_email, '') <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.partnership_opt_outs
      WHERE channel = 'email' AND revoked_at IS NULL AND lower(email) = lower(p_email)
    ) OR EXISTS (
      SELECT 1 FROM public.email_suppression
      WHERE revoked_at IS NULL AND lower(email) = lower(p_email)
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

REVOKE ALL ON FUNCTION public.partnership_comms_check(text, text, text, text, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partnership_comms_check(text, text, text, text, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.partnership_comms_check(text, text, text, text, timestamptz, boolean) TO postgres;

-- Keep rows at least as long as the configured retention. This does not touch older sent history's content.
CREATE OR REPLACE FUNCTION public.purge_email_delivery_log(p_months integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_months IS NULL OR p_months < 1 THEN
    RAISE EXCEPTION 'Retention months must be at least 1';
  END IF;
  DELETE FROM public.email_delivery_log
  WHERE sent_at < now() - make_interval(months => p_months);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_email_delivery_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_email_delivery_log(integer) TO service_role;
