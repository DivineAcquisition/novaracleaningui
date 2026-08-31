-- ─── Ops Assistant ──────────────────────────────────────────────────────
--
-- One conversation per signed-in admin/VA, reachable from the workspace
-- panel and from docs.novaracleaning.com. How-the-Tool-Works knowledge is
-- the generated guides (files in the repo). Policy / escalation articles
-- are admin-editable here because they change without a code change.

CREATE TABLE IF NOT EXISTS public.ops_assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.ops_assistant_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  surface text NOT NULL CHECK (surface IN ('docs', 'workspace')),
  entry text NOT NULL DEFAULT 'chat' CHECK (entry IN ('chat', 'search')),
  page_context jsonb,
  escalation boolean NOT NULL DEFAULT false,
  write_refused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_assistant_messages_thread_idx
  ON public.ops_assistant_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS public.ops_assistant_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.ops_assistant_threads(id) ON DELETE SET NULL,
  user_id uuid,
  surface text,
  entry text,
  intent text,
  page_context jsonb,
  retrieved_chunk_ids text[] NOT NULL DEFAULT '{}',
  model text,
  resolved_model text,
  tier text,
  guardrail text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_assistant_turns_created_idx
  ON public.ops_assistant_turns (created_at DESC);

CREATE TABLE IF NOT EXISTS public.ops_assistant_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'Policy',
  body text NOT NULL,
  escalation boolean NOT NULL DEFAULT false,
  admin_only boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ops_assistant_articles (slug, title, category, body, escalation, admin_only)
VALUES
  (
    'escalation-legal',
    'Escalation — legal threats and formal complaints',
    'Escalation',
    'Anything involving a lawyer, a lawsuit, a BBB complaint, or a threat to go public is confirm-with-management. Do not offer a refund, a comp, or a statement of fault. Take the details, say someone from management will follow up, and stop.',
    true,
    false
  ),
  (
    'escalation-termination',
    'Escalation — ending a contractor relationship',
    'Escalation',
    'Firing, terminating, or not sending this cleaner back ever is confirm-with-management. You can document what happened on the Quality Control screen. You cannot end the relationship from the assistant, and you should not tell a contractor they are done.',
    true,
    false
  ),
  (
    'escalation-comp-and-exceptions',
    'Escalation — comps, waived balances, special rates',
    'Escalation',
    'Comping a clean, waiving a balance, or quoting a special rate that is not what the pricing engine produced is confirm-with-management. Walk the person through the live quote on the booking screen. Do not invent a discount.',
    true,
    false
  ),
  (
    'escalation-customer-deletion',
    'Escalation — deleting a customer or their data',
    'Escalation',
    'Deleting a customer record, erasing data, or a right-to-be-forgotten request is confirm-with-management and admin-only. Do not walk a VA through the delete control.',
    true,
    true
  )
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.ops_assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assistant_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assistant_articles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ops_assistant_threads',
    'ops_assistant_messages',
    'ops_assistant_turns',
    'ops_assistant_articles'
  ] LOOP
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

-- Authenticated admins/VAs can read their own thread. Writes go through the
-- service-role API after the same gate, so a client cannot append a forged
-- assistant message.
DROP POLICY IF EXISTS ops_assistant_threads_own_read ON public.ops_assistant_threads;
CREATE POLICY ops_assistant_threads_own_read ON public.ops_assistant_threads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS ops_assistant_messages_own_read ON public.ops_assistant_messages;
CREATE POLICY ops_assistant_messages_own_read ON public.ops_assistant_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ops_assistant_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
    AND public.is_admin_or_va(auth.uid())
  );

DROP POLICY IF EXISTS ops_assistant_articles_read ON public.ops_assistant_articles;
CREATE POLICY ops_assistant_articles_read ON public.ops_assistant_articles
  FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS ops_assistant_turns_admin_read ON public.ops_assistant_turns;
CREATE POLICY ops_assistant_turns_admin_read ON public.ops_assistant_turns
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.ops_assistant_threads TO authenticated;
GRANT SELECT ON public.ops_assistant_messages TO authenticated;
GRANT SELECT ON public.ops_assistant_articles TO authenticated;
GRANT SELECT ON public.ops_assistant_turns TO authenticated;
GRANT ALL ON public.ops_assistant_threads TO service_role;
GRANT ALL ON public.ops_assistant_messages TO service_role;
GRANT ALL ON public.ops_assistant_turns TO service_role;
GRANT ALL ON public.ops_assistant_articles TO service_role;
REVOKE ALL ON public.ops_assistant_threads FROM anon;
REVOKE ALL ON public.ops_assistant_messages FROM anon;
REVOKE ALL ON public.ops_assistant_turns FROM anon;
REVOKE ALL ON public.ops_assistant_articles FROM anon;

NOTIFY pgrst, 'reload schema';
