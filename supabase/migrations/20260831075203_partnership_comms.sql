-- Partnership communications layer: one template store, one delivery log,
-- opt-outs, quiet hours, frequency caps. Email still goes through Resend
-- (admin-send-email); SMS still through GHL (send-ghl-sms).

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'partnership_comms_settings',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'quiet_hours_start', '21:00',
    'quiet_hours_end', '08:00',
    'frequency_cap_count', 3,
    'frequency_cap_hours', 4,
    'standard_max_attempts', 3,
    'urgent_max_attempts', 5,
    'partners_origin', 'https://partners.novaracleaning.com',
    'senders', jsonb_build_object(
      'partner', jsonb_build_object(
        'from', 'Novara Cleaning <hello@novaracleaning.com>',
        'reply_to', 'support@novaracleaning.com'
      ),
      'walkthrough_agent', jsonb_build_object(
        'from', 'Novara Ops <ops@novaracleaning.com>',
        'reply_to', 'ops@novaracleaning.com'
      ),
      'admin', jsonb_build_object(
        'from', 'Novara Cleaning <ops@novaracleaning.com>',
        'reply_to', 'ops@novaracleaning.com'
      )
    )
  ),
  'Partnership comms: quiet hours, frequency caps, role-based sender identity.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.partnership_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  role text NOT NULL CHECK (role IN ('partner', 'walkthrough_agent', 'admin')),
  priority text NOT NULL CHECK (priority IN ('urgent', 'standard', 'routine')),
  channels text[] NOT NULL DEFAULT ARRAY['email']::text[],
  subject text,
  html text,
  sms_body text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_name text
);
CREATE UNIQUE INDEX IF NOT EXISTS partnership_message_templates_current_key
  ON public.partnership_message_templates (key) WHERE is_current;
CREATE INDEX IF NOT EXISTS partnership_message_templates_key_idx
  ON public.partnership_message_templates (key, version DESC);

CREATE TABLE IF NOT EXISTS public.partnership_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone_digits text,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  source text NOT NULL DEFAULT 'recipient',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT partnership_opt_outs_target_chk CHECK (email IS NOT NULL OR phone_digits IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS partnership_opt_outs_email_idx
  ON public.partnership_opt_outs (lower(email)) WHERE email IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS partnership_opt_outs_phone_idx
  ON public.partnership_opt_outs (phone_digits) WHERE phone_digits IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.partnership_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  template_version integer,
  role text NOT NULL CHECK (role IN ('partner', 'walkthrough_agent', 'admin')),
  priority text NOT NULL CHECK (priority IN ('urgent', 'standard', 'routine')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'suppressed', 'retry')),
  trigger_source text NOT NULL,
  recipient_key text NOT NULL,
  to_email text,
  to_phone text,
  subject text,
  body text,
  vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  provider_id text,
  error text,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  failed_at timestamptz,
  escalated_at timestamptz,
  idempotency_key text UNIQUE,
  unsubscribe_token text UNIQUE,
  host_id uuid,
  business_account_id uuid,
  walkthrough_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partnership_messages_recipient_idx
  ON public.partnership_messages (recipient_key, created_at DESC);
CREATE INDEX IF NOT EXISTS partnership_messages_status_idx
  ON public.partnership_messages (status, send_after)
  WHERE status IN ('queued', 'retry');
CREATE INDEX IF NOT EXISTS partnership_messages_search_idx
  ON public.partnership_messages (to_email, to_phone, template_key, created_at DESC);
