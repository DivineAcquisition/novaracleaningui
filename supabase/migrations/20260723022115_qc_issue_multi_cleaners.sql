-- ─── QC issues: multi-cleaner attachment ─────────────────────────────────────
--
-- Crew jobs have more than one cleaner, but qc_issues only carried a single
-- cleaner_id (the lead), so accountability could only target one person even
-- when the whole crew worked the job. This adds a `cleaners` jsonb array
-- ([{id, name, role}]) that is:
--   * auto-populated from the job's assignments at issue creation
--   * admin-editable (attach/detach via the qc-issues edge function, going
--     off the cleaners assigned to the job)
--   * backfilled here for every existing issue from job_assignments
--
-- cleaner_id / cleaner_name stay as the PRIMARY (lead) cleaner for
-- compatibility with scoring and existing views.

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS cleaners jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill from the job's assignment history (participating statuses only).
UPDATE public.qc_issues i
SET cleaners = sub.arr
FROM (
  SELECT i2.id AS issue_id,
    (
      SELECT jsonb_agg(jsonb_build_object('id', x.cid, 'name', x.name, 'role', x.role))
      FROM (
        SELECT DISTINCT ON (ja.cleaner_id)
          ja.cleaner_id AS cid,
          nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') AS name,
          ja.role AS role
        FROM public.job_assignments ja
        JOIN public.cleaners c ON c.id = ja.cleaner_id
        WHERE ja.job_id = i2.job_id
          AND lower(coalesce(ja.status,'')) IN ('confirmed','accepted','completed','in progress')
        ORDER BY ja.cleaner_id
      ) x
    ) AS arr
  FROM public.qc_issues i2
  WHERE i2.job_id IS NOT NULL
) sub
WHERE sub.issue_id = i.id
  AND sub.arr IS NOT NULL
  AND (i.cleaners IS NULL OR i.cleaners = '[]'::jsonb);

-- Make sure the issue's primary cleaner is always present in the array
-- (covers issues attributed via bookings.cleaner_id with no assignment row).
UPDATE public.qc_issues i
SET cleaners = i.cleaners || jsonb_build_array(
  jsonb_build_object('id', i.cleaner_id, 'name', i.cleaner_name, 'role', NULL)
)
WHERE i.cleaner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(i.cleaners) e
    WHERE e->>'id' = i.cleaner_id::text
  );
