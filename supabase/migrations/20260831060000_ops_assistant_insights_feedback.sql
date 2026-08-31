-- ─── Ops Assistant: insight access, Drive retrieval, learning loop ────────
--
-- Extends the embedded assistant. Guardrails do not change: read-only,
-- permission-scoped, assist-and-draft only. This migration adds:
--
--   1. Per-response helpful / not-helpful on assistant messages (the loop
--      the original spec assumed already existed).
--   2. A checklist-feedback-style aggregation: monthly by default, a
--      minimum signal threshold so one bad rating is noise, grounded
--      insights, an admin review queue, and no automatic prompt/docs change.
--   3. Versioned system-prompt history, linked back to the insight that
--      prompted an edit.
--   4. An Assistant Health view so an edit's effect on helpful-rate and
--      escalation-vs-answer rate is visible.
--
-- Aggregate/Drive answers reuse existing tables (weekly_reports,
-- job_documentation, va_eod_submissions, commercial_walkthroughs,
-- service_agreements). No new analytics pipeline or Drive connection.

-- ─── 1. Settings ────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'ops_assistant_feedback_settings',
  jsonb_build_object(
    'aggregation_cadence', 'monthly',
    'min_signal_threshold', 2,
    'lookback_days', 90,
    'max_insights', 12
  ),
  'Ops Assistant learning loop: cadence, the minimum signal a topic needs before it surfaces in the review queue, lookback window, and max insights per cycle. Raising min_signal_threshold makes the queue quieter, not more accurate. One isolated not-helpful rating is never a pattern.'
)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Per-response feedback on the existing message row ───────────────

ALTER TABLE public.ops_assistant_messages
  ADD COLUMN IF NOT EXISTS rating text
    CHECK (rating IS NULL OR rating IN ('helpful', 'not_helpful'));
ALTER TABLE public.ops_assistant_messages
  ADD COLUMN IF NOT EXISTS rating_note text;
ALTER TABLE public.ops_assistant_messages
  ADD COLUMN IF NOT EXISTS rated_at timestamptz;
ALTER TABLE public.ops_assistant_messages
  ADD COLUMN IF NOT EXISTS rated_by uuid;
ALTER TABLE public.ops_assistant_messages
  ADD COLUMN IF NOT EXISTS did_not_know boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ops_assistant_messages_rating_idx
  ON public.ops_assistant_messages (rating, created_at DESC)
  WHERE rating IS NOT NULL;

COMMENT ON COLUMN public.ops_assistant_messages.did_not_know IS
  'Set at write time when the grounded answer said it did not know. Aggregation uses this rather than re-parsing prose.';

-- ─── 3. Surfaced insights (the Assistant Review Queue) ──────────────────

CREATE TABLE IF NOT EXISTS public.ops_assistant_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_key text NOT NULL,
  topic_label text NOT NULL,
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  -- Counts behind the insight. Every digit in observation/numbers must
  -- trace to a figure in here.
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  not_helpful_count integer NOT NULL DEFAULT 0,
  dont_know_count integer NOT NULL DEFAULT 0,
  escalation_gap_count integer NOT NULL DEFAULT 0,
  escalation_policy_count integer NOT NULL DEFAULT 0,
  example_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  observation text NOT NULL,
  numbers text NOT NULL,
  hypothesis text NOT NULL,
  -- missing_docs | prompt_gap | missing_capability | correctly_escalating
  suggested_gap text NOT NULL DEFAULT 'missing_docs'
    CHECK (suggested_gap IN (
      'missing_docs', 'prompt_gap', 'missing_capability', 'correctly_escalating'
    )),
  model text,
  model_version text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'docs_noted', 'prompt_edited', 'capability_gap', 'dismissed'
    )),
  resolution_note text,
  resolved_by uuid,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_key, cycle_start)
);

CREATE INDEX IF NOT EXISTS ops_assistant_insights_status_idx
  ON public.ops_assistant_insights (status, cycle_start DESC);
CREATE INDEX IF NOT EXISTS ops_assistant_insights_topic_idx
  ON public.ops_assistant_insights (topic_key, cycle_start DESC);

ALTER TABLE public.ops_assistant_insights DROP CONSTRAINT IF EXISTS ops_assistant_insights_resolution_check;
ALTER TABLE public.ops_assistant_insights
  ADD CONSTRAINT ops_assistant_insights_resolution_check
  CHECK (
    status = 'open'
    OR (resolved_at IS NOT NULL AND COALESCE(btrim(resolved_by_name), '') <> '')
  );

ALTER TABLE public.ops_assistant_insights DROP CONSTRAINT IF EXISTS ops_assistant_insights_note_check;
ALTER TABLE public.ops_assistant_insights
  ADD CONSTRAINT ops_assistant_insights_note_check
  CHECK (status = 'open' OR COALESCE(btrim(resolution_note), '') <> '');

