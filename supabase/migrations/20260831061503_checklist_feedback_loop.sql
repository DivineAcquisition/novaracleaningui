-- ─── Checklist feedback loop ─────────────────────────────────────────────
--
-- Checklists were written once from best practice and never checked against
-- what actually happened on the jobs that used them. Meanwhile the system
-- already produces the evidence: QC cases, re-cleans with a verification
-- classification, review answers, duration variance, recurrence flags.
--
-- This makes checklist items addressable so those records can point at ONE
-- item, aggregates the signal on a cadence, and puts a grounded hypothesis in
-- front of an admin. Nothing here edits a checklist. Every change is a human
-- decision from the review queue, and every change is versioned.
--
-- Reuses: qc_issues (+ reclean_classification), job_checklists, job_feedback,
-- app_settings, is_admin_or_va() RLS, pg_cron + pg_net, events.

-- ─── 1. Settings ────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'checklist_feedback_settings',
  jsonb_build_object(
    -- Checklist patterns need more data than a week provides.
    'aggregation_cadence', 'monthly',
    -- A single bad job is noise. An item must reach this many signals of a
    -- kind within the window before it is worth an admin's attention.
    'min_signal_threshold', 2,
    'lookback_days', 90,
    'max_insights', 12,
    -- Review free-text is matched to AREAS, never to a specific item: the
    -- word "bathroom" does not tell you which bathroom line failed.
    'review_theme_keywords', jsonb_build_object(
      'floors', jsonb_build_array('floor', 'floors', 'mop', 'mopping', 'vacuum', 'carpet'),
      'restrooms', jsonb_build_array('bathroom', 'restroom', 'toilet', 'urinal', 'shower'),
      'kitchen', jsonb_build_array('kitchen', 'breakroom', 'break room', 'fridge', 'microwave', 'dishes'),
      'trash', jsonb_build_array('trash', 'garbage', 'bin', 'liner', 'recycling'),
      'odor', jsonb_build_array('smell', 'smelled', 'odor', 'odour', 'stink'),
      'dusting', jsonb_build_array('dust', 'dusty', 'cobweb', 'vent'),
      'glass', jsonb_build_array('glass', 'window', 'mirror', 'streak'),
      'linens', jsonb_build_array('linen', 'towel', 'bed', 'sheets', 'staging')
    )
  ),
  'Checklist feedback loop: aggregation cadence, the minimum signal an item needs before it surfaces for review, the lookback window, and the review keyword themes. Raising min_signal_threshold makes the queue quieter, not more accurate.'
)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Addressable checklist items ─────────────────────────────────────
--
-- item_id is the stable catalog id ("commercial.light.restrooms"). It is
-- content-independent on purpose: rewording an item keeps its signal history.
-- Seeded and kept in step with src/lib/checklist-catalog.ts by the sync
-- endpoint; once an item has been edited from the review queue the DB row is
-- the live wording and the catalog stays the origin record.

CREATE TABLE IF NOT EXISTS public.checklist_items (
  item_id text PRIMARY KEY,
  -- Area / category used for grouping signal ("Bathroom(s)", "Light scope").
  area text NOT NULL DEFAULT '',
  -- Which published checklists work this item. Light ⊂ Standard ⊂ Detailed
  -- is modeled as membership, so one item is not counted three times.
  checklists text[] NOT NULL DEFAULT '{}'::text[],
  item_text text NOT NULL,
  photo_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  current_version integer NOT NULL DEFAULT 1,
  -- 'catalog' until an admin edits it, then 'admin'.
  origin text NOT NULL DEFAULT 'catalog' CHECK (origin IN ('catalog', 'admin')),
  catalog_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_items_checklists_idx
  ON public.checklist_items USING GIN (checklists);
CREATE INDEX IF NOT EXISTS checklist_items_area_idx
  ON public.checklist_items (area);

COMMENT ON COLUMN public.checklist_items.item_id IS
  'Stable, content-independent id. Never regenerated from text — a signal logged in March must still line up with the item after a September rewording.';

-- ─── 3. Version history — never overwritten silently ────────────────────

CREATE TABLE IF NOT EXISTS public.checklist_item_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL REFERENCES public.checklist_items(item_id) ON DELETE CASCADE,
  version integer NOT NULL,
  item_text text NOT NULL,
  area text NOT NULL DEFAULT '',
  photo_required boolean NOT NULL DEFAULT false,
  checklists text[] NOT NULL DEFAULT '{}'::text[],
  -- What changed and why, in the editor's words.
  change_summary text,
  -- The surfaced insight that prompted this edit, where there was one. This
  -- is what makes a checklist's evolution traceable to real outcomes rather
  -- than "someone felt like changing it".
  source_insight_id uuid,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version)
);

