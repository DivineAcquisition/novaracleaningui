-- ─── Host portal: cleaner roster management + change requests ───────────────
--
-- Hosts manage the crew on their properties (names only — no contact info) and
-- can REQUEST a replacement or an additional cleaner. They never directly
-- reassign (vetting stays with ops); a request notifies ops who fulfil it via
-- the existing assignment tools.
--
-- Caps (enforced in the partner-turnover function): up to 2 preferred cleaners
-- per property, and a host roster of at most 10 distinct cleaners.

-- Recommended crew size per property, derived from sqft (2–3). Surfaced to the
-- host and used as the dispatch target. NULL = not yet set.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS target_crew_size int;

CREATE TABLE IF NOT EXISTS public.cleaner_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  turnover_id uuid REFERENCES public.turnover_requests(id) ON DELETE SET NULL,
  current_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'replace' CHECK (kind IN ('replace', 'additional', 'remove')),
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'declined')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ccr_host_idx ON public.cleaner_change_requests (host_id);
CREATE INDEX IF NOT EXISTS ccr_property_idx ON public.cleaner_change_requests (property_id);
CREATE INDEX IF NOT EXISTS ccr_status_idx ON public.cleaner_change_requests (status);

ALTER TABLE public.cleaner_change_requests ENABLE ROW LEVEL SECURITY;

-- Hosts may READ their own requests; all writes go through the service-role
-- partner-turnover function (consistent with the rest of the host portal).
DROP POLICY IF EXISTS "hosts read own cleaner change requests" ON public.cleaner_change_requests;
CREATE POLICY "hosts read own cleaner change requests"
  ON public.cleaner_change_requests FOR SELECT
  USING (
    host_id IN (SELECT id FROM public.hosts WHERE user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