COMMENT ON TABLE public.ops_assistant_insights IS
  'Assistant Review Queue. A surfaced pattern is a prompt for a human — it never edits the system prompt, the guides, or assistant behaviour on its own.';

-- ─── 4. Versioned system prompt ─────────────────────────────────────────
--
-- Live prompt is the highest version. Version 0 is implied (the constant in
-- src/lib/ops-assistant/prompt.ts) until an admin saves an edit from the
-- review queue. Edits never overwrite a prior row.

CREATE TABLE IF NOT EXISTS public.ops_assistant_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  body text NOT NULL,
  change_summary text NOT NULL,
  source_insight_id uuid REFERENCES public.ops_assistant_insights(id) ON DELETE SET NULL,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);

CREATE INDEX IF NOT EXISTS ops_assistant_prompt_versions_insight_idx
  ON public.ops_assistant_prompt_versions (source_insight_id)
  WHERE source_insight_id IS NOT NULL;

-- ─── 5. Traceable change log (docs notes, capability flags, dismissals) ─

CREATE TABLE IF NOT EXISTS public.ops_assistant_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'prompt', 'article', 'docs_noted', 'capability_gap', 'dismissed'
  )),
  source_insight_id uuid REFERENCES public.ops_assistant_insights(id) ON DELETE SET NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_assistant_change_log_insight_idx
  ON public.ops_assistant_change_log (source_insight_id, created_at DESC)
  WHERE source_insight_id IS NOT NULL;

ALTER TABLE public.ops_assistant_articles
  ADD COLUMN IF NOT EXISTS source_insight_id uuid
    REFERENCES public.ops_assistant_insights(id) ON DELETE SET NULL;

-- ─── 6. Apply a prompt edit — the only supported write path ─────────────

CREATE OR REPLACE FUNCTION public.apply_ops_assistant_prompt_edit(
  p_body text,
  p_change_summary text,
  p_source_insight_id uuid,
  p_actor_id uuid,
  p_actor_name text
)
RETURNS public.ops_assistant_prompt_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
  v_row public.ops_assistant_prompt_versions;