CREATE INDEX IF NOT EXISTS checklist_item_versions_item_idx
  ON public.checklist_item_versions (item_id, version DESC);
CREATE INDEX IF NOT EXISTS checklist_item_versions_insight_idx
  ON public.checklist_item_versions (source_insight_id)
  WHERE source_insight_id IS NOT NULL;

-- Template-level version: the pointer a performed job pins to.
CREATE TABLE IF NOT EXISTS public.checklist_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_key text NOT NULL,
  version integer NOT NULL,
  -- Full rendered snapshot: sections, item ids, and wording as of this
  -- version. A dispute six months from now reads this, not today's code.
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  item_count integer NOT NULL DEFAULT 0,
  change_summary text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checklist_key, version)
);

CREATE INDEX IF NOT EXISTS checklist_template_versions_key_idx
  ON public.checklist_template_versions (checklist_key, version DESC);

-- ─── 4. Signals ─────────────────────────────────────────────────────────
--
-- One row per (source record, item). The unique constraint is what keeps a
-- re-clean covering four areas from being re-counted every time the
-- aggregator runs.

CREATE TABLE IF NOT EXISTS public.checklist_item_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'qc_case', 'reclean', 'review_theme', 'duration_variance', 'recurrence'
  )),
  -- Re-clean verification classification, carried verbatim from
  -- qc_issues.reclean_classification. quality_miss and scope_confusion point
  -- at DIFFERENT problems and must never be summed into one number.
  classification text CHECK (classification IS NULL OR classification IN (
    'pending', 'quality_miss', 'scope_confusion', 'not_supported'
  )),
  -- The record this signal came from (qc_issues.id, job_feedback.id, …).
  source_id uuid,
  qc_issue_id uuid REFERENCES public.qc_issues(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  job_id uuid,
  checklist_key text,
  -- Review themes resolve to an AREA, not an item — recorded so the queue can
  -- say so plainly instead of implying false precision.
  area text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, item_id)
);

CREATE INDEX IF NOT EXISTS checklist_item_signals_item_idx
  ON public.checklist_item_signals (item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS checklist_item_signals_kind_idx
  ON public.checklist_item_signals (source_type, classification, occurred_at DESC);
CREATE INDEX IF NOT EXISTS checklist_item_signals_qc_idx
  ON public.checklist_item_signals (qc_issue_id) WHERE qc_issue_id IS NOT NULL;

COMMENT ON TABLE public.checklist_item_signals IS
  'Real outcomes pointed at one checklist item. A signal is evidence for a human review prompt — it never edits checklist content.';

-- ─── 5. Surfaced insights (the review queue) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.checklist_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL,
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  checklist_keys text[] NOT NULL DEFAULT '{}'::text[],
  area text,
  item_text_at_surface text,
  -- The counts behind the insight. Every claim in observation/numbers must be
  -- traceable to a figure in here.
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_miss_count integer NOT NULL DEFAULT 0,
  scope_confusion_count integer NOT NULL DEFAULT 0,
  qc_case_count integer NOT NULL DEFAULT 0,
  review_theme_count integer NOT NULL DEFAULT 0,
  duration_variance_count integer NOT NULL DEFAULT 0,
  recurrence_count integer NOT NULL DEFAULT 0,
  signal_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  observation text NOT NULL,
  numbers text NOT NULL,
  -- Always a hypothesis, never a directive. "May be under-specified",
  -- "worth reviewing" — and "cause is unclear from available data" when the
  -- data does not say why.
  hypothesis text NOT NULL,
  model text,
  model_version text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'edited', 'unchanged', 'escalated')),
  -- Why an admin left it alone, so the same signal is not re-litigated next
  -- cycle unless it worsens.
  resolution_note text,
  escalated_to text CHECK (escalated_to IS NULL OR escalated_to IN (
    'pricing_scope', 'duration_learning', 'training', 'other'
  )),
  resolved_by uuid,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, cycle_start)
);

CREATE INDEX IF NOT EXISTS checklist_insights_status_idx
  ON public.checklist_insights (status, cycle_start DESC);
