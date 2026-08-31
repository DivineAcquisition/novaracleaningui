-- Audit log for the autonomous chat-examination agent. One row per
-- GHL conversation; UPSERTed each time the chat-agent runs against it.
-- last_analyzed_message_ts is the timestamp of the most recent message
-- at analysis time, so the pulse cron can skip conversations that
-- haven't moved since the last run (idempotent + token-efficient).
CREATE TABLE IF NOT EXISTS public.chat_insights (
  conversation_id              text PRIMARY KEY,
  contact_id                   text,
  contact_email                text,
  contact_phone                text,
  contact_name                 text,
  last_analyzed_at             timestamptz NOT NULL DEFAULT now(),
  last_analyzed_message_ts     timestamptz,
  message_count                int,
  provider                     text,
  model                        text,
  -- Denormalized hot-path columns for fast filtering in admin UI
  lead_temperature             text,
  stage                        text,
  sentiment                    text,
  urgency                      text,
  recommended_action_type      text,
  -- Full structured analysis the LLM emitted
  analysis                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What got mapped to GHL on this run
  extracted_fields             jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_tags                 text[] NOT NULL DEFAULT ARRAY[]::text[],
  ghl_fields_skipped           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Last error from the LLM or the GHL push (NULL on success)
  error_message                text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_insights_last_analyzed_at_idx
  ON public.chat_insights (last_analyzed_at DESC);
CREATE INDEX IF NOT EXISTS chat_insights_urgency_idx
  ON public.chat_insights (urgency)
  WHERE urgency IN ('now', 'today');
CREATE INDEX IF NOT EXISTS chat_insights_contact_email_idx
  ON public.chat_insights (contact_email);

ALTER TABLE public.chat_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_insights_admin_read ON public.chat_insights;
CREATE POLICY chat_insights_admin_read ON public.chat_insights
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS chat_insights_service_role_write ON public.chat_insights;
CREATE POLICY chat_insights_service_role_write ON public.chat_insights
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.chat_insights IS
  'Audit log of admin-chat-agent runs. UPSERTed by chat-agent-pulse on each tick.';