BEGIN
  IF COALESCE(btrim(p_body), '') = '' THEN
    RAISE EXCEPTION 'A system prompt cannot be blank.';
  END IF;
  IF COALESCE(btrim(p_change_summary), '') = '' THEN
    RAISE EXCEPTION 'A prompt edit must record what changed and why.';
  END IF;
  IF COALESCE(btrim(p_actor_name), '') = '' THEN
    RAISE EXCEPTION 'A prompt edit must record who made it.';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM public.ops_assistant_prompt_versions;

  INSERT INTO public.ops_assistant_prompt_versions (
    version, body, change_summary, source_insight_id, changed_by, changed_by_name
  ) VALUES (
    v_next, p_body, btrim(p_change_summary), p_source_insight_id, p_actor_id, btrim(p_actor_name)
  )
  RETURNING * INTO v_row;

  INSERT INTO public.ops_assistant_change_log (
    kind, source_insight_id, summary, payload, changed_by, changed_by_name
  ) VALUES (
    'prompt',
    p_source_insight_id,
    format('%s saved system prompt v%s', btrim(p_actor_name), v_next),
    jsonb_build_object('version', v_next, 'change_summary', btrim(p_change_summary)),
    p_actor_id,
    btrim(p_actor_name)
  );

  INSERT INTO public.events (event_type, source, summary, data)
  VALUES (
    'ops_assistant.prompt_edited',
    'ops-assistant-feedback',
    format('%s saved Ops Assistant system prompt v%s', btrim(p_actor_name), v_next),
    jsonb_build_object(
      'version', v_next,
      'source_insight_id', p_source_insight_id,
      'change_summary', btrim(p_change_summary)
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ops_assistant_prompt_edit(text, text, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_ops_assistant_prompt_edit(text, text, uuid, uuid, text) TO service_role;

-- ─── 7. Health — did a prompt/docs change actually move the numbers? ────

CREATE OR REPLACE VIEW public.ops_assistant_health_daily AS
SELECT
  (date_trunc('day', m.created_at))::date AS day,
  count(*) FILTER (WHERE m.role = 'assistant') AS answers,
  count(*) FILTER (WHERE m.rating = 'helpful') AS helpful,
  count(*) FILTER (WHERE m.rating = 'not_helpful') AS not_helpful,
  count(*) FILTER (WHERE m.escalation) AS escalations,
  count(*) FILTER (
    WHERE m.role = 'assistant' AND NOT m.escalation AND NOT m.write_refused
  ) AS genuine_answers,
  count(*) FILTER (WHERE m.did_not_know) AS did_not_know
FROM public.ops_assistant_messages m
WHERE m.role = 'assistant'
GROUP BY 1;

CREATE OR REPLACE VIEW public.ops_assistant_health AS
WITH last_change AS (
  SELECT MAX(created_at) AS changed_at
    FROM public.ops_assistant_change_log
   WHERE kind IN ('prompt', 'article', 'docs_noted')
)
SELECT
  c.changed_at AS last_change_at,
  count(*) FILTER (WHERE m.role = 'assistant') AS answers,
  count(*) FILTER (WHERE m.rating = 'helpful') AS helpful,
  count(*) FILTER (WHERE m.rating = 'not_helpful') AS not_helpful,
  count(*) FILTER (WHERE m.escalation) AS escalations,
  count(*) FILTER (
    WHERE m.role = 'assistant' AND NOT m.escalation AND NOT m.write_refused
  ) AS genuine_answers,
  count(*) FILTER (WHERE m.did_not_know) AS did_not_know,
  count(*) FILTER (
    WHERE m.role = 'assistant' AND c.changed_at IS NOT NULL AND m.created_at < c.changed_at
  ) AS answers_before_change,
  count(*) FILTER (
    WHERE m.rating = 'helpful' AND c.changed_at IS NOT NULL AND m.created_at < c.changed_at
  ) AS helpful_before_change,
  count(*) FILTER (
    WHERE m.rating = 'not_helpful' AND c.changed_at IS NOT NULL AND m.created_at < c.changed_at
  ) AS not_helpful_before_change,
  count(*) FILTER (
    WHERE m.escalation AND c.changed_at IS NOT NULL AND m.created_at < c.changed_at
  ) AS escalations_before_change,
  count(*) FILTER (
    WHERE m.role = 'assistant' AND c.changed_at IS NOT NULL AND m.created_at >= c.changed_at
  ) AS answers_after_change,
  count(*) FILTER (
    WHERE m.rating = 'helpful' AND c.changed_at IS NOT NULL AND m.created_at >= c.changed_at
  ) AS helpful_after_change,
  count(*) FILTER (
    WHERE m.rating = 'not_helpful' AND c.changed_at IS NOT NULL AND m.created_at >= c.changed_at
  ) AS not_helpful_after_change,
  count(*) FILTER (
    WHERE m.escalation AND c.changed_at IS NOT NULL AND m.created_at >= c.changed_at
  ) AS escalations_after_change
FROM public.ops_assistant_messages m
CROSS JOIN last_change c
WHERE m.role = 'assistant'
GROUP BY c.changed_at;

GRANT SELECT ON public.ops_assistant_health_daily TO authenticated, service_role;
GRANT SELECT ON public.ops_assistant_health TO authenticated, service_role;

-- ─── 8. RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.ops_assistant_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assistant_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assistant_change_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ops_assistant_insights',
    'ops_assistant_prompt_versions',
    'ops_assistant_change_log'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_admin_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))',
        t || '_admin_read', t
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_service_role'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t || '_service_role', t
      );
    END IF;
  END LOOP;
END$$;

GRANT SELECT ON public.ops_assistant_insights TO authenticated;
GRANT SELECT ON public.ops_assistant_prompt_versions TO authenticated;
GRANT SELECT ON public.ops_assistant_change_log TO authenticated;
GRANT ALL ON public.ops_assistant_insights TO service_role;
GRANT ALL ON public.ops_assistant_prompt_versions TO service_role;
GRANT ALL ON public.ops_assistant_change_log TO service_role;
REVOKE ALL ON public.ops_assistant_insights FROM anon;
REVOKE ALL ON public.ops_assistant_prompt_versions FROM anon;
REVOKE ALL ON public.ops_assistant_change_log FROM anon;

-- ─── 9. Monthly aggregation via the existing admin host ─────────────────
--
-- Same pattern as ad-spend / VA metrics: pg_cron POSTs to the Next.js
-- route with CRON_SECRET. The aggregator lives with the assistant, not as
-- a new Deno pipeline. It writes insight rows only — never the prompt,
-- never the guides.

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'ops-assistant-feedback-aggregate';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('ops-assistant-feedback-aggregate'); END IF;

  -- 07:00 UTC on the 1st — after the checklist aggregator at 06:00.
  PERFORM cron.schedule(
    'ops-assistant-feedback-aggregate',
    '0 7 1 * *',
    $cron$
      SELECT net.http_post(
        url := 'https://admin.novaracleaning.com/api/ops-assistant/aggregate',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET')
        ),
        body := jsonb_build_object('source', 'pg_cron'),
        timeout_milliseconds := 120000
      );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping ops-assistant-feedback-aggregate cron schedule: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