CREATE INDEX IF NOT EXISTS checklist_insights_item_idx
  ON public.checklist_insights (item_id, cycle_start DESC);

-- An insight that was acted on must say who acted and when.
ALTER TABLE public.checklist_insights DROP CONSTRAINT IF EXISTS checklist_insights_resolution_check;
ALTER TABLE public.checklist_insights
  ADD CONSTRAINT checklist_insights_resolution_check
  CHECK (
    status = 'open'
    OR (resolved_at IS NOT NULL AND COALESCE(btrim(resolved_by_name), '') <> '')
  );

-- Leaving an item unchanged requires a reason; escalating requires a target.
ALTER TABLE public.checklist_insights DROP CONSTRAINT IF EXISTS checklist_insights_unchanged_note_check;
ALTER TABLE public.checklist_insights
  ADD CONSTRAINT checklist_insights_unchanged_note_check
  CHECK (status <> 'unchanged' OR COALESCE(btrim(resolution_note), '') <> '');

ALTER TABLE public.checklist_insights DROP CONSTRAINT IF EXISTS checklist_insights_escalation_target_check;
ALTER TABLE public.checklist_insights
  ADD CONSTRAINT checklist_insights_escalation_target_check
  CHECK (status <> 'escalated' OR escalated_to IS NOT NULL);

-- ─── 6. Tagging on the records that produce signal ──────────────────────

-- QC cases: the reviewer tags which checklist item(s) a quality case relates
-- to. Not every case maps to one (a scheduling complaint does not), so this
-- stays optional.
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS checklist_item_ids text[] NOT NULL DEFAULT '{}'::text[];
-- Re-clean targeted scope, resolved to items at classification time.
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS reclean_checklist_item_ids text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS qc_issues_checklist_items_idx
  ON public.qc_issues USING GIN (checklist_item_ids);
CREATE INDEX IF NOT EXISTS qc_issues_reclean_checklist_items_idx
  ON public.qc_issues USING GIN (reclean_checklist_item_ids);

COMMENT ON COLUMN public.qc_issues.checklist_item_ids IS
  'Checklist items this case relates to, tagged by the reviewer. Optional — a scheduling complaint has no checklist item.';

-- Job pins the checklist version it was performed under, so historical QC and
-- dispute review shows what the cleaner was actually asked to do.
ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS checklist_key text;
ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS template_version integer;
ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS template_version_id uuid
    REFERENCES public.checklist_template_versions(id) ON DELETE SET NULL;
ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS sections_snapshot jsonb;
-- Positional keys ("<section>:<item>") stay the progress map for in-flight
-- jobs; this maps them to stable ids without shifting anything under a crew.
ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS item_id_map jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.job_checklists.sections_snapshot IS
  'The checklist exactly as issued to this crew. Read this for historical review — never re-resolve today''s content for a job performed months ago.';

-- ─── 7. RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_item_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_insights ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'checklist_items',
    'checklist_item_versions',
    'checklist_template_versions',
    'checklist_item_signals',
    'checklist_insights'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_admin_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()))',
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

-- ─── 8. Version an edit ─────────────────────────────────────────────────
--
-- The only supported way to change an item's live wording. Writes the new
-- version row first, then moves the item — an edit that fails halfway leaves
-- history intact rather than a silently overwritten item.

CREATE OR REPLACE FUNCTION public.apply_checklist_item_edit(
  p_item_id text,
  p_item_text text,
  p_photo_required boolean,
  p_change_summary text,
  p_source_insight_id uuid,
  p_actor_id uuid,
  p_actor_name text
)
RETURNS public.checklist_item_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.checklist_items;
  v_next integer;
  v_version public.checklist_item_versions;
