-- Auto-ack log for support@ and billing@ inbound mail.
-- Replies fire only when those mailboxes received the message.

CREATE TABLE IF NOT EXISTS public.mailbox_ack_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id TEXT NOT NULL UNIQUE,
  mailbox TEXT,
  from_email TEXT,
  kind TEXT,
  party TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  skip_reason TEXT,
  resend_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mailbox_ack_log_created_idx
  ON public.mailbox_ack_log (created_at DESC);
CREATE INDEX IF NOT EXISTS mailbox_ack_log_status_idx
  ON public.mailbox_ack_log (status, created_at DESC);

ALTER TABLE public.mailbox_ack_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mailbox_ack_log'
      AND policyname = 'Service role access to mailbox_ack_log'
  ) THEN
    CREATE POLICY "Service role access to mailbox_ack_log"
      ON public.mailbox_ack_log
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.app_secrets (key, value, description)
VALUES
  (
    'MAILBOX_ACK_ENABLED',
    'true',
    'When true, inbound-mailbox-ack sends a short received/informed reply. Hard-gated to support@novaracleaning.com and billing@novaracleaning.com only.'
  )
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.mailbox_ack_log IS
  'Idempotency log for inbound-mailbox-ack. Only support@ and billing@ inbound mail is eligible to send.';
