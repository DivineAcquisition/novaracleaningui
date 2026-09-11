-- ─── Contractor dashboard walkthroughs ──────────────────────────────────────
--
-- Two pieces of storage for the guided walkthroughs contractors run on their
-- own dashboard:
--
--   1. cleaner_tour_progress — one row per contractor per walkthrough. Records
--      whether they finished it, skipped it, or stopped partway, and which
--      version of the walkthrough they saw.
--
--   2. app_settings.contractor_tours — the admin-configurable bits: whether
--      the first-login sequence runs, whether a version bump re-offers a
--      walkthrough, and how many to re-offer at once.
--
-- Plus a private bucket for the generated screen recordings. Private, not
-- public: the recordings are captured against test data and contain no real
-- client or contractor information, but "contains nothing sensitive" is not a
-- reason to serve something anonymously, and a leaked public URL to an
-- internal training clip is still an avoidable embarrassment.
--
-- What is deliberately NOT here: anything that reads progress back into
-- dispatch, pay, or the Novara Score. Completion is context for a
-- conversation with a contractor, not an input to anything automatic. There
-- is no trigger on this table and nothing else joins to it.

-- ── Progress ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cleaner_tour_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  -- Catalog id, e.g. 'dashboard-basics'. Text rather than an enum so adding a
  -- walkthrough is a code change and not a migration.
  tour_id text NOT NULL,
  -- Catalog version of that walkthrough when the row was last written. A
  -- contractor who finished v1 of a walkthrough whose screen has since
  -- changed reads as "completed, older version" rather than "completed".
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'in_progress',
  -- How far they got, so a resumed walkthrough doesn't restart from step one.
  last_step_index integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_tour_progress_status_check
    CHECK (status IN ('in_progress', 'skipped', 'completed')),
  CONSTRAINT cleaner_tour_progress_step_check
    CHECK (last_step_index >= 0)
);

-- One row per contractor per walkthrough: re-running a walkthrough updates
-- the row rather than appending, because nobody needs an audit trail of how
-- many times someone rewatched the photo walkthrough — only where they stand.
CREATE UNIQUE INDEX IF NOT EXISTS cleaner_tour_progress_unique
  ON public.cleaner_tour_progress(cleaner_id, tour_id);

CREATE INDEX IF NOT EXISTS idx_cleaner_tour_progress_cleaner
  ON public.cleaner_tour_progress(cleaner_id);

CREATE INDEX IF NOT EXISTS idx_cleaner_tour_progress_tour
  ON public.cleaner_tour_progress(tour_id, status);

ALTER TABLE public.cleaner_tour_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read tour progress" ON public.cleaner_tour_progress;
CREATE POLICY "admins read tour progress" ON public.cleaner_tour_progress
  FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

-- A contractor can see and write their own progress and nobody else's. The
-- cleaners.user_id link is the only thing tying an auth session to a cleaner
-- row; cleaners whose row isn't linked yet fall back to localStorage on the
-- client and sync once the link exists.
DROP POLICY IF EXISTS "cleaners read own tour progress" ON public.cleaner_tour_progress;
CREATE POLICY "cleaners read own tour progress" ON public.cleaner_tour_progress
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.id = cleaner_tour_progress.cleaner_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cleaners write own tour progress" ON public.cleaner_tour_progress;
CREATE POLICY "cleaners write own tour progress" ON public.cleaner_tour_progress
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.id = cleaner_tour_progress.cleaner_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cleaners update own tour progress" ON public.cleaner_tour_progress;
CREATE POLICY "cleaners update own tour progress" ON public.cleaner_tour_progress
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.id = cleaner_tour_progress.cleaner_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cleaners c
      WHERE c.id = cleaner_tour_progress.cleaner_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service role manages tour progress" ON public.cleaner_tour_progress;
CREATE POLICY "service role manages tour progress" ON public.cleaner_tour_progress
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Settings ────────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'contractor_tours',
  jsonb_build_object(
    'autoStartOnFirstLogin', true,
    'reofferOnVersionChange', true,
    'maxReoffersAtOnce', 2
  ),
  'Contractor dashboard walkthroughs: first-login sequence, re-offer on version bump, and how many to re-offer at once.'
)
ON CONFLICT (key) DO NOTHING;

-- ── Admin view ──────────────────────────────────────────────────────────────
--
-- One row per contractor with their walkthrough counts, for the admin panel.
-- Counts only — no percentage and no score. A percentage invites a target,
-- and a target turns context into a metric people manage rather than use.
--
-- `version` here is the version the contractor saw, not the current catalog
-- version: SQL has no access to the catalog, so "is this outdated?" is
-- decided in TypeScript by `tourStanding()`. The view's job is to hand the
-- panel the raw rows cheaply, not to duplicate that rule badly.

CREATE OR REPLACE VIEW public.cleaner_tour_status_v1
WITH (security_invoker = true)
AS
SELECT
  c.id AS cleaner_id,
  c.first_name,
  c.last_name,
  c.email,
  c.status AS cleaner_status,
  COUNT(p.id) FILTER (WHERE p.status = 'completed') AS completed_count,
  COUNT(p.id) FILTER (WHERE p.status = 'skipped') AS skipped_count,
  COUNT(p.id) FILTER (WHERE p.status = 'in_progress') AS in_progress_count,
  MAX(p.updated_at) AS last_activity_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'tourId', p.tour_id,
        'version', p.version,
        'status', p.status,
        'lastStepIndex', p.last_step_index,
        'startedAt', p.started_at,
        'completedAt', p.completed_at,
        'updatedAt', p.updated_at
      )
      ORDER BY p.tour_id
    ) FILTER (WHERE p.id IS NOT NULL),
    '[]'::jsonb
  ) AS progress
FROM public.cleaners c
LEFT JOIN public.cleaner_tour_progress p ON p.cleaner_id = c.id
GROUP BY c.id, c.first_name, c.last_name, c.email, c.status;

COMMENT ON VIEW public.cleaner_tour_status_v1 IS
  'Walkthrough progress per contractor for the admin panel. Context for conversations — not an input to the Novara Score, dispatch, or pay.';

-- ── Recordings bucket ───────────────────────────────────────────────────────
--
-- Generated by scripts/tours/record.ts against a demo account with fabricated
-- data. Regenerating overwrites in place, so the path is stable and the
-- freshness question is answered by the committed manifest, not by digging
-- through object versions.

INSERT INTO storage.buckets (id, name, public)
VALUES ('contractor-tour-recordings', 'contractor-tour-recordings', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read tour recordings" ON storage.objects;
CREATE POLICY "admins read tour recordings" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contractor-tour-recordings'
    AND public.is_admin_or_va(auth.uid())
  );

-- Any signed-in contractor can watch any clip. There is nothing per-contractor
-- in them — they're captured against a demo account — so scoping reads to a
-- specific cleaner row would add a join and protect nothing.
DROP POLICY IF EXISTS "contractors read tour recordings" ON storage.objects;
CREATE POLICY "contractors read tour recordings" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contractor-tour-recordings'
    AND EXISTS (
      SELECT 1 FROM public.cleaners c WHERE c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service role manages tour recordings" ON storage.objects;
CREATE POLICY "service role manages tour recordings" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'contractor-tour-recordings')
  WITH CHECK (bucket_id = 'contractor-tour-recordings');