BEGIN
  SELECT * INTO v_item FROM public.checklist_items WHERE item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown checklist item %', p_item_id;
  END IF;
  IF COALESCE(btrim(p_item_text), '') = '' THEN
    RAISE EXCEPTION 'A checklist item cannot be blank.';
  END IF;
  IF COALESCE(btrim(p_change_summary), '') = '' THEN
    RAISE EXCEPTION 'A checklist edit must record what changed and why.';
  END IF;
  IF COALESCE(btrim(p_actor_name), '') = '' THEN
    RAISE EXCEPTION 'A checklist edit must record who made it.';
  END IF;

  v_next := COALESCE(v_item.current_version, 1) + 1;

  INSERT INTO public.checklist_item_versions (
    item_id, version, item_text, area, photo_required, checklists,
    change_summary, source_insight_id, changed_by, changed_by_name
  ) VALUES (
    p_item_id, v_next, btrim(p_item_text), v_item.area,
    COALESCE(p_photo_required, v_item.photo_required), v_item.checklists,
    btrim(p_change_summary), p_source_insight_id, p_actor_id, btrim(p_actor_name)
  )
  RETURNING * INTO v_version;

  UPDATE public.checklist_items
     SET item_text = btrim(p_item_text),
         photo_required = COALESCE(p_photo_required, photo_required),
         current_version = v_next,
         origin = 'admin',
         updated_at = now()
   WHERE item_id = p_item_id;

  INSERT INTO public.events (event_type, source, summary, data)
  VALUES (
    'checklist.item_edited',
    'checklist-feedback',
    format('%s edited checklist item %s (v%s)', btrim(p_actor_name), p_item_id, v_next),
    jsonb_build_object(
      'item_id', p_item_id,
      'version', v_next,
      'from_text', v_item.item_text,
      'to_text', btrim(p_item_text),
      'source_insight_id', p_source_insight_id,
      'change_summary', btrim(p_change_summary)
    )
  );

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_checklist_item_edit(text, text, boolean, text, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_checklist_item_edit(text, text, boolean, text, uuid, uuid, text) TO service_role;

-- ─── 9. Health view — did the edit actually move the numbers? ───────────
--
-- Per item: signal before the most recent edit vs signal after it. An edit
-- that changed nothing is visible here rather than assumed successful.

CREATE OR REPLACE VIEW public.checklist_item_health AS
WITH last_edit AS (
  SELECT item_id, MAX(created_at) AS edited_at
    FROM public.checklist_item_versions
   WHERE version > 1
   GROUP BY item_id
)
SELECT
  i.item_id,
  i.area,
  i.checklists,
  i.item_text,
  i.current_version,
  e.edited_at AS last_edited_at,
  COUNT(s.id) FILTER (
    WHERE s.source_type = 'reclean' AND s.classification = 'quality_miss'
  ) AS quality_miss_total,
  COUNT(s.id) FILTER (
    WHERE s.source_type = 'reclean' AND s.classification = 'scope_confusion'
  ) AS scope_confusion_total,
  COUNT(s.id) FILTER (WHERE s.source_type = 'qc_case') AS qc_case_total,
  COUNT(s.id) FILTER (WHERE s.source_type = 'duration_variance') AS duration_variance_total,
  COUNT(s.id) FILTER (WHERE s.source_type = 'recurrence') AS recurrence_total,
  COUNT(s.id) FILTER (WHERE s.source_type = 'review_theme') AS review_theme_total,
  COUNT(s.id) FILTER (
    WHERE e.edited_at IS NOT NULL AND s.occurred_at < e.edited_at
  ) AS signals_before_edit,
  COUNT(s.id) FILTER (
    WHERE e.edited_at IS NOT NULL AND s.occurred_at >= e.edited_at
  ) AS signals_after_edit,
  MAX(s.occurred_at) AS last_signal_at
FROM public.checklist_items i
LEFT JOIN last_edit e ON e.item_id = i.item_id
LEFT JOIN public.checklist_item_signals s ON s.item_id = i.item_id
GROUP BY i.item_id, i.area, i.checklists, i.item_text, i.current_version, e.edited_at;

GRANT SELECT ON public.checklist_item_health TO authenticated, service_role;

-- ─── 10. Monthly aggregation ────────────────────────────────────────────
--
-- Monthly, not weekly: a checklist pattern needs more data than seven days
-- produces, and a queue that surfaces noise stops being read.

DO $$
DECLARE
  v_supabase_url text;
  v_job_id bigint;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'checklist-feedback-aggregate';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('checklist-feedback-aggregate'); END IF;

  -- 06:00 UTC on the 1st — the cycle that just closed, before anyone opens
  -- the console for the month.
  PERFORM cron.schedule(
    'checklist-feedback-aggregate',
    '0 6 1 * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/checklist-feedback-aggregate',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET')
          ),
          body := jsonb_build_object('source', 'pg_cron'),
          timeout_milliseconds := 120000
        );
      $cron$,
      v_supabase_url
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping checklist-feedback-aggregate cron schedule: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
